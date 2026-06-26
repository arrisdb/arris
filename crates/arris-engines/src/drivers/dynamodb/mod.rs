//! Amazon DynamoDB driver — uses the official `aws-sdk-dynamodb` crate.
//!
//! DynamoDB is a schemaless key/value + document store with no SQL surface, so
//! queries flow through **PartiQL** (`ExecuteStatement`), DynamoDB's
//! SQL-compatible dialect. `SELECT` / `INSERT` / `UPDATE` / `DELETE` statements
//! typed in the editor are passed straight through, paginated by `NextToken`.
//!
//! - `connect()` builds an SDK client from the `ConnectionConfig` (region,
//!   static credentials, optional endpoint override for DynamoDB Local) and
//!   verifies reachability with a one-table `ListTables`.
//! - `run_query()` runs PartiQL via `execute_statement`; reads page through
//!   `NextToken` and the column set is the ordered union of returned attributes.
//! - `list_schemas()` lists tables (`ListTables`) and, per table
//!   (`DescribeTable`), surfaces key attributes as columns and GSIs as indexes.
//! - Browse-mode row edits route through the native item API
//!   (`PutItem` / `UpdateItem` / `DeleteItem`) keyed by the table's primary key.
//! - DynamoDB has no query planner, so `explain_query()` is unsupported.
//!
//! Config-field mapping (reuses the generic `ConnectionConfig` slots):
//! `database` = AWS region, `user` = access key id, `password` = secret access
//! key, `options` = session token (optional), `host` = endpoint URL (optional).

mod convert;

use std::collections::HashMap;
use std::time::Instant;

use async_trait::async_trait;
use aws_config::BehaviorVersion;
use aws_sdk_dynamodb::Client;
use aws_sdk_dynamodb::config::{Credentials, Region};
use aws_sdk_dynamodb::types::{AttributeValue, KeyType, ScalarAttributeType};
use indexmap::IndexSet;

use crate::drivers::DatabaseDriver;
use crate::drivers::errors::Result;
use crate::{
    ConnectionConfig, DriverError, ExplainMode, MutationResult, PlanResult, QueryLanguage,
    QueryResult, QueryValue, RowDelete, RowInsert, SchemaNode, SchemaNodeKind, TableRef, ValueMap,
};

use convert::{attr_value, item_value, type_name};

/// How many items to sample per table when inferring non-key columns for the
/// schema browser. DynamoDB is schemaless, so columns beyond the key attributes
/// are discovered from real rows; a small page keeps `list_schemas` cheap.
const SCHEMA_SAMPLE_SIZE: i32 = 50;

/// Conditional DML verbs that PartiQL only accepts when the `WHERE` clause pins
/// the full primary key. The driver emulates row-set semantics for these.
#[derive(Clone, Copy)]
enum DmlKind {
    Update,
    Delete,
}

/// A parsed standard SQL `INSERT`, normalized for issuing as native PartiQL
/// `VALUE` documents (one per row).
struct InsertPlan {
    table: String,
    columns: Vec<String>,
    rows: Vec<Vec<AttributeValue>>,
}

#[derive(Default)]
pub struct DynamoDbDriver {
    inner: tokio::sync::Mutex<Option<Client>>,
}

impl DynamoDbDriver {
    pub fn new() -> Self {
        Self::default()
    }

    async fn client(&self) -> Result<Client> {
        self.inner
            .lock()
            .await
            .clone()
            .ok_or(DriverError::NotConnected)
    }

    /// Flattens an AWS SDK error and its source chain into a single message.
    /// The top-level `SdkError` only displays "service error"; the real cause
    /// (e.g. `ValidationException: ...`, `ResourceNotFoundException: ...`) lives
    /// in the source chain, so we append each distinct source.
    fn error_message<E: std::error::Error>(err: E) -> String {
        let mut parts = vec![err.to_string()];
        let mut source = err.source();
        while let Some(s) = source {
            let text = s.to_string();
            if !parts.iter().any(|p| p == &text) {
                parts.push(text);
            }
            source = s.source();
        }
        parts.join(": ")
    }

    fn query_err<E: std::error::Error>(err: E) -> DriverError {
        DriverError::QueryFailed(Self::error_message(err))
    }

    fn conn_err<E: std::error::Error>(err: E) -> DriverError {
        DriverError::ConnectionFailed(Self::error_message(err))
    }

    /// Whether a PartiQL statement is a read (`SELECT`). Writes
    /// (`INSERT`/`UPDATE`/`DELETE`) report an affected count instead of rows.
    fn is_read(statement: &str) -> bool {
        statement
            .trim_start()
            .get(..6)
            .is_some_and(|head| head.eq_ignore_ascii_case("select"))
    }

    /// Builds the `PartiQL` parameter list from the engine's positional params.
    fn partiql_params(params: &[QueryValue]) -> Option<Vec<AttributeValue>> {
        if params.is_empty() {
            None
        } else {
            Some(params.iter().map(attr_value).collect())
        }
    }

    /// Runs a `PartiQL` read statement, following `NextToken` until the result
    /// set is exhausted, and returns the accumulated items.
    async fn collect_items(
        client: &Client,
        text: &str,
        params: Option<Vec<AttributeValue>>,
    ) -> Result<Vec<HashMap<String, AttributeValue>>> {
        let mut items: Vec<HashMap<String, AttributeValue>> = Vec::new();
        let mut next_token: Option<String> = None;
        loop {
            let out = client
                .execute_statement()
                .statement(text)
                .set_parameters(params.clone())
                .set_next_token(next_token.clone())
                .send()
                .await
                .map_err(Self::query_err)?;
            items.extend(out.items().iter().cloned());
            match out.next_token() {
                Some(t) => next_token = Some(t.to_owned()),
                None => break,
            }
        }
        Ok(items)
    }

    /// The attribute names actually returned, sorted for a deterministic order.
    /// DynamoDB items are unordered maps, so a `SELECT *` (or write `RETURNING`)
    /// has no inherent column order; sorting keeps results stable across runs.
    fn discovered_columns(items: &[HashMap<String, AttributeValue>]) -> Vec<String> {
        let mut set: IndexSet<String> = IndexSet::new();
        for item in items {
            for key in item.keys() {
                set.insert(key.clone());
            }
        }
        let mut cols: Vec<String> = set.into_iter().collect();
        cols.sort();
        cols
    }

    /// Shapes a set of DynamoDB items into `(column specs, rows)`. Column order
    /// follows the SELECT projection when supplied (DynamoDB returns items as
    /// unordered attribute maps, so projection order would otherwise be lost);
    /// otherwise the deterministic discovered order is used. Each column's
    /// displayed type is inferred from the first non-null value in that column.
    fn shape_items(
        items: &[HashMap<String, AttributeValue>],
        order: Option<&[String]>,
    ) -> (Vec<crate::ColumnSpec>, Vec<Vec<QueryValue>>) {
        // Use the projection order only when it lines up with the returned data
        // (at least one projected name is present). A `*` or an expression
        // projection yields names that do not match attribute keys, so fall back
        // to discovery there.
        let columns: Vec<String> = match order {
            Some(cols)
                if !cols.is_empty()
                    && cols.iter().any(|c| items.iter().any(|it| it.contains_key(c))) =>
            {
                cols.to_vec()
            }
            _ => Self::discovered_columns(items),
        };

        let column_specs = columns
            .iter()
            .map(|name| {
                let ty = items
                    .iter()
                    .filter_map(|item| item.get(name))
                    .find(|av| !matches!(av, AttributeValue::Null(_)))
                    .or_else(|| items.iter().find_map(|item| item.get(name)))
                    .map(|av| type_name(av))
                    .unwrap_or("null");
                crate::ColumnSpec::new(name.clone(), ty)
            })
            .collect();

        let rows: Vec<Vec<QueryValue>> = items
            .iter()
            .map(|item| {
                columns
                    .iter()
                    .map(|col| item.get(col).map(item_value).unwrap_or(QueryValue::Null))
                    .collect()
            })
            .collect();

        (column_specs, rows)
    }

    /// Finds the byte offset of a top-level SQL keyword (word-bounded, outside
    /// single-quoted strings). `keyword` must be uppercase.
    fn keyword_pos(text: &str, keyword: &str) -> Option<usize> {
        let bytes = text.as_bytes();
        let upper = text.to_ascii_uppercase();
        let ub = upper.as_bytes();
        let kb = keyword.as_bytes();
        let n = bytes.len();
        let k = kb.len();
        let is_word = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
        let mut in_str = false;
        let mut i = 0;
        while i + k <= n {
            if bytes[i] == b'\'' {
                in_str = !in_str;
            } else if !in_str && &ub[i..i + k] == kb {
                let before_ok = i == 0 || !is_word(bytes[i - 1]);
                let after_ok = i + k == n || !is_word(bytes[i + k]);
                if before_ok && after_ok {
                    return Some(i);
                }
            }
            i += 1;
        }
        None
    }

    /// Splits on commas that sit at the top level (not inside parens or quotes).
    fn split_top_level_commas(s: &str) -> Vec<&str> {
        let bytes = s.as_bytes();
        let mut parts = Vec::new();
        let mut depth = 0i32;
        let mut in_str = false;
        let mut start = 0;
        for i in 0..bytes.len() {
            match bytes[i] {
                b'\'' => in_str = !in_str,
                b'(' if !in_str => depth += 1,
                b')' if !in_str => depth = (depth - 1).max(0),
                b',' if !in_str && depth == 0 => {
                    parts.push(&s[start..i]);
                    start = i + 1;
                }
                _ => {}
            }
        }
        parts.push(&s[start..]);
        parts
    }

    /// The output attribute name of a projection item: the alias after `AS` if
    /// present, otherwise the bare (unquoted) identifier.
    fn projection_output_name(part: &str) -> String {
        let lower = part.to_ascii_lowercase();
        let base = match lower.rfind(" as ") {
            Some(pos) => &part[pos + 4..],
            None => part,
        };
        base.trim().trim_matches('"').to_owned()
    }

    /// Parses the ordered output columns of an explicit `SELECT` projection.
    /// Returns `None` for `SELECT *`, a non-SELECT statement, or an empty list,
    /// signalling that discovery order should be used instead.
    fn projection_list(statement: &str) -> Option<Vec<String>> {
        let trimmed = statement.trim_start();
        if !trimmed.get(..6).is_some_and(|h| h.eq_ignore_ascii_case("SELECT")) {
            return None;
        }
        let after_select = (statement.len() - trimmed.len()) + 6;
        let from_pos = Self::keyword_pos(statement, "FROM")?;
        if from_pos <= after_select {
            return None;
        }
        let projection = statement[after_select..from_pos].trim();
        if projection == "*" || projection.is_empty() {
            return None;
        }
        let mut cols = Vec::new();
        for part in Self::split_top_level_commas(projection) {
            let name = part.trim();
            // A `*` anywhere in the list (e.g. `SELECT a, *`) defeats fixed
            // ordering — fall back to discovery.
            if name == "*" || name.is_empty() {
                return None;
            }
            cols.push(Self::projection_output_name(name));
        }
        (!cols.is_empty()).then_some(cols)
    }

    /// Splits a `SELECT` at a top-level `ORDER BY` (outside quotes), returning the
    /// statement with the clause removed and the parsed sort terms. PartiQL has no
    /// `ORDER BY`, so the driver strips it and sorts the buffered result in memory.
    fn split_order_by(text: &str) -> (String, Vec<(String, bool)>) {
        let Some(order_pos) = Self::keyword_pos(text, "ORDER") else {
            return (text.to_owned(), Vec::new());
        };
        // Require the `BY` that follows `ORDER`.
        let after = text[order_pos + 5..].trim_start();
        if !after.get(..2).is_some_and(|h| h.eq_ignore_ascii_case("BY")) {
            return (text.to_owned(), Vec::new());
        }
        let clause_start = text.len() - after.len() + 2; // just past "BY"
        let clause = text[clause_start..].trim().trim_end_matches(';');
        let mut terms = Vec::new();
        for part in Self::split_top_level_commas(clause) {
            let mut tokens = part.split_whitespace();
            let Some(col) = tokens.next() else { continue };
            let desc = tokens.next().is_some_and(|d| d.eq_ignore_ascii_case("DESC"));
            terms.push((col.trim_matches('"').to_owned(), desc));
        }
        let stripped = text[..order_pos].trim_end().to_owned();
        (stripped, terms)
    }

    /// A sortable key for an attribute: `(type rank, numeric value, text value)`.
    /// Nulls/absent sort first; numbers compare numerically, strings lexically,
    /// other kinds by a stable rendering. Used to emulate `ORDER BY`.
    fn sort_key(av: Option<&AttributeValue>) -> (u8, f64, String) {
        match av {
            None | Some(AttributeValue::Null(_)) => (0, 0.0, String::new()),
            Some(AttributeValue::N(n)) => (1, n.parse().unwrap_or(0.0), String::new()),
            Some(AttributeValue::Bool(b)) => (2, if *b { 1.0 } else { 0.0 }, String::new()),
            Some(AttributeValue::S(s)) => (3, 0.0, s.clone()),
            Some(other) => (4, 0.0, format!("{other:?}")),
        }
    }

    /// Sorts items in place by the parsed `ORDER BY` terms (multi-key, stable).
    fn sort_items(items: &mut [HashMap<String, AttributeValue>], terms: &[(String, bool)]) {
        if terms.is_empty() {
            return;
        }
        items.sort_by(|a, b| {
            for (col, desc) in terms {
                let ka = Self::sort_key(a.get(col));
                let kb = Self::sort_key(b.get(col));
                let mut ord = ka
                    .0
                    .cmp(&kb.0)
                    .then(ka.1.partial_cmp(&kb.1).unwrap_or(std::cmp::Ordering::Equal))
                    .then(ka.2.cmp(&kb.2));
                if *desc {
                    ord = ord.reverse();
                }
                if ord != std::cmp::Ordering::Equal {
                    return ord;
                }
            }
            std::cmp::Ordering::Equal
        });
    }

    /// Whether the statement is a standard SQL `INSERT ... VALUES (...)`. Native
    /// PartiQL uses the singular `VALUE {...}` document form, so the presence of
    /// a top-level `VALUES` keyword distinguishes the SQL form that needs
    /// translating from native PartiQL (which passes straight through).
    fn is_standard_insert(text: &str) -> bool {
        let t = text.trim_start();
        let is_insert = t.len() > 6
            && t[..6].eq_ignore_ascii_case("INSERT")
            && t.as_bytes()[6].is_ascii_whitespace();
        is_insert && Self::keyword_pos(text, "VALUES").is_some()
    }

    /// Index of the next `(` at the top level (outside single-quoted strings).
    fn find_open_paren(s: &str, from: usize) -> Option<usize> {
        let bytes = s.as_bytes();
        let mut in_str = false;
        for i in from..bytes.len() {
            match bytes[i] {
                b'\'' => in_str = !in_str,
                b'(' if !in_str => return Some(i),
                _ => {}
            }
        }
        None
    }

    /// Given the index of an opening `(`, returns the inner contents and the
    /// index of the matching `)` (parens balanced, quotes respected).
    fn balanced_parens(s: &str, open: usize) -> Option<(&str, usize)> {
        let bytes = s.as_bytes();
        let mut depth = 0i32;
        let mut in_str = false;
        let mut i = open;
        while i < bytes.len() {
            match bytes[i] {
                b'\'' => in_str = !in_str,
                b'(' if !in_str => depth += 1,
                b')' if !in_str => {
                    depth -= 1;
                    if depth == 0 {
                        return Some((&s[open + 1..i], i));
                    }
                }
                _ => {}
            }
            i += 1;
        }
        None
    }

    /// Parses a scalar SQL literal into an `AttributeValue`. Supports strings
    /// (`'..'`, with `''` escaping), numbers (kept as exact text), booleans, and
    /// `NULL`. Anything else is rejected so a bad value surfaces as a clear error
    /// rather than a cryptic PartiQL failure.
    fn parse_sql_literal(token: &str) -> Result<AttributeValue> {
        let t = token.trim();
        if t.eq_ignore_ascii_case("null") {
            return Ok(AttributeValue::Null(true));
        }
        if t.eq_ignore_ascii_case("true") {
            return Ok(AttributeValue::Bool(true));
        }
        if t.eq_ignore_ascii_case("false") {
            return Ok(AttributeValue::Bool(false));
        }
        if t.len() >= 2 && t.starts_with('\'') && t.ends_with('\'') {
            let inner = &t[1..t.len() - 1];
            return Ok(AttributeValue::S(inner.replace("''", "'")));
        }
        if t.parse::<f64>().is_ok() {
            // Keep the exact source text — DynamoDB numbers are strings and carry
            // more precision than f64; the parse only validates it is numeric.
            return Ok(AttributeValue::N(t.to_owned()));
        }
        Err(DriverError::InvalidArgument(format!(
            "unsupported INSERT value literal: {t}"
        )))
    }

    /// Translates a standard `INSERT INTO t (cols) VALUES (..), (..)` into a plan
    /// of per-row attribute values, ready to issue as native PartiQL `VALUE`
    /// documents. Errors clearly when the form is malformed (missing column list,
    /// arity mismatch, unsupported literal).
    fn build_insert_plan(text: &str) -> Result<InsertPlan> {
        let bad = |m: &str| DriverError::InvalidArgument(m.to_owned());
        let into = Self::keyword_pos(text, "INTO").ok_or_else(|| bad("INSERT is missing INTO"))?;
        let after_into = into + 4;

        let rest = &text[after_into..];
        let table_off = rest
            .find(|c: char| !c.is_whitespace())
            .ok_or_else(|| bad("INSERT is missing a table name"))?;
        let region = &rest[table_off..];
        let table_len = region
            .find(|c: char| c.is_whitespace() || c == '(')
            .unwrap_or(region.len());
        let table = region[..table_len].trim_matches('"').to_owned();
        if table.is_empty() {
            return Err(bad("INSERT is missing a table name"));
        }

        let values_pos =
            Self::keyword_pos(text, "VALUES").ok_or_else(|| bad("INSERT is missing VALUES"))?;
        let table_end = after_into + table_off + table_len;
        let cols_open = Self::find_open_paren(text, table_end)
            .filter(|&p| p < values_pos)
            .ok_or_else(|| bad("INSERT needs a (column, ...) list before VALUES"))?;
        let (cols_inner, _) =
            Self::balanced_parens(text, cols_open).ok_or_else(|| bad("unterminated column list"))?;
        let columns: Vec<String> = Self::split_top_level_commas(cols_inner)
            .into_iter()
            .map(|c| c.trim().trim_matches('"').to_owned())
            .filter(|c| !c.is_empty())
            .collect();
        if columns.is_empty() {
            return Err(bad("INSERT column list is empty"));
        }

        let mut rows: Vec<Vec<AttributeValue>> = Vec::new();
        let mut cursor = values_pos + 6;
        while let Some(open) = Self::find_open_paren(text, cursor) {
            let (inner, end) =
                Self::balanced_parens(text, open).ok_or_else(|| bad("unterminated VALUES tuple"))?;
            let raw = Self::split_top_level_commas(inner);
            if raw.len() != columns.len() {
                return Err(bad(
                    "INSERT column count does not match the number of values",
                ));
            }
            let mut values = Vec::with_capacity(raw.len());
            for token in raw {
                values.push(Self::parse_sql_literal(token)?);
            }
            rows.push(values);
            cursor = end + 1;
        }
        if rows.is_empty() {
            return Err(bad("INSERT has no VALUES tuples"));
        }

        Ok(InsertPlan { table, columns, rows })
    }

    /// Runs a standard SQL `INSERT` by translating each VALUES tuple into a
    /// native PartiQL `INSERT INTO "t" VALUE {'col': ?, ...}` with the row's
    /// values bound as parameters.
    async fn run_standard_insert(
        &self,
        client: &Client,
        text: &str,
        started: Instant,
    ) -> Result<QueryResult> {
        let plan = Self::build_insert_plan(text)?;
        let placeholders: String = plan
            .columns
            .iter()
            .map(|c| format!("'{}': ?", c.replace('\'', "''")))
            .collect::<Vec<_>>()
            .join(", ");
        let statement =
            format!("INSERT INTO {} VALUE {{{placeholders}}}", Self::quote_ident(&plan.table));

        for row in &plan.rows {
            client
                .execute_statement()
                .statement(&statement)
                .set_parameters(Some(row.clone()))
                .send()
                .await
                .map_err(Self::query_err)?;
        }

        let mut result = QueryResult::empty();
        result.rows_affected = Some(plan.rows.len() as i64);
        result.statement_type = crate::StatementType::Mutation;
        result.elapsed = started.elapsed().as_secs_f64();
        Ok(result)
    }

    /// Runs a read statement and shapes the accumulated items into a
    /// `QueryResult`.
    async fn run_read(
        &self,
        client: &Client,
        text: &str,
        params: Option<Vec<AttributeValue>>,
        started: Instant,
    ) -> Result<QueryResult> {
        // PartiQL has no ORDER BY, so strip it and sort the buffered result set
        // in memory (the engine already pages the whole result; `PaginationStrategy::None`).
        let (statement, order_terms) = Self::split_order_by(text);
        let mut items = Self::collect_items(client, &statement, params).await?;
        Self::sort_items(&mut items, &order_terms);
        let projection = Self::projection_list(&statement);
        let (column_specs, rows) = Self::shape_items(&items, projection.as_deref());
        let mut result = QueryResult::new(column_specs, rows);
        result.elapsed = started.elapsed().as_secs_f64();
        Ok(result)
    }

    /// Runs a write statement. PartiQL DML targets a single item, so a
    /// successful statement affects one item unless it carries `RETURNING`, in
    /// which case the returned items are surfaced as rows.
    async fn run_write(
        &self,
        client: &Client,
        text: &str,
        params: Option<Vec<AttributeValue>>,
        started: Instant,
    ) -> Result<QueryResult> {
        let out = client
            .execute_statement()
            .statement(text)
            .set_parameters(params)
            .send()
            .await
            .map_err(Self::query_err)?;

        let returned = out.items();
        let mut result = if returned.is_empty() {
            QueryResult::empty()
        } else {
            // A write `RETURNING` has no projection list; use discovery order.
            let (column_specs, rows) = Self::shape_items(returned, None);
            QueryResult::new(column_specs, rows)
        };
        let affected = returned.len().max(1) as i64;
        result.rows_affected = Some(affected);
        result.statement_type = crate::StatementType::Mutation;
        result.elapsed = started.elapsed().as_secs_f64();
        Ok(result)
    }

    /// Builds a DynamoDB item key map (`{attr: AttributeValue}`) from a
    /// primary-key `ValueMap`.
    fn key_from(primary_key: &ValueMap) -> Result<HashMap<String, AttributeValue>> {
        if primary_key.is_empty() {
            return Err(DriverError::InvalidArgument(
                "primary key is required for this operation".into(),
            ));
        }
        Ok(primary_key
            .iter()
            .map(|(k, v)| (k.clone(), attr_value(v)))
            .collect())
    }

    /// Detects an `UPDATE` / `DELETE` statement (word-bounded, case-insensitive).
    fn dml_kind(text: &str) -> Option<DmlKind> {
        let t = text.trim_start();
        let boundary = |verb: &str| {
            t.len() > verb.len()
                && t[..verb.len()].eq_ignore_ascii_case(verb)
                && t.as_bytes()[verb.len()].is_ascii_whitespace()
        };
        if boundary("UPDATE") {
            Some(DmlKind::Update)
        } else if boundary("DELETE") {
            Some(DmlKind::Delete)
        } else {
            None
        }
    }

    /// Splits a statement at the top-level `WHERE` keyword (ignoring occurrences
    /// inside single-quoted strings), returning the head and the condition with
    /// any trailing semicolon stripped.
    fn split_where(text: &str) -> Option<(&str, &str)> {
        let bytes = text.as_bytes();
        let upper = text.to_ascii_uppercase();
        let ub = upper.as_bytes();
        let n = bytes.len();
        let mut in_str = false;
        let mut i = 0;
        while i < n {
            if bytes[i] == b'\'' {
                in_str = !in_str;
            } else if !in_str && i + 5 <= n && &ub[i..i + 5] == b"WHERE" {
                let before_ok = i == 0 || bytes[i - 1].is_ascii_whitespace();
                let after_ok = bytes.get(i + 5).is_none_or(|b| b.is_ascii_whitespace());
                if before_ok && after_ok {
                    let head = text[..i].trim_end();
                    let cond = text[i + 5..].trim().trim_end_matches(';').trim_end();
                    return Some((head, cond));
                }
            }
            i += 1;
        }
        None
    }

    /// Extracts the (unquoted) target table name from a DML statement head.
    fn target_table(head: &str, kind: DmlKind) -> Option<String> {
        let mut tokens = head.split_whitespace();
        match kind {
            DmlKind::Update => {
                tokens.next()?; // UPDATE
            }
            DmlKind::Delete => {
                tokens.by_ref().find(|t| t.eq_ignore_ascii_case("FROM"))?;
            }
        }
        let raw = tokens.next()?;
        Some(raw.trim_matches('"').to_owned())
    }

    /// Resolves a table's primary-key attribute names (partition key, then sort
    /// key) from `DescribeTable`.
    async fn pk_attrs(client: &Client, table: &str) -> Result<Vec<String>> {
        let desc = client
            .describe_table()
            .table_name(table)
            .send()
            .await
            .map_err(Self::query_err)?;
        let Some(t) = desc.table() else {
            return Ok(Vec::new());
        };
        let mut keys = Vec::new();
        for kt in [KeyType::Hash, KeyType::Range] {
            if let Some(el) = t.key_schema().iter().find(|k| *k.key_type() == kt) {
                keys.push(el.attribute_name().to_owned());
            }
        }
        Ok(keys)
    }

    /// Quotes a PartiQL identifier (double-quoted, embedded quotes doubled).
    fn quote_ident(name: &str) -> String {
        format!("\"{}\"", name.replace('"', "\"\""))
    }

    /// Emulates a conditional `UPDATE` / `DELETE`. PartiQL's single-statement DML
    /// rejects any `WHERE` that is not a full primary-key equality, so the driver
    /// first selects the matching items (a scan filter on the condition), then
    /// re-issues one keyed statement per matched row.
    async fn run_conditional_dml(
        &self,
        client: &Client,
        kind: DmlKind,
        head: &str,
        condition: &str,
        select_params: Option<Vec<AttributeValue>>,
        started: Instant,
    ) -> Result<QueryResult> {
        let Some(table) = Self::target_table(head, kind) else {
            return Err(DriverError::QueryFailed(
                "could not parse the target table from the statement".into(),
            ));
        };
        let pk = Self::pk_attrs(client, &table).await?;
        if pk.is_empty() {
            return Err(DriverError::QueryFailed(format!(
                "table `{table}` has no resolvable primary key"
            )));
        }

        let select = format!("SELECT * FROM {} WHERE {condition}", Self::quote_ident(&table));
        let matches = Self::collect_items(client, &select, select_params).await?;

        let mut affected: i64 = 0;
        for item in &matches {
            let mut conds = Vec::with_capacity(pk.len());
            let mut params = Vec::with_capacity(pk.len());
            let mut have_full_key = true;
            for attr in &pk {
                match item.get(attr) {
                    Some(av) => {
                        conds.push(format!("{} = ?", Self::quote_ident(attr)));
                        params.push(av.clone());
                    }
                    None => {
                        have_full_key = false;
                        break;
                    }
                }
            }
            if !have_full_key {
                continue;
            }
            let key_clause = conds.join(" AND ");
            let statement = match kind {
                DmlKind::Update => format!("{head} WHERE {key_clause}"),
                DmlKind::Delete => {
                    format!("DELETE FROM {} WHERE {key_clause}", Self::quote_ident(&table))
                }
            };
            client
                .execute_statement()
                .statement(statement)
                .set_parameters(Some(params))
                .send()
                .await
                .map_err(Self::query_err)?;
            affected += 1;
        }

        let mut result = QueryResult::empty();
        result.rows_affected = Some(affected);
        result.statement_type = crate::StatementType::Mutation;
        result.elapsed = started.elapsed().as_secs_f64();
        Ok(result)
    }
}

#[async_trait]
impl DatabaseDriver for DynamoDbDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        let mut loader = aws_config::defaults(BehaviorVersion::latest());

        let region = config.database.trim();
        if !region.is_empty() {
            loader = loader.region(Region::new(region.to_owned()));
        }

        let access_key = config.user.trim();
        if !access_key.is_empty() {
            let session_token = {
                let token = config.options.trim();
                (!token.is_empty()).then(|| token.to_owned())
            };
            let creds = Credentials::new(
                access_key.to_owned(),
                config.password.clone(),
                session_token,
                None,
                "arris-static",
            );
            loader = loader.credentials_provider(creds);
        }

        let endpoint = config.host.trim();
        if !endpoint.is_empty() {
            loader = loader.endpoint_url(endpoint.to_owned());
        }

        let sdk_config = loader.load().await;
        let client = Client::new(&sdk_config);

        // Verify region + credentials reach DynamoDB now rather than on first
        // query (the SDK is otherwise lazy).
        client
            .list_tables()
            .limit(1)
            .send()
            .await
            .map_err(Self::conn_err)?;

        *self.inner.lock().await = Some(client);
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    fn pagination_strategy(&self) -> crate::PaginationStrategy {
        // PartiQL has no derived-table / subquery support, so the SQL cannot be
        // wrapped as `SELECT * FROM (<sql>) LIMIT … OFFSET …`. The driver
        // paginates natively via NextToken; the engine must not re-paginate.
        crate::PaginationStrategy::None
    }

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        let client = self.client().await?;

        let mut table_names: Vec<String> = Vec::new();
        let mut start: Option<String> = None;
        loop {
            let out = client
                .list_tables()
                .set_exclusive_start_table_name(start.clone())
                .send()
                .await
                .map_err(Self::query_err)?;
            table_names.extend(out.table_names().iter().cloned());
            match out.last_evaluated_table_name() {
                Some(name) => start = Some(name.to_owned()),
                None => break,
            }
        }
        table_names.sort();

        let mut nodes = Vec::with_capacity(table_names.len());
        for name in table_names {
            let desc = client
                .describe_table()
                .table_name(&name)
                .send()
                .await
                .map_err(Self::query_err)?;
            let Some(table) = desc.table() else { continue };

            // Declared key attributes carry a scalar type (S/N/B); map it to a
            // friendly label for column detail.
            let key_types: HashMap<&str, &ScalarAttributeType> = table
                .attribute_definitions()
                .iter()
                .map(|a| (a.attribute_name(), a.attribute_type()))
                .collect();
            let scalar_label = |t: &ScalarAttributeType| match t {
                ScalarAttributeType::S => "string",
                ScalarAttributeType::N => "number",
                ScalarAttributeType::B => "binary",
                _ => "scalar",
            };

            let key_names: IndexSet<&str> =
                table.key_schema().iter().map(|k| k.attribute_name()).collect();

            // DynamoDB is schemaless, so only key attributes are declared. Sample
            // a page of items to surface the non-key attributes (and their types)
            // that exist on real rows.
            let sample = client
                .scan()
                .table_name(&name)
                .limit(SCHEMA_SAMPLE_SIZE)
                .send()
                .await
                .map_err(Self::query_err)?;
            let mut sampled_types: IndexSet<String> = IndexSet::new();
            let mut attr_type: HashMap<String, &'static str> = HashMap::new();
            for item in sample.items() {
                for (attr, value) in item {
                    if key_names.contains(attr.as_str()) {
                        continue;
                    }
                    sampled_types.insert(attr.clone());
                    let entry = attr_type.entry(attr.clone()).or_insert("null");
                    if *entry == "null" && !matches!(value, AttributeValue::Null(_)) {
                        *entry = type_name(value);
                    }
                }
            }
            sampled_types.sort();

            let mut children: Vec<SchemaNode> = Vec::new();
            for key in table.key_schema() {
                let role = match key.key_type() {
                    KeyType::Hash => "partition key",
                    KeyType::Range => "sort key",
                    _ => "key",
                };
                let attr = key.attribute_name();
                let ty = key_types.get(attr).map(|t| scalar_label(t)).unwrap_or("scalar");
                let path = format!("{name}.{attr}");
                children.push(
                    SchemaNode::new(attr, SchemaNodeKind::Column, path)
                        .with_detail(format!("{role}, {ty}")),
                );
            }
            for attr in &sampled_types {
                let ty = attr_type.get(attr).copied().unwrap_or("null");
                let path = format!("{name}.{attr}");
                children.push(
                    SchemaNode::new(attr.clone(), SchemaNodeKind::Column, path).with_detail(ty),
                );
            }

            for gsi in table.global_secondary_indexes() {
                let index_name = gsi.index_name().unwrap_or("index");
                let keys: Vec<String> = gsi
                    .key_schema()
                    .iter()
                    .map(|k| k.attribute_name().to_owned())
                    .collect();
                let path = format!("{name}.__index__.{index_name}");
                children.push(
                    SchemaNode::new(index_name, SchemaNodeKind::Index, path)
                        .with_detail(format!("GSI on {}", keys.join(", "))),
                );
            }

            nodes.push(
                SchemaNode::new(name.clone(), SchemaNodeKind::Table, name).with_children(children),
            );
        }
        Ok(nodes)
    }

    async fn list_schema(&self, schema: &str) -> Result<Vec<SchemaNode>> {
        let all = self.list_schemas().await?;
        Ok(crate::drivers::common::schema::find_schema_node(&all, schema))
    }

    async fn run_query(
        &self,
        text: &str,
        params: &[QueryValue],
        _language: QueryLanguage,
    ) -> Result<QueryResult> {
        let client = self.client().await?;
        let started = Instant::now();
        let partiql_params = Self::partiql_params(params);
        if Self::is_read(text) {
            return self.run_read(&client, text, partiql_params, started).await;
        }
        // PartiQL UPDATE/DELETE only accept a full primary-key equality WHERE.
        // When the statement filters on anything else, emulate row-set semantics
        // by selecting matching keys and re-issuing one keyed statement per row.
        if let Some(kind) = Self::dml_kind(text) {
            if let Some((head, condition)) = Self::split_where(text) {
                return self
                    .run_conditional_dml(&client, kind, head, condition, partiql_params, started)
                    .await;
            }
        }
        // Standard SQL `INSERT ... VALUES (...)` is not PartiQL (which uses the
        // singular `VALUE {...}` document form), so translate it into one keyed
        // PartiQL insert per row.
        if Self::is_standard_insert(text) {
            return self.run_standard_insert(&client, text, started).await;
        }
        self.run_write(&client, text, partiql_params, started).await
    }

    async fn explain_query(
        &self,
        _text: &str,
        _params: &[QueryValue],
        _language: QueryLanguage,
        _mode: ExplainMode,
    ) -> Result<PlanResult> {
        Err(DriverError::ExplainUnsupported)
    }

    async fn supports_explain(&self, _mode: ExplainMode) -> bool {
        false
    }

    async fn primary_key(&self, table: &TableRef) -> Result<Option<Vec<String>>> {
        let client = self.client().await?;
        let keys = Self::pk_attrs(&client, &table.name).await?;
        Ok((!keys.is_empty()).then_some(keys))
    }

    async fn update_row(
        &self,
        table: &TableRef,
        primary_key: &ValueMap,
        changes: &ValueMap,
    ) -> Result<MutationResult> {
        if changes.is_empty() {
            return Ok(MutationResult::default());
        }
        let client = self.client().await?;
        let key = Self::key_from(primary_key)?;

        let mut names: HashMap<String, String> = HashMap::new();
        let mut values: HashMap<String, AttributeValue> = HashMap::new();
        let mut sets: Vec<String> = Vec::new();
        for (i, (col, value)) in changes.iter().enumerate() {
            let name_placeholder = format!("#k{i}");
            let value_placeholder = format!(":v{i}");
            names.insert(name_placeholder.clone(), col.clone());
            values.insert(value_placeholder.clone(), attr_value(value));
            sets.push(format!("{name_placeholder} = {value_placeholder}"));
        }
        let update_expression = format!("SET {}", sets.join(", "));

        client
            .update_item()
            .table_name(&table.name)
            .set_key(Some(key))
            .update_expression(&update_expression)
            .set_expression_attribute_names(Some(names))
            .set_expression_attribute_values(Some(values))
            .send()
            .await
            .map_err(Self::query_err)?;

        Ok(MutationResult {
            rows_affected: 1,
            statements: vec![format!("UpdateItem {} {}", table.name, update_expression)],
        })
    }

    async fn insert_rows(&self, table: &TableRef, inserts: &[RowInsert]) -> Result<MutationResult> {
        if inserts.is_empty() {
            return Ok(MutationResult::default());
        }
        let client = self.client().await?;
        let mut result = MutationResult::default();
        for insert in inserts {
            let item: HashMap<String, AttributeValue> = insert
                .values
                .iter()
                .map(|(k, v)| (k.clone(), attr_value(v)))
                .collect();
            client
                .put_item()
                .table_name(&table.name)
                .set_item(Some(item))
                .send()
                .await
                .map_err(Self::query_err)?;
            result.rows_affected += 1;
            result.statements.push(format!("PutItem {}", table.name));
        }
        Ok(result)
    }

    async fn delete_rows(&self, table: &TableRef, deletes: &[RowDelete]) -> Result<MutationResult> {
        if deletes.is_empty() {
            return Ok(MutationResult::default());
        }
        let client = self.client().await?;
        let mut result = MutationResult::default();
        for delete in deletes {
            let key = Self::key_from(&delete.primary_key)?;
            client
                .delete_item()
                .table_name(&table.name)
                .set_key(Some(key))
                .send()
                .await
                .map_err(Self::query_err)?;
            result.rows_affected += 1;
            result.statements.push(format!("DeleteItem {}", table.name));
        }
        Ok(result)
    }

    async fn close(&self) {
        *self.inner.lock().await = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn driver_starts_disconnected() {
        let d = DynamoDbDriver::new();
        let connected = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(d.is_connected());
        assert!(!connected);
    }

    #[test]
    fn pagination_strategy_is_none() {
        let d = DynamoDbDriver::new();
        assert_eq!(d.pagination_strategy(), crate::PaginationStrategy::None);
    }

    #[test]
    fn is_read_detects_select_case_insensitively() {
        assert!(DynamoDbDriver::is_read("SELECT * FROM t"));
        assert!(DynamoDbDriver::is_read("  select * from t"));
        assert!(DynamoDbDriver::is_read("SeLeCt a FROM t"));
    }

    #[test]
    fn is_read_rejects_writes() {
        assert!(!DynamoDbDriver::is_read("INSERT INTO t VALUE {'id': 1}"));
        assert!(!DynamoDbDriver::is_read("UPDATE t SET a = 1 WHERE id = 1"));
        assert!(!DynamoDbDriver::is_read("DELETE FROM t WHERE id = 1"));
        assert!(!DynamoDbDriver::is_read(""));
    }

    #[test]
    fn partiql_params_empty_is_none() {
        assert!(DynamoDbDriver::partiql_params(&[]).is_none());
    }

    #[test]
    fn partiql_params_maps_each_value() {
        let params = vec![QueryValue::Int(1), QueryValue::Text("x".into())];
        let mapped = DynamoDbDriver::partiql_params(&params).unwrap();
        assert_eq!(mapped.len(), 2);
        assert!(matches!(&mapped[0], AttributeValue::N(n) if n == "1"));
        assert!(matches!(&mapped[1], AttributeValue::S(s) if s == "x"));
    }

    #[test]
    fn key_from_empty_errors() {
        let pk = ValueMap::new();
        let err = DynamoDbDriver::key_from(&pk).unwrap_err();
        assert!(matches!(err, DriverError::InvalidArgument(_)));
    }

    #[test]
    fn key_from_builds_attribute_map() {
        let mut pk = ValueMap::new();
        pk.insert("id".into(), QueryValue::Int(7));
        pk.insert("sk".into(), QueryValue::Text("a".into()));
        let key = DynamoDbDriver::key_from(&pk).unwrap();
        assert!(matches!(key.get("id"), Some(AttributeValue::N(n)) if n == "7"));
        assert!(matches!(key.get("sk"), Some(AttributeValue::S(s)) if s == "a"));
    }

    #[test]
    fn dml_kind_detects_update_and_delete() {
        assert!(matches!(
            DynamoDbDriver::dml_kind("UPDATE t SET a = 1 WHERE id = 2"),
            Some(DmlKind::Update)
        ));
        assert!(matches!(
            DynamoDbDriver::dml_kind("  delete from t where id = 2"),
            Some(DmlKind::Delete)
        ));
        assert!(DynamoDbDriver::dml_kind("SELECT * FROM t").is_none());
        assert!(DynamoDbDriver::dml_kind("INSERT INTO t VALUE {}").is_none());
        // word boundary: `UPDATED` is not `UPDATE`.
        assert!(DynamoDbDriver::dml_kind("UPDATED x").is_none());
    }

    #[test]
    fn split_where_splits_at_top_level_keyword() {
        let (head, cond) =
            DynamoDbDriver::split_where("UPDATE customers SET first_name = 'Manfred' WHERE id < 5;")
                .unwrap();
        assert_eq!(head, "UPDATE customers SET first_name = 'Manfred'");
        assert_eq!(cond, "id < 5");
    }

    #[test]
    fn split_where_ignores_where_inside_string_literal() {
        // The literal contains "where" but the real clause is the trailing one.
        let (head, cond) =
            DynamoDbDriver::split_where("UPDATE t SET note = 'where now' WHERE id = 1").unwrap();
        assert_eq!(head, "UPDATE t SET note = 'where now'");
        assert_eq!(cond, "id = 1");
    }

    #[test]
    fn split_where_none_when_absent() {
        assert!(DynamoDbDriver::split_where("DELETE FROM t").is_none());
    }

    #[test]
    fn target_table_extracts_name_per_verb() {
        assert_eq!(
            DynamoDbDriver::target_table("UPDATE customers SET a = 1", DmlKind::Update).as_deref(),
            Some("customers")
        );
        assert_eq!(
            DynamoDbDriver::target_table("DELETE FROM \"Orders\"", DmlKind::Delete).as_deref(),
            Some("Orders")
        );
    }

    #[test]
    fn quote_ident_doubles_embedded_quotes() {
        assert_eq!(DynamoDbDriver::quote_ident("orders"), "\"orders\"");
        assert_eq!(DynamoDbDriver::quote_ident("a\"b"), "\"a\"\"b\"");
    }

    #[test]
    fn projection_list_parses_explicit_columns_in_order() {
        let cols = DynamoDbDriver::projection_list(
            "SELECT customer_id, country_code, email FROM customers WHERE country_code = 'US'",
        )
        .unwrap();
        assert_eq!(cols, vec!["customer_id", "country_code", "email"]);
    }

    #[test]
    fn projection_list_unquotes_and_handles_alias() {
        let cols =
            DynamoDbDriver::projection_list("SELECT \"first_name\", last_name AS surname FROM t")
                .unwrap();
        assert_eq!(cols, vec!["first_name", "surname"]);
    }

    #[test]
    fn projection_list_none_for_star_or_non_select() {
        assert!(DynamoDbDriver::projection_list("SELECT * FROM t").is_none());
        assert!(DynamoDbDriver::projection_list("SELECT a, * FROM t").is_none());
        assert!(DynamoDbDriver::projection_list("UPDATE t SET a = 1 WHERE id = 2").is_none());
    }

    #[test]
    fn keyword_pos_ignores_quoted_and_substrings() {
        // FROM inside a string literal is skipped; the real FROM is found.
        let pos = DynamoDbDriver::keyword_pos("SELECT 'from here' FROM t", "FROM").unwrap();
        assert_eq!(&"SELECT 'from here' FROM t"[pos..pos + 4], "FROM");
        // No false match on a substring like `FROMAGE`.
        assert!(DynamoDbDriver::keyword_pos("SELECT fromage FROM t", "FROM").unwrap() > 10);
    }

    #[test]
    fn split_top_level_commas_respects_parens_and_quotes() {
        let parts = DynamoDbDriver::split_top_level_commas("a, f(b, c), 'x,y', d");
        assert_eq!(parts, vec!["a", " f(b, c)", " 'x,y'", " d"]);
    }

    #[test]
    fn shape_items_follows_projection_order() {
        let mut item = HashMap::new();
        item.insert("email".to_owned(), AttributeValue::S("a@b.com".into()));
        item.insert("customer_id".to_owned(), AttributeValue::N("9".into()));
        item.insert("country_code".to_owned(), AttributeValue::S("US".into()));
        let order = vec![
            "customer_id".to_owned(),
            "country_code".to_owned(),
            "email".to_owned(),
        ];
        let (cols, rows) = DynamoDbDriver::shape_items(&[item], Some(&order));
        let names: Vec<&str> = cols.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["customer_id", "country_code", "email"]);
        // Types inferred from values, row values aligned to the column order.
        assert_eq!(cols[0].type_hint, "number");
        assert_eq!(rows[0][0], QueryValue::Int(9));
        assert_eq!(rows[0][2], QueryValue::Text("a@b.com".into()));
    }

    #[test]
    fn shape_items_discovers_sorted_order_without_projection() {
        let mut item = HashMap::new();
        item.insert("zebra".to_owned(), AttributeValue::S("z".into()));
        item.insert("apple".to_owned(), AttributeValue::S("a".into()));
        let (cols, _) = DynamoDbDriver::shape_items(&[item], None);
        let names: Vec<&str> = cols.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["apple", "zebra"]);
    }

    #[test]
    fn is_standard_insert_distinguishes_from_native_partiql() {
        assert!(DynamoDbDriver::is_standard_insert(
            "INSERT INTO products (a, b) VALUES (1, 2)"
        ));
        // Native PartiQL `VALUE {...}` (singular) passes straight through.
        assert!(!DynamoDbDriver::is_standard_insert(
            "INSERT INTO \"products\" VALUE {'a': 1}"
        ));
        assert!(!DynamoDbDriver::is_standard_insert("SELECT * FROM products"));
    }

    #[test]
    fn parse_sql_literal_handles_each_scalar() {
        assert!(matches!(DynamoDbDriver::parse_sql_literal("null"), Ok(AttributeValue::Null(true))));
        assert!(matches!(DynamoDbDriver::parse_sql_literal("TRUE"), Ok(AttributeValue::Bool(true))));
        match DynamoDbDriver::parse_sql_literal("-1").unwrap() {
            AttributeValue::N(n) => assert_eq!(n, "-1"),
            other => panic!("expected N, got {other:?}"),
        }
        match DynamoDbDriver::parse_sql_literal("'it''s'").unwrap() {
            AttributeValue::S(s) => assert_eq!(s, "it's"),
            other => panic!("expected S, got {other:?}"),
        }
        assert!(DynamoDbDriver::parse_sql_literal("col_ref").is_err());
    }

    #[test]
    fn build_insert_plan_parses_columns_and_rows() {
        let plan = DynamoDbDriver::build_insert_plan(
            "INSERT INTO products (product_id, category, price, product_name) VALUES (9, 'test', -1, 'hello');",
        )
        .unwrap();
        assert_eq!(plan.table, "products");
        assert_eq!(plan.columns, vec!["product_id", "category", "price", "product_name"]);
        assert_eq!(plan.rows.len(), 1);
        assert!(matches!(&plan.rows[0][0], AttributeValue::N(n) if n == "9"));
        assert!(matches!(&plan.rows[0][1], AttributeValue::S(s) if s == "test"));
        assert!(matches!(&plan.rows[0][2], AttributeValue::N(n) if n == "-1"));
    }

    #[test]
    fn build_insert_plan_supports_multi_row() {
        let plan = DynamoDbDriver::build_insert_plan(
            "INSERT INTO t (id, name) VALUES (1, 'a'), (2, 'b')",
        )
        .unwrap();
        assert_eq!(plan.rows.len(), 2);
        assert!(matches!(&plan.rows[1][0], AttributeValue::N(n) if n == "2"));
        assert!(matches!(&plan.rows[1][1], AttributeValue::S(s) if s == "b"));
    }

    #[test]
    fn build_insert_plan_errors_on_arity_mismatch_and_missing_columns() {
        assert!(DynamoDbDriver::build_insert_plan("INSERT INTO t (a, b) VALUES (1)").is_err());
        assert!(DynamoDbDriver::build_insert_plan("INSERT INTO t VALUES (1, 2)").is_err());
    }

    #[test]
    fn split_order_by_strips_clause_and_parses_terms() {
        let (stmt, terms) = DynamoDbDriver::split_order_by(
            "SELECT * FROM products WHERE product_id > 5 ORDER BY product_id DESC;",
        );
        assert_eq!(stmt, "SELECT * FROM products WHERE product_id > 5");
        assert_eq!(terms, vec![("product_id".to_owned(), true)]);
    }

    #[test]
    fn split_order_by_handles_multiple_and_default_asc() {
        let (_, terms) =
            DynamoDbDriver::split_order_by("SELECT * FROM t ORDER BY \"a\", b DESC");
        assert_eq!(terms, vec![("a".to_owned(), false), ("b".to_owned(), true)]);
    }

    #[test]
    fn split_order_by_none_when_absent() {
        let (stmt, terms) = DynamoDbDriver::split_order_by("SELECT * FROM t");
        assert_eq!(stmt, "SELECT * FROM t");
        assert!(terms.is_empty());
    }

    #[test]
    fn sort_items_orders_numbers_descending() {
        let mk = |id: &str| {
            let mut m = HashMap::new();
            m.insert("product_id".to_owned(), AttributeValue::N(id.into()));
            m
        };
        let mut items = vec![mk("6"), mk("11"), mk("7"), mk("10")];
        DynamoDbDriver::sort_items(&mut items, &[("product_id".to_owned(), true)]);
        let ids: Vec<&str> = items
            .iter()
            .map(|i| match i.get("product_id") {
                Some(AttributeValue::N(n)) => n.as_str(),
                _ => "",
            })
            .collect();
        // Numeric, not lexical: 11 > 10 > 7 > 6.
        assert_eq!(ids, vec!["11", "10", "7", "6"]);
    }
}
