//! Integration tests for the MSSQL (SQL Server) driver against a real
//! `mcr.microsoft.com/mssql/server:2022-latest` instance started via
//! `testcontainers`. Queries run through the engine's
//! `DatabaseDriver::run_query` / `explain_query` / `list_schemas` (the same path
//! the app uses), and the returned `QueryResult` / `PlanResult` / `SchemaNode`
//! tree is asserted.
//!
//! Requires Docker (and, on Apple-silicon hosts, Rosetta emulation — SQL Server
//! ships amd64-only images). Run with:
//!   `cargo test -p arris-engines --test mssql_integration`
//! Each test owns its own container, so they are independent and parallel-safe.
//!
//! Engine semantics worth knowing when reading the assertions below:
//!
//! * The driver routes anything that does NOT start with a SELECT-like keyword
//!   (`SELECT`/`WITH`/`VALUES`/`TABLE`/`SHOW`/`EXPLAIN`/`EXEC`…) through the
//!   "execute" path, which **discards result rows and reports their count as
//!   `rows_affected`**. SQL Server returns no rows for a bare `INSERT`/`UPDATE`/
//!   `DELETE`/`MERGE`, so those report `rows_affected = 0`. To surface a real
//!   affected-row count we use T-SQL's `OUTPUT` clause: `OUTPUT inserted.id` /
//!   `OUTPUT deleted.id` makes the statement emit one row per affected row, which
//!   the engine then counts. This is also how the engine surfaces
//!   "insert-returning": as the `OUTPUT` row count (the row *values* are dropped
//!   on the execute path, so we read them back with a follow-up `SELECT`).
//!
//! * SQL Server has **no distinct materialized-view object kind**. The equivalent
//!   is an *indexed view* (a `SCHEMABINDING` view with a unique clustered index),
//!   which is materialized to disk; the schema browser surfaces it as a `View`
//!   (from `sys.views`) with its clustered index listed as an `Index`. That is
//!   exercised in `indexed_view_lifecycle` instead of a `MaterializedView` kind.

use arris_engines::{
    ConnectionConfig, DatabaseDriver, DatabaseKind, ExplainMode, ObjectRef, QueryLanguage,
    QueryResult, QueryValue, SchemaNode, SchemaNodeKind, driver_for_kind,
};
use testcontainers_modules::mssql_server::MssqlServer;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ImageExt};

// ── harness ─────────────────────────────────────────────────────────────────

/// SA password — matches `docker-compose.yml`'s `mssql` service.
const SA_PASSWORD: &str = "Test@1234";

/// Boot a fresh `mssql/server:2022-latest` container, connect as `sa`, create a
/// dedicated `appdb` user database and switch the session to it (the schema
/// browser hides the `master`/`model`/`msdb`/`tempdb` system databases, so all
/// test objects must live in a user database to be visible). The container guard
/// must be kept alive for the duration of the test.
async fn start_mssql() -> (ContainerAsync<MssqlServer>, Box<dyn DatabaseDriver>) {
    let container = MssqlServer::default()
        .with_accept_eula()
        .with_sa_password(SA_PASSWORD)
        .with_tag("2022-latest")
        .start()
        .await
        .expect("start mssql container");
    let host = container.get_host().await.expect("container host").to_string();
    let port = container
        .get_host_port_ipv4(1433)
        .await
        .expect("container port");

    let mut cfg = ConnectionConfig::new("it-mssql", DatabaseKind::Mssql);
    cfg.host = host;
    cfg.port = port;
    cfg.user = "sa".to_string();
    cfg.password = SA_PASSWORD.to_string();
    cfg.database = "master".to_string();
    // The container's certificate is self-signed; require TLS but trust it.
    cfg.ssl_mode = arris_engines::SslMode::Required;

    let driver = driver_for_kind(DatabaseKind::Mssql).expect("mssql driver");
    driver.connect(&cfg).await.expect("connect to mssql");

    // Work inside a user database so created objects show up in list_schemas().
    run(driver.as_ref(), "CREATE DATABASE appdb").await;
    run(driver.as_ref(), "USE appdb").await;

    (container, driver)
}

async fn run(driver: &dyn DatabaseDriver, sql: &str) -> QueryResult {
    driver
        .run_query(sql, &[], QueryLanguage::Native)
        .await
        .unwrap_or_else(|e| panic!("query failed: {sql}\n  error: {e:?}"))
}

/// Run a statement and assert how many rows it reported as affected. For SQL
/// Server this only reflects reality when the statement carries an `OUTPUT`
/// clause (see the module docs).
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
    // Lazy split: list_schemas returns containers only; load dbo's objects
    // too so object-level has_node assertions still find them.
    let mut tree = driver.list_schemas().await.expect("list_schemas");
    tree.extend(driver.list_schema("dbo").await.expect("list_schema"));
    tree
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

/// Build an `ObjectRef` in the default `dbo` schema and fetch the engine's
/// reconstructed/stored DDL through `DatabaseDriver::object_definition`.
async fn object_def(driver: &dyn DatabaseDriver, kind: SchemaNodeKind, name: &str) -> String {
    let object = ObjectRef {
        kind,
        database: None,
        schema: Some("dbo".to_string()),
        name: name.to_string(),
    };
    driver
        .object_definition(&object)
        .await
        .unwrap_or_else(|e| panic!("object_definition({kind:?}, {name}) failed: {e:?}"))
}

// ── CRUD ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn crud_insert_update_delete_select() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE users (id INT IDENTITY(1,1) PRIMARY KEY, name NVARCHAR(50) NOT NULL, age INT)",
    )
    .await;

    // Multi-row INSERT; OUTPUT inserted.id makes the engine count affected rows.
    let inserted = exec_affected(
        d,
        "INSERT INTO users (name, age) OUTPUT inserted.id VALUES ('alice', 30), ('bob', 25), ('carol', 40)",
    )
    .await;
    assert_eq!(inserted, 3);

    // Insert-returning, SQL-Server style: the OUTPUT row count is what the engine
    // surfaces (the values are dropped on the execute path), so we read the new
    // row back with a SELECT.
    assert_eq!(
        exec_affected(d, "INSERT INTO users (name, age) OUTPUT inserted.id VALUES ('dave', 22)").await,
        1
    );
    assert_eq!(
        as_i64(scalar(&run(d, "SELECT age FROM users WHERE name = 'dave'").await)),
        22
    );

    // Filtered SELECT with WHERE / ORDER BY / TOP (T-SQL's LIMIT).
    let top = run(
        d,
        "SELECT TOP 2 name, age FROM users WHERE age >= 25 ORDER BY age DESC",
    )
    .await;
    assert_eq!(col_names(&top), ["name", "age"]);
    assert_eq!(col_type(&top, "name"), "nvarchar");
    assert_eq!(col_type(&top, "age"), "int");
    assert_eq!(top.rows.len(), 2);
    assert_eq!(as_text(&top.rows[0][0]), "carol");
    assert_eq!(as_i64(&top.rows[0][1]), 40);
    assert_eq!(as_text(&top.rows[1][0]), "alice");

    // JOIN.
    run(
        d,
        "CREATE TABLE orders (id INT IDENTITY(1,1) PRIMARY KEY, user_id INT, amount INT)",
    )
    .await;
    run(
        d,
        "INSERT INTO orders (user_id, amount) SELECT id, 100 FROM users WHERE name = 'alice'",
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

    // UPDATE (OUTPUT inserted.id → affected count).
    assert_eq!(
        exec_affected(d, "UPDATE users SET age = 31 OUTPUT inserted.id WHERE name = 'alice'").await,
        1
    );
    assert_eq!(
        as_i64(scalar(&run(d, "SELECT age FROM users WHERE name = 'alice'").await)),
        31
    );

    // DELETE (OUTPUT deleted.id → affected count).
    assert_eq!(
        exec_affected(d, "DELETE FROM users OUTPUT deleted.id WHERE name = 'bob'").await,
        1
    );
    assert_eq!(
        as_i64(scalar(&run(d, "SELECT COUNT(*) FROM users").await)),
        3 // alice, carol, dave
    );
}

// ── Window / analytic functions ─────────────────────────────────────────────

#[tokio::test]
async fn window_functions() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE sales (region NVARCHAR(10), amount INT)").await;
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
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running \
         FROM sales ORDER BY amount",
    )
    .await;
    assert_eq!(col_names(&r), ["region", "amount", "rn", "rnk", "prev", "nxt", "running"]);
    assert_eq!(col_type(&r, "rn"), "bigint"); // ROW_NUMBER() → bigint
    assert_eq!(r.rows.len(), 5);

    // Ordered by amount asc: [10, 20, 30, 40, 50].
    // First row (amount=10, region east): LAG NULL, running within 'east' = 10.
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

// ── T-SQL specific: TOP + OFFSET … FETCH NEXT ────────────────────────────────

#[tokio::test]
async fn tsql_top_and_offset_fetch() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE nums (n INT)").await;
    run(
        d,
        "INSERT INTO nums (n) VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10)",
    )
    .await;

    // TOP n.
    let top = run(d, "SELECT TOP 3 n FROM nums ORDER BY n DESC").await;
    assert_eq!(top.rows.len(), 3);
    assert_eq!(as_i64(&top.rows[0][0]), 10);
    assert_eq!(as_i64(&top.rows[2][0]), 8);

    // OFFSET … FETCH NEXT (skip 2, take 3 → 3,4,5).
    let page = run(
        d,
        "SELECT n FROM nums ORDER BY n OFFSET 2 ROWS FETCH NEXT 3 ROWS ONLY",
    )
    .await;
    assert_eq!(page.rows.len(), 3);
    assert_eq!(as_i64(&page.rows[0][0]), 3);
    assert_eq!(as_i64(&page.rows[1][0]), 4);
    assert_eq!(as_i64(&page.rows[2][0]), 5);
}

// ── T-SQL specific: MERGE upsert ─────────────────────────────────────────────

#[tokio::test]
async fn tsql_merge_upsert() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE kv (k NVARCHAR(10) PRIMARY KEY, v INT)").await;
    run(d, "INSERT INTO kv (k, v) VALUES ('a', 1)").await;

    // MATCHED → accumulate.
    run(
        d,
        "MERGE kv AS t USING (SELECT 'a' AS k, 5 AS v) AS s ON t.k = s.k \
         WHEN MATCHED THEN UPDATE SET v = t.v + s.v \
         WHEN NOT MATCHED THEN INSERT (k, v) VALUES (s.k, s.v);",
    )
    .await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT v FROM kv WHERE k = 'a'").await)), 6);

    // NOT MATCHED → insert.
    run(
        d,
        "MERGE kv AS t USING (SELECT 'b' AS k, 9 AS v) AS s ON t.k = s.k \
         WHEN NOT MATCHED THEN INSERT (k, v) VALUES (s.k, s.v);",
    )
    .await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT v FROM kv WHERE k = 'b'").await)), 9);
    assert_eq!(as_i64(scalar(&run(d, "SELECT COUNT(*) FROM kv").await)), 2);
}

// ── T-SQL specific: PIVOT / UNPIVOT ──────────────────────────────────────────

#[tokio::test]
async fn tsql_pivot_and_unpivot() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE qsales (region NVARCHAR(10), quarter NVARCHAR(2), amount INT)",
    )
    .await;
    run(
        d,
        "INSERT INTO qsales (region, quarter, amount) VALUES \
         ('east','Q1',10), ('east','Q2',20), ('west','Q1',30), ('west','Q2',40)",
    )
    .await;

    // PIVOT quarters into columns.
    let pivoted = run(
        d,
        "SELECT region, [Q1], [Q2] \
         FROM (SELECT region, quarter, amount FROM qsales) src \
         PIVOT (SUM(amount) FOR quarter IN ([Q1], [Q2])) p \
         ORDER BY region",
    )
    .await;
    assert_eq!(col_names(&pivoted), ["region", "Q1", "Q2"]);
    assert_eq!(pivoted.rows.len(), 2);
    assert_eq!(as_text(&pivoted.rows[0][0]), "east");
    assert_eq!(as_i64(&pivoted.rows[0][1]), 10);
    assert_eq!(as_i64(&pivoted.rows[0][2]), 20);
    assert_eq!(as_text(&pivoted.rows[1][0]), "west");
    assert_eq!(as_i64(&pivoted.rows[1][1]), 30);
    assert_eq!(as_i64(&pivoted.rows[1][2]), 40);

    // UNPIVOT columns back into rows.
    run(d, "CREATE TABLE wide (region NVARCHAR(10), q1 INT, q2 INT)").await;
    run(d, "INSERT INTO wide (region, q1, q2) VALUES ('east', 10, 20)").await;
    let unpivoted = run(
        d,
        "SELECT region, quarter, amount \
         FROM wide UNPIVOT (amount FOR quarter IN (q1, q2)) u \
         ORDER BY quarter",
    )
    .await;
    assert_eq!(col_names(&unpivoted), ["region", "quarter", "amount"]);
    assert_eq!(unpivoted.rows.len(), 2);
    assert_eq!(as_text(&unpivoted.rows[0][1]), "q1");
    assert_eq!(as_i64(&unpivoted.rows[0][2]), 10);
    assert_eq!(as_text(&unpivoted.rows[1][1]), "q2");
    assert_eq!(as_i64(&unpivoted.rows[1][2]), 20);
}

// ── T-SQL specific: CTE incl. recursive ──────────────────────────────────────

#[tokio::test]
async fn tsql_recursive_and_plain_cte() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    // Recursive CTE: 1..5.
    let sum = run(
        d,
        "WITH nums AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM nums WHERE n < 5) \
         SELECT SUM(n) AS total FROM nums",
    )
    .await;
    assert_eq!(col_names(&sum), ["total"]);
    assert_eq!(as_i64(scalar(&sum)), 15);

    // Plain CTE.
    let plain = run(
        d,
        "WITH t AS (SELECT 42 AS a) SELECT a FROM t",
    )
    .await;
    assert_eq!(as_i64(scalar(&plain)), 42);
}

// ── T-SQL specific: TRY_CAST / TRY_CONVERT / STRING_AGG ───────────────────────

#[tokio::test]
async fn tsql_try_cast_convert_and_string_agg() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    // TRY_CAST: valid → value, invalid → NULL.
    assert_eq!(as_i64(scalar(&run(d, "SELECT TRY_CAST('123' AS INT)").await)), 123);
    assert!(scalar(&run(d, "SELECT TRY_CAST('abc' AS INT)").await).is_null());

    // TRY_CONVERT: valid → value, invalid → NULL.
    assert_eq!(as_i64(scalar(&run(d, "SELECT TRY_CONVERT(INT, '456')").await)), 456);
    assert!(scalar(&run(d, "SELECT TRY_CONVERT(INT, 'xyz')").await).is_null());

    // STRING_AGG with ordering.
    run(d, "CREATE TABLE tags (id INT, label NVARCHAR(20))").await;
    run(
        d,
        "INSERT INTO tags (id, label) VALUES (1, 'a'), (1, 'b'), (1, 'c')",
    )
    .await;
    let agg = run(
        d,
        "SELECT STRING_AGG(label, ',') WITHIN GROUP (ORDER BY label) FROM tags",
    )
    .await;
    assert_eq!(as_text(scalar(&agg)), "a,b,c");
}

// ── Views: create / read / replace / drop + schema browser ───────────────────

#[tokio::test]
async fn view_full_lifecycle() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE employees (id INT IDENTITY(1,1) PRIMARY KEY, name NVARCHAR(20), dept NVARCHAR(20), salary INT)",
    )
    .await;
    run(
        d,
        "INSERT INTO employees (name, dept, salary) VALUES \
         ('alice', 'eng', 150), ('bob', 'eng', 90), \
         ('carol', 'sales', 120), ('dave', 'sales', 80)",
    )
    .await;

    // CREATE (must be the only statement in the batch).
    run(
        d,
        "CREATE VIEW high_earners AS \
         SELECT id, name, salary FROM employees WHERE salary >= 100",
    )
    .await;

    // READ — assert columns, types, and the full row set.
    let v = run(d, "SELECT * FROM high_earners ORDER BY salary DESC").await;
    assert_eq!(col_names(&v), ["id", "name", "salary"]);
    assert_eq!(col_type(&v, "salary"), "int");
    assert_eq!(v.rows.len(), 2);
    assert_eq!(as_text(&v.rows[0][1]), "alice");
    assert_eq!(as_i64(&v.rows[0][2]), 150);
    assert_eq!(as_text(&v.rows[1][1]), "carol");
    assert_eq!(as_i64(&v.rows[1][2]), 120);

    // REPLACE the definition via CREATE OR ALTER (tighten the filter).
    run(
        d,
        "CREATE OR ALTER VIEW high_earners AS \
         SELECT id, name, salary FROM employees WHERE salary >= 130",
    )
    .await;
    let v2 = run(d, "SELECT * FROM high_earners ORDER BY salary DESC").await;
    assert_eq!(v2.rows.len(), 1);
    assert_eq!(as_text(&v2.rows[0][1]), "alice");

    // The schema browser surfaces the view.
    assert!(has_node(&schema_tree(d).await, "high_earners", SchemaNodeKind::View));

    // DROP — gone from the browser and no longer queryable.
    run(d, "DROP VIEW high_earners").await;
    assert!(!has_node(&schema_tree(d).await, "high_earners", SchemaNodeKind::View));
    assert!(
        driver
            .run_query("SELECT * FROM high_earners", &[], QueryLanguage::Native)
            .await
            .is_err()
    );
}

// ── Indexed view (SQL Server's materialized-view equivalent) ──────────────────

#[tokio::test]
async fn indexed_view_lifecycle() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(
        d,
        // val is NOT NULL: an indexed view's SUM() must be over a non-nullable
        // expression (SQL Server error 8662 otherwise).
        "CREATE TABLE metrics (id INT PRIMARY KEY, region NVARCHAR(10), val INT NOT NULL)",
    )
    .await;
    run(
        d,
        "INSERT INTO metrics (id, region, val) VALUES (1,'east',10), (2,'east',20), (3,'west',30)",
    )
    .await;

    // Indexed view requires SCHEMABINDING + COUNT_BIG(*) and a unique clustered
    // index. Once the clustered index exists the aggregate is materialized.
    run(
        d,
        "CREATE VIEW metric_rollup WITH SCHEMABINDING AS \
         SELECT region, COUNT_BIG(*) AS cnt, SUM(val) AS total \
         FROM dbo.metrics GROUP BY region",
    )
    .await;
    run(
        d,
        "CREATE UNIQUE CLUSTERED INDEX idx_metric_rollup ON metric_rollup (region)",
    )
    .await;

    // NOEXPAND forces the read to come from the materialized index.
    let r = run(
        d,
        "SELECT region, total FROM metric_rollup WITH (NOEXPAND) ORDER BY region",
    )
    .await;
    assert_eq!(col_names(&r), ["region", "total"]);
    assert_eq!(r.rows.len(), 2);
    assert_eq!(as_text(&r.rows[0][0]), "east");
    assert_eq!(as_i64(&r.rows[0][1]), 30);
    assert_eq!(as_text(&r.rows[1][0]), "west");
    assert_eq!(as_i64(&r.rows[1][1]), 30);

    // The browser surfaces the view and its clustered index (indexes are named
    // `<object>.<index>` in the tree).
    let tree = schema_tree(d).await;
    assert!(has_node(&tree, "metric_rollup", SchemaNodeKind::View));
    assert!(has_node(&tree, "metric_rollup.idx_metric_rollup", SchemaNodeKind::Index));

    run(d, "DROP VIEW metric_rollup").await;
    assert!(!has_node(&schema_tree(d).await, "metric_rollup", SchemaNodeKind::View));
}

// ── Functions: scalar + table-valued, create / replace / call / drop ──────────

#[tokio::test]
async fn function_lifecycle() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    // Scalar function.
    run(
        d,
        "CREATE FUNCTION dbo.add_two (@a INT, @b INT) RETURNS INT AS BEGIN RETURN @a + @b END",
    )
    .await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT dbo.add_two(2, 3)").await)), 5);

    run(
        d,
        "CREATE OR ALTER FUNCTION dbo.add_two (@a INT, @b INT) RETURNS INT AS BEGIN RETURN @a + @b + 100 END",
    )
    .await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT dbo.add_two(2, 3)").await)), 105);

    // Inline table-valued function.
    run(
        d,
        "CREATE FUNCTION dbo.evens (@max INT) RETURNS TABLE AS \
         RETURN (SELECT n FROM (VALUES (2),(4),(6)) v(n) WHERE n <= @max)",
    )
    .await;
    let evens = run(d, "SELECT n FROM dbo.evens(4) ORDER BY n").await;
    assert_eq!(evens.rows.len(), 2);
    assert_eq!(as_i64(&evens.rows[0][0]), 2);
    assert_eq!(as_i64(&evens.rows[1][0]), 4);

    // Both surface as Function in the browser.
    let tree = schema_tree(d).await;
    assert!(has_node(&tree, "add_two", SchemaNodeKind::Function));
    assert!(has_node(&tree, "evens", SchemaNodeKind::Function));

    run(d, "DROP FUNCTION dbo.add_two").await;
    run(d, "DROP FUNCTION dbo.evens").await;
    let tree = schema_tree(d).await;
    assert!(!has_node(&tree, "add_two", SchemaNodeKind::Function));
    assert!(!has_node(&tree, "evens", SchemaNodeKind::Function));
}

// ── Stored procedures: create / replace / call / drop ─────────────────────────

#[tokio::test]
async fn procedure_lifecycle() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE audit_log (entry NVARCHAR(50))").await;
    run(
        d,
        "CREATE PROCEDURE dbo.record (@msg NVARCHAR(50)) AS \
         BEGIN INSERT INTO audit_log (entry) VALUES (@msg) END",
    )
    .await;

    // CALL via EXEC (mutates).
    run(d, "EXEC dbo.record @msg = 'hello'").await;
    assert_eq!(
        as_text(scalar(&run(d, "SELECT entry FROM audit_log WHERE entry = 'hello'").await)),
        "hello"
    );

    // Replace the body; the new behavior prefixes the message.
    run(
        d,
        "CREATE OR ALTER PROCEDURE dbo.record (@msg NVARCHAR(50)) AS \
         BEGIN INSERT INTO audit_log (entry) VALUES (CONCAT('v2:', @msg)) END",
    )
    .await;
    run(d, "EXEC dbo.record @msg = 'world'").await;
    assert_eq!(
        as_text(scalar(&run(d, "SELECT entry FROM audit_log WHERE entry = 'v2:world'").await)),
        "v2:world"
    );
    assert_eq!(as_i64(scalar(&run(d, "SELECT COUNT(*) FROM audit_log").await)), 2);

    assert!(has_node(&schema_tree(d).await, "record", SchemaNodeKind::Procedure));

    run(d, "DROP PROCEDURE dbo.record").await;
    assert!(!has_node(&schema_tree(d).await, "record", SchemaNodeKind::Procedure));
}

// ── Triggers: create / fire / drop + schema browser ──────────────────────────

#[tokio::test]
async fn trigger_fires_and_appears_in_browser() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)").await;
    run(d, "CREATE TABLE account_audit (account_id INT, new_balance INT)").await;
    run(
        d,
        "CREATE TRIGGER trg_audit ON accounts AFTER INSERT, UPDATE AS \
         BEGIN INSERT INTO account_audit (account_id, new_balance) \
         SELECT id, balance FROM inserted END",
    )
    .await;

    // Fires on both INSERT and UPDATE.
    run(d, "INSERT INTO accounts (id, balance) VALUES (1, 100)").await;
    run(d, "UPDATE accounts SET balance = 250 WHERE id = 1").await;

    let audit = run(
        d,
        "SELECT account_id, new_balance FROM account_audit ORDER BY new_balance",
    )
    .await;
    assert_eq!(audit.rows.len(), 2);
    assert_eq!(as_i64(&audit.rows[0][0]), 1);
    assert_eq!(as_i64(&audit.rows[0][1]), 100); // from the INSERT
    assert_eq!(as_i64(&audit.rows[1][1]), 250); // from the UPDATE

    assert!(has_node(&schema_tree(d).await, "trg_audit", SchemaNodeKind::Trigger));

    run(d, "DROP TRIGGER trg_audit").await;
    assert!(!has_node(&schema_tree(d).await, "trg_audit", SchemaNodeKind::Trigger));
}

// ── Indexes: create / appear in browser / used by the planner / drop ─────────

#[tokio::test]
async fn index_lifecycle_and_explain_usage() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE items (id INT IDENTITY(1,1) PRIMARY KEY, sku NVARCHAR(20), qty INT)",
    )
    .await;
    // GENERATE_SERIES (SQL Server 2022) gives us 1000 rows cheaply.
    run(
        d,
        "INSERT INTO items (sku, qty) \
         SELECT CONCAT('sku', value), value FROM GENERATE_SERIES(1, 1000)",
    )
    .await;
    run(d, "CREATE INDEX idx_items_sku ON items (sku)").await;

    // The schema browser surfaces the index (named `<table>.<index>`).
    assert!(has_node(
        &schema_tree(d).await,
        "items.idx_items_sku",
        SchemaNodeKind::Index
    ));

    // The planner uses it — force the index via a hint so the choice is
    // deterministic and read the plan through the engine's explain path.
    let plan = driver
        .explain_query(
            "SELECT id, qty FROM items WITH (INDEX(idx_items_sku)) WHERE sku = 'sku500'",
            &[],
            QueryLanguage::Native,
            ExplainMode::DryRun,
        )
        .await
        .expect("explain");
    assert!(
        plan.raw.contains("idx_items_sku"),
        "expected the index in the plan, got: {}",
        plan.raw
    );

    // DROP removes our named index from the browser (the PK index remains).
    run(d, "DROP INDEX idx_items_sku ON items").await;
    assert!(!has_node(
        &schema_tree(d).await,
        "items.idx_items_sku",
        SchemaNodeKind::Index
    ));
}

// ── Sequences: create / NEXT VALUE FOR / alter / drop ────────────────────────

#[tokio::test]
async fn sequence_lifecycle() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(d, "CREATE SEQUENCE order_seq AS INT START WITH 100 INCREMENT BY 5").await;

    // NEXT VALUE FOR advances by the increment.
    assert_eq!(as_i64(scalar(&run(d, "SELECT NEXT VALUE FOR order_seq").await)), 100);
    assert_eq!(as_i64(scalar(&run(d, "SELECT NEXT VALUE FOR order_seq").await)), 105);

    assert!(has_node(&schema_tree(d).await, "order_seq", SchemaNodeKind::Sequence));

    // ALTER … RESTART resets the counter.
    run(d, "ALTER SEQUENCE order_seq RESTART WITH 1").await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT NEXT VALUE FOR order_seq").await)), 1);

    run(d, "DROP SEQUENCE order_seq").await;
    assert!(!has_node(&schema_tree(d).await, "order_seq", SchemaNodeKind::Sequence));
}

// ── Access control: login / user / role / grant-revoke (positive + negative) ─

#[tokio::test]
async fn login_user_role_and_privileges() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    // Server login + database user. CHECK_POLICY = OFF avoids the host password
    // policy rejecting the test password.
    run(
        d,
        "CREATE LOGIN app_login WITH PASSWORD = 'Str0ng#Pass1', CHECK_POLICY = OFF",
    )
    .await;
    run(d, "CREATE USER app_user FOR LOGIN app_login").await;

    // Role + membership.
    run(d, "CREATE ROLE analyst").await;
    run(d, "ALTER ROLE analyst ADD MEMBER app_user").await;
    assert_eq!(
        as_i64(scalar(&run(d, "SELECT IS_ROLEMEMBER('analyst', 'app_user')").await)),
        1
    );

    // GRANT SELECT to the role; the member inherits it.
    run(d, "CREATE TABLE reports (id INT)").await;
    run(d, "GRANT SELECT ON reports TO analyst").await;

    // Positive: app_user can SELECT (effective permission, evaluated as the user).
    assert_eq!(
        as_i64(scalar(
            &run(
                d,
                "EXECUTE AS USER = 'app_user'; \
                 SELECT HAS_PERMS_BY_NAME('dbo.reports', 'OBJECT', 'SELECT'); \
                 REVERT;",
            )
            .await
        )),
        1
    );
    // Negative: app_user was never granted INSERT.
    assert_eq!(
        as_i64(scalar(
            &run(
                d,
                "EXECUTE AS USER = 'app_user'; \
                 SELECT HAS_PERMS_BY_NAME('dbo.reports', 'OBJECT', 'INSERT'); \
                 REVERT;",
            )
            .await
        )),
        0
    );

    // REVOKE drops the privilege.
    run(d, "REVOKE SELECT ON reports FROM analyst").await;
    assert_eq!(
        as_i64(scalar(
            &run(
                d,
                "EXECUTE AS USER = 'app_user'; \
                 SELECT HAS_PERMS_BY_NAME('dbo.reports', 'OBJECT', 'SELECT'); \
                 REVERT;",
            )
            .await
        )),
        0
    );

    // DROP everything (member user first, then the now-empty role, then login).
    run(d, "DROP USER app_user").await;
    run(d, "DROP ROLE analyst").await;
    run(d, "DROP LOGIN app_login").await;
    assert_eq!(
        as_i64(scalar(
            &run(
                d,
                "SELECT COUNT(*) FROM sys.database_principals WHERE name IN ('app_user', 'analyst')",
            )
            .await
        )),
        0
    );
}

// ── Transaction control ──────────────────────────────────────────────────────
//
// MSSQL pins a single tiberius `Client`, so a manual transaction spans calls
// naturally (the Postgres pattern). Isolation is set via `SET TRANSACTION
// ISOLATION LEVEL` paired with `BEGIN TRAN`. A second independent driver
// connection observes what is actually committed.

/// Connect a second, independent session to the same container, switched into
/// the `appdb` user database.
async fn connect_mssql_second(container: &ContainerAsync<MssqlServer>) -> Box<dyn DatabaseDriver> {
    let host = container.get_host().await.expect("container host").to_string();
    let port = container.get_host_port_ipv4(1433).await.expect("container port");
    let mut cfg = ConnectionConfig::new("it-mssql-2", DatabaseKind::Mssql);
    cfg.host = host;
    cfg.port = port;
    cfg.user = "sa".to_string();
    cfg.password = SA_PASSWORD.to_string();
    cfg.database = "appdb".to_string();
    cfg.ssl_mode = arris_engines::SslMode::Required;
    let driver = driver_for_kind(DatabaseKind::Mssql).expect("mssql driver");
    driver.connect(&cfg).await.expect("connect second session");
    driver
}

#[tokio::test]
async fn manual_commit_makes_rows_visible_to_other_sessions() {
    let (container, tx) = start_mssql().await;
    let other = connect_mssql_second(&container).await;
    run(tx.as_ref(), "CREATE TABLE acct (id INT PRIMARY KEY, bal INT)").await;

    assert!(tx.supports_transactions());
    assert!(!tx.in_transaction().await);
    tx.begin_transaction(arris_engines::IsolationLevel::Default).await.expect("begin");
    assert!(tx.in_transaction().await);

    // MSSQL uses pessimistic locking under the default READ COMMITTED isolation:
    // a reader blocks on an uncommitted write rather than seeing an older
    // snapshot (unlike Postgres MVCC). Cap the other session's lock wait so the
    // blocked read errors — proving the row is held uncommitted — instead of
    // hanging until the writer commits.
    run(other.as_ref(), "SET LOCK_TIMEOUT 3000").await;

    run(tx.as_ref(), "INSERT INTO acct VALUES (1, 100)").await;

    // The uncommitted write blocks the other session's read → lock-timeout error.
    let blocked = other
        .run_query("SELECT count(*) FROM appdb.dbo.acct", &[], QueryLanguage::Native)
        .await;
    assert!(
        blocked.is_err(),
        "uncommitted row must be invisible to (here: block) another session",
    );

    tx.commit_transaction().await.expect("commit");
    assert!(!tx.in_transaction().await);

    let after = run(other.as_ref(), "SELECT count(*) FROM appdb.dbo.acct").await;
    assert_eq!(as_i64(scalar(&after)), 1);
    let row = run(other.as_ref(), "SELECT bal FROM appdb.dbo.acct WHERE id = 1").await;
    assert_eq!(as_i64(scalar(&row)), 100);
}

#[tokio::test]
async fn manual_rollback_discards_changes() {
    let (container, tx) = start_mssql().await;
    let other = connect_mssql_second(&container).await;
    run(tx.as_ref(), "CREATE TABLE note (id INT)").await;

    tx.begin_transaction(arris_engines::IsolationLevel::Default).await.expect("begin");
    run(tx.as_ref(), "INSERT INTO note VALUES (1), (2)").await;
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM note").await)), 2);

    tx.rollback_transaction().await.expect("rollback");
    assert!(!tx.in_transaction().await);

    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM note").await)), 0);
    assert_eq!(as_i64(scalar(&run(other.as_ref(), "SELECT count(*) FROM appdb.dbo.note").await)), 0);
}

#[tokio::test]
async fn failed_statement_does_not_abort_manual_transaction() {
    // With XACT_ABORT OFF (the default), a run-time error rolls back only the
    // failing statement; the transaction stays open and committable.
    let (_container, tx) = start_mssql().await;
    run(tx.as_ref(), "CREATE TABLE acct (id INT PRIMARY KEY, bal INT)").await;

    tx.begin_transaction(arris_engines::IsolationLevel::Default).await.expect("begin");
    run(tx.as_ref(), "INSERT INTO acct VALUES (1, 100)").await;

    let err = tx
        .run_query("INSERT INTO acct VALUES (1, 999)", &[], QueryLanguage::Native)
        .await;
    assert!(err.is_err(), "duplicate insert should fail");
    assert!(tx.in_transaction().await, "transaction should remain open after error");

    run(tx.as_ref(), "INSERT INTO acct VALUES (2, 200)").await;
    tx.commit_transaction().await.expect("commit");
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM acct").await)), 2);
}

#[tokio::test]
async fn begin_applies_requested_isolation_level() {
    let (_container, tx) = start_mssql().await;

    // sys.dm_exec_sessions encodes the level: 3 = REPEATABLE READ, 4 = SERIALIZABLE.
    tx.begin_transaction(arris_engines::IsolationLevel::Serializable).await.expect("begin");
    let lvl = run(
        tx.as_ref(),
        "SELECT transaction_isolation_level FROM sys.dm_exec_sessions WHERE session_id = @@SPID",
    )
    .await;
    assert_eq!(as_i64(scalar(&lvl)), 4, "expected SERIALIZABLE");
    tx.commit_transaction().await.expect("commit");

    tx.begin_transaction(arris_engines::IsolationLevel::RepeatableRead).await.expect("begin");
    let lvl = run(
        tx.as_ref(),
        "SELECT transaction_isolation_level FROM sys.dm_exec_sessions WHERE session_id = @@SPID",
    )
    .await;
    assert_eq!(as_i64(scalar(&lvl)), 3, "expected REPEATABLE READ");
    tx.rollback_transaction().await.expect("rollback");
}

// ── object_definition: reconstructed / stored DDL per object kind ─────────────
//
// `DatabaseDriver::object_definition(&ObjectRef)` returns the DDL the engine
// shows in the "Show DDL" surface: a full reconstruction for tables/indexes/
// sequences, and the verbatim `OBJECT_DEFINITION` module text for views,
// procedures, functions and triggers. Each test owns its own container.

#[tokio::test]
async fn object_definition_table_reconstructs_and_round_trips() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    // Parent table the FK points at.
    run(d, "CREATE TABLE categories (id INT IDENTITY(1,1) PRIMARY KEY, label NVARCHAR(40) NOT NULL)").await;

    // Child table exercising every reconstructed feature: IDENTITY PK, a NOT NULL
    // column with a DEFAULT, a UNIQUE constraint, a CHECK constraint, and an FK
    // to categories — plus a secondary nonclustered index.
    run(
        d,
        "CREATE TABLE products ( \
           id INT IDENTITY(1,1) CONSTRAINT pk_products PRIMARY KEY, \
           sku NVARCHAR(20) NOT NULL CONSTRAINT uq_products_sku UNIQUE, \
           qty INT NOT NULL CONSTRAINT df_products_qty DEFAULT (0), \
           price INT NOT NULL CONSTRAINT ck_products_price CHECK (price >= 0), \
           category_id INT NOT NULL CONSTRAINT fk_products_category \
             REFERENCES categories (id) \
         )",
    )
    .await;
    run(d, "CREATE INDEX idx_products_qty ON products (qty)").await;

    let ddl = object_def(d, SchemaNodeKind::Table, "products").await;

    // Header + bracket-quoted schema.table.
    assert!(ddl.contains("CREATE TABLE [dbo].[products]"), "ddl: {ddl}");
    // IDENTITY PK column.
    assert!(ddl.contains("[id] int IDENTITY(1,1) NOT NULL"), "ddl: {ddl}");
    // NOT NULL appears for the non-null columns.
    assert!(ddl.contains("NOT NULL"), "ddl: {ddl}");
    // DEFAULT on qty (engine renders the constraint expr parenthesised).
    assert!(ddl.contains("DEFAULT ((0))"), "ddl: {ddl}");
    // Constraint clauses.
    assert!(ddl.contains("PRIMARY KEY"), "ddl: {ddl}");
    assert!(ddl.contains("UNIQUE ([sku])"), "ddl: {ddl}");
    assert!(ddl.contains("CHECK ([price]>=(0))"), "ddl: {ddl}");
    assert!(
        ddl.contains("FOREIGN KEY ([category_id]) REFERENCES [dbo].[categories] ([id])"),
        "ddl: {ddl}"
    );
    // Trailing standalone index.
    assert!(
        ddl.contains("CREATE NONCLUSTERED INDEX [idx_products_qty] ON [dbo].[products] ([qty] ASC)"),
        "ddl: {ddl}"
    );

    // STRONG round-trip: drop both tables, re-run the returned DDL, confirm it
    // recreates an identical structure. The DDL declares the FK to categories,
    // so categories must be recreated first; we reconstruct it the same way.
    let cat_ddl = object_def(d, SchemaNodeKind::Table, "categories").await;
    run(d, "DROP TABLE products").await; // child first (FK dependency)
    run(d, "DROP TABLE categories").await;
    assert!(
        driver
            .run_query("SELECT * FROM products", &[], QueryLanguage::Native)
            .await
            .is_err(),
        "products must be gone before re-creation"
    );

    run(d, &cat_ddl).await;
    run(d, &ddl).await;

    // Re-created: queryable, the index is back, and re-extracting the DDL yields
    // the same FK clause (structure preserved through the round trip).
    assert_eq!(as_i64(scalar(&run(d, "SELECT COUNT(*) FROM products").await)), 0);
    assert!(has_node(
        &schema_tree(d).await,
        "products.idx_products_qty",
        SchemaNodeKind::Index
    ));
    let ddl2 = object_def(d, SchemaNodeKind::Table, "products").await;
    assert!(
        ddl2.contains("FOREIGN KEY ([category_id]) REFERENCES [dbo].[categories] ([id])"),
        "round-tripped ddl: {ddl2}"
    );
    assert!(
        ddl2.contains("CREATE NONCLUSTERED INDEX [idx_products_qty] ON [dbo].[products] ([qty] ASC)"),
        "round-tripped ddl: {ddl2}"
    );
}

#[tokio::test]
async fn object_definition_view_returns_module_text() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE staff (id INT PRIMARY KEY, name NVARCHAR(20), salary INT)").await;
    run(
        d,
        "CREATE VIEW top_staff AS SELECT id, name FROM staff WHERE salary >= 100",
    )
    .await;

    let ddl = object_def(d, SchemaNodeKind::View, "top_staff").await;
    // OBJECT_DEFINITION returns the verbatim CREATE text.
    assert!(ddl.contains("CREATE VIEW"), "ddl: {ddl}");
    assert!(ddl.contains("top_staff"), "ddl: {ddl}");
    assert!(ddl.contains("salary >= 100"), "ddl: {ddl}");
}

#[tokio::test]
async fn object_definition_procedure_returns_module_text() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE log_entries (entry NVARCHAR(50))").await;
    run(
        d,
        "CREATE PROCEDURE dbo.write_log (@msg NVARCHAR(50)) AS \
         BEGIN INSERT INTO log_entries (entry) VALUES (@msg) END",
    )
    .await;

    let ddl = object_def(d, SchemaNodeKind::Procedure, "write_log").await;
    assert!(ddl.contains("CREATE PROCEDURE"), "ddl: {ddl}");
    assert!(ddl.contains("write_log"), "ddl: {ddl}");
    assert!(ddl.contains("@msg"), "ddl: {ddl}");
    assert!(ddl.contains("INSERT INTO log_entries"), "ddl: {ddl}");
}

#[tokio::test]
async fn object_definition_function_returns_module_text() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE FUNCTION dbo.triple (@n INT) RETURNS INT AS BEGIN RETURN @n * 3 END",
    )
    .await;

    let ddl = object_def(d, SchemaNodeKind::Function, "triple").await;
    assert!(ddl.contains("CREATE FUNCTION"), "ddl: {ddl}");
    assert!(ddl.contains("triple"), "ddl: {ddl}");
    assert!(ddl.contains("RETURN @n * 3"), "ddl: {ddl}");
}

#[tokio::test]
async fn object_definition_trigger_returns_module_text() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE ledger (id INT PRIMARY KEY, amount INT)").await;
    run(d, "CREATE TABLE ledger_audit (id INT, amount INT)").await;
    run(
        d,
        "CREATE TRIGGER trg_ledger ON ledger AFTER INSERT AS \
         BEGIN INSERT INTO ledger_audit (id, amount) SELECT id, amount FROM inserted END",
    )
    .await;

    let ddl = object_def(d, SchemaNodeKind::Trigger, "trg_ledger").await;
    assert!(ddl.contains("CREATE TRIGGER"), "ddl: {ddl}");
    assert!(ddl.contains("trg_ledger"), "ddl: {ddl}");
    assert!(ddl.contains("AFTER INSERT"), "ddl: {ddl}");
    assert!(ddl.contains("ledger_audit"), "ddl: {ddl}");
}

#[tokio::test]
async fn object_definition_sequence_reconstructs() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(d, "CREATE SEQUENCE invoice_seq AS INT START WITH 1000 INCREMENT BY 10").await;

    let ddl = object_def(d, SchemaNodeKind::Sequence, "invoice_seq").await;
    assert!(ddl.contains("CREATE SEQUENCE [dbo].[invoice_seq]"), "ddl: {ddl}");
    assert!(ddl.contains("AS int"), "ddl: {ddl}");
    assert!(ddl.contains("START WITH 1000"), "ddl: {ddl}");
    assert!(ddl.contains("INCREMENT BY 10"), "ddl: {ddl}");

    // The reconstructed DDL is itself runnable: drop + re-create.
    run(d, "DROP SEQUENCE invoice_seq").await;
    run(d, &ddl).await;
    assert_eq!(
        as_i64(scalar(&run(d, "SELECT NEXT VALUE FOR invoice_seq").await)),
        1000
    );
}

#[tokio::test]
async fn object_definition_index_reconstructs() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE catalog (id INT IDENTITY(1,1) PRIMARY KEY, code NVARCHAR(20))",
    )
    .await;
    run(d, "CREATE INDEX idx_catalog_code ON catalog (code)").await;

    // The schema browser names index nodes `<table>.<index>`; pass that form to
    // confirm the driver derives the bare index name from it.
    let ddl = object_def(d, SchemaNodeKind::Index, "catalog.idx_catalog_code").await;
    assert!(
        ddl.contains("CREATE NONCLUSTERED INDEX [idx_catalog_code] ON [dbo].[catalog]"),
        "ddl: {ddl}"
    );
    assert!(ddl.contains("[code] ASC"), "ddl: {ddl}");

    // The driver also accepts a bare index name → identical output.
    let bare = object_def(d, SchemaNodeKind::Index, "idx_catalog_code").await;
    assert_eq!(bare, ddl);

    // Round-trip: drop + re-create the index from the returned DDL.
    run(d, "DROP INDEX idx_catalog_code ON catalog").await;
    run(d, &ddl).await;
    assert!(has_node(
        &schema_tree(d).await,
        "catalog.idx_catalog_code",
        SchemaNodeKind::Index
    ));
}

#[tokio::test]
async fn object_definition_schema_reconstructs_and_round_trips() {
    let (_c, driver) = start_mssql().await;
    let d = driver.as_ref();

    // A schema owned by dbo with one explicit schema-level grant.
    run(d, "CREATE SCHEMA reporting").await;
    run(d, "CREATE ROLE analysts").await;
    run(d, "GRANT SELECT ON SCHEMA::reporting TO analysts").await;

    // A schema node is identified by `name`; the `schema` qualifier is unused.
    let ddl = object_def(d, SchemaNodeKind::Schema, "reporting").await;
    assert!(
        ddl.contains("CREATE SCHEMA [reporting] AUTHORIZATION [dbo];"),
        "ddl: {ddl}"
    );
    assert!(
        ddl.contains("GRANT SELECT ON SCHEMA::[reporting] TO [analysts];"),
        "ddl: {ddl}"
    );

    // Round-trip: drop the schema and replay its DDL statement by statement
    // (CREATE SCHEMA must be its own batch).
    run(d, "DROP SCHEMA reporting").await;
    for stmt in ddl.split(";\n").map(str::trim).filter(|s| !s.is_empty()) {
        run(d, stmt.trim_end_matches(';')).await;
    }
    assert!(has_node(
        &schema_tree(d).await,
        "reporting",
        SchemaNodeKind::Schema
    ));
}

#[tokio::test]
async fn object_definition_missing_object_errors() {
    let (_c, driver) = start_mssql().await;

    let object = ObjectRef {
        kind: SchemaNodeKind::Table,
        database: None,
        schema: Some("dbo".to_string()),
        name: "does_not_exist".to_string(),
    };
    assert!(
        driver.object_definition(&object).await.is_err(),
        "a non-existent object must yield an error"
    );

    // A missing view (module-text path) errors too.
    let missing_view = ObjectRef {
        kind: SchemaNodeKind::View,
        database: None,
        schema: Some("dbo".to_string()),
        name: "no_such_view".to_string(),
    };
    assert!(
        driver.object_definition(&missing_view).await.is_err(),
        "a non-existent view must yield an error"
    );
}

mod dbt_diff_scenario;

/// dbt slim-diff (`MsSql` dialect: `[`-bracket quoting, native `EXCEPT`, `TOP`
/// instead of `LIMIT`) end-to-end against a real SQL Server instance. See
/// `dbt_diff_scenario` for the data set and expectations.
#[tokio::test]
async fn slim_diff_keyless_and_keyed() {
    use arris_engines::dbt::DiffDialect;

    let (_c, driver) = start_mssql().await;
    run(driver.as_ref(), "CREATE TABLE diff_prod (id INT, amount INT)").await;
    run(
        driver.as_ref(),
        "INSERT INTO diff_prod (id, amount) VALUES (1, 100), (2, 200), (3, 300)",
    )
    .await;

    let prod = "[diff_prod]";
    let new_select =
        "SELECT 2 AS id, 200 AS amount UNION ALL SELECT 3, 333 UNION ALL SELECT 4, 400";

    dbt_diff_scenario::assert_keyless(driver.as_ref(), DiffDialect::MsSql, prod, new_select).await;
    dbt_diff_scenario::assert_keyed(driver.as_ref(), DiffDialect::MsSql, prod, new_select).await;
}

// ── streaming ingestion ───────────────────────────────────────────────────────

mod streaming_scenario;

use arris_engines::{
    CanvasEngine, CanvasError, CELL_INGEST_BYTE_BUDGET, CELL_RESULT_PAGE_ROWS, QueryEngine,
};
use streaming_scenario::BOARD;
use tokio_util::sync::CancellationToken;

fn stream_canvas_engine() -> CanvasEngine {
    streaming_scenario::canvas_engine("mssql")
}

/// Boot a container and connect straight to `master` (no `USE appdb`). Streaming
/// opens a fresh connection from the stored config, so keeping the pinned client
/// and the ephemeral stream connection in the same database lets both see `src`.
async fn start_mssql_stream() -> (ContainerAsync<MssqlServer>, Box<dyn DatabaseDriver>) {
    let container = MssqlServer::default()
        .with_accept_eula()
        .with_sa_password(SA_PASSWORD)
        .with_tag("2022-latest")
        .start()
        .await
        .expect("start mssql container");
    let host = container.get_host().await.expect("container host").to_string();
    let port = container
        .get_host_port_ipv4(1433)
        .await
        .expect("container port");

    let mut cfg = ConnectionConfig::new("it-mssql-stream", DatabaseKind::Mssql);
    cfg.host = host;
    cfg.port = port;
    cfg.user = "sa".to_string();
    cfg.password = SA_PASSWORD.to_string();
    cfg.database = "master".to_string();
    cfg.ssl_mode = arris_engines::SslMode::Required;

    let driver = driver_for_kind(DatabaseKind::Mssql).expect("mssql driver");
    driver.connect(&cfg).await.expect("connect to mssql");
    (container, driver)
}

/// Create `src` and fill it with `count` rows `{n, label}` via a set-based tally
/// insert (fast; no per-row round trips).
async fn seed_stream_src(driver: &dyn DatabaseDriver, count: i64) {
    run(driver, "CREATE TABLE src (n INT PRIMARY KEY, label NVARCHAR(50))").await;
    let sql = format!(
        "INSERT INTO src (n, label) \
         SELECT rn, CONCAT(N'row-', rn) \
         FROM (SELECT TOP ({count}) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS rn \
               FROM sys.all_objects a CROSS JOIN sys.all_objects b) AS t"
    );
    run(driver, &sql).await;
}

#[tokio::test]
async fn streaming_ingests_100k_rows_with_exact_totals_and_page() {
    let (_c, driver) = start_mssql_stream().await;
    seed_stream_src(driver.as_ref(), 100_000).await;
    let engine = stream_canvas_engine();

    let stream = driver
        .run_query_stream("SELECT n, label FROM src ORDER BY n", &[], QueryLanguage::Sql)
        .await
        .expect("open stream");
    let out = engine
        .ingest_cell_stream(BOARD, "big", stream, None, CELL_INGEST_BYTE_BUDGET, None)
        .await
        .expect("ingest stream");

    assert_eq!(out.total_rows, 100_000);
    assert!(out.complete);
    assert_eq!(out.result.rows.len(), CELL_RESULT_PAGE_ROWS);
    let names: Vec<&str> = out.result.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["n", "label"]);
    assert_eq!(out.result.rows[0][0], QueryValue::Int(1));
    assert_eq!(out.result.rows[0][1], QueryValue::Text("row-1".into()));
    assert_eq!(out.result.rows[499][0], QueryValue::Int(500));

    // A chained cell aggregates the FULL cached result, not the 500-row page.
    let agg = engine
        .run_cell(BOARD, "sums", "SELECT COUNT(*) AS c, SUM(n) AS s FROM big")
        .await
        .expect("chained aggregate");
    assert_eq!(agg.result.rows[0][0], QueryValue::Int(100_000));
    assert_eq!(agg.result.rows[0][1], QueryValue::Int(5_000_050_000));
}

#[tokio::test]
async fn streaming_cancel_registers_no_cache_entry() {
    let (_c, driver) = start_mssql_stream().await;
    seed_stream_src(driver.as_ref(), 5_000).await;
    let engine = stream_canvas_engine();

    let stream = driver
        .run_query_stream("SELECT n FROM src", &[], QueryLanguage::Sql)
        .await
        .expect("open stream");

    // A pre-cancelled token exercises the abort path deterministically.
    let token = CancellationToken::new();
    token.cancel();

    let err = engine
        .ingest_cell_stream(BOARD, "huge", stream, Some(&token), CELL_INGEST_BYTE_BUDGET, None)
        .await
        .expect_err("cancel must fail the ingest");
    assert!(matches!(err, CanvasError::Cancelled), "got {err:?}");

    // The aborted cell was never registered, so downstream cannot read it.
    let chained = engine.run_cell(BOARD, "agg", "SELECT COUNT(*) FROM huge").await;
    assert!(chained.is_err(), "cancelled cell must not be queryable");

    // The pinned client is healthy after the aborted stream's connection drops.
    let healthy = run(driver.as_ref(), "SELECT COUNT(*) AS c FROM src").await;
    assert_eq!(healthy.rows[0][0], QueryValue::Int(5_000));
}

#[tokio::test]
async fn streaming_byte_budget_truncates_and_reports_incomplete() {
    let (_c, driver) = start_mssql_stream().await;
    seed_stream_src(driver.as_ref(), 100_000).await;
    let engine = stream_canvas_engine();

    let stream = driver
        .run_query_stream("SELECT n, label FROM src ORDER BY n", &[], QueryLanguage::Sql)
        .await
        .expect("open stream");
    // A ~1 MiB budget admits a few chunks, then stops.
    let out = engine
        .ingest_cell_stream(BOARD, "capped", stream, None, 1 << 20, None)
        .await
        .expect("ingest stream");

    assert!(!out.complete, "budget stop must be surfaced, never silent");
    assert!(out.total_rows >= CELL_RESULT_PAGE_ROWS as u64);
    assert!(out.total_rows < 100_000, "budget must truncate the run");
    assert_eq!(out.result.rows.len(), CELL_RESULT_PAGE_ROWS);

    let agg = engine
        .run_cell(BOARD, "agg", "SELECT COUNT(*) AS c FROM capped")
        .await
        .expect("chained count");
    assert_eq!(agg.result.rows[0][0], QueryValue::Int(out.total_rows as i64));
}

#[tokio::test]
async fn streaming_cell_limit_caps_to_500() {
    let (_c, driver) = start_mssql_stream().await;
    seed_stream_src(driver.as_ref(), 10_000).await;
    let engine = stream_canvas_engine();

    // SQL Server is a wrappable dialect, so the per-cell limit rewrites the query
    // (the DB does top-N via OFFSET/FETCH) and leaves no ingest-side row cap.
    let (sql, row_cap) = QueryEngine::apply_cell_limit(
        "SELECT n FROM src",
        &driver.pagination_strategy(),
        Some(500),
    );
    assert!(sql.contains("FETCH NEXT 500 ROWS ONLY"), "got {sql}");
    assert_eq!(row_cap, None);

    let stream = driver
        .run_query_stream(&sql, &[], QueryLanguage::Sql)
        .await
        .expect("open stream");
    let out = engine
        .ingest_cell_stream(BOARD, "lim", stream, None, 1 << 30, row_cap)
        .await
        .expect("ingest stream");

    assert_eq!(out.total_rows, 500);
    assert!(out.complete, "a top-N result is complete");
    assert_eq!(out.result.rows.len(), 500);
}
