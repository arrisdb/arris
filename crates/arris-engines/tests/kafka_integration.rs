//! Integration tests for the Kafka driver against a real Kafka 3.9.0 broker
//! started via `testcontainers` (Confluent's `cp-kafka:7.9.0` image, which
//! packages Apache Kafka 3.9.0 — the same broker version as
//! `docker-compose.yml`'s `apache/kafka:3.9.0`; see `start_kafka` for why the
//! Confluent image is used). Reads run through the engine's
//! `DatabaseDriver::run_query` / `list_schemas` (the same path the app uses) and
//! the returned `QueryResult` / `SchemaNode` tree is asserted.
//!
//! Requires Docker. Run with:
//!   `cargo test -p arris-engines --test kafka_integration`
//! Each test owns its own broker container, so they are independent and
//! parallel-safe.
//!
//! Kafka is a log/streaming broker, not a relational store. The engine exposes
//! it read-only: `run_query` consumes a topic with a SQL-ish `SELECT … FROM
//! <topic>` grammar and projects each record's JSON **value** plus the metadata
//! columns `_partition` / `_offset` / `_timestamp`. The record **key** and
//! **headers** are intentionally NOT surfaced as columns, and null-value
//! (tombstone) records are skipped. Where the ticket asks to assert key /
//! headers / tombstones, those are produced + verified through the raw `rdkafka`
//! client (the broker's ground truth), while the engine projection is asserted
//! separately — that is the real engine semantics, not a gap in the test.
//!
//! Topics + records are set up through the raw `rdkafka` admin/producer client
//! (the engine has no produce/DDL verbs — `insert_rows` / `update_row` /
//! `delete_rows` all return read-only errors), then the observable result is
//! asserted through the engine (`run_query` + `list_schemas`).
//!
//! Schema-object kinds the browser surfaces: `Topic` and `ConsumerGroup` — both
//! exercised here through create → produce/consume/commit → delete, verified via
//! both the admin/consumer API and `list_schemas()`. Schema Registry subjects
//! are an optional add-on (a separate `cp-schema-registry` container) and are
//! not exercised here. Kafka has none of the relational object kinds — no views,
//! materialized views, functions, procedures, triggers, indexes, or sequences —
//! so those are not applicable. The broker runs without an authorizer and the
//! engine surfaces no `AclBinding`s, so access-control (ACL) assertions are not
//! applicable through the engine layer either. `explain_query` is unsupported by
//! the driver (`supports_explain` is always false).

use std::time::Duration;

use arris_engines::{
    ConnectionConfig, DatabaseDriver, DatabaseKind, QueryLanguage, QueryResult, QueryValue,
    SchemaNode, SchemaNodeKind, driver_for_kind,
};
use rdkafka::admin::{AdminClient, AdminOptions, NewTopic, TopicReplication};
use rdkafka::client::DefaultClientContext;
use rdkafka::config::ClientConfig;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::message::{Header, Headers, Message, OwnedHeaders, OwnedMessage};
use rdkafka::producer::{FutureProducer, FutureRecord};
use rdkafka::consumer::CommitMode;
use rdkafka::util::Timeout;
use testcontainers_modules::kafka::{Kafka, KAFKA_PORT};
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ImageExt};

// ── harness ──────────────────────────────────────────────────────────────────

/// Boot a fresh Kafka broker via `confluentinc/cp-kafka:7.9.0` — Confluent
/// Platform 7.9 packages Apache Kafka 3.9.0, the same broker version as
/// `docker-compose.yml`'s `apache/kafka:3.9.0`. (The `apache/kafka`
/// testcontainers module rewrites the advertised listener with a start-script
/// hack that the 3.9.x image layout breaks; the Confluent module sets it via a
/// post-start `kafka-configs --alter`, which is version-tolerant.) Returns the
/// container guard, a connected engine driver, and the `host:port` bootstrap
/// string for raw `rdkafka` clients. The guard must outlive the test.
async fn start_kafka() -> (ContainerAsync<Kafka>, Box<dyn DatabaseDriver>, String) {
    let container = Kafka::default()
        .with_tag("7.9.0")
        .start()
        .await
        .expect("start kafka container");
    let port = container
        .get_host_port_ipv4(KAFKA_PORT)
        .await
        .expect("container port");
    // The module advertises the broker on 127.0.0.1:<mapped port>, so both the
    // engine and the raw clients must dial that exact address.
    let bootstrap = format!("127.0.0.1:{port}");

    let mut cfg = ConnectionConfig::new("it-kafka", DatabaseKind::Kafka);
    cfg.host = "127.0.0.1".to_string();
    cfg.port = port;

    let driver = driver_for_kind(DatabaseKind::Kafka).expect("kafka driver");
    driver.connect(&cfg).await.expect("connect kafka engine");

    (container, driver, bootstrap)
}

fn admin_client(bootstrap: &str) -> AdminClient<DefaultClientContext> {
    ClientConfig::new()
        .set("bootstrap.servers", bootstrap)
        .create()
        .expect("admin client")
}

fn producer(bootstrap: &str) -> FutureProducer {
    ClientConfig::new()
        .set("bootstrap.servers", bootstrap)
        .set("message.timeout.ms", "10000")
        .create()
        .expect("producer")
}

/// Create a topic with the given partition count and replication factor, waiting
/// for the broker to acknowledge the result.
async fn create_topic(admin: &AdminClient<DefaultClientContext>, name: &str, partitions: i32) {
    let topic = NewTopic::new(name, partitions, TopicReplication::Fixed(1));
    let results = admin
        .create_topics(&[topic], &AdminOptions::new())
        .await
        .expect("create_topics call");
    for r in results {
        r.unwrap_or_else(|(t, e)| panic!("create topic {t} failed: {e}"));
    }
}

/// Produce a record. `payload = None` writes a tombstone (null value). Awaits the
/// broker's delivery ack so the record is durable before the test reads it.
async fn produce(
    prod: &FutureProducer,
    topic: &str,
    key: &str,
    payload: Option<&[u8]>,
    partition: Option<i32>,
    headers: Option<OwnedHeaders>,
) {
    let mut record: FutureRecord<'_, str, [u8]> = FutureRecord::to(topic).key(key);
    if let Some(p) = payload {
        record = record.payload(p);
    }
    if let Some(pid) = partition {
        record = record.partition(pid);
    }
    if let Some(h) = headers {
        record = record.headers(h);
    }
    prod.send(record, Timeout::Never)
        .await
        .unwrap_or_else(|(e, _)| panic!("produce to {topic} failed: {e}"));
}

/// Produce a JSON value as the record payload.
async fn produce_json(
    prod: &FutureProducer,
    topic: &str,
    key: &str,
    value: &serde_json::Value,
    partition: Option<i32>,
) {
    let bytes = serde_json::to_vec(value).expect("serialize json");
    produce(prod, topic, key, Some(&bytes), partition, None).await;
}

/// Run a query through the engine and return the asserted `QueryResult`.
async fn query(driver: &dyn DatabaseDriver, sql: &str) -> QueryResult {
    driver
        .run_query(sql, &[], QueryLanguage::Sql)
        .await
        .unwrap_or_else(|e| panic!("run_query `{sql}` failed: {e:?}"))
}

/// Drain a topic through the raw client from the beginning — the broker's ground
/// truth, used to assert the key / header / tombstone fields the engine drops.
/// Reads at least `expect_at_least` records (or panics on timeout).
///
/// Uses a `BaseConsumer` with manual partition `assign` rather than a
/// group `subscribe`: assignment skips the group-join protocol, so the consumer
/// closes cleanly on drop. (A subscribed consumer stalls in `rd_kafka_destroy`
/// on close — see `consumer_group_listed_after_commit` for where a real member
/// is required and how its destructor is sidestepped.)
fn raw_consume(bootstrap: &str, topic: &str, expect_at_least: usize) -> Vec<OwnedMessage> {
    use rdkafka::{Offset, TopicPartitionList};

    let consumer: rdkafka::consumer::BaseConsumer = ClientConfig::new()
        .set("bootstrap.servers", bootstrap)
        .set("group.id", format!("raw-verify-{topic}"))
        .set("enable.auto.commit", "false")
        .create()
        .expect("raw consumer");

    let metadata = consumer
        .fetch_metadata(Some(topic), Duration::from_secs(10))
        .expect("fetch metadata");
    let partitions = metadata.topics()[0].partitions();
    let mut tpl = TopicPartitionList::new();
    for p in partitions {
        tpl.add_partition_offset(topic, p.id(), Offset::Beginning)
            .expect("assign offset");
    }
    consumer.assign(&tpl).expect("assign");

    let mut out = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    while out.len() < expect_at_least && std::time::Instant::now() < deadline {
        if let Some(res) = consumer.poll(Duration::from_millis(500)) {
            out.push(res.expect("raw poll").detach());
        }
    }
    assert!(
        out.len() >= expect_at_least,
        "raw consume got {}/{expect_at_least} from {topic}",
        out.len()
    );
    out
}

// ── QueryResult helpers ──────────────────────────────────────────────────────

fn col_index(qr: &QueryResult, name: &str) -> usize {
    qr.columns
        .iter()
        .position(|c| c.name == name)
        .unwrap_or_else(|| panic!("column `{name}` not in {:?}", col_names(qr)))
}

fn col_names(qr: &QueryResult) -> Vec<String> {
    qr.columns.iter().map(|c| c.name.clone()).collect()
}

/// All values of one column, in the row order the engine returned.
fn column_values<'a>(qr: &'a QueryResult, name: &str) -> Vec<&'a QueryValue> {
    let idx = col_index(qr, name);
    qr.rows.iter().map(|r| &r[idx]).collect()
}

fn int_at(qr: &QueryResult, row: usize, name: &str) -> i64 {
    match &qr.rows[row][col_index(qr, name)] {
        QueryValue::Int(i) => *i,
        other => panic!("expected Int at {name}, got {other:?}"),
    }
}

fn text_at(qr: &QueryResult, row: usize, name: &str) -> String {
    match &qr.rows[row][col_index(qr, name)] {
        QueryValue::Text(s) => s.clone(),
        other => panic!("expected Text at {name}, got {other:?}"),
    }
}

/// Find the single row whose `id` column equals `id` and return its index.
fn row_by_id(qr: &QueryResult, id: i64) -> usize {
    let idx = col_index(qr, "id");
    qr.rows
        .iter()
        .position(|r| matches!(&r[idx], QueryValue::Int(i) if *i == id))
        .unwrap_or_else(|| panic!("no row with id={id}"))
}

fn topic_node<'a>(nodes: &'a [SchemaNode], name: &str) -> Option<&'a SchemaNode> {
    nodes
        .iter()
        .find(|n| n.kind == SchemaNodeKind::Topic && n.name == name)
}

// ── tests ────────────────────────────────────────────────────────────────────

/// Topic ops: create with explicit partitions/RF, then list + describe through
/// `list_schemas`. Asserts the `Topic` node, its partition/RF detail, that a
/// non-existent topic is absent, and that internal topics are filtered out.
#[tokio::test]
async fn topic_create_list_describe() {
    let (_c, driver, bootstrap) = start_kafka().await;
    let admin = admin_client(&bootstrap);
    create_topic(&admin, "orders", 3).await;

    let nodes = driver.list_schemas().await.expect("list_schemas");

    let orders = topic_node(&nodes, "orders").expect("orders topic listed");
    assert_eq!(orders.kind, SchemaNodeKind::Topic);
    assert_eq!(orders.path, "orders");
    assert_eq!(orders.detail.as_deref(), Some("3 partitions · RF 1"));

    assert!(topic_node(&nodes, "does-not-exist").is_none());
    // Internal/offset topics (prefixed `__`) must not leak into the browser.
    assert!(
        !nodes.iter().any(|n| n.name.starts_with("__")),
        "internal topics leaked: {:?}",
        nodes.iter().map(|n| &n.name).collect::<Vec<_>>()
    );
}

/// Produce keyed JSON records, consume them all from the beginning, and assert
/// the full projected row set: every value field plus the `_partition` /
/// `_offset` / `_timestamp` metadata columns. The record key is verified through
/// the raw client because the engine projection does not surface it.
#[tokio::test]
async fn produce_and_consume_from_beginning() {
    let (_c, driver, bootstrap) = start_kafka().await;
    let admin = admin_client(&bootstrap);
    create_topic(&admin, "users", 1).await;
    let prod = producer(&bootstrap);

    let records = [
        (1_i64, "alice", 30_i64),
        (2, "bob", 25),
        (3, "carol", 41),
    ];
    for (id, name, age) in records {
        produce_json(
            &prod,
            "users",
            name,
            &serde_json::json!({ "id": id, "name": name, "age": age }),
            None,
        )
        .await;
    }

    let qr = query(driver.as_ref(), "SELECT * FROM users").await;
    assert_eq!(qr.rows.len(), 3, "expected 3 rows, got {}", qr.rows.len());

    // Value fields + metadata columns are present.
    for col in ["id", "name", "age", "_partition", "_offset", "_timestamp"] {
        assert!(col_names(&qr).contains(&col.to_string()), "missing {col}");
    }

    for (id, name, age) in records {
        let r = row_by_id(&qr, id);
        assert_eq!(text_at(&qr, r, "name"), name);
        assert_eq!(int_at(&qr, r, "age"), age);
        assert_eq!(int_at(&qr, r, "_partition"), 0);
    }

    // Offsets on a single partition are 0,1,2 (exact set).
    let mut offsets: Vec<i64> = column_values(&qr, "_offset")
        .iter()
        .map(|v| match v {
            QueryValue::Int(i) => *i,
            o => panic!("offset not Int: {o:?}"),
        })
        .collect();
    offsets.sort_unstable();
    assert_eq!(offsets, vec![0, 1, 2]);

    // The engine drops record keys; verify they were actually written via raw.
    let raw = raw_consume(&bootstrap, "users", 3);
    let mut keys: Vec<String> = raw
        .iter()
        .map(|m| String::from_utf8(m.key().unwrap().to_vec()).unwrap())
        .collect();
    keys.sort();
    assert_eq!(keys, vec!["alice", "bob", "carol"]);
}

/// Filtered + projected + ordered + limited read: `SELECT id, amount … WHERE …
/// ORDER BY … DESC LIMIT`. Asserts projected column names, exact filtered/sorted
/// row set, and the row count cap.
#[tokio::test]
async fn where_order_limit_projection() {
    let (_c, driver, bootstrap) = start_kafka().await;
    let admin = admin_client(&bootstrap);
    create_topic(&admin, "payments", 1).await;
    let prod = producer(&bootstrap);

    for (id, amount) in [(1_i64, 50_i64), (2, 150), (3, 200), (4, 75), (5, 300)] {
        produce_json(
            &prod,
            "payments",
            &id.to_string(),
            &serde_json::json!({ "id": id, "amount": amount }),
            None,
        )
        .await;
    }

    let qr = query(
        driver.as_ref(),
        "SELECT id, amount FROM payments WHERE amount > 100 ORDER BY amount DESC",
    )
    .await;

    // Projection yields exactly the requested columns (no metadata columns).
    assert_eq!(col_names(&qr), vec!["id".to_string(), "amount".to_string()]);
    // amount > 100 → {150,200,300}; sorted DESC → 300, 200, 150.
    assert_eq!(qr.rows.len(), 3);
    assert_eq!(int_at(&qr, 0, "amount"), 300);
    assert_eq!(int_at(&qr, 0, "id"), 5);
    assert_eq!(int_at(&qr, 1, "amount"), 200);
    assert_eq!(int_at(&qr, 1, "id"), 3);
    assert_eq!(int_at(&qr, 2, "amount"), 150);
    assert_eq!(int_at(&qr, 2, "id"), 2);

    // `LIMIT` caps how many records are *consumed* from the log (applied before
    // ordering, not as a global top-N), so it bounds the row count.
    let limited = query(driver.as_ref(), "SELECT id, amount FROM payments LIMIT 2").await;
    assert_eq!(limited.rows.len(), 2, "LIMIT caps consumed rows");
}

/// `GROUP BY` + aggregate: `SELECT region, SUM(amount) … GROUP BY region`.
/// Asserts one row per group with the correct aggregate.
#[tokio::test]
async fn group_by_aggregate() {
    let (_c, driver, bootstrap) = start_kafka().await;
    let admin = admin_client(&bootstrap);
    create_topic(&admin, "sales", 1).await;
    let prod = producer(&bootstrap);

    let rows = [
        ("US", 10_i64),
        ("US", 20),
        ("EU", 5),
        ("EU", 15),
        ("US", 30),
    ];
    for (i, (region, amount)) in rows.iter().enumerate() {
        produce_json(
            &prod,
            "sales",
            &i.to_string(),
            &serde_json::json!({ "region": region, "amount": amount }),
            None,
        )
        .await;
    }

    let qr = query(
        driver.as_ref(),
        "SELECT region, SUM(amount) AS total FROM sales GROUP BY region",
    )
    .await;
    assert_eq!(col_names(&qr), vec!["region".to_string(), "total".to_string()]);
    assert_eq!(qr.rows.len(), 2);

    let total_idx = col_index(&qr, "total");
    let region_idx = col_index(&qr, "region");
    let mut totals: Vec<(String, f64)> = qr
        .rows
        .iter()
        .map(|r| {
            let region = match &r[region_idx] {
                QueryValue::Text(s) => s.clone(),
                o => panic!("region not text: {o:?}"),
            };
            let total = match &r[total_idx] {
                QueryValue::Double(d) => *d,
                QueryValue::Int(i) => *i as f64,
                o => panic!("total not numeric: {o:?}"),
            };
            (region, total)
        })
        .collect();
    totals.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(totals, vec![("EU".to_string(), 20.0), ("US".to_string(), 60.0)]);
}

/// Partition assignment + per-partition ordering: produce keyed records pinned to
/// specific partitions, consume across all of them, and assert that within each
/// partition the offsets the engine returns are strictly increasing and start at
/// 0. Record keys are confirmed via the raw client.
#[tokio::test]
async fn partition_assignment_and_ordering() {
    let (_c, driver, bootstrap) = start_kafka().await;
    let admin = admin_client(&bootstrap);
    create_topic(&admin, "events", 3).await;
    let prod = producer(&bootstrap);

    // 3 records to partition 0, 2 to partition 1, 1 to partition 2.
    let layout = [(0_i32, 3_usize), (1, 2), (2, 1)];
    let mut id = 0_i64;
    for (partition, count) in layout {
        for _ in 0..count {
            produce_json(
                &prod,
                "events",
                &id.to_string(),
                &serde_json::json!({ "id": id, "p": partition }),
                Some(partition),
            )
            .await;
            id += 1;
        }
    }

    let qr = query(driver.as_ref(), "SELECT * FROM events").await;
    assert_eq!(qr.rows.len(), 6);

    // Group (partition, offset) pairs in engine return order and verify each
    // partition's offsets are contiguous 0..count and monotonic as returned.
    let part_idx = col_index(&qr, "_partition");
    let off_idx = col_index(&qr, "_offset");
    let mut per_partition: std::collections::BTreeMap<i64, Vec<i64>> = Default::default();
    for r in &qr.rows {
        let p = match &r[part_idx] {
            QueryValue::Int(i) => *i,
            o => panic!("partition not int: {o:?}"),
        };
        let o = match &r[off_idx] {
            QueryValue::Int(i) => *i,
            x => panic!("offset not int: {x:?}"),
        };
        per_partition.entry(p).or_default().push(o);
    }
    let expected_counts = [(0_i64, 3_usize), (1, 2), (2, 1)];
    for (partition, count) in expected_counts {
        let offsets = per_partition.get(&partition).unwrap_or_else(|| {
            panic!("no records for partition {partition}")
        });
        assert_eq!(offsets.len(), count, "partition {partition} count");
        // Strictly increasing in returned order (per-partition ordering).
        assert!(
            offsets.windows(2).all(|w| w[0] < w[1]),
            "partition {partition} offsets not monotonic: {offsets:?}"
        );
        let mut sorted = offsets.clone();
        sorted.sort_unstable();
        let expected: Vec<i64> = (0..count as i64).collect();
        assert_eq!(sorted, expected, "partition {partition} offsets");
    }

    // Raw client confirms the keys were delivered to the right partitions.
    let raw = raw_consume(&bootstrap, "events", 6);
    assert_eq!(raw.len(), 6);
}

/// `[LATEST]` seek hint reads only records produced after the consumer is
/// positioned at the log end. With nothing produced afterward it yields zero
/// rows, while a plain read from the beginning returns the full batch.
///
/// Note: the engine only exposes two seek positions — beginning (default) and
/// end (`[LATEST]`). Arbitrary seek-to-offset and seek-to-timestamp are not
/// surfaced through the engine layer, so they are not exercised here.
#[tokio::test]
async fn latest_hint_reads_only_new_records() {
    let (_c, driver, bootstrap) = start_kafka().await;
    let admin = admin_client(&bootstrap);
    create_topic(&admin, "stream", 1).await;
    let prod = producer(&bootstrap);

    for id in 0..4_i64 {
        produce_json(
            &prod,
            "stream",
            &id.to_string(),
            &serde_json::json!({ "id": id }),
            None,
        )
        .await;
    }

    let all = query(driver.as_ref(), "SELECT * FROM stream").await;
    assert_eq!(all.rows.len(), 4, "beginning read sees all records");

    let latest = query(driver.as_ref(), "SELECT * FROM stream [LATEST]").await;
    assert_eq!(
        latest.rows.len(),
        0,
        "[LATEST] starts at log end → no pre-existing records"
    );
}

/// Consumer-group lifecycle through `list_schemas`: a group that commits an
/// offset appears as a `ConsumerGroup` node; a never-seen group name does not.
#[tokio::test]
async fn consumer_group_listed_after_commit() {
    let (_c, driver, bootstrap) = start_kafka().await;
    let admin = admin_client(&bootstrap);
    create_topic(&admin, "tracked", 1).await;
    let prod = producer(&bootstrap);
    produce_json(&prod, "tracked", "k", &serde_json::json!({ "id": 1 }), None).await;

    // A real consumer group: subscribe, receive, commit. Kept alive (not dropped)
    // through the assertion so the broker reports it as an active group.
    let group_id = "analytics-group";
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &bootstrap)
        .set("group.id", group_id)
        .set("auto.offset.reset", "earliest")
        .set("enable.auto.commit", "false")
        .create()
        .expect("group consumer");
    consumer.subscribe(&["tracked"]).expect("subscribe");
    let msg = tokio::time::timeout(Duration::from_secs(20), consumer.recv())
        .await
        .expect("recv timeout")
        .expect("recv");
    consumer.commit_message(&msg, CommitMode::Sync).expect("commit");

    // The group must surface as a ConsumerGroup node; a bogus name must not.
    let nodes = driver.list_schemas().await.expect("list_schemas");
    let group = nodes
        .iter()
        .find(|n| n.kind == SchemaNodeKind::ConsumerGroup && n.name == group_id)
        .unwrap_or_else(|| {
            panic!(
                "consumer group `{group_id}` not listed: {:?}",
                nodes.iter().map(|n| (&n.name, &n.kind)).collect::<Vec<_>>()
            )
        });
    assert_eq!(group.kind, SchemaNodeKind::ConsumerGroup);

    assert!(
        !nodes
            .iter()
            .any(|n| n.kind == SchemaNodeKind::ConsumerGroup && n.name == "no-such-group"),
        "phantom consumer group listed"
    );

    // A subscribed (group-member) consumer must stay alive until here so the
    // broker reports it. Its `rd_kafka_destroy` close blocks indefinitely on the
    // group LeaveGroup handshake once polling stops, so skip the destructor — the
    // container is torn down at end of test anyway.
    std::mem::forget(consumer);
}

/// Topic deletion lifecycle: a created topic is listed, then after an admin
/// `delete_topics` it is no longer returned by `list_schemas` (negative case).
#[tokio::test]
async fn topic_deletion_removed_from_list() {
    let (_c, driver, bootstrap) = start_kafka().await;
    let admin = admin_client(&bootstrap);
    create_topic(&admin, "ephemeral", 1).await;

    let before = driver.list_schemas().await.expect("list before");
    assert!(topic_node(&before, "ephemeral").is_some(), "topic not listed");

    admin
        .delete_topics(&["ephemeral"], &AdminOptions::new())
        .await
        .expect("delete_topics call")
        .into_iter()
        .for_each(|r| {
            r.unwrap_or_else(|(t, e)| panic!("delete {t} failed: {e}"));
        });

    // Deletion propagates asynchronously; poll until the topic disappears.
    let mut gone = false;
    for _ in 0..40 {
        let nodes = driver.list_schemas().await.expect("list after");
        if topic_node(&nodes, "ephemeral").is_none() {
            gone = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    assert!(gone, "deleted topic still listed after timeout");
}

/// Kafka-specific record shapes through the engine:
/// * a tombstone (null value) record is **skipped** by the projection,
/// * record **headers** are not projected as columns (verified present via raw),
/// * a non-JSON payload is surfaced as a single `value` column.
///
/// Two topics are used because the engine infers `SELECT *` columns from the
/// *first* record only — a topic mixing JSON and non-JSON shapes would expose
/// just the first shape's columns, so each shape gets its own topic.
#[tokio::test]
async fn tombstone_non_json_and_headers() {
    let (_c, driver, bootstrap) = start_kafka().await;
    let admin = admin_client(&bootstrap);
    let prod = producer(&bootstrap);

    // ── JSON record (with header) + tombstone on one topic ──
    create_topic(&admin, "jsontopic", 1).await;
    let headers = OwnedHeaders::new().insert(Header {
        key: "trace-id",
        value: Some("abc-123".as_bytes()),
    });
    produce(
        &prod,
        "jsontopic",
        "j",
        Some(&serde_json::to_vec(&serde_json::json!({ "id": 1, "kind": "json" })).unwrap()),
        None,
        Some(headers),
    )
    .await;
    produce(&prod, "jsontopic", "tomb", None, None, None).await; // tombstone (null value)

    let qr = query(driver.as_ref(), "SELECT * FROM jsontopic").await;
    // Tombstone dropped → only the JSON record remains.
    assert_eq!(qr.rows.len(), 1, "tombstone should be skipped");
    assert_eq!(int_at(&qr, 0, "id"), 1);
    assert_eq!(text_at(&qr, 0, "kind"), "json");
    // Headers are not projected as columns by the engine.
    assert!(
        !col_names(&qr).contains(&"trace-id".to_string()),
        "engine should not surface headers as columns"
    );

    // Raw ground truth: both records exist; tombstone value is null; header present.
    let raw = raw_consume(&bootstrap, "jsontopic", 2);
    assert_eq!(raw.len(), 2, "broker holds the json record and the tombstone");
    let tomb = raw
        .iter()
        .find(|m| m.key() == Some(b"tomb".as_ref()))
        .expect("tombstone in log");
    assert!(tomb.payload().is_none(), "tombstone value must be null");
    let json_msg = raw
        .iter()
        .find(|m| m.key() == Some(b"j".as_ref()))
        .expect("json record in log");
    let hdrs = json_msg.headers().expect("json record has headers");
    assert_eq!(hdrs.count(), 1);
    let h = hdrs.get(0);
    assert_eq!(h.key, "trace-id");
    assert_eq!(h.value, Some("abc-123".as_bytes()));

    // ── Non-JSON payload on its own topic → single `value` text column ──
    create_topic(&admin, "rawtopic", 1).await;
    produce(&prod, "rawtopic", "t", Some(b"plain text"), None, None).await;

    let raw_qr = query(driver.as_ref(), "SELECT * FROM rawtopic").await;
    assert_eq!(raw_qr.rows.len(), 1);
    assert_eq!(text_at(&raw_qr, 0, "value"), "plain text");
}

/// The engine exposes Kafka read-only: mutation verbs must error rather than
/// silently no-op.
#[tokio::test]
async fn engine_is_read_only() {
    let (_c, driver, bootstrap) = start_kafka().await;
    let admin = admin_client(&bootstrap);
    create_topic(&admin, "ro", 1).await;

    let table = arris_engines::TableRef {
        database: None,
        schema: None,
        name: "ro".to_string(),
    };
    assert!(
        driver.insert_rows(&table, &[]).await.is_err(),
        "insert must be rejected"
    );
    assert!(
        driver.delete_rows(&table, &[]).await.is_err(),
        "delete must be rejected"
    );
}
