use std::ops::ControlFlow;

use datafusion::sql::sqlparser::ast::{
    Query, Select, SetExpr, Statement, TableAlias, TableFactor, VisitMut, VisitorMut,
};

/// Names derived tables that DataFusion's unparser leaves anonymous while still
/// qualifying columns with the inner relation's alias (apache/datafusion#12993).
pub(super) struct DerivedTableAliaser;

impl DerivedTableAliaser {
    pub(super) fn apply(mut statement: Statement) -> Statement {
        let _ = statement.visit(&mut Self);
        statement
    }

    /// Alias of the subquery's only relation, so the enclosing scope can bind it.
    fn sole_relation_alias(subquery: &Query) -> Option<TableAlias> {
        let SetExpr::Select(select) = subquery.body.as_ref() else {
            return None;
        };
        let [only] = select.from.as_slice() else {
            return None;
        };
        if !only.joins.is_empty() {
            return None;
        }
        let name = match &only.relation {
            TableFactor::Table { alias: Some(a), .. }
            | TableFactor::Derived { alias: Some(a), .. } => a.name.clone(),
            _ => return None,
        };
        Some(TableAlias { explicit: true, name, columns: vec![], at: None })
    }
}

impl VisitorMut for DerivedTableAliaser {
    type Break = ();

    fn pre_visit_select(&mut self, select: &mut Select) -> ControlFlow<Self::Break> {
        let [only] = select.from.as_mut_slice() else {
            return ControlFlow::Continue(());
        };
        if !only.joins.is_empty() {
            return ControlFlow::Continue(());
        }
        let TableFactor::Derived { subquery, alias, .. } = &mut only.relation else {
            return ControlFlow::Continue(());
        };
        if alias.is_none() {
            *alias = Self::sole_relation_alias(subquery);
        }
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use datafusion::sql::sqlparser::dialect::GenericDialect;
    use datafusion::sql::sqlparser::parser::Parser;

    use super::*;

    fn rewrite(sql: &str) -> String {
        let mut parsed = Parser::parse_sql(&GenericDialect {}, sql).unwrap();
        DerivedTableAliaser::apply(parsed.remove(0)).to_string()
    }

    #[test]
    fn names_the_anonymous_derived_table_after_its_only_relation() {
        let out = rewrite(
            "SELECT b.pk FROM (SELECT b.pk FROM test_dataset.table_b AS b) GROUP BY b.pk",
        );
        assert_eq!(
            out,
            "SELECT b.pk FROM (SELECT b.pk FROM test_dataset.table_b AS b) AS b GROUP BY b.pk"
        );
    }

    #[test]
    fn rewrites_the_shape_the_unparser_emits_for_a_distinct_subquery() {
        let out = rewrite(
            "SELECT __correlated_sq_1.pk FROM (SELECT b.pk FROM \
             (SELECT b.pk FROM test_dataset.table_b AS b) GROUP BY b.pk) AS __correlated_sq_1",
        );
        assert_eq!(
            out,
            "SELECT __correlated_sq_1.pk FROM (SELECT b.pk FROM \
             (SELECT b.pk FROM test_dataset.table_b AS b) AS b GROUP BY b.pk) AS __correlated_sq_1"
        );
    }

    #[test]
    fn leaves_an_already_aliased_derived_table_alone() {
        let sql = "SELECT t.pk FROM (SELECT b.pk FROM table_b AS b) AS t";
        assert_eq!(rewrite(sql), sql);
    }

    #[test]
    fn leaves_a_derived_table_whose_inner_relation_has_no_alias() {
        let sql = "SELECT pk FROM (SELECT pk FROM table_b)";
        assert_eq!(rewrite(sql), sql);
    }

    #[test]
    fn leaves_a_derived_table_that_joins_inside() {
        let sql = "SELECT b.pk FROM (SELECT b.pk FROM table_b AS b JOIN table_c AS c ON b.pk = c.pk)";
        assert_eq!(rewrite(sql), sql);
    }

    #[test]
    fn leaves_a_derived_table_beside_a_sibling_relation() {
        let sql = "SELECT b.pk FROM (SELECT b.pk FROM table_b AS b), table_c AS c";
        assert_eq!(rewrite(sql), sql);
    }

    #[test]
    fn leaves_a_derived_table_that_is_joined_to() {
        let sql = "SELECT b.pk FROM (SELECT b.pk FROM table_b AS b) JOIN table_c AS c ON c.pk = 1";
        assert_eq!(rewrite(sql), sql);
    }

    #[test]
    fn leaves_a_set_operation_subquery_alone() {
        let sql = "SELECT pk FROM (SELECT pk FROM table_b AS b UNION SELECT pk FROM table_c AS c)";
        assert_eq!(rewrite(sql), sql);
    }

    #[test]
    fn reaches_a_derived_table_nested_in_a_where_subquery() {
        let out = rewrite(
            "SELECT a.pk FROM table_a AS a WHERE a.pk IN \
             (SELECT b.pk FROM (SELECT b.pk FROM table_b AS b))",
        );
        assert_eq!(
            out,
            "SELECT a.pk FROM table_a AS a WHERE a.pk IN \
             (SELECT b.pk FROM (SELECT b.pk FROM table_b AS b) AS b)"
        );
    }
}
