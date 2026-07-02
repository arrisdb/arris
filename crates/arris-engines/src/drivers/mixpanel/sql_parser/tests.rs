use super::*;
use super::super::constants::EARLIEST_EXPORT_DATE;
use std::collections::BTreeMap;

// --- Basic Parsing ---

#[test]
fn parse_select_star() {
    let q = parse("SELECT * FROM events").unwrap();
    assert_eq!(q.columns, vec![ColumnSelection::All]);
    assert!(q.event_filter.is_empty());
    assert!(q.where_expression.is_none());
}

#[test]
fn parse_select_named_columns() {
    let q = parse("SELECT event, distinct_id FROM events").unwrap();
    assert_eq!(
        q.columns,
        vec![
            ColumnSelection::Named("event".into()),
            ColumnSelection::Named("distinct_id".into()),
        ]
    );
}

#[test]
fn parse_select_count_star() {
    let q = parse("SELECT COUNT(*) FROM events").unwrap();
    assert_eq!(
        q.columns,
        vec![ColumnSelection::Aggregation(AggFunc::Count, None, None)]
    );
}

#[test]
fn parse_select_count_with_alias() {
    let q = parse("SELECT COUNT(*) AS total FROM events").unwrap();
    assert_eq!(
        q.columns,
        vec![ColumnSelection::Aggregation(
            AggFunc::Count,
            None,
            Some("total".into())
        )]
    );
}

#[test]
fn parse_select_aggregation_with_column() {
    let q = parse("SELECT SUM(amount) FROM events").unwrap();
    assert_eq!(
        q.columns,
        vec![ColumnSelection::Aggregation(
            AggFunc::Sum,
            Some("amount".into()),
            None
        )]
    );
}

// --- Error Cases ---

#[test]
fn parse_empty_query() {
    assert!(matches!(parse(""), Err(ParseError::EmptyQuery)));
}

#[test]
fn parse_not_a_select() {
    assert!(matches!(parse("INSERT INTO events"), Err(ParseError::NotASelect)));
}

#[test]
fn parse_missing_from() {
    assert!(matches!(parse("SELECT *"), Err(ParseError::MissingFrom)));
}

#[test]
fn parse_invalid_table() {
    let err = parse("SELECT * FROM users").unwrap_err();
    assert!(matches!(err, ParseError::InvalidTable(_)));
}

// --- WHERE Clause ---

#[test]
fn parse_event_filter_eq() {
    let q = parse("SELECT * FROM events WHERE event = 'Login'").unwrap();
    assert_eq!(q.event_filter, vec!["Login"]);
    assert!(q.where_expression.is_none());
}

#[test]
fn parse_event_filter_in() {
    let q = parse("SELECT * FROM events WHERE event IN ('Login', 'Signup')").unwrap();
    assert_eq!(q.event_filter, vec!["Login", "Signup"]);
}

#[test]
fn parse_time_filter() {
    let q = parse("SELECT * FROM events WHERE time >= '2024-01-01' AND time <= '2024-01-31'")
        .unwrap();
    assert_eq!(q.from_date, "2024-01-01");
    assert_eq!(q.to_date, "2024-01-31");
    assert!(q.where_expression.is_none());
}

#[test]
fn parse_combined_event_and_time_filter() {
    let q = parse(
        "SELECT * FROM events WHERE event = 'Login' AND time >= '2024-01-01' AND time <= '2024-01-31'"
    ).unwrap();
    assert_eq!(q.event_filter, vec!["Login"]);
    assert_eq!(q.from_date, "2024-01-01");
    assert_eq!(q.to_date, "2024-01-31");
    assert!(q.where_expression.is_none());
}

#[test]
fn parse_remaining_where_expression() {
    let q =
        parse("SELECT * FROM events WHERE event = 'Login' AND browser = 'Chrome'").unwrap();
    assert_eq!(q.event_filter, vec!["Login"]);
    assert!(q.where_expression.is_some());
}

#[test]
fn parse_or_expression() {
    let q = parse("SELECT * FROM events WHERE browser = 'Chrome' OR browser = 'Firefox'")
        .unwrap();
    assert!(q.where_expression.is_some());
}

#[test]
fn parse_not_expression() {
    let q = parse("SELECT * FROM events WHERE NOT browser = 'IE'").unwrap();
    assert!(q.where_expression.is_some());
}

#[test]
fn parse_is_null() {
    let q = parse("SELECT * FROM events WHERE city IS NULL").unwrap();
    assert!(matches!(
        q.where_expression,
        Some(Expression::IsNull(ref c)) if c == "city"
    ));
}

#[test]
fn parse_is_not_null() {
    let q = parse("SELECT * FROM events WHERE city IS NOT NULL").unwrap();
    assert!(matches!(
        q.where_expression,
        Some(Expression::IsNotNull(ref c)) if c == "city"
    ));
}

#[test]
fn parse_like() {
    let q = parse("SELECT * FROM events WHERE city LIKE '%York%'").unwrap();
    assert!(matches!(
        q.where_expression,
        Some(Expression::Like(ref c, ref p)) if c == "city" && p == "%York%"
    ));
}

#[test]
fn parse_comparison_operators() {
    let q = parse("SELECT * FROM events WHERE amount > 100").unwrap();
    assert!(matches!(
        q.where_expression,
        Some(Expression::Comparison(ref c, CompOp::Gt, SQLLiteral::Integer(100))) if c == "amount"
    ));
}

// --- GROUP BY / ORDER BY / LIMIT ---

#[test]
fn parse_group_by() {
    let q = parse("SELECT event, COUNT(*) FROM events GROUP BY event").unwrap();
    assert_eq!(q.group_by, vec!["event"]);
}

#[test]
fn parse_order_by_asc() {
    let q = parse("SELECT * FROM events ORDER BY event ASC").unwrap();
    assert_eq!(q.order_by, vec![("event".into(), true)]);
}

#[test]
fn parse_order_by_desc() {
    let q = parse("SELECT * FROM events ORDER BY event DESC").unwrap();
    assert_eq!(q.order_by, vec![("event".into(), false)]);
}

#[test]
fn parse_limit() {
    let q = parse("SELECT * FROM events LIMIT 10").unwrap();
    assert_eq!(q.limit, Some(10));
}

#[test]
fn parse_full_query() {
    let q = parse(
        "SELECT event, COUNT(*) AS cnt FROM events WHERE time >= '2024-01-01' GROUP BY event ORDER BY cnt DESC LIMIT 5"
    ).unwrap();
    assert_eq!(q.from_date, "2024-01-01");
    assert_eq!(q.group_by, vec!["event"]);
    assert_eq!(q.order_by, vec![("cnt".into(), false)]);
    assert_eq!(q.limit, Some(5));
}

// --- Mixpanel WHERE Builder ---

#[test]
fn build_where_comparison() {
    let expr = Expression::Comparison(
        "browser".into(),
        CompOp::Eq,
        SQLLiteral::String("Chrome".into()),
    );
    assert_eq!(
        build_mixpanel_where(&expr),
        r#"properties["browser"] == "Chrome""#
    );
}

#[test]
fn build_where_reserved_property() {
    let expr = Expression::Comparison(
        "event".into(),
        CompOp::Eq,
        SQLLiteral::String("Login".into()),
    );
    assert_eq!(build_mixpanel_where(&expr), r#"event == "Login""#);
}

#[test]
fn build_where_and() {
    let expr = Expression::And(
        Box::new(Expression::Comparison(
            "a".into(),
            CompOp::Eq,
            SQLLiteral::Integer(1),
        )),
        Box::new(Expression::Comparison(
            "b".into(),
            CompOp::Gt,
            SQLLiteral::Integer(2),
        )),
    );
    let result = build_mixpanel_where(&expr);
    assert!(result.contains("and"));
}

#[test]
fn build_where_is_null() {
    let expr = Expression::IsNull("city".into());
    assert_eq!(
        build_mixpanel_where(&expr),
        r#"properties["city"] == undefined"#
    );
}

#[test]
fn build_where_like() {
    let expr = Expression::Like("name".into(), "%test%".into());
    assert_eq!(
        build_mixpanel_where(&expr),
        r#"regexMatch(properties["name"], ".*test.*")"#
    );
}

#[test]
fn build_where_in_list() {
    let expr = Expression::InList(
        "browser".into(),
        vec![
            SQLLiteral::String("Chrome".into()),
            SQLLiteral::String("Firefox".into()),
        ],
    );
    let result = build_mixpanel_where(&expr);
    assert!(result.contains("or"));
    assert!(result.contains("Chrome"));
    assert!(result.contains("Firefox"));
}

// --- Client-side Evaluation ---

#[test]
fn evaluate_comparison_eq() {
    let mut row = BTreeMap::new();
    row.insert("browser".into(), QueryValue::Text("Chrome".into()));
    let expr = Expression::Comparison(
        "browser".into(),
        CompOp::Eq,
        SQLLiteral::String("Chrome".into()),
    );
    assert!(evaluate(&expr, &row));
}

#[test]
fn evaluate_comparison_neq() {
    let mut row = BTreeMap::new();
    row.insert("browser".into(), QueryValue::Text("Firefox".into()));
    let expr = Expression::Comparison(
        "browser".into(),
        CompOp::Neq,
        SQLLiteral::String("Chrome".into()),
    );
    assert!(evaluate(&expr, &row));
}

#[test]
fn evaluate_numeric_comparison() {
    let mut row = BTreeMap::new();
    row.insert("amount".into(), QueryValue::Int(150));
    let expr = Expression::Comparison("amount".into(), CompOp::Gt, SQLLiteral::Integer(100));
    assert!(evaluate(&expr, &row));
}

#[test]
fn evaluate_and() {
    let mut row = BTreeMap::new();
    row.insert("a".into(), QueryValue::Int(1));
    row.insert("b".into(), QueryValue::Int(2));
    let expr = Expression::And(
        Box::new(Expression::Comparison(
            "a".into(),
            CompOp::Eq,
            SQLLiteral::Integer(1),
        )),
        Box::new(Expression::Comparison(
            "b".into(),
            CompOp::Eq,
            SQLLiteral::Integer(2),
        )),
    );
    assert!(evaluate(&expr, &row));
}

#[test]
fn evaluate_or() {
    let mut row = BTreeMap::new();
    row.insert("a".into(), QueryValue::Int(1));
    let expr = Expression::Or(
        Box::new(Expression::Comparison(
            "a".into(),
            CompOp::Eq,
            SQLLiteral::Integer(1),
        )),
        Box::new(Expression::Comparison(
            "a".into(),
            CompOp::Eq,
            SQLLiteral::Integer(2),
        )),
    );
    assert!(evaluate(&expr, &row));
}

#[test]
fn evaluate_not() {
    let mut row = BTreeMap::new();
    row.insert("a".into(), QueryValue::Int(1));
    let expr = Expression::Not(Box::new(Expression::Comparison(
        "a".into(),
        CompOp::Eq,
        SQLLiteral::Integer(2),
    )));
    assert!(evaluate(&expr, &row));
}

#[test]
fn evaluate_is_null_true() {
    let row = BTreeMap::new();
    let expr = Expression::IsNull("missing".into());
    assert!(evaluate(&expr, &row));
}

#[test]
fn evaluate_is_null_false() {
    let mut row = BTreeMap::new();
    row.insert("present".into(), QueryValue::Text("value".into()));
    let expr = Expression::IsNull("present".into());
    assert!(!evaluate(&expr, &row));
}

#[test]
fn evaluate_like_match() {
    let mut row = BTreeMap::new();
    row.insert("city".into(), QueryValue::Text("New York".into()));
    let expr = Expression::Like("city".into(), "%York".into());
    assert!(evaluate(&expr, &row));
}

#[test]
fn evaluate_like_no_match() {
    let mut row = BTreeMap::new();
    row.insert("city".into(), QueryValue::Text("London".into()));
    let expr = Expression::Like("city".into(), "%York".into());
    assert!(!evaluate(&expr, &row));
}

#[test]
fn evaluate_in_list() {
    let mut row = BTreeMap::new();
    row.insert("browser".into(), QueryValue::Text("Chrome".into()));
    let expr = Expression::InList(
        "browser".into(),
        vec![
            SQLLiteral::String("Chrome".into()),
            SQLLiteral::String("Firefox".into()),
        ],
    );
    assert!(evaluate(&expr, &row));
}

#[test]
fn evaluate_bool_comparison() {
    let mut row = BTreeMap::new();
    row.insert("active".into(), QueryValue::Bool(true));
    let expr = Expression::Comparison("active".into(), CompOp::Eq, SQLLiteral::Boolean(true));
    assert!(evaluate(&expr, &row));
}

#[test]
fn evaluate_null_comparison() {
    let mut row = BTreeMap::new();
    row.insert("val".into(), QueryValue::Null);
    let expr = Expression::Comparison("val".into(), CompOp::Eq, SQLLiteral::Null);
    assert!(evaluate(&expr, &row));
}

// --- LIKE Pattern Matcher ---

#[test]
fn like_exact_match() {
    assert!(match_like("hello", "hello"));
}

#[test]
fn like_percent_prefix() {
    assert!(match_like("hello world", "%world"));
}

#[test]
fn like_percent_suffix() {
    assert!(match_like("hello world", "hello%"));
}

#[test]
fn like_percent_both() {
    assert!(match_like("hello world", "%lo wo%"));
}

#[test]
fn like_underscore() {
    assert!(match_like("cat", "c_t"));
    assert!(!match_like("cart", "c_t"));
}

#[test]
fn like_case_insensitive() {
    assert!(match_like("Hello", "hello"));
    assert!(match_like("HELLO", "%ello"));
}

// --- Column Name Resolution ---

#[test]
fn resolve_column_names_star() {
    let q = parse("SELECT * FROM events").unwrap();
    let names = resolve_column_names(&q);
    assert_eq!(names, vec!["event", "time", "distinct_id"]);
}

#[test]
fn resolve_column_names_named() {
    let q = parse("SELECT event, browser FROM events").unwrap();
    let names = resolve_column_names(&q);
    assert_eq!(names, vec!["event", "browser"]);
}

#[test]
fn resolve_column_names_aggregation() {
    let q = parse("SELECT COUNT(*) FROM events").unwrap();
    let names = resolve_column_names(&q);
    assert_eq!(names, vec!["COUNT(*)"]);
}

#[test]
fn resolve_column_names_aggregation_with_alias() {
    let q = parse("SELECT COUNT(*) AS total FROM events").unwrap();
    let names = resolve_column_names(&q);
    assert_eq!(names, vec!["total"]);
}

#[test]
fn parse_order_by_count_star_desc() {
    let q = parse("SELECT $city, COUNT(*) FROM events GROUP BY $city ORDER BY COUNT(*) DESC").unwrap();
    assert_eq!(q.order_by, vec![("COUNT(*)".into(), false)]);
}

#[test]
fn parse_order_by_sum_column_asc() {
    let q = parse("SELECT event, SUM(amount) FROM events GROUP BY event ORDER BY SUM(amount) ASC").unwrap();
    assert_eq!(q.order_by, vec![("SUM(amount)".into(), true)]);
}

#[test]
fn parse_order_by_agg_then_limit() {
    let q = parse("SELECT $city, COUNT(*) FROM events GROUP BY $city ORDER BY COUNT(*) DESC LIMIT 10").unwrap();
    assert_eq!(q.order_by, vec![("COUNT(*)".into(), false)]);
    assert_eq!(q.limit, Some(10));
}

// --- Default Dates ---

#[test]
fn default_dates_format() {
    let from = default_from_date();
    let to = default_to_date();
    assert_eq!(from.len(), 10);
    assert_eq!(to.len(), 10);
    assert!(from.contains('-'));
    assert!(to.contains('-'));
}

#[test]
fn schema_sample_window_is_valid_and_within_floor() {
    let from = schema_sample_from_date();
    assert_eq!(from.len(), 10);
    assert!(from.contains('-'));
    // The sampling window is recent, so it must never precede the export floor.
    assert!(from.as_str() > EARLIEST_EXPORT_DATE);
}

#[test]
fn default_from_date_is_unlimited() {
    // No WHERE time filter -> the range starts at the earliest export date, not a
    // rolling 30-day window, so the whole project history is queryable.
    assert_eq!(default_from_date(), EARLIEST_EXPORT_DATE);
    let q = parse("SELECT * FROM events").unwrap();
    assert_eq!(q.from_date, EARLIEST_EXPORT_DATE);
    assert_eq!(q.to_date, default_to_date());
}

// --- Strip Quotes ---

#[test]
fn strip_single_quotes() {
    assert_eq!(strip_quotes("'hello'"), "hello");
}

#[test]
fn strip_double_quotes() {
    assert_eq!(strip_quotes("\"hello\""), "hello");
}

#[test]
fn strip_no_quotes() {
    assert_eq!(strip_quotes("hello"), "hello");
}

// --- Semicolon Handling ---

#[test]
fn parse_trailing_semicolon() {
    let q = parse("SELECT * FROM events;").unwrap();
    assert_eq!(q.columns, vec![ColumnSelection::All]);
}

#[test]
fn parse_limit_with_semicolon() {
    let q = parse("SELECT * FROM events LIMIT 10;").unwrap();
    assert_eq!(q.limit, Some(10));
}

#[test]
fn parse_trailing_semicolon_and_whitespace() {
    let q = parse("  SELECT * FROM events LIMIT 5 ;  ").unwrap();
    assert_eq!(q.limit, Some(5));
}

#[test]
fn parse_no_limit_default_is_none() {
    let q = parse("SELECT * FROM events").unwrap();
    assert_eq!(q.limit, None);
}
