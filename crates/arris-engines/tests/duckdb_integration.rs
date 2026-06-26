//! Integration tests for the DuckDB driver. DuckDB is embedded, so there is no
//! container — each test owns a fresh in-memory database (`:memory:`) and is
//! therefore independent and parallel-safe. Queries run through the engine's
//! `DatabaseDriver::run_query` / `explain_query` / `list_schemas` (the same path
//! the app uses), and the returned `QueryResult` / `PlanResult` / `SchemaNode`
//! tree is asserted.
//!
//! Run with:
//!   `cargo test -p arris-engines --test duckdb_integration`
//!
//! Object kinds DuckDB does NOT have (noted here rather than tested): triggers
//! and stored procedures do not exist; `CREATE MACRO` is the closest analogue to
//! a function and surfaces as `SchemaNodeKind::Function`. Materialized views are
//! not a distinct object kind. `list_schemas` therefore yields Table / View /
//! Index / Sequence / Function (macro) under each schema.
//!
//! Access control: DuckDB is a single-user embedded engine with no roles, users,
//! or `GRANT`/`REVOKE`. The access-control coverage required of client/server
//! engines does not apply here.
//!
//! Engine routing note: the engine decides SELECT-vs-exec from the statement's
//! *leading* keyword. Set-returning DuckDB statements that would otherwise lead
//! with `PIVOT` / `UNPIVOT` are therefore wrapped so they lead with `SELECT` /
//! `WITH`, which is also how a user would consume their rows. DuckDB's `SUM()` of
//! an `INTEGER` widens to `HUGEINT` (surfaced as `Text`), so running/aggregate
//! sums are cast to `BIGINT` where an integer assertion is wanted.

use std::fs;

use arris_engines::{
    ConnectionConfig, DatabaseDriver, DatabaseKind, DriverError, ExplainMode, ObjectRef, PlanNode,
    QueryLanguage, QueryResult, QueryValue, SchemaNode, SchemaNodeKind, driver_for_kind,
};

// ── harness ─────────────────────────────────────────────────────────────────

/// Connect a driver to a fresh in-memory database. The single underlying
/// `duckdb::Connection` is reused for every call on this driver, so the
/// in-memory DB persists across queries for the lifetime of the test.
async fn start_duckdb() -> Box<dyn DatabaseDriver> {
    let mut cfg = ConnectionConfig::new("it-duckdb", DatabaseKind::Duckdb);
    cfg.file_path = Some(":memory:".to_string());

    let driver = driver_for_kind(DatabaseKind::Duckdb).expect("duckdb driver");
    driver.connect(&cfg).await.expect("connect to duckdb");
    driver
}

async fn run(driver: &dyn DatabaseDriver, sql: &str) -> QueryResult {
    driver
        .run_query(sql, &[], QueryLanguage::Native)
        .await
        .unwrap_or_else(|e| panic!("query failed: {sql}\n  error: {e:?}"))
}

/// Run a statement and assert how many rows it reported as affected.
async fn exec_affected(driver: &dyn DatabaseDriver, sql: &str) -> i64 {
    run(driver, sql)
        .await
        .rows_affected
        .unwrap_or_else(|| panic!("expected rows_affected for: {sql}"))
}

/// First column of the first row.
fn scalar(result: &QueryResult) -> &QueryValue {
    result
        .rows
        .first()
        .and_then(|row| row.first())
        .unwrap_or_else(|| panic!("expected at least one row/column, got {result:?}"))
}

fn as_i64(v: &QueryValue) -> i64 {
    match v {
        QueryValue::Int(i) => *i,
        other => panic!("expected Int, got {other:?}"),
    }
}

fn as_f64(v: &QueryValue) -> f64 {
    match v {
        QueryValue::Double(f) => *f,
        other => panic!("expected Double, got {other:?}"),
    }
}

fn as_text(v: &QueryValue) -> &str {
    match v {
        QueryValue::Text(s) => s,
        other => panic!("expected Text, got {other:?}"),
    }
}

/// Whether the schema-browser tree contains a node with the given name + kind
/// anywhere in its hierarchy.
fn has_node(nodes: &[SchemaNode], name: &str, kind: SchemaNodeKind) -> bool {
    nodes
        .iter()
        .any(|n| (n.name == name && n.kind == kind) || has_node(&n.children, name, kind))
}

async fn schema_tree(driver: &dyn DatabaseDriver) -> Vec<SchemaNode> {
    driver.list_schemas().await.expect("list_schemas")
}

fn col_names(result: &QueryResult) -> Vec<&str> {
    result.columns.iter().map(|c| c.name.as_str()).collect()
}

fn col_type<'a>(result: &'a QueryResult, name: &str) -> &'a str {
    result
        .columns
        .iter()
        .find(|c| c.name == name)
        .map(|c| c.type_hint.as_str())
        .unwrap_or_else(|| panic!("no column named {name} in {:?}", result.columns))
}

// ── CRUD ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn crud_insert_update_delete_select() {
    let driver = start_duckdb().await;
    let d = driver.as_ref();

    // DuckDB has no implicit rowid/autoincrement — a sequence supplies the PK.
    run(d, "CREATE SEQUENCE seq_users START 1").await;
    run(
        d,
        "CREATE TABLE users (\
           id INTEGER DEFAULT nextval('seq_users') PRIMARY KEY, \
           name VARCHAR NOT NULL, age INTEGER)",
    )
    .await;

    // Multi-row insert reports the affected count.
    let inserted = exec_affected(
        d,
        "INSERT INTO users (name, age) VALUES ('alice', 30), ('bob', 25), ('carol', 40)",
    )
    .await;
    assert_eq!(inserted, 3);

    // A bare INSERT is routed through execute(); RETURNING rows are dropped, so
    // the new row is read back with a follow-up SELECT keyed on the sequence id.
    let dave = exec_affected(d, "INSERT INTO users (name, age) VALUES ('dave', 22)").await;
    assert_eq!(dave, 1);
    let last = run(d, "SELECT name FROM users ORDER BY id DESC LIMIT 1").await;
    assert_eq!(as_text(scalar(&last)), "dave");

    // SELECT with filter / ORDER BY / LIMIT — assert column names and types too.
    let top = run(
        d,
        "SELECT name, age FROM users WHERE age >= 25 ORDER BY age DESC LIMIT 2",
    )
    .await;
    assert_eq!(col_names(&top), ["name", "age"]);
    assert_eq!(col_type(&top, "name"), "VARCHAR");
    assert_eq!(col_type(&top, "age"), "INTEGER");
    assert_eq!(top.rows.len(), 2);
    assert_eq!(as_text(&top.rows[0][0]), "carol");
    assert_eq!(as_i64(&top.rows[0][1]), 40);
    assert_eq!(as_text(&top.rows[1][0]), "alice");
    assert_eq!(as_i64(&top.rows[1][1]), 30);

    // JOIN.
    run(
        d,
        "CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER)",
    )
    .await;
    run(
        d,
        "INSERT INTO orders SELECT 1, id, 100 FROM users WHERE name = 'alice'",
    )
    .await;
    let joined = run(
        d,
        "SELECT u.name, o.amount FROM users u JOIN orders o ON o.user_id = u.id",
    )
    .await;
    assert_eq!(joined.rows.len(), 1);
    assert_eq!(as_text(&joined.rows[0][0]), "alice");
    assert_eq!(as_i64(&joined.rows[0][1]), 100);

    // UPDATE.
    assert_eq!(
        exec_affected(d, "UPDATE users SET age = 31 WHERE name = 'alice'").await,
        1
    );
    let aged = run(d, "SELECT age FROM users WHERE name = 'alice'").await;
    assert_eq!(as_i64(scalar(&aged)), 31);

    // DELETE.
    assert_eq!(
        exec_affected(d, "DELETE FROM users WHERE name = 'bob'").await,
        1
    );
    let count = run(d, "SELECT count(*) FROM users").await;
    assert_eq!(as_i64(scalar(&count)), 3); // alice, carol, dave
}

// ── Window / analytic functions ─────────────────────────────────────────────

#[tokio::test]
async fn window_functions() {
    let driver = start_duckdb().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE sales (region VARCHAR, amount INTEGER)").await;
    run(
        d,
        "INSERT INTO sales (region, amount) VALUES \
         ('east', 10), ('east', 20), ('east', 30), ('west', 40), ('west', 50)",
    )
    .await;

    let r = run(
        d,
        "SELECT region, amount, \
           ROW_NUMBER() OVER (PARTITION BY region ORDER BY amount DESC) AS rn, \
           RANK() OVER (ORDER BY amount DESC) AS rnk, \
           LAG(amount) OVER (ORDER BY amount) AS prev, \
           LEAD(amount) OVER (ORDER BY amount) AS nxt, \
           SUM(amount) OVER (PARTITION BY region ORDER BY amount \
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::BIGINT AS running \
         FROM sales ORDER BY amount",
    )
    .await;
    assert_eq!(r.rows.len(), 5);

    // Ordered by amount asc: [10, 20, 30, 40, 50].
    // First row (amount=10, region east): LAG is NULL, running within east = 10.
    let first = &r.rows[0];
    assert_eq!(as_i64(&first[1]), 10);
    assert_eq!(as_i64(&first[2]), 3); // row_number within east desc
    assert_eq!(as_i64(&first[3]), 5); // global rank desc
    assert!(first[4].is_null()); // LAG of first row
    assert_eq!(as_i64(&first[5]), 20); // LEAD
    assert_eq!(as_i64(&first[6]), 10); // running sum

    // Third row (amount=30, region east): top of its partition, running = 60.
    let third = &r.rows[2];
    assert_eq!(as_i64(&third[1]), 30);
    assert_eq!(as_i64(&third[2]), 1); // row_number within east desc
    assert_eq!(as_i64(&third[3]), 3); // global rank desc
    assert_eq!(as_i64(&third[4]), 20); // LAG
    assert_eq!(as_i64(&third[5]), 40); // LEAD
    assert_eq!(as_i64(&third[6]), 60); // running sum 10+20+30
}

// ── DuckDB-specific: QUALIFY filters on a window result ──────────────────────

#[tokio::test]
async fn qualify_filters_window() {
    let driver = start_duckdb().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE sales (region VARCHAR, amount INTEGER)").await;
    run(
        d,
        "INSERT INTO sales (region, amount) VALUES \
         ('east', 10), ('east', 30), ('west', 40), ('west', 50)",
    )
    .await;

    // QUALIFY keeps only the top row per region without a subquery.
    let r = run(
        d,
        "SELECT region, amount FROM sales \
         QUALIFY ROW_NUMBER() OVER (PARTITION BY region ORDER BY amount DESC) = 1 \
         ORDER BY region",
    )
    .await;
    assert_eq!(r.rows.len(), 2);
    assert_eq!(as_text(&r.rows[0][0]), "east");
    assert_eq!(as_i64(&r.rows[0][1]), 30);
    assert_eq!(as_text(&r.rows[1][0]), "west");
    assert_eq!(as_i64(&r.rows[1][1]), 50);
}

// ── DuckDB-specific: PIVOT / UNPIVOT ────────────────────────────────────────

#[tokio::test]
async fn pivot_and_unpivot() {
    let driver = start_duckdb().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE qsales (region VARCHAR, quarter VARCHAR, amount INTEGER)").await;
    run(
        d,
        "INSERT INTO qsales VALUES \
         ('east', 'Q1', 10), ('east', 'Q2', 20), \
         ('west', 'Q1', 30), ('west', 'Q2', 40)",
    )
    .await;

    // PIVOT rotates quarter values into columns. Wrapped in a CTE so the
    // statement leads with WITH (engine routes it to the SELECT path) and the
    // HUGEINT sums are cast back to BIGINT for integer assertions.
    let p = run(
        d,
        "WITH p AS (PIVOT qsales ON quarter USING sum(amount) GROUP BY region) \
         SELECT region, \"Q1\"::BIGINT AS q1, \"Q2\"::BIGINT AS q2 FROM p ORDER BY region",
    )
    .await;
    assert_eq!(col_names(&p), ["region", "q1", "q2"]);
    assert_eq!(p.rows.len(), 2);
    assert_eq!(as_text(&p.rows[0][0]), "east");
    assert_eq!(as_i64(&p.rows[0][1]), 10);
    assert_eq!(as_i64(&p.rows[0][2]), 20);
    assert_eq!(as_text(&p.rows[1][0]), "west");
    assert_eq!(as_i64(&p.rows[1][1]), 30);
    assert_eq!(as_i64(&p.rows[1][2]), 40);

    // UNPIVOT collapses wide columns back into (quarter, amount) rows.
    run(d, "CREATE TABLE wide (region VARCHAR, q1 INTEGER, q2 INTEGER)").await;
    run(d, "INSERT INTO wide VALUES ('east', 10, 20)").await;
    let u = run(
        d,
        "SELECT region, quarter, amount FROM wide \
         UNPIVOT (amount FOR quarter IN (q1, q2)) ORDER BY quarter",
    )
    .await;
    assert_eq!(col_names(&u), ["region", "quarter", "amount"]);
    assert_eq!(u.rows.len(), 2);
    assert_eq!(as_text(&u.rows[0][1]), "q1");
    assert_eq!(as_i64(&u.rows[0][2]), 10);
    assert_eq!(as_text(&u.rows[1][1]), "q2");
    assert_eq!(as_i64(&u.rows[1][2]), 20);
}

// ── DuckDB-specific: LIST / STRUCT / MAP nested types ───────────────────────

#[tokio::test]
async fn nested_list_struct_map_types() {
    let driver = start_duckdb().await;
    let d = driver.as_ref();

    // Whole nested values surface with their DuckDB type label in the grid.
    assert_eq!(col_type(&run(d, "SELECT [10, 20, 30] AS arr").await, "arr"), "LIST");
    assert_eq!(
        col_type(&run(d, "SELECT {'x': 1, 'y': 'hi'} AS s").await, "s"),
        "STRUCT"
    );
    assert_eq!(
        col_type(&run(d, "SELECT MAP {1: 'a', 2: 'b'} AS m").await, "m"),
        "MAP"
    );

    // LIST contents: 1-indexed element access and length.
    let lst = run(d, "SELECT arr[1] AS a, arr[2] AS b, len(arr) AS n FROM (SELECT [10, 20, 30] AS arr)").await;
    assert_eq!(as_i64(&lst.rows[0][0]), 10);
    assert_eq!(as_i64(&lst.rows[0][1]), 20);
    assert_eq!(as_i64(&lst.rows[0][2]), 3);

    // STRUCT contents: dot access to typed fields.
    let st = run(d, "SELECT s.x AS x, s.y AS y FROM (SELECT {'x': 1, 'y': 'hi'} AS s)").await;
    assert_eq!(as_i64(&st.rows[0][0]), 1);
    assert_eq!(as_text(&st.rows[0][1]), "hi");

    // MAP contents: key lookup returns the value.
    let mp = run(d, "SELECT m[2] AS v FROM (SELECT MAP {1: 'a', 2: 'b'} AS m)").await;
    assert_eq!(as_text(scalar(&mp)), "b");

    // UNNEST expands a LIST into one row per element.
    let un = run(d, "SELECT unnest([100, 200, 300]) AS e ORDER BY e").await;
    let es: Vec<i64> = un.rows.iter().map(|row| as_i64(&row[0])).collect();
    assert_eq!(es, [100, 200, 300]);
}

// ── DuckDB-specific: read_csv_auto / read_parquet over temp files ───────────

#[tokio::test]
async fn read_csv_and_parquet_files() {
    let driver = start_duckdb().await;
    let d = driver.as_ref();

    let dir = tempfile::tempdir().expect("tempdir");
    let csv = dir.path().join("people.csv");
    let parquet = dir.path().join("people.parquet");
    fs::write(&csv, "id,name\n1,alice\n2,bob\n3,carol\n").expect("write csv");
    let csv_path = csv.to_string_lossy().replace('\'', "''");
    let parquet_path = parquet.to_string_lossy().replace('\'', "''");

    // read_csv_auto sniffs the schema from the file.
    let from_csv = run(
        d,
        &format!("SELECT id, name FROM read_csv_auto('{csv_path}') ORDER BY id"),
    )
    .await;
    assert_eq!(col_names(&from_csv), ["id", "name"]);
    assert_eq!(from_csv.rows.len(), 3);
    assert_eq!(as_i64(&from_csv.rows[0][0]), 1);
    assert_eq!(as_text(&from_csv.rows[0][1]), "alice");
    assert_eq!(as_text(&from_csv.rows[2][1]), "carol");

    // COPY ... TO writes a parquet file, which read_parquet then reads back.
    run(
        d,
        &format!(
            "COPY (SELECT * FROM read_csv_auto('{csv_path}')) \
             TO '{parquet_path}' (FORMAT PARQUET)"
        ),
    )
    .await;
    let count = run(d, &format!("SELECT count(*) FROM read_parquet('{parquet_path}')")).await;
    assert_eq!(as_i64(scalar(&count)), 3);
    let from_pq = run(
        d,
        &format!("SELECT name FROM read_parquet('{parquet_path}') WHERE id = 2"),
    )
    .await;
    assert_eq!(as_text(scalar(&from_pq)), "bob");
}

// ── DuckDB-specific: SAMPLE ─────────────────────────────────────────────────

#[tokio::test]
async fn sample_clause() {
    let driver = start_duckdb().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE nums AS SELECT * FROM range(1000) t(n)").await;
    assert_eq!(
        as_i64(scalar(&run(d, "SELECT count(*) FROM nums").await)),
        1000
    );

    // A reservoir sample of a fixed row count is exact.
    let exact = run(d, "SELECT count(*) FROM nums USING SAMPLE reservoir(100 ROWS)").await;
    assert_eq!(as_i64(scalar(&exact)), 100);

    // A row-level (bernoulli) percentage sample with a fixed seed is a
    // deterministic, non-empty proper subset. The default system sampler is
    // block-based and would return 0 on a single-block 1000-row table.
    let pct = as_i64(scalar(
        &run(d, "SELECT count(*) FROM nums USING SAMPLE 10% (bernoulli, 42)").await,
    ));
    assert!(pct > 0 && pct < 1000, "expected a proper subset, got {pct}");
}

// ── DuckDB-specific: recursive CTE ──────────────────────────────────────────

#[tokio::test]
async fn recursive_cte() {
    let driver = start_duckdb().await;
    let d = driver.as_ref();

    // Sum 1..5 via a recursive CTE; the INTEGER sum widens to HUGEINT so cast it.
    let sum = run(
        d,
        "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 5) \
         SELECT sum(n)::BIGINT FROM t",
    )
    .await;
    assert_eq!(as_i64(scalar(&sum)), 15);

    // Materialise the full series and assert the row set.
    let series = run(
        d,
        "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 5) \
         SELECT n FROM t ORDER BY n",
    )
    .await;
    assert_eq!(series.rows.len(), 5);
    let ns: Vec<i64> = series.rows.iter().map(|row| as_i64(&row[0])).collect();
    assert_eq!(ns, [1, 2, 3, 4, 5]);
}

// ── DuckDB-specific: GROUP BY ALL and SELECT * EXCLUDE / REPLACE ─────────────

#[tokio::test]
async fn group_by_all_and_star_modifiers() {
    let driver = start_duckdb().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE emp (dept VARCHAR, name VARCHAR, salary INTEGER)").await;
    run(
        d,
        "INSERT INTO emp VALUES \
         ('eng', 'alice', 150), ('eng', 'bob', 90), \
         ('sales', 'carol', 120), ('sales', 'dave', 80)",
    )
    .await;

    // GROUP BY ALL infers the grouping key (dept) from the non-aggregated column.
    let g = run(
        d,
        "SELECT dept, count(*)::BIGINT AS c, sum(salary)::BIGINT AS total \
         FROM emp GROUP BY ALL ORDER BY dept",
    )
    .await;
    assert_eq!(col_names(&g), ["dept", "c", "total"]);
    assert_eq!(g.rows.len(), 2);
    assert_eq!(as_text(&g.rows[0][0]), "eng");
    assert_eq!(as_i64(&g.rows[0][1]), 2);
    assert_eq!(as_i64(&g.rows[0][2]), 240);
    assert_eq!(as_text(&g.rows[1][0]), "sales");
    assert_eq!(as_i64(&g.rows[1][2]), 200);

    // SELECT * EXCLUDE drops a column from the star expansion.
    let excl = run(d, "SELECT * EXCLUDE (salary) FROM emp ORDER BY name LIMIT 1").await;
    assert_eq!(col_names(&excl), ["dept", "name"]);
    assert_eq!(as_text(&excl.rows[0][1]), "alice");

    // SELECT * REPLACE rewrites a column in place, keeping the column set.
    let repl = run(
        d,
        "SELECT * REPLACE (salary * 2 AS salary) FROM emp WHERE name = 'alice'",
    )
    .await;
    assert_eq!(col_names(&repl), ["dept", "name", "salary"]);
    assert_eq!(as_i64(&repl.rows[0][2]), 300);
}

// ── Views: create / replace / read / drop + schema browser ──────────────────
//
// DuckDB supports CREATE OR REPLACE VIEW. Materialized views are not a distinct
// object kind, so only plain views are covered here.

#[tokio::test]
async fn view_lifecycle() {
    let driver = start_duckdb().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE employees (id INTEGER PRIMARY KEY, name VARCHAR, dept VARCHAR, salary INTEGER)",
    )
    .await;
    run(
        d,
        "INSERT INTO employees VALUES \
         (1, 'alice', 'eng', 150), (2, 'bob', 'eng', 90), \
         (3, 'carol', 'sales', 120), (4, 'dave', 'sales', 80)",
    )
    .await;

    // CREATE.
    run(
        d,
        "CREATE VIEW high_earners AS \
         SELECT id, name, salary FROM employees WHERE salary >= 100",
    )
    .await;

    let v = run(d, "SELECT * FROM high_earners ORDER BY salary DESC").await;
    assert_eq!(col_names(&v), ["id", "name", "salary"]);
    assert_eq!(col_type(&v, "salary"), "INTEGER");
    assert_eq!(v.rows.len(), 2);
    assert_eq!(as_text(&v.rows[0][1]), "alice");
    assert_eq!(as_i64(&v.rows[0][2]), 150);
    assert_eq!(as_text(&v.rows[1][1]), "carol");
    assert_eq!(as_i64(&v.rows[1][2]), 120);

    // The schema browser surfaces the view.
    assert!(has_node(&schema_tree(d).await, "high_earners", SchemaNodeKind::View));

    // CREATE OR REPLACE with a tighter filter; the row set shrinks.
    run(
        d,
        "CREATE OR REPLACE VIEW high_earners AS \
         SELECT id, name, salary FROM employees WHERE salary >= 130",
    )
    .await;
    let v2 = run(d, "SELECT * FROM high_earners ORDER BY salary DESC").await;
    assert_eq!(v2.rows.len(), 1);
    assert_eq!(as_text(&v2.rows[0][1]), "alice");

    // DROP — the view disappears from the browser and can no longer be queried.
    run(d, "DROP VIEW high_earners").await;
    assert!(!has_node(&schema_tree(d).await, "high_earners", SchemaNodeKind::View));
    assert!(
        driver
            .run_query("SELECT * FROM high_earners", &[], QueryLanguage::Native)
            .await
            .is_err()
    );
}

// ── Macros (functions): create / replace / call / drop + schema browser ─────
//
// DuckDB has no stored procedures or triggers. A scalar MACRO is the closest
// analogue to a user function and surfaces as SchemaNodeKind::Function.

#[tokio::test]
async fn macro_function_lifecycle() {
    let driver = start_duckdb().await;
    let d = driver.as_ref();

    // p * 1.1 yields a DECIMAL; cast to DOUBLE so the grid surfaces it as Double.
    run(d, "CREATE MACRO add_tax(p) AS p * 1.1").await;
    let taxed = run(d, "SELECT add_tax(100)::DOUBLE AS t").await;
    assert!((as_f64(scalar(&taxed)) - 110.0).abs() < 1e-9);

    // The macro surfaces in the schema browser as a Function.
    assert!(has_node(&schema_tree(d).await, "add_tax", SchemaNodeKind::Function));

    // CREATE OR REPLACE redefines it.
    run(d, "CREATE OR REPLACE MACRO add_tax(p) AS p * 1.2").await;
    let taxed2 = run(d, "SELECT add_tax(100)::DOUBLE AS t").await;
    assert!((as_f64(scalar(&taxed2)) - 120.0).abs() < 1e-9);

    // DROP — the macro leaves the browser and can no longer be called.
    run(d, "DROP MACRO add_tax").await;
    assert!(!has_node(&schema_tree(d).await, "add_tax", SchemaNodeKind::Function));
    assert!(
        driver
            .run_query("SELECT add_tax(1)", &[], QueryLanguage::Native)
            .await
            .is_err()
    );
}

// ── Sequences: create / use / drop + schema browser ─────────────────────────

#[tokio::test]
async fn sequence_lifecycle() {
    let driver = start_duckdb().await;
    let d = driver.as_ref();

    run(d, "CREATE SEQUENCE s START 100 INCREMENT 5").await;

    // nextval advances the sequence.
    assert_eq!(as_i64(scalar(&run(d, "SELECT nextval('s')").await)), 100);
    assert_eq!(as_i64(scalar(&run(d, "SELECT nextval('s')").await)), 105);

    // The sequence surfaces in the schema browser.
    assert!(has_node(&schema_tree(d).await, "s", SchemaNodeKind::Sequence));

    // DROP — the sequence leaves the browser and can no longer be used.
    run(d, "DROP SEQUENCE s").await;
    assert!(!has_node(&schema_tree(d).await, "s", SchemaNodeKind::Sequence));
    assert!(
        driver
            .run_query("SELECT nextval('s')", &[], QueryLanguage::Native)
            .await
            .is_err()
    );
}

// ── Indexes: create / appear in browser / planner pushdown / drop ───────────
//
// Unlike Postgres/SQLite, DuckDB does NOT surface an "index scan" operator in
// EXPLAIN for filter queries: its optimizer relies on automatic min-max
// (zonemap) indexes plus filter pushdown, and reserves explicit ART indexes
// mainly for constraint enforcement and joins. Even a primary-key equality on a
// persisted 100k-row table plans as a SEQ_SCAN with the predicate pushed down.
// We therefore assert what DuckDB actually exposes through `explain_query`: the
// equality predicate is pushed into the table scan as a Filter. The full
// create → browser → drop lifecycle is verified independently.

fn plan_text(node: &PlanNode) -> String {
    let mut s = node.label.clone();
    for child in &node.children {
        s.push('\n');
        s.push_str(&plan_text(child));
    }
    s
}

#[tokio::test]
async fn index_lifecycle_and_explain_usage() {
    let driver = start_duckdb().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE items (id INTEGER, sku VARCHAR, qty INTEGER)").await;
    run(
        d,
        "INSERT INTO items SELECT n, 'sku' || n, n FROM range(100000) t(n)",
    )
    .await;
    run(d, "CREATE INDEX idx_items_sku ON items (sku)").await;

    // The schema browser surfaces the index.
    assert!(has_node(&schema_tree(d).await, "idx_items_sku", SchemaNodeKind::Index));

    // explain_query surfaces a real plan; the predicate is pushed into the scan.
    let plan = driver
        .explain_query(
            "SELECT id, qty FROM items WHERE sku = 'sku500'",
            &[],
            QueryLanguage::Native,
            ExplainMode::DryRun,
        )
        .await
        .expect("explain");
    let text = plan_text(&plan.root).to_uppercase();
    assert!(
        text.contains("SEQ_SCAN") && text.contains("SKU='SKU500'"),
        "expected a scan with the predicate pushed down, got plan: {}",
        plan.root.label
    );

    // DROP removes the index from the browser; the table is still queryable.
    run(d, "DROP INDEX idx_items_sku").await;
    assert!(!has_node(&schema_tree(d).await, "idx_items_sku", SchemaNodeKind::Index));
    let after = run(d, "SELECT qty FROM items WHERE sku = 'sku500'").await;
    assert_eq!(as_i64(scalar(&after)), 500);
}

// ── new-database file creation ─────────────────────────────────────
// Picking a directory + naming a file should let the driver create the .duckdb.

/// A file path inside an existing directory: the driver creates the `.duckdb`
/// on disk and it is immediately queryable through the engine.
#[tokio::test]
async fn connect_creates_db_file_in_existing_dir() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("created.duckdb");
    assert!(!db_path.exists(), "precondition: file does not exist yet");

    let mut cfg = ConnectionConfig::new("it-duckdb-new", DatabaseKind::Duckdb);
    cfg.file_path = Some(db_path.to_string_lossy().into_owned());
    let driver = driver_for_kind(DatabaseKind::Duckdb).expect("duckdb driver");
    driver.connect(&cfg).await.expect("connect creates the file");

    assert!(db_path.exists(), "driver should have created the .duckdb file");
    run(driver.as_ref(), "CREATE TABLE t (id INTEGER)").await;
    let count = run(driver.as_ref(), "SELECT count(*) FROM t").await;
    assert_eq!(as_i64(scalar(&count)), 0);
}

/// A path whose parent directories do not yet exist: the driver creates the
/// missing directories and then the file.
#[tokio::test]
async fn connect_creates_missing_parent_dirs() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("nested/deeper/created.duckdb");
    assert!(
        !db_path.parent().unwrap().exists(),
        "precondition: parent dirs do not exist yet"
    );

    let mut cfg = ConnectionConfig::new("it-duckdb-nested", DatabaseKind::Duckdb);
    cfg.file_path = Some(db_path.to_string_lossy().into_owned());
    let driver = driver_for_kind(DatabaseKind::Duckdb).expect("duckdb driver");
    driver
        .connect(&cfg)
        .await
        .expect("connect creates nested dirs + file");

    assert!(
        db_path.exists(),
        "driver should have created nested dirs and the file"
    );
}

/// A bare directory path (no file name) is rejected with `InvalidArgument` —
/// the user must name the file, not just pick a folder.
#[tokio::test]
async fn connect_rejects_bare_directory_path() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut cfg = ConnectionConfig::new("it-duckdb-dir", DatabaseKind::Duckdb);
    cfg.file_path = Some(dir.path().to_string_lossy().into_owned());
    let driver = driver_for_kind(DatabaseKind::Duckdb).expect("duckdb driver");

    let err = driver
        .connect(&cfg)
        .await
        .expect_err("a directory path must be rejected");
    assert!(
        matches!(err, DriverError::InvalidArgument(_)),
        "expected InvalidArgument, got {err:?}"
    );
}

// ── value rendering: temporal & decimal types ──────────────────────
// DECIMAL / DATE / TIMESTAMP / TIME / INTERVAL cells must surface as readable
// text, not Rust Debug output like `Decimal(49.99)` / `Date32(19727)`.

#[tokio::test]
async fn temporal_and_decimal_values_render_as_readable_text() {
    let driver = start_duckdb().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE orders (\
           amount DECIMAL(5,2), \
           order_date DATE, \
           created_at TIMESTAMP, \
           start_time TIME, \
           span INTERVAL)",
    )
    .await;
    run(
        d,
        "INSERT INTO orders VALUES (\
           199.50, DATE '2023-12-25', TIMESTAMP '2023-12-25 10:30:00', \
           TIME '10:30:00', INTERVAL '14 months 3 days')",
    )
    .await;

    let result = run(
        d,
        "SELECT amount, order_date, created_at, start_time, span FROM orders",
    )
    .await;
    assert_eq!(col_type(&result, "amount"), "DECIMAL(5,2)");
    assert_eq!(col_type(&result, "order_date"), "DATE");

    let row = &result.rows[0];
    // DECIMAL keeps its scale and surfaces as the bare number, not `Decimal(199.50)`.
    assert_eq!(row[0], QueryValue::Decimal("199.50".into()));
    assert_eq!(as_text(&row[1]), "2023-12-25");
    assert_eq!(as_text(&row[2]), "2023-12-25 10:30:00");
    assert_eq!(as_text(&row[3]), "10:30:00");
    // DuckDB keeps 14 months as-is; the formatter splits it into years + months.
    assert_eq!(as_text(&row[4]), "1 year 2 months 3 days");
}

// ── Transaction control ──────────────────────────────────────────────────────
//
// DuckDB is a single embedded connection (no independent second session), so we
// assert self-visibility, rollback discard, and the `in_transaction` flag.
// DuckDB exposes no selectable isolation level (snapshot isolation only), so only
// `Default` is meaningful. Unlike SQLite, DuckDB genuinely ABORTS the whole
// transaction on a statement error — the transaction must be rolled back before
// it can be used again (asserted below).

use arris_engines::IsolationLevel;

#[tokio::test]
async fn manual_commit_persists_changes() {
    let tx = start_duckdb().await;
    run(tx.as_ref(), "CREATE TABLE acct (id INTEGER PRIMARY KEY, bal INTEGER)").await;

    assert!(tx.supports_transactions());
    assert!(!tx.in_transaction().await);
    tx.begin_transaction(IsolationLevel::Default).await.expect("begin");
    assert!(tx.in_transaction().await);

    run(tx.as_ref(), "INSERT INTO acct VALUES (1, 100)").await;
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM acct").await)), 1);

    tx.commit_transaction().await.expect("commit");
    assert!(!tx.in_transaction().await);

    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM acct").await)), 1);
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT bal FROM acct WHERE id = 1").await)), 100);
}

#[tokio::test]
async fn manual_rollback_discards_changes() {
    let tx = start_duckdb().await;
    run(tx.as_ref(), "CREATE TABLE note (id INTEGER)").await;

    tx.begin_transaction(IsolationLevel::Default).await.expect("begin");
    run(tx.as_ref(), "INSERT INTO note VALUES (1), (2)").await;
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM note").await)), 2);

    tx.rollback_transaction().await.expect("rollback");
    assert!(!tx.in_transaction().await);

    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM note").await)), 0);
}

#[tokio::test]
async fn failed_statement_aborts_transaction_until_rollback() {
    // DuckDB aborts the transaction on any statement error; subsequent statements
    // fail until the transaction is rolled back. This documents the per-engine
    // behaviour (the opposite of SQLite/Postgres-with-savepoints).
    let tx = start_duckdb().await;
    run(tx.as_ref(), "CREATE TABLE acct (id INTEGER PRIMARY KEY, bal INTEGER)").await;

    tx.begin_transaction(IsolationLevel::Default).await.expect("begin");
    run(tx.as_ref(), "INSERT INTO acct VALUES (1, 100)").await;

    // Duplicate primary key fails and aborts the transaction.
    let err = tx
        .run_query("INSERT INTO acct VALUES (1, 999)", &[], QueryLanguage::Native)
        .await;
    assert!(err.is_err(), "duplicate insert should fail");

    // The transaction is now aborted: further work errors until rollback.
    let after = tx
        .run_query("INSERT INTO acct VALUES (2, 200)", &[], QueryLanguage::Native)
        .await;
    assert!(after.is_err(), "DuckDB aborts the transaction after a statement error");

    tx.rollback_transaction().await.expect("rollback");
    assert!(!tx.in_transaction().await);

    // After rollback the connection is usable again and nothing was committed.
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM acct").await)), 0);
}

// ── object definition (Show Definition) ──────────────────────────────────────

#[tokio::test]
async fn object_definition_returns_catalog_ddl_for_each_kind() {
    let d = start_duckdb().await;
    run(d.as_ref(), "CREATE TABLE t (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL)").await;
    run(d.as_ref(), "CREATE VIEW v AS SELECT id, name FROM t").await;
    run(d.as_ref(), "CREATE INDEX t_name_idx ON t(name)").await;
    run(d.as_ref(), "CREATE SEQUENCE s START 5 INCREMENT 2").await;
    run(d.as_ref(), "CREATE MACRO m(a) AS a * 2").await;

    let table = d
        .object_definition(&ObjectRef::with_schema(SchemaNodeKind::Table, "main", "t"))
        .await
        .expect("table ddl");
    assert!(table.starts_with("CREATE TABLE t"), "{table}");
    assert!(table.contains("PRIMARY KEY"), "{table}");
    assert!(table.ends_with(';') && !table.ends_with(";;"), "{table}");

    let view = d
        .object_definition(&ObjectRef::with_schema(SchemaNodeKind::View, "main", "v"))
        .await
        .expect("view ddl");
    assert!(view.starts_with("CREATE VIEW v"), "{view}");

    let index = d
        .object_definition(&ObjectRef::with_schema(SchemaNodeKind::Index, "main", "t_name_idx"))
        .await
        .expect("index ddl");
    assert!(index.starts_with("CREATE INDEX t_name_idx"), "{index}");

    let seq = d
        .object_definition(&ObjectRef::with_schema(SchemaNodeKind::Sequence, "main", "s"))
        .await
        .expect("sequence ddl");
    assert!(seq.starts_with("CREATE SEQUENCE s"), "{seq}");

    let macro_def = d
        .object_definition(&ObjectRef::with_schema(SchemaNodeKind::Function, "main", "m"))
        .await
        .expect("macro ddl");
    assert!(macro_def.starts_with("CREATE MACRO m(a) AS"), "{macro_def}");
}

#[tokio::test]
async fn object_definition_missing_object_errors() {
    let d = start_duckdb().await;
    let err = d
        .object_definition(&ObjectRef::with_schema(SchemaNodeKind::Table, "main", "ghost"))
        .await
        .unwrap_err();
    assert!(matches!(err, DriverError::QueryFailed(_)), "{err:?}");
}
