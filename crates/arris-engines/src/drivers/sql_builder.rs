//! Shared SQL builders used by SQL drivers (postgres, sqlite, mysql, mssql,
//! oracle, redshift, duckdb). Each driver supplies its own identifier-quoting
//! function (`identifier_quoter`) and parameter placeholder generator
//! (`placeholder`) so the same logic produces dialect-correct DML.

use indexmap::IndexMap;

use crate::{QueryValue, TableRef};

pub type Quoter = fn(&str) -> String;
pub type Placeholder = fn(usize) -> String;

pub type BuilderOutput = (String, Vec<QueryValue>);

pub struct SqlBuilder;

impl SqlBuilder {
    /// Quotes `name` using PostgreSQL-style double quotes. Escapes embedded `"`.
    pub fn quote_double(name: &str) -> String {
        let escaped = name.replace('"', "\"\"");
        format!("\"{escaped}\"")
    }

    /// Quotes `name` using MySQL-style backticks.
    pub fn quote_backtick(name: &str) -> String {
        let escaped = name.replace('`', "``");
        format!("`{escaped}`")
    }

    /// No quoting — returns the identifier as-is. For drivers (e.g. oracle-rs)
    /// where double-quoted identifiers cause protocol-level failures.
    pub fn quote_none(name: &str) -> String {
        name.to_owned()
    }

    /// Quotes `name` using SQL Server-style brackets.
    pub fn quote_bracket(name: &str) -> String {
        let escaped = name.replace(']', "]]");
        format!("[{escaped}]")
    }

    /// PostgreSQL-style placeholder (`$1`, `$2`, …). Index is **1-based**.
    pub fn placeholder_dollar(idx: usize) -> String {
        format!("${idx}")
    }

    /// MySQL / SQLite question-mark placeholder (no index).
    pub fn placeholder_qmark(_idx: usize) -> String {
        "?".to_owned()
    }

    /// MSSQL / Tiberius-style placeholder (`@P1`, `@P2`, …). Index is **1-based**.
    pub fn placeholder_at_p(idx: usize) -> String {
        format!("@P{idx}")
    }

    /// Oracle-style placeholder (`:1`, `:2`, …). Index is **1-based**.
    pub fn placeholder_colon_n(idx: usize) -> String {
        format!(":{idx}")
    }

    /// Renders a fully-qualified table reference using `quoter`.
    pub fn render_table(table: &TableRef, quoter: Quoter) -> String {
        let mut parts = Vec::new();
        if let Some(d) = &table.database {
            parts.push(quoter(d));
        }
        if let Some(s) = &table.schema {
            parts.push(quoter(s));
        }
        parts.push(quoter(&table.name));
        parts.join(".")
    }

    /// Builds an UPDATE statement: `UPDATE <t> SET c=?,c=? WHERE pk=? AND pk=?`.
    pub fn build_update(
        table: &TableRef,
        primary_key: &IndexMap<String, QueryValue>,
        changes: &IndexMap<String, QueryValue>,
        quoter: Quoter,
        placeholder: Placeholder,
    ) -> Result<BuilderOutput, &'static str> {
        if primary_key.is_empty() {
            return Err("primary key cannot be empty");
        }
        if changes.is_empty() {
            return Err("changes cannot be empty");
        }

        let mut params: Vec<QueryValue> = Vec::with_capacity(changes.len() + primary_key.len());
        let mut sql = String::with_capacity(64);
        sql.push_str("UPDATE ");
        sql.push_str(&Self::render_table(table, quoter));
        sql.push_str(" SET ");

        let mut first = true;
        for (col, val) in changes {
            if !first {
                sql.push_str(", ");
            }
            first = false;
            sql.push_str(&quoter(col));
            sql.push('=');
            params.push(val.clone().coerce_text());
            sql.push_str(&placeholder(params.len()));
        }

        sql.push_str(" WHERE ");
        let mut first = true;
        for (col, val) in primary_key {
            if !first {
                sql.push_str(" AND ");
            }
            first = false;
            sql.push_str(&quoter(col));
            sql.push('=');
            params.push(val.clone().coerce_text());
            sql.push_str(&placeholder(params.len()));
        }

        Ok((sql, params))
    }

    /// Builds an INSERT statement: `INSERT INTO <t>(c,c) VALUES (?, ?)`.
    pub fn build_insert(
        table: &TableRef,
        values: &IndexMap<String, QueryValue>,
        quoter: Quoter,
        placeholder: Placeholder,
    ) -> Result<BuilderOutput, &'static str> {
        if values.is_empty() {
            return Err("insert must have at least one column");
        }
        let mut params: Vec<QueryValue> = Vec::with_capacity(values.len());
        let mut sql = String::with_capacity(64);
        sql.push_str("INSERT INTO ");
        sql.push_str(&Self::render_table(table, quoter));
        sql.push_str(" (");
        let mut first = true;
        for col in values.keys() {
            if !first {
                sql.push_str(", ");
            }
            first = false;
            sql.push_str(&quoter(col));
        }
        sql.push_str(") VALUES (");
        let mut first = true;
        for val in values.values() {
            if !first {
                sql.push_str(", ");
            }
            first = false;
            params.push(val.clone().coerce_text());
            sql.push_str(&placeholder(params.len()));
        }
        sql.push(')');
        Ok((sql, params))
    }

    /// Builds a DELETE statement scoped by primary key.
    pub fn build_delete(
        table: &TableRef,
        primary_key: &IndexMap<String, QueryValue>,
        quoter: Quoter,
        placeholder: Placeholder,
    ) -> Result<BuilderOutput, &'static str> {
        if primary_key.is_empty() {
            return Err("primary key cannot be empty");
        }
        let mut params: Vec<QueryValue> = Vec::with_capacity(primary_key.len());
        let mut sql = String::with_capacity(64);
        sql.push_str("DELETE FROM ");
        sql.push_str(&Self::render_table(table, quoter));
        sql.push_str(" WHERE ");
        let mut first = true;
        for (col, val) in primary_key {
            if !first {
                sql.push_str(" AND ");
            }
            first = false;
            sql.push_str(&quoter(col));
            sql.push('=');
            params.push(val.clone().coerce_text());
            sql.push_str(&placeholder(params.len()));
        }
        Ok((sql, params))
    }

    fn format_value(v: &QueryValue) -> String {
        match v {
            QueryValue::Null => "NULL".into(),
            QueryValue::Bool(b) => b.to_string(),
            QueryValue::Int(i) => i.to_string(),
            QueryValue::Double(f) => f.to_string(),
            QueryValue::Text(s) => format!("'{}'", s.replace('\'', "''")),
            QueryValue::Data(d) => {
                let hex: String = d.iter().map(|b| format!("{b:02x}")).collect();
                format!("'\\x{hex}'")
            }
            QueryValue::Json(s) => format!("'{}'", s.replace('\'', "''")),
            // Exact decimal: inline as a bare numeric literal (unquoted).
            QueryValue::Decimal(s) => s.clone(),
        }
    }

    /// Replace `$1`, `$2`, … (or `?`) placeholders with formatted param values.
    pub fn interpolate_params(sql: &str, params: &[QueryValue]) -> String {
        let mut out = sql.to_owned();
        // Replace @PN (1-indexed, mssql) in reverse order so @P10 doesn't collide with @P1.
        for (i, val) in params.iter().enumerate().rev() {
            let placeholder = format!("@P{}", i + 1);
            out = out.replace(&placeholder, &Self::format_value(val));
        }
        // Replace :N (1-indexed, oracle) in reverse order so :10 doesn't collide with :1.
        for (i, val) in params.iter().enumerate().rev() {
            let placeholder = format!(":{}", i + 1);
            out = out.replace(&placeholder, &Self::format_value(val));
        }
        // Replace $N (1-indexed) in reverse order so $10 doesn't collide with $1.
        for (i, val) in params.iter().enumerate().rev() {
            let placeholder = format!("${}", i + 1);
            out = out.replace(&placeholder, &Self::format_value(val));
        }
        // Also handle `?` sequential placeholders (sqlite/mysql).
        if out.contains('?') && !params.is_empty() {
            let mut result = String::with_capacity(out.len());
            let mut idx = 0;
            for ch in out.chars() {
                if ch == '?' && idx < params.len() {
                    result.push_str(&Self::format_value(&params[idx]));
                    idx += 1;
                } else {
                    result.push(ch);
                }
            }
            return result;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(value: i64) -> IndexMap<String, QueryValue> {
        let mut m = IndexMap::new();
        m.insert("id".into(), QueryValue::Int(value));
        m
    }

    fn changes(name: &str) -> IndexMap<String, QueryValue> {
        let mut m = IndexMap::new();
        m.insert("name".into(), QueryValue::Text(name.into()));
        m.insert("age".into(), QueryValue::Int(40));
        m
    }

    #[test]
    fn double_quote_escapes_embedded_quote() {
        assert_eq!(SqlBuilder::quote_double("a\"b"), "\"a\"\"b\"");
    }

    #[test]
    fn backtick_escapes_embedded_backtick() {
        assert_eq!(SqlBuilder::quote_backtick("a`b"), "`a``b`");
    }

    #[test]
    fn bracket_escapes_embedded_close_bracket() {
        assert_eq!(SqlBuilder::quote_bracket("a]b"), "[a]]b]");
    }

    #[test]
    fn render_table_with_schema() {
        let t = TableRef::schema_qualified("public", "users");
        assert_eq!(
            SqlBuilder::render_table(&t, SqlBuilder::quote_double),
            "\"public\".\"users\""
        );
    }

    #[test]
    fn render_table_with_database_and_schema() {
        let t = TableRef::fully_qualified("app", "public", "users");
        assert_eq!(
            SqlBuilder::render_table(&t, SqlBuilder::quote_double),
            "\"app\".\"public\".\"users\""
        );
    }

    #[test]
    fn build_update_postgres_dollar_placeholders() {
        let t = TableRef::schema_qualified("public", "users");
        let (sql, params) = SqlBuilder::build_update(
            &t,
            &pk(1),
            &changes("Alice"),
            SqlBuilder::quote_double,
            SqlBuilder::placeholder_dollar,
        )
        .unwrap();
        assert_eq!(
            sql,
            "UPDATE \"public\".\"users\" SET \"name\"=$1, \"age\"=$2 WHERE \"id\"=$3"
        );
        assert_eq!(params.len(), 3);
        assert_eq!(params[0], QueryValue::Text("Alice".into()));
        assert_eq!(params[1], QueryValue::Int(40));
        assert_eq!(params[2], QueryValue::Int(1));
    }

    #[test]
    fn build_update_sqlite_qmark_placeholders() {
        let t = TableRef::new("users");
        let (sql, params) = SqlBuilder::build_update(
            &t,
            &pk(7),
            &changes("Bob"),
            SqlBuilder::quote_double,
            SqlBuilder::placeholder_qmark,
        )
        .unwrap();
        assert_eq!(
            sql,
            "UPDATE \"users\" SET \"name\"=?, \"age\"=? WHERE \"id\"=?"
        );
        assert_eq!(params.len(), 3);
    }

    #[test]
    fn build_update_rejects_empty_changes() {
        let t = TableRef::new("users");
        let err = SqlBuilder::build_update(
            &t,
            &pk(1),
            &IndexMap::new(),
            SqlBuilder::quote_double,
            SqlBuilder::placeholder_dollar,
        )
        .unwrap_err();
        assert!(err.contains("changes"));
    }

    #[test]
    fn build_update_rejects_empty_pk() {
        let t = TableRef::new("users");
        let err = SqlBuilder::build_update(
            &t,
            &IndexMap::new(),
            &changes("X"),
            SqlBuilder::quote_double,
            SqlBuilder::placeholder_dollar,
        )
        .unwrap_err();
        assert!(err.contains("primary key"));
    }

    #[test]
    fn build_update_composite_pk() {
        let t = TableRef::new("memberships");
        let mut pk_m = IndexMap::new();
        pk_m.insert("group_id".into(), QueryValue::Int(1));
        pk_m.insert("user_id".into(), QueryValue::Int(2));
        let mut chg = IndexMap::new();
        chg.insert("role".into(), QueryValue::Text("owner".into()));
        let (sql, _) = SqlBuilder::build_update(
            &t,
            &pk_m,
            &chg,
            SqlBuilder::quote_double,
            SqlBuilder::placeholder_dollar,
        )
        .unwrap();
        assert_eq!(
            sql,
            "UPDATE \"memberships\" SET \"role\"=$1 WHERE \"group_id\"=$2 AND \"user_id\"=$3"
        );
    }

    #[test]
    fn build_insert_postgres_form() {
        let t = TableRef::schema_qualified("public", "users");
        let mut vals = IndexMap::new();
        vals.insert("name".into(), QueryValue::Text("Alice".into()));
        vals.insert("age".into(), QueryValue::Int(30));
        let (sql, params) = SqlBuilder::build_insert(
            &t,
            &vals,
            SqlBuilder::quote_double,
            SqlBuilder::placeholder_dollar,
        )
        .unwrap();
        assert_eq!(
            sql,
            "INSERT INTO \"public\".\"users\" (\"name\", \"age\") VALUES ($1, $2)"
        );
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn build_insert_rejects_empty() {
        let t = TableRef::new("users");
        let err = SqlBuilder::build_insert(
            &t,
            &IndexMap::new(),
            SqlBuilder::quote_double,
            SqlBuilder::placeholder_dollar,
        )
        .unwrap_err();
        assert!(err.contains("at least one"));
    }

    #[test]
    fn build_delete_postgres_form() {
        let t = TableRef::schema_qualified("public", "users");
        let (sql, params) = SqlBuilder::build_delete(
            &t,
            &pk(42),
            SqlBuilder::quote_double,
            SqlBuilder::placeholder_dollar,
        )
        .unwrap();
        assert_eq!(sql, "DELETE FROM \"public\".\"users\" WHERE \"id\"=$1");
        assert_eq!(params.len(), 1);
        assert_eq!(params[0], QueryValue::Int(42));
    }

    #[test]
    fn build_delete_rejects_empty_pk() {
        let t = TableRef::new("users");
        let err = SqlBuilder::build_delete(
            &t,
            &IndexMap::new(),
            SqlBuilder::quote_double,
            SqlBuilder::placeholder_dollar,
        )
        .unwrap_err();
        assert!(err.contains("primary key"));
    }

    #[test]
    fn quoter_table_dispatch_for_mysql() {
        let t = TableRef::schema_qualified("app", "orders");
        assert_eq!(
            SqlBuilder::render_table(&t, SqlBuilder::quote_backtick),
            "`app`.`orders`"
        );
    }

    #[test]
    fn quoter_table_dispatch_for_mssql() {
        let t = TableRef::schema_qualified("dbo", "orders");
        assert_eq!(
            SqlBuilder::render_table(&t, SqlBuilder::quote_bracket),
            "[dbo].[orders]"
        );
    }
}
