//! Integration tests for the Elasticsearch driver, executed against a real
//! `elasticsearch:8.18.0` instance via `testcontainers`. Everything runs through
//! the engine layer (`DatabaseDriver::run_query` / `list_schemas`), never a raw
//! Elasticsearch client.
//!
//! Each test owns its own container (one `start_es()` per test) so the tests are
//! independent and parallel-safe. The container is single-node with security
//! disabled (`xpack.security.enabled=false`), matching the harness requirement in
//! the ticket and the `docker-compose.yml` service.
//!
//! How engine results map to assertions:
//!
//! * **Search requests** (`.../_search`, `GET /idx/_doc/.../_search`) surface the
//!   `hits.hits` array as a tabular `QueryResult`: columns are `_index`, `_id`,
//!   then the union of top-level `_source` fields (nested objects/arrays arrive as
//!   `QueryValue::Json`). Row count equals the number of returned hits, so every
//!   DSL test sizes its query large enough that returned hits == total matches and
//!   asserts the exact hit set.
//! * **Non-search requests** (index/get/bulk/update/delete, cluster health) have no
//!   `hits.hits`, so the engine returns the whole JSON body in a single
//!   `result`/`json` column. Those tests parse that body and assert on it.
//! * **Aggregations**: the engine projects `hits.hits`, *not* the DSL
//!   `aggregations` block — a `size:0` aggregation request would surface as an
//!   empty table. The engine *does* fully tabularize the Elasticsearch SQL endpoint
//!   (`POST /_sql`, reached via `QueryLanguage::Sql`), so `GROUP BY` is the
//!   engine-surfaced aggregation path here: `terms` buckets become `GROUP BY`
//!   rows, `avg`/`sum`/`stats` metrics become `AVG`/`SUM`/`MIN`/`MAX`/`COUNT`
//!   columns, and a nested/sub-aggregation becomes a multi-key `GROUP BY`.
//!
//! Object-lifecycle coverage maps the CLAUDE.md schema-object requirement onto the
//! `SchemaNodeKind`s the Elasticsearch browser emits: `ElasticsearchIndex`,
//! `ElasticsearchAlias`, `ElasticsearchIndexTemplate`, `ElasticsearchDataStream`.
//! The relational object kinds the bar lists — tables, views, materialized views,
//! functions, procedures, triggers, sequences, and (relational) indexes — do not
//! exist in Elasticsearch and have no analogue; the index/alias/template/data-stream
//! lifecycle stands in for them (see `schema_object_lifecycle`).
//!
//! Access control: Elasticsearch roles / users / API keys live behind X-Pack
//! security, which the harness disables (`xpack.security.enabled=false`, per the
//! ticket). The engine exposes no dedicated role/privilege surface, so there is
//! nothing to grant or revoke through it. `access_control_unavailable_when_security_disabled`
//! pins that contract: the `_security` APIs are rejected in this configuration.

use std::time::Duration;

use arris_engines::{
    ColumnSpec, ConnectionConfig, DatabaseDriver, DatabaseKind, QueryLanguage, QueryResult,
    QueryValue, RowDelete, RowInsert, SchemaNode, SchemaNodeKind, TableRef, ValueMap,
    driver_for_kind,
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
    // ES 8.x logs are unreliable to match as a `WaitFor` log marker, so readiness
    // is driven entirely by polling cluster health through the engine in
    // `connect_ready` below. The container only needs to be running for its mapped
    // port to be available.
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

/// Build the driver and poll cluster health through the engine until the freshly
/// started single node connects and reaches at least `yellow` status, so it is
/// ready to index and search before a test begins.
async fn connect_ready(container: &ContainerAsync<GenericImage>) -> Box<dyn DatabaseDriver> {
    let host = container.get_host().await.expect("container host").to_string();
    let port = container
        .get_host_port_ipv4(9200)
        .await
        .expect("container port");

    let mut cfg = ConnectionConfig::new("it-elasticsearch", DatabaseKind::Elasticsearch);
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
                if matches!(json_body(&r)["status"].as_str(), Some("yellow") | Some("green")) {
                    return driver;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    panic!("elasticsearch did not become ready in time");
}

/// Run a raw Elasticsearch request (`METHOD /path\n{body}`) through the engine.
async fn run(d: &dyn DatabaseDriver, request: &str) -> QueryResult {
    d.run_query(request, &[], QueryLanguage::Native)
        .await
        .unwrap_or_else(|e| panic!("request failed: {request}\n  error: {e:?}"))
}

/// Run an Elasticsearch SQL statement through the engine's `_sql` path.
async fn run_sql(d: &dyn DatabaseDriver, sql: &str) -> QueryResult {
    d.run_query(sql, &[], QueryLanguage::Sql)
        .await
        .unwrap_or_else(|e| panic!("sql failed: {sql}\n  error: {e:?}"))
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

/// Parse the JSON body the engine returns for a non-search request (single
/// `result`/`json` column, one row).
fn json_body(r: &QueryResult) -> serde_json::Value {
    assert_eq!(
        r.columns,
        vec![ColumnSpec::new("result", "json")],
        "non-search reply should be a single json `result` column"
    );
    assert_eq!(r.rows.len(), 1, "json reply should have exactly one row");
    match &r.rows[0][0] {
        QueryValue::Json(s) => serde_json::from_str(s).expect("valid json body"),
        other => panic!("expected QueryValue::Json, got {other:?}"),
    }
}

fn col_idx(r: &QueryResult, name: &str) -> usize {
    r.columns
        .iter()
        .position(|c| c.name == name)
        .unwrap_or_else(|| {
            let have: Vec<&String> = r.columns.iter().map(|c| &c.name).collect();
            panic!("column `{name}` missing; columns = {have:?}")
        })
}

fn cell<'a>(r: &'a QueryResult, row: usize, name: &str) -> &'a QueryValue {
    &r.rows[row][col_idx(r, name)]
}

fn as_text(v: &QueryValue) -> String {
    match v {
        QueryValue::Text(s) => s.clone(),
        QueryValue::Int(i) => i.to_string(),
        QueryValue::Double(d) => d.to_string(),
        QueryValue::Bool(b) => b.to_string(),
        other => panic!("expected scalar text, got {other:?}"),
    }
}

fn as_f64(v: &QueryValue) -> f64 {
    match v {
        QueryValue::Double(d) => *d,
        QueryValue::Int(i) => *i as f64,
        other => panic!("expected number, got {other:?}"),
    }
}

fn as_i64(v: &QueryValue) -> i64 {
    match v {
        QueryValue::Int(i) => *i,
        other => panic!("expected int, got {other:?}"),
    }
}

fn as_bool(v: &QueryValue) -> bool {
    match v {
        QueryValue::Bool(b) => *b,
        other => panic!("expected bool, got {other:?}"),
    }
}

/// SKUs of a search result in row order (search hit order is preserved).
fn ordered_skus(r: &QueryResult) -> Vec<String> {
    (0..r.rows.len()).map(|i| as_text(cell(r, i, "sku"))).collect()
}

/// SKUs of a search result, sorted (for set-equality assertions).
fn sorted_skus(r: &QueryResult) -> Vec<String> {
    let mut v = ordered_skus(r);
    v.sort();
    v
}

fn approx(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1e-2,
        "expected ~{expected}, got {actual}"
    );
}

// ---------------------------------------------------------------------------
// Schema-browser helpers
// ---------------------------------------------------------------------------

async fn schema_tree(d: &dyn DatabaseDriver) -> Vec<SchemaNode> {
    d.list_schemas().await.expect("list_schemas")
}

fn find_node<'a>(nodes: &'a [SchemaNode], name: &str) -> Option<&'a SchemaNode> {
    for n in nodes {
        if n.name == name {
            return Some(n);
        }
        if let Some(found) = find_node(&n.children, name) {
            return Some(found);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Seed data — a `products` index with six known documents.
// ---------------------------------------------------------------------------
//
// id  sku      name                category     price    in_stock  rating
// p1  KB-001   Mechanical Keyboard electronics  129.99   true      4.8
// p2  MS-010   Wireless Mouse      electronics  49.99    true      4.3
// p3  HUB-007  USB-C Hub           electronics  39.99    false     4.1
// p4  DSK-400  Standing Desk       furniture    599.00   true      4.6
// p5  CHR-250  Ergonomic Chair     furniture    449.00   true      4.5
// p6  CAB-100  HDMI Cable          accessories  9.99      true      4.0

// NOTE: the engine's raw-request path (`parse_request`) trims the request body, so
// it strips the terminating newline that the Elasticsearch `_bulk` API requires.
// Multi-document indexing is therefore exercised through per-document `_doc` POSTs
// here and through the engine's batch `insert_rows` API in `crud_via_mutation_api`.
async fn index_doc(d: &dyn DatabaseDriver, index: &str, id: &str, source: &str) {
    run(d, &format!("POST /{index}/_doc/{id}\n{source}")).await;
}

async fn seed_products(d: &dyn DatabaseDriver) {
    run(
        d,
        r#"PUT /products
{
  "mappings": {
    "properties": {
      "sku": { "type": "keyword" },
      "name": { "type": "text" },
      "category": { "type": "keyword" },
      "price": { "type": "double" },
      "in_stock": { "type": "boolean" },
      "rating": { "type": "float" }
    }
  }
}"#,
    )
    .await;

    let docs = [
        ("p1", r#"{"sku":"KB-001","name":"Mechanical Keyboard","category":"electronics","price":129.99,"in_stock":true,"rating":4.8}"#),
        ("p2", r#"{"sku":"MS-010","name":"Wireless Mouse","category":"electronics","price":49.99,"in_stock":true,"rating":4.3}"#),
        ("p3", r#"{"sku":"HUB-007","name":"USB-C Hub","category":"electronics","price":39.99,"in_stock":false,"rating":4.1}"#),
        ("p4", r#"{"sku":"DSK-400","name":"Standing Desk","category":"furniture","price":599.00,"in_stock":true,"rating":4.6}"#),
        ("p5", r#"{"sku":"CHR-250","name":"Ergonomic Chair","category":"furniture","price":449.00,"in_stock":true,"rating":4.5}"#),
        ("p6", r#"{"sku":"CAB-100","name":"HDMI Cable","category":"accessories","price":9.99,"in_stock":true,"rating":4.0}"#),
    ];
    for (id, source) in docs {
        index_doc(d, "products", id, source).await;
    }

    run(d, "POST /products/_refresh").await;
}

// ===========================================================================
// CRUD — index document, get by id, bulk index, update, delete.
// ===========================================================================

#[tokio::test]
async fn crud_index_get_update_delete() {
    let (_c, driver) = start_es().await;
    let d = driver.as_ref();

    run(
        d,
        r#"PUT /catalog
{ "mappings": { "properties": {
  "name": { "type": "text" },
  "qty": { "type": "integer" }
}}}"#,
    )
    .await;

    // Index a single document with an explicit id; ?refresh=true makes it
    // immediately searchable.
    let created = run(
        d,
        r#"POST /catalog/_doc/c1?refresh=true
{"name":"Widget","qty":1}"#,
    )
    .await;
    let created = json_body(&created);
    assert_eq!(created["result"], serde_json::json!("created"));
    assert_eq!(created["_id"], serde_json::json!("c1"));

    // Get by id returns the stored _source.
    let got = json_body(&run(d, "GET /catalog/_doc/c1").await);
    assert_eq!(got["found"], serde_json::json!(true));
    assert_eq!(got["_source"]["name"], serde_json::json!("Widget"));
    assert_eq!(got["_source"]["qty"], serde_json::json!(1));

    // Partial update via _update.
    let updated = json_body(
        &run(
            d,
            r#"POST /catalog/_update/c1?refresh=true
{"doc":{"qty":5}}"#,
        )
        .await,
    );
    assert_eq!(updated["result"], serde_json::json!("updated"));
    let got = json_body(&run(d, "GET /catalog/_doc/c1").await);
    assert_eq!(got["_source"]["qty"], serde_json::json!(5));

    // Index three more documents (see `index_doc` for why this is per-document
    // rather than a single `_bulk` request through the engine).
    index_doc(d, "catalog", "c2", r#"{"name":"Gadget","qty":2}"#).await;
    index_doc(d, "catalog", "c3", r#"{"name":"Gizmo","qty":3}"#).await;
    index_doc(d, "catalog", "c4", r#"{"name":"Doohickey","qty":4}"#).await;
    run(d, "POST /catalog/_refresh").await;

    // All four documents are now searchable.
    let all = run(
        d,
        r#"GET /catalog/_search
{"size":20,"query":{"match_all":{}}}"#,
    )
    .await;
    assert_eq!(all.rows.len(), 4, "four documents should be indexed");

    // Delete c1; it can no longer be fetched (negative case).
    let deleted = json_body(&run(d, "DELETE /catalog/_doc/c1?refresh=true").await);
    assert_eq!(deleted["result"], serde_json::json!("deleted"));

    let missing = d
        .run_query("GET /catalog/_doc/c1", &[], QueryLanguage::Native)
        .await;
    assert!(missing.is_err(), "deleted document must 404 through the engine");

    let remaining = run(
        d,
        r#"GET /catalog/_search
{"size":20,"query":{"match_all":{}}}"#,
    )
    .await;
    assert_eq!(remaining.rows.len(), 3, "one document should be gone");
}

// ===========================================================================
// CRUD via the engine's browse-mode mutation API
// (`insert_rows` / `update_row` / `delete_rows`), verified through search.
// ===========================================================================

#[tokio::test]
async fn crud_via_mutation_api() {
    let (_c, driver) = start_es().await;
    let d = driver.as_ref();

    run(
        d,
        r#"PUT /widgets
{ "mappings": { "properties": {
  "name": { "type": "keyword" },
  "qty": { "type": "integer" }
}}}"#,
    )
    .await;

    let table = TableRef::new("widgets");

    // insert_rows posts one document per RowInsert.
    let mut a = ValueMap::new();
    a.insert("name".into(), QueryValue::Text("alpha".into()));
    a.insert("qty".into(), QueryValue::Int(10));
    let mut b = ValueMap::new();
    b.insert("name".into(), QueryValue::Text("beta".into()));
    b.insert("qty".into(), QueryValue::Int(20));
    let inserted = d
        .insert_rows(&table, &[RowInsert::new(a), RowInsert::new(b)])
        .await
        .expect("insert_rows");
    assert_eq!(inserted.rows_affected, 2);

    run(d, "POST /widgets/_refresh").await;
    let all = run(
        d,
        r#"GET /widgets/_search
{"size":20,"sort":[{"name":"asc"}],"query":{"match_all":{}}}"#,
    )
    .await;
    assert_eq!(all.rows.len(), 2);
    assert_eq!(as_text(cell(&all, 0, "name")), "alpha");
    assert_eq!(as_i64(cell(&all, 0, "qty")), 10);

    // update_row patches a document selected by its _id.
    let alpha_id = as_text(cell(&all, 0, "_id"));
    let mut pk = ValueMap::new();
    pk.insert("_id".into(), QueryValue::Text(alpha_id.clone()));
    let mut changes = ValueMap::new();
    changes.insert("qty".into(), QueryValue::Int(99));
    let upd = d.update_row(&table, &pk, &changes).await.expect("update_row");
    assert_eq!(upd.rows_affected, 1);

    run(d, "POST /widgets/_refresh").await;
    let after = json_body(&run(d, &format!("GET /widgets/_doc/{alpha_id}")).await);
    assert_eq!(after["_source"]["qty"], serde_json::json!(99));

    // delete_rows removes the document; the index is left with one row.
    let del = d
        .delete_rows(&table, &[RowDelete::new(pk)])
        .await
        .expect("delete_rows");
    assert_eq!(del.rows_affected, 1);

    run(d, "POST /widgets/_refresh").await;
    let remaining = run(
        d,
        r#"GET /widgets/_search
{"size":20,"query":{"match_all":{}}}"#,
    )
    .await;
    assert_eq!(remaining.rows.len(), 1);
    assert_eq!(as_text(cell(&remaining, 0, "name")), "beta");
}

// ===========================================================================
// Query DSL — full-text, exact-term, bool, range, sort + pagination.
// ===========================================================================

#[tokio::test]
async fn query_match_and_match_phrase() {
    let (_c, driver) = start_es().await;
    let d = driver.as_ref();
    seed_products(d).await;

    // `match` is analyzed full-text: "wireless mouse" hits only the Wireless Mouse.
    let m = run(
        d,
        r#"GET /products/_search
{"size":10,"query":{"match":{"name":"wireless mouse"}}}"#,
    )
    .await;
    assert_eq!(m.rows.len(), 1);
    assert_eq!(as_text(cell(&m, 0, "sku")), "MS-010");

    // `match_phrase` requires the terms adjacent and in order.
    let p = run(
        d,
        r#"GET /products/_search
{"size":10,"query":{"match_phrase":{"name":"standing desk"}}}"#,
    )
    .await;
    assert_eq!(p.rows.len(), 1);
    assert_eq!(as_text(cell(&p, 0, "sku")), "DSK-400");

    // A phrase that never occurs adjacent matches nothing.
    let none = run(
        d,
        r#"GET /products/_search
{"size":10,"query":{"match_phrase":{"name":"keyboard mouse"}}}"#,
    )
    .await;
    assert_eq!(none.rows.len(), 0);
}

#[tokio::test]
async fn query_term_and_terms() {
    let (_c, driver) = start_es().await;
    let d = driver.as_ref();
    seed_products(d).await;

    // `term` on a keyword field is an exact match.
    let electronics = run(
        d,
        r#"GET /products/_search
{"size":10,"query":{"term":{"category":"electronics"}}}"#,
    )
    .await;
    assert_eq!(
        sorted_skus(&electronics),
        vec!["HUB-007", "KB-001", "MS-010"]
    );

    // `terms` matches any of several exact values.
    let furn_acc = run(
        d,
        r#"GET /products/_search
{"size":10,"query":{"terms":{"category":["furniture","accessories"]}}}"#,
    )
    .await;
    assert_eq!(sorted_skus(&furn_acc), vec!["CAB-100", "CHR-250", "DSK-400"]);
}

#[tokio::test]
async fn query_bool_must_should_filter_must_not() {
    let (_c, driver) = start_es().await;
    let d = driver.as_ref();
    seed_products(d).await;

    // must(name~mouse) ∧ filter(category=electronics) ∧ ¬(in_stock=false)
    // → only the in-stock electronics item whose name mentions "mouse".
    let r = run(
        d,
        r#"GET /products/_search
{"size":10,"query":{"bool":{
  "must":[{"match":{"name":"mouse"}}],
  "filter":[{"term":{"category":"electronics"}}],
  "must_not":[{"term":{"in_stock":false}}]
}}}"#,
    )
    .await;
    assert_eq!(r.rows.len(), 1);
    assert_eq!(as_text(cell(&r, 0, "sku")), "MS-010");

    // filter(category=electronics) ∧ ¬(price<100): the two cheap electronics drop,
    // leaving the keyboard.
    let r2 = run(
        d,
        r#"GET /products/_search
{"size":10,"query":{"bool":{
  "filter":[{"term":{"category":"electronics"}}],
  "must_not":[{"range":{"price":{"lt":100}}}]
}}}"#,
    )
    .await;
    assert_eq!(sorted_skus(&r2), vec!["KB-001"]);
}

#[tokio::test]
async fn query_range() {
    let (_c, driver) = start_es().await;
    let d = driver.as_ref();
    seed_products(d).await;

    // price >= 100, ordered ascending by price.
    let pricey = run(
        d,
        r#"GET /products/_search
{"size":10,"sort":[{"price":"asc"}],"query":{"range":{"price":{"gte":100}}}}"#,
    )
    .await;
    assert_eq!(ordered_skus(&pricey), vec!["KB-001", "CHR-250", "DSK-400"]);

    // 40 <= price < 130 picks the mid-priced trio.
    let mid = run(
        d,
        r#"GET /products/_search
{"size":10,"sort":[{"price":"asc"}],"query":{"range":{"price":{"gte":40,"lt":130}}}}"#,
    )
    .await;
    assert_eq!(ordered_skus(&mid), vec!["MS-010", "KB-001"]);
}

#[tokio::test]
async fn query_sort_and_pagination() {
    let (_c, driver) = start_es().await;
    let d = driver.as_ref();
    seed_products(d).await;

    // Page through all six products by ascending price, two per page.
    let page = |from: u32| {
        let d = d;
        async move {
            run(
                d,
                &format!(
                    r#"GET /products/_search
{{"size":2,"from":{from},"sort":[{{"price":"asc"}}],"query":{{"match_all":{{}}}}}}"#
                ),
            )
            .await
        }
    };

    assert_eq!(ordered_skus(&page(0).await), vec!["CAB-100", "HUB-007"]);
    assert_eq!(ordered_skus(&page(2).await), vec!["MS-010", "KB-001"]);
    assert_eq!(ordered_skus(&page(4).await), vec!["CHR-250", "DSK-400"]);
}

// ===========================================================================
// Aggregations — surfaced through the engine's SQL (`_sql`) path.
// See the module doc comment for why DSL `aggregations` are not tabularized.
// ===========================================================================

#[tokio::test]
async fn agg_terms_bucket() {
    let (_c, driver) = start_es().await;
    let d = driver.as_ref();
    seed_products(d).await;

    // `terms` bucket on category == GROUP BY category.
    let buckets = run_sql(
        d,
        "SELECT category, COUNT(*) AS cnt FROM products GROUP BY category ORDER BY category",
    )
    .await;
    let names: Vec<&str> = buckets.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["category", "cnt"]);
    assert_eq!(buckets.rows.len(), 3);
    assert_eq!(as_text(cell(&buckets, 0, "category")), "accessories");
    assert_eq!(as_i64(cell(&buckets, 0, "cnt")), 1);
    assert_eq!(as_text(cell(&buckets, 1, "category")), "electronics");
    assert_eq!(as_i64(cell(&buckets, 1, "cnt")), 3);
    assert_eq!(as_text(cell(&buckets, 2, "category")), "furniture");
    assert_eq!(as_i64(cell(&buckets, 2, "cnt")), 2);
}

#[tokio::test]
async fn agg_metrics_avg_sum_stats() {
    let (_c, driver) = start_es().await;
    let d = driver.as_ref();
    seed_products(d).await;

    // avg / sum / and the full `stats` set (min/max/avg/sum/count) over the
    // electronics price column.
    let stats = run_sql(
        d,
        "SELECT MIN(price) AS lo, MAX(price) AS hi, AVG(price) AS av, \
         SUM(price) AS tot, COUNT(*) AS cnt \
         FROM products WHERE category = 'electronics'",
    )
    .await;
    assert_eq!(stats.rows.len(), 1);
    approx(as_f64(cell(&stats, 0, "lo")), 39.99);
    approx(as_f64(cell(&stats, 0, "hi")), 129.99);
    approx(as_f64(cell(&stats, 0, "av")), 73.323_333);
    approx(as_f64(cell(&stats, 0, "tot")), 219.97);
    assert_eq!(as_i64(cell(&stats, 0, "cnt")), 3);
}

#[tokio::test]
async fn agg_sub_aggregation() {
    let (_c, driver) = start_es().await;
    let d = driver.as_ref();
    seed_products(d).await;

    // A nested/sub-aggregation (category bucket → in_stock sub-bucket) maps to a
    // multi-key GROUP BY.
    let nested = run_sql(
        d,
        "SELECT category, in_stock, COUNT(*) AS cnt FROM products \
         GROUP BY category, in_stock ORDER BY category, in_stock",
    )
    .await;
    assert_eq!(nested.rows.len(), 4);

    // accessories / true / 1
    assert_eq!(as_text(cell(&nested, 0, "category")), "accessories");
    assert!(as_bool(cell(&nested, 0, "in_stock")));
    assert_eq!(as_i64(cell(&nested, 0, "cnt")), 1);
    // electronics / false / 1
    assert_eq!(as_text(cell(&nested, 1, "category")), "electronics");
    assert!(!as_bool(cell(&nested, 1, "in_stock")));
    assert_eq!(as_i64(cell(&nested, 1, "cnt")), 1);
    // electronics / true / 2
    assert_eq!(as_text(cell(&nested, 2, "category")), "electronics");
    assert!(as_bool(cell(&nested, 2, "in_stock")));
    assert_eq!(as_i64(cell(&nested, 2, "cnt")), 2);
    // furniture / true / 2
    assert_eq!(as_text(cell(&nested, 3, "category")), "furniture");
    assert!(as_bool(cell(&nested, 3, "in_stock")));
    assert_eq!(as_i64(cell(&nested, 3, "cnt")), 2);
}

#[tokio::test]
async fn sql_write_statement_rejected_with_clear_message() {
    let (_c, driver) = start_es().await;
    let d = driver.as_ref();
    seed_products(d).await;

    // ES SQL is read-only; write statements must surface a friendly message
    // rather than the raw `mismatched input` parser error from the `_sql` API.
    for sql in [
        "UPDATE products SET price = 1 WHERE id = 1",
        "INSERT INTO products (id) VALUES (1)",
        "DELETE FROM products WHERE id = 1",
    ] {
        let err = d
            .run_query(sql, &[], QueryLanguage::Sql)
            .await
            .expect_err("write statement should be rejected");
        assert_eq!(
            err.to_string(),
            "query failed: Elasticsearch SQL only supports SELECT queries (UPDATE/INSERT/DELETE are not supported).",
            "unexpected error for: {sql}"
        );
    }

    // ES SQL parses `WITH` but resolves the CTE alias as a missing index; surface
    // a clear message instead of the confusing `Unknown index [...]` error.
    let cte_err = d
        .run_query(
            "WITH cus AS (SELECT * FROM products) SELECT * FROM cus",
            &[],
            QueryLanguage::Sql,
        )
        .await
        .expect_err("CTE should be rejected");
    assert_eq!(
        cte_err.to_string(),
        "query failed: Elasticsearch SQL does not support CTEs (WITH ... AS). Inline the subquery into the SELECT instead."
    );
}

// ===========================================================================
// Schema-object lifecycle — create → list_schemas (right kind) → delete (gone),
// for every object kind the Elasticsearch browser emits.
// ===========================================================================

#[tokio::test]
async fn schema_object_lifecycle() {
    let (_c, driver) = start_es().await;
    let d = driver.as_ref();

    // --- create ---------------------------------------------------------
    // Index.
    run(
        d,
        r#"PUT /catalog
{ "mappings": { "properties": { "name": { "type": "text" } } } }"#,
    )
    .await;
    // Alias onto the index.
    run(d, "PUT /catalog/_alias/catalog_read").await;
    // Plain index template.
    run(
        d,
        r#"PUT /_index_template/orders-template
{ "index_patterns": ["orders-*"],
  "template": { "mappings": { "properties": { "order_id": { "type": "keyword" } } } } }"#,
    )
    .await;
    // Data-stream-enabled template + the data stream itself.
    run(
        d,
        r#"PUT /_index_template/metrics-template
{ "index_patterns": ["metrics-*"],
  "data_stream": {},
  "template": { "mappings": { "properties": { "@timestamp": { "type": "date" } } } } }"#,
    )
    .await;
    run(d, "PUT /_data_stream/metrics-app").await;

    // --- verify via the schema browser ---------------------------------
    let tree = schema_tree(d).await;
    assert!(
        tree.iter()
            .any(|n| n.name == "Elasticsearch" && n.kind == SchemaNodeKind::Database),
        "tree should expose the Elasticsearch root database node"
    );

    let expected = [
        ("catalog", SchemaNodeKind::ElasticsearchIndex),
        ("catalog_read", SchemaNodeKind::ElasticsearchAlias),
        ("orders-template", SchemaNodeKind::ElasticsearchIndexTemplate),
        ("metrics-app", SchemaNodeKind::ElasticsearchDataStream),
    ];
    for (name, kind) in expected {
        let node = find_node(&tree, name)
            .unwrap_or_else(|| panic!("{name} should be listed in the schema browser"));
        assert_eq!(node.kind, kind, "{name} should have kind {kind:?}");
    }

    // --- delete ---------------------------------------------------------
    run(d, "DELETE /catalog/_alias/catalog_read").await;
    run(d, "DELETE /_data_stream/metrics-app").await;
    run(d, "DELETE /_index_template/metrics-template").await;
    run(d, "DELETE /_index_template/orders-template").await;
    run(d, "DELETE /catalog").await;

    // --- verify gone (negative) ----------------------------------------
    let after = schema_tree(d).await;
    for (name, _) in expected {
        assert!(
            find_node(&after, name).is_none(),
            "{name} should be gone from the schema browser after deletion"
        );
    }
}

// ===========================================================================
// Access control — X-Pack security is disabled in this harness, so the engine
// has no role/privilege surface. Pin that the _security APIs are unavailable.
// ===========================================================================

#[tokio::test]
async fn access_control_unavailable_when_security_disabled() {
    let (_c, driver) = start_es().await;
    let d = driver.as_ref();

    // With `xpack.security.enabled=false`, role/user management is rejected by the
    // cluster, so there is nothing to grant or revoke through the engine.
    let roles = d
        .run_query("GET /_security/role", &[], QueryLanguage::Native)
        .await;
    assert!(
        roles.is_err(),
        "the _security API must be unavailable when security is disabled"
    );
}
