//! Integration tests for the StarRocks driver against a real
//! `starrocks/allin1-ubuntu` instance (one FE + one BE) started via
//! `testcontainers`. Queries run through the engine's
//! `DatabaseDriver::run_query` / `explain_query` / `list_schemas` /
//! `list_schema` (the same paths the app uses), and the returned `QueryResult` /
//! `PlanResult` / `SchemaNode` tree is asserted.
//!
//! Requires Docker. Run with:
//!   `cargo test -p arris-engines --test starrocks_integration`
//!
//! StarRocks speaks the MySQL wire protocol on the FE query port 9030. There is
//! no `testcontainers-modules` module for StarRocks, so the harness uses a
//! `GenericImage` and gates readiness on a `SELECT 1` poll (the all-in-one image
//! boots the FE then registers the BE, which takes ~30-90 s; no single ready log
//! line is reliable, so polling the MySQL endpoint is the robust signal).
//!
//! The all-in-one image is heavyweight and slow to boot, so (like the Oracle
//! suite) related behaviour is grouped per container rather than one container
//! per assertion: `crud_window_and_dialect`, `schema_object_lifecycle`, and
//! `access_control` each own one container and are independent / parallel-safe.
//!
//! StarRocks specifics that shape the assertions:
//! * Sample tables use the Primary Key model so `UPDATE` / `DELETE` work
//!   (Duplicate / Aggregate tables do not support row `UPDATE`).
//! * `replication_num = 1` for the single-BE container; `BUCKETS` is omitted
//!   (auto-assigned).
//! * `COUNT(*)` returns `BIGINT` -> `QueryValue::Int`; `DECIMAL` ->
//!   `QueryValue::Decimal` (textual); `VARCHAR` / `DATE` / `DATETIME` ->
//!   `QueryValue::Text`.
//! * StarRocks has no user stored procedures, triggers, or events, so the schema
//!   browser only surfaces tables, views, and materialized views.
//! * `EXPLAIN` returns a text plan (no JSON plan format).
//! * StarRocks has no interactive transactions; statements auto-commit.

use std::time::Duration;

use arris_engines::{
    CanvasEngine, CanvasError, CellResultCache, ConnectionConfig, DatabaseDriver, DatabaseKind,
    ExplainMode, ObjectRef, QueryLanguage, QueryResult, QueryValue, SchemaNode, SchemaNodeKind,
    driver_for_kind, CELL_RESULT_PAGE_ROWS,
};
use testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers::runners::AsyncRunner;
use testcontainers::{ContainerAsync, GenericImage, ImageExt};
use tokio_util::sync::CancellationToken;

// ── harness ─────────────────────────────────────────────────────────────────

/// Image + tag pinned to `docker-compose.yml`'s `starrocks` service.
const STARROCKS_IMAGE: &str = "starrocks/allin1-ubuntu";
const STARROCKS_TAG: &str = "3.3-latest";

/// Boot a fresh StarRocks all-in-one container and return a connected driver
/// plus host/port (so access-control tests can open additional sessions). The
/// container guard must be kept alive for the duration of the test.
async fn start_starrocks() -> (ContainerAsync<GenericImage>, Box<dyn DatabaseDriver>, String, u16) {
    let container = GenericImage::new(STARROCKS_IMAGE, STARROCKS_TAG)
        .with_exposed_port(9030.tcp())
        .with_exposed_port(8030.tcp())
        // The all-in-one image prints this once the FE+BE cluster is up; the
        // `SELECT 1` poll below is the authoritative gate either way.
        .with_wait_for(WaitFor::message_on_stdout("Enjoy the journey to StarRocks"))
        .with_startup_timeout(Duration::from_secs(300))
        .start()
        .await
        .expect("start starrocks container");
    let host = container.get_host().await.expect("container host").to_string();
    let port = container
        .get_host_port_ipv4(9030)
        .await
        .expect("container port");

    // Poll the MySQL endpoint until the FE accepts queries and the BE has
    // registered (so writes succeed), up to ~120 s.
    let driver = connect_with_retry(&host, port, "root", "", "", 40).await;
    // `root` answering `SELECT 1` does NOT mean RBAC is ready: for a short window
    // after boot a freshly created non-root user fails authentication with
    // "connection closed" (the FE aborts the handshake before the privilege
    // subsystem is warm). Gate on a throwaway user actually authenticating so the
    // access-control test does not race that window.
    wait_until_user_auth_ready(driver.as_ref(), &host, port).await;
    (container, driver, host, port)
}

/// Block until a brand-new non-root user can authenticate, proving StarRocks'
/// RBAC/auth subsystem is warm (not just that `root` answers queries).
async fn wait_until_user_auth_ready(admin: &dyn DatabaseDriver, host: &str, port: u16) {
    let _ = admin
        .run_query("DROP USER IF EXISTS 'rbac_probe'@'%'", &[], QueryLanguage::Native)
        .await;
    run(admin, "CREATE USER 'rbac_probe'@'%' IDENTIFIED BY 'p'").await;
    let mut ready = false;
    for _ in 0..40 {
        let probe = driver_for_kind(DatabaseKind::Starrocks).expect("starrocks driver");
        let mut cfg = ConnectionConfig::new("rbac-probe", DatabaseKind::Starrocks);
        cfg.host = host.to_string();
        cfg.port = port;
        cfg.user = "rbac_probe".into();
        cfg.password = "p".into();
        if probe.connect(&cfg).await.is_ok() {
            ready = true;
            break;
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
    let _ = admin
        .run_query("DROP USER IF EXISTS 'rbac_probe'@'%'", &[], QueryLanguage::Native)
        .await;
    assert!(ready, "starrocks RBAC never became ready for new-user auth");
}

/// Open a driver connection, retrying until StarRocks is ready or `attempts`
/// run out (3 s between tries). An empty `db` connects without a default
/// database.
async fn connect_with_retry(
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
    db: &str,
    attempts: u32,
) -> Box<dyn DatabaseDriver> {
    let mut last_err = String::new();
    for _ in 0..attempts {
        let mut cfg = ConnectionConfig::new("it-starrocks", DatabaseKind::Starrocks);
        cfg.host = host.to_string();
        cfg.port = port;
        cfg.user = user.to_string();
        cfg.password = pass.to_string();
        cfg.database = db.to_string();

        let driver = driver_for_kind(DatabaseKind::Starrocks).expect("starrocks driver");
        match driver.connect(&cfg).await {
            Ok(()) => {
                // Prove the cluster actually serves queries before handing back.
                if driver.run_query("SELECT 1", &[], QueryLanguage::Native).await.is_ok() {
                    return driver;
                }
            }
            Err(e) => last_err = e.to_string(),
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
    panic!("starrocks never became ready: {last_err}");
}

async fn connect_as(host: &str, port: u16, user: &str, pass: &str, db: &str) -> Box<dyn DatabaseDriver> {
    connect_with_retry(host, port, user, pass, db, 10).await
}

async fn run(driver: &dyn DatabaseDriver, sql: &str) -> QueryResult {
    driver
        .run_query(sql, &[], QueryLanguage::Native)
        .await
        .unwrap_or_else(|e| panic!("query failed: {sql}\n  error: {e:?}"))
}

/// Run a statement expecting it to fail (negative access-control assertions).
async fn run_expect_err(driver: &dyn DatabaseDriver, sql: &str) {
    let r = driver.run_query(sql, &[], QueryLanguage::Native).await;
    assert!(r.is_err(), "expected error but query succeeded: {sql}");
}

/// First column of the first row.
fn scalar(result: &QueryResult) -> &QueryValue {
    result
        .rows
        .first()
        .and_then(|row| row.first())
        .unwrap_or_else(|| panic!("expected at least one row/column, got {result:?}"))
}

/// Coerce a numeric cell to i64 (StarRocks returns BIGINT as Int, DECIMAL as
/// textual Decimal).
fn as_i64(v: &QueryValue) -> i64 {
    match v {
        QueryValue::Int(n) => *n,
        QueryValue::Double(d) => *d as i64,
        QueryValue::Text(s) | QueryValue::Decimal(s) => {
            s.trim().parse::<f64>().unwrap_or_else(|_| panic!("not numeric: {s:?}")) as i64
        }
        other => panic!("expected numeric, got {other:?}"),
    }
}

fn as_text(v: &QueryValue) -> &str {
    match v {
        QueryValue::Text(s) | QueryValue::Decimal(s) | QueryValue::Json(s) => s.as_str(),
        other => panic!("expected text, got {other:?}"),
    }
}

fn col_names(result: &QueryResult) -> Vec<String> {
    result.columns.iter().map(|c| c.name.clone()).collect()
}

/// The object nodes under a database in a `list_schema` result.
fn db_children<'a>(nodes: &'a [SchemaNode], db: &str) -> &'a [SchemaNode] {
    nodes
        .iter()
        .find(|n| n.name == db && n.kind == SchemaNodeKind::Database)
        .map(|n| n.children.as_slice())
        .unwrap_or_else(|| panic!("database {db} not found in schema tree"))
}

fn node_kind(children: &[SchemaNode], name: &str) -> Option<SchemaNodeKind> {
    children.iter().find(|n| n.name == name).map(|n| n.kind)
}

/// Create the canonical Primary Key sample tables in a fresh database and return
/// its name.
async fn seed(driver: &dyn DatabaseDriver, db: &str) {
    run(driver, &format!("CREATE DATABASE {db}")).await;
    // `USE` only changes session state on the single pooled connection that runs
    // it; the next `run` takes a different pooled connection with no database
    // selected. So every object is created fully-qualified with `{db}.` instead.
    run(
        driver,
        &format!(
            "CREATE TABLE {db}.customers (\
                customer_id INT NOT NULL, first_name VARCHAR(50) NOT NULL, \
                last_name VARCHAR(50) NOT NULL, country_code CHAR(2) NOT NULL\
             ) PRIMARY KEY(customer_id) DISTRIBUTED BY HASH(customer_id) \
             PROPERTIES (\"replication_num\" = \"1\")"
        ),
    )
    .await;
    run(
        driver,
        &format!(
            "CREATE TABLE {db}.orders (\
                order_id INT NOT NULL, customer_id INT NOT NULL, \
                status VARCHAR(20) NOT NULL, amount DECIMAL(10,2) NOT NULL\
             ) PRIMARY KEY(order_id) DISTRIBUTED BY HASH(order_id) \
             PROPERTIES (\"replication_num\" = \"1\")"
        ),
    )
    .await;
}

// ── CRUD + window functions + dialect ─────────────────────────────────────────

#[tokio::test]
async fn crud_window_and_dialect() {
    let (_c, admin, host, port) = start_starrocks().await;
    let db = "it_crud";
    seed(admin.as_ref(), db).await;
    // Reconnect with the database selected so the unqualified statements below
    // resolve. A pooled connection only carries the database set in its opts
    // (`db_name`), which the pool applies to every connection it opens.
    let driver = connect_as(&host, port, "root", "", db).await;

    // Multi-row INSERT.
    let ins = run(
        driver.as_ref(),
        "INSERT INTO customers (customer_id, first_name, last_name, country_code) VALUES \
            (1,'Ada','Lovelace','GB'),(2,'Grace','Hopper','US'),\
            (3,'Katherine','Johnson','US'),(4,'Radia','Perlman','CA')",
    )
    .await;
    assert_eq!(ins.rows_affected, Some(4));

    run(
        driver.as_ref(),
        "INSERT INTO orders (order_id, customer_id, status, amount) VALUES \
            (100,1,'completed',129.00),(101,2,'shipped',49.00),\
            (102,2,'completed',299.00),(103,3,'pending',35.00),\
            (104,2,'completed',42.00)",
    )
    .await;

    // Filtered SELECT with WHERE / ORDER BY / LIMIT.
    let sel = run(
        driver.as_ref(),
        "SELECT customer_id, first_name FROM customers WHERE country_code='US' ORDER BY customer_id LIMIT 10",
    )
    .await;
    assert_eq!(col_names(&sel), vec!["customer_id", "first_name"]);
    assert_eq!(sel.rows.len(), 2);
    assert_eq!(as_i64(&sel.rows[0][0]), 2);
    assert_eq!(as_text(&sel.rows[0][1]), "Grace");
    assert_eq!(as_i64(&sel.rows[1][0]), 3);

    // JOIN + aggregate.
    let join = run(
        driver.as_ref(),
        "SELECT c.first_name, COUNT(*) AS n FROM orders o \
         JOIN customers c ON c.customer_id = o.customer_id \
         GROUP BY c.first_name ORDER BY n DESC, c.first_name LIMIT 1",
    )
    .await;
    assert_eq!(as_text(&join.rows[0][0]), "Grace");
    assert_eq!(as_i64(&join.rows[0][1]), 3);

    // Aggregate count of all orders.
    let count = run(driver.as_ref(), "SELECT COUNT(*) FROM orders").await;
    assert_eq!(as_i64(scalar(&count)), 5);

    // UPDATE (Primary Key table).
    let upd = run(
        driver.as_ref(),
        "UPDATE orders SET status='cancelled' WHERE order_id=103",
    )
    .await;
    assert_eq!(upd.rows_affected, Some(1));
    let after = run(driver.as_ref(), "SELECT status FROM orders WHERE order_id=103").await;
    assert_eq!(as_text(scalar(&after)), "cancelled");

    // DELETE.
    let del = run(driver.as_ref(), "DELETE FROM orders WHERE order_id=104").await;
    assert_eq!(del.rows_affected, Some(1));
    let remaining = run(driver.as_ref(), "SELECT COUNT(*) FROM orders").await;
    assert_eq!(as_i64(scalar(&remaining)), 4);

    // Window / analytic functions.
    let win = run(
        driver.as_ref(),
        "SELECT order_id, \
            ROW_NUMBER() OVER (ORDER BY amount DESC) AS rn, \
            RANK() OVER (ORDER BY amount DESC) AS rk, \
            LAG(amount) OVER (ORDER BY amount DESC) AS prev_amt, \
            SUM(amount) OVER (ORDER BY amount DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running \
         FROM orders ORDER BY rn",
    )
    .await;
    assert_eq!(col_names(&win), vec!["order_id", "rn", "rk", "prev_amt", "running"]);
    assert_eq!(win.rows.len(), 4);
    // Top amount is order 102 (299.00); ROW_NUMBER starts at 1, LAG is NULL.
    assert_eq!(as_i64(&win.rows[0][1]), 1);
    assert!(matches!(win.rows[0][3], QueryValue::Null));

    // EXPLAIN returns a non-empty text plan (no JSON format in StarRocks).
    let plan = driver
        .explain_query("SELECT * FROM orders", &[], QueryLanguage::Native, ExplainMode::DryRun)
        .await
        .expect("explain");
    assert!(!plan.raw.trim().is_empty(), "expected a non-empty text plan");
}

// ── schema-object lifecycle (table / view / materialized view) ─────────────────

#[tokio::test]
async fn schema_object_lifecycle() {
    let (_c, driver, _h, _p) = start_starrocks().await;
    let db = "it_schema";
    seed(driver.as_ref(), db).await;
    run(
        driver.as_ref(),
        &format!(
            "INSERT INTO {db}.orders (order_id, customer_id, status, amount) VALUES \
             (1,1,'completed',10.00),(2,1,'completed',20.00)"
        ),
    )
    .await;

    // Base tables appear in the schema browser as Table nodes.
    let tree = driver.list_schema(db).await.expect("list_schema");
    let children = db_children(&tree, db);
    assert_eq!(node_kind(children, "customers"), Some(SchemaNodeKind::Table));
    assert_eq!(node_kind(children, "orders"), Some(SchemaNodeKind::Table));
    // Columns are surfaced as Column children.
    let orders = children.iter().find(|n| n.name == "orders").unwrap();
    let cols: Vec<&str> = orders
        .children
        .iter()
        .filter(|c| c.kind == SchemaNodeKind::Column)
        .map(|c| c.name.as_str())
        .collect();
    assert!(cols.contains(&"order_id") && cols.contains(&"amount"));

    // Logical view: create -> query -> browse -> drop.
    run(
        driver.as_ref(),
        &format!("CREATE VIEW {db}.completed_orders AS SELECT order_id, amount FROM {db}.orders WHERE status='completed'"),
    )
    .await;
    let vq = run(driver.as_ref(), &format!("SELECT COUNT(*) FROM {db}.completed_orders")).await;
    assert_eq!(as_i64(scalar(&vq)), 2);
    let tree = driver.list_schema(db).await.unwrap();
    assert_eq!(
        node_kind(db_children(&tree, db), "completed_orders"),
        Some(SchemaNodeKind::View)
    );
    // object_definition returns the DDL.
    let view_ddl = driver
        .object_definition(&ObjectRef {
            kind: SchemaNodeKind::View,
            name: "completed_orders".into(),
            schema: Some(db.into()),
            database: Some(db.into()),
        })
        .await
        .expect("view ddl");
    assert!(view_ddl.to_uppercase().contains("VIEW"));
    run(driver.as_ref(), &format!("DROP VIEW {db}.completed_orders")).await;
    let tree = driver.list_schema(db).await.unwrap();
    assert_eq!(node_kind(db_children(&tree, db), "completed_orders"), None);

    // Asynchronous materialized view: create -> browse -> drop. It surfaces via
    // information_schema.materialized_views as a MaterializedView node.
    run(
        driver.as_ref(),
        &format!(
            "CREATE MATERIALIZED VIEW {db}.order_totals \
             DISTRIBUTED BY HASH(customer_id) \
             PROPERTIES (\"replication_num\"=\"1\") \
             AS SELECT customer_id, SUM(amount) AS total FROM {db}.orders GROUP BY customer_id"
        ),
    )
    .await;
    let tree = driver.list_schema(db).await.unwrap();
    assert_eq!(
        node_kind(db_children(&tree, db), "order_totals"),
        Some(SchemaNodeKind::MaterializedView)
    );
    run(driver.as_ref(), &format!("DROP MATERIALIZED VIEW {db}.order_totals")).await;
    let tree = driver.list_schema(db).await.unwrap();
    assert_eq!(node_kind(db_children(&tree, db), "order_totals"), None);

    // StarRocks has no user procedures / triggers / events, so none ever appear.
    let final_children = db_children(&driver.list_schema(db).await.unwrap(), db).to_vec();
    assert!(!final_children
        .iter()
        .any(|n| matches!(n.kind, SchemaNodeKind::Procedure | SchemaNodeKind::Trigger | SchemaNodeKind::Event)));

    // Dropped table can no longer be queried.
    run(driver.as_ref(), &format!("DROP TABLE {db}.customers")).await;
    run_expect_err(driver.as_ref(), &format!("SELECT * FROM {db}.customers")).await;
    assert_eq!(node_kind(db_children(&driver.list_schema(db).await.unwrap(), db), "customers"), None);
}

// ── access control ────────────────────────────────────────────────────────────

#[tokio::test]
async fn access_control() {
    let (_c, admin, host, port) = start_starrocks().await;
    let db = "it_acl";
    seed(admin.as_ref(), db).await;
    run(
        admin.as_ref(),
        &format!("INSERT INTO {db}.orders (order_id, customer_id, status, amount) VALUES (1,1,'completed',10.00)"),
    )
    .await;

    // Create a restricted user (StarRocks 3.x RBAC).
    run(admin.as_ref(), "CREATE USER 'reader'@'%' IDENTIFIED BY 'pw'").await;
    run(admin.as_ref(), &format!("GRANT SELECT ON TABLE {db}.orders TO 'reader'@'%'")).await;

    // Positive: the granted user can read the table.
    let reader = connect_as(&host, port, "reader", "pw", db).await;
    let got = run(reader.as_ref(), &format!("SELECT COUNT(*) FROM {db}.orders")).await;
    assert_eq!(as_i64(scalar(&got)), 1);

    // Negative: the user was never granted customers, so reading it is denied.
    run_expect_err(reader.as_ref(), &format!("SELECT * FROM {db}.customers")).await;

    // Revoke; the previously-allowed read must now be denied. Losing the only
    // privilege on `it_acl` means StarRocks may reject the read OR refuse the
    // connection outright (a user with no privilege on its default database) —
    // either outcome proves the revoke took effect.
    run(admin.as_ref(), &format!("REVOKE SELECT ON TABLE {db}.orders FROM 'reader'@'%'")).await;
    let mut cfg = ConnectionConfig::new("reader-after-revoke", DatabaseKind::Starrocks);
    cfg.host = host.clone();
    cfg.port = port;
    cfg.user = "reader".into();
    cfg.password = "pw".into();
    cfg.database = db.into();
    let reader2 = driver_for_kind(DatabaseKind::Starrocks).expect("starrocks driver");
    if reader2.connect(&cfg).await.is_ok() {
        run_expect_err(reader2.as_ref(), &format!("SELECT * FROM {db}.orders")).await;
    }

    // Drop the user; they can no longer authenticate.
    run(admin.as_ref(), "DROP USER 'reader'@'%'").await;
    let mut cfg = ConnectionConfig::new("dropped", DatabaseKind::Starrocks);
    cfg.host = host.clone();
    cfg.port = port;
    cfg.user = "reader".into();
    cfg.password = "pw".into();
    let dropped = driver_for_kind(DatabaseKind::Starrocks).unwrap();
    assert!(dropped.connect(&cfg).await.is_err(), "dropped user should not authenticate");
}

// ── streaming ingestion (canvas path) ───────────────────────────────────────

static STREAM_DIR_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// A canvas engine over a throwaway cell cache (1 GiB memory / 10 GiB total).
fn canvas_engine() -> CanvasEngine {
    let n = STREAM_DIR_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir =
        std::env::temp_dir().join(format!("arris-starrocks-stream-{}-{}", std::process::id(), n));
    let cache = CellResultCache::new(dir, 1 << 30, 10 * (1 << 30));
    CanvasEngine::new(std::sync::Arc::new(cache))
}

const BOARD: &str = "board-stream";

/// Create `src(n INT, label VARCHAR)` with rows 1..=count in the driver's
/// current database. StarRocks has no lazy `generate_series`, so the rows come
/// from a digit-table cross join (no recursion). `count` must be a power of ten.
async fn seed_numbers(driver: &dyn DatabaseDriver, count: u64) {
    run(
        driver,
        "CREATE TABLE _digits (d INT) DUPLICATE KEY(d) \
         DISTRIBUTED BY HASH(d) PROPERTIES (\"replication_num\" = \"1\")",
    )
    .await;
    run(driver, "INSERT INTO _digits VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)").await;
    run(
        driver,
        "CREATE TABLE src (n INT, label VARCHAR(32)) DUPLICATE KEY(n) \
         DISTRIBUTED BY HASH(n) PROPERTIES (\"replication_num\" = \"1\")",
    )
    .await;

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
    let (_c, admin, host, port) = start_starrocks().await;
    run(admin.as_ref(), "CREATE DATABASE it_stream").await;
    let driver = connect_as(&host, port, "root", "", "it_stream").await;
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
    let (_c, admin, host, port) = start_starrocks().await;
    run(admin.as_ref(), "CREATE DATABASE it_stream").await;
    let driver = connect_as(&host, port, "root", "", "it_stream").await;
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

    // The aborted cell was never registered, so downstream cannot read it.
    let chained = engine.run_cell(BOARD, "agg", "SELECT COUNT(*) FROM huge").await;
    assert!(chained.is_err(), "cancelled cell must not be queryable");
}

#[tokio::test]
async fn streaming_byte_budget_truncates_and_reports_incomplete() {
    let (_c, admin, host, port) = start_starrocks().await;
    run(admin.as_ref(), "CREATE DATABASE it_stream").await;
    let driver = connect_as(&host, port, "root", "", "it_stream").await;
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
