//! Integration tests for the MySQL driver against a real `mysql:8.4` instance
//! started via `testcontainers`. Queries run through the engine's
//! `DatabaseDriver::run_query` / `explain_query` / `list_schemas` (the same
//! paths the app uses), and the returned results are asserted.
//!
//! Requires Docker. Run with:
//!   `cargo test -p arris-engines --test mysql_integration`
//! Each test owns its own container, so they are independent and parallel-safe.
//!
//! MySQL notes baked into the assertions below:
//! - MySQL has no materialized views and no sequences, so those lifecycles are
//!   omitted (only Postgres has them).
//! - The schema browser walks `information_schema` and surfaces databases,
//!   tables, views, routines, events and triggers — but NOT indexes, so the
//!   index test verifies via `information_schema.STATISTICS` + `explain_query`.
//! - `SUM()` over exact types returns `DECIMAL` (→ `Text`), so running totals
//!   are wrapped in `CAST(... AS SIGNED)` to read them as integers.
//! - MySQL has no boolean type: comparisons yield `1`/`0` integers.

use arris_engines::{
    CanvasEngine, CanvasError, CellResultCache, ConnectionConfig, DatabaseDriver, DatabaseKind,
    ExplainMode, IsolationLevel, ObjectRef, QueryLanguage, QueryResult, QueryValue, SchemaNode,
    SchemaNodeKind, driver_for_kind, CELL_RESULT_PAGE_ROWS,
};
use testcontainers_modules::mysql::Mysql;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ImageExt};
use tokio_util::sync::CancellationToken;

// ── harness ─────────────────────────────────────────────────────────────────

/// Boot a fresh `mysql:8.4` container and return a connected driver plus the
/// host/port (needed to open secondary connections as a restricted user). The
/// container guard must be kept alive for the duration of the test. The
/// testcontainers image starts with an empty-password `root` and a `test` db.
async fn start_mysql() -> (ContainerAsync<Mysql>, Box<dyn DatabaseDriver>, String, u16) {
    let container = Mysql::default()
        .with_tag("8.4")
        .start()
        .await
        .expect("start mysql container");
    let host = container.get_host().await.expect("container host").to_string();
    let port = container
        .get_host_port_ipv4(3306)
        .await
        .expect("container port");

    let driver = connect_as(&host, port, "root", "", "test").await;
    (container, driver, host, port)
}

/// Open a driver connection with explicit credentials. An empty `db` connects
/// without a default database (used to probe a revoked user's privileges).
async fn connect_as(host: &str, port: u16, user: &str, pass: &str, db: &str) -> Box<dyn DatabaseDriver> {
    let mut cfg = ConnectionConfig::new("it-mysql", DatabaseKind::Mysql);
    cfg.host = host.to_string();
    cfg.port = port;
    cfg.user = user.to_string();
    cfg.password = pass.to_string();
    cfg.database = db.to_string();

    let driver = driver_for_kind(DatabaseKind::Mysql).expect("mysql driver");
    driver.connect(&cfg).await.expect("connect to mysql");
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

/// Integer columns surface as `Int` (the driver parses the text protocol's
/// ASCII bytes against the column type). A handful of integer-valued results
/// can still arrive as `Text` — e.g. a `BIGINT UNSIGNED` above `i64::MAX` that
/// falls back to text rather than overflowing — so accept both.
fn as_i64(v: &QueryValue) -> i64 {
    match v {
        QueryValue::Int(i) => *i,
        QueryValue::Text(s) => s
            .parse()
            .unwrap_or_else(|_| panic!("expected integer text, got {s:?}")),
        other => panic!("expected Int, got {other:?}"),
    }
}

/// String-valued results arrive as `Text` for char/varchar columns and as
/// `Data` for blob-typed expressions (e.g. `->>`, `GROUP_CONCAT`). Decode both.
fn as_text(v: &QueryValue) -> String {
    match v {
        QueryValue::Text(s) => s.clone(),
        QueryValue::Data(b) => String::from_utf8(b.clone()).expect("utf8 text"),
        other => panic!("expected Text, got {other:?}"),
    }
}

fn as_json(v: &QueryValue) -> &str {
    match v {
        QueryValue::Json(s) => s,
        other => panic!("expected Json, got {other:?}"),
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
    // Lazy split: list_schemas returns containers only; load the test database's objects
    // too so object-level has_node assertions still find them.
    let mut tree = driver.list_schemas().await.expect("list_schemas");
    tree.extend(driver.list_schema("test").await.expect("list_schema"));
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

// ── CRUD ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn crud_insert_update_delete_select() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50) NOT NULL, age INT)",
    )
    .await;

    // Multi-row insert reports the affected count.
    let inserted = exec_affected(
        d,
        "INSERT INTO users (name, age) VALUES ('alice', 30), ('bob', 25), ('carol', 40)",
    )
    .await;
    assert_eq!(inserted, 3);

    // SELECT with filter / ORDER BY / LIMIT — assert column names + types too.
    let top = run(
        d,
        "SELECT name, age FROM users WHERE age >= 25 ORDER BY age DESC LIMIT 2",
    )
    .await;
    assert_eq!(col_names(&top), ["name", "age"]);
    assert_eq!(col_type(&top, "name"), "varchar");
    assert_eq!(col_type(&top, "age"), "int");
    assert_eq!(top.rows.len(), 2);
    assert_eq!(as_text(&top.rows[0][0]), "carol");
    assert_eq!(as_i64(&top.rows[0][1]), 40);
    assert_eq!(as_text(&top.rows[1][0]), "alice");

    // JOIN.
    run(
        d,
        "CREATE TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, amount INT)",
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

    // UPDATE.
    assert_eq!(
        exec_affected(d, "UPDATE users SET age = 31 WHERE name = 'alice'").await,
        1
    );
    assert_eq!(
        as_i64(scalar(&run(d, "SELECT age FROM users WHERE name = 'alice'").await)),
        31
    );

    // DELETE.
    assert_eq!(
        exec_affected(d, "DELETE FROM users WHERE name = 'bob'").await,
        1
    );
    // count(*) comes back as a BIGINT → Int.
    assert_eq!(as_i64(scalar(&run(d, "SELECT count(*) FROM users").await)), 2);
}

// ── Numeric type fidelity ─────────────────────────────────────────

/// Numeric columns must surface as typed `QueryValue` variants — not `Text` —
/// so the row-detail JSON renders unquoted numbers. Integer-family types become
/// `Int`, `FLOAT`/`DOUBLE` become `Double`, and exact `DECIMAL` stays `Text` to
/// preserve precision beyond f64's range.
#[tokio::test]
async fn numeric_columns_surface_typed_not_as_text() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE nums (
            c_tinyint   TINYINT,
            c_smallint  SMALLINT,
            c_mediumint MEDIUMINT,
            c_int       INT,
            c_bigint    BIGINT,
            c_year      YEAR,
            c_float     FLOAT,
            c_double    DOUBLE,
            c_decimal   DECIMAL(10,2)
        )",
    )
    .await;
    run(
        d,
        "INSERT INTO nums VALUES (1, 2, 3, 100, 9999999999, 2025, 1.5, 3.25, 129.00)",
    )
    .await;

    let r = run(d, "SELECT * FROM nums").await;
    assert_eq!(r.rows.len(), 1);
    let row = &r.rows[0];

    // Integer family → Int (unquoted numbers in the row-detail JSON).
    assert_eq!(row[0], QueryValue::Int(1), "tinyint");
    assert_eq!(row[1], QueryValue::Int(2), "smallint");
    assert_eq!(row[2], QueryValue::Int(3), "mediumint");
    assert_eq!(row[3], QueryValue::Int(100), "int");
    assert_eq!(row[4], QueryValue::Int(9999999999), "bigint");
    assert_eq!(row[5], QueryValue::Int(2025), "year");

    // Approximate numerics → Double.
    assert_eq!(row[6], QueryValue::Double(1.5), "float");
    assert_eq!(row[7], QueryValue::Double(3.25), "double");

    // Exact DECIMAL maps to the `Decimal` variant (exact digits, no f64).
    assert_eq!(row[8], QueryValue::Decimal("129.00".into()), "decimal");
}

// ── Window / analytic functions (MySQL 8) ───────────────────────────────────

#[tokio::test]
async fn window_functions() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE sales (region VARCHAR(10), amount INT)").await;
    run(
        d,
        "INSERT INTO sales (region, amount) VALUES \
         ('east', 10), ('east', 20), ('east', 30), ('west', 40), ('west', 50)",
    )
    .await;

    // Running SUM() returns DECIMAL in MySQL; CAST to SIGNED so it reads as Int.
    let r = run(
        d,
        "SELECT region, amount, \
           ROW_NUMBER() OVER (PARTITION BY region ORDER BY amount DESC) AS rn, \
           RANK() OVER (ORDER BY amount DESC) AS rnk, \
           LAG(amount) OVER (ORDER BY amount) AS prev, \
           LEAD(amount) OVER (ORDER BY amount) AS nxt, \
           CAST(SUM(amount) OVER (PARTITION BY region ORDER BY amount \
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS SIGNED) AS running \
         FROM sales ORDER BY amount",
    )
    .await;
    assert_eq!(r.rows.len(), 5);

    // Ordered by amount asc: [10, 20, 30, 40, 50].
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

// ── MySQL-specific: upsert, GROUP_CONCAT, CTE, LIMIT pagination ──────────────

#[tokio::test]
async fn upsert_group_concat_cte_and_pagination() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    // INSERT ... ON DUPLICATE KEY UPDATE accumulates.
    run(d, "CREATE TABLE kv (k VARCHAR(20) PRIMARY KEY, v INT)").await;
    run(d, "INSERT INTO kv (k, v) VALUES ('a', 1)").await;
    run(
        d,
        "INSERT INTO kv (k, v) VALUES ('a', 5) ON DUPLICATE KEY UPDATE v = v + VALUES(v)",
    )
    .await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT v FROM kv WHERE k = 'a'").await)), 6);
    // A fresh key inserts rather than updates.
    run(
        d,
        "INSERT INTO kv (k, v) VALUES ('b', 9) ON DUPLICATE KEY UPDATE v = v + VALUES(v)",
    )
    .await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT v FROM kv WHERE k = 'b'").await)), 9);

    // GROUP_CONCAT.
    run(d, "CREATE TABLE people (id INT, name VARCHAR(20))").await;
    run(d, "INSERT INTO people VALUES (1, 'alice'), (2, 'bob'), (3, 'carol')").await;
    let gc = run(
        d,
        "SELECT GROUP_CONCAT(name ORDER BY id SEPARATOR ',') FROM people",
    )
    .await;
    assert_eq!(as_text(scalar(&gc)), "alice,bob,carol");

    // Recursive CTE: 1..5 (SUM is DECIMAL → CAST to SIGNED).
    let rec = run(
        d,
        "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 5) \
         SELECT CAST(SUM(n) AS SIGNED) FROM seq",
    )
    .await;
    assert_eq!(as_i64(scalar(&rec)), 15);

    // Non-recursive CTE.
    let cte = run(
        d,
        "WITH t AS (SELECT 1 AS n UNION ALL SELECT 2) SELECT CAST(SUM(n) AS SIGNED) FROM t",
    )
    .await;
    assert_eq!(as_i64(scalar(&cte)), 3);

    // LIMIT offset, count pagination.
    run(d, "CREATE TABLE nums (n INT)").await;
    run(d, "INSERT INTO nums VALUES (1), (2), (3), (4), (5)").await;
    let page = run(d, "SELECT n FROM nums ORDER BY n LIMIT 2, 2").await;
    assert_eq!(page.rows.len(), 2);
    assert_eq!(as_i64(&page.rows[0][0]), 3);
    assert_eq!(as_i64(&page.rows[1][0]), 4);
}

// ── MySQL-specific: JSON, generated columns, REGEXP & full-text ─────────────

#[tokio::test]
async fn json_generated_columns_regexp_and_fulltext() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    // JSON functions.
    run(d, "CREATE TABLE docs (id INT, name VARCHAR(20), body JSON)").await;
    run(
        d,
        "INSERT INTO docs (id, name, body) VALUES \
         (1, 'alice', '{\"name\":\"alice\",\"age\":30}'), \
         (2, 'bob', '{\"name\":\"bob\",\"age\":25}')",
    )
    .await;

    // ->> unquotes to text.
    assert_eq!(
        as_text(scalar(&run(d, "SELECT body->>'$.name' FROM docs WHERE id = 1").await)),
        "alice"
    );
    // JSON_EXTRACT keeps the JSON value.
    assert_eq!(
        as_json(scalar(&run(d, "SELECT JSON_EXTRACT(body, '$.age') FROM docs WHERE id = 1").await)),
        "30"
    );
    // JSON_OBJECT round-tripped through JSON_EXTRACT.
    assert_eq!(
        as_json(scalar(
            &run(d, "SELECT JSON_EXTRACT(JSON_OBJECT('x', 5), '$.x')").await
        )),
        "5"
    );

    // Generated columns: STORED and VIRTUAL.
    run(
        d,
        "CREATE TABLE g (a INT, b INT, total INT AS (a + b) STORED, prod INT AS (a * b) VIRTUAL)",
    )
    .await;
    run(d, "INSERT INTO g (a, b) VALUES (3, 4)").await;
    let cols = run(d, "SELECT total, prod FROM g").await;
    assert_eq!(as_i64(&cols.rows[0][0]), 7);
    assert_eq!(as_i64(&cols.rows[0][1]), 12);

    // REGEXP.
    run(d, "CREATE TABLE articles (id INT, body TEXT, FULLTEXT (body)) ENGINE = InnoDB").await;
    run(
        d,
        "INSERT INTO articles (id, body) VALUES (1, 'the quick brown fox'), (2, 'lazy dog sleeps')",
    )
    .await;
    assert_eq!(
        as_i64(scalar(&run(d, "SELECT count(*) FROM articles WHERE body REGEXP 'qu.ck'").await)),
        1
    );

    // Full-text MATCH ... AGAINST.
    let fox = run(d, "SELECT id FROM articles WHERE MATCH(body) AGAINST('fox')").await;
    assert_eq!(fox.rows.len(), 1);
    assert_eq!(as_i64(&fox.rows[0][0]), 1);
}

// ── Views: create / read / replace / drop + schema browser ──────────────────

#[tokio::test]
async fn view_full_lifecycle() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE employees (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50), \
         dept VARCHAR(20), salary INT)",
    )
    .await;
    run(
        d,
        "INSERT INTO employees (name, dept, salary) VALUES \
         ('alice', 'eng', 150), ('bob', 'eng', 90), \
         ('carol', 'sales', 120), ('dave', 'sales', 80)",
    )
    .await;

    // CREATE.
    run(
        d,
        "CREATE VIEW high_earners AS SELECT id, name, salary FROM employees WHERE salary >= 100",
    )
    .await;

    // READ through the view — assert columns, types, and the full row set.
    let v = run(d, "SELECT * FROM high_earners ORDER BY salary DESC").await;
    assert_eq!(col_names(&v), ["id", "name", "salary"]);
    assert_eq!(col_type(&v, "salary"), "int");
    assert_eq!(v.rows.len(), 2);
    assert_eq!(as_text(&v.rows[0][1]), "alice");
    assert_eq!(as_i64(&v.rows[0][2]), 150);
    assert_eq!(as_text(&v.rows[1][1]), "carol");
    assert_eq!(as_i64(&v.rows[1][2]), 120);

    // REPLACE the definition (MySQL CREATE OR REPLACE VIEW); tighten the filter.
    run(
        d,
        "CREATE OR REPLACE VIEW high_earners AS \
         SELECT id, name, salary FROM employees WHERE salary >= 130",
    )
    .await;
    let v2 = run(d, "SELECT * FROM high_earners ORDER BY salary DESC").await;
    assert_eq!(v2.rows.len(), 1);
    assert_eq!(as_text(&v2.rows[0][1]), "alice");

    // The schema browser surfaces the view.
    assert!(has_node(&schema_tree(d).await, "high_earners", SchemaNodeKind::View));

    // DROP — the view leaves the browser and can no longer be queried.
    run(d, "DROP VIEW high_earners").await;
    assert!(!has_node(&schema_tree(d).await, "high_earners", SchemaNodeKind::View));
    assert!(
        driver
            .run_query("SELECT * FROM high_earners", &[], QueryLanguage::Native)
            .await
            .is_err()
    );
}

// ── Functions & procedures: create / call / replace / drop + browser ────────

#[tokio::test]
async fn function_and_procedure_lifecycle() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    // Stored function (DETERMINISTIC so it is accepted with binary logging on).
    run(
        d,
        "CREATE FUNCTION add_two(a INT, b INT) RETURNS INT DETERMINISTIC RETURN a + b",
    )
    .await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT add_two(2, 3)").await)), 5);

    // MySQL has no CREATE OR REPLACE for routines, so "replace" = DROP + CREATE.
    run(d, "DROP FUNCTION add_two").await;
    run(
        d,
        "CREATE FUNCTION add_two(a INT, b INT) RETURNS INT DETERMINISTIC RETURN a + b + 100",
    )
    .await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT add_two(2, 3)").await)), 105);

    // Procedure: CALL mutates, verify the side effect.
    run(d, "CREATE TABLE audit_log (entry VARCHAR(50))").await;
    run(
        d,
        "CREATE PROCEDURE record(IN msg VARCHAR(50)) INSERT INTO audit_log (entry) VALUES (msg)",
    )
    .await;
    run(d, "CALL record('hello')").await;
    assert_eq!(
        as_text(scalar(&run(d, "SELECT entry FROM audit_log").await)),
        "hello"
    );

    // Both appear in the schema browser under the right kinds.
    let tree = schema_tree(d).await;
    assert!(has_node(&tree, "add_two", SchemaNodeKind::Function));
    assert!(has_node(&tree, "record", SchemaNodeKind::Procedure));

    // DROP both; they leave the browser.
    run(d, "DROP PROCEDURE record").await;
    run(d, "DROP FUNCTION add_two").await;
    let tree = schema_tree(d).await;
    assert!(!has_node(&tree, "add_two", SchemaNodeKind::Function));
    assert!(!has_node(&tree, "record", SchemaNodeKind::Procedure));
}

// ── Triggers: create / fire / drop + schema browser ─────────────────────────

#[tokio::test]
async fn trigger_fires_and_appears_in_browser() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE accounts (id INT, balance INT)").await;
    run(d, "CREATE TABLE account_audit (account_id INT, new_balance INT)").await;
    // MySQL allows one timing+event per trigger (no INSERT OR UPDATE combo).
    run(
        d,
        "CREATE TRIGGER trg_audit AFTER INSERT ON accounts \
         FOR EACH ROW INSERT INTO account_audit (account_id, new_balance) \
         VALUES (NEW.id, NEW.balance)",
    )
    .await;

    run(d, "INSERT INTO accounts (id, balance) VALUES (1, 100), (2, 250)").await;
    let audit = run(
        d,
        "SELECT account_id, new_balance FROM account_audit ORDER BY new_balance",
    )
    .await;
    assert_eq!(audit.rows.len(), 2);
    assert_eq!(as_i64(&audit.rows[0][1]), 100);
    assert_eq!(as_i64(&audit.rows[1][1]), 250);

    assert!(has_node(&schema_tree(d).await, "trg_audit", SchemaNodeKind::Trigger));

    run(d, "DROP TRIGGER trg_audit").await;
    assert!(!has_node(&schema_tree(d).await, "trg_audit", SchemaNodeKind::Trigger));
}

// ── Indexes: create / verify via SQL / used by the planner / drop ───────────
//
// MySQL's schema browser does NOT surface indexes, so existence is checked via
// `information_schema.STATISTICS` and usage via the engine's explain path.

#[tokio::test]
async fn index_lifecycle_and_explain_usage() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE items (id INT AUTO_INCREMENT PRIMARY KEY, sku VARCHAR(20), qty INT)",
    )
    .await;
    // Seed 1000 rows via a recursive CTE (MySQL has no generate_series).
    run(
        d,
        "INSERT INTO items (sku, qty) \
         WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1000) \
         SELECT CONCAT('sku', n), n FROM seq",
    )
    .await;
    run(d, "CREATE INDEX idx_items_sku ON items (sku)").await;
    run(d, "ANALYZE TABLE items").await;

    // The index exists per information_schema.
    assert_eq!(
        as_i64(scalar(
            &run(
                d,
                "SELECT count(*) FROM information_schema.STATISTICS \
                 WHERE TABLE_SCHEMA = 'test' AND TABLE_NAME = 'items' \
                 AND INDEX_NAME = 'idx_items_sku'",
            )
            .await
        )),
        1
    );

    // The planner uses it — the EXPLAIN JSON names the index as the chosen key.
    let plan = driver
        .explain_query(
            "SELECT id, qty FROM items WHERE sku = 'sku500'",
            &[],
            QueryLanguage::Native,
            ExplainMode::DryRun,
        )
        .await
        .expect("explain");
    assert!(
        plan.raw.contains("idx_items_sku"),
        "expected the planner to use idx_items_sku, got plan: {}",
        plan.raw
    );

    // DROP removes the index.
    run(d, "DROP INDEX idx_items_sku ON items").await;
    assert_eq!(
        as_i64(scalar(
            &run(
                d,
                "SELECT count(*) FROM information_schema.STATISTICS \
                 WHERE TABLE_SCHEMA = 'test' AND TABLE_NAME = 'items' \
                 AND INDEX_NAME = 'idx_items_sku'",
            )
            .await
        )),
        0
    );
}

// ── Access control: create user, grant, privileges, alter, revoke, drop ─────

#[tokio::test]
async fn user_grant_revoke_lifecycle() {
    let (_c, driver, host, port) = start_mysql().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE t_allowed (id INT)").await;
    run(d, "CREATE TABLE t_denied (id INT)").await;
    run(d, "INSERT INTO t_allowed VALUES (1)").await;
    run(d, "INSERT INTO t_denied VALUES (2)").await;

    run(d, "CREATE USER 'app'@'%' IDENTIFIED BY 'secret'").await;
    run(d, "GRANT SELECT ON test.t_allowed TO 'app'@'%'").await;

    // Privilege grant is visible in information_schema — positive + negative.
    let granted = run(
        d,
        "SELECT count(*) FROM information_schema.TABLE_PRIVILEGES \
         WHERE GRANTEE = \"'app'@'%'\" AND TABLE_SCHEMA = 'test' \
         AND TABLE_NAME = 't_allowed' AND PRIVILEGE_TYPE = 'SELECT'",
    )
    .await;
    assert_eq!(as_i64(scalar(&granted)), 1);
    let on_denied = run(
        d,
        "SELECT count(*) FROM information_schema.TABLE_PRIVILEGES \
         WHERE GRANTEE = \"'app'@'%'\" AND TABLE_NAME = 't_denied'",
    )
    .await;
    assert_eq!(as_i64(scalar(&on_denied)), 0);

    // Connect AS the restricted user (no default db) and prove the boundary.
    {
        let app = connect_as(&host, port, "app", "secret", "").await;
        let ok = run(app.as_ref(), "SELECT id FROM test.t_allowed").await;
        assert_eq!(as_i64(scalar(&ok)), 1);
        // Negative: the un-granted table is denied.
        assert!(
            app.run_query("SELECT id FROM test.t_denied", &[], QueryLanguage::Native)
                .await
                .is_err()
        );
    }

    // ALTER USER rotates the password (just needs to succeed).
    run(d, "ALTER USER 'app'@'%' IDENTIFIED BY 'newsecret'").await;

    // REVOKE drops the privilege — gone from information_schema.
    run(d, "REVOKE SELECT ON test.t_allowed FROM 'app'@'%'").await;
    let after = run(
        d,
        "SELECT count(*) FROM information_schema.TABLE_PRIVILEGES \
         WHERE GRANTEE = \"'app'@'%'\" AND TABLE_NAME = 't_allowed'",
    )
    .await;
    assert_eq!(as_i64(scalar(&after)), 0);

    // Negative: a fresh connection can no longer read the formerly-allowed table
    // (connect itself may fail now that the user has no privileges on `test`).
    {
        let app = driver_for_kind(DatabaseKind::Mysql).expect("mysql driver");
        let mut cfg = ConnectionConfig::new("it-mysql", DatabaseKind::Mysql);
        cfg.host = host.clone();
        cfg.port = port;
        cfg.user = "app".into();
        cfg.password = "newsecret".into();
        let blocked = match app.connect(&cfg).await {
            Err(_) => true,
            Ok(()) => app
                .run_query("SELECT id FROM test.t_allowed", &[], QueryLanguage::Native)
                .await
                .is_err(),
        };
        assert!(blocked, "revoked user should not be able to read t_allowed");
    }

    // DROP USER — gone from mysql.user.
    run(d, "DROP USER 'app'@'%'").await;
    assert_eq!(
        as_i64(scalar(
            &run(d, "SELECT count(*) FROM mysql.user WHERE user = 'app'").await
        )),
        0
    );
}

// ── manual transactions ────────────────────────────────────────────

#[tokio::test]
async fn manual_commit_makes_rows_visible_to_other_sessions() {
    let (_container, tx, host, port) = start_mysql().await;
    // A second, independent session (autocommit) for visibility checks.
    let other = connect_as(&host, port, "root", "", "test").await;
    // DDL implicitly commits in MySQL, so create the table before opening the tx.
    run(tx.as_ref(), "CREATE TABLE acct (id INT PRIMARY KEY, bal INT)").await;

    assert!(tx.supports_transactions());
    assert!(!tx.in_transaction().await);
    tx.begin_transaction(IsolationLevel::Default).await.expect("begin");
    assert!(tx.in_transaction().await);
    run(tx.as_ref(), "INSERT INTO acct VALUES (1, 100)").await;

    // The other session's autocommit read must not see the uncommitted row.
    let before = run(other.as_ref(), "SELECT count(*) FROM acct").await;
    assert_eq!(as_i64(scalar(&before)), 0, "uncommitted row leaked to another session");

    tx.commit_transaction().await.expect("commit");
    assert!(!tx.in_transaction().await);

    let after = run(other.as_ref(), "SELECT count(*) FROM acct").await;
    assert_eq!(as_i64(scalar(&after)), 1);
    let bal = run(other.as_ref(), "SELECT bal FROM acct WHERE id = 1").await;
    assert_eq!(as_i64(scalar(&bal)), 100);
}

#[tokio::test]
async fn manual_rollback_discards_changes() {
    let (_container, tx, _host, _port) = start_mysql().await;
    run(tx.as_ref(), "CREATE TABLE note (id INT)").await;

    tx.begin_transaction(IsolationLevel::Default).await.expect("begin");
    run(tx.as_ref(), "INSERT INTO note VALUES (1), (2)").await;
    // Visible within the same transaction (read through the pinned connection).
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM note").await)), 2);

    tx.rollback_transaction().await.expect("rollback");
    assert!(!tx.in_transaction().await);

    // After rollback the rows are gone (read on a fresh pooled connection).
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM note").await)), 0);
}

#[tokio::test]
async fn begin_accepts_every_isolation_level() {
    // MySQL's `SET TRANSACTION ISOLATION LEVEL` is scoped to the next
    // transaction only and does not surface on a session variable, so (unlike
    // Postgres' `SHOW transaction_isolation`) we verify the begin/commit
    // round-trip is accepted for every level rather than reading it back.
    let (_container, tx, _host, _port) = start_mysql().await;
    for level in [
        IsolationLevel::Default,
        IsolationLevel::ReadCommitted,
        IsolationLevel::RepeatableRead,
        IsolationLevel::Serializable,
    ] {
        tx.begin_transaction(level).await.expect("begin at isolation level");
        assert!(tx.in_transaction().await);
        run(tx.as_ref(), "SELECT 1").await;
        tx.commit_transaction().await.expect("commit");
        assert!(!tx.in_transaction().await);
    }
}

// ── object_definition: SHOW CREATE DDL retrieval ───────────────────
//
// `DatabaseDriver::object_definition` resolves an object's DDL via the matching
// `SHOW CREATE {TYPE}` statement. For MySQL the schema browser flattens
// schema→database, so the database is passed as `schema: Some("<dbname>")`. The
// harness connects to the `test` database, so every ref below targets it.

/// Build an `ObjectRef` for the harness `test` database (schema-as-database).
fn object_ref(kind: SchemaNodeKind, name: &str) -> ObjectRef {
    ObjectRef {
        kind,
        database: None,
        schema: Some("test".into()),
        name: name.into(),
    }
}

/// Fetch the DDL for an object through the engine layer, panicking on error.
async fn definition(driver: &dyn DatabaseDriver, kind: SchemaNodeKind, name: &str) -> String {
    driver
        .object_definition(&object_ref(kind, name))
        .await
        .unwrap_or_else(|e| panic!("object_definition({kind:?}, {name}) failed: {e:?}"))
}

#[tokio::test]
async fn object_definition_table_roundtrips() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    // Parent referenced by the child's FK.
    run(d, "CREATE TABLE categories (id INT AUTO_INCREMENT PRIMARY KEY, label VARCHAR(40))").await;
    // A table exercising PK, AUTO_INCREMENT, a UNIQUE key, a secondary index and a FK.
    run(
        d,
        "CREATE TABLE products (\
           id INT AUTO_INCREMENT PRIMARY KEY, \
           sku VARCHAR(32) NOT NULL, \
           category_id INT, \
           qty INT, \
           UNIQUE KEY uq_products_sku (sku), \
           KEY idx_products_qty (qty), \
           CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories (id)\
         ) ENGINE = InnoDB",
    )
    .await;

    let ddl = definition(d, SchemaNodeKind::Table, "products").await;
    assert!(ddl.contains("CREATE TABLE"), "missing CREATE TABLE: {ddl}");
    assert!(ddl.contains("`products`"), "missing backtick-quoted name: {ddl}");
    assert!(ddl.contains("PRIMARY KEY"), "missing PRIMARY KEY: {ddl}");
    assert!(ddl.contains("AUTO_INCREMENT"), "missing AUTO_INCREMENT: {ddl}");
    assert!(ddl.contains("UNIQUE KEY"), "missing UNIQUE KEY: {ddl}");
    assert!(ddl.contains("KEY"), "missing KEY: {ddl}");
    assert!(ddl.contains("FOREIGN KEY"), "missing FOREIGN KEY: {ddl}");

    // STRONG assertion: drop the table (FK child first) and re-run the returned
    // DDL — it must recreate the table exactly. categories still exists for the FK.
    run(d, "DROP TABLE products").await;
    assert!(
        d.run_query("SELECT * FROM products", &[], QueryLanguage::Native)
            .await
            .is_err(),
        "products should be gone after DROP"
    );
    run(d, &ddl).await;
    // The recreated table is queryable and the FK target still resolves.
    run(d, "INSERT INTO categories (label) VALUES ('toys')").await;
    run(
        d,
        "INSERT INTO products (sku, category_id, qty) \
         VALUES ('abc', (SELECT id FROM categories LIMIT 1), 5)",
    )
    .await;
    assert_eq!(
        as_i64(scalar(&run(d, "SELECT count(*) FROM products").await)),
        1
    );
}

#[tokio::test]
async fn object_definition_view() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE t (id INT, v INT)").await;
    run(d, "CREATE VIEW v_positive AS SELECT id, v FROM t WHERE v > 0").await;

    let ddl = definition(d, SchemaNodeKind::View, "v_positive").await;
    assert!(ddl.contains("VIEW"), "missing VIEW keyword: {ddl}");
    assert!(ddl.contains("`v_positive`"), "missing view name: {ddl}");
}

#[tokio::test]
async fn object_definition_function() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    // DETERMINISTIC sidesteps the binlog `log_bin_trust_function_creators` check.
    run(
        d,
        "CREATE FUNCTION triple(a INT) RETURNS INT DETERMINISTIC RETURN a * 3",
    )
    .await;

    let ddl = definition(d, SchemaNodeKind::Function, "triple").await;
    assert!(ddl.contains("CREATE"), "missing CREATE: {ddl}");
    assert!(ddl.contains("FUNCTION"), "missing FUNCTION keyword: {ddl}");
    assert!(ddl.contains("`triple`"), "missing function name: {ddl}");
}

#[tokio::test]
async fn object_definition_procedure() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE sink (msg VARCHAR(40))").await;
    run(
        d,
        "CREATE PROCEDURE log_msg(IN m VARCHAR(40)) INSERT INTO sink (msg) VALUES (m)",
    )
    .await;

    let ddl = definition(d, SchemaNodeKind::Procedure, "log_msg").await;
    assert!(ddl.contains("PROCEDURE"), "missing PROCEDURE keyword: {ddl}");
    assert!(ddl.contains("`log_msg`"), "missing procedure name: {ddl}");
}

#[tokio::test]
async fn object_definition_trigger() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE src (id INT)").await;
    run(d, "CREATE TABLE mirror (id INT)").await;
    run(
        d,
        "CREATE TRIGGER trg_copy AFTER INSERT ON src \
         FOR EACH ROW INSERT INTO mirror (id) VALUES (NEW.id)",
    )
    .await;

    let ddl = definition(d, SchemaNodeKind::Trigger, "trg_copy").await;
    assert!(ddl.contains("TRIGGER"), "missing TRIGGER keyword: {ddl}");
    assert!(ddl.contains("trg_copy"), "missing trigger name: {ddl}");
}

#[tokio::test]
async fn object_definition_event() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    // Creating an event does not require the scheduler to be running; only its
    // execution does. The event is parked far in the future so it never fires.
    run(d, "CREATE TABLE heartbeat (ts DATETIME)").await;
    run(
        d,
        "CREATE EVENT ev_heartbeat \
         ON SCHEDULE AT '2099-01-01 00:00:00' \
         DO INSERT INTO heartbeat (ts) VALUES (NOW())",
    )
    .await;

    let ddl = definition(d, SchemaNodeKind::Event, "ev_heartbeat").await;
    assert!(ddl.contains("EVENT"), "missing EVENT keyword: {ddl}");
    assert!(ddl.contains("`ev_heartbeat`"), "missing event name: {ddl}");
}

#[tokio::test]
async fn object_definition_missing_object_errors() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    // A non-existent table has no `SHOW CREATE` result → Err.
    assert!(
        d.object_definition(&object_ref(SchemaNodeKind::Table, "no_such_table"))
            .await
            .is_err(),
        "expected Err for a non-existent table"
    );
}

#[tokio::test]
async fn object_definition_database_roundtrips() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    // A database node IS the schema in MySQL; `SHOW CREATE DATABASE` returns its
    // full `CREATE DATABASE ... DEFAULT CHARACTER SET ...` source.
    run(d, "CREATE DATABASE shop CHARACTER SET utf8mb4").await;

    let ddl = definition(d, SchemaNodeKind::Database, "shop").await;
    assert!(ddl.contains("CREATE DATABASE"), "missing CREATE DATABASE: {ddl}");
    assert!(ddl.contains("`shop`"), "missing backtick-quoted name: {ddl}");
    assert!(ddl.contains("CHARACTER SET"), "missing CHARACTER SET: {ddl}");

    // STRONG assertion: drop and replay the returned DDL — it recreates the
    // database (`CREATE DATABASE ... /*!...*/` is one statement).
    run(d, "DROP DATABASE shop").await;
    run(d, &ddl).await;
    assert!(
        d.run_query("SHOW CREATE DATABASE shop", &[], QueryLanguage::Native)
            .await
            .is_ok(),
        "shop should exist again after replaying its DDL"
    );

    run(d, "DROP DATABASE shop").await;
}

#[tokio::test]
async fn object_definition_unsupported_kind_errors() {
    let (_c, driver, ..) = start_mysql().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE idx_tbl (id INT, sku VARCHAR(20))").await;
    run(d, "CREATE INDEX idx_sku ON idx_tbl (sku)").await;

    // MySQL has no `SHOW CREATE INDEX`, so the Index kind is unsupported → Err,
    // even though the index genuinely exists on the table.
    assert!(
        d.object_definition(&object_ref(SchemaNodeKind::Index, "idx_sku"))
            .await
            .is_err(),
        "Index has no SHOW CREATE form and must return Err"
    );

    // MySQL has no materialized views at all → also unsupported.
    assert!(
        d.object_definition(&object_ref(SchemaNodeKind::MaterializedView, "whatever"))
            .await
            .is_err(),
        "MaterializedView is unsupported on MySQL and must return Err"
    );
}

mod dbt_diff_scenario;

/// dbt slim-diff (`MySql` dialect: NULL-safe anti-join in place of `EXCEPT`,
/// backtick quoting, `LIMIT`) end-to-end against a real MySQL instance. MariaDB
/// shares this dialect. See `dbt_diff_scenario` for the data set and expectations.
#[tokio::test]
async fn slim_diff_keyless_and_keyed() {
    use arris_engines::dbt::DiffDialect;

    let (_c, driver, ..) = start_mysql().await;
    run(driver.as_ref(), "CREATE TABLE diff_prod (id INT, amount INT)").await;
    run(
        driver.as_ref(),
        "INSERT INTO diff_prod (id, amount) VALUES (1, 100), (2, 200), (3, 300)",
    )
    .await;

    let prod = "`diff_prod`";
    let new_select =
        "SELECT 2 AS id, 200 AS amount UNION ALL SELECT 3, 333 UNION ALL SELECT 4, 400";

    dbt_diff_scenario::assert_keyless(driver.as_ref(), DiffDialect::MySql, prod, new_select).await;
    dbt_diff_scenario::assert_keyed(driver.as_ref(), DiffDialect::MySql, prod, new_select).await;
}

// ── streaming ingestion (canvas path) ───────────────────────────────────────

static STREAM_DIR_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// A canvas engine over a throwaway cell cache (1 GiB memory / 10 GiB total).
fn canvas_engine() -> CanvasEngine {
    let n = STREAM_DIR_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("arris-mysql-stream-{}-{}", std::process::id(), n));
    let cache = CellResultCache::new(dir, 1 << 30, 10 * (1 << 30));
    CanvasEngine::new(std::sync::Arc::new(cache))
}

const BOARD: &str = "board-stream";

/// Seed `src(n INT PK, label VARCHAR)` with rows 1..=count. MySQL has no lazy
/// `generate_series`, so the rows come from a digit-table cross join (no
/// recursion, no per-session `cte_max_recursion_depth`). `count` must be a
/// power of ten.
async fn seed_numbers(driver: &dyn DatabaseDriver, count: u64) {
    run(driver, "CREATE TABLE _digits (d INT)").await;
    run(driver, "INSERT INTO _digits VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)").await;
    run(driver, "CREATE TABLE src (n INT PRIMARY KEY, label VARCHAR(32))").await;

    let factors = count.to_string().len() - 1;
    let seq_expr = (0..factors)
        .map(|i| format!("t{i}.d * {}", 10u64.pow(i as u32)))
        .collect::<Vec<_>>()
        .join(" + ");
    let from = (0..factors)
        .map(|i| format!("_digits t{i}"))
        .collect::<Vec<_>>()
        .join(" CROSS JOIN ");
    run(
        driver,
        &format!(
            "INSERT INTO src (n, label) \
             SELECT seq + 1, CONCAT('row-', seq + 1) FROM (SELECT {seq_expr} AS seq FROM {from}) g"
        ),
    )
    .await;
}

#[tokio::test]
async fn streaming_ingests_100k_rows_with_exact_totals_and_page() {
    let (_container, driver, _host, _port) = start_mysql().await;
    seed_numbers(driver.as_ref(), 100_000).await;
    let engine = canvas_engine();

    let stream = driver
        .run_query_stream("SELECT n, label FROM src ORDER BY n", &[], QueryLanguage::Native)
        .await
        .expect("open stream");
    let out = engine
        .ingest_cell_stream(BOARD, "big", stream, None)
        .await
        .expect("ingest stream");

    assert_eq!(out.total_rows, 100_000);
    assert!(out.complete);
    assert_eq!(out.result.rows.len(), CELL_RESULT_PAGE_ROWS);
    let names: Vec<&str> = out.result.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["n", "label"]);
    assert_eq!(out.result.columns[0].type_hint, "int");
    assert_eq!(out.result.columns[1].type_hint, "varchar");
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
async fn streaming_cancel_mid_stream_registers_no_cache_entry() {
    let (_container, driver, _host, _port) = start_mysql().await;
    seed_numbers(driver.as_ref(), 1_000_000).await;
    let engine = canvas_engine();

    // 1M rows keep the stream running while the cancel fires.
    let stream = driver
        .run_query_stream("SELECT n FROM src", &[], QueryLanguage::Native)
        .await
        .expect("open stream");

    let token = CancellationToken::new();
    let canceller = token.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        canceller.cancel();
    });

    let err = engine
        .ingest_cell_stream(BOARD, "huge", stream, Some(&token))
        .await
        .expect_err("cancel must fail the ingest");
    assert!(matches!(err, CanvasError::Cancelled), "got {err:?}");
    // Mirror the app's cancel path: the driver-level kill also fires.
    driver.cancel_running_query().await.expect("mysql cancel request");

    // The aborted cell was never registered, so downstream cannot read it.
    let chained = engine.run_cell(BOARD, "agg", "SELECT COUNT(*) FROM huge").await;
    assert!(chained.is_err(), "cancelled cell must not be queryable");
}

#[tokio::test]
async fn streaming_byte_budget_truncates_and_reports_incomplete() {
    let (_container, driver, _host, _port) = start_mysql().await;
    seed_numbers(driver.as_ref(), 1_000_000).await;
    let engine = canvas_engine();

    let stream = driver
        .run_query_stream("SELECT n FROM src ORDER BY n", &[], QueryLanguage::Native)
        .await
        .expect("open stream");
    // A ~1 MiB budget admits a handful of 8k-row chunks, then stops.
    let out = engine
        .ingest_cell_stream_with_budget(BOARD, "capped", stream, None, 1 << 20)
        .await
        .expect("ingest stream");

    assert!(!out.complete, "budget stop must be surfaced, never silent");
    assert!(out.total_rows >= CELL_RESULT_PAGE_ROWS as u64);
    assert!(out.total_rows < 1_000_000, "budget must truncate the run");
    assert_eq!(out.result.rows.len(), CELL_RESULT_PAGE_ROWS);

    // The cached prefix stays queryable and matches the reported total.
    let agg = engine
        .run_cell(BOARD, "agg", "SELECT COUNT(*) AS c FROM capped")
        .await
        .expect("chained count");
    assert_eq!(agg.result.rows[0][0], QueryValue::Int(out.total_rows as i64));
}
