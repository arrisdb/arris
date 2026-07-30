use std::ops::ControlFlow;

use datafusion::sql::sqlparser::ast::{
    Ident, ObjectName, ObjectNamePart, Statement, VisitMut, VisitorMut,
};
use datafusion::sql::sqlparser::dialect::GenericDialect;
use datafusion::sql::sqlparser::parser::{Parser, ParserError};

use super::constants::{IDENT_QUOTE, STATEMENT_SEPARATOR};
use super::types::FederationRef;

/// Collapses every `connection.table` / `connection.schema.table` relation into
/// one quoted identifier, the name its provider is registered under.
pub(super) struct FederationRefRewriter {
    refs: Vec<FederationRef>,
}

impl FederationRefRewriter {
    pub(super) fn apply(sql: &str) -> Result<(String, Vec<FederationRef>), ParserError> {
        let (statements, refs) = Self::visit(sql)?;
        let rewritten = statements
            .iter()
            .map(Statement::to_string)
            .collect::<Vec<_>>()
            .join(STATEMENT_SEPARATOR);
        Ok((rewritten, refs))
    }

    /// Skips rendering: callers that only want the refs pay for the parse alone.
    pub(super) fn parse(sql: &str) -> Result<Vec<FederationRef>, ParserError> {
        Self::visit(sql).map(|(_, refs)| refs)
    }

    fn visit(sql: &str) -> Result<(Vec<Statement>, Vec<FederationRef>), ParserError> {
        let mut statements = Parser::parse_sql(&GenericDialect {}, sql)?;
        let mut rewriter = Self { refs: Vec::new() };
        for statement in &mut statements {
            let _ = statement.visit(&mut rewriter);
        }
        Ok((statements, rewriter.refs))
    }

    /// Quoting is the parser's job, so `Ident::value` is already the raw name.
    fn to_ref(relation: &ObjectName) -> Option<FederationRef> {
        let idents: Vec<&Ident> = relation
            .0
            .iter()
            .map(ObjectNamePart::as_ident)
            .collect::<Option<Vec<_>>>()?;
        match idents.as_slice() {
            [connection, table] => Some(FederationRef {
                connection: connection.value.clone(),
                schema: None,
                table: table.value.clone(),
            }),
            [connection, schema, table] => Some(FederationRef {
                connection: connection.value.clone(),
                schema: Some(schema.value.clone()),
                table: table.value.clone(),
            }),
            _ => None,
        }
    }
}

impl VisitorMut for FederationRefRewriter {
    type Break = ();

    fn pre_visit_relation(&mut self, relation: &mut ObjectName) -> ControlFlow<Self::Break> {
        let Some(reference) = Self::to_ref(relation) else {
            return ControlFlow::Continue(());
        };
        *relation = ObjectName::from(Ident::with_quote(IDENT_QUOTE, reference.dotted_name()));
        self.refs.push(reference);
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refs(sql: &str) -> Vec<FederationRef> {
        FederationRefRewriter::parse(sql).unwrap()
    }

    fn rewrite(sql: &str) -> String {
        FederationRefRewriter::apply(sql).unwrap().0
    }

    #[test]
    fn parses_a_two_part_reference() {
        assert_eq!(
            refs("SELECT * FROM pg.users"),
            vec![FederationRef {
                connection: "pg".into(),
                schema: None,
                table: "users".into(),
            }]
        );
    }

    #[test]
    fn parses_a_three_part_reference() {
        assert_eq!(
            refs("SELECT * FROM pg.public.users"),
            vec![FederationRef {
                connection: "pg".into(),
                schema: Some("public".into()),
                table: "users".into(),
            }]
        );
    }

    #[test]
    fn parses_both_sides_of_a_join() {
        let parsed = refs("select * from pg.users join ms.orders on 1 = 1");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].connection, "pg");
        assert_eq!(parsed[1].connection, "ms");
    }

    #[test]
    fn ignores_a_bare_table_name() {
        assert!(refs("SELECT * FROM users").is_empty());
    }

    #[test]
    fn ignores_a_four_part_name() {
        assert!(refs("SELECT * FROM a.b.c.d").is_empty());
    }

    #[test]
    fn parses_a_backtick_quoted_connection_name() {
        assert_eq!(
            refs("SELECT * FROM `my conn`.public.users"),
            vec![FederationRef {
                connection: "my conn".into(),
                schema: Some("public".into()),
                table: "users".into(),
            }]
        );
    }

    #[test]
    fn parses_quoted_segments_holding_hyphens_and_dots() {
        assert_eq!(
            refs("SELECT * FROM `prod-db`.`sales.eu`.`order items`"),
            vec![FederationRef {
                connection: "prod-db".into(),
                schema: Some("sales.eu".into()),
                table: "order items".into(),
            }]
        );
    }

    #[test]
    fn reads_a_reference_inside_a_subquery() {
        let parsed = refs("SELECT * FROM (SELECT id FROM `my conn`.users) AS t");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].connection, "my conn");
    }

    #[test]
    fn ignores_a_cte_name_that_shadows_a_connection() {
        let parsed = refs("WITH pg AS (SELECT 1 AS n) SELECT * FROM pg");
        assert!(parsed.is_empty());
    }

    #[test]
    fn ignores_the_word_from_inside_a_string_literal() {
        assert!(refs("SELECT 'from pg.users' AS note").is_empty());
    }

    #[test]
    fn collapses_a_reference_into_one_quoted_identifier() {
        assert_eq!(
            rewrite("SELECT * FROM `my conn`.public.users"),
            "SELECT * FROM `my conn.public.users`"
        );
    }

    #[test]
    fn keeps_names_that_differ_only_in_an_illegal_char_apart() {
        let spaced = rewrite("SELECT * FROM `my conn`.users");
        let hyphened = rewrite("SELECT * FROM `my-conn`.users");
        assert_ne!(spaced, hyphened);
    }

    #[test]
    fn leaves_a_matching_string_literal_untouched() {
        let out = rewrite("SELECT 'pg.users' AS note FROM pg.users");
        assert!(out.contains("'pg.users'"), "{out}");
        assert!(out.contains("FROM `pg.users`"), "{out}");
    }

    #[test]
    fn reports_a_syntax_error_instead_of_guessing() {
        assert!(FederationRefRewriter::apply("SELECT * FROM `my conn.users").is_err());
        assert!(FederationRefRewriter::apply("SELECT * FROM").is_err());
    }
}
