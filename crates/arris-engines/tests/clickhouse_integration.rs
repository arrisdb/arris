//! Integration tests for the ClickHouse driver against a real
//! `clickhouse/clickhouse-server` instance started via `testcontainers`.
//! Queries run through the engine's `DatabaseDriver` trait (the same path the
//! app uses), and the returned `QueryResult` / `PlanResult` / `SchemaNode` tree
//! is asserted.
//!
//! Requires Docker. Run with:
//!   `cargo test -p arris-engines --test clickhouse_integration`
//! Each test owns its own container, so they are independent and parallel-safe.
//!
//! ClickHouse semantics worth noting for these tests:
//! - The HTTP interface does not report affected-row counts, so `run_query`
//!   leaves `rows_affected` as `None`; we assert effects via follow-up `SELECT`s.
//! - `UPDATE`/`DELETE` are asynchronous mutations; the driver issues them as
//!   `ALTER TABLE … SETTINGS mutations_sync = 2` so they complete before return.
//! - There is no `LAG`/`LEAD`; the window equivalents are `lagInFrame` /
//!   `leadInFrame`, and out-of-frame rows yield the column default (not NULL).

use arris_engines::{
    ConnectionConfig, DatabaseDriver, DatabaseKind, ExplainMode, QueryLanguage, QueryResult,
    QueryValue, SchemaNode, SchemaNodeKind, TableRef, driver_for_kind,
};
use testcontainers_modules::clickhouse::ClickHouse;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ImageExt};

// ── harness ─────────────────────────────────────────────────────────────────

/// Boot a fresh ClickHouse container (tag pinned to match `docker-compose.yml`)
/// and return a connected driver plus the mapped host/port for opening extra
/// connections (used by the access-control test). The container guard must be
/// kept alive for the duration of the test.
async fn start_clickhouse() -> (ContainerAsync<ClickHouse>, Box<dyn DatabaseDriver>, String, u16) {
    let container = ClickHouse::default()
        .with_tag("25.3")
        // Enable SQL-driven access management for the default user so the
        // access-control test can CREATE USER / ROLE and GRANT/REVOKE.
        .with_env_var("CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT", "1")
        .start()
        .await
        .expect("start clickhouse container");
    let host = container.get_host().await.expect("container host").to_string();
    let port = container
        .get_host_port_ipv4(8123)
        .await
        .expect("container port");

    let driver = connect_as(&host, port, "default", "").await;
    (container, driver, host, port)
}

/// Open a new driver connection to the container as the given user.
async fn connect_as(host: &str, port: u16, user: &str, password: &str) -> Box<dyn DatabaseDriver> {
    let mut cfg = ConnectionConfig::new("it-clickhouse", DatabaseKind::Clickhouse);
    cfg.host = host.to_string();
    cfg.port = port;
    cfg.user = user.to_string();
    cfg.password = password.to_string();
    cfg.database = "default".to_string();

    let driver = driver_for_kind(DatabaseKind::Clickhouse).expect("clickhouse driver");
    driver.connect(&cfg).await.expect("connect to clickhouse");
    driver
}

async fn run(driver: &dyn DatabaseDriver, sql: &str) -> QueryResult {
    driver
        .run_query(sql, &[], QueryLanguage::Native)
        .await
        .unwrap_or_else(|e| panic!("query failed: {sql}\n  error: {e:?}"))
}

/// Run a statement and assert it fails (negative-case helper).
async fn run_err(driver: &dyn DatabaseDriver, sql: &str) {
    let res = driver.run_query(sql, &[], QueryLanguage::Native).await;
    assert!(res.is_err(), "expected error for: {sql}, got {res:?}");
}

/// Scalar `i64` from the first cell of the first row.
async fn count(driver: &dyn DatabaseDriver, sql: &str) -> i64 {
    as_i64(scalar(&run(driver, sql).await))
}

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
    // Lazy split: list_schemas returns containers only; load the default database's objects
    // too so object-level has_node assertions still find them.
    let mut tree = driver.list_schemas().await.expect("list_schemas");
    tree.extend(driver.list_schema("default").await.expect("list_schema"));
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
async fn crud_insert_select_update_delete() {
    let (_ch, driver, _h, _p) = start_clickhouse().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE users (id UInt64, name String, age Int32) ENGINE = MergeTree ORDER BY id",
    )
    .await;

    // Multi-row insert. ClickHouse HTTP reports no affected count, so we verify
    // via a follow-up count rather than rows_affected.
    run(
        d,
        "INSERT INTO users (id, name, age) VALUES (1,'alice',30),(2,'bob',25),(3,'carol',40)",
    )
    .await;
    assert_eq!(count(d, "SELECT count() FROM users").await, 3);

    // SELECT with filter / ORDER BY / LIMIT — assert column names, types, rows.
    let top = run(
        d,
        "SELECT name, age FROM users WHERE age >= 25 ORDER BY age DESC LIMIT 2",
    )
    .await;
    assert_eq!(col_names(&top), ["name", "age"]);
    assert_eq!(col_type(&top, "name"), "String");
    assert_eq!(col_type(&top, "age"), "Int32");
    assert_eq!(top.rows.len(), 2);
    assert_eq!(as_text(&top.rows[0][0]), "carol");
    assert_eq!(as_i64(&top.rows[0][1]), 40);
    assert_eq!(as_text(&top.rows[1][0]), "alice");

    // JOIN.
    run(
        d,
        "CREATE TABLE orders (id UInt64, user_id UInt64, amount Int32) ENGINE = MergeTree ORDER BY id",
    )
    .await;
    run(
        d,
        "INSERT INTO orders SELECT 1, id, 100 FROM users WHERE name = 'alice'",
    )
    .await; // INSERT ... SELECT
    let joined = run(
        d,
        "SELECT u.name, o.amount FROM users u JOIN orders o ON o.user_id = u.id",
    )
    .await;
    assert_eq!(joined.rows.len(), 1);
    assert_eq!(as_text(&joined.rows[0][0]), "alice");
    assert_eq!(as_i64(&joined.rows[0][1]), 100);

    // UPDATE via synchronous mutation.
    run(
        d,
        "ALTER TABLE users UPDATE age = 31 WHERE name = 'alice' SETTINGS mutations_sync = 2",
    )
    .await;
    assert_eq!(
        count(d, "SELECT age FROM users WHERE name = 'alice'").await,
        31
    );

    // DELETE via synchronous mutation.
    run(
        d,
        "ALTER TABLE users DELETE WHERE name = 'bob' SETTINGS mutations_sync = 2",
    )
    .await;
    assert_eq!(count(d, "SELECT count() FROM users").await, 2);
}

// ── window / analytic functions ──────────────────────────────────────────────

#[tokio::test]
async fn window_functions() {
    let (_ch, driver, _h, _p) = start_clickhouse().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE sales (region String, amount Int32) ENGINE = Memory").await;
    run(
        d,
        "INSERT INTO sales VALUES ('east',10),('east',20),('east',30),('west',40),('west',50)",
    )
    .await;

    // ClickHouse uses lagInFrame/leadInFrame; out-of-frame rows return the
    // column default (0 here), not NULL.
    let r = run(
        d,
        "SELECT region, amount, \
           row_number() OVER (PARTITION BY region ORDER BY amount DESC) AS rn, \
           rank() OVER (ORDER BY amount DESC) AS rnk, \
           lagInFrame(amount) OVER (ORDER BY amount ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS prev, \
           leadInFrame(amount) OVER (ORDER BY amount ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS nxt, \
           sum(amount) OVER (PARTITION BY region ORDER BY amount ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running \
         FROM sales ORDER BY amount",
    )
    .await;
    assert_eq!(r.rows.len(), 5);
    let first = &r.rows[0];
    assert_eq!(as_i64(&first[1]), 10); // amount
    assert_eq!(as_i64(&first[2]), 3); // row_number within east DESC
    assert_eq!(as_i64(&first[3]), 5); // global rank DESC
    assert_eq!(as_i64(&first[4]), 0); // lagInFrame default for first row
    assert_eq!(as_i64(&first[5]), 20); // leadInFrame
    assert_eq!(as_i64(&first[6]), 10); // running sum, first east row
}

// ── ClickHouse-specific types & syntax ───────────────────────────────────────

#[tokio::test]
async fn arrays_maps_tuples_enums_lowcardinality() {
    let (_ch, driver, _h, _p) = start_clickhouse().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE feats ( \
           id UInt64, \
           tags Array(String), \
           attrs Map(String, Int32), \
           pair Tuple(Int32, String), \
           status Enum8('active' = 1, 'inactive' = 2), \
           cat LowCardinality(String) \
         ) ENGINE = MergeTree ORDER BY id",
    )
    .await;
    run(
        d,
        "INSERT INTO feats VALUES (1, ['a','b'], {'x':10}, (5,'hi'), 'active', 'gold')",
    )
    .await;

    let r = run(d, "SELECT id, tags, attrs, pair, status, cat FROM feats").await;
    assert_eq!(r.rows.len(), 1);
    let row = &r.rows[0];
    // Composite types are preserved as JSON; scalars decode to their variants.
    assert_eq!(col_type(&r, "tags"), "Array(String)");
    assert_eq!(as_i64(&row[0]), 1);
    assert_eq!(as_json(&row[1]), "[\"a\",\"b\"]");
    assert_eq!(as_json(&row[2]), "{\"x\":10}");
    assert_eq!(as_json(&row[3]), "[5,\"hi\"]");
    assert_eq!(as_text(&row[4]), "active"); // Enum surfaces its name
    assert_eq!(as_text(&row[5]), "gold"); // LowCardinality(String) → text
}

#[tokio::test]
async fn array_join_and_group_array() {
    let (_ch, driver, _h, _p) = start_clickhouse().await;
    let d = driver.as_ref();

    // arrayJoin unnests an array into rows.
    let aj = run(d, "SELECT arrayJoin([10, 20, 30]) AS x ORDER BY x").await;
    assert_eq!(aj.rows.len(), 3);
    assert_eq!(as_i64(&aj.rows[0][0]), 10);
    assert_eq!(as_i64(&aj.rows[2][0]), 30);

    // groupArray aggregates rows back into an array (JSON-preserved). Cast to
    // Int32 — ClickHouse renders 64-bit ints as quoted strings in JSON.
    let ga = run(d, "SELECT groupArray(toInt32(number)) AS xs FROM numbers(3)").await;
    assert_eq!(as_json(&ga.rows[0][0]), "[0,1,2]");
}

#[tokio::test]
async fn aggregate_function_state_merge() {
    let (_ch, driver, _h, _p) = start_clickhouse().await;
    let d = driver.as_ref();

    // AggregatingMergeTree stores partial aggregate state via -State combinators;
    // -Merge finalizes it on read.
    run(
        d,
        "CREATE TABLE agg (k String, s AggregateFunction(sum, UInt64)) \
         ENGINE = AggregatingMergeTree ORDER BY k",
    )
    .await;
    run(
        d,
        "INSERT INTO agg SELECT 'a', sumState(toUInt64(number)) FROM numbers(5)",
    )
    .await;

    let merged = run(d, "SELECT k, sumMerge(s) AS total FROM agg GROUP BY k").await;
    assert_eq!(merged.rows.len(), 1);
    assert_eq!(as_text(&merged.rows[0][0]), "a");
    assert_eq!(as_i64(&merged.rows[0][1]), 10); // 0+1+2+3+4
}

#[tokio::test]
async fn replacing_mergetree_final() {
    let (_ch, driver, _h, _p) = start_clickhouse().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE rmt (id UInt64, v String, ver UInt64) \
         ENGINE = ReplacingMergeTree(ver) ORDER BY id",
    )
    .await;
    run(d, "INSERT INTO rmt VALUES (1, 'old', 1)").await;
    run(d, "INSERT INTO rmt VALUES (1, 'new', 2)").await;

    // FINAL collapses to the highest-version row per key.
    let r = run(d, "SELECT v FROM rmt FINAL").await;
    assert_eq!(r.rows.len(), 1);
    assert_eq!(as_text(&r.rows[0][0]), "new");
}

// ── schema-object lifecycle ──────────────────────────────────────────────────

#[tokio::test]
async fn schema_object_lifecycle() {
    let (_ch, driver, _h, _p) = start_clickhouse().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE employees (id UInt64, name String, dept String, salary Int32) \
         ENGINE = MergeTree ORDER BY id",
    )
    .await;
    run(
        d,
        "INSERT INTO employees VALUES (1,'a','eng',150),(2,'b','eng',90),(3,'c','sales',120)",
    )
    .await;

    // View.
    run(
        d,
        "CREATE VIEW high_earners AS SELECT id, name, salary FROM employees WHERE salary >= 100",
    )
    .await;
    let v = run(d, "SELECT * FROM high_earners ORDER BY salary DESC").await;
    assert_eq!(col_names(&v), ["id", "name", "salary"]);
    assert_eq!(col_type(&v, "salary"), "Int32");
    assert_eq!(v.rows.len(), 2);
    assert_eq!(as_text(&v.rows[0][1]), "a");

    // Materialized view.
    run(
        d,
        "CREATE MATERIALIZED VIEW dept_totals \
         ENGINE = SummingMergeTree ORDER BY dept \
         AS SELECT dept, sum(salary) AS total FROM employees GROUP BY dept",
    )
    .await;

    // Dictionary (sourced from a ClickHouse table).
    run(
        d,
        "CREATE TABLE dict_src (id UInt64, label String) ENGINE = MergeTree ORDER BY id",
    )
    .await;
    run(d, "INSERT INTO dict_src VALUES (1, 'one'), (2, 'two')").await;
    run(
        d,
        "CREATE DICTIONARY labels (id UInt64, label String) \
         PRIMARY KEY id \
         SOURCE(CLICKHOUSE(TABLE 'dict_src' DB 'default')) \
         LAYOUT(FLAT()) LIFETIME(0)",
    )
    .await;
    assert_eq!(
        as_text(scalar(
            &run(d, "SELECT dictGet('default.labels', 'label', toUInt64(2))").await
        )),
        "two"
    );

    // Schema browser surfaces each object with the right kind.
    let tree = schema_tree(d).await;
    assert!(has_node(&tree, "default", SchemaNodeKind::Database));
    assert!(has_node(&tree, "employees", SchemaNodeKind::Table));
    assert!(has_node(&tree, "high_earners", SchemaNodeKind::View));
    assert!(has_node(&tree, "dept_totals", SchemaNodeKind::MaterializedView));
    // Dictionaries browse as tables (no dedicated SchemaNodeKind).
    assert!(has_node(&tree, "labels", SchemaNodeKind::Table));

    // Columns appear beneath their table.
    assert!(has_node(&tree, "salary", SchemaNodeKind::Column));

    // Drop → object can no longer be queried and leaves the schema tree.
    run(d, "DROP VIEW high_earners").await;
    run_err(d, "SELECT * FROM high_earners").await;
    assert!(!has_node(
        &schema_tree(d).await,
        "high_earners",
        SchemaNodeKind::View
    ));
}

#[tokio::test]
async fn primary_key_and_explain_use_index() {
    let (_ch, driver, _h, _p) = start_clickhouse().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE ex (id UInt64, v String) ENGINE = MergeTree ORDER BY id",
    )
    .await;
    run(d, "INSERT INTO ex SELECT number, toString(number) FROM numbers(1000)").await;

    // primary_key reflects the MergeTree ORDER BY key.
    let pk = d
        .primary_key(&TableRef::new("ex"))
        .await
        .expect("primary_key");
    assert_eq!(pk, Some(vec!["id".to_string()]));

    // EXPLAIN walks into a plan tree and the planner reads from MergeTree using
    // the primary-key index for the point lookup.
    let plan = d
        .explain_query("SELECT * FROM ex WHERE id = 42", &[], QueryLanguage::Native, ExplainMode::DryRun)
        .await
        .expect("explain_query");
    assert!(!plan.root.node_type.is_empty());
    assert!(
        plan.raw.contains("ReadFromMergeTree"),
        "expected MergeTree read in plan, got: {}",
        plan.raw
    );
}

// ── access control ───────────────────────────────────────────────────────────

#[tokio::test]
async fn access_control_grant_revoke() {
    let (_ch, driver, host, port) = start_clickhouse().await;
    let admin = driver.as_ref();

    run(admin, "CREATE TABLE secrets (id UInt64, v String) ENGINE = MergeTree ORDER BY id").await;
    run(admin, "INSERT INTO secrets VALUES (1, 'classified')").await;

    // Create a role + user, grant SELECT through the role.
    run(admin, "CREATE ROLE reader").await;
    run(admin, "GRANT SELECT ON default.secrets TO reader").await;
    run(
        admin,
        "CREATE USER analyst IDENTIFIED WITH plaintext_password BY 'secret'",
    )
    .await;
    run(admin, "GRANT reader TO analyst").await;
    run(admin, "SET DEFAULT ROLE reader TO analyst").await;

    // Positive: the analyst can read the table.
    let analyst = connect_as(&host, port, "analyst", "secret").await;
    assert_eq!(count(analyst.as_ref(), "SELECT count() FROM default.secrets").await, 1);

    // Negative: a table the role was never granted is denied.
    run(admin, "CREATE TABLE other (id UInt64) ENGINE = MergeTree ORDER BY id").await;
    run_err(analyst.as_ref(), "SELECT * FROM default.other").await;

    // Revoke → the previously-allowed read is now denied (same connection, since
    // each HTTP request re-checks grants).
    run(admin, "REVOKE SELECT ON default.secrets FROM reader").await;
    run_err(analyst.as_ref(), "SELECT * FROM default.secrets").await;

    // ALTER + DROP the principals.
    run(admin, "ALTER USER analyst IDENTIFIED WITH plaintext_password BY 'rotated'").await;
    run(admin, "DROP USER analyst").await;
    run(admin, "DROP ROLE reader").await;
    // The dropped user can no longer authenticate.
    let mut cfg = ConnectionConfig::new("it-clickhouse", DatabaseKind::Clickhouse);
    cfg.host = host;
    cfg.port = port;
    cfg.user = "analyst".to_string();
    cfg.password = "rotated".to_string();
    cfg.database = "default".to_string();
    let dropped = driver_for_kind(DatabaseKind::Clickhouse).expect("clickhouse driver");
    assert!(dropped.connect(&cfg).await.is_err(), "dropped user should not connect");
}

mod dbt_diff_scenario;

/// dbt slim-diff (`Backtick` dialect: `EXCEPT DISTINCT`/`INTERSECT DISTINCT`,
/// backtick quoting, `LIMIT`) end-to-end against a real ClickHouse instance.
/// BigQuery shares this dialect. See `dbt_diff_scenario` for the data set.
#[tokio::test]
async fn slim_diff_keyless_and_keyed() {
    use arris_engines::dbt::DiffDialect;

    let (_c, driver, ..) = start_clickhouse().await;
    run(
        driver.as_ref(),
        "CREATE TABLE diff_prod (id Int32, amount Int32) ENGINE = Memory",
    )
    .await;
    run(
        driver.as_ref(),
        "INSERT INTO diff_prod (id, amount) VALUES (1, 100), (2, 200), (3, 300)",
    )
    .await;

    let prod = "`diff_prod`";
    // Cast literals to Int32 so `EXCEPT DISTINCT` sees matching column types.
    let new_select = "SELECT toInt32(2) AS id, toInt32(200) AS amount \
         UNION ALL SELECT toInt32(3), toInt32(333) \
         UNION ALL SELECT toInt32(4), toInt32(400)";

    dbt_diff_scenario::assert_keyless(driver.as_ref(), DiffDialect::Backtick, prod, new_select).await;
    dbt_diff_scenario::assert_keyed(driver.as_ref(), DiffDialect::Backtick, prod, new_select).await;
}

// ── streaming ingestion (canvas path) ───────────────────────────────────────

mod streaming_scenario;
use streaming_scenario::BOARD;

use arris_engines::{
    CanvasEngine, CanvasError, QueryEngine, CELL_INGEST_BYTE_BUDGET, CELL_RESULT_PAGE_ROWS,
};
use tokio_util::sync::CancellationToken;

fn canvas_engine() -> CanvasEngine {
    streaming_scenario::canvas_engine("clickhouse")
}

/// Seed `src(n UInt64, label String)` with rows 1..=count via `numbers`.
async fn seed_numbers(driver: &dyn DatabaseDriver, count: u64) {
    run(driver, "CREATE TABLE src (n UInt64, label String) ENGINE = MergeTree ORDER BY n").await;
    run(
        driver,
        &format!(
            "INSERT INTO src SELECT number + 1, concat('row-', toString(number + 1)) \
             FROM numbers({count})"
        ),
    )
    .await;
}

#[tokio::test]
async fn streaming_ingests_100k_rows_with_exact_totals_and_page() {
    let (_c, driver, ..) = start_clickhouse().await;
    seed_numbers(driver.as_ref(), 100_000).await;
    let engine = canvas_engine();

    let stream = driver
        .run_query_stream("SELECT n, label FROM src ORDER BY n", &[], QueryLanguage::Native)
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
    assert_eq!(out.result.columns[0].type_hint, "UInt64");
    assert_eq!(out.result.columns[1].type_hint, "String");
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
    let (_c, driver, ..) = start_clickhouse().await;
    seed_numbers(driver.as_ref(), 1_000_000).await;
    let engine = canvas_engine();

    let stream = driver
        .run_query_stream("SELECT n FROM src", &[], QueryLanguage::Native)
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

    // Dropping the aborted stream leaves the HTTP client healthy for new queries.
    let r = driver
        .run_query("SELECT 1", &[], QueryLanguage::Native)
        .await
        .expect("query after cancel");
    assert_eq!(r.rows[0][0], QueryValue::Int(1));
}

#[tokio::test]
async fn streaming_byte_budget_truncates_and_reports_incomplete() {
    let (_c, driver, ..) = start_clickhouse().await;
    seed_numbers(driver.as_ref(), 1_000_000).await;
    let engine = canvas_engine();

    let stream = driver
        .run_query_stream("SELECT n FROM src ORDER BY n", &[], QueryLanguage::Native)
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
    let (_c, driver, ..) = start_clickhouse().await;
    seed_numbers(driver.as_ref(), 10_000).await;
    let engine = canvas_engine();

    // ClickHouse wraps via SubqueryOffset, so the database itself stops at 500
    // and no ingest-side row cap is needed.
    let (sql, row_cap) = QueryEngine::apply_cell_limit(
        "SELECT n FROM src ORDER BY n",
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
