//! Federation integration tests proving Elasticsearch works as a SQL federation
//! scan source. Everything runs against a real `elasticsearch:8.18.0`
//! instance via `testcontainers` and is exercised through the engine layer
//! (`FederationEngine` driving `DriverScanAdapter` over the ES `_sql` path),
//! never a raw Elasticsearch client.
//!
//! Each test owns its own container (one `start_es()` per test) so the tests are
//! independent and parallel-safe. Cross-source coverage pairs the ES container
//! with an embedded in-memory SQLite source (no container) the same way the
//! federation engine joins two live drivers in production.
//!
//! What these cover that the per-driver suite cannot:
//! * **Cross-source join** — DataFusion plans a per-source scan of an ES index
//!   and a SQLite table and joins them locally.
//! * **CTE over ES** — `WITH cus AS (SELECT * FROM es.customers) ...`, which the
//!   direct (non-federation) ES SQL path intentionally rejects; federation makes
//!   it work by letting DataFusion plan the CTE on top of a plain index scan.
//! * **Cursor pagination** — a full-index federation scan of >`fetch_size` docs
//!   follows the ES `_sql` cursor so every row is returned, not just the first
//!   page.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use arris_engines::federation::{DriverScanAdapter, ScanAdapter};
use arris_engines::{
    ConnectionConfig, DatabaseDriver, DatabaseKind, FederationEngine, QueryLanguage, QueryResult,
    QueryValue, driver_for_kind,
};
use testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers::runners::AsyncRunner;
use testcontainers::{ContainerAsync, GenericImage, ImageExt};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/// Image tag pinned to `docker-compose.yml`'s `elasticsearch` service.
const ES_IMAGE: &str = "elasticsearch";
const ES_TAG: &str = "8.18.0";

async fn start_es() -> (ContainerAsync<GenericImage>, Box<dyn DatabaseDriver>) {
    // ES 8.x logs are unreliable as a `WaitFor` marker, so readiness is driven by
    // polling cluster health through the engine in `connect_ready`.
    let container = GenericImage::new(ES_IMAGE, ES_TAG)
        .with_exposed_port(9200.tcp())
        .with_wait_for(WaitFor::seconds(2))
        .with_env_var("discovery.type", "single-node")
        .with_env_var("xpack.security.enabled", "false")
        .with_env_var("ES_JAVA_OPTS", "-Xms512m -Xmx512m")
        .with_startup_timeout(Duration::from_secs(180))
        .start()
        .await
        .expect("start elasticsearch container");

    let driver = connect_ready(&container).await;
    (container, driver)
}

/// Build the ES driver and poll cluster health through the engine until the node
/// reaches at least `yellow`, so it is ready to index and search.
async fn connect_ready(container: &ContainerAsync<GenericImage>) -> Box<dyn DatabaseDriver> {
    let host = container.get_host().await.expect("container host").to_string();
    let port = container
        .get_host_port_ipv4(9200)
        .await
        .expect("container port");

    let mut cfg = ConnectionConfig::new("it-es-fed", DatabaseKind::Elasticsearch);
    cfg.host = host;
    cfg.port = port;

    let driver = driver_for_kind(DatabaseKind::Elasticsearch).expect("elasticsearch driver");

    for _ in 0..120 {
        if driver.connect(&cfg).await.is_ok() {
            if let Ok(r) = driver
                .run_query(
                    "GET /_cluster/health?wait_for_status=yellow&timeout=5s",
                    &[],
                    QueryLanguage::Native,
                )
                .await
            {
                if matches!(
                    json_status(&r).as_deref(),
                    Some("yellow") | Some("green")
                ) {
                    return driver;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    panic!("elasticsearch did not become ready in time");
}

/// Pull `status` out of a `_cluster/health` reply (single json `result` column).
fn json_status(r: &QueryResult) -> Option<String> {
    match r.rows.first().and_then(|row| row.first()) {
        Some(QueryValue::Json(s)) => serde_json::from_str::<serde_json::Value>(s)
            .ok()
            .and_then(|v| v["status"].as_str().map(str::to_owned)),
        _ => None,
    }
}

/// Run a raw Elasticsearch request (`METHOD /path\n{body}`) through the engine.
async fn run_native(d: &dyn DatabaseDriver, request: &str) {
    d.run_query(request, &[], QueryLanguage::Native)
        .await
        .unwrap_or_else(|e| panic!("request failed: {request}\n  error: {e:?}"));
}

/// Index one document via a per-document `_doc` POST. The engine trims the body,
/// stripping the terminating newline the `_bulk` API requires, so multi-document
/// indexing goes one document at a time (same constraint as the per-driver suite).
async fn index_doc(d: &dyn DatabaseDriver, index: &str, id: &str, source: &str) {
    run_native(d, &format!("POST /{index}/_doc/{id}\n{source}")).await;
}

/// An embedded in-memory SQLite source with an `orders` table, used as the second
/// federation source for the cross-source join.
async fn start_sqlite_with_orders() -> Box<dyn DatabaseDriver> {
    let mut cfg = ConnectionConfig::new("it-sqlite-fed", DatabaseKind::Sqlite);
    cfg.file_path = Some(":memory:".to_string());

    let driver = driver_for_kind(DatabaseKind::Sqlite).expect("sqlite driver");
    driver.connect(&cfg).await.expect("connect sqlite");

    for stmt in [
        "CREATE TABLE orders (order_id INTEGER PRIMARY KEY, customer_id INTEGER, amount REAL)",
        "INSERT INTO orders (order_id, customer_id, amount) VALUES (1, 10, 29.99)",
        "INSERT INTO orders (order_id, customer_id, amount) VALUES (2, 10, 5.50)",
        "INSERT INTO orders (order_id, customer_id, amount) VALUES (3, 20, 100.00)",
        "INSERT INTO orders (order_id, customer_id, amount) VALUES (4, 30, 7.25)",
    ] {
        driver
            .run_query(stmt, &[], QueryLanguage::Sql)
            .await
            .unwrap_or_else(|e| panic!("sqlite stmt failed: {stmt}\n  error: {e:?}"));
    }
    driver
}

/// Create the `customers` index with an explicit mapping (clean ES SQL types) and
/// seed three documents.
async fn seed_customers(d: &dyn DatabaseDriver) {
    run_native(
        d,
        r#"PUT /customers
{"mappings":{"properties":{"customer_id":{"type":"integer"},"name":{"type":"keyword"},"country_code":{"type":"keyword"}}}}"#,
    )
    .await;
    index_doc(d, "customers", "1", r#"{"customer_id":10,"name":"Alice","country_code":"US"}"#).await;
    index_doc(d, "customers", "2", r#"{"customer_id":20,"name":"Bob","country_code":"GB"}"#).await;
    index_doc(d, "customers", "3", r#"{"customer_id":30,"name":"Carol","country_code":"US"}"#).await;
    run_native(d, "POST /customers/_refresh").await;
}

/// Build a `FederationEngine` over the given connected drivers. Each driver is
/// shared into a `DriverScanAdapter` exactly as the production path does.
fn federation_over(
    sources: Vec<(&str, Arc<dyn DatabaseDriver>, DatabaseKind)>,
) -> FederationEngine {
    let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
    for (name, driver, kind) in sources {
        adapters.insert(
            name.to_string(),
            Arc::new(DriverScanAdapter::new(driver, kind)) as Arc<dyn ScanAdapter>,
        );
    }
    FederationEngine::new(adapters)
}

fn int_at(r: &QueryResult, row: usize, col: usize) -> i64 {
    match &r.rows[row][col] {
        QueryValue::Int(n) => *n,
        other => panic!("expected Int at ({row},{col}), got {other:?}"),
    }
}

fn text_at(r: &QueryResult, row: usize, col: usize) -> String {
    match &r.rows[row][col] {
        QueryValue::Text(s) => s.clone(),
        other => panic!("expected Text at ({row},{col}), got {other:?}"),
    }
}

fn double_at(r: &QueryResult, row: usize, col: usize) -> f64 {
    match &r.rows[row][col] {
        QueryValue::Double(n) => *n,
        QueryValue::Int(n) => *n as f64,
        other => panic!("expected numeric at ({row},{col}), got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Cross-source join: ES `customers` index joined with SQLite `orders` table.
/// DataFusion pushes a scan to each source and joins the results locally.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cross_source_join_es_with_sqlite() {
    let (_es, es_driver) = start_es().await;
    seed_customers(es_driver.as_ref()).await;
    let sqlite = start_sqlite_with_orders().await;

    let engine = federation_over(vec![
        ("es", Arc::from(es_driver), DatabaseKind::Elasticsearch),
        ("sq", Arc::from(sqlite), DatabaseKind::Sqlite),
    ]);

    // Total spend per customer who has orders, joined to their ES name.
    let result = engine
        .execute(
            "SELECT c.name AS name, SUM(o.amount) AS spend \
             FROM es.customers c \
             JOIN sq.orders o ON c.customer_id = o.customer_id \
             GROUP BY c.name \
             ORDER BY spend DESC",
        )
        .await
        .expect("federated join should succeed");

    assert_eq!(result.columns.len(), 2);
    assert_eq!(result.columns[0].name, "name");
    assert_eq!(result.columns[1].name, "spend");

    // Alice (cust 10): 29.99 + 5.50 = 35.49; Bob (20): 100.00; Carol (30): 7.25.
    // Ordered by spend DESC -> Bob, Alice, Carol.
    assert_eq!(result.rows.len(), 3);
    assert_eq!(text_at(&result, 0, 0), "Bob");
    assert!((double_at(&result, 0, 1) - 100.00).abs() < 1e-6);
    assert_eq!(text_at(&result, 1, 0), "Alice");
    assert!((double_at(&result, 1, 1) - 35.49).abs() < 1e-6);
    assert_eq!(text_at(&result, 2, 0), "Carol");
    assert!((double_at(&result, 2, 1) - 7.25).abs() < 1e-6);
}

/// CTE over an ES index. The direct ES SQL path rejects `WITH ... AS`; federation
/// makes it work by planning the CTE in DataFusion over a plain index scan.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cte_over_elasticsearch_source() {
    let (_es, es_driver) = start_es().await;
    seed_customers(es_driver.as_ref()).await;

    let engine = federation_over(vec![(
        "es",
        Arc::from(es_driver),
        DatabaseKind::Elasticsearch,
    )]);

    let result = engine
        .execute(
            "WITH cus AS (SELECT customer_id, name FROM es.customers) \
             SELECT customer_id, name FROM cus ORDER BY customer_id",
        )
        .await
        .expect("CTE over ES should succeed with federation");

    assert_eq!(result.rows.len(), 3);
    assert_eq!(int_at(&result, 0, 0), 10);
    assert_eq!(text_at(&result, 0, 1), "Alice");
    assert_eq!(int_at(&result, 1, 0), 20);
    assert_eq!(text_at(&result, 1, 1), "Bob");
    assert_eq!(int_at(&result, 2, 0), 30);
    assert_eq!(text_at(&result, 2, 1), "Carol");
}

/// WHERE pushdown over ES: a filtered federated scan returns only matching rows.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn filtered_scan_over_elasticsearch() {
    let (_es, es_driver) = start_es().await;
    seed_customers(es_driver.as_ref()).await;

    let engine = federation_over(vec![(
        "es",
        Arc::from(es_driver),
        DatabaseKind::Elasticsearch,
    )]);

    let result = engine
        .execute(
            "SELECT name FROM es.customers WHERE country_code = 'US' ORDER BY customer_id",
        )
        .await
        .expect("filtered ES scan should succeed");

    assert_eq!(result.rows.len(), 2);
    assert_eq!(text_at(&result, 0, 0), "Alice");
    assert_eq!(text_at(&result, 1, 0), "Carol");
}

/// A full-index federation scan of more than one `fetch_size` page (1000) must
/// follow the ES `_sql` cursor and return every row. Before cursor following the
/// scan truncated at 1000, so the count would be wrong.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn full_scan_follows_sql_cursor_past_fetch_size() {
    const DOC_COUNT: i64 = 1100; // > fetch_size (1000) -> at least two pages.

    let (_es, es_driver) = start_es().await;
    run_native(
        es_driver.as_ref(),
        r#"PUT /docs_big
{"mappings":{"properties":{"customer_id":{"type":"integer"}}}}"#,
    )
    .await;
    for id in 1..=DOC_COUNT {
        index_doc(
            es_driver.as_ref(),
            "docs_big",
            &id.to_string(),
            &format!(r#"{{"customer_id":{id}}}"#),
        )
        .await;
    }
    run_native(es_driver.as_ref(), "POST /docs_big/_refresh").await;

    let engine = federation_over(vec![(
        "es",
        Arc::from(es_driver),
        DatabaseKind::Elasticsearch,
    )]);

    // COUNT(*) forces DataFusion to consume the entire scan, so the result proves
    // the cursor was followed across all pages.
    let count = engine
        .execute("SELECT COUNT(*) AS n FROM es.docs_big")
        .await
        .expect("full ES scan should succeed");
    assert_eq!(count.rows.len(), 1);
    assert_eq!(int_at(&count, 0, 0), DOC_COUNT);

    // And the raw row set is complete, not capped at one page.
    let all = engine
        .execute("SELECT customer_id FROM es.docs_big")
        .await
        .expect("full ES scan should succeed");
    assert_eq!(all.rows.len() as i64, DOC_COUNT);
}
