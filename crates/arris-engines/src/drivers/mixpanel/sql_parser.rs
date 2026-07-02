use std::collections::BTreeMap;

use chrono::Utc;
use crate::QueryValue;
use sqlparser::ast::{
    BinaryOperator, Expr, FunctionArg, FunctionArgExpr, FunctionArguments, GroupByExpr,
    OrderByKind, SelectItem, SetExpr, Statement, TableFactor, UnaryOperator, Value,
};

use crate::drivers::common::sql_parser::parse_sql_statement;

#[derive(Debug, Clone)]
pub struct MixpanelQuery {
    pub columns: Vec<ColumnSelection>,
    pub event_filter: Vec<String>,
    pub from_date: String,
    pub to_date: String,
    pub where_expression: Option<Expression>,
    pub group_by: Vec<String>,
    pub order_by: Vec<(String, bool)>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ColumnSelection {
    All,
    Named(String),
    Aggregation(AggFunc, Option<String>, Option<String>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AggFunc {
    Count,
    Sum,
    Avg,
    Min,
    Max,
}

impl AggFunc {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Count => "COUNT",
            Self::Sum => "SUM",
            Self::Avg => "AVG",
            Self::Min => "MIN",
            Self::Max => "MAX",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Expression {
    Comparison(String, CompOp, SQLLiteral),
    And(Box<Expression>, Box<Expression>),
    Or(Box<Expression>, Box<Expression>),
    Not(Box<Expression>),
    IsNull(String),
    IsNotNull(String),
    Like(String, String),
    InList(String, Vec<SQLLiteral>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompOp {
    Eq,
    Neq,
    Lt,
    Gt,
    Lte,
    Gte,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SQLLiteral {
    String(String),
    Integer(i64),
    Double(f64),
    Boolean(bool),
    Null,
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("Only SELECT statements are supported")]
    NotASelect,
    #[error("Missing FROM clause")]
    MissingFrom,
    #[error("Unknown table '{0}'. Use 'events'.")]
    InvalidTable(String),
    #[error("Unexpected token: {0}")]
    UnexpectedToken(String),
    #[error("Empty query")]
    EmptyQuery,
}

pub fn parse(sql: &str) -> Result<MixpanelQuery, ParseError> {
    let trimmed = crate::QueryEngine::trim_trailing_sql_semicolon(sql).trim();
    if trimmed.is_empty() {
        return Err(ParseError::EmptyQuery);
    }

    if !trimmed.to_uppercase().starts_with("SELECT") {
        return Err(ParseError::NotASelect);
    }

    let stmt = parse_sql_statement(trimmed).map_err(ParseError::UnexpectedToken)?;

    let Statement::Query(query) = stmt else {
        return Err(ParseError::NotASelect);
    };

    let SetExpr::Select(select) = *query.body else {
        return Err(ParseError::NotASelect);
    };

    if select.from.is_empty() {
        return Err(ParseError::MissingFrom);
    }

    let table = get_table_name(&select.from[0].relation)?;
    if table.to_lowercase() != "events" {
        return Err(ParseError::InvalidTable(table));
    }

    let columns = convert_select_items(&select.projection)?;
    let raw_where = select
        .selection
        .as_ref()
        .map(convert_expr)
        .transpose()?;
    let group_by = extract_group_by_names(&select.group_by);
    let order_by = extract_order_by_items(&query.order_by);
    let limit = extract_limit_value(&query.limit_clause);

    let mut event_filter = Vec::new();
    let mut from_date = default_from_date();
    let mut to_date = default_to_date();
    let mut remaining_expr: Option<Expression> = None;

    if let Some(expr) = raw_where {
        let mut extracted = ExtractedFilters::default();
        extract_filters(&expr, &mut extracted);
        event_filter = extracted.events;
        if let Some(fd) = extracted.from_date {
            from_date = fd;
        }
        if let Some(td) = extracted.to_date {
            to_date = td;
        }
        remaining_expr = extracted.remaining;
    }

    Ok(MixpanelQuery {
        columns,
        event_filter,
        from_date,
        to_date,
        where_expression: remaining_expr,
        group_by,
        order_by,
        limit,
    })
}

fn get_table_name(factor: &TableFactor) -> Result<String, ParseError> {
    match factor {
        TableFactor::Table { name, .. } => Ok(name
            .0
            .last()
            .and_then(|p| p.as_ident())
            .map(|id| id.value.clone())
            .unwrap_or_default()),
        _ => Err(ParseError::MissingFrom),
    }
}

fn convert_select_items(items: &[SelectItem]) -> Result<Vec<ColumnSelection>, ParseError> {
    let mut columns = Vec::new();

    for item in items {
        match item {
            SelectItem::Wildcard(_) => columns.push(ColumnSelection::All),
            SelectItem::UnnamedExpr(expr) => {
                columns.push(convert_select_expr(expr, None)?);
            }
            SelectItem::ExprWithAlias { expr, alias } => {
                columns.push(convert_select_expr(expr, Some(&alias.value))?);
            }
            _ => return Err(ParseError::UnexpectedToken("unsupported SELECT item".into())),
        }
    }

    if columns.is_empty() {
        columns.push(ColumnSelection::All);
    }
    Ok(columns)
}

fn convert_select_expr(
    expr: &Expr,
    alias: Option<&str>,
) -> Result<ColumnSelection, ParseError> {
    match expr {
        Expr::Identifier(ident) => Ok(ColumnSelection::Named(ident.value.clone())),
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
                let arg_col = extract_agg_column(&func.args)?;
                Ok(ColumnSelection::Aggregation(
                    agg_func,
                    arg_col,
                    alias.map(String::from),
                ))
            } else {
                Ok(ColumnSelection::Named(func.name.to_string()))
            }
        }
        _ => Ok(ColumnSelection::Named(expr.to_string())),
    }
}

fn extract_agg_column(args: &FunctionArguments) -> Result<Option<String>, ParseError> {
    match args {
        FunctionArguments::None => Ok(None),
        FunctionArguments::List(arg_list) => {
            if arg_list.args.is_empty() {
                return Ok(None);
            }
            match &arg_list.args[0] {
                FunctionArg::Unnamed(FunctionArgExpr::Wildcard) => Ok(None),
                FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Identifier(ident))) => {
                    Ok(Some(ident.value.clone()))
                }
                _ => Err(ParseError::UnexpectedToken(
                    "unsupported aggregate argument".into(),
                )),
            }
        }
        FunctionArguments::Subquery(_) => {
            Err(ParseError::UnexpectedToken("subquery not supported".into()))
        }
    }
}

fn convert_expr(expr: &Expr) -> Result<Expression, ParseError> {
    match expr {
        Expr::BinaryOp {
            left,
            op: BinaryOperator::And,
            right,
        } => Ok(Expression::And(
            Box::new(convert_expr(left)?),
            Box::new(convert_expr(right)?),
        )),
        Expr::BinaryOp {
            left,
            op: BinaryOperator::Or,
            right,
        } => Ok(Expression::Or(
            Box::new(convert_expr(left)?),
            Box::new(convert_expr(right)?),
        )),
        Expr::UnaryOp {
            op: UnaryOperator::Not,
            expr: inner,
        } => Ok(Expression::Not(Box::new(convert_expr(inner)?))),
        Expr::IsNull(inner) => {
            let col = expr_to_col_name(inner)?;
            Ok(Expression::IsNull(col))
        }
        Expr::IsNotNull(inner) => {
            let col = expr_to_col_name(inner)?;
            Ok(Expression::IsNotNull(col))
        }
        Expr::Like {
            negated: false,
            expr: col_expr,
            pattern,
            ..
        } => {
            let col = expr_to_col_name(col_expr)?;
            let pat = expr_to_string(pattern)?;
            Ok(Expression::Like(col, pat))
        }
        Expr::InList {
            expr: col_expr,
            list,
            negated: false,
        } => {
            let col = expr_to_col_name(col_expr)?;
            let values: Result<Vec<_>, _> = list.iter().map(convert_expr_to_literal).collect();
            Ok(Expression::InList(col, values?))
        }
        Expr::BinaryOp { left, op, right } => {
            let col = expr_to_col_name(left)?;
            let comp_op = convert_comp_op(op)?;
            let value = convert_expr_to_literal(right)?;
            Ok(Expression::Comparison(col, comp_op, value))
        }
        Expr::Nested(inner) => convert_expr(inner),
        _ => Err(ParseError::UnexpectedToken(format!("{expr}"))),
    }
}

fn expr_to_col_name(expr: &Expr) -> Result<String, ParseError> {
    match expr {
        Expr::Identifier(ident) => Ok(ident.value.clone()),
        _ => Err(ParseError::UnexpectedToken(format!(
            "expected column name, got {expr}"
        ))),
    }
}

fn expr_to_string(expr: &Expr) -> Result<String, ParseError> {
    match expr {
        Expr::Value(v) => match &v.value {
            Value::SingleQuotedString(s) | Value::DoubleQuotedString(s) => Ok(s.clone()),
            _ => Err(ParseError::UnexpectedToken("expected string".into())),
        },
        _ => Err(ParseError::UnexpectedToken("expected string".into())),
    }
}

fn convert_comp_op(op: &BinaryOperator) -> Result<CompOp, ParseError> {
    match op {
        BinaryOperator::Eq => Ok(CompOp::Eq),
        BinaryOperator::NotEq => Ok(CompOp::Neq),
        BinaryOperator::Lt => Ok(CompOp::Lt),
        BinaryOperator::Gt => Ok(CompOp::Gt),
        BinaryOperator::LtEq => Ok(CompOp::Lte),
        BinaryOperator::GtEq => Ok(CompOp::Gte),
        _ => Err(ParseError::UnexpectedToken(format!("{op}"))),
    }
}

fn convert_expr_to_literal(expr: &Expr) -> Result<SQLLiteral, ParseError> {
    match expr {
        Expr::Value(v) => convert_sql_value(&v.value),
        Expr::UnaryOp {
            op: UnaryOperator::Minus,
            expr: inner,
        } => match inner.as_ref() {
            Expr::Value(v) => {
                if let Value::Number(s, _) = &v.value {
                    let neg = format!("-{s}");
                    if let Ok(i) = neg.parse::<i64>() {
                        return Ok(SQLLiteral::Integer(i));
                    }
                    if let Ok(d) = neg.parse::<f64>() {
                        return Ok(SQLLiteral::Double(d));
                    }
                }
                Err(ParseError::UnexpectedToken("expected literal".into()))
            }
            _ => Err(ParseError::UnexpectedToken("expected literal".into())),
        },
        _ => Err(ParseError::UnexpectedToken(format!("{expr}"))),
    }
}

fn convert_sql_value(value: &Value) -> Result<SQLLiteral, ParseError> {
    match value {
        Value::SingleQuotedString(s) | Value::DoubleQuotedString(s) => {
            Ok(SQLLiteral::String(s.clone()))
        }
        Value::Number(s, _) => {
            if let Ok(i) = s.parse::<i64>() {
                Ok(SQLLiteral::Integer(i))
            } else if let Ok(d) = s.parse::<f64>() {
                Ok(SQLLiteral::Double(d))
            } else {
                Err(ParseError::UnexpectedToken(format!("invalid number: {s}")))
            }
        }
        Value::Boolean(b) => Ok(SQLLiteral::Boolean(*b)),
        Value::Null => Ok(SQLLiteral::Null),
        _ => Err(ParseError::UnexpectedToken(format!("{value}"))),
    }
}

fn extract_group_by_names(group_by: &GroupByExpr) -> Vec<String> {
    match group_by {
        GroupByExpr::All(_) => Vec::new(),
        GroupByExpr::Expressions(exprs, _) => exprs
            .iter()
            .filter_map(|e| match e {
                Expr::Identifier(ident) => Some(ident.value.clone()),
                _ => None,
            })
            .collect(),
    }
}

fn extract_order_by_items(order_by: &Option<sqlparser::ast::OrderBy>) -> Vec<(String, bool)> {
    let Some(ob) = order_by else {
        return Vec::new();
    };
    let OrderByKind::Expressions(exprs) = &ob.kind else {
        return Vec::new();
    };
    exprs
        .iter()
        .map(|o| {
            let name = format_order_by_expr(&o.expr);
            let asc = o.options.asc.unwrap_or(true);
            (name, asc)
        })
        .collect()
}

fn format_order_by_expr(expr: &Expr) -> String {
    match expr {
        Expr::Identifier(ident) => ident.value.clone(),
        Expr::Function(func) => {
            let name = func.name.to_string().to_uppercase();
            let args = format_function_args(&func.args);
            format!("{name}({args})")
        }
        other => other.to_string(),
    }
}

fn format_function_args(args: &FunctionArguments) -> String {
    match args {
        FunctionArguments::None => String::new(),
        FunctionArguments::List(list) => list
            .args
            .iter()
            .map(|a| match a {
                FunctionArg::Unnamed(FunctionArgExpr::Wildcard) => "*".to_string(),
                FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Identifier(id))) => {
                    id.value.clone()
                }
                other => other.to_string(),
            })
            .collect::<Vec<_>>()
            .join(", "),
        FunctionArguments::Subquery(_) => String::new(),
    }
}

fn extract_limit_value(clause: &Option<sqlparser::ast::LimitClause>) -> Option<usize> {
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

// --- Filter Extraction ---

#[derive(Default)]
struct ExtractedFilters {
    events: Vec<String>,
    from_date: Option<String>,
    to_date: Option<String>,
    remaining: Option<Expression>,
}

fn extract_filters(expr: &Expression, filters: &mut ExtractedFilters) {
    match expr {
        Expression::And(left, right) => {
            let mut left_f = ExtractedFilters::default();
            let mut right_f = ExtractedFilters::default();
            extract_filters(left, &mut left_f);
            extract_filters(right, &mut right_f);
            filters.events.extend(left_f.events);
            filters.events.extend(right_f.events);
            if let Some(fd) = left_f.from_date {
                filters.from_date = Some(fd);
            }
            if let Some(fd) = right_f.from_date {
                filters.from_date = Some(fd);
            }
            if let Some(td) = left_f.to_date {
                filters.to_date = Some(td);
            }
            if let Some(td) = right_f.to_date {
                filters.to_date = Some(td);
            }
            let combined = combine_and(left_f.remaining, right_f.remaining);
            filters.remaining = combine_and(filters.remaining.take(), combined);
        }
        Expression::Comparison(col, CompOp::Eq, SQLLiteral::String(s))
            if col.to_lowercase() == "event" =>
        {
            filters.events.push(s.clone());
        }
        Expression::InList(col, values) if col.to_lowercase() == "event" => {
            for v in values {
                if let SQLLiteral::String(s) = v {
                    filters.events.push(s.clone());
                }
            }
        }
        Expression::Comparison(col, op, val) if col.to_lowercase() == "time" => {
            if let Some(date_str) = extract_date_string(val) {
                match op {
                    CompOp::Gte | CompOp::Gt | CompOp::Eq => {
                        filters.from_date = Some(date_str);
                    }
                    CompOp::Lte | CompOp::Lt => {
                        filters.to_date = Some(date_str);
                    }
                    CompOp::Neq => {}
                }
            } else {
                filters.remaining = combine_and(filters.remaining.take(), Some(expr.clone()));
            }
        }
        _ => {
            filters.remaining = combine_and(filters.remaining.take(), Some(expr.clone()));
        }
    }
}

fn combine_and(a: Option<Expression>, b: Option<Expression>) -> Option<Expression> {
    match (a, b) {
        (None, None) => None,
        (Some(x), None) | (None, Some(x)) => Some(x),
        (Some(x), Some(y)) => Some(Expression::And(Box::new(x), Box::new(y))),
    }
}

fn extract_date_string(lit: &SQLLiteral) -> Option<String> {
    if let SQLLiteral::String(s) = lit {
        let date_only: String = s.chars().take(10).collect();
        if date_only.len() == 10 {
            let chars: Vec<char> = date_only.chars().collect();
            let valid = chars[..4].iter().all(|c| c.is_ascii_digit())
                && chars[4] == '-'
                && chars[5..7].iter().all(|c| c.is_ascii_digit())
                && chars[7] == '-'
                && chars[8..10].iter().all(|c| c.is_ascii_digit());
            if valid {
                return Some(date_only);
            }
        }
    }
    None
}

// --- Mixpanel WHERE Expression Builder ---

pub fn build_mixpanel_where(expr: &Expression) -> String {
    match expr {
        Expression::Comparison(col, op, val) => {
            let prop = mixpanel_property_ref(col);
            let mp_op = mixpanel_op(*op);
            let mp_val = mixpanel_literal(val);
            format!("{prop} {mp_op} {mp_val}")
        }
        Expression::And(a, b) => {
            format!(
                "({}) and ({})",
                build_mixpanel_where(a),
                build_mixpanel_where(b)
            )
        }
        Expression::Or(a, b) => {
            format!(
                "({}) or ({})",
                build_mixpanel_where(a),
                build_mixpanel_where(b)
            )
        }
        Expression::Not(a) => {
            format!("not ({})", build_mixpanel_where(a))
        }
        Expression::IsNull(col) => {
            format!("{} == undefined", mixpanel_property_ref(col))
        }
        Expression::IsNotNull(col) => {
            format!("{} != undefined", mixpanel_property_ref(col))
        }
        Expression::Like(col, pattern) => {
            let regex_pattern = pattern.replace('%', ".*").replace('_', ".");
            format!(
                "regexMatch({}, \"{}\")",
                mixpanel_property_ref(col),
                regex_pattern
            )
        }
        Expression::InList(col, values) => {
            let prop = mixpanel_property_ref(col);
            let parts: Vec<String> = values
                .iter()
                .map(|v| format!("{prop} == {}", mixpanel_literal(v)))
                .collect();
            format!("({})", parts.join(" or "))
        }
    }
}

fn mixpanel_property_ref(col: &str) -> String {
    let reserved = ["event", "time", "distinct_id"];
    if reserved.contains(&col.to_lowercase().as_str()) {
        return col.to_lowercase();
    }
    format!("properties[\"{col}\"]")
}

fn mixpanel_op(op: CompOp) -> &'static str {
    match op {
        CompOp::Eq => "==",
        CompOp::Neq => "!=",
        CompOp::Lt => "<",
        CompOp::Gt => ">",
        CompOp::Lte => "<=",
        CompOp::Gte => ">=",
    }
}

fn mixpanel_literal(lit: &SQLLiteral) -> String {
    match lit {
        SQLLiteral::String(s) => format!("\"{s}\""),
        SQLLiteral::Integer(i) => i.to_string(),
        SQLLiteral::Double(d) => d.to_string(),
        SQLLiteral::Boolean(b) => if *b { "true" } else { "false" }.to_string(),
        SQLLiteral::Null => "undefined".to_string(),
    }
}

// --- Client-side Evaluation ---

pub fn evaluate(expr: &Expression, row: &BTreeMap<String, QueryValue>) -> bool {
    match expr {
        Expression::Comparison(col, op, lit) => {
            let Some(val) = row.get(col.as_str()) else {
                return false;
            };
            compare_value(val, *op, lit)
        }
        Expression::And(a, b) => evaluate(a, row) && evaluate(b, row),
        Expression::Or(a, b) => evaluate(a, row) || evaluate(b, row),
        Expression::Not(a) => !evaluate(a, row),
        Expression::IsNull(col) => match row.get(col.as_str()) {
            None | Some(QueryValue::Null) => true,
            _ => false,
        },
        Expression::IsNotNull(col) => match row.get(col.as_str()) {
            None | Some(QueryValue::Null) => false,
            _ => true,
        },
        Expression::Like(col, pattern) => {
            let Some(QueryValue::Text(s)) = row.get(col.as_str()) else {
                return false;
            };
            match_like(s, pattern)
        }
        Expression::InList(col, values) => {
            let Some(val) = row.get(col.as_str()) else {
                return false;
            };
            values.iter().any(|lit| compare_value(val, CompOp::Eq, lit))
        }
    }
}

fn match_like(text: &str, pattern: &str) -> bool {
    let t: Vec<char> = text.to_lowercase().chars().collect();
    let p: Vec<char> = pattern.to_lowercase().chars().collect();
    let (mut ti, mut pi) = (0usize, 0usize);
    let (mut star_pi, mut star_ti): (Option<usize>, usize) = (None, 0);

    while ti < t.len() {
        if pi < p.len() && p[pi] == '%' {
            star_pi = Some(pi);
            star_ti = ti;
            pi += 1;
        } else if pi < p.len() && (p[pi] == '_' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if let Some(sp) = star_pi {
            pi = sp + 1;
            star_ti += 1;
            ti = star_ti;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '%' {
        pi += 1;
    }
    pi == p.len()
}

fn compare_value(val: &QueryValue, op: CompOp, literal: &SQLLiteral) -> bool {
    match (val, literal) {
        (QueryValue::Text(s), SQLLiteral::String(ls)) => compare_ord(s.as_str(), ls.as_str(), op),
        (QueryValue::Int(i), SQLLiteral::Integer(li)) => compare_ord(i, li, op),
        (QueryValue::Int(i), SQLLiteral::Double(ld)) => compare_ord(&(*i as f64), ld, op),
        (QueryValue::Double(d), SQLLiteral::Double(ld)) => compare_ord(d, ld, op),
        (QueryValue::Double(d), SQLLiteral::Integer(li)) => compare_ord(d, &(*li as f64), op),
        (QueryValue::Bool(b), SQLLiteral::Boolean(lb)) => match op {
            CompOp::Eq => b == lb,
            CompOp::Neq => b != lb,
            _ => false,
        },
        (QueryValue::Null, SQLLiteral::Null) => op == CompOp::Eq,
        (_, SQLLiteral::Null) => op == CompOp::Neq,
        _ => {
            let ls = val.display_string();
            let rs = match literal {
                SQLLiteral::String(s) => s.clone(),
                SQLLiteral::Integer(i) => i.to_string(),
                SQLLiteral::Double(d) => d.to_string(),
                SQLLiteral::Boolean(b) => b.to_string(),
                SQLLiteral::Null => String::new(),
            };
            compare_ord(ls.as_str(), rs.as_str(), op)
        }
    }
}

fn compare_ord<T: PartialOrd + ?Sized>(a: &T, b: &T, op: CompOp) -> bool {
    match op {
        CompOp::Eq => a == b,
        CompOp::Neq => a != b,
        CompOp::Lt => a < b,
        CompOp::Gt => a > b,
        CompOp::Lte => a <= b,
        CompOp::Gte => a >= b,
    }
}

// --- Helpers ---

pub fn strip_quotes(s: &str) -> String {
    if (s.starts_with('\'') && s.ends_with('\''))
        || (s.starts_with('"') && s.ends_with('"'))
        || (s.starts_with('`') && s.ends_with('`'))
    {
        return s[1..s.len() - 1].to_string();
    }
    s.to_string()
}

// --- Column name resolution ---

pub fn resolve_column_names(query: &MixpanelQuery) -> Vec<String> {
    let mut names = Vec::new();
    for col in &query.columns {
        match col {
            ColumnSelection::All => {
                return vec!["event".into(), "time".into(), "distinct_id".into()];
            }
            ColumnSelection::Named(n) => names.push(n.clone()),
            ColumnSelection::Aggregation(func, c, alias) => {
                let name = alias.clone().unwrap_or_else(|| {
                    format!("{}({})", func.label(), c.as_deref().unwrap_or("*"))
                });
                names.push(name);
            }
        }
    }
    if names.is_empty() {
        vec!["event".into(), "time".into(), "distinct_id".into()]
    } else {
        names
    }
}

// Mixpanel's raw-event export requires an explicit from_date/to_date window, so
// "unlimited" is expressed as the earliest date any project could hold data. It
// predates Mixpanel itself (founded 2009), so every event is captured unless the
// query narrows the range with a WHERE clause on `time`.
pub const EARLIEST_EXPORT_DATE: &str = "2008-01-01";

pub fn default_from_date() -> String {
    EARLIEST_EXPORT_DATE.to_string()
}

pub fn default_to_date() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

#[cfg(test)]
mod tests;
