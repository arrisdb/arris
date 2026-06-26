//! Integration tests for the Oracle driver against a real
//! `gvenzl/oracle-free:23-slim` instance started via `testcontainers`. Queries
//! run through the engine's `DatabaseDriver::run_query` / `explain_query` /
//! `list_schemas` (the same path the app uses), and the returned `QueryResult` /
//! `PlanResult` / `SchemaNode` tree is asserted.
//!
//! Requires Docker. Run with:
//!   `cargo test -p arris-engines --test oracle_integration`
//! Each test owns its own container, so they are independent and parallel-safe.
//! Oracle Free is heavyweight (~2 GB / container, ~40-90 s first boot), so the
//! schema-object lifecycles (view / matview / function / procedure / trigger /
//! index / sequence) are exercised together in one `schema_object_lifecycle`
//! container rather than one container per object kind — each kind is still
//! created, used, altered, dropped, and verified through both SQL and the schema
//! browser. The remaining behavior groups (CRUD, window, Oracle dialect, access
//! control) each get their own container.
//!
//! Oracle specifics that shape the assertions:
//! * `NUMBER` values arrive as `QueryValue::Text` (Oracle NUMBER is arbitrary
//!   precision; the driver maps `oracle_rs::Value::Number` to `Text`). `as_i64` /
//!   `as_f64` therefore parse the textual form. `INTEGER`-typed binds still arrive
//!   as `QueryValue::Int`, so both are accepted.
//! * Unquoted identifiers fold to upper case, so every browser/`col_names`
//!   assertion uses upper-case names.
//! * Oracle has no multi-row `VALUES`; the multi-row insert requirement is met
//!   with `INSERT ALL`.
//! * `INSERT ... RETURNING` needs an OUT bind the engine doesn't expose, so the
//!   insert-returning requirement does not apply through the engine layer — the
//!   inserted row is verified with a follow-up `SELECT` instead (see `crud`).
//! * The app user (`appuser`) ships with only CONNECT/RESOURCE, so the harness
//!   grants it `DBA` once as `SYSTEM` to enable view/matview DDL and the access
//!   -control statements (`CREATE USER`/`GRANT`/`CREATE ROLE`/`DROP USER`). All
//!   objects are still created in the un-excluded `APPUSER` schema so the browser
//!   surfaces them.

use std::time::Duration;

use arris_engines::{
    ConnectionConfig, DatabaseDriver, DatabaseKind, ExplainMode, ObjectRef, QueryLanguage,
    QueryResult, QueryValue, SchemaNode, SchemaNodeKind, driver_for_kind,
};
use testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers::runners::AsyncRunner;
use testcontainers::{ContainerAsync, GenericImage, ImageExt};

// ── harness ─────────────────────────────────────────────────────────────────

/// Image + tag pinned to `docker-compose.yml`'s `oracle` service.
const ORACLE_IMAGE: &str = "gvenzl/oracle-free";
const ORACLE_TAG: &str = "23-slim";
/// Pluggable database the app user lives in (gvenzl default).
const SERVICE: &str = "FREEPDB1";

/// Boot a fresh Oracle Free container, grant the app user the privileges the
/// suite needs, and return an engine driver connected as that app user. The
/// container guard must be kept alive for the duration of the test; the host /
/// port are returned so access-control tests can connect additional users.
async fn start_oracle() -> (ContainerAsync<GenericImage>, Box<dyn DatabaseDriver>, String, u16) {
    let container = GenericImage::new(ORACLE_IMAGE, ORACLE_TAG)
        .with_exposed_port(1521.tcp())
        .with_wait_for(WaitFor::message_on_stdout("DATABASE IS READY TO USE!"))
        .with_startup_timeout(Duration::from_secs(360))
        .with_env_var("ORACLE_PASSWORD", "test")
        .with_env_var("APP_USER", "appuser")
        .with_env_var("APP_USER_PASSWORD", "test")
        .start()
        .await
        .expect("start oracle container");
    let host = container.get_host().await.expect("container host").to_string();
    let port = container
        .get_host_port_ipv4(1521)
        .await
        .expect("container port");

    // Bootstrap: as SYSTEM, give the app user the privileges its DDL needs.
    let admin = connect_as(&host, port, "system", "test").await;
    run(admin.as_ref(), "GRANT DBA TO appuser").await;
    admin.close().await;

    let driver = connect_as(&host, port, "appuser", "test").await;
    (container, driver, host, port)
}

/// Connect an engine driver as `user`/`password` against the `FREEPDB1` service.
async fn connect_as(host: &str, port: u16, user: &str, password: &str) -> Box<dyn DatabaseDriver> {
    let mut cfg = ConnectionConfig::new("it-oracle", DatabaseKind::Oracle);
    cfg.host = host.to_string();
    cfg.port = port;
    cfg.user = user.to_string();
    cfg.password = password.to_string();
    cfg.database = SERVICE.to_string();

    let driver = driver_for_kind(DatabaseKind::Oracle).expect("oracle driver");
    // The listener can accept connections a moment before the service is fully
    // open, so retry transient connect failures.
    for attempt in 0..30 {
        match driver.connect(&cfg).await {
            Ok(()) => return driver,
            Err(_) if attempt < 29 => tokio::time::sleep(Duration::from_millis(500)).await,
            Err(e) => panic!("connect to oracle as {user} failed: {e:?}"),
        }
    }
    unreachable!()
}

async fn run(driver: &dyn DatabaseDriver, sql: &str) -> QueryResult {
    driver
        .run_query(sql, &[], QueryLanguage::Native)
        .await
        .unwrap_or_else(|e| panic!("query failed: {sql}\n  error: {e:?}"))
}

/// First column of the first row.
fn scalar(result: &QueryResult) -> &QueryValue {
    result
        .rows
        .first()
        .and_then(|row| row.first())
        .unwrap_or_else(|| panic!("expected at least one row/column, got {result:?}"))
}

/// Oracle `NUMBER` surfaces as `Text`; `INTEGER` binds as `Int`. Accept both.
fn as_i64(v: &QueryValue) -> i64 {
    match v {
        QueryValue::Int(i) => *i,
        QueryValue::Double(d) => *d as i64,
        QueryValue::Text(s) => s
            .trim()
            .parse::<f64>()
            .map(|f| f as i64)
            .unwrap_or_else(|_| panic!("expected numeric text, got {s:?}")),
        other => panic!("expected number, got {other:?}"),
    }
}

fn as_f64(v: &QueryValue) -> f64 {
    match v {
        QueryValue::Double(d) => *d,
        QueryValue::Int(i) => *i as f64,
        QueryValue::Text(s) => s
            .trim()
            .parse::<f64>()
            .unwrap_or_else(|_| panic!("expected numeric text, got {s:?}")),
        other => panic!("expected number, got {other:?}"),
    }
}

fn as_text(v: &QueryValue) -> &str {
    match v {
        QueryValue::Text(s) => s,
        other => panic!("expected Text, got {other:?}"),
    }
}

/// `SELECT count(*)`-style scalar through the engine.
async fn count(driver: &dyn DatabaseDriver, sql: &str) -> i64 {
    as_i64(scalar(&run(driver, sql).await))
}

/// Whether the schema-browser tree contains a node with the given name + kind
/// anywhere in its hierarchy.
fn has_node(nodes: &[SchemaNode], name: &str, kind: SchemaNodeKind) -> bool {
    nodes
        .iter()
        .any(|n| (n.name == name && n.kind == kind) || has_node(&n.children, name, kind))
}

async fn schema_tree(driver: &dyn DatabaseDriver) -> Vec<SchemaNode> {
    // Lazy split: list_schemas returns containers only; load APPUSER's objects
    // too so object-level has_node assertions still find them.
    let mut tree = driver.list_schemas().await.expect("list_schemas");
    tree.extend(driver.list_schema("APPUSER").await.expect("list_schema"));
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
async fn crud_insert_update_delete_select_join_dual() {
    let (_c, driver, _h, _p) = start_oracle().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE users (id NUMBER PRIMARY KEY, name VARCHAR2(50) NOT NULL, age NUMBER)",
    )
    .await;

    // Multi-row insert (Oracle has no multi-row VALUES → INSERT ALL).
    run(
        d,
        "INSERT ALL \
           INTO users VALUES (1, 'alice', 30) \
           INTO users VALUES (2, 'bob', 25) \
           INTO users VALUES (3, 'carol', 40) \
         SELECT 1 FROM dual",
    )
    .await;
    assert_eq!(count(d, "SELECT COUNT(*) FROM users").await, 3);

    // No engine-surfaced INSERT ... RETURNING for Oracle (it needs an OUT bind);
    // verify a single insert took effect with a follow-up SELECT instead.
    run(d, "INSERT INTO users VALUES (4, 'dave', 22)").await;
    // Assert column names and types on real columns: VARCHAR2 → "Varchar",
    // NUMBER → "Number".
    let dave = run(d, "SELECT name, age FROM users WHERE name = 'dave'").await;
    assert_eq!(col_names(&dave), ["NAME", "AGE"]);
    assert_eq!(col_type(&dave, "NAME"), "Varchar");
    assert_eq!(col_type(&dave, "AGE"), "Number");
    assert_eq!(as_text(&dave.rows[0][0]), "dave");
    assert_eq!(as_i64(&dave.rows[0][1]), 22);

    // SELECT ... FROM dual (the canonical single-row source). A bare string
    // literal types as CHAR; the arithmetic expression types as NUMBER.
    let greeting = run(d, "SELECT 'hi' AS msg, 6 * 7 AS answer FROM dual").await;
    assert_eq!(col_names(&greeting), ["MSG", "ANSWER"]);
    assert_eq!(col_type(&greeting, "MSG"), "Char");
    assert_eq!(col_type(&greeting, "ANSWER"), "Number");
    assert_eq!(as_text(&greeting.rows[0][0]), "hi");
    assert_eq!(as_f64(&greeting.rows[0][1]), 42.0);

    // Filtered SELECT with ORDER BY + row-limiting.
    let top = run(
        d,
        "SELECT name, age FROM users WHERE age >= 25 ORDER BY age DESC FETCH FIRST 2 ROWS ONLY",
    )
    .await;
    assert_eq!(top.rows.len(), 2);
    assert_eq!(as_text(&top.rows[0][0]), "carol");
    assert_eq!(as_i64(&top.rows[0][1]), 40);
    assert_eq!(as_text(&top.rows[1][0]), "alice");

    // JOIN.
    run(
        d,
        "CREATE TABLE orders (id NUMBER, user_id NUMBER, amount NUMBER)",
    )
    .await;
    run(
        d,
        "INSERT INTO orders (id, user_id, amount) \
         SELECT 1, id, 100 FROM users WHERE name = 'alice'",
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
    run(d, "UPDATE users SET age = 31 WHERE name = 'alice'").await;
    assert_eq!(
        as_i64(scalar(&run(d, "SELECT age FROM users WHERE name = 'alice'").await)),
        31
    );

    // DELETE.
    run(d, "DELETE FROM users WHERE name = 'bob'").await;
    assert_eq!(count(d, "SELECT COUNT(*) FROM users").await, 3); // alice, carol, dave
    assert_eq!(count(d, "SELECT COUNT(*) FROM users WHERE name = 'bob'").await, 0);
}

// ── Window / analytic functions ─────────────────────────────────────────────

#[tokio::test]
async fn window_functions() {
    let (_c, driver, _h, _p) = start_oracle().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE sales (region VARCHAR2(10), amount NUMBER)").await;
    run(
        d,
        "INSERT ALL \
           INTO sales (region, amount) VALUES ('east', 10) \
           INTO sales (region, amount) VALUES ('east', 20) \
           INTO sales (region, amount) VALUES ('east', 30) \
           INTO sales (region, amount) VALUES ('west', 40) \
           INTO sales (region, amount) VALUES ('west', 50) \
         SELECT 1 FROM dual",
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
    assert_eq!(r.rows.len(), 5);
    assert_eq!(
        col_names(&r),
        ["REGION", "AMOUNT", "RN", "RNK", "PREV", "NXT", "RUNNING"]
    );

    // Ordered by amount asc: [10, 20, 30, 40, 50].
    // First row (amount=10, east): LAG NULL, running within east = 10.
    let first = &r.rows[0];
    assert_eq!(as_i64(&first[1]), 10);
    assert_eq!(as_i64(&first[2]), 3); // row_number within east desc
    assert_eq!(as_i64(&first[3]), 5); // global rank desc
    assert!(first[4].is_null()); // LAG of first row
    assert_eq!(as_i64(&first[5]), 20); // LEAD
    assert_eq!(as_i64(&first[6]), 10); // running sum

    // Third row (amount=30, east): top of its partition, running = 60.
    let third = &r.rows[2];
    assert_eq!(as_i64(&third[1]), 30);
    assert_eq!(as_i64(&third[2]), 1); // row_number within east desc
    assert_eq!(as_i64(&third[3]), 3); // global rank desc
    assert_eq!(as_i64(&third[4]), 20); // LAG
    assert_eq!(as_i64(&third[5]), 40); // LEAD
    assert_eq!(as_i64(&third[6]), 60); // running sum 10+20+30
}

// ── Oracle-specific dialect ─────────────────────────────────────────────────

#[tokio::test]
async fn oracle_specific_syntax() {
    let (_c, driver, _h, _p) = start_oracle().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE emp (id NUMBER PRIMARY KEY, name VARCHAR2(20), mgr NUMBER, sal NUMBER)",
    )
    .await;
    run(
        d,
        "INSERT ALL \
           INTO emp VALUES (1, 'king',  NULL, 100) \
           INTO emp VALUES (2, 'jones', 1,    75) \
           INTO emp VALUES (3, 'scott', 2,    60) \
           INTO emp VALUES (4, 'adams', 3,    50) \
         SELECT 1 FROM dual",
    )
    .await;

    // ROWNUM caps the result before ORDER BY is applied, so wrap an ordered
    // inline view to take the two highest-paid rows deterministically.
    let rownum = run(
        d,
        "SELECT name FROM (SELECT name FROM emp ORDER BY sal DESC) WHERE ROWNUM <= 2",
    )
    .await;
    assert_eq!(rownum.rows.len(), 2);
    assert_eq!(as_text(&rownum.rows[0][0]), "king");
    assert_eq!(as_text(&rownum.rows[1][0]), "jones");

    // FETCH FIRST n ROWS ONLY.
    let fetch = run(
        d,
        "SELECT name FROM emp ORDER BY sal ASC FETCH FIRST 1 ROWS ONLY",
    )
    .await;
    assert_eq!(fetch.rows.len(), 1);
    assert_eq!(as_text(&fetch.rows[0][0]), "adams");

    // Hierarchical CONNECT BY ... START WITH: depth of each node from the root.
    let tree = run(
        d,
        "SELECT name, LEVEL AS lvl FROM emp \
         START WITH mgr IS NULL \
         CONNECT BY PRIOR id = mgr \
         ORDER BY LEVEL",
    )
    .await;
    assert_eq!(tree.rows.len(), 4);
    assert_eq!(as_text(&tree.rows[0][0]), "king");
    assert_eq!(as_i64(&tree.rows[0][1]), 1);
    assert_eq!(as_i64(&tree.rows[3][1]), 4); // adams at depth 4

    // MERGE upsert: matched row updated, unmatched row inserted.
    run(d, "CREATE TABLE target (id NUMBER PRIMARY KEY, v NUMBER)").await;
    run(d, "INSERT INTO target VALUES (1, 10)").await;
    run(
        d,
        "MERGE INTO target t \
         USING (SELECT 1 AS id, 99 AS v FROM dual \
                UNION ALL SELECT 2, 20 FROM dual) s \
         ON (t.id = s.id) \
         WHEN MATCHED THEN UPDATE SET t.v = s.v \
         WHEN NOT MATCHED THEN INSERT (id, v) VALUES (s.id, s.v)",
    )
    .await;
    let merged = run(d, "SELECT id, v FROM target ORDER BY id").await;
    assert_eq!(merged.rows.len(), 2);
    assert_eq!(as_i64(&merged.rows[0][1]), 99); // id=1 updated
    assert_eq!(as_i64(&merged.rows[1][1]), 20); // id=2 inserted

    // Sequence NEXTVAL / CURRVAL.
    run(d, "CREATE SEQUENCE s START WITH 100 INCREMENT BY 5").await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT s.NEXTVAL FROM dual").await)), 100);
    assert_eq!(as_i64(scalar(&run(d, "SELECT s.NEXTVAL FROM dual").await)), 105);
    assert_eq!(as_i64(scalar(&run(d, "SELECT s.CURRVAL FROM dual").await)), 105);

    // NVL / NVL2 / DECODE.
    let funcs = run(
        d,
        "SELECT NVL(NULL, 'fallback') AS a, \
                NVL2('x', 'present', 'absent') AS b, \
                DECODE(2, 1, 'one', 2, 'two', 'other') AS c \
         FROM dual",
    )
    .await;
    assert_eq!(as_text(&funcs.rows[0][0]), "fallback");
    assert_eq!(as_text(&funcs.rows[0][1]), "present");
    assert_eq!(as_text(&funcs.rows[0][2]), "two");

    // LISTAGG aggregates the ordered names into one delimited string.
    let agg = run(
        d,
        "SELECT LISTAGG(name, ',') WITHIN GROUP (ORDER BY id) AS names FROM emp",
    )
    .await;
    assert_eq!(as_text(scalar(&agg)), "king,jones,scott,adams");

    // TO_DATE / TO_CHAR round-trip with explicit formats.
    let dt = run(
        d,
        "SELECT TO_CHAR(TO_DATE('2020-01-15', 'YYYY-MM-DD'), 'YYYY/MM/DD') AS d FROM dual",
    )
    .await;
    assert_eq!(as_text(scalar(&dt)), "2020/01/15");
}

// ── Schema-object lifecycle (all object kinds) ──────────────────────────────

#[tokio::test]
async fn schema_object_lifecycle() {
    let (_c, driver, _h, _p) = start_oracle().await;
    let d = driver.as_ref();

    // Base table + seed data for the dependent objects.
    run(
        d,
        "CREATE TABLE employees (id NUMBER PRIMARY KEY, name VARCHAR2(20), \
         dept VARCHAR2(20), salary NUMBER)",
    )
    .await;
    run(
        d,
        "INSERT ALL \
           INTO employees VALUES (1, 'alice', 'eng',   150) \
           INTO employees VALUES (2, 'bob',   'eng',   90) \
           INTO employees VALUES (3, 'carol', 'sales', 120) \
           INTO employees VALUES (4, 'dave',  'sales', 80) \
         SELECT 1 FROM dual",
    )
    .await;

    // ── View: create / read / replace / drop ──
    run(
        d,
        "CREATE VIEW high_earners AS \
         SELECT id, name, salary FROM employees WHERE salary >= 100",
    )
    .await;
    let v = run(d, "SELECT id, name, salary FROM high_earners ORDER BY salary DESC").await;
    assert_eq!(col_names(&v), ["ID", "NAME", "SALARY"]);
    assert_eq!(v.rows.len(), 2);
    assert_eq!(as_text(&v.rows[0][1]), "alice");
    assert_eq!(as_text(&v.rows[1][1]), "carol");
    assert!(has_node(&schema_tree(d).await, "HIGH_EARNERS", SchemaNodeKind::View));

    // CREATE OR REPLACE keeps the column shape, tightens the predicate.
    run(
        d,
        "CREATE OR REPLACE VIEW high_earners AS \
         SELECT id, name, salary FROM employees WHERE salary >= 130",
    )
    .await;
    let v2 = run(d, "SELECT id, name, salary FROM high_earners").await;
    assert_eq!(v2.rows.len(), 1);
    assert_eq!(as_text(&v2.rows[0][1]), "alice");

    run(d, "DROP VIEW high_earners").await;
    assert!(!has_node(&schema_tree(d).await, "HIGH_EARNERS", SchemaNodeKind::View));
    assert!(
        driver
            .run_query("SELECT * FROM high_earners", &[], QueryLanguage::Native)
            .await
            .is_err()
    );

    // ── Materialized view: create / read / refresh / drop ──
    run(
        d,
        "CREATE MATERIALIZED VIEW dept_totals AS \
         SELECT dept, SUM(salary) AS total FROM employees GROUP BY dept",
    )
    .await;
    let mv = run(d, "SELECT dept, total FROM dept_totals ORDER BY dept").await;
    assert_eq!(mv.rows.len(), 2);
    assert_eq!(as_text(&mv.rows[0][0]), "eng");
    assert_eq!(as_i64(&mv.rows[0][1]), 240); // 150 + 90

    // New base rows are not visible until the matview is refreshed.
    run(d, "INSERT INTO employees VALUES (5, 'erin', 'eng', 60)").await;
    let stale = run(d, "SELECT total FROM dept_totals WHERE dept = 'eng'").await;
    assert_eq!(as_i64(scalar(&stale)), 240);
    run(d, "BEGIN DBMS_MVIEW.REFRESH('DEPT_TOTALS', 'C'); END;").await;
    let fresh = run(d, "SELECT total FROM dept_totals WHERE dept = 'eng'").await;
    assert_eq!(as_i64(scalar(&fresh)), 300); // 150 + 90 + 60
    assert!(has_node(&schema_tree(d).await, "DEPT_TOTALS", SchemaNodeKind::MaterializedView));

    run(d, "DROP MATERIALIZED VIEW dept_totals").await;
    assert!(!has_node(&schema_tree(d).await, "DEPT_TOTALS", SchemaNodeKind::MaterializedView));

    // ── Function: create / call / replace / drop ──
    run(
        d,
        "CREATE FUNCTION add_two(a NUMBER, b NUMBER) RETURN NUMBER IS \
         BEGIN RETURN a + b; END;",
    )
    .await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT add_two(2, 3) FROM dual").await)), 5);
    run(
        d,
        "CREATE OR REPLACE FUNCTION add_two(a NUMBER, b NUMBER) RETURN NUMBER IS \
         BEGIN RETURN a + b + 100; END;",
    )
    .await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT add_two(2, 3) FROM dual").await)), 105);
    assert!(has_node(&schema_tree(d).await, "ADD_TWO", SchemaNodeKind::Function));

    // ── Procedure: create / call (mutates) / drop ──
    run(d, "CREATE TABLE audit_log (entry VARCHAR2(50))").await;
    run(
        d,
        "CREATE PROCEDURE record(msg VARCHAR2) IS \
         BEGIN INSERT INTO audit_log (entry) VALUES (msg); END;",
    )
    .await;
    run(d, "BEGIN record('hello'); END;").await;
    assert_eq!(as_text(scalar(&run(d, "SELECT entry FROM audit_log").await)), "hello");
    assert!(has_node(&schema_tree(d).await, "RECORD", SchemaNodeKind::Procedure));

    run(d, "DROP PROCEDURE record").await;
    run(d, "DROP FUNCTION add_two").await;
    let tree = schema_tree(d).await;
    assert!(!has_node(&tree, "ADD_TWO", SchemaNodeKind::Function));
    assert!(!has_node(&tree, "RECORD", SchemaNodeKind::Procedure));

    // ── Trigger: create / fire / drop ──
    run(d, "CREATE TABLE accounts (id NUMBER, balance NUMBER)").await;
    run(d, "CREATE TABLE account_audit (account_id NUMBER, new_balance NUMBER)").await;
    run(
        d,
        "CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE ON accounts \
         FOR EACH ROW \
         BEGIN INSERT INTO account_audit (account_id, new_balance) \
         VALUES (:NEW.id, :NEW.balance); END;",
    )
    .await;
    run(d, "INSERT INTO accounts (id, balance) VALUES (1, 100)").await;
    run(d, "UPDATE accounts SET balance = 250 WHERE id = 1").await;
    let audit = run(
        d,
        "SELECT account_id, new_balance FROM account_audit ORDER BY new_balance",
    )
    .await;
    assert_eq!(audit.rows.len(), 2);
    assert_eq!(as_i64(&audit.rows[0][1]), 100); // from the INSERT
    assert_eq!(as_i64(&audit.rows[1][1]), 250); // from the UPDATE
    assert!(has_node(&schema_tree(d).await, "TRG_AUDIT", SchemaNodeKind::Trigger));

    run(d, "DROP TRIGGER trg_audit").await;
    assert!(!has_node(&schema_tree(d).await, "TRG_AUDIT", SchemaNodeKind::Trigger));

    // ── Index: create / appear in browser / used by the planner / drop ──
    run(d, "CREATE TABLE items (id NUMBER PRIMARY KEY, sku VARCHAR2(20), qty NUMBER)").await;
    run(
        d,
        "INSERT INTO items \
         SELECT LEVEL, 'sku' || LEVEL, LEVEL FROM dual CONNECT BY LEVEL <= 1000",
    )
    .await;
    run(d, "CREATE INDEX idx_items_sku ON items (sku)").await;
    assert!(has_node(&schema_tree(d).await, "IDX_ITEMS_SKU", SchemaNodeKind::Index));

    // A hinted equality lookup forces the planner onto the index; the engine's
    // explain path surfaces the plan text, which must name the index.
    let plan = driver
        .explain_query(
            "SELECT /*+ INDEX(items idx_items_sku) */ id, qty FROM items WHERE sku = 'sku500'",
            &[],
            QueryLanguage::Native,
            ExplainMode::DryRun,
        )
        .await
        .expect("explain");
    assert!(
        plan.raw.to_uppercase().contains("IDX_ITEMS_SKU"),
        "expected an index scan on idx_items_sku, got plan: {}",
        plan.raw
    );

    run(d, "DROP INDEX idx_items_sku").await;
    assert!(!has_node(&schema_tree(d).await, "IDX_ITEMS_SKU", SchemaNodeKind::Index));

    // ── Sequence: create / nextval / alter / drop ──
    run(d, "CREATE SEQUENCE order_seq START WITH 100 INCREMENT BY 5").await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT order_seq.NEXTVAL FROM dual").await)), 100);
    assert_eq!(as_i64(scalar(&run(d, "SELECT order_seq.NEXTVAL FROM dual").await)), 105);
    assert!(has_node(&schema_tree(d).await, "ORDER_SEQ", SchemaNodeKind::Sequence));

    // ALTER changes the increment; the next value jumps by the new step.
    run(d, "ALTER SEQUENCE order_seq INCREMENT BY 50").await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT order_seq.NEXTVAL FROM dual").await)), 155);

    run(d, "DROP SEQUENCE order_seq").await;
    assert!(!has_node(&schema_tree(d).await, "ORDER_SEQ", SchemaNodeKind::Sequence));
}

// ── Access control: users, roles, privileges ────────────────────────────────

#[tokio::test]
async fn access_control_users_roles() {
    let (_c, driver, host, port) = start_oracle().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE secret (id NUMBER)").await;
    run(d, "INSERT INTO secret VALUES (42)").await;

    // CREATE USER + grant the system privilege needed to log in.
    run(d, "CREATE USER tuser IDENTIFIED BY \"Tuser_pw1\"").await;
    run(d, "GRANT CREATE SESSION TO tuser").await;
    run(d, "GRANT SELECT ON secret TO tuser").await;

    // Positive: the object grant is recorded in the dictionary.
    assert_eq!(
        count(
            d,
            "SELECT COUNT(*) FROM DBA_TAB_PRIVS \
             WHERE GRANTEE = 'TUSER' AND TABLE_NAME = 'SECRET' AND PRIVILEGE = 'SELECT'",
        )
        .await,
        1
    );

    // Positive: tuser can actually read the table through the engine.
    let tuser = connect_as(&host, port, "tuser", "Tuser_pw1").await;
    assert_eq!(
        as_i64(scalar(&run(tuser.as_ref(), "SELECT id FROM appuser.secret").await)),
        42
    );

    // ALTER USER rotates the password; a fresh connection proves the new one works.
    run(d, "ALTER USER tuser IDENTIFIED BY \"Tuser_pw2\"").await;
    let tuser2 = connect_as(&host, port, "tuser", "Tuser_pw2").await;
    assert_eq!(
        as_i64(scalar(&run(tuser2.as_ref(), "SELECT id FROM appuser.secret").await)),
        42
    );

    // Role: create, grant a privilege to it, grant the role to the user.
    run(d, "CREATE ROLE analyst").await;
    run(d, "GRANT SELECT ON secret TO analyst").await;
    run(d, "GRANT analyst TO tuser").await;
    assert_eq!(
        count(
            d,
            "SELECT COUNT(*) FROM DBA_ROLE_PRIVS \
             WHERE GRANTEE = 'TUSER' AND GRANTED_ROLE = 'ANALYST'",
        )
        .await,
        1
    );
    run(d, "REVOKE analyst FROM tuser").await;
    assert_eq!(
        count(
            d,
            "SELECT COUNT(*) FROM DBA_ROLE_PRIVS \
             WHERE GRANTEE = 'TUSER' AND GRANTED_ROLE = 'ANALYST'",
        )
        .await,
        0
    );

    // REVOKE the direct object privilege: it leaves the dictionary and the live
    // session is denied immediately.
    run(d, "REVOKE SELECT ON secret FROM tuser").await;
    assert_eq!(
        count(
            d,
            "SELECT COUNT(*) FROM DBA_TAB_PRIVS \
             WHERE GRANTEE = 'TUSER' AND TABLE_NAME = 'SECRET' AND PRIVILEGE = 'SELECT'",
        )
        .await,
        0
    );
    assert!(
        tuser2
            .run_query("SELECT id FROM appuser.secret", &[], QueryLanguage::Native)
            .await
            .is_err(),
        "revoked SELECT should be denied"
    );

    tuser.close().await;
    tuser2.close().await;

    // DROP USER: gone from the dictionary and can no longer authenticate.
    run(d, "DROP USER tuser CASCADE").await;
    run(d, "DROP ROLE analyst").await;
    assert_eq!(
        count(d, "SELECT COUNT(*) FROM ALL_USERS WHERE USERNAME = 'TUSER'").await,
        0
    );
    let denied = driver_for_kind(DatabaseKind::Oracle).expect("oracle driver");
    let mut cfg = ConnectionConfig::new("it-oracle", DatabaseKind::Oracle);
    cfg.host = host.clone();
    cfg.port = port;
    cfg.user = "tuser".to_string();
    cfg.password = "Tuser_pw2".to_string();
    cfg.database = SERVICE.to_string();
    assert!(denied.connect(&cfg).await.is_err(), "dropped user must not log in");
}

// ── Transaction control ──────────────────────────────────────────────────────
//
// Oracle is always implicitly in a transaction — there is no `BEGIN`. The driver
// models Auto mode by committing each DML statement immediately, and Manual mode
// (after `begin_transaction`) by deferring to an explicit commit/rollback. Oracle
// has no Repeatable Read, so it maps to Serializable. A second `appuser` session
// observes what is actually committed.

#[tokio::test]
async fn auto_mode_commits_each_statement() {
    // Outside a manual transaction the driver emulates autocommit, so a second
    // session sees each statement's effect without an explicit commit.
    let (container, tx, host, port) = start_oracle().await;
    let other = connect_as(&host, port, "appuser", "test").await;
    run(tx.as_ref(), "CREATE TABLE acct (id NUMBER PRIMARY KEY, bal NUMBER)").await;

    run(tx.as_ref(), "INSERT INTO acct VALUES (1, 100)").await;
    let seen = run(other.as_ref(), "SELECT count(*) FROM appuser.acct").await;
    assert_eq!(as_i64(scalar(&seen)), 1, "auto-mode INSERT was not committed");
    drop(container);
}

#[tokio::test]
async fn manual_commit_makes_rows_visible_to_other_sessions() {
    let (container, tx, host, port) = start_oracle().await;
    let other = connect_as(&host, port, "appuser", "test").await;
    run(tx.as_ref(), "CREATE TABLE acct (id NUMBER PRIMARY KEY, bal NUMBER)").await;

    assert!(tx.supports_transactions());
    assert!(!tx.in_transaction().await);
    tx.begin_transaction(arris_engines::IsolationLevel::Default).await.expect("begin");
    assert!(tx.in_transaction().await);
    run(tx.as_ref(), "INSERT INTO acct VALUES (1, 100)").await;

    // Uncommitted: invisible to the other session.
    let before = run(other.as_ref(), "SELECT count(*) FROM appuser.acct").await;
    assert_eq!(as_i64(scalar(&before)), 0, "uncommitted row leaked to another session");

    tx.commit_transaction().await.expect("commit");
    assert!(!tx.in_transaction().await);

    let after = run(other.as_ref(), "SELECT count(*) FROM appuser.acct").await;
    assert_eq!(as_i64(scalar(&after)), 1);
    let row = run(other.as_ref(), "SELECT bal FROM appuser.acct WHERE id = 1").await;
    assert_eq!(as_i64(scalar(&row)), 100);
    drop(container);
}

#[tokio::test]
async fn manual_rollback_discards_changes() {
    let (container, tx, host, port) = start_oracle().await;
    let other = connect_as(&host, port, "appuser", "test").await;
    run(tx.as_ref(), "CREATE TABLE note (id NUMBER)").await;

    tx.begin_transaction(arris_engines::IsolationLevel::Default).await.expect("begin");
    run(tx.as_ref(), "INSERT INTO note VALUES (1)").await;
    run(tx.as_ref(), "INSERT INTO note VALUES (2)").await;
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM note").await)), 2);

    tx.rollback_transaction().await.expect("rollback");
    assert!(!tx.in_transaction().await);

    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM note").await)), 0);
    assert_eq!(as_i64(scalar(&run(other.as_ref(), "SELECT count(*) FROM appuser.note").await)), 0);
    drop(container);
}

#[tokio::test]
async fn failed_statement_breaks_manual_transaction() {
    // Per-engine behaviour: the oracle-rs thin driver leaves the connection
    // unusable ("connection not ready") after a statement error, so — unlike
    // Postgres/SQLite — a manual transaction cannot continue past a failed
    // statement; the only recovery is rollback (which discards the work). We
    // assert the error surfaces and that nothing was committed, observed from an
    // independent (healthy) session, then roll back.
    let (container, tx, host, port) = start_oracle().await;
    let other = connect_as(&host, port, "appuser", "test").await;
    run(tx.as_ref(), "CREATE TABLE acct (id NUMBER PRIMARY KEY, bal NUMBER)").await;

    tx.begin_transaction(arris_engines::IsolationLevel::Default).await.expect("begin");
    run(tx.as_ref(), "INSERT INTO acct VALUES (1, 100)").await;

    // A parse-time error (ORA-00947, not enough values) is raised immediately.
    let err = tx
        .run_query("INSERT INTO acct VALUES (2)", &[], QueryLanguage::Native)
        .await;
    assert!(err.is_err(), "malformed insert should fail");

    // The uncommitted insert never reached another session.
    assert_eq!(
        as_i64(scalar(&run(other.as_ref(), "SELECT count(*) FROM appuser.acct").await)),
        0,
        "uncommitted row leaked to another session",
    );

    // Roll back to discard the open (now-broken) transaction.
    let _ = tx.rollback_transaction().await;
    assert_eq!(
        as_i64(scalar(&run(other.as_ref(), "SELECT count(*) FROM appuser.acct").await)),
        0,
    );
    drop(container);
}

#[tokio::test]
async fn serializable_isolation_round_trips() {
    // Oracle does not expose the current isolation level in a queryable view, so
    // this smoke-accepts that SET TRANSACTION ISOLATION LEVEL SERIALIZABLE is
    // applied without error and the transaction commits cleanly.
    let (container, tx, _host, _port) = start_oracle().await;
    run(tx.as_ref(), "CREATE TABLE s (id NUMBER PRIMARY KEY)").await;

    tx.begin_transaction(arris_engines::IsolationLevel::Serializable).await.expect("begin");
    run(tx.as_ref(), "INSERT INTO s VALUES (1)").await;
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM s").await)), 1);
    tx.commit_transaction().await.expect("commit");
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM s").await)), 1);
    drop(container);
}

// ── Object definition (DBMS_METADATA.GET_DDL) ────────────────────────────────
//
// `DatabaseDriver::object_definition` calls `DBMS_METADATA.GET_DDL` for the given
// `ObjectRef`. Oracle folds unquoted identifiers to upper case, so the schema is
// the connected user's upper-case name (`APPUSER`) and object names are passed
// upper-case (exactly as the schema browser supplies them). DBMS_METADATA emits
// fully-qualified, canonically-formatted DDL whose exact spacing/quoting varies,
// so the assertions match robust upper-case substrings the generator reliably
// emits rather than full-string equality.

/// The connected app user, which is also the Oracle schema that owns every
/// object the suite creates (unquoted `appuser` folds to `APPUSER`).
const APPUSER_SCHEMA: &str = "APPUSER";

/// Build an `ObjectRef` in the `APPUSER` schema for the given kind + upper-case
/// object name, matching what the schema browser would supply.
fn appuser_object(kind: SchemaNodeKind, name: &str) -> ObjectRef {
    ObjectRef {
        kind,
        database: None,
        schema: Some(APPUSER_SCHEMA.to_string()),
        name: name.to_string(),
    }
}

#[tokio::test]
async fn object_definition_table() {
    let (_c, driver, _h, _p) = start_oracle().await;
    let d = driver.as_ref();

    // Parent table referenced by the child's foreign key.
    run(d, "CREATE TABLE dept (dept_id NUMBER PRIMARY KEY, dept_name VARCHAR2(40))").await;
    run(
        d,
        "CREATE TABLE staff ( \
           staff_id   NUMBER PRIMARY KEY, \
           full_name  VARCHAR2(60) NOT NULL, \
           dept_id    NUMBER, \
           CONSTRAINT fk_staff_dept FOREIGN KEY (dept_id) REFERENCES dept (dept_id) \
         )",
    )
    .await;

    let ddl = d
        .object_definition(&appuser_object(SchemaNodeKind::Table, "STAFF"))
        .await
        .expect("table DDL")
        .to_uppercase();

    assert!(ddl.contains("CREATE TABLE"), "missing CREATE TABLE: {ddl}");
    assert!(ddl.contains("STAFF"), "missing table name: {ddl}");
    assert!(ddl.contains("STAFF_ID"), "missing pk column: {ddl}");
    assert!(ddl.contains("FULL_NAME"), "missing not-null column: {ddl}");
    assert!(ddl.contains("DEPT_ID"), "missing fk column: {ddl}");
    assert!(ddl.contains("PRIMARY KEY"), "missing PRIMARY KEY: {ddl}");
    assert!(ddl.contains("NOT NULL"), "missing NOT NULL: {ddl}");
    assert!(ddl.contains("FOREIGN KEY"), "missing FOREIGN KEY: {ddl}");
}

#[tokio::test]
async fn object_definition_view() {
    let (_c, driver, _h, _p) = start_oracle().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE people (id NUMBER PRIMARY KEY, name VARCHAR2(30), age NUMBER)").await;
    run(
        d,
        "CREATE VIEW adults AS SELECT id, name FROM people WHERE age >= 18",
    )
    .await;

    let ddl = d
        .object_definition(&appuser_object(SchemaNodeKind::View, "ADULTS"))
        .await
        .expect("view DDL")
        .to_uppercase();

    assert!(ddl.contains("CREATE"), "missing CREATE: {ddl}");
    assert!(ddl.contains("VIEW"), "missing VIEW: {ddl}");
    assert!(ddl.contains("ADULTS"), "missing view name: {ddl}");
}

#[tokio::test]
async fn object_definition_materialized_view() {
    let (_c, driver, _h, _p) = start_oracle().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE orders (id NUMBER PRIMARY KEY, region VARCHAR2(10), amount NUMBER)").await;
    run(
        d,
        "CREATE MATERIALIZED VIEW region_totals AS \
         SELECT region, SUM(amount) AS total FROM orders GROUP BY region",
    )
    .await;

    let ddl = d
        .object_definition(&appuser_object(SchemaNodeKind::MaterializedView, "REGION_TOTALS"))
        .await
        .expect("materialized view DDL")
        .to_uppercase();

    assert!(ddl.contains("MATERIALIZED VIEW"), "missing MATERIALIZED VIEW: {ddl}");
    assert!(ddl.contains("REGION_TOTALS"), "missing matview name: {ddl}");
}

#[tokio::test]
async fn object_definition_sequence() {
    let (_c, driver, _h, _p) = start_oracle().await;
    let d = driver.as_ref();

    run(d, "CREATE SEQUENCE invoice_seq START WITH 1000 INCREMENT BY 1").await;

    let ddl = d
        .object_definition(&appuser_object(SchemaNodeKind::Sequence, "INVOICE_SEQ"))
        .await
        .expect("sequence DDL")
        .to_uppercase();

    assert!(ddl.contains("CREATE SEQUENCE"), "missing CREATE SEQUENCE: {ddl}");
    assert!(ddl.contains("INVOICE_SEQ"), "missing sequence name: {ddl}");
}

#[tokio::test]
async fn object_definition_index() {
    let (_c, driver, _h, _p) = start_oracle().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE products (id NUMBER PRIMARY KEY, sku VARCHAR2(20))").await;
    run(d, "CREATE INDEX idx_products_sku ON products (sku)").await;

    let ddl = d
        .object_definition(&appuser_object(SchemaNodeKind::Index, "IDX_PRODUCTS_SKU"))
        .await
        .expect("index DDL")
        .to_uppercase();

    assert!(ddl.contains("CREATE"), "missing CREATE: {ddl}");
    assert!(ddl.contains("INDEX"), "missing INDEX: {ddl}");
    assert!(ddl.contains("IDX_PRODUCTS_SKU"), "missing index name: {ddl}");
}

#[tokio::test]
async fn object_definition_function() {
    let (_c, driver, _h, _p) = start_oracle().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE FUNCTION triple(n NUMBER) RETURN NUMBER IS \
         BEGIN RETURN n * 3; END;",
    )
    .await;

    let ddl = d
        .object_definition(&appuser_object(SchemaNodeKind::Function, "TRIPLE"))
        .await
        .expect("function DDL")
        .to_uppercase();

    assert!(ddl.contains("FUNCTION"), "missing FUNCTION: {ddl}");
    assert!(ddl.contains("TRIPLE"), "missing function name: {ddl}");
}

#[tokio::test]
async fn object_definition_procedure() {
    let (_c, driver, _h, _p) = start_oracle().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE log_tbl (entry VARCHAR2(50))").await;
    run(
        d,
        "CREATE PROCEDURE log_it(msg VARCHAR2) IS \
         BEGIN INSERT INTO log_tbl (entry) VALUES (msg); END;",
    )
    .await;

    let ddl = d
        .object_definition(&appuser_object(SchemaNodeKind::Procedure, "LOG_IT"))
        .await
        .expect("procedure DDL")
        .to_uppercase();

    assert!(ddl.contains("PROCEDURE"), "missing PROCEDURE: {ddl}");
    assert!(ddl.contains("LOG_IT"), "missing procedure name: {ddl}");
}

#[tokio::test]
async fn object_definition_trigger() {
    let (_c, driver, _h, _p) = start_oracle().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE balances (id NUMBER, amount NUMBER)").await;
    run(d, "CREATE TABLE balance_audit (id NUMBER, amount NUMBER)").await;
    run(
        d,
        "CREATE TRIGGER trg_balances AFTER INSERT ON balances \
         FOR EACH ROW \
         BEGIN INSERT INTO balance_audit (id, amount) VALUES (:NEW.id, :NEW.amount); END;",
    )
    .await;

    let ddl = d
        .object_definition(&appuser_object(SchemaNodeKind::Trigger, "TRG_BALANCES"))
        .await
        .expect("trigger DDL")
        .to_uppercase();

    assert!(ddl.contains("TRIGGER"), "missing TRIGGER: {ddl}");
    assert!(ddl.contains("TRG_BALANCES"), "missing trigger name: {ddl}");
}

// NOTE: schema DDL (`GET_DDL('USER', <schema>)`) is intentionally not covered
// here. A schema is an Oracle USER, and `DBMS_METADATA.GET_DDL` only returns a
// non-schema object like USER to a session holding `SELECT_CATALOG_ROLE`, which
// the unprivileged `APPUSER` connection used by this suite does not have
// (fetching it raises ORA-31603). The `USER` metadata-type mapping is covered by
// the unit tests in `drivers/oracle/definition.rs`.

#[tokio::test]
async fn object_definition_missing_object_errors() {
    let (_c, driver, _h, _p) = start_oracle().await;
    let d = driver.as_ref();

    // A table that was never created has no DDL: GET_DDL raises, surfaced as Err.
    let result = d
        .object_definition(&appuser_object(SchemaNodeKind::Table, "NO_SUCH_TABLE"))
        .await;
    assert!(result.is_err(), "expected Err for non-existent object, got {result:?}");
}

mod dbt_diff_scenario;

/// dbt slim-diff (`Oracle` dialect: `MINUS` for set-difference, `FETCH FIRST n
/// ROWS ONLY` for limiting, `"`-quoting, `FROM dual` for table-less SELECTs)
/// end-to-end against a real Oracle instance. Identifiers are created quoted so
/// they keep the lowercase casing the diff SQL emits. See `dbt_diff_scenario`.
#[tokio::test]
async fn slim_diff_keyless_and_keyed() {
    use arris_engines::dbt::DiffDialect;

    let (_c, driver, _h, _p) = start_oracle().await;
    let d = driver.as_ref();
    run(d, "CREATE TABLE \"diff_prod\" (\"id\" NUMBER, \"amount\" NUMBER)").await;
    // Oracle has no multi-row VALUES; insert via a UNION ALL of dual SELECTs.
    run(
        d,
        "INSERT INTO \"diff_prod\" (\"id\", \"amount\") \
         SELECT 1, 100 FROM dual UNION ALL SELECT 2, 200 FROM dual UNION ALL SELECT 3, 300 FROM dual",
    )
    .await;

    let prod = "\"diff_prod\"";
    let new_select = "SELECT 2 AS \"id\", 200 AS \"amount\" FROM dual \
         UNION ALL SELECT 3, 333 FROM dual \
         UNION ALL SELECT 4, 400 FROM dual";

    dbt_diff_scenario::assert_keyless(d, DiffDialect::Oracle, prod, new_select).await;
    dbt_diff_scenario::assert_keyed(d, DiffDialect::Oracle, prod, new_select).await;
}
