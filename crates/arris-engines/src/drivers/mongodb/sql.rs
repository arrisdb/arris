use serde_json::{Map, Value, json};

use super::parser::{Chain, MongoRequest, Verb};

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum SqlError {
    #[error("empty query")]
    Empty,
    #[error("expected {0}")]
    Expected(&'static str),
    #[error("unexpected token '{0}'")]
    Unexpected(String),
    #[error("unsupported SQL: {0}")]
    Unsupported(String),
}

#[derive(Debug, Clone, PartialEq)]
struct SelectQuery {
    distinct: bool,
    database: Option<String>,
    collection: String,
    select: Vec<SelectItem>,
    filter: Option<Expr>,
    group_by: Vec<String>,
    having: Option<Expr>,
    order_by: Vec<OrderBy>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
struct SelectItem {
    expr: SelectExpr,
    alias: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
enum SelectExpr {
    Star,
    Field(FieldRef),
    Aggregate(AggFunc, Option<String>),
}

/// A selected field path with an optional PostgreSQL-style array subscript,
/// e.g. `content.sample_responses`, `tags[1]`, `scores[1:3]`.
#[derive(Debug, Clone, PartialEq)]
struct FieldRef {
    path: String,
    subscript: Option<Subscript>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Subscript {
    /// 1-based element index (Postgres semantics).
    Index(i64),
    /// 1-based inclusive slice `[lo:hi]` (Postgres semantics).
    Slice(i64, i64),
}

impl FieldRef {
    /// A dotted path or a subscripted path cannot be expressed as a plain
    /// Mongo find projection without nesting / losing the element, so it must
    /// be lifted via an aggregation `$project`.
    fn is_complex(&self) -> bool {
        self.subscript.is_some() || self.path.contains('.')
    }

    /// The column name shown to the user — the original source text.
    fn source_text(&self) -> String {
        match self.subscript {
            None => self.path.clone(),
            Some(Subscript::Index(i)) => format!("{}[{i}]", self.path),
            Some(Subscript::Slice(lo, hi)) => format!("{}[{lo}:{hi}]", self.path),
        }
    }

    /// The Mongo aggregation expression that yields this field's value.
    fn mongo_expr(&self) -> Value {
        let field = format!("${}", self.path);
        match self.subscript {
            None => json!(field),
            // Postgres subscripts are 1-based; Mongo `$arrayElemAt` is 0-based.
            Some(Subscript::Index(i)) => json!({ "$arrayElemAt": [field, i - 1] }),
            // Postgres `[lo:hi]` is inclusive; translate to a `$slice` of
            // `(hi - lo + 1)` elements starting at `lo - 1`.
            Some(Subscript::Slice(lo, hi)) => {
                let count = (hi - lo + 1).max(0);
                json!({ "$slice": [field, lo - 1, count] })
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AggFunc {
    Count,
    Sum,
    Avg,
    Min,
    Max,
}

#[derive(Debug, Clone, PartialEq)]
struct OrderBy {
    field: String,
    desc: bool,
}

#[derive(Debug, Clone, PartialEq)]
enum Expr {
    Compare(String, CompOp, Literal),
    And(Box<Expr>, Box<Expr>),
    Or(Box<Expr>, Box<Expr>),
    Not(Box<Expr>),
    IsNull(String),
    IsNotNull(String),
    Like(String, String),
    NotLike(String, String),
    In(String, Vec<Literal>),
    NotIn(String, Vec<Literal>),
    Between(String, Literal, Literal),
    NotBetween(String, Literal, Literal),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CompOp {
    Eq,
    Ne,
    Lt,
    Gt,
    Le,
    Ge,
}

#[derive(Debug, Clone, PartialEq)]
enum Literal {
    String(String),
    Integer(i64),
    Double(f64),
    Bool(bool),
    Null,
}

pub fn parse(input: &str) -> Result<MongoRequest, SqlError> {
    let mut tokens = tokenize(input.trim().trim_end_matches(';').trim())?;
    if tokens.is_empty() {
        return Err(SqlError::Empty);
    }
    tokens.push("<eof>".into());
    let mut p = Parser { tokens, pos: 0 };
    match p.peek().to_uppercase().as_str() {
        "SELECT" => translate(p.parse_select()?),
        "INSERT" => p.parse_insert(),
        "UPDATE" => p.parse_update(),
        "DELETE" => p.parse_delete(),
        other => Err(SqlError::Unsupported(format!(
            "unsupported statement '{other}'"
        ))),
    }
}

fn translate(q: SelectQuery) -> Result<MongoRequest, SqlError> {
    let filter = q
        .filter
        .as_ref()
        .map(expr_to_mongo)
        .transpose()?
        .unwrap_or_else(|| json!({}));

    if is_simple_count(&q) {
        return Ok(MongoRequest {
            database: q.database,
            collection: q.collection,
            verb: Verb::CountDocuments,
            args: vec![filter],
            chain: Vec::new(),
        });
    }

    let uses_aggregate = q.distinct
        || !q.group_by.is_empty()
        || q.having.is_some()
        || q.select
            .iter()
            .any(|i| matches!(i.expr, SelectExpr::Aggregate(_, _)))
        || q.select
            .iter()
            .any(|i| matches!((&i.expr, &i.alias), (SelectExpr::Field(f), Some(a)) if a != &f.path))
        || needs_lift(&q.select);

    if !uses_aggregate {
        let mut args = Vec::new();
        if !filter.as_object().is_some_and(|o| o.is_empty()) {
            args.push(filter);
        }
        if let Some(projection) = find_projection(&q.select) {
            if args.is_empty() {
                args.push(json!({}));
            }
            args.push(Value::Object(projection));
        }
        return Ok(MongoRequest {
            database: q.database,
            collection: q.collection,
            verb: Verb::Find,
            args,
            chain: find_chain(&q.order_by, q.limit, q.offset),
        });
    }

    let pipeline = aggregate_pipeline(&q, filter)?;
    Ok(MongoRequest {
        database: q.database,
        collection: q.collection,
        verb: Verb::Aggregate,
        args: vec![Value::Array(pipeline)],
        chain: Vec::new(),
    })
}

fn is_simple_count(q: &SelectQuery) -> bool {
    q.select.len() == 1
        && matches!(
            q.select[0].expr,
            SelectExpr::Aggregate(AggFunc::Count, None)
        )
        && !q.distinct
        && q.group_by.is_empty()
        && q.having.is_none()
        && q.order_by.is_empty()
        && q.limit.is_none()
        && q.offset.is_none()
}

/// True when an explicit-column SELECT (no `*`) references a nested path or an
/// array subscript, which must be lifted to a flat column via an aggregation
/// `$project` (a plain find projection would re-nest or drop the value).
fn needs_lift(select: &[SelectItem]) -> bool {
    let has_star = select.iter().any(|i| matches!(i.expr, SelectExpr::Star));
    !has_star
        && select
            .iter()
            .any(|i| matches!(&i.expr, SelectExpr::Field(f) if f.is_complex()))
}

fn find_projection(select: &[SelectItem]) -> Option<Map<String, Value>> {
    if select.iter().any(|i| matches!(i.expr, SelectExpr::Star)) {
        return None;
    }
    let mut out = Map::new();
    let mut includes_id = false;
    for item in select {
        if let SelectExpr::Field(field) = &item.expr {
            let name = item.alias.as_deref().unwrap_or(&field.path);
            out.insert(name.to_owned(), json!(1));
            if name == "_id" {
                includes_id = true;
            }
        }
    }
    if !includes_id {
        out.insert("_id".into(), json!(0));
    }
    Some(out)
}

fn find_chain(order_by: &[OrderBy], limit: Option<i64>, offset: Option<i64>) -> Vec<Chain> {
    let mut chain = Vec::new();
    if !order_by.is_empty() {
        let mut sort = Map::new();
        for o in order_by {
            sort.insert(o.field.clone(), json!(if o.desc { -1 } else { 1 }));
        }
        chain.push(Chain::Sort(Value::Object(sort)));
    }
    if let Some(offset) = offset {
        chain.push(Chain::Skip(offset.max(0)));
    }
    if let Some(limit) = limit {
        chain.push(Chain::Limit(limit));
    }
    chain
}

fn aggregate_pipeline(q: &SelectQuery, filter: Value) -> Result<Vec<Value>, SqlError> {
    let mut pipeline = Vec::new();
    if !filter.as_object().is_some_and(|o| o.is_empty()) {
        pipeline.push(json!({ "$match": filter }));
    }

    let has_aggregate = q
        .select
        .iter()
        .any(|i| matches!(i.expr, SelectExpr::Aggregate(_, _)));
    let has_star = q.select.iter().any(|i| matches!(i.expr, SelectExpr::Star));

    // Explicit-column projection without grouping/aggregation: lift each
    // selected path (possibly nested or subscripted) to a flat top-level
    // column. `$project` interprets dotted keys as nested paths, so reshape
    // with `$arrayToObject`, whose keys are literal strings — `sort`/`skip`/
    // `limit` run first because they reference the original document fields.
    if !q.distinct && q.group_by.is_empty() && !has_aggregate && !has_star {
        push_sort_skip_limit(&mut pipeline, q);
        pipeline.push(json!({
            "$replaceRoot": { "newRoot": { "$arrayToObject": lift_pairs(&q.select) } }
        }));
        return Ok(pipeline);
    }

    if q.distinct {
        let field = match q.select.as_slice() {
            [
                SelectItem {
                    expr: SelectExpr::Field(field),
                    ..
                },
            ] => &field.path,
            _ => return Err(SqlError::Unsupported("DISTINCT supports one field".into())),
        };
        pipeline.push(json!({ "$group": { "_id": format!("${field}") } }));
        pipeline.push(json!({ "$project": { "_id": 0, field: "$_id" } }));
    } else {
        let mut group = Map::new();
        group.insert("_id".into(), group_id(&q.group_by));
        for item in &q.select {
            if let SelectExpr::Aggregate(func, field) = &item.expr {
                let name = item.output_name();
                group.insert(name, accumulator(*func, field.as_deref())?);
            }
        }
        pipeline.push(json!({ "$group": Value::Object(group) }));
        if let Some(having) = &q.having {
            pipeline.push(json!({ "$match": expr_to_mongo(having)? }));
        }
        pipeline.push(json!({ "$project": group_project(q) }));
    }

    push_sort_skip_limit(&mut pipeline, q);
    Ok(pipeline)
}

/// Build the `$arrayToObject` input for a flat-column lift. Each `{k, v}` pair
/// is wrapped in its own single-element array and combined with `$concatArrays`.
/// A bare array literal `[{k,v}]` is unwrapped by `$arrayToObject` to the lone
/// object when exactly one column is selected — Mongo then fails with
/// "$arrayToObject requires an array input, found: object". `$concatArrays`
/// forces the input to evaluate to an array regardless of pair count. The key
/// is the alias (if any) or the field's source text; the value is the field's
/// Mongo aggregation expression.
fn lift_pairs(select: &[SelectItem]) -> Value {
    let pairs: Vec<Value> = select
        .iter()
        .filter_map(|item| match &item.expr {
            SelectExpr::Field(f) => {
                let name = item.alias.clone().unwrap_or_else(|| f.source_text());
                Some(json!([{ "k": name, "v": f.mongo_expr() }]))
            }
            _ => None,
        })
        .collect();
    json!({ "$concatArrays": Value::Array(pairs) })
}

fn push_sort_skip_limit(pipeline: &mut Vec<Value>, q: &SelectQuery) {
    if !q.order_by.is_empty() {
        let mut sort = Map::new();
        for o in &q.order_by {
            sort.insert(o.field.clone(), json!(if o.desc { -1 } else { 1 }));
        }
        pipeline.push(json!({ "$sort": Value::Object(sort) }));
    }
    if let Some(offset) = q.offset {
        pipeline.push(json!({ "$skip": offset.max(0) }));
    }
    if let Some(limit) = q.limit {
        pipeline.push(json!({ "$limit": limit }));
    }
}

fn group_id(group_by: &[String]) -> Value {
    match group_by {
        [] => Value::Null,
        [field] => json!(format!("${field}")),
        fields => {
            let mut obj = Map::new();
            for field in fields {
                obj.insert(field.clone(), json!(format!("${field}")));
            }
            Value::Object(obj)
        }
    }
}

fn accumulator(func: AggFunc, field: Option<&str>) -> Result<Value, SqlError> {
    Ok(match func {
        AggFunc::Count => json!({ "$sum": 1 }),
        AggFunc::Sum => json!({ "$sum": dollar_field(field)? }),
        AggFunc::Avg => json!({ "$avg": dollar_field(field)? }),
        AggFunc::Min => json!({ "$min": dollar_field(field)? }),
        AggFunc::Max => json!({ "$max": dollar_field(field)? }),
    })
}

fn dollar_field(field: Option<&str>) -> Result<String, SqlError> {
    let field = field.ok_or_else(|| SqlError::Unsupported("aggregate requires a field".into()))?;
    Ok(format!("${field}"))
}

fn group_project(q: &SelectQuery) -> Value {
    let mut project = Map::new();
    project.insert("_id".into(), json!(0));
    for item in &q.select {
        match &item.expr {
            SelectExpr::Field(field) => {
                let out = item.alias.as_deref().unwrap_or(&field.path);
                if q.group_by.len() == 1 && q.group_by[0] == field.path {
                    project.insert(out.to_owned(), json!("$_id"));
                } else {
                    project.insert(out.to_owned(), json!(format!("$_id.{}", field.path)));
                }
            }
            SelectExpr::Aggregate(_, _) => {
                let out = item.output_name();
                project.insert(out.clone(), json!(format!("${out}")));
            }
            SelectExpr::Star => {}
        }
    }
    Value::Object(project)
}

impl SelectItem {
    fn output_name(&self) -> String {
        if let Some(alias) = &self.alias {
            return alias.clone();
        }
        match &self.expr {
            SelectExpr::Star => "*".into(),
            SelectExpr::Field(field) => field.source_text(),
            SelectExpr::Aggregate(func, field) => {
                let name = match func {
                    AggFunc::Count => "count",
                    AggFunc::Sum => "sum",
                    AggFunc::Avg => "avg",
                    AggFunc::Min => "min",
                    AggFunc::Max => "max",
                };
                match field {
                    Some(field) => format!("{name}_{field}"),
                    None => name.into(),
                }
            }
        }
    }
}

fn expr_to_mongo(expr: &Expr) -> Result<Value, SqlError> {
    Ok(match expr {
        Expr::Compare(field, CompOp::Eq, lit) => json!({ field: literal_value(lit) }),
        Expr::Compare(field, op, lit) => {
            json!({ field: { mongo_op(*op): literal_value(lit) } })
        }
        Expr::And(a, b) => json!({ "$and": [expr_to_mongo(a)?, expr_to_mongo(b)?] }),
        Expr::Or(a, b) => json!({ "$or": [expr_to_mongo(a)?, expr_to_mongo(b)?] }),
        Expr::Not(e) => json!({ "$nor": [expr_to_mongo(e)?] }),
        Expr::IsNull(field) => json!({ field: Value::Null }),
        Expr::IsNotNull(field) => json!({ field: { "$ne": Value::Null } }),
        Expr::Like(field, pattern) => json!({ field: { "$regex": like_regex(pattern) } }),
        Expr::NotLike(field, pattern) => {
            json!({ field: { "$not": { "$regex": like_regex(pattern) } } })
        }
        Expr::In(field, vals) => {
            json!({ field: { "$in": vals.iter().map(literal_value).collect::<Vec<_>>() } })
        }
        Expr::NotIn(field, vals) => {
            json!({ field: { "$nin": vals.iter().map(literal_value).collect::<Vec<_>>() } })
        }
        Expr::Between(field, lo, hi) => {
            json!({ field: { "$gte": literal_value(lo), "$lte": literal_value(hi) } })
        }
        Expr::NotBetween(field, lo, hi) => {
            json!({ "$or": [
                { field: { "$lt": literal_value(lo) } },
                { field: { "$gt": literal_value(hi) } },
            ] })
        }
    })
}

fn mongo_op(op: CompOp) -> &'static str {
    match op {
        CompOp::Eq => "$eq",
        CompOp::Ne => "$ne",
        CompOp::Lt => "$lt",
        CompOp::Gt => "$gt",
        CompOp::Le => "$lte",
        CompOp::Ge => "$gte",
    }
}

fn literal_value(lit: &Literal) -> Value {
    match lit {
        Literal::String(s) => json!(s),
        Literal::Integer(i) => json!(i),
        Literal::Double(f) => json!(f),
        Literal::Bool(b) => json!(b),
        Literal::Null => Value::Null,
    }
}

fn like_regex(pattern: &str) -> String {
    let mut out = String::from("^");
    for c in pattern.chars() {
        match c {
            '%' => out.push_str(".*"),
            '_' => out.push('.'),
            '.' | '+' | '*' | '?' | '^' | '$' | '(' | ')' | '[' | ']' | '{' | '}' | '|' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            other => out.push(other),
        }
    }
    out.push('$');
    out
}

struct Parser {
    tokens: Vec<String>,
    pos: usize,
}

impl Parser {
    fn parse_select(&mut self) -> Result<SelectQuery, SqlError> {
        self.expect_kw("SELECT")?;
        let distinct = self.consume_kw("DISTINCT");
        let select = self.parse_select_list()?;
        self.expect_kw("FROM")?;
        let (database, collection) = source_name(&self.parse_identifier_path()?);
        self.consume_table_alias();

        let mut filter = None;
        let mut group_by = Vec::new();
        let mut having = None;
        let mut order_by = Vec::new();
        let mut limit = None;
        let mut offset = None;

        while !self.is_eof() {
            if self.consume_kw("WHERE") {
                filter = Some(self.parse_expr()?);
            } else if self.consume_kw("GROUP") {
                self.expect_kw("BY")?;
                group_by = self.parse_identifier_list()?;
            } else if self.consume_kw("HAVING") {
                having = Some(self.parse_expr()?);
            } else if self.consume_kw("ORDER") {
                self.expect_kw("BY")?;
                order_by = self.parse_order_by()?;
            } else if self.consume_kw("LIMIT") {
                limit = Some(self.parse_i64()?);
            } else if self.consume_kw("OFFSET") {
                offset = Some(self.parse_i64()?);
            } else {
                return Err(SqlError::Unexpected(self.peek().to_owned()));
            }
        }

        Ok(SelectQuery {
            distinct,
            database,
            collection,
            select,
            filter,
            group_by,
            having,
            order_by,
            limit,
            offset,
        })
    }

    /// `INSERT INTO <coll> (<cols>) VALUES (<vals>)[, (<vals>)...]`.
    /// One tuple → `insertOne(doc)`, two or more → `insertMany([docs])`.
    fn parse_insert(&mut self) -> Result<MongoRequest, SqlError> {
        self.expect_kw("INSERT")?;
        self.expect_kw("INTO")?;
        let (database, collection) = source_name(&self.parse_identifier_path()?);
        self.expect("(")?;
        let columns = self.parse_identifier_list()?;
        self.expect(")")?;
        self.expect_kw("VALUES")?;

        let mut rows = Vec::new();
        loop {
            self.expect("(")?;
            let values = self.parse_literal_list()?;
            self.expect(")")?;
            if values.len() != columns.len() {
                return Err(SqlError::Unsupported(format!(
                    "INSERT has {} column(s) but {} value(s)",
                    columns.len(),
                    values.len()
                )));
            }
            let mut doc = Map::new();
            for (col, val) in columns.iter().zip(&values) {
                doc.insert(col.clone(), literal_value(val));
            }
            rows.push(Value::Object(doc));
            if !self.consume(",") {
                break;
            }
        }
        self.expect_eof()?;

        let (verb, args) = if rows.len() == 1 {
            (Verb::InsertOne, vec![rows.into_iter().next().unwrap()])
        } else {
            (Verb::InsertMany, vec![Value::Array(rows)])
        };
        Ok(MongoRequest {
            database,
            collection,
            verb,
            args,
            chain: Vec::new(),
        })
    }

    /// `UPDATE <coll> SET <col> = <lit>[, ...] [WHERE <expr>]` →
    /// `updateMany(filter, { $set: { ... } })`. SQL UPDATE affects every
    /// matching row, so it maps to `updateMany`, not `updateOne`.
    fn parse_update(&mut self) -> Result<MongoRequest, SqlError> {
        self.expect_kw("UPDATE")?;
        let (database, collection) = source_name(&self.parse_identifier_path()?);
        self.expect_kw("SET")?;

        let mut set = Map::new();
        loop {
            let field = self.parse_identifier_path()?;
            self.expect("=")?;
            set.insert(field, self.parse_set_value()?);
            if !self.consume(",") {
                break;
            }
        }
        let filter = self.parse_optional_where()?;
        self.expect_eof()?;

        Ok(MongoRequest {
            database,
            collection,
            verb: Verb::UpdateMany,
            args: vec![filter, json!({ "$set": Value::Object(set) })],
            chain: Vec::new(),
        })
    }

    /// `DELETE FROM <coll> [WHERE <expr>]` → `deleteMany(filter)`. SQL DELETE
    /// removes every matching row, so it maps to `deleteMany`.
    fn parse_delete(&mut self) -> Result<MongoRequest, SqlError> {
        self.expect_kw("DELETE")?;
        self.expect_kw("FROM")?;
        let (database, collection) = source_name(&self.parse_identifier_path()?);
        let filter = self.parse_optional_where()?;
        self.expect_eof()?;

        Ok(MongoRequest {
            database,
            collection,
            verb: Verb::DeleteMany,
            args: vec![filter],
            chain: Vec::new(),
        })
    }

    /// A trailing `WHERE <expr>`, or an empty filter `{}` when absent — an
    /// UPDATE/DELETE without WHERE targets the whole collection, matching SQL.
    fn parse_optional_where(&mut self) -> Result<Value, SqlError> {
        if self.consume_kw("WHERE") {
            expr_to_mongo(&self.parse_expr()?)
        } else {
            Ok(json!({}))
        }
    }

    /// The RHS of a `SET` assignment. Only literals translate to a Mongo
    /// `$set`; column references or expressions (`SET a = b + 1`) are rejected.
    fn parse_set_value(&mut self) -> Result<Value, SqlError> {
        let token = self.peek();
        let is_literal = token.starts_with('\'')
            || token.eq_ignore_ascii_case("true")
            || token.eq_ignore_ascii_case("false")
            || token.eq_ignore_ascii_case("null")
            || token
                .chars()
                .next()
                .is_some_and(|c| c == '-' || c.is_ascii_digit());
        if !is_literal {
            return Err(SqlError::Unsupported(
                "UPDATE SET supports only literal values".into(),
            ));
        }
        Ok(literal_value(&self.parse_literal()?))
    }

    fn expect_eof(&mut self) -> Result<(), SqlError> {
        if self.is_eof() {
            Ok(())
        } else {
            Err(SqlError::Unexpected(self.peek().to_owned()))
        }
    }

    fn parse_select_list(&mut self) -> Result<Vec<SelectItem>, SqlError> {
        let mut out = Vec::new();
        loop {
            out.push(self.parse_select_item()?);
            if !self.consume(",") {
                break;
            }
        }
        Ok(out)
    }

    fn parse_select_item(&mut self) -> Result<SelectItem, SqlError> {
        let expr = if self.consume("*") {
            SelectExpr::Star
        } else if let Some(func) = AggFunc::from_name(self.peek()) {
            self.pos += 1;
            self.expect("(")?;
            let field = if self.consume("*") {
                None
            } else {
                Some(self.parse_identifier_path()?)
            };
            self.expect(")")?;
            SelectExpr::Aggregate(func, field)
        } else {
            SelectExpr::Field(self.parse_field_ref()?)
        };
        let alias = if self.consume_kw("AS") {
            Some(self.parse_identifier_path()?)
        } else {
            None
        };
        Ok(SelectItem { expr, alias })
    }

    fn parse_expr(&mut self) -> Result<Expr, SqlError> {
        self.parse_or()
    }

    fn parse_or(&mut self) -> Result<Expr, SqlError> {
        let mut expr = self.parse_and()?;
        while self.consume_kw("OR") {
            expr = Expr::Or(Box::new(expr), Box::new(self.parse_and()?));
        }
        Ok(expr)
    }

    fn parse_and(&mut self) -> Result<Expr, SqlError> {
        let mut expr = self.parse_not()?;
        while self.consume_kw("AND") {
            expr = Expr::And(Box::new(expr), Box::new(self.parse_not()?));
        }
        Ok(expr)
    }

    fn parse_not(&mut self) -> Result<Expr, SqlError> {
        if self.consume_kw("NOT") {
            return Ok(Expr::Not(Box::new(self.parse_not()?)));
        }
        self.parse_primary()
    }

    fn parse_primary(&mut self) -> Result<Expr, SqlError> {
        if self.consume("(") {
            let expr = self.parse_expr()?;
            self.expect(")")?;
            return Ok(expr);
        }
        let field = self.parse_identifier_path()?;
        if self.consume_kw("IS") {
            let is_not = self.consume_kw("NOT");
            self.expect_kw("NULL")?;
            return Ok(if is_not {
                Expr::IsNotNull(field)
            } else {
                Expr::IsNull(field)
            });
        }

        let mut negated = false;
        if self.consume_kw("NOT") {
            negated = true;
        }
        if self.consume_kw("IN") {
            self.expect("(")?;
            let values = self.parse_literal_list()?;
            self.expect(")")?;
            return Ok(if negated {
                Expr::NotIn(field, values)
            } else {
                Expr::In(field, values)
            });
        }
        if self.consume_kw("BETWEEN") {
            let lo = self.parse_literal()?;
            self.expect_kw("AND")?;
            let hi = self.parse_literal()?;
            return Ok(if negated {
                Expr::NotBetween(field, lo, hi)
            } else {
                Expr::Between(field, lo, hi)
            });
        }
        if self.consume_kw("LIKE") {
            let pat = self.parse_string_literal()?;
            return Ok(if negated {
                Expr::NotLike(field, pat)
            } else {
                Expr::Like(field, pat)
            });
        }
        if negated {
            return Err(SqlError::Expected("IN, BETWEEN, or LIKE after NOT"));
        }

        let op = self.parse_comp_op()?;
        let value = self.parse_literal()?;
        Ok(Expr::Compare(field, op, value))
    }

    fn parse_identifier_list(&mut self) -> Result<Vec<String>, SqlError> {
        let mut out = Vec::new();
        loop {
            out.push(self.parse_identifier_path()?);
            if !self.consume(",") {
                break;
            }
        }
        Ok(out)
    }

    fn parse_order_by(&mut self) -> Result<Vec<OrderBy>, SqlError> {
        let mut out = Vec::new();
        loop {
            let field = self.parse_identifier_path()?;
            let desc = if self.consume_kw("DESC") {
                true
            } else {
                self.consume_kw("ASC");
                false
            };
            out.push(OrderBy { field, desc });
            if !self.consume(",") {
                break;
            }
        }
        Ok(out)
    }

    fn parse_literal_list(&mut self) -> Result<Vec<Literal>, SqlError> {
        let mut out = Vec::new();
        loop {
            out.push(self.parse_literal()?);
            if !self.consume(",") {
                break;
            }
        }
        Ok(out)
    }

    fn parse_literal(&mut self) -> Result<Literal, SqlError> {
        let token = self.next().to_owned();
        if token.starts_with('\'') && token.ends_with('\'') {
            return Ok(Literal::String(unquote_sql_string(&token)));
        }
        match token.to_uppercase().as_str() {
            "TRUE" => Ok(Literal::Bool(true)),
            "FALSE" => Ok(Literal::Bool(false)),
            "NULL" => Ok(Literal::Null),
            _ if token.contains('.') => token
                .parse::<f64>()
                .map(Literal::Double)
                .map_err(|_| SqlError::Unexpected(token)),
            _ => token
                .parse::<i64>()
                .map(Literal::Integer)
                .map_err(|_| SqlError::Unexpected(token)),
        }
    }

    fn parse_string_literal(&mut self) -> Result<String, SqlError> {
        match self.parse_literal()? {
            Literal::String(s) => Ok(s),
            other => Err(SqlError::Unexpected(format!("{other:?}"))),
        }
    }

    fn parse_comp_op(&mut self) -> Result<CompOp, SqlError> {
        let token = self.next();
        match token {
            "=" => Ok(CompOp::Eq),
            "!=" | "<>" => Ok(CompOp::Ne),
            "<" => Ok(CompOp::Lt),
            ">" => Ok(CompOp::Gt),
            "<=" => Ok(CompOp::Le),
            ">=" => Ok(CompOp::Ge),
            _ => Err(SqlError::Unexpected(token.to_owned())),
        }
    }

    fn parse_i64(&mut self) -> Result<i64, SqlError> {
        let token = self.next().to_owned();
        token
            .parse::<i64>()
            .map_err(|_| SqlError::Unexpected(token))
    }

    fn parse_identifier_path(&mut self) -> Result<String, SqlError> {
        let mut out = unquote_identifier(self.next_identifier()?);
        while self.consume(".") {
            out.push('.');
            out.push_str(&unquote_identifier(self.next_identifier()?));
        }
        Ok(out)
    }

    fn consume_table_alias(&mut self) {
        if self.consume_kw("AS") {
            if !self.is_clause_start() && !self.is_eof() {
                self.pos += 1;
            }
        } else if !self.is_clause_start() && !self.is_eof() {
            self.pos += 1;
        }
    }

    fn next_identifier(&mut self) -> Result<String, SqlError> {
        let token = self.next().to_owned();
        if matches!(
            token.as_str(),
            "," | "(" | ")" | "." | "*" | "[" | "]" | ":" | "<eof>"
        ) {
            return Err(SqlError::Expected("identifier"));
        }
        Ok(token)
    }

    /// A SELECT field path with an optional PostgreSQL-style array subscript:
    /// `path`, `path[i]`, or `path[lo:hi]` (1-based).
    fn parse_field_ref(&mut self) -> Result<FieldRef, SqlError> {
        let path = self.parse_identifier_path()?;
        let subscript = if self.consume("[") {
            let lo = self.parse_i64()?;
            let sub = if self.consume(":") {
                Subscript::Slice(lo, self.parse_i64()?)
            } else {
                Subscript::Index(lo)
            };
            self.expect("]")?;
            Some(sub)
        } else {
            None
        };
        Ok(FieldRef { path, subscript })
    }

    fn expect_kw(&mut self, kw: &'static str) -> Result<(), SqlError> {
        if self.consume_kw(kw) {
            Ok(())
        } else {
            Err(SqlError::Expected(kw))
        }
    }

    fn expect(&mut self, token: &'static str) -> Result<(), SqlError> {
        if self.consume(token) {
            Ok(())
        } else {
            Err(SqlError::Expected(token))
        }
    }

    fn consume_kw(&mut self, kw: &str) -> bool {
        if self.peek().eq_ignore_ascii_case(kw) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn consume(&mut self, token: &str) -> bool {
        if self.peek() == token {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn is_clause_start(&self) -> bool {
        matches!(
            self.peek().to_uppercase().as_str(),
            "WHERE" | "GROUP" | "HAVING" | "ORDER" | "LIMIT" | "OFFSET" | "<EOF>"
        )
    }

    fn is_eof(&self) -> bool {
        self.peek() == "<eof>"
    }

    fn peek(&self) -> &str {
        &self.tokens[self.pos]
    }

    fn next(&mut self) -> &str {
        let pos = self.pos;
        self.pos += 1;
        &self.tokens[pos]
    }
}

impl AggFunc {
    fn from_name(name: &str) -> Option<Self> {
        match name.to_uppercase().as_str() {
            "COUNT" => Some(Self::Count),
            "SUM" => Some(Self::Sum),
            "AVG" => Some(Self::Avg),
            "MIN" => Some(Self::Min),
            "MAX" => Some(Self::Max),
            _ => None,
        }
    }
}

fn source_name(path: &str) -> (Option<String>, String) {
    let mut parts = path.split('.');
    let first = parts.next().unwrap_or(path);
    let Some(second) = parts.next() else {
        return (None, first.to_owned());
    };
    let last = path.rsplit('.').next().unwrap_or(second);
    (Some(first.to_owned()), last.to_owned())
}

fn unquote_identifier(token: String) -> String {
    if (token.starts_with('"') && token.ends_with('"'))
        || (token.starts_with('`') && token.ends_with('`'))
    {
        token[1..token.len() - 1].to_owned()
    } else {
        token
    }
}

fn unquote_sql_string(token: &str) -> String {
    token[1..token.len() - 1].replace("''", "'")
}

fn tokenize(input: &str) -> Result<Vec<String>, SqlError> {
    let mut out = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c == '\'' {
            let mut s = String::from("'");
            let mut closed = false;
            i += 1;
            while i < chars.len() {
                s.push(chars[i]);
                if chars[i] == '\'' {
                    if i + 1 < chars.len() && chars[i + 1] == '\'' {
                        s.push(chars[i + 1]);
                        i += 2;
                        continue;
                    }
                    i += 1;
                    closed = true;
                    break;
                }
                i += 1;
            }
            if !closed {
                return Err(SqlError::Expected("closing string quote"));
            }
            out.push(s);
            continue;
        }
        if c == '"' || c == '`' {
            let quote = c;
            let mut s = String::new();
            s.push(quote);
            i += 1;
            while i < chars.len() && chars[i] != quote {
                s.push(chars[i]);
                i += 1;
            }
            if i >= chars.len() {
                return Err(SqlError::Expected("closing identifier quote"));
            }
            s.push(quote);
            i += 1;
            out.push(s);
            continue;
        }
        if i + 1 < chars.len() {
            let two = [chars[i], chars[i + 1]];
            let op: String = two.iter().collect();
            if matches!(op.as_str(), "<=" | ">=" | "!=" | "<>") {
                out.push(op);
                i += 2;
                continue;
            }
        }
        if matches!(c, ',' | '(' | ')' | '*' | '=' | '<' | '>' | '.' | '[' | ']' | ':') {
            out.push(c.to_string());
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len()
            && !chars[i].is_whitespace()
            && !matches!(
                chars[i],
                ',' | '(' | ')' | '*' | '=' | '<' | '>' | '.' | '[' | ']' | ':' | '\'' | '"' | '`'
            )
        {
            i += 1;
        }
        out.push(chars[start..i].iter().collect());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn select_star_translates_to_find() {
        let req = parse("SELECT * FROM users WHERE age >= 21 AND active = true ORDER BY created_at DESC LIMIT 5 OFFSET 10").unwrap();
        assert_eq!(req.database, None);
        assert_eq!(req.collection, "users");
        assert_eq!(req.verb, Verb::Find);
        assert_eq!(
            req.args[0],
            json!({ "$and": [{ "age": { "$gte": 21 } }, { "active": true }] })
        );
        assert_eq!(
            req.chain,
            vec![
                Chain::Sort(json!({ "created_at": -1 })),
                Chain::Skip(10),
                Chain::Limit(5),
            ]
        );
    }

    #[test]
    fn selected_columns_become_projection() {
        let req = parse("SELECT name, email FROM users").unwrap();
        assert_eq!(req.verb, Verb::Find);
        assert_eq!(req.args[0], json!({}));
        assert_eq!(req.args[1], json!({ "name": 1, "email": 1, "_id": 0 }));
    }

    #[test]
    fn qualified_source_sets_database() {
        let req = parse("SELECT * FROM appdb.customers").unwrap();
        assert_eq!(req.database.as_deref(), Some("appdb"));
        assert_eq!(req.collection, "customers");
    }

    #[test]
    fn count_star_uses_count_documents() {
        let req = parse("SELECT COUNT(*) FROM users WHERE status IN ('active', 'trial')").unwrap();
        assert_eq!(req.verb, Verb::CountDocuments);
        assert_eq!(
            req.args[0],
            json!({ "status": { "$in": ["active", "trial"] } })
        );
    }

    #[test]
    fn group_by_uses_aggregate_pipeline() {
        let req = parse(
            "SELECT status, COUNT(*) AS n FROM users GROUP BY status ORDER BY n DESC LIMIT 3",
        )
        .unwrap();
        assert_eq!(req.verb, Verb::Aggregate);
        assert_eq!(
            req.args[0],
            json!([
                { "$group": { "_id": "$status", "n": { "$sum": 1 } } },
                { "$project": { "_id": 0, "status": "$_id", "n": "$n" } },
                { "$sort": { "n": -1 } },
                { "$limit": 3 },
            ])
        );
    }

    #[test]
    fn distinct_uses_group_pipeline() {
        let req = parse("SELECT DISTINCT status FROM users").unwrap();
        assert_eq!(req.verb, Verb::Aggregate);
        assert_eq!(
            req.args[0],
            json!([
                { "$group": { "_id": "$status" } },
                { "$project": { "_id": 0, "status": "$_id" } },
            ])
        );
    }

    #[test]
    fn nested_field_lifts_to_flat_column() {
        let req = parse("SELECT content.sample_responses FROM c WHERE part = 2").unwrap();
        assert_eq!(req.verb, Verb::Aggregate);
        assert_eq!(
            req.args[0],
            json!([
                { "$match": { "part": 2 } },
                { "$replaceRoot": { "newRoot": { "$arrayToObject": { "$concatArrays": [
                    [{ "k": "content.sample_responses", "v": "$content.sample_responses" }],
                ] } } } },
            ])
        );
    }

    #[test]
    fn array_index_uses_array_elem_at_one_based() {
        let req = parse("SELECT tags[1] FROM c").unwrap();
        assert_eq!(req.verb, Verb::Aggregate);
        assert_eq!(
            req.args[0],
            json!([
                { "$replaceRoot": { "newRoot": { "$arrayToObject": { "$concatArrays": [
                    [{ "k": "tags[1]", "v": { "$arrayElemAt": ["$tags", 0] } }],
                ] } } } },
            ])
        );
    }

    #[test]
    fn array_slice_uses_slice() {
        let req = parse("SELECT scores[1:3] FROM c").unwrap();
        assert_eq!(
            req.args[0],
            json!([
                { "$replaceRoot": { "newRoot": { "$arrayToObject": { "$concatArrays": [
                    [{ "k": "scores[1:3]", "v": { "$slice": ["$scores", 0, 3] } }],
                ] } } } },
            ])
        );
    }

    #[test]
    fn nested_field_sorts_before_reshape() {
        let req = parse("SELECT a.b FROM c ORDER BY a.b DESC LIMIT 5").unwrap();
        assert_eq!(
            req.args[0],
            json!([
                { "$sort": { "a.b": -1 } },
                { "$limit": 5 },
                { "$replaceRoot": { "newRoot": { "$arrayToObject": { "$concatArrays": [
                    [{ "k": "a.b", "v": "$a.b" }],
                ] } } } },
            ])
        );
    }

    #[test]
    fn multi_column_lift_concats_pair_arrays() {
        // Two lifted columns: each pair is its own single-element array, joined
        // by `$concatArrays` so `$arrayToObject` always gets an array input.
        let req = parse("SELECT a.b, tags[1] FROM c").unwrap();
        assert_eq!(req.verb, Verb::Aggregate);
        assert_eq!(
            req.args[0],
            json!([
                { "$replaceRoot": { "newRoot": { "$arrayToObject": { "$concatArrays": [
                    [{ "k": "a.b", "v": "$a.b" }],
                    [{ "k": "tags[1]", "v": { "$arrayElemAt": ["$tags", 0] } }],
                ] } } } },
            ])
        );
    }

    #[test]
    fn plain_columns_still_use_find_projection() {
        // Regression: simple non-dotted selects must keep the efficient find
        // path and not switch to an aggregate pipeline.
        let req = parse("SELECT name FROM c").unwrap();
        assert_eq!(req.verb, Verb::Find);
        assert_eq!(req.args[0], json!({}));
        assert_eq!(req.args[1], json!({ "name": 1, "_id": 0 }));
    }

    #[test]
    fn insert_single_row_uses_insert_one() {
        let req = parse("INSERT INTO users (name, age) VALUES ('alice', 30)").unwrap();
        assert_eq!(req.collection, "users");
        assert_eq!(req.verb, Verb::InsertOne);
        assert_eq!(req.args[0], json!({ "name": "alice", "age": 30 }));
    }

    #[test]
    fn insert_multi_row_uses_insert_many() {
        let req =
            parse("INSERT INTO users (name, age) VALUES ('alice', 30), ('bob', 25)").unwrap();
        assert_eq!(req.verb, Verb::InsertMany);
        assert_eq!(
            req.args[0],
            json!([{ "name": "alice", "age": 30 }, { "name": "bob", "age": 25 }])
        );
    }

    #[test]
    fn insert_qualified_collection_sets_database() {
        let req = parse("INSERT INTO appdb.customers (id) VALUES (1)").unwrap();
        assert_eq!(req.database.as_deref(), Some("appdb"));
        assert_eq!(req.collection, "customers");
        assert_eq!(req.verb, Verb::InsertOne);
    }

    #[test]
    fn insert_arity_mismatch_errors() {
        let err = parse("INSERT INTO users (name, age) VALUES ('alice')").unwrap_err();
        assert!(matches!(err, SqlError::Unsupported(_)));
    }

    #[test]
    fn update_uses_update_many_with_set() {
        let req = parse("UPDATE users SET age = 31, status = 'active' WHERE name = 'alice'")
            .unwrap();
        assert_eq!(req.verb, Verb::UpdateMany);
        assert_eq!(req.args[0], json!({ "name": "alice" }));
        assert_eq!(req.args[1], json!({ "$set": { "age": 31, "status": "active" } }));
    }

    #[test]
    fn update_without_where_targets_whole_collection() {
        let req = parse("UPDATE users SET active = true").unwrap();
        assert_eq!(req.verb, Verb::UpdateMany);
        assert_eq!(req.args[0], json!({}));
        assert_eq!(req.args[1], json!({ "$set": { "active": true } }));
    }

    #[test]
    fn update_with_column_reference_is_unsupported() {
        let err = parse("UPDATE users SET age = other_col").unwrap_err();
        assert!(matches!(err, SqlError::Unsupported(_)));
    }

    #[test]
    fn delete_uses_delete_many() {
        let req = parse("DELETE FROM users WHERE status = 'inactive'").unwrap();
        assert_eq!(req.verb, Verb::DeleteMany);
        assert_eq!(req.args[0], json!({ "status": "inactive" }));
    }

    #[test]
    fn delete_without_where_clears_collection() {
        let req = parse("DELETE FROM users").unwrap();
        assert_eq!(req.verb, Verb::DeleteMany);
        assert_eq!(req.args[0], json!({}));
    }

    #[test]
    fn delete_complex_filter_translates() {
        let req =
            parse("DELETE FROM users WHERE age < 18 OR status IN ('banned', 'spam')").unwrap();
        assert_eq!(req.verb, Verb::DeleteMany);
        assert_eq!(
            req.args[0],
            json!({ "$or": [
                { "age": { "$lt": 18 } },
                { "status": { "$in": ["banned", "spam"] } },
            ] })
        );
    }

    #[test]
    fn unknown_statement_is_unsupported() {
        let err = parse("TRUNCATE users").unwrap_err();
        assert!(matches!(err, SqlError::Unsupported(_)));
    }
}
