//! Dialect-aware set-diff SQL builder for dbt slim-CI.
//!
//! Given a prod relation, a "new side" SELECT (the modified model's output) and
//! the set of columns shared by both, this builds the warehouse SQL that counts
//! and samples rows that exist on only one side. The diff is pushed down to the
//! warehouse — no rows are pulled into the host process.
//!
//! Every relational warehouse Arris drives is supported. The genuine per-dialect
//! divergences (identifier quoting, set-difference operator, row limiting) are
//! captured by [`DiffDialect`]; the builder is otherwise dialect-agnostic. The
//! set-difference is expressed so it works even on engines without native
//! `EXCEPT` (MySQL/MariaDB use a NULL-safe anti-join instead) and keyed-row
//! membership uses correlated `EXISTS` rather than row-value `IN` (which MSSQL
//! does not support against a subquery).

use crate::{DatabaseKind, QueryValue};

/// The SQL-dialect knobs the diff builder varies on. Most warehouses share the
/// "standard" shape (`"`-quoted identifiers, native `EXCEPT`/`INTERSECT`,
/// trailing `LIMIT`); the other variants capture the documented divergences.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum DiffDialect {
    /// `"`-quoted identifiers, native `EXCEPT`/`INTERSECT`, trailing `LIMIT`.
    /// Postgres, DuckDB, SQLite, Snowflake, Redshift, Trino.
    Standard,
    /// `"`-quoted, `MINUS` for set-difference, `FETCH FIRST n ROWS ONLY`. Oracle.
    Oracle,
    /// Backtick-quoted, `EXCEPT DISTINCT`/`INTERSECT DISTINCT`, trailing `LIMIT`.
    /// BigQuery (bare `EXCEPT` is rejected) and ClickHouse (bare `EXCEPT`
    /// defaults to `ALL`).
    Backtick,
    /// Backtick-quoted, NULL-safe anti-join/semi-join in place of `EXCEPT`/
    /// `INTERSECT` (absent before MySQL 8.0.31 / MariaDB 10.3), trailing `LIMIT`.
    /// MySQL, MariaDB.
    MySql,
    /// `[`-quoted identifiers, native `EXCEPT`, `TOP (n)` instead of `LIMIT`.
    /// MSSQL.
    MsSql,
}

impl DiffDialect {
    /// Map a connection kind to its diff dialect. `None` for non-relational
    /// sources (Mongo, Redis, Kafka, Mixpanel, Elasticsearch) where a row
    /// set-diff has no meaning.
    pub fn from_kind(kind: DatabaseKind) -> Option<Self> {
        match kind {
            DatabaseKind::Postgres
            | DatabaseKind::Duckdb
            | DatabaseKind::Sqlite
            | DatabaseKind::Snowflake
            | DatabaseKind::Redshift
            | DatabaseKind::Trino => Some(Self::Standard),
            DatabaseKind::Oracle => Some(Self::Oracle),
            DatabaseKind::Bigquery | DatabaseKind::Clickhouse => Some(Self::Backtick),
            DatabaseKind::Mysql | DatabaseKind::Mariadb | DatabaseKind::Starrocks => Some(Self::MySql),
            DatabaseKind::Mssql => Some(Self::MsSql),
            DatabaseKind::Mongodb
            | DatabaseKind::Redis
            | DatabaseKind::Kafka
            | DatabaseKind::Mixpanel
            | DatabaseKind::Elasticsearch
            | DatabaseKind::Dynamodb => None,
        }
    }

    fn quote_ident(self, ident: &str) -> String {
        match self {
            Self::MsSql => format!("[{}]", ident.replace(']', "]]")),
            Self::Backtick | Self::MySql => format!("`{}`", ident.replace('`', "``")),
            Self::Standard | Self::Oracle => format!("\"{}\"", ident.replace('"', "\"\"")),
        }
    }

    fn quote_join(self, cols: &[String]) -> String {
        cols.iter()
            .map(|c| self.quote_ident(c))
            .collect::<Vec<_>>()
            .join(", ")
    }

    /// Build a `"db"."schema"."name"` relation reference, skipping the database
    /// and/or schema when absent or empty. Each part is quoted per dialect.
    pub fn qualified_relation(
        self,
        database: Option<&str>,
        schema: Option<&str>,
        name: &str,
    ) -> String {
        [database, schema, Some(name)]
            .into_iter()
            .flatten()
            .filter(|s| !s.is_empty())
            .map(|s| self.quote_ident(s))
            .collect::<Vec<_>>()
            .join(".")
    }

    /// `SELECT`ing the distinct set difference (rows of `cols` present in `left`
    /// but not `right`). `left`/`right` are relation names in scope (CTE names).
    fn set_difference(self, cols: &[String], left: &str, right: &str) -> String {
        let cq = self.quote_join(cols);
        match self {
            Self::MySql => format!(
                "SELECT DISTINCT {cq} FROM {left} WHERE NOT EXISTS (SELECT 1 FROM {right} WHERE {eq})",
                eq = self.null_safe_eq(cols, left, right),
            ),
            _ => format!(
                "SELECT {cq} FROM {left} {op} SELECT {cq} FROM {right}",
                op = self.except_op(),
            ),
        }
    }

    /// `SELECT`ing the distinct rows of `cols` present in both `left` and
    /// `right` (relation names in scope).
    fn set_intersect(self, cols: &[String], left: &str, right: &str) -> String {
        let cq = self.quote_join(cols);
        match self {
            Self::MySql => format!(
                "SELECT DISTINCT {cq} FROM {left} WHERE EXISTS (SELECT 1 FROM {right} WHERE {eq})",
                eq = self.null_safe_eq(cols, left, right),
            ),
            _ => format!(
                "SELECT {cq} FROM {left} {op} SELECT {cq} FROM {right}",
                op = self.intersect_op(),
            ),
        }
    }

    fn except_op(self) -> &'static str {
        match self {
            Self::Oracle => "MINUS",
            Self::Backtick => "EXCEPT DISTINCT",
            _ => "EXCEPT",
        }
    }

    fn intersect_op(self) -> &'static str {
        match self {
            Self::Backtick => "INTERSECT DISTINCT",
            _ => "INTERSECT",
        }
    }

    /// NULL-safe equality predicate over `cols` correlating `left`/`right` (the
    /// MySQL anti/semi-join uses `<=>` so two NULLs compare equal, matching the
    /// `EXCEPT`/`INTERSECT` set semantics of the native dialects).
    fn null_safe_eq(self, cols: &[String], left: &str, right: &str) -> String {
        cols.iter()
            .map(|c| {
                let q = self.quote_ident(c);
                format!("{left}.{q} <=> {right}.{q}")
            })
            .collect::<Vec<_>>()
            .join(" AND ")
    }

    /// Plain equality join predicate over `cols` correlating `left`/`right`.
    /// Used to pull full rows for a set of keys (keys are never NULL).
    fn eq_join(self, cols: &[String], left: &str, right: &str) -> String {
        cols.iter()
            .map(|c| {
                let q = self.quote_ident(c);
                format!("{left}.{q} = {right}.{q}")
            })
            .collect::<Vec<_>>()
            .join(" AND ")
    }

    /// `table."c1", table."c2"` — `cols` each quoted and qualified by `table`,
    /// for projecting/ordering one side of a join unambiguously.
    fn qualify_cols(self, cols: &[String], table: &str) -> String {
        cols.iter()
            .map(|c| format!("{table}.{}", self.quote_ident(c)))
            .collect::<Vec<_>>()
            .join(", ")
    }

    /// `TOP (n) ` prefix injected right after `SELECT` (MSSQL row limiting);
    /// empty on every other dialect.
    fn top(self, n: u32) -> String {
        match self {
            Self::MsSql => format!("TOP ({n}) "),
            _ => String::new(),
        }
    }

    /// Trailing row-limit clause for a single-table `SELECT` that carries its own
    /// `ORDER BY`. MSSQL limits via [`top`](Self::top) instead, so this is empty.
    fn row_limit(self, n: u32) -> String {
        match self {
            Self::Oracle => format!("FETCH FIRST {n} ROWS ONLY"),
            Self::MsSql => String::new(),
            _ => format!("LIMIT {n}"),
        }
    }

    /// Limit a (possibly compound) row-producing query that has no `ORDER BY`.
    /// MSSQL cannot suffix `TOP`/`LIMIT` onto a compound `EXCEPT`, so the whole
    /// query is wrapped.
    fn limit_compound(self, inner: &str, n: u32) -> String {
        match self {
            Self::MsSql => format!("SELECT TOP ({n}) * FROM (\n{inner}\n) limit_q"),
            Self::Oracle => format!("{inner}\nFETCH FIRST {n} ROWS ONLY"),
            _ => format!("{inner}\nLIMIT {n}"),
        }
    }

    /// ` FROM dual` for engines that require a table in a `SELECT` that projects
    /// only scalar subqueries (Oracle); empty elsewhere.
    fn scalar_from(self) -> &'static str {
        match self {
            Self::Oracle => " FROM dual",
            _ => "",
        }
    }
}

/// Columns partitioned by whether they appear in prod, the new side, or both.
/// `shared` preserves the prod-side ordering so generated column lists are
/// deterministic.
#[derive(Clone, Debug, PartialEq)]
pub struct ColumnReconcile {
    pub shared: Vec<String>,
    pub prod_only: Vec<String>,
    pub new_only: Vec<String>,
}

/// Builds the set-diff SQL from a prod relation, the new-side SELECT, and the
/// shared column set. All inputs are treated as trusted (resolved upstream from
/// the dbt manifest + compiled SQL); column names are quoted, the relation and
/// new-side SELECT are interpolated verbatim.
pub struct DiffSqlBuilder {
    dialect: DiffDialect,
    prod_relation: String,
    new_select: String,
    shared_columns: Vec<String>,
    /// Primary-key columns (subset of `shared_columns`). Empty → keyless set-diff
    /// (a changed row counts as one removed + one added). Non-empty → keyed diff
    /// (a changed row counts as one `updated`).
    key_columns: Vec<String>,
    sample_size: u32,
}

impl DiffSqlBuilder {
    pub fn new(
        dialect: DiffDialect,
        prod_relation: String,
        new_select: String,
        shared_columns: Vec<String>,
        key_columns: Vec<String>,
        sample_size: u32,
    ) -> Self {
        Self {
            dialect,
            prod_relation,
            new_select,
            shared_columns,
            key_columns,
            sample_size,
        }
    }

    pub fn is_keyed(&self) -> bool {
        !self.key_columns.is_empty()
    }

    /// Split prod/new column-name lists into shared, prod-only and new-only.
    /// `shared` and `prod_only` follow prod ordering; `new_only` follows new
    /// ordering. Comparison is case-sensitive (warehouse identifiers are already
    /// normalized by the driver introspection that produced these lists).
    pub fn reconcile_columns(prod: &[String], new: &[String]) -> ColumnReconcile {
        let shared: Vec<String> = prod.iter().filter(|c| new.contains(c)).cloned().collect();
        let prod_only: Vec<String> = prod.iter().filter(|c| !new.contains(c)).cloned().collect();
        let new_only: Vec<String> = new.iter().filter(|c| !prod.contains(c)).cloned().collect();
        ColumnReconcile {
            shared,
            prod_only,
            new_only,
        }
    }

    /// `WITH new_side AS (...), prod_side AS (SELECT cols FROM prod)` — the common
    /// CTE prefix every diff query shares. The keyed diff adds a `changed` CTE
    /// (full rows in new but not prod) from which the `updated` keys are read.
    fn cte_prefix(&self) -> String {
        let mut ctes = format!(
            "WITH new_side AS (\n{new}\n), prod_side AS (SELECT {cols} FROM {prod})",
            new = self.new_select,
            cols = self.column_list(),
            prod = self.prod_relation,
        );
        if self.is_keyed() {
            ctes.push_str(&format!(
                ", changed AS (\n{}\n)",
                self.dialect
                    .set_difference(&self.shared_columns, "new_side", "prod_side"),
            ));
        }
        ctes
    }

    /// One query returning the headline counts: total rows on each side, rows
    /// added, rows removed, and rows updated. When keyed, added/removed are
    /// compared by key (a value change is one `updated`, not add+remove); when
    /// keyless, they are full-row set diffs and `updated_count` is always 0.
    pub fn counts_sql(&self) -> String {
        let from = self.dialect.scalar_from();
        let totals = "(SELECT count(*) FROM new_side) AS new_total, \
             (SELECT count(*) FROM prod_side) AS prod_total";
        if self.is_keyed() {
            let added = self
                .dialect
                .set_difference(&self.key_columns, "new_side", "prod_side");
            let removed = self
                .dialect
                .set_difference(&self.key_columns, "prod_side", "new_side");
            format!(
                "{cte}\n\
                 SELECT {totals}, \
                 (SELECT count(*) FROM ({added}) added_q) AS added_count, \
                 (SELECT count(*) FROM ({removed}) removed_q) AS removed_count, \
                 (SELECT count(*) FROM ({updated}) updated_q) AS updated_count{from}",
                cte = self.cte_prefix(),
                updated = self.updated_keys_sql(),
            )
        } else {
            let added = self
                .dialect
                .set_difference(&self.shared_columns, "new_side", "prod_side");
            let removed = self
                .dialect
                .set_difference(&self.shared_columns, "prod_side", "new_side");
            format!(
                "{cte}\n\
                 SELECT {totals}, \
                 (SELECT count(*) FROM ({added}) added_q) AS added_count, \
                 (SELECT count(*) FROM ({removed}) removed_q) AS removed_count, \
                 0 AS updated_count{from}",
                cte = self.cte_prefix(),
            )
        }
    }

    /// Sample of rows present in the new side but not in prod (added rows).
    pub fn added_sample_sql(&self) -> String {
        self.sample_sql(true)
    }

    /// Sample of rows present in prod but not in the new side (removed rows).
    pub fn removed_sample_sql(&self) -> String {
        self.sample_sql(false)
    }

    /// New-side rows whose key exists on both sides but whose values changed.
    /// Ordered by key so it lines up row-for-row with [`updated_prod_sample_sql`].
    /// Returns an empty string when keyless (no concept of an update).
    pub fn updated_new_sample_sql(&self) -> String {
        self.updated_sample_sql("new_side")
    }

    /// Prod-side (old) counterpart rows for the same updated keys, ordered by key.
    pub fn updated_prod_sample_sql(&self) -> String {
        self.updated_sample_sql("prod_side")
    }

    fn sample_sql(&self, added: bool) -> String {
        let (first, second) = if added {
            ("new_side", "prod_side")
        } else {
            ("prod_side", "new_side")
        };
        if self.is_keyed() {
            // Membership by key via an inner join to the key set-difference, then
            // pull the full row from the source side so a value-changed row is not
            // double-reported as add+remove. A join (rather than a correlated
            // `EXISTS`/row-value `IN`) is the one shape every dialect accepts.
            let key_diff = self.dialect.set_difference(&self.key_columns, first, second);
            self.join_sample_sql(first, &key_diff)
        } else {
            let diff = self
                .dialect
                .set_difference(&self.shared_columns, first, second);
            format!(
                "{cte}\n{limited}",
                cte = self.cte_prefix(),
                limited = self.dialect.limit_compound(&diff, self.sample_size),
            )
        }
    }

    fn updated_sample_sql(&self, side: &str) -> String {
        if !self.is_keyed() {
            return String::new();
        }
        let updated = self.updated_keys_sql();
        self.join_sample_sql(side, &updated)
    }

    /// Full rows of `side` whose key appears in `key_set` (a `SELECT` of the key
    /// columns), joined on the key and ordered by it. Every keyed sample funnels
    /// through here so the SQL shape is identical across dialects — an inner join
    /// is portable where correlated `EXISTS` (ClickHouse) and row-value `IN`
    /// (MSSQL) are not.
    fn join_sample_sql(&self, side: &str, key_set: &str) -> String {
        format!(
            "{cte}\n\
             SELECT {top}{cols} FROM {side} \
             INNER JOIN ({key_set}) keyset_q ON {on} \
             ORDER BY {order} {limit}",
            cte = self.cte_prefix(),
            top = self.dialect.top(self.sample_size),
            cols = self.dialect.qualify_cols(&self.shared_columns, side),
            on = self.dialect.eq_join(&self.key_columns, side, "keyset_q"),
            order = self.dialect.qualify_cols(&self.key_columns, side),
            limit = self.dialect.row_limit(self.sample_size),
        )
        .trim_end()
        .to_string()
    }

    /// Subquery yielding the keys of rows that exist on both sides but whose
    /// (shared-column) values changed: keys of the `changed` CTE that also exist
    /// in prod by key. Keyed callers only.
    fn updated_keys_sql(&self) -> String {
        self.dialect
            .set_intersect(&self.key_columns, "changed", "prod_side")
    }

    fn column_list(&self) -> String {
        self.dialect.quote_join(&self.shared_columns)
    }

    /// Read a count column from a single-row result. `count(*)` comes back as an
    /// integer on most dialects; `Double`/`Text` are tolerated defensively.
    /// Missing/unparseable cells yield 0.
    pub fn count_at(row: &[QueryValue], idx: usize) -> i64 {
        match row.get(idx) {
            Some(QueryValue::Int(v)) => *v,
            Some(QueryValue::Double(v)) => *v as i64,
            Some(QueryValue::Text(t)) => t.trim().parse().unwrap_or(0),
            _ => 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cols(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    fn builder() -> DiffSqlBuilder {
        DiffSqlBuilder::new(
            DiffDialect::Standard,
            "\"analytics\".\"public\".\"orders\"".to_string(),
            "SELECT id, amount FROM raw".to_string(),
            cols(&["id", "amount"]),
            Vec::new(),
            50,
        )
    }

    fn keyed_builder() -> DiffSqlBuilder {
        DiffSqlBuilder::new(
            DiffDialect::Standard,
            "\"analytics\".\"public\".\"orders\"".to_string(),
            "SELECT id, amount FROM raw".to_string(),
            cols(&["id", "amount"]),
            cols(&["id"]),
            50,
        )
    }

    fn dialect_builder(dialect: DiffDialect, key: bool) -> DiffSqlBuilder {
        DiffSqlBuilder::new(
            dialect,
            "prod".to_string(),
            "SELECT id, amount FROM raw".to_string(),
            cols(&["id", "amount"]),
            if key { cols(&["id"]) } else { Vec::new() },
            50,
        )
    }

    // -- Dialect mapping ----------------------------------------------------

    #[test]
    fn from_kind_maps_relational_sources() {
        use DatabaseKind::*;
        for k in [Postgres, Duckdb, Sqlite, Snowflake, Redshift, Trino] {
            assert_eq!(DiffDialect::from_kind(k), Some(DiffDialect::Standard));
        }
        assert_eq!(DiffDialect::from_kind(Oracle), Some(DiffDialect::Oracle));
        assert_eq!(DiffDialect::from_kind(Bigquery), Some(DiffDialect::Backtick));
        assert_eq!(DiffDialect::from_kind(Clickhouse), Some(DiffDialect::Backtick));
        assert_eq!(DiffDialect::from_kind(Mysql), Some(DiffDialect::MySql));
        assert_eq!(DiffDialect::from_kind(Mariadb), Some(DiffDialect::MySql));
        assert_eq!(DiffDialect::from_kind(Mssql), Some(DiffDialect::MsSql));
    }

    #[test]
    fn from_kind_excludes_non_relational_sources() {
        use DatabaseKind::*;
        for k in [Mongodb, Redis, Kafka, Mixpanel, Elasticsearch] {
            assert_eq!(DiffDialect::from_kind(k), None);
        }
    }

    #[test]
    fn every_database_kind_is_classified() {
        // Guards against a new DatabaseKind silently defaulting: every variant
        // must be an explicit relational-or-not decision in `from_kind`.
        for k in DatabaseKind::ALL {
            let _ = DiffDialect::from_kind(k);
        }
    }

    // -- Identifier quoting -------------------------------------------------

    #[test]
    fn standard_quotes_with_double_quotes() {
        assert_eq!(DiffDialect::Standard.quote_ident("id"), "\"id\"");
        assert_eq!(DiffDialect::Standard.quote_ident("we\"ird"), "\"we\"\"ird\"");
    }

    #[test]
    fn backtick_and_mysql_quote_with_backticks() {
        assert_eq!(DiffDialect::Backtick.quote_ident("id"), "`id`");
        assert_eq!(DiffDialect::MySql.quote_ident("we`ird"), "`we``ird`");
    }

    #[test]
    fn mssql_quotes_with_brackets() {
        assert_eq!(DiffDialect::MsSql.quote_ident("id"), "[id]");
        assert_eq!(DiffDialect::MsSql.quote_ident("we]ird"), "[we]]ird]");
    }

    #[test]
    fn column_list_quotes_and_joins() {
        assert_eq!(builder().column_list(), "\"id\", \"amount\"");
    }

    // -- Column reconcile ---------------------------------------------------

    #[test]
    fn reconcile_columns_splits_shared_prod_only_new_only() {
        let r = DiffSqlBuilder::reconcile_columns(
            &cols(&["id", "amount", "dropped"]),
            &cols(&["id", "amount", "added"]),
        );
        assert_eq!(r.shared, cols(&["id", "amount"]));
        assert_eq!(r.prod_only, cols(&["dropped"]));
        assert_eq!(r.new_only, cols(&["added"]));
    }

    #[test]
    fn reconcile_columns_shared_follows_prod_order() {
        let r = DiffSqlBuilder::reconcile_columns(&cols(&["b", "a"]), &cols(&["a", "b"]));
        assert_eq!(r.shared, cols(&["b", "a"]));
    }

    #[test]
    fn reconcile_columns_disjoint_yields_empty_shared() {
        let r = DiffSqlBuilder::reconcile_columns(&cols(&["x"]), &cols(&["y"]));
        assert!(r.shared.is_empty());
        assert_eq!(r.prod_only, cols(&["x"]));
        assert_eq!(r.new_only, cols(&["y"]));
    }

    // -- Standard dialect SQL shape ----------------------------------------

    #[test]
    fn counts_sql_wraps_new_select_and_prod_relation() {
        let sql = builder().counts_sql();
        assert!(sql.contains("WITH new_side AS (\nSELECT id, amount FROM raw\n)"));
        assert!(sql.contains(
            "prod_side AS (SELECT \"id\", \"amount\" FROM \"analytics\".\"public\".\"orders\")"
        ));
    }

    #[test]
    fn counts_sql_emits_all_four_counts_with_except_both_ways() {
        let sql = builder().counts_sql();
        assert!(sql.contains("AS new_total"));
        assert!(sql.contains("AS prod_total"));
        assert!(sql.contains(
            "FROM new_side EXCEPT SELECT \"id\", \"amount\" FROM prod_side) added_q) AS added_count"
        ));
        assert!(sql.contains(
            "FROM prod_side EXCEPT SELECT \"id\", \"amount\" FROM new_side) removed_q) AS removed_count"
        ));
    }

    #[test]
    fn keyless_counts_emit_zero_updated() {
        assert!(builder().counts_sql().contains("0 AS updated_count"));
    }

    #[test]
    fn added_sample_diffs_new_minus_prod_with_limit() {
        let sql = builder().added_sample_sql();
        assert!(sql.contains(
            "SELECT \"id\", \"amount\" FROM new_side EXCEPT SELECT \"id\", \"amount\" FROM prod_side\nLIMIT 50"
        ));
    }

    #[test]
    fn removed_sample_diffs_prod_minus_new_with_limit() {
        let sql = builder().removed_sample_sql();
        assert!(sql.contains(
            "SELECT \"id\", \"amount\" FROM prod_side EXCEPT SELECT \"id\", \"amount\" FROM new_side\nLIMIT 50"
        ));
    }

    #[test]
    fn sample_size_is_respected() {
        let b = DiffSqlBuilder::new(
            DiffDialect::Standard,
            "t".to_string(),
            "SELECT 1".to_string(),
            cols(&["a"]),
            Vec::new(),
            10,
        );
        assert!(b.added_sample_sql().ends_with("LIMIT 10"));
    }

    // -- qualified_relation -------------------------------------------------

    #[test]
    fn qualified_relation_includes_all_three_parts() {
        assert_eq!(
            DiffDialect::Standard.qualified_relation(Some("analytics"), Some("public"), "orders"),
            "\"analytics\".\"public\".\"orders\""
        );
    }

    #[test]
    fn qualified_relation_skips_missing_database() {
        assert_eq!(
            DiffDialect::Standard.qualified_relation(None, Some("public"), "orders"),
            "\"public\".\"orders\""
        );
    }

    #[test]
    fn qualified_relation_skips_empty_parts() {
        assert_eq!(
            DiffDialect::Standard.qualified_relation(Some(""), None, "orders"),
            "\"orders\""
        );
    }

    #[test]
    fn qualified_relation_quotes_per_dialect() {
        assert_eq!(
            DiffDialect::Backtick.qualified_relation(Some("proj"), Some("ds"), "orders"),
            "`proj`.`ds`.`orders`"
        );
        assert_eq!(
            DiffDialect::MsSql.qualified_relation(None, Some("dbo"), "orders"),
            "[dbo].[orders]"
        );
    }

    // -- count_at -----------------------------------------------------------

    #[test]
    fn count_at_reads_int() {
        let row = vec![QueryValue::Int(7)];
        assert_eq!(DiffSqlBuilder::count_at(&row, 0), 7);
    }

    #[test]
    fn count_at_coerces_double_and_text() {
        let row = vec![QueryValue::Double(3.0), QueryValue::Text("5".into())];
        assert_eq!(DiffSqlBuilder::count_at(&row, 0), 3);
        assert_eq!(DiffSqlBuilder::count_at(&row, 1), 5);
    }

    #[test]
    fn count_at_defaults_to_zero_when_absent_or_null() {
        let row = vec![QueryValue::Null];
        assert_eq!(DiffSqlBuilder::count_at(&row, 0), 0);
        assert_eq!(DiffSqlBuilder::count_at(&row, 9), 0);
    }

    // -- Keyed (primary-key) diff, Standard dialect -------------------------

    #[test]
    fn keyed_counts_compare_added_removed_by_key() {
        let sql = keyed_builder().counts_sql();
        assert!(sql.contains(
            "SELECT \"id\" FROM new_side EXCEPT SELECT \"id\" FROM prod_side) added_q) AS added_count"
        ));
        assert!(sql.contains(
            "SELECT \"id\" FROM prod_side EXCEPT SELECT \"id\" FROM new_side) removed_q) AS removed_count"
        ));
    }

    #[test]
    fn keyed_cte_defines_changed_full_row_diff() {
        let sql = keyed_builder().counts_sql();
        assert!(sql.contains(
            ", changed AS (\nSELECT \"id\", \"amount\" FROM new_side EXCEPT SELECT \"id\", \"amount\" FROM prod_side\n)"
        ));
    }

    #[test]
    fn keyed_counts_emit_updated_via_changed_keys_intersect_prod() {
        let sql = keyed_builder().counts_sql();
        assert!(sql.contains(
            "(SELECT count(*) FROM (SELECT \"id\" FROM changed INTERSECT SELECT \"id\" FROM prod_side) updated_q) AS updated_count"
        ));
    }

    #[test]
    fn keyed_added_sample_joins_full_row_to_added_keys() {
        let sql = keyed_builder().added_sample_sql();
        assert!(sql.contains(
            "SELECT new_side.\"id\", new_side.\"amount\" FROM new_side INNER JOIN (SELECT \"id\" FROM new_side EXCEPT SELECT \"id\" FROM prod_side) keyset_q ON new_side.\"id\" = keyset_q.\"id\" ORDER BY new_side.\"id\" LIMIT 50"
        ));
    }

    #[test]
    fn keyed_removed_sample_joins_prod_rows_to_removed_keys() {
        let sql = keyed_builder().removed_sample_sql();
        assert!(sql.contains(
            "SELECT prod_side.\"id\", prod_side.\"amount\" FROM prod_side INNER JOIN (SELECT \"id\" FROM prod_side EXCEPT SELECT \"id\" FROM new_side) keyset_q ON prod_side.\"id\" = keyset_q.\"id\" ORDER BY prod_side.\"id\" LIMIT 50"
        ));
    }

    #[test]
    fn updated_samples_pull_aligned_rows_from_each_side() {
        let b = keyed_builder();
        let new_sql = b.updated_new_sample_sql();
        let prod_sql = b.updated_prod_sample_sql();
        assert!(new_sql.contains("SELECT new_side.\"id\", new_side.\"amount\" FROM new_side INNER JOIN ("));
        assert!(prod_sql.contains("SELECT prod_side.\"id\", prod_side.\"amount\" FROM prod_side INNER JOIN ("));
        // Both ordered by key so the stacked grids line up row-for-row.
        assert!(new_sql.ends_with("ORDER BY new_side.\"id\" LIMIT 50"));
        assert!(prod_sql.ends_with("ORDER BY prod_side.\"id\" LIMIT 50"));
    }

    #[test]
    fn updated_samples_empty_when_keyless() {
        assert!(builder().updated_new_sample_sql().is_empty());
        assert!(builder().updated_prod_sample_sql().is_empty());
    }

    #[test]
    fn composite_keys_quote_and_join_all_columns() {
        let b = DiffSqlBuilder::new(
            DiffDialect::Standard,
            "\"t\"".to_string(),
            "SELECT 1".to_string(),
            cols(&["a", "b", "c"]),
            cols(&["a", "b"]),
            50,
        );
        let sql = b.added_sample_sql();
        assert!(sql.contains(
            "SELECT new_side.\"a\", new_side.\"b\", new_side.\"c\" FROM new_side INNER JOIN (SELECT \"a\", \"b\" FROM new_side EXCEPT SELECT \"a\", \"b\" FROM prod_side) keyset_q ON new_side.\"a\" = keyset_q.\"a\" AND new_side.\"b\" = keyset_q.\"b\" ORDER BY new_side.\"a\", new_side.\"b\" LIMIT 50"
        ));
    }

    // -- Oracle: MINUS + FETCH FIRST + FROM dual ----------------------------

    #[test]
    fn oracle_uses_minus_and_fetch_first() {
        let b = dialect_builder(DiffDialect::Oracle, false);
        let counts = b.counts_sql();
        assert!(counts.contains("FROM new_side MINUS SELECT \"id\", \"amount\" FROM prod_side"));
        assert!(counts.trim_end().ends_with("FROM dual"));
        assert!(b.added_sample_sql().ends_with("FETCH FIRST 50 ROWS ONLY"));
    }

    // -- BigQuery / ClickHouse: backticks + EXCEPT DISTINCT -----------------

    #[test]
    fn backtick_uses_except_distinct_and_backtick_quotes() {
        let b = dialect_builder(DiffDialect::Backtick, false);
        let counts = b.counts_sql();
        assert!(counts.contains(
            "SELECT `id`, `amount` FROM new_side EXCEPT DISTINCT SELECT `id`, `amount` FROM prod_side"
        ));
        assert!(b.added_sample_sql().ends_with("LIMIT 50"));
    }

    #[test]
    fn backtick_keyed_intersect_distinct() {
        let sql = dialect_builder(DiffDialect::Backtick, true).counts_sql();
        assert!(sql.contains("SELECT `id` FROM changed INTERSECT DISTINCT SELECT `id` FROM prod_side"));
    }

    // -- MySQL / MariaDB: NULL-safe anti-join, no EXCEPT --------------------

    #[test]
    fn mysql_uses_null_safe_anti_join_for_set_difference() {
        let b = dialect_builder(DiffDialect::MySql, false);
        let counts = b.counts_sql();
        assert!(!counts.contains("EXCEPT"));
        assert!(counts.contains(
            "SELECT DISTINCT `id`, `amount` FROM new_side WHERE NOT EXISTS (SELECT 1 FROM prod_side WHERE new_side.`id` <=> prod_side.`id` AND new_side.`amount` <=> prod_side.`amount`)"
        ));
    }

    #[test]
    fn mysql_keyed_updated_uses_semi_join() {
        let sql = dialect_builder(DiffDialect::MySql, true).counts_sql();
        assert!(!sql.contains("INTERSECT"));
        assert!(sql.contains(
            "SELECT DISTINCT `id` FROM changed WHERE EXISTS (SELECT 1 FROM prod_side WHERE changed.`id` <=> prod_side.`id`)"
        ));
    }

    // -- MSSQL: bracket quoting + TOP ---------------------------------------

    #[test]
    fn mssql_uses_top_and_bracket_quotes() {
        let b = dialect_builder(DiffDialect::MsSql, false);
        // Keyless compound sample wraps in TOP(n) since EXCEPT can't take LIMIT.
        assert!(b.added_sample_sql().contains(
            "SELECT TOP (50) * FROM (\nSELECT [id], [amount] FROM new_side EXCEPT SELECT [id], [amount] FROM prod_side\n) limit_q"
        ));
    }

    #[test]
    fn mssql_keyed_sample_injects_top_prefix_with_order_by() {
        let sql = dialect_builder(DiffDialect::MsSql, true).added_sample_sql();
        assert!(sql.contains("SELECT TOP (50) new_side.[id], new_side.[amount] FROM new_side INNER JOIN ("));
        assert!(sql.ends_with("ORDER BY new_side.[id]"));
    }

    #[test]
    fn mssql_counts_have_no_from_dual() {
        let sql = dialect_builder(DiffDialect::MsSql, false).counts_sql();
        assert!(!sql.contains("FROM dual"));
        assert!(sql.contains("AS added_count"));
    }
}
