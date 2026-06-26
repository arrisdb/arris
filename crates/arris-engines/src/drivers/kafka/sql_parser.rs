use anyhow::{Result, bail};
use sqlparser::ast::{
    BinaryOperator, Expr, FunctionArg, FunctionArgExpr, FunctionArguments,
    GroupByExpr, Ident, OrderByKind, SelectItem, SetExpr, Statement, TableFactor, Value,
};

use crate::drivers::common::sql_parser::parse_sql_statement;

#[derive(Debug, Clone, PartialEq)]
pub struct KafkaQuery {
    pub topic: String,
    pub select: SelectClause,
    pub where_conditions: Vec<Condition>,
    pub group_by: Vec<String>,
    pub order_by: Vec<OrderByClause>,
    pub limit: Option<usize>,
    pub from_latest: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SelectClause {
    All,
    Columns(Vec<SelectColumn>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct SelectColumn {
    pub expr: ColumnExpr,
    pub alias: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ColumnExpr {
    Name(String),
    Agg(AggFunc, String),
    CountAll,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AggFunc {
    Count,
    Sum,
    Avg,
    Min,
    Max,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Condition {
    pub column: String,
    pub op: CompOp,
    pub value: LiteralValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompOp {
    Eq,
    Neq,
    Lt,
    Gt,
    Lte,
    Gte,
    Like,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LiteralValue {
    Str(String),
    Num(f64),
    Bool(bool),
    Null,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OrderByClause {
    pub column: String,
    pub desc: bool,
}

pub fn parse_kafka_sql(sql: &str) -> Result<KafkaQuery> {
    let trimmed = crate::QueryEngine::trim_trailing_sql_semicolon(sql);
    let from_latest = trimmed.ends_with("[LATEST]");
    let working = if from_latest {
        trimmed.trim_end_matches("[LATEST]").trim()
    } else {
        trimmed
    };

    let stmt = parse_sql_statement(working).map_err(|e| anyhow::anyhow!("{e}"))?;

    let Statement::Query(query) = stmt else {
        bail!("Kafka only supports SELECT queries");
    };

    let SetExpr::Select(select) = *query.body else {
        bail!("Kafka only supports SELECT queries");
    };

    if select.from.is_empty() {
        bail!("Expected FROM clause");
    }
    if select.from.len() > 1 || !select.from[0].joins.is_empty() {
        bail!(
            "Kafka driver supports single-topic queries only; JOINs across topics are not supported. Use a federated query to join topics."
        );
    }
    let topic = extract_table_name(&select.from[0].relation)?;
    let select_clause = extract_select(&select.projection)?;

    let where_conditions = if let Some(ref expr) = select.selection {
        extract_conditions(expr)?
    } else {
        Vec::new()
    };

    let group_by = extract_group_by(&select.group_by);
    let order_by = extract_order_by(&query.order_by);
    let limit = extract_limit(&query.limit_clause);

    Ok(KafkaQuery {
        topic,
        select: select_clause,
        where_conditions,
        group_by,
        order_by,
        limit,
        from_latest,
    })
}

fn extract_table_name(factor: &TableFactor) -> Result<String> {
    match factor {
        TableFactor::Table { name, .. } => {
            Ok(name.0.last().and_then(|p| p.as_ident()).map(|id| id.value.clone()).unwrap_or_default())
        }
        _ => bail!("Expected topic name after FROM"),
    }
}

fn extract_select(items: &[SelectItem]) -> Result<SelectClause> {
    if items.len() == 1 && matches!(&items[0], SelectItem::Wildcard(_)) {
        return Ok(SelectClause::All);
    }

    let mut cols = Vec::new();
    for item in items {
        let (expr, alias) = match item {
            SelectItem::UnnamedExpr(e) => (e, None),
            SelectItem::ExprWithAlias { expr, alias } => (expr, Some(alias.value.clone())),
            SelectItem::Wildcard(_) => {
                cols.push(SelectColumn {
                    expr: ColumnExpr::Name("*".into()),
                    alias: None,
                });
                continue;
            }
            _ => bail!("Unsupported SELECT item"),
        };
        cols.push(SelectColumn {
            expr: convert_column_expr(expr)?,
            alias,
        });
    }

    if cols.is_empty() {
        bail!("Empty SELECT clause");
    }
    Ok(SelectClause::Columns(cols))
}

fn convert_column_expr(expr: &Expr) -> Result<ColumnExpr> {
    match expr {
        Expr::Identifier(ident) => Ok(ColumnExpr::Name(ident.value.clone())),
        Expr::CompoundIdentifier(parts) => Ok(ColumnExpr::Name(compound_ident_name(parts))),
        Expr::Function(func) => {
            let func_name = func.name.to_string().to_uppercase();
            let agg = match func_name.as_str() {
                "COUNT" => Some(AggFunc::Count),
                "SUM" => Some(AggFunc::Sum),
                "AVG" => Some(AggFunc::Avg),
                "MIN" => Some(AggFunc::Min),
                "MAX" => Some(AggFunc::Max),
                _ => None,
            };
            if let Some(agg_func) = agg {
                let arg = extract_function_arg(&func.args)?;
                match arg.as_deref() {
                    None | Some("*") if agg_func == AggFunc::Count => Ok(ColumnExpr::CountAll),
                    None | Some("*") => Ok(ColumnExpr::Agg(agg_func, "*".into())),
                    Some(col) => Ok(ColumnExpr::Agg(agg_func, col.to_string())),
                }
            } else {
                Ok(ColumnExpr::Name(func.name.to_string()))
            }
        }
        _ => bail!("Unsupported expression in SELECT"),
    }
}

fn extract_function_arg(args: &FunctionArguments) -> Result<Option<String>> {
    match args {
        FunctionArguments::None => Ok(None),
        FunctionArguments::List(arg_list) => {
            if arg_list.args.is_empty() {
                return Ok(None);
            }
            match &arg_list.args[0] {
                FunctionArg::Unnamed(FunctionArgExpr::Wildcard) => Ok(Some("*".into())),
                FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Identifier(ident))) => {
                    Ok(Some(ident.value.clone()))
                }
                FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::CompoundIdentifier(parts))) => {
                    Ok(Some(compound_ident_name(parts)))
                }
                _ => bail!("Malformed aggregate expression"),
            }
        }
        FunctionArguments::Subquery(_) => bail!("Subqueries not supported"),
    }
}

fn extract_conditions(expr: &Expr) -> Result<Vec<Condition>> {
    let mut conditions = Vec::new();
    flatten_and_conditions(expr, &mut conditions)?;
    Ok(conditions)
}

fn flatten_and_conditions(expr: &Expr, out: &mut Vec<Condition>) -> Result<()> {
    match expr {
        Expr::BinaryOp {
            left,
            op: BinaryOperator::And,
            right,
        } => {
            flatten_and_conditions(left, out)?;
            flatten_and_conditions(right, out)?;
        }
        Expr::Like {
            negated: false,
            expr: col_expr,
            pattern,
            ..
        } => {
            let column = expr_to_column_name(col_expr)?;
            let val = expr_to_string_value(pattern)?;
            out.push(Condition {
                column,
                op: CompOp::Like,
                value: LiteralValue::Str(val),
            });
        }
        Expr::BinaryOp { left, op, right } => {
            let column = expr_to_column_name(left)?;
            let comp_op = convert_binary_op(op)?;
            let value = expr_to_literal(right)?;
            out.push(Condition {
                column,
                op: comp_op,
                value,
            });
        }
        _ => bail!("Unsupported WHERE expression"),
    }
    Ok(())
}

fn expr_to_column_name(expr: &Expr) -> Result<String> {
    match expr {
        Expr::Identifier(ident) => Ok(ident.value.clone()),
        Expr::CompoundIdentifier(parts) => Ok(compound_ident_name(parts)),
        _ => bail!("Expected column name"),
    }
}

/// Resolve a qualified column reference (e.g. `ord.customer_id`) to its field
/// name. Kafka messages are flat JSON objects, so the table-alias qualifier is
/// dropped and the last identifier segment is the field key.
fn compound_ident_name(parts: &[Ident]) -> String {
    parts.last().map(|i| i.value.clone()).unwrap_or_default()
}

fn expr_to_string_value(expr: &Expr) -> Result<String> {
    match expr {
        Expr::Value(v) => match &v.value {
            Value::SingleQuotedString(s) | Value::DoubleQuotedString(s) => Ok(s.clone()),
            _ => bail!("Expected string value"),
        },
        _ => bail!("Expected string value"),
    }
}

fn convert_binary_op(op: &BinaryOperator) -> Result<CompOp> {
    match op {
        BinaryOperator::Eq => Ok(CompOp::Eq),
        BinaryOperator::NotEq => Ok(CompOp::Neq),
        BinaryOperator::Lt => Ok(CompOp::Lt),
        BinaryOperator::Gt => Ok(CompOp::Gt),
        BinaryOperator::LtEq => Ok(CompOp::Lte),
        BinaryOperator::GtEq => Ok(CompOp::Gte),
        _ => bail!("Unknown operator: {op}"),
    }
}

fn expr_to_literal(expr: &Expr) -> Result<LiteralValue> {
    match expr {
        Expr::Value(v) => convert_value(&v.value),
        Expr::UnaryOp {
            op: sqlparser::ast::UnaryOperator::Minus,
            expr: inner,
        } => match inner.as_ref() {
            Expr::Value(v) => {
                if let Value::Number(s, _) = &v.value {
                    let n: f64 =
                        s.parse().map_err(|_| anyhow::anyhow!("Invalid number"))?;
                    Ok(LiteralValue::Num(-n))
                } else {
                    bail!("Expected literal value")
                }
            }
            _ => bail!("Expected literal value"),
        },
        _ => bail!("Expected literal value"),
    }
}

fn convert_value(value: &Value) -> Result<LiteralValue> {
    match value {
        Value::SingleQuotedString(s) | Value::DoubleQuotedString(s) => {
            Ok(LiteralValue::Str(s.clone()))
        }
        Value::Number(s, _) => {
            let n: f64 = s
                .parse()
                .map_err(|_| anyhow::anyhow!("Invalid number: {s}"))?;
            Ok(LiteralValue::Num(n))
        }
        Value::Boolean(b) => Ok(LiteralValue::Bool(*b)),
        Value::Null => Ok(LiteralValue::Null),
        _ => bail!("Unsupported value type"),
    }
}

fn extract_group_by(group_by: &GroupByExpr) -> Vec<String> {
    match group_by {
        GroupByExpr::All(_) => Vec::new(),
        GroupByExpr::Expressions(exprs, _) => exprs
            .iter()
            .filter_map(|e| match e {
                Expr::Identifier(ident) => Some(ident.value.clone()),
                Expr::CompoundIdentifier(parts) => Some(compound_ident_name(parts)),
                _ => None,
            })
            .collect(),
    }
}

fn extract_order_by(order_by: &Option<sqlparser::ast::OrderBy>) -> Vec<OrderByClause> {
    let Some(ob) = order_by else {
        return Vec::new();
    };
    let OrderByKind::Expressions(exprs) = &ob.kind else {
        return Vec::new();
    };
    exprs
        .iter()
        .map(|o| {
            let column = match &o.expr {
                Expr::Identifier(ident) => ident.value.clone(),
                Expr::CompoundIdentifier(parts) => compound_ident_name(parts),
                other => other.to_string(),
            };
            let desc = o.options.asc == Some(false);
            OrderByClause { column, desc }
        })
        .collect()
}

fn extract_limit(clause: &Option<sqlparser::ast::LimitClause>) -> Option<usize> {
    match clause.as_ref()? {
        sqlparser::ast::LimitClause::LimitOffset { limit, .. } => {
            let expr = limit.as_ref()?;
            match expr {
                Expr::Value(v) => match &v.value {
                    Value::Number(s, _) => s.parse().ok(),
                    _ => None,
                },
                _ => None,
            }
        }
        _ => None,
    }
}

pub fn eval_condition(row: &serde_json::Value, cond: &Condition) -> bool {
    let field = row.get(&cond.column);
    match (&cond.op, &cond.value) {
        (CompOp::Eq, LiteralValue::Null) => {
            field.is_none() || field == Some(&serde_json::Value::Null)
        }
        (CompOp::Neq, LiteralValue::Null) => {
            field.is_some() && field != Some(&serde_json::Value::Null)
        }
        _ => {
            let Some(val) = field else { return false };
            match &cond.value {
                LiteralValue::Str(s) => {
                    let field_str = match val {
                        serde_json::Value::String(v) => v.as_str(),
                        _ => return false,
                    };
                    match cond.op {
                        CompOp::Eq => field_str == s,
                        CompOp::Neq => field_str != s,
                        CompOp::Lt => field_str < s.as_str(),
                        CompOp::Gt => field_str > s.as_str(),
                        CompOp::Lte => field_str <= s.as_str(),
                        CompOp::Gte => field_str >= s.as_str(),
                        CompOp::Like => like_match(field_str, s),
                    }
                }
                LiteralValue::Num(n) => {
                    let field_num = val.as_f64().unwrap_or(f64::NAN);
                    match cond.op {
                        CompOp::Eq => (field_num - n).abs() < f64::EPSILON,
                        CompOp::Neq => (field_num - n).abs() >= f64::EPSILON,
                        CompOp::Lt => field_num < *n,
                        CompOp::Gt => field_num > *n,
                        CompOp::Lte => field_num <= *n,
                        CompOp::Gte => field_num >= *n,
                        CompOp::Like => false,
                    }
                }
                LiteralValue::Bool(b) => {
                    let field_bool = val.as_bool().unwrap_or(false);
                    match cond.op {
                        CompOp::Eq => field_bool == *b,
                        CompOp::Neq => field_bool != *b,
                        _ => false,
                    }
                }
                LiteralValue::Null => false,
            }
        }
    }
}

fn like_match(value: &str, pattern: &str) -> bool {
    let regex_str = pattern.replace('%', ".*").replace('_', ".");
    regex_like(&regex_str, value)
}

fn regex_like(pattern: &str, text: &str) -> bool {
    let pat = format!("^{pattern}$");
    simple_glob_match(&pat, text)
}

fn simple_glob_match(pattern: &str, text: &str) -> bool {
    let pattern = pattern.as_bytes();
    let text = text.as_bytes();
    let (m, n) = (pattern.len(), text.len());
    let mut dp = vec![vec![false; n + 1]; m + 1];
    dp[0][0] = true;
    for i in 1..=m {
        if pattern[i - 1] == b'.' && i + 1 <= m && pattern[i] == b'*' {
            dp[i + 1][0] = dp[i - 1][0];
        }
        if pattern[i - 1] == b'^' {
            dp[i][0] = dp[i - 1][0];
        }
        if pattern[i - 1] == b'$' {
            dp[i][0] = dp[i - 1][0];
        }
    }

    for i in 1..=m {
        for j in 1..=n {
            let pc = pattern[i - 1];
            match pc {
                b'^' => dp[i][j] = dp[i - 1][j],
                b'$' => dp[i][j] = dp[i - 1][j],
                b'.' if i < m && pattern[i] == b'*' => {}
                b'*' if i >= 2 && pattern[i - 2] == b'.' => {
                    dp[i][j] = dp[i - 2][j] || dp[i][j - 1];
                }
                b'.' => dp[i][j] = dp[i - 1][j - 1],
                _ => dp[i][j] = dp[i - 1][j - 1] && pc == text[j - 1],
            }
        }
    }
    dp[m][n]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_select_all() {
        let q = parse_kafka_sql("SELECT * FROM my_topic").unwrap();
        assert_eq!(q.topic, "my_topic");
        assert_eq!(q.select, SelectClause::All);
        assert!(!q.from_latest);
        assert!(q.where_conditions.is_empty());
    }

    #[test]
    fn parse_select_columns() {
        let q = parse_kafka_sql("SELECT name, age FROM users").unwrap();
        assert_eq!(q.topic, "users");
        match &q.select {
            SelectClause::Columns(cols) => {
                assert_eq!(cols.len(), 2);
                assert_eq!(cols[0].expr, ColumnExpr::Name("name".into()));
                assert_eq!(cols[1].expr, ColumnExpr::Name("age".into()));
            }
            _ => panic!("expected columns"),
        }
    }

    #[test]
    fn parse_with_where() {
        let q =
            parse_kafka_sql("SELECT * FROM events WHERE status = 'active' AND count > 5").unwrap();
        assert_eq!(q.where_conditions.len(), 2);
        assert_eq!(q.where_conditions[0].column, "status");
        assert_eq!(q.where_conditions[0].op, CompOp::Eq);
        assert_eq!(
            q.where_conditions[0].value,
            LiteralValue::Str("active".into())
        );
        assert_eq!(q.where_conditions[1].column, "count");
        assert_eq!(q.where_conditions[1].op, CompOp::Gt);
        assert_eq!(q.where_conditions[1].value, LiteralValue::Num(5.0));
    }

    #[test]
    fn parse_with_group_by_and_agg() {
        let q = parse_kafka_sql("SELECT region, COUNT(*) FROM sales GROUP BY region").unwrap();
        match &q.select {
            SelectClause::Columns(cols) => {
                assert_eq!(cols[0].expr, ColumnExpr::Name("region".into()));
                assert_eq!(cols[1].expr, ColumnExpr::CountAll);
            }
            _ => panic!("expected columns"),
        }
        assert_eq!(q.group_by, vec!["region"]);
    }

    #[test]
    fn parse_order_by_desc_limit() {
        let q = parse_kafka_sql("SELECT * FROM logs ORDER BY ts DESC LIMIT 100").unwrap();
        assert_eq!(q.order_by.len(), 1);
        assert_eq!(q.order_by[0].column, "ts");
        assert!(q.order_by[0].desc);
        assert_eq!(q.limit, Some(100));
    }

    #[test]
    fn parse_latest_hint() {
        let q = parse_kafka_sql("SELECT * FROM events [LATEST]").unwrap();
        assert!(q.from_latest);
        assert_eq!(q.topic, "events");
    }

    #[test]
    fn parse_agg_sum_with_alias() {
        let q = parse_kafka_sql("SELECT SUM(amount) AS total FROM payments").unwrap();
        match &q.select {
            SelectClause::Columns(cols) => {
                assert_eq!(cols[0].expr, ColumnExpr::Agg(AggFunc::Sum, "amount".into()));
                assert_eq!(cols[0].alias, Some("total".into()));
            }
            _ => panic!("expected columns"),
        }
    }

    #[test]
    fn parse_rejects_non_select() {
        assert!(parse_kafka_sql("INSERT INTO topic VALUES (1)").is_err());
    }

    #[test]
    fn eval_eq_string() {
        let row = serde_json::json!({"name": "alice"});
        let cond = Condition {
            column: "name".into(),
            op: CompOp::Eq,
            value: LiteralValue::Str("alice".into()),
        };
        assert!(eval_condition(&row, &cond));
    }

    #[test]
    fn eval_gt_number() {
        let row = serde_json::json!({"age": 30});
        let cond = Condition {
            column: "age".into(),
            op: CompOp::Gt,
            value: LiteralValue::Num(25.0),
        };
        assert!(eval_condition(&row, &cond));
    }

    #[test]
    fn eval_null_check() {
        let row = serde_json::json!({"name": null});
        let cond = Condition {
            column: "name".into(),
            op: CompOp::Eq,
            value: LiteralValue::Null,
        };
        assert!(eval_condition(&row, &cond));
    }

    #[test]
    fn eval_like_pattern() {
        let row = serde_json::json!({"name": "alice"});
        let cond = Condition {
            column: "name".into(),
            op: CompOp::Like,
            value: LiteralValue::Str("ali%".into()),
        };
        assert!(eval_condition(&row, &cond));
    }

    #[test]
    fn parse_where_like() {
        let q = parse_kafka_sql("SELECT * FROM t WHERE name LIKE '%test%'").unwrap();
        assert_eq!(q.where_conditions.len(), 1);
        assert_eq!(q.where_conditions[0].op, CompOp::Like);
    }

    #[test]
    fn parse_where_lte() {
        let q = parse_kafka_sql("SELECT * FROM t WHERE age <= 30").unwrap();
        assert_eq!(q.where_conditions[0].op, CompOp::Lte);
    }

    #[test]
    fn parse_where_neq() {
        let q = parse_kafka_sql("SELECT * FROM t WHERE status != 'deleted'").unwrap();
        assert_eq!(q.where_conditions[0].op, CompOp::Neq);
    }

    #[test]
    fn tokenize_handles_quoted_identifiers() {
        let q = parse_kafka_sql("SELECT * FROM `my-topic`").unwrap();
        assert_eq!(q.topic, "my-topic");
    }

    #[test]
    fn parse_qualified_select_columns() {
        let q = parse_kafka_sql("SELECT ord.customer_id, ord.amount FROM orders AS ord").unwrap();
        assert_eq!(q.topic, "orders");
        match &q.select {
            SelectClause::Columns(cols) => {
                assert_eq!(cols.len(), 2);
                assert_eq!(cols[0].expr, ColumnExpr::Name("customer_id".into()));
                assert_eq!(cols[1].expr, ColumnExpr::Name("amount".into()));
            }
            _ => panic!("expected columns"),
        }
    }

    #[test]
    fn parse_qualified_where_group_order_agg() {
        let q = parse_kafka_sql(
            "SELECT o.region, SUM(o.amount) AS total FROM sales AS o \
             WHERE o.status = 'active' GROUP BY o.region ORDER BY o.region DESC",
        )
        .unwrap();
        match &q.select {
            SelectClause::Columns(cols) => {
                assert_eq!(cols[0].expr, ColumnExpr::Name("region".into()));
                assert_eq!(cols[1].expr, ColumnExpr::Agg(AggFunc::Sum, "amount".into()));
            }
            _ => panic!("expected columns"),
        }
        assert_eq!(q.where_conditions[0].column, "status");
        assert_eq!(q.group_by, vec!["region"]);
        assert_eq!(q.order_by[0].column, "region");
        assert!(q.order_by[0].desc);
    }

    #[test]
    fn parse_rejects_join_across_topics() {
        let err = parse_kafka_sql(
            "SELECT ord.customer_id, cut.email FROM orders AS ord \
             JOIN customers AS cut ON ord.customer_id = cut.customer_id",
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("single-topic"), "unexpected error: {err}");
        assert!(err.contains("federated"), "unexpected error: {err}");
    }

    #[test]
    fn parse_rejects_comma_cross_join() {
        assert!(parse_kafka_sql("SELECT * FROM orders, customers").is_err());
    }
}
