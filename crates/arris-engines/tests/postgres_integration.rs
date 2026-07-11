//! Integration tests for the Postgres driver against a real `postgres:18`
//! instance started via `testcontainers`. Queries run through the engine's
//! `DatabaseDriver::run_query` (the same path the app uses), and the returned
//! `QueryResult` is asserted.
//!
//! Requires Docker. Run with:
//!   `cargo test -p arris-engines --test postgres_integration`
//! Each test owns its own container, so they are independent and parallel-safe.

use arris_engines::{
    CanvasEngine, CanvasError, CellResultCache, ConnectionConfig, ConnectionEngine,
    DatabaseDriver, DatabaseKind, ExplainMode, IsolationLevel, ObjectRef, PlanNode, QueryEngine,
    QueryLanguage, QueryResult, QueryValue, SchemaNode, SchemaNodeKind, SslMode,
    TransactionConfig, TransactionMode, driver_for_kind, CELL_INGEST_BYTE_BUDGET, CELL_RESULT_PAGE_ROWS,
};
use tokio_util::sync::CancellationToken;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ImageExt};

// ── harness ─────────────────────────────────────────────────────────────────

/// Boot a fresh `postgres:18` container and return a connected driver. The
/// container guard must be kept alive for the duration of the test.
async fn start_pg() -> (ContainerAsync<Postgres>, Box<dyn DatabaseDriver>) {
    let container = Postgres::default()
        .with_tag("18")
        .start()
        .await
        .expect("start postgres container");
    let host = container.get_host().await.expect("container host").to_string();
    let port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("container port");

    let mut cfg = ConnectionConfig::new("it-postgres", DatabaseKind::Postgres);
    cfg.host = host;
    cfg.port = port;
    cfg.user = "postgres".to_string();
    cfg.password = "postgres".to_string();
    cfg.database = "postgres".to_string();

    let driver = driver_for_kind(DatabaseKind::Postgres).expect("postgres driver");
    driver.connect(&cfg).await.expect("connect to postgres");
    (container, driver)
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

fn as_text(v: &QueryValue) -> &str {
    match v {
        QueryValue::Text(s) => s,
        other => panic!("expected Text, got {other:?}"),
    }
}

fn as_decimal(v: &QueryValue) -> &str {
    match v {
        QueryValue::Decimal(s) => s,
        other => panic!("expected Decimal, got {other:?}"),
    }
}

fn as_bool(v: &QueryValue) -> bool {
    match v {
        QueryValue::Bool(b) => *b,
        other => panic!("expected Bool, got {other:?}"),
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
    // Lazy split: `list_schemas` returns schema containers only; load `public`'s
    // objects too so object-level `has_node` assertions still find them while
    // schema-container assertions keep matching against the container list.
    let mut tree = driver.list_schemas().await.expect("list_schemas");
    tree.extend(driver.list_schema("public").await.expect("list_schema"));
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
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE users (id serial PRIMARY KEY, name text NOT NULL, age int)",
    )
    .await;

    // Multi-row insert reports the affected count.
    let inserted = exec_affected(
        d,
        "INSERT INTO users (name, age) VALUES ('alice', 30), ('bob', 25), ('carol', 40)",
    )
    .await;
    assert_eq!(inserted, 3);

    // INSERT ... RETURNING surfaced through a data-modifying CTE (the engine
    // routes bare INSERT via execute(), which drops the RETURNING rows).
    let returned = run(
        d,
        "WITH ins AS (INSERT INTO users (name, age) VALUES ('dave', 22) RETURNING name) \
         SELECT name FROM ins",
    )
    .await;
    assert_eq!(as_text(scalar(&returned)), "dave");

    // SELECT with filter / ORDER BY / LIMIT.
    let top = run(
        d,
        "SELECT name, age FROM users WHERE age >= 25 ORDER BY age DESC LIMIT 2",
    )
    .await;
    assert_eq!(top.rows.len(), 2);
    assert_eq!(as_text(&top.rows[0][0]), "carol");
    assert_eq!(as_i64(&top.rows[0][1]), 40);

    // JOIN.
    run(
        d,
        "CREATE TABLE orders (id serial PRIMARY KEY, user_id int, amount int)",
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
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE sales (region text, amount int)").await;
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
    assert_eq!(r.rows.len(), 5);

    // Ordered by amount asc: [10, 20, 30, 40, 50].
    // First row (amount=10): LAG is NULL, running total within 'east' = 10.
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

// ── Postgres-specific: NUMERIC / DECIMAL ────────────────────────────────────

#[tokio::test]
async fn numeric_values_round_trip_exactly() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE money ( \
           id      int PRIMARY KEY, \
           revenue numeric, \
           margin  numeric(6,2), \
           big     numeric, \
           maybe   numeric \
         )",
    )
    .await;
    run(
        d,
        "INSERT INTO money (id, revenue, margin, big, maybe) VALUES \
           (1,  1234.5678, 12.50, 99999999999999999999, NULL), \
           (2, -42,        0.00,  0.0001234,            7.00)",
    )
    .await;

    let r = run(
        d,
        "SELECT id, revenue, margin, big, maybe, \
           SUM(revenue) OVER (ORDER BY id) AS running \
         FROM money ORDER BY id",
    )
    .await;

    // The column type is surfaced as `numeric`, not coerced to int/float.
    assert_eq!(col_type(&r, "revenue"), "numeric");
    assert_eq!(col_type(&r, "running"), "numeric");
    assert_eq!(r.rows.len(), 2);

    // NUMERIC arrives as the exact-decimal `Decimal` variant (not `Text`), so
    // the row-detail JSON can render it as an unquoted number with full
    // precision. `as_decimal` panics unless the variant is `Decimal`.
    let r0 = &r.rows[0];
    assert_eq!(as_decimal(&r0[1]), "1234.5678");
    assert_eq!(as_decimal(&r0[2]), "12.50"); // scale padding preserved
    assert_eq!(as_decimal(&r0[3]), "99999999999999999999"); // beyond i64
    assert!(r0[4].is_null());
    assert_eq!(as_decimal(&r0[5]), "1234.5678"); // running sum so far

    // Row 2: negative, zero-with-scale, sub-one fraction, windowed sum.
    let r1 = &r.rows[1];
    assert_eq!(as_decimal(&r1[1]), "-42");
    assert_eq!(as_decimal(&r1[2]), "0.00");
    assert_eq!(as_decimal(&r1[3]), "0.0001234");
    assert_eq!(as_decimal(&r1[4]), "7.00");
    assert_eq!(as_decimal(&r1[5]), "1192.5678"); // 1234.5678 + (-42)
}

// ── Postgres-specific: JSONB & arrays ───────────────────────────────────────

#[tokio::test]
async fn jsonb_and_array_operations() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE docs (id int, body jsonb)").await;
    run(
        d,
        "INSERT INTO docs (id, body) VALUES \
         (1, '{\"name\":\"alice\",\"tags\":[\"x\",\"y\"],\"age\":30}'), \
         (2, '{\"name\":\"bob\",\"tags\":[\"y\",\"z\"],\"age\":25}')",
    )
    .await;

    // ->> extracts text.
    let name = run(d, "SELECT body->>'name' FROM docs WHERE id = 1").await;
    assert_eq!(as_text(scalar(&name)), "alice");

    // -> keeps the JSON value (jsonb column → QueryValue::Json).
    let age = run(d, "SELECT body->'age' FROM docs WHERE id = 1").await;
    assert_eq!(as_json(scalar(&age)), "30");

    // @> containment.
    let contains = run(
        d,
        "SELECT count(*) FROM docs WHERE body @> '{\"name\":\"bob\"}'",
    )
    .await;
    assert_eq!(as_i64(scalar(&contains)), 1);

    // jsonb_set.
    let updated = run(
        d,
        "SELECT jsonb_set(body, '{age}', '99')->>'age' FROM docs WHERE id = 1",
    )
    .await;
    assert_eq!(as_text(scalar(&updated)), "99");

    // jsonb_agg over a derived value.
    let agg = run(d, "SELECT jsonb_agg(body->>'name' ORDER BY id) FROM docs").await;
    assert_eq!(as_json(scalar(&agg)), "[\"alice\",\"bob\"]");

    // Array containment, ANY, unnest, array_agg.
    assert!(as_bool(scalar(&run(d, "SELECT ARRAY[1,2,3] @> ARRAY[2]").await)));
    assert!(as_bool(scalar(&run(d, "SELECT 3 = ANY(ARRAY[1,2,3])").await)));

    let unnest_sum = run(d, "SELECT sum(x) FROM unnest(ARRAY[1,2,3,4]) AS t(x)").await;
    assert_eq!(as_i64(scalar(&unnest_sum)), 10);

    // array_agg wrapped to_jsonb surfaces as JSON (the engine maps bare
    // non-json arrays like int[] to Null, so cast to jsonb to read the value).
    let ids = run(d, "SELECT to_jsonb(array_agg(id ORDER BY id)) FROM docs").await;
    assert_eq!(as_json(scalar(&ids)), "[1,2]");
}

// ── Postgres-specific: recursive CTE & LATERAL ──────────────────────────────

#[tokio::test]
async fn recursive_cte_and_lateral_join() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    // WITH RECURSIVE: 1..5.
    let sum = run(
        d,
        "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 5) \
         SELECT sum(n) FROM t",
    )
    .await;
    assert_eq!(as_i64(scalar(&sum)), 15);

    // LATERAL: top-scoring player per team.
    run(d, "CREATE TABLE teams (id int, name text)").await;
    run(d, "CREATE TABLE players (team_id int, name text, score int)").await;
    run(d, "INSERT INTO teams (id, name) VALUES (1, 'a'), (2, 'b')").await;
    run(
        d,
        "INSERT INTO players (team_id, name, score) VALUES \
         (1, 'p1', 10), (1, 'p2', 20), (2, 'p3', 5)",
    )
    .await;

    let r = run(
        d,
        "SELECT t.name, top.name, top.score FROM teams t \
         JOIN LATERAL ( \
           SELECT name, score FROM players p WHERE p.team_id = t.id \
           ORDER BY score DESC LIMIT 1 \
         ) top ON true \
         ORDER BY t.id",
    )
    .await;
    assert_eq!(r.rows.len(), 2);
    assert_eq!(as_text(&r.rows[0][0]), "a");
    assert_eq!(as_text(&r.rows[0][1]), "p2");
    assert_eq!(as_i64(&r.rows[0][2]), 20);
    assert_eq!(as_text(&r.rows[1][1]), "p3");
}

// ── Postgres-specific: upsert, generate_series, full-text search ────────────

#[tokio::test]
async fn upsert_generate_series_and_fulltext() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    // generate_series.
    let count = run(d, "SELECT count(*) FROM generate_series(1, 10)").await;
    assert_eq!(as_i64(scalar(&count)), 10);
    let gsum = run(d, "SELECT sum(g) FROM generate_series(1, 5) AS g").await;
    assert_eq!(as_i64(scalar(&gsum)), 15);

    // Upsert: ON CONFLICT DO UPDATE accumulates.
    run(d, "CREATE TABLE kv (k text PRIMARY KEY, v int)").await;
    run(d, "INSERT INTO kv (k, v) VALUES ('a', 1)").await;
    run(
        d,
        "INSERT INTO kv (k, v) VALUES ('a', 5) \
         ON CONFLICT (k) DO UPDATE SET v = kv.v + excluded.v",
    )
    .await;
    let v = run(d, "SELECT v FROM kv WHERE k = 'a'").await;
    assert_eq!(as_i64(scalar(&v)), 6);

    // Full-text search.
    run(d, "CREATE TABLE articles (id int, body text)").await;
    run(
        d,
        "INSERT INTO articles (id, body) VALUES \
         (1, 'the quick brown fox'), (2, 'lazy dog sleeps')",
    )
    .await;

    let fox = run(
        d,
        "SELECT count(*) FROM articles \
         WHERE to_tsvector('english', body) @@ to_tsquery('english', 'fox')",
    )
    .await;
    assert_eq!(as_i64(scalar(&fox)), 1);

    let dog = run(
        d,
        "SELECT id FROM articles \
         WHERE to_tsvector('english', body) @@ plainto_tsquery('english', 'dog')",
    )
    .await;
    assert_eq!(as_i64(scalar(&dog)), 2);

    // ts_rank yields a positive score for the matching document.
    let ranked = run(
        d,
        "SELECT ts_rank(to_tsvector('english', body), to_tsquery('english', 'fox')) > 0 \
         FROM articles WHERE id = 1",
    )
    .await;
    assert!(as_bool(scalar(&ranked)));
}

// ── Views: create / read / replace / drop + schema browser ──────────────────

#[tokio::test]
async fn view_full_lifecycle() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE employees (id serial PRIMARY KEY, name text, dept text, salary int)",
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
        "CREATE VIEW high_earners AS \
         SELECT id, name, salary FROM employees WHERE salary >= 100",
    )
    .await;

    // READ through the view — assert columns, types, and the full row set.
    let v = run(d, "SELECT * FROM high_earners ORDER BY salary DESC").await;
    assert_eq!(col_names(&v), ["id", "name", "salary"]);
    assert_eq!(col_type(&v, "salary"), "int4");
    assert_eq!(v.rows.len(), 2);
    assert_eq!(as_text(&v.rows[0][1]), "alice");
    assert_eq!(as_i64(&v.rows[0][2]), 150);
    assert_eq!(as_text(&v.rows[1][1]), "carol");
    assert_eq!(as_i64(&v.rows[1][2]), 120);

    // UPDATE the definition via CREATE OR REPLACE. Postgres requires the
    // replacement to keep the same leading columns, so we tighten the filter:
    // the row set changes (only alice now qualifies) while the shape stays.
    run(
        d,
        "CREATE OR REPLACE VIEW high_earners AS \
         SELECT id, name, salary FROM employees WHERE salary >= 130",
    )
    .await;
    let v2 = run(d, "SELECT * FROM high_earners ORDER BY salary DESC").await;
    assert_eq!(col_names(&v2), ["id", "name", "salary"]);
    assert_eq!(v2.rows.len(), 1);
    assert_eq!(as_text(&v2.rows[0][1]), "alice");
    assert_eq!(as_i64(&v2.rows[0][2]), 150);

    // The schema browser surfaces the view.
    assert!(has_node(
        &schema_tree(d).await,
        "high_earners",
        SchemaNodeKind::View
    ));

    // DROP — the view disappears from the browser and can no longer be queried.
    run(d, "DROP VIEW high_earners").await;
    assert!(!has_node(
        &schema_tree(d).await,
        "high_earners",
        SchemaNodeKind::View
    ));
    assert!(
        driver
            .run_query("SELECT * FROM high_earners", &[], QueryLanguage::Native)
            .await
            .is_err()
    );
}

// ── Materialized views: create / read / refresh / drop ──────────────────────

#[tokio::test]
async fn materialized_view_refresh_lifecycle() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE metrics (id int, val int)").await;
    run(d, "INSERT INTO metrics (id, val) VALUES (1, 10), (2, 20)").await;

    run(
        d,
        "CREATE MATERIALIZED VIEW metric_sum AS SELECT sum(val) AS total FROM metrics",
    )
    .await;

    let initial = run(d, "SELECT total FROM metric_sum").await;
    assert_eq!(col_names(&initial), ["total"]);
    assert_eq!(as_i64(scalar(&initial)), 30);

    // New base rows are NOT visible until the matview is refreshed.
    run(d, "INSERT INTO metrics (id, val) VALUES (3, 30)").await;
    let stale = run(d, "SELECT total FROM metric_sum").await;
    assert_eq!(as_i64(scalar(&stale)), 30);

    run(d, "REFRESH MATERIALIZED VIEW metric_sum").await;
    let refreshed = run(d, "SELECT total FROM metric_sum").await;
    assert_eq!(as_i64(scalar(&refreshed)), 60);

    assert!(has_node(
        &schema_tree(d).await,
        "metric_sum",
        SchemaNodeKind::MaterializedView
    ));

    run(d, "DROP MATERIALIZED VIEW metric_sum").await;
    assert!(!has_node(
        &schema_tree(d).await,
        "metric_sum",
        SchemaNodeKind::MaterializedView
    ));
}

// ── Functions & procedures: create / replace / call / drop ──────────────────

#[tokio::test]
async fn function_and_procedure_lifecycle() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    // Function: create, invoke, replace, re-invoke.
    run(
        d,
        "CREATE FUNCTION add_two(a int, b int) RETURNS int LANGUAGE sql AS 'SELECT a + b'",
    )
    .await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT add_two(2, 3)").await)), 5);

    run(
        d,
        "CREATE OR REPLACE FUNCTION add_two(a int, b int) RETURNS int \
         LANGUAGE sql AS 'SELECT a + b + 100'",
    )
    .await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT add_two(2, 3)").await)), 105);

    // Procedure: create, CALL (mutates), verify side effect.
    run(d, "CREATE TABLE audit_log (entry text)").await;
    run(
        d,
        "CREATE PROCEDURE record(msg text) LANGUAGE sql AS \
         'INSERT INTO audit_log (entry) VALUES (msg)'",
    )
    .await;
    run(d, "CALL record('hello'::text)").await;
    assert_eq!(
        as_text(scalar(&run(d, "SELECT entry FROM audit_log").await)),
        "hello"
    );

    // Both appear in the schema browser under the right kinds.
    let tree = schema_tree(d).await;
    assert!(has_node(&tree, "add_two", SchemaNodeKind::Function));
    assert!(has_node(&tree, "record", SchemaNodeKind::Procedure));

    // DROP both; they leave the browser.
    run(d, "DROP PROCEDURE record(text)").await;
    run(d, "DROP FUNCTION add_two(int, int)").await;
    let tree = schema_tree(d).await;
    assert!(!has_node(&tree, "add_two", SchemaNodeKind::Function));
    assert!(!has_node(&tree, "record", SchemaNodeKind::Procedure));
}

// ── Triggers: create / fire / drop + schema browser ─────────────────────────

#[tokio::test]
async fn trigger_fires_and_appears_in_browser() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE accounts (id int, balance int)").await;
    run(d, "CREATE TABLE account_audit (account_id int, new_balance int)").await;
    run(
        d,
        "CREATE FUNCTION audit_balance() RETURNS trigger LANGUAGE plpgsql AS $$ \
         BEGIN INSERT INTO account_audit (account_id, new_balance) \
         VALUES (NEW.id, NEW.balance); RETURN NEW; END; $$",
    )
    .await;
    run(
        d,
        "CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE ON accounts \
         FOR EACH ROW EXECUTE FUNCTION audit_balance()",
    )
    .await;

    // The trigger fires on both INSERT and UPDATE.
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

    assert!(has_node(
        &schema_tree(d).await,
        "trg_audit",
        SchemaNodeKind::Trigger
    ));

    run(d, "DROP TRIGGER trg_audit ON accounts").await;
    assert!(!has_node(
        &schema_tree(d).await,
        "trg_audit",
        SchemaNodeKind::Trigger
    ));
}

// ── Roles / users: create, grant, privileges, alter, drop ───────────────────

#[tokio::test]
async fn role_and_user_lifecycle() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    // CREATE ROLE (no login) and CREATE USER (role WITH LOGIN).
    run(d, "CREATE ROLE analyst NOLOGIN").await;
    run(d, "CREATE USER app_user WITH PASSWORD 'secret'").await;

    // Login capability distinguishes a USER from a bare ROLE.
    assert!(as_bool(scalar(
        &run(d, "SELECT rolcanlogin FROM pg_roles WHERE rolname = 'app_user'").await
    )));
    assert!(!as_bool(scalar(
        &run(d, "SELECT rolcanlogin FROM pg_roles WHERE rolname = 'analyst'").await
    )));

    // Role membership.
    run(d, "GRANT analyst TO app_user").await;
    let members = run(
        d,
        "SELECT count(*) FROM pg_auth_members m \
         JOIN pg_roles r ON m.roleid = r.oid \
         JOIN pg_roles u ON m.member = u.oid \
         WHERE r.rolname = 'analyst' AND u.rolname = 'app_user'",
    )
    .await;
    assert_eq!(as_i64(scalar(&members)), 1);

    // Table privileges: GRANT then assert positive + negative.
    run(d, "CREATE TABLE reports (id int)").await;
    run(d, "GRANT SELECT ON reports TO analyst").await;
    assert!(as_bool(scalar(
        &run(d, "SELECT has_table_privilege('analyst', 'reports', 'SELECT')").await
    )));
    assert!(!as_bool(scalar(
        &run(d, "SELECT has_table_privilege('analyst', 'reports', 'INSERT')").await
    )));

    // ALTER ROLE (rotate password — just needs to succeed).
    run(d, "ALTER ROLE app_user WITH PASSWORD 'newsecret'").await;

    // REVOKE drops the privilege.
    run(d, "REVOKE SELECT ON reports FROM analyst").await;
    assert!(!as_bool(scalar(
        &run(d, "SELECT has_table_privilege('analyst', 'reports', 'SELECT')").await
    )));

    // DROP both roles (member first); they vanish from pg_roles.
    run(d, "DROP USER app_user").await;
    run(d, "DROP ROLE analyst").await;
    let remaining = run(
        d,
        "SELECT count(*) FROM pg_roles WHERE rolname IN ('analyst', 'app_user')",
    )
    .await;
    assert_eq!(as_i64(scalar(&remaining)), 0);
}

// ── Indexes: create / appear in browser / used by the planner / drop ────────

fn plan_uses_index(node: &PlanNode) -> bool {
    node.node_type.contains("Index") || node.children.iter().any(plan_uses_index)
}

#[tokio::test]
async fn index_lifecycle_and_explain_usage() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE items (id serial PRIMARY KEY, sku text, qty int)").await;
    run(
        d,
        "INSERT INTO items (sku, qty) SELECT 'sku' || g, g FROM generate_series(1, 1000) g",
    )
    .await;
    run(d, "CREATE INDEX idx_items_sku ON items (sku)").await;
    run(d, "ANALYZE items").await;

    // The schema browser surfaces the index.
    assert!(has_node(
        &schema_tree(d).await,
        "idx_items_sku",
        SchemaNodeKind::Index
    ));

    // The planner uses it. Disable seq scans on this connection so the choice
    // is deterministic, then read the plan through the engine's explain path.
    run(d, "SET enable_seqscan = off").await;
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
        plan_uses_index(&plan.root),
        "expected an index scan, got plan: {}",
        plan.raw
    );

    // DROP removes our named index from the browser (the pkey index remains).
    run(d, "DROP INDEX idx_items_sku").await;
    assert!(!has_node(
        &schema_tree(d).await,
        "idx_items_sku",
        SchemaNodeKind::Index
    ));
}

// ── Sequences: create / nextval / currval / setval / alter / drop ───────────

#[tokio::test]
async fn sequence_lifecycle() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    run(d, "CREATE SEQUENCE order_seq START 100 INCREMENT 5").await;

    // nextval advances by the increment; currval reports the last value.
    assert_eq!(as_i64(scalar(&run(d, "SELECT nextval('order_seq')").await)), 100);
    assert_eq!(as_i64(scalar(&run(d, "SELECT nextval('order_seq')").await)), 105);
    assert_eq!(as_i64(scalar(&run(d, "SELECT currval('order_seq')").await)), 105);

    assert!(has_node(
        &schema_tree(d).await,
        "order_seq",
        SchemaNodeKind::Sequence
    ));

    // setval repositions the sequence; the next value continues from there.
    assert_eq!(as_i64(scalar(&run(d, "SELECT setval('order_seq', 200)").await)), 200);
    assert_eq!(as_i64(scalar(&run(d, "SELECT nextval('order_seq')").await)), 205);

    // ALTER ... RESTART resets the counter.
    run(d, "ALTER SEQUENCE order_seq RESTART WITH 1").await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT nextval('order_seq')").await)), 1);

    run(d, "DROP SEQUENCE order_seq").await;
    assert!(!has_node(
        &schema_tree(d).await,
        "order_seq",
        SchemaNodeKind::Sequence
    ));
}

// ── TLS / SSL ─────────────────────────────────────────────────────────────────
//
// The rustls verifier construction (per-mode `ClientConfig`, CA loading, missing
// -file errors) is unit-tested in `arris_engines::drivers::tls`. These cases
// assert the driver's mode handling end-to-end against a real `postgres:18`
// container. The stock image ships `ssl=off`, so they cover the plaintext
// (`Disabled`) path, the `Preferred` fallback, the `Required` no-downgrade
// guarantee, and the verify-mode precondition that a CA path is required; a
// positive `VerifyCa` handshake needs a TLS-configured server and is left to the
// rustls unit tests.

/// Boot a fresh `postgres:18` container and return its mapped host + port
/// without connecting, so each test can drive a specific `ssl_mode`.
async fn start_pg_container() -> (ContainerAsync<Postgres>, String, u16) {
    let container = Postgres::default()
        .with_tag("18")
        .start()
        .await
        .expect("start postgres container");
    let host = container.get_host().await.expect("container host").to_string();
    let port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("container port");
    (container, host, port)
}

fn tls_config(host: String, port: u16, mode: SslMode) -> ConnectionConfig {
    let mut cfg = ConnectionConfig::new("it-postgres-tls", DatabaseKind::Postgres);
    cfg.host = host;
    cfg.port = port;
    cfg.user = "postgres".to_string();
    cfg.password = "postgres".to_string();
    cfg.database = "postgres".to_string();
    cfg.ssl_mode = mode;
    cfg
}

#[tokio::test]
async fn tls_disabled_connects_plaintext() {
    let (_c, host, port) = start_pg_container().await;
    let cfg = tls_config(host, port, SslMode::Disabled);
    let driver = driver_for_kind(DatabaseKind::Postgres).expect("postgres driver");
    driver.connect(&cfg).await.expect("disabled-mode connect");
    let r = run(driver.as_ref(), "SELECT 1").await;
    assert_eq!(as_i64(scalar(&r)), 1);
}

#[tokio::test]
async fn tls_preferred_connects_against_non_tls_server() {
    // Preferred negotiates TLS but falls back to plaintext when the server
    // (stock image, ssl=off) declines, so the connection still succeeds.
    let (_c, host, port) = start_pg_container().await;
    let cfg = tls_config(host, port, SslMode::Preferred);
    let driver = driver_for_kind(DatabaseKind::Postgres).expect("postgres driver");
    driver.connect(&cfg).await.expect("preferred-mode connect");
    let r = run(driver.as_ref(), "SELECT 1").await;
    assert_eq!(as_i64(scalar(&r)), 1);
}

#[tokio::test]
async fn tls_required_against_non_tls_server_fails() {
    // Required forbids the plaintext fallback, so connecting to an ssl=off
    // server must fail rather than silently downgrade.
    let (_c, host, port) = start_pg_container().await;
    let cfg = tls_config(host, port, SslMode::Required);
    let driver = driver_for_kind(DatabaseKind::Postgres).expect("postgres driver");
    assert!(
        driver.connect(&cfg).await.is_err(),
        "Required must not fall back to plaintext against an ssl=off server"
    );
}

#[tokio::test]
async fn tls_verify_ca_without_ca_path_is_rejected() {
    // verify_ca / verify_identity need a CA to anchor the chain; the driver
    // surfaces a clear error before any network round-trip.
    let (_c, host, port) = start_pg_container().await;
    let cfg = tls_config(host, port, SslMode::VerifyCa);
    let driver = driver_for_kind(DatabaseKind::Postgres).expect("postgres driver");
    let err = driver
        .connect(&cfg)
        .await
        .expect_err("verify_ca without a CA path must fail");
    let msg = format!("{err:?}").to_lowercase();
    assert!(msg.contains("ca"), "expected a CA-required error, got: {msg}");
}

// ── manual transactions ────────────────────────────────────────────

/// Open a second independent connection to the same container, used to verify
/// what another session can/can't see while a manual transaction is open.
async fn connect_pg(container: &ContainerAsync<Postgres>) -> Box<dyn DatabaseDriver> {
    let host = container.get_host().await.expect("container host").to_string();
    let port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("container port");
    let mut cfg = ConnectionConfig::new("it-postgres-2", DatabaseKind::Postgres);
    cfg.host = host;
    cfg.port = port;
    cfg.user = "postgres".to_string();
    cfg.password = "postgres".to_string();
    cfg.database = "postgres".to_string();
    let driver = driver_for_kind(DatabaseKind::Postgres).expect("postgres driver");
    driver.connect(&cfg).await.expect("connect second session");
    driver
}

#[tokio::test]
async fn manual_commit_makes_rows_visible_to_other_sessions() {
    let (container, tx) = start_pg().await;
    let other = connect_pg(&container).await;
    run(tx.as_ref(), "CREATE TABLE acct (id INT PRIMARY KEY, bal INT)").await;

    assert!(tx.supports_transactions());
    assert!(!tx.in_transaction().await);
    tx.begin_transaction(IsolationLevel::Default).await.expect("begin");
    assert!(tx.in_transaction().await);
    run(tx.as_ref(), "INSERT INTO acct VALUES (1, 100)").await;

    // The other session must not see the uncommitted row.
    let before = run(other.as_ref(), "SELECT count(*) FROM acct").await;
    assert_eq!(as_i64(scalar(&before)), 0, "uncommitted row leaked to another session");

    tx.commit_transaction().await.expect("commit");
    assert!(!tx.in_transaction().await);

    // After commit it is visible everywhere.
    let after = run(other.as_ref(), "SELECT count(*) FROM acct").await;
    assert_eq!(as_i64(scalar(&after)), 1);
    let row = run(other.as_ref(), "SELECT bal FROM acct WHERE id = 1").await;
    assert_eq!(as_i64(scalar(&row)), 100);
}

#[tokio::test]
async fn manual_rollback_discards_changes() {
    let (container, tx) = start_pg().await;
    let other = connect_pg(&container).await;
    run(tx.as_ref(), "CREATE TABLE note (id INT)").await;

    tx.begin_transaction(IsolationLevel::Default).await.expect("begin");
    run(tx.as_ref(), "INSERT INTO note VALUES (1), (2)").await;
    // Visible within the same transaction before rollback.
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM note").await)), 2);

    tx.rollback_transaction().await.expect("rollback");
    assert!(!tx.in_transaction().await);

    // Gone for both the owning session and any other session.
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM note").await)), 0);
    assert_eq!(as_i64(scalar(&run(other.as_ref(), "SELECT count(*) FROM note").await)), 0);
}

#[tokio::test]
async fn failed_statement_does_not_abort_manual_transaction() {
    let (_container, tx) = start_pg().await;
    run(tx.as_ref(), "CREATE TABLE acct (id INT PRIMARY KEY, bal INT)").await;
    run(tx.as_ref(), "INSERT INTO acct VALUES (1, 100)").await;

    tx.begin_transaction(IsolationLevel::Default).await.expect("begin");
    run(tx.as_ref(), "INSERT INTO acct VALUES (2, 200)").await;

    // A failing statement (duplicate key) must NOT poison the transaction.
    let err = tx
        .run_query("INSERT INTO acct VALUES (1, 999)", &[], QueryLanguage::Native)
        .await;
    assert!(err.is_err(), "duplicate insert should fail");
    assert!(tx.in_transaction().await, "transaction should remain open after error");

    // The next statement must run cleanly — no "current transaction is aborted".
    run(tx.as_ref(), "INSERT INTO acct VALUES (3, 300)").await;
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM acct").await)), 3);

    tx.commit_transaction().await.expect("commit");
    // The good rows committed; the failed row left no trace.
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM acct").await)), 3);
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT bal FROM acct WHERE id = 1").await)), 100);
}

/// Connect a second, independent session straight to the container (bypassing
/// the engine) so we can observe what is actually committed.
async fn connect_pg_direct(host: &str, port: u16) -> Box<dyn DatabaseDriver> {
    let mut cfg = ConnectionConfig::new("it-postgres-2", DatabaseKind::Postgres);
    cfg.host = host.to_string();
    cfg.port = port;
    cfg.user = "postgres".to_string();
    cfg.password = "postgres".to_string();
    cfg.database = "postgres".to_string();
    let driver = driver_for_kind(DatabaseKind::Postgres).expect("postgres driver");
    driver.connect(&cfg).await.expect("connect to postgres");
    driver
}

/// Replicates the EXACT app path: the SQL editor runs statements through
/// `QueryEngine::run_query`, which lazily opens a manual transaction from the
/// stored `TransactionConfig`. Statements must stay uncommitted (invisible to
/// other sessions) until an explicit commit — running two INSERTs must NOT
/// auto-commit them.
#[tokio::test]
async fn engine_manual_mode_does_not_autocommit_until_commit() {
    let container = Postgres::default()
        .with_tag("18")
        .start()
        .await
        .expect("start postgres container");
    let host = container.get_host().await.expect("container host").to_string();
    let port = container.get_host_port_ipv4(5432).await.expect("container port");

    let mut cfg = ConnectionConfig::new("it-postgres", DatabaseKind::Postgres);
    cfg.host = host.clone();
    cfg.port = port;
    cfg.user = "postgres".to_string();
    cfg.password = "postgres".to_string();
    cfg.database = "postgres".to_string();
    let id = cfg.id;

    let engine = ConnectionEngine::new(tempfile::tempdir().unwrap().path().to_path_buf()).await;
    engine.open_connection(&cfg).await.expect("open connection");
    let query = QueryEngine::new();

    let exec = |sql: &str| {
        let sql = sql.to_string();
        let engine = &engine;
        let query = &query;
        async move {
            query
                .run_query(id, engine, None, sql, vec![], None, None, None, None)
                .await
                .expect("engine run_query")
        }
    };

    // Auto mode (default): create the table and commit it.
    exec("CREATE TABLE acct (id INT PRIMARY KEY, bal INT)").await;

    // Flip to manual, then run two INSERTs through the engine.
    engine
        .set_transaction_config(
            id,
            TransactionConfig { mode: TransactionMode::Manual, isolation: IsolationLevel::Default },
        )
        .await;
    exec("INSERT INTO acct VALUES (1, 100)").await;
    exec("INSERT INTO acct VALUES (2, 200)").await;

    // An independent session must see NOTHING — the rows are uncommitted.
    let other = connect_pg_direct(&host, port).await;
    let before = run(other.as_ref(), "SELECT count(*) FROM acct").await;
    assert_eq!(
        as_i64(scalar(&before)),
        0,
        "manual-mode INSERTs auto-committed before an explicit commit",
    );

    // Explicit commit makes both rows visible everywhere.
    query.commit_transaction(id, &engine, None).await.expect("commit");
    let after = run(other.as_ref(), "SELECT count(*) FROM acct").await;
    assert_eq!(as_i64(scalar(&after)), 2);
}

#[tokio::test]
async fn begin_applies_requested_isolation_level() {
    let (_container, tx) = start_pg().await;
    tx.begin_transaction(IsolationLevel::Serializable).await.expect("begin");
    let lvl = run(tx.as_ref(), "SHOW transaction_isolation").await;
    assert_eq!(as_text(scalar(&lvl)), "serializable");
    tx.commit_transaction().await.expect("commit");

    tx.begin_transaction(IsolationLevel::RepeatableRead).await.expect("begin");
    let lvl = run(tx.as_ref(), "SHOW transaction_isolation").await;
    assert_eq!(as_text(scalar(&lvl)), "repeatable read");
    tx.rollback_transaction().await.expect("rollback");
}

// ── object_definition: reconstructed DDL per object kind ────────────
//
// `object_definition` rebuilds a copy-pasteable `CREATE ...` source for a schema
// object from the Postgres catalog. Each test creates the object through the
// engine, asks the driver for its definition, and asserts on the emitted DDL —
// matching the exact casing/keywords Postgres' `pg_get_*def` server functions
// and the table reconstructor produce.

/// Build a `public`-scoped `ObjectRef` of the given kind and name.
fn obj(kind: SchemaNodeKind, name: &str) -> ObjectRef {
    ObjectRef {
        kind,
        database: None,
        schema: Some("public".to_string()),
        name: name.to_string(),
    }
}

#[tokio::test]
async fn object_definition_table_is_faithful_and_replayable() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    // A parent table the FK can reference.
    run(d, "CREATE TABLE departments (id int PRIMARY KEY, label text)").await;

    // The table under test exercises every constraint flavour plus a secondary
    // index that does NOT back a constraint (so it surfaces as a trailing
    // CREATE INDEX rather than being folded into a constraint clause). The PK
    // is a plain `int` (not `serial`) so the reconstructed DDL has no DEFAULT
    // referencing an owned sequence that DROP TABLE would also remove — keeping
    // the replay below self-contained. The NOT NULL + DEFAULT requirement is
    // covered by the literal default on `status`.
    run(
        d,
        "CREATE TABLE employees ( \
           id        int PRIMARY KEY, \
           email     text NOT NULL UNIQUE, \
           status    text NOT NULL DEFAULT 'active', \
           age       int CHECK (age >= 0), \
           dept_id   int REFERENCES departments (id) \
         )",
    )
    .await;
    run(d, "CREATE INDEX idx_employees_status ON employees (status)").await;

    let ddl = d
        .object_definition(&obj(SchemaNodeKind::Table, "employees"))
        .await
        .expect("table definition");

    // Statement + quoted, schema-qualified name.
    assert!(ddl.contains("CREATE TABLE"), "DDL:\n{ddl}");
    assert!(ddl.contains("\"public\".\"employees\""), "DDL:\n{ddl}");
    // Every column name is present.
    for col in ["\"id\"", "\"email\"", "\"status\"", "\"age\"", "\"dept_id\""] {
        assert!(ddl.contains(col), "missing column {col} in DDL:\n{ddl}");
    }
    // Column modifiers.
    assert!(ddl.contains("NOT NULL"), "DDL:\n{ddl}");
    assert!(ddl.contains("DEFAULT"), "DDL:\n{ddl}");
    // Constraint clauses (as pg_get_constraintdef renders them).
    assert!(ddl.contains("PRIMARY KEY"), "DDL:\n{ddl}");
    assert!(ddl.contains("UNIQUE"), "DDL:\n{ddl}");
    assert!(ddl.contains("CHECK"), "DDL:\n{ddl}");
    assert!(
        ddl.contains("FOREIGN KEY") && ddl.contains("REFERENCES"),
        "DDL:\n{ddl}"
    );
    // The non-constraint index trails as a standalone CREATE INDEX.
    assert!(
        ddl.contains("CREATE INDEX") && ddl.contains("idx_employees_status"),
        "DDL:\n{ddl}"
    );

    // STRONG check: the reconstructed DDL is itself valid SQL. Drop the table
    // (its FK dependency direction is fine — employees references departments,
    // so dropping employees alone is enough) and replay the DDL.
    run(d, "DROP TABLE employees").await;
    assert!(
        driver
            .run_query("SELECT 1 FROM employees", &[], QueryLanguage::Native)
            .await
            .is_err(),
        "table should be gone after DROP"
    );
    // The reconstructed DDL is `CREATE TABLE (...);` followed by a trailing
    // `CREATE INDEX ...;`. The engine's run_query uses the extended protocol,
    // which rejects multiple commands in one call, so replay statement by
    // statement (the table body itself contains no semicolons).
    for stmt in ddl.split(";\n").map(str::trim).filter(|s| !s.is_empty()) {
        run(d, stmt).await;
    }

    // The table exists again — visible to the schema browser and queryable.
    assert!(has_node(
        &schema_tree(d).await,
        "employees",
        SchemaNodeKind::Table
    ));
    let cols = run(d, "SELECT * FROM employees").await;
    assert_eq!(
        col_names(&cols),
        ["id", "email", "status", "age", "dept_id"]
    );
    // The replayed secondary index came back too.
    assert!(has_node(
        &schema_tree(d).await,
        "idx_employees_status",
        SchemaNodeKind::Index
    ));
}

#[tokio::test]
async fn object_definition_view_includes_select_body() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE nums (n int)").await;
    run(d, "CREATE VIEW positives AS SELECT n FROM nums WHERE n > 0").await;

    let ddl = d
        .object_definition(&obj(SchemaNodeKind::View, "positives"))
        .await
        .expect("view definition");

    assert!(ddl.contains("CREATE"), "DDL:\n{ddl}");
    assert!(ddl.contains("VIEW"), "DDL:\n{ddl}");
    assert!(ddl.contains("\"public\".\"positives\""), "DDL:\n{ddl}");
    // The select body is reproduced.
    assert!(ddl.contains("nums"), "DDL:\n{ddl}");
    assert!(ddl.contains("n > 0"), "DDL:\n{ddl}");
}

#[tokio::test]
async fn object_definition_materialized_view_uses_materialized_keyword() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE vals (v int)").await;
    run(
        d,
        "CREATE MATERIALIZED VIEW val_total AS SELECT sum(v) AS total FROM vals",
    )
    .await;

    let ddl = d
        .object_definition(&obj(SchemaNodeKind::MaterializedView, "val_total"))
        .await
        .expect("materialized view definition");

    assert!(ddl.contains("MATERIALIZED VIEW"), "DDL:\n{ddl}");
    assert!(ddl.contains("\"public\".\"val_total\""), "DDL:\n{ddl}");
    // pg_get_viewdef qualifies the column (e.g. `sum(vals.v)`), so assert on the
    // aggregate + source table + alias rather than the unqualified expression.
    assert!(ddl.contains("sum("), "DDL:\n{ddl}");
    assert!(ddl.contains("vals"), "DDL:\n{ddl}");
    assert!(ddl.contains("total"), "DDL:\n{ddl}");
}

#[tokio::test]
async fn object_definition_sequence_renders_start_and_increment() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    run(d, "CREATE SEQUENCE ticket_seq START 100 INCREMENT 5").await;

    let ddl = d
        .object_definition(&obj(SchemaNodeKind::Sequence, "ticket_seq"))
        .await
        .expect("sequence definition");

    assert!(ddl.contains("CREATE SEQUENCE"), "DDL:\n{ddl}");
    assert!(ddl.contains("\"public\".\"ticket_seq\""), "DDL:\n{ddl}");
    // The reconstructor emits `START WITH` / `INCREMENT BY` with the values.
    assert!(ddl.contains("START"), "DDL:\n{ddl}");
    assert!(ddl.contains("START WITH 100"), "DDL:\n{ddl}");
    assert!(ddl.contains("INCREMENT"), "DDL:\n{ddl}");
    assert!(ddl.contains("INCREMENT BY 5"), "DDL:\n{ddl}");
}

#[tokio::test]
async fn object_definition_index_includes_on_clause() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE catalog_items (id int, sku text)").await;
    run(
        d,
        "CREATE UNIQUE INDEX idx_catalog_sku ON catalog_items (sku)",
    )
    .await;

    let ddl = d
        .object_definition(&obj(SchemaNodeKind::Index, "idx_catalog_sku"))
        .await
        .expect("index definition");

    // pg_get_indexdef preserves UNIQUE and the ON <table> clause.
    assert!(ddl.contains("CREATE UNIQUE INDEX"), "DDL:\n{ddl}");
    assert!(ddl.contains("idx_catalog_sku"), "DDL:\n{ddl}");
    assert!(ddl.contains(" ON "), "DDL:\n{ddl}");
    assert!(ddl.contains("catalog_items"), "DDL:\n{ddl}");
}

#[tokio::test]
async fn object_definition_function_reconstructs_create() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE FUNCTION greet(who text) RETURNS text LANGUAGE plpgsql AS $$ \
         BEGIN RETURN 'hi ' || who; END; $$",
    )
    .await;

    let ddl = d
        .object_definition(&obj(SchemaNodeKind::Function, "greet"))
        .await
        .expect("function definition");

    // pg_get_functiondef emits `CREATE OR REPLACE FUNCTION <schema>.greet(...)`.
    assert!(ddl.contains("CREATE"), "DDL:\n{ddl}");
    assert!(ddl.contains("FUNCTION"), "DDL:\n{ddl}");
    assert!(ddl.contains("greet"), "DDL:\n{ddl}");
    assert!(ddl.contains("plpgsql"), "DDL:\n{ddl}");
}

#[tokio::test]
async fn object_definition_trigger_reconstructs_create() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE watched (id int, v int)").await;
    run(
        d,
        "CREATE FUNCTION touch_row() RETURNS trigger LANGUAGE plpgsql AS $$ \
         BEGIN RETURN NEW; END; $$",
    )
    .await;
    run(
        d,
        "CREATE TRIGGER trg_touch BEFORE UPDATE ON watched \
         FOR EACH ROW EXECUTE FUNCTION touch_row()",
    )
    .await;

    let ddl = d
        .object_definition(&obj(SchemaNodeKind::Trigger, "trg_touch"))
        .await
        .expect("trigger definition");

    // pg_get_triggerdef emits `CREATE TRIGGER trg_touch ... ON ... watched`.
    assert!(ddl.contains("CREATE"), "DDL:\n{ddl}");
    assert!(ddl.contains("TRIGGER"), "DDL:\n{ddl}");
    assert!(ddl.contains("trg_touch"), "DDL:\n{ddl}");
    assert!(ddl.contains("watched"), "DDL:\n{ddl}");
}

#[tokio::test]
async fn object_definition_missing_object_errors() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    // No such table exists — the driver must surface an error, not empty DDL.
    let res = d
        .object_definition(&obj(SchemaNodeKind::Table, "does_not_exist"))
        .await;
    assert!(
        res.is_err(),
        "expected Err for a non-existent object, got: {res:?}"
    );
}

#[tokio::test]
async fn object_definition_schema_is_faithful_and_replayable() {
    let (_pg, driver) = start_pg().await;
    let d = driver.as_ref();

    // A schema with a comment and an explicit grant exercises every clause the
    // reconstructor emits: CREATE / COMMENT / ALTER OWNER / GRANT.
    run(d, "CREATE SCHEMA reporting").await;
    run(d, "COMMENT ON SCHEMA reporting IS 'analytics schema'").await;
    run(d, "GRANT USAGE ON SCHEMA reporting TO PUBLIC").await;

    // A schema node identifies itself by `name`; the `schema` qualifier (which
    // the frontend fills with the database) is irrelevant here.
    let schema_ref = ObjectRef {
        kind: SchemaNodeKind::Schema,
        database: None,
        schema: None,
        name: "reporting".to_string(),
    };
    let ddl = d
        .object_definition(&schema_ref)
        .await
        .expect("schema definition");

    assert!(ddl.contains("CREATE SCHEMA \"reporting\";"), "DDL:\n{ddl}");
    assert!(
        ddl.contains("COMMENT ON SCHEMA \"reporting\" IS 'analytics schema';"),
        "DDL:\n{ddl}"
    );
    assert!(
        ddl.contains("ALTER SCHEMA \"reporting\" OWNER TO "),
        "DDL:\n{ddl}"
    );
    assert!(
        ddl.contains("GRANT USAGE ON SCHEMA \"reporting\" TO PUBLIC;"),
        "DDL:\n{ddl}"
    );

    // STRONG check: the reconstructed DDL replays cleanly. Drop and recreate it
    // statement by statement (the engine's extended protocol rejects multiple
    // commands per call).
    run(d, "DROP SCHEMA reporting CASCADE").await;
    for stmt in ddl.split(";\n").map(str::trim).filter(|s| !s.is_empty()) {
        run(d, stmt.trim_end_matches(';')).await;
    }

    // The schema is back — visible to the schema browser.
    assert!(has_node(
        &schema_tree(d).await,
        "reporting",
        SchemaNodeKind::Schema
    ));
}

// ── streaming ingestion (canvas path) ───────────────────────────────────────

static STREAM_DIR_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// A canvas engine over a throwaway cell cache (1 GiB memory / 10 GiB total).
fn canvas_engine() -> CanvasEngine {
    let n = STREAM_DIR_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir =
        std::env::temp_dir().join(format!("arris-pg-stream-{}-{}", std::process::id(), n));
    let cache = CellResultCache::new(dir, 1 << 30, 10 * (1 << 30));
    CanvasEngine::new(std::sync::Arc::new(cache))
}

const BOARD: &str = "board-stream";

#[tokio::test]
async fn streaming_ingests_100k_rows_with_exact_totals_and_page() {
    let (_container, driver) = start_pg().await;
    let engine = canvas_engine();

    let stream = driver
        .run_query_stream(
            "SELECT n, 'row-' || n AS label FROM generate_series(1, 100000) AS n",
            &[],
            QueryLanguage::Native,
        )
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
    assert_eq!(out.result.columns[0].type_hint, "int4");
    assert_eq!(out.result.columns[1].type_hint, "text");
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
    let (_container, driver) = start_pg().await;
    let engine = canvas_engine();

    // Large enough that the stream is still running when the cancel fires.
    let stream = driver
        .run_query_stream(
            "SELECT n FROM generate_series(1, 100000000) AS n",
            &[],
            QueryLanguage::Native,
        )
        .await
        .expect("open stream");

    let token = CancellationToken::new();
    let canceller = token.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        canceller.cancel();
    });

    let err = engine
        .ingest_cell_stream(BOARD, "huge", stream, Some(&token), CELL_INGEST_BYTE_BUDGET, None)
        .await
        .expect_err("cancel must fail the ingest");
    assert!(matches!(err, CanvasError::Cancelled), "got {err:?}");
    // Mirror the app's cancel path: the driver-level kill also fires.
    driver.cancel_running_query().await.expect("pg cancel request");

    // The aborted cell was never registered, so downstream cannot read it.
    let chained = engine.run_cell(BOARD, "agg", "SELECT COUNT(*) FROM huge").await;
    assert!(chained.is_err(), "cancelled cell must not be queryable");
}

#[tokio::test]
async fn streaming_byte_budget_truncates_and_reports_incomplete() {
    let (_container, driver) = start_pg().await;
    let engine = canvas_engine();

    let stream = driver
        .run_query_stream(
            "SELECT n FROM generate_series(1, 1000000) AS n",
            &[],
            QueryLanguage::Native,
        )
        .await
        .expect("open stream");
    // A ~1 MiB budget admits a handful of 8k-row chunks, then stops.
    let out = engine
        .ingest_cell_stream(BOARD, "capped", stream, None, 1 << 20, None)
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

#[tokio::test]
async fn streaming_cell_limit_wraps_sql_and_caps_to_500() {
    let (_container, driver) = start_pg().await;
    let engine = canvas_engine();

    // Postgres wraps via SubqueryOffset, so the database itself stops at 500
    // and no ingest-side row cap is needed.
    let (sql, row_cap) = QueryEngine::apply_cell_limit(
        "SELECT n FROM generate_series(1, 100000) AS n ORDER BY n",
        &driver.pagination_strategy(),
        Some(500),
    );
    assert!(sql.contains("LIMIT 500"), "wrapped SQL:\n{sql}");
    assert_eq!(row_cap, None);

    let stream = driver
        .run_query_stream(&sql, &[], QueryLanguage::Native)
        .await
        .expect("open stream");
    let out = engine
        .ingest_cell_stream(BOARD, "lim", stream, None, 1 << 30, row_cap)
        .await
        .expect("ingest stream");

    assert_eq!(out.total_rows, 500);
    assert!(out.complete, "a LIMIT-capped run is a complete result");
    assert_eq!(out.result.rows.len(), 500);
    assert_eq!(out.result.rows[0][0], QueryValue::Int(1));
    assert_eq!(out.result.rows[499][0], QueryValue::Int(500));
}

#[tokio::test]
async fn streaming_cell_row_cap_stops_ingest_at_500_in_order() {
    let (_container, driver) = start_pg().await;
    let engine = canvas_engine();

    // The ingest-side fallback (used for dialects that cannot be wrapped):
    // the stream is opened un-limited and the engine stops after 500 rows.
    let stream = driver
        .run_query_stream(
            "SELECT n FROM generate_series(1, 100000) AS n ORDER BY n",
            &[],
            QueryLanguage::Native,
        )
        .await
        .expect("open stream");
    let out = engine
        .ingest_cell_stream(BOARD, "capped500", stream, None, 1 << 30, Some(500))
        .await
        .expect("ingest stream");

    assert_eq!(out.total_rows, 500);
    assert!(out.complete, "a row-cap stop is the requested result, not a truncation");
    assert_eq!(out.result.rows[0][0], QueryValue::Int(1));
    assert_eq!(out.result.rows[499][0], QueryValue::Int(500));
    let agg = engine
        .run_cell(BOARD, "agg500", "SELECT COUNT(*) AS c FROM capped500")
        .await
        .expect("chained count");
    assert_eq!(agg.result.rows[0][0], QueryValue::Int(500));
}

#[tokio::test]
async fn streaming_select_all_ingests_full_result() {
    let (_container, driver) = start_pg().await;
    let engine = canvas_engine();

    // "Select all rows": no limit, no cap; the full result lands in the cache.
    let (sql, row_cap) = QueryEngine::apply_cell_limit(
        "SELECT n FROM generate_series(1, 100000) AS n",
        &driver.pagination_strategy(),
        None,
    );
    assert_eq!(row_cap, None);

    let stream = driver
        .run_query_stream(&sql, &[], QueryLanguage::Native)
        .await
        .expect("open stream");
    let out = engine
        .ingest_cell_stream(BOARD, "all", stream, None, 1 << 30, row_cap)
        .await
        .expect("ingest stream");

    assert_eq!(out.total_rows, 100_000);
    assert!(out.complete);
    assert_eq!(out.result.rows.len(), CELL_RESULT_PAGE_ROWS);
}

#[tokio::test]
async fn streaming_early_page_then_background_finish_reports_totals() {
    let (_container, driver) = start_pg().await;
    let engine = canvas_engine();

    // The terminal-cell path: the page returns as soon as it fills, the
    // continuation drains the rest, and the totals cover the whole result.
    let stream = driver
        .run_query_stream(
            "SELECT n FROM generate_series(1, 100000) AS n",
            &[],
            QueryLanguage::Native,
        )
        .await
        .expect("open stream");
    let (page, cont) = engine
        .start_cell_ingest(BOARD, "early", stream, None, 1 << 30, None)
        .await
        .expect("start ingest");
    assert_eq!(page.rows.len(), CELL_RESULT_PAGE_ROWS);
    assert_eq!(page.rows[0][0], QueryValue::Int(1));

    let done = cont.finish(None).await.expect("background finish");
    assert_eq!(done.total_rows, 100_000);
    assert!(done.complete);

    // The finished cache entry serves the full result to chained cells.
    let agg = engine
        .run_cell(BOARD, "aggearly", "SELECT COUNT(*) AS c FROM early")
        .await
        .expect("chained count");
    assert_eq!(agg.result.rows[0][0], QueryValue::Int(100_000));
}
