use datafusion::logical_expr::{Expr, Operator};
use datafusion::scalar::ScalarValue;
use crate::DatabaseKind;

use super::impl_scan_adapter::ScanSql;

/// Translates DataFusion filter [`Expr`]s into dialect-specific SQL `WHERE`
/// fragments for push-down to a federated source.
pub(crate) struct FilterTranslator;

impl FilterTranslator {
    pub(crate) fn expr_to_sql(expr: &Expr, kind: DatabaseKind) -> Option<String> {
        match expr {
            Expr::BinaryExpr(binary) => {
                let op_str = match binary.op {
                    Operator::Eq => "=",
                    Operator::NotEq => "!=",
                    Operator::Lt => "<",
                    Operator::LtEq => "<=",
                    Operator::Gt => ">",
                    Operator::GtEq => ">=",
                    Operator::And => {
                        let l = Self::expr_to_sql(&binary.left, kind)?;
                        let r = Self::expr_to_sql(&binary.right, kind)?;
                        return Some(format!("({l} AND {r})"));
                    }
                    Operator::Or => {
                        let l = Self::expr_to_sql(&binary.left, kind)?;
                        let r = Self::expr_to_sql(&binary.right, kind)?;
                        return Some(format!("({l} OR {r})"));
                    }
                    _ => return None,
                };
                let l = Self::expr_to_sql(&binary.left, kind)?;
                let r = Self::expr_to_sql(&binary.right, kind)?;
                Some(format!("{l} {op_str} {r}"))
            }
            Expr::Not(inner) => {
                let s = Self::expr_to_sql(inner, kind)?;
                Some(format!("NOT ({s})"))
            }
            Expr::IsNull(inner) => {
                let s = Self::expr_to_sql(inner, kind)?;
                Some(format!("{s} IS NULL"))
            }
            Expr::IsNotNull(inner) => {
                let s = Self::expr_to_sql(inner, kind)?;
                Some(format!("{s} IS NOT NULL"))
            }
            Expr::Column(col) => Some(ScanSql::quote_ident(kind, &col.name)),
            Expr::Literal(sv, _) => Self::scalar_to_sql(sv, kind),
            Expr::InList(in_list) => {
                let col = Self::expr_to_sql(&in_list.expr, kind)?;
                let vals: Option<Vec<String>> = in_list
                    .list
                    .iter()
                    .map(|e| Self::expr_to_sql(e, kind))
                    .collect();
                let vals = vals?;
                let joined = vals.join(", ");
                if in_list.negated {
                    Some(format!("{col} NOT IN ({joined})"))
                } else {
                    Some(format!("{col} IN ({joined})"))
                }
            }
            Expr::Between(between) => {
                let col = Self::expr_to_sql(&between.expr, kind)?;
                let lo = Self::expr_to_sql(&between.low, kind)?;
                let hi = Self::expr_to_sql(&between.high, kind)?;
                if between.negated {
                    Some(format!("{col} NOT BETWEEN {lo} AND {hi}"))
                } else {
                    Some(format!("{col} BETWEEN {lo} AND {hi}"))
                }
            }
            _ => None,
        }
    }

    fn scalar_to_sql(sv: &ScalarValue, kind: DatabaseKind) -> Option<String> {
        match sv {
            ScalarValue::Null => Some("NULL".to_string()),
            ScalarValue::Boolean(Some(b)) => Some(if *b { "TRUE" } else { "FALSE" }.to_string()),
            ScalarValue::Int8(Some(v)) => Some(v.to_string()),
            ScalarValue::Int16(Some(v)) => Some(v.to_string()),
            ScalarValue::Int32(Some(v)) => Some(v.to_string()),
            ScalarValue::Int64(Some(v)) => Some(v.to_string()),
            ScalarValue::UInt8(Some(v)) => Some(v.to_string()),
            ScalarValue::UInt16(Some(v)) => Some(v.to_string()),
            ScalarValue::UInt32(Some(v)) => Some(v.to_string()),
            ScalarValue::UInt64(Some(v)) => Some(v.to_string()),
            ScalarValue::Float32(Some(v)) => Some(v.to_string()),
            ScalarValue::Float64(Some(v)) => Some(v.to_string()),
            ScalarValue::Utf8(Some(s)) | ScalarValue::LargeUtf8(Some(s)) => {
                Some(ScanSql::quote_literal(kind, s))
            }
            _ => None,
        }
    }

    pub(crate) fn exprs_to_where_clause(exprs: &[Expr], kind: DatabaseKind) -> (String, Vec<usize>) {
        let mut parts = Vec::new();
        let mut pushed_indices = Vec::new();
        for (i, expr) in exprs.iter().enumerate() {
            if let Some(sql) = Self::expr_to_sql(expr, kind) {
                parts.push(sql);
                pushed_indices.push(i);
            }
        }
        let clause = parts.join(" AND ");
        (clause, pushed_indices)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use datafusion::common::Column;
    use datafusion::logical_expr::{BinaryExpr, Between};
    use datafusion::logical_expr::expr::InList;

    fn col(name: &str) -> Expr {
        Expr::Column(Column::from_name(name))
    }

    fn lit_i64(v: i64) -> Expr {
        Expr::Literal(ScalarValue::Int64(Some(v)), None)
    }

    fn lit_str(s: &str) -> Expr {
        Expr::Literal(ScalarValue::Utf8(Some(s.to_string())), None)
    }

    fn lit_f64(v: f64) -> Expr {
        Expr::Literal(ScalarValue::Float64(Some(v)), None)
    }

    #[test]
    fn simple_eq() {
        let expr = Expr::BinaryExpr(BinaryExpr::new(
            Box::new(col("id")),
            Operator::Eq,
            Box::new(lit_i64(42)),
        ));
        assert_eq!(
            FilterTranslator::expr_to_sql(&expr, DatabaseKind::Postgres).unwrap(),
            "\"id\" = 42"
        );
    }

    #[test]
    fn string_comparison_mysql() {
        let expr = Expr::BinaryExpr(BinaryExpr::new(
            Box::new(col("status")),
            Operator::Eq,
            Box::new(lit_str("active")),
        ));
        assert_eq!(
            FilterTranslator::expr_to_sql(&expr, DatabaseKind::Mysql).unwrap(),
            "`status` = 'active'"
        );
    }

    #[test]
    fn and_or_combination() {
        let left = Expr::BinaryExpr(BinaryExpr::new(
            Box::new(col("age")),
            Operator::Gt,
            Box::new(lit_i64(18)),
        ));
        let right = Expr::BinaryExpr(BinaryExpr::new(
            Box::new(col("active")),
            Operator::Eq,
            Box::new(Expr::Literal(ScalarValue::Boolean(Some(true)), None)),
        ));
        let combined = Expr::BinaryExpr(BinaryExpr::new(
            Box::new(left),
            Operator::And,
            Box::new(right),
        ));
        assert_eq!(
            FilterTranslator::expr_to_sql(&combined, DatabaseKind::Postgres).unwrap(),
            "(\"age\" > 18 AND \"active\" = TRUE)"
        );
    }

    #[test]
    fn is_null() {
        let expr = Expr::IsNull(Box::new(col("email")));
        assert_eq!(
            FilterTranslator::expr_to_sql(&expr, DatabaseKind::Postgres).unwrap(),
            "\"email\" IS NULL"
        );
    }

    #[test]
    fn is_not_null() {
        let expr = Expr::IsNotNull(Box::new(col("email")));
        assert_eq!(
            FilterTranslator::expr_to_sql(&expr, DatabaseKind::Postgres).unwrap(),
            "\"email\" IS NOT NULL"
        );
    }

    #[test]
    fn not_expr() {
        let inner = Expr::BinaryExpr(BinaryExpr::new(
            Box::new(col("deleted")),
            Operator::Eq,
            Box::new(Expr::Literal(ScalarValue::Boolean(Some(true)), None)),
        ));
        let expr = Expr::Not(Box::new(inner));
        assert_eq!(
            FilterTranslator::expr_to_sql(&expr, DatabaseKind::Postgres).unwrap(),
            "NOT (\"deleted\" = TRUE)"
        );
    }

    #[test]
    fn in_list_expr() {
        let expr = Expr::InList(InList::new(
            Box::new(col("id")),
            vec![lit_i64(1), lit_i64(2), lit_i64(3)],
            false,
        ));
        assert_eq!(
            FilterTranslator::expr_to_sql(&expr, DatabaseKind::Postgres).unwrap(),
            "\"id\" IN (1, 2, 3)"
        );
    }

    #[test]
    fn not_in_list_expr() {
        let expr = Expr::InList(InList::new(
            Box::new(col("id")),
            vec![lit_i64(1), lit_i64(2)],
            true,
        ));
        assert_eq!(
            FilterTranslator::expr_to_sql(&expr, DatabaseKind::Postgres).unwrap(),
            "\"id\" NOT IN (1, 2)"
        );
    }

    #[test]
    fn between_expr() {
        let expr = Expr::Between(Between::new(
            Box::new(col("price")),
            false,
            Box::new(lit_f64(10.0)),
            Box::new(lit_f64(100.0)),
        ));
        assert_eq!(
            FilterTranslator::expr_to_sql(&expr, DatabaseKind::Postgres).unwrap(),
            "\"price\" BETWEEN 10 AND 100"
        );
    }

    #[test]
    fn unsupported_expr_returns_none() {
        let expr = Expr::Wildcard { qualifier: None, options: Default::default() };
        assert!(FilterTranslator::expr_to_sql(&expr, DatabaseKind::Postgres).is_none());
    }

    #[test]
    fn exprs_to_where_clause_combines() {
        let filters = vec![
            Expr::BinaryExpr(BinaryExpr::new(
                Box::new(col("age")),
                Operator::Gt,
                Box::new(lit_i64(18)),
            )),
            Expr::BinaryExpr(BinaryExpr::new(
                Box::new(col("name")),
                Operator::Eq,
                Box::new(lit_str("Alice")),
            )),
        ];
        let (clause, indices) = FilterTranslator::exprs_to_where_clause(&filters, DatabaseKind::Postgres);
        assert_eq!(clause, "\"age\" > 18 AND \"name\" = 'Alice'");
        assert_eq!(indices, vec![0, 1]);
    }

    #[test]
    fn exprs_to_where_clause_skips_unsupported() {
        let filters = vec![
            Expr::BinaryExpr(BinaryExpr::new(
                Box::new(col("id")),
                Operator::Eq,
                Box::new(lit_i64(1)),
            )),
            Expr::Wildcard { qualifier: None, options: Default::default() },
        ];
        let (clause, indices) = FilterTranslator::exprs_to_where_clause(&filters, DatabaseKind::Postgres);
        assert_eq!(clause, "\"id\" = 1");
        assert_eq!(indices, vec![0]);
    }

    #[test]
    fn string_with_quotes_escaped() {
        let expr = Expr::BinaryExpr(BinaryExpr::new(
            Box::new(col("name")),
            Operator::Eq,
            Box::new(lit_str("O'Brien")),
        ));
        assert_eq!(
            FilterTranslator::expr_to_sql(&expr, DatabaseKind::Postgres).unwrap(),
            "\"name\" = 'O''Brien'"
        );
    }
}
