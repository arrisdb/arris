//! Integration tests for the Redis driver, executed against a real `redis:8`
//! instance via `testcontainers`. Everything runs through the engine layer
//! (`DatabaseDriver::run_query` / `list_schemas`), never the raw redis client.
//!
//! Each test owns its own container (one `start_redis()` per test) so the tests
//! are independent and parallel-safe.
//!
//! Redis is a key-value store, so the relational object kinds the CLAUDE.md bar
//! lists — tables, views, materialized views, functions, procedures, triggers,
//! sequences, indexes — do not exist here and have no analogue. The
//! schema-object lifecycle requirement is mapped onto the per-key-type
//! `SchemaNodeKind`s the browser emits (`RedisStringKey`, `RedisListKey`,
//! `RedisSetKey`, `RedisHashKey`, `RedisZsetKey`, `RedisStreamKey`) in
//! `key_type_browser_lifecycle`. `EXPLAIN` is likewise unsupported by the engine
//! (`supports_explain` returns false), so there is no plan-shape test.

use std::time::Duration;

use arris_engines::{
    ColumnSpec, ConnectionConfig, DatabaseDriver, DatabaseKind, QueryLanguage, QueryResult,
    QueryValue, SchemaNode, SchemaNodeKind, driver_for_kind,
};
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ImageExt};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async fn start_redis() -> (ContainerAsync<Redis>, Box<dyn DatabaseDriver>) {
    let container = Redis::default()
        .with_tag("8")
        .start()
        .await
        .expect("start redis container");
    let driver = connect(&container, "", "").await;
    (container, driver)
}

async fn connect(
    container: &ContainerAsync<Redis>,
    user: &str,
    password: &str,
) -> Box<dyn DatabaseDriver> {
    let host = container.get_host().await.expect("container host").to_string();
    let port = container
        .get_host_port_ipv4(6379)
        .await
        .expect("container port");

    let mut cfg = ConnectionConfig::new("it-redis", DatabaseKind::Redis);
    cfg.host = host;
    cfg.port = port;
    cfg.user = user.to_string();
    cfg.password = password.to_string();
    cfg.database = "0".to_string();

    let driver = driver_for_kind(DatabaseKind::Redis).expect("redis driver");
    driver.connect(&cfg).await.expect("connect to redis");
    driver
}

/// Run one or more native Redis commands (newline-separated). The engine returns
/// the result of the **last** command only.
async fn run(driver: &dyn DatabaseDriver, cmd: &str) -> QueryResult {
    driver
        .run_query(cmd, &[], QueryLanguage::Native)
        .await
        .unwrap_or_else(|e| panic!("command failed: {cmd}\n  error: {e:?}"))
}

/// Run the Redis SQL wrapper (`SELECT * FROM keys ...` / `SELECT * FROM "key"`).
async fn run_sql(driver: &dyn DatabaseDriver, sql: &str) -> QueryResult {
    driver
        .run_query(sql, &[], QueryLanguage::Sql)
        .await
        .unwrap_or_else(|e| panic!("sql failed: {sql}\n  error: {e:?}"))
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

fn as_text(v: &QueryValue) -> String {
    match v {
        QueryValue::Text(s) => s.clone(),
        QueryValue::Int(i) => i.to_string(),
        QueryValue::Double(d) => d.to_string(),
        QueryValue::Null => "<null>".to_string(),
        other => panic!("expected scalar, got {other:?}"),
    }
}

fn as_int(v: &QueryValue) -> i64 {
    match v {
        QueryValue::Int(i) => *i,
        QueryValue::Text(s) => s.parse().expect("int-parseable text"),
        other => panic!("expected int, got {other:?}"),
    }
}

/// The single scalar a non-collection command returns (column `result`).
fn scalar(r: &QueryResult) -> &QueryValue {
    assert_eq!(
        r.columns,
        vec![ColumnSpec::new("result", "text")],
        "scalar reply should have a single `result` column"
    );
    assert_eq!(r.rows.len(), 1, "scalar reply should have exactly one row");
    &r.rows[0][0]
}

/// The `value` column of an array reply (`index` / `value`), in reply order.
fn array_values(r: &QueryResult) -> Vec<String> {
    assert_eq!(
        r.columns,
        vec![ColumnSpec::new("index", "int"), ColumnSpec::new("value", "text")],
        "array reply should have `index` / `value` columns"
    );
    r.rows.iter().map(|row| as_text(&row[1])).collect()
}

fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}

// ---------------------------------------------------------------------------
// Schema-browser helpers
// ---------------------------------------------------------------------------

async fn schema_tree(driver: &dyn DatabaseDriver) -> Vec<SchemaNode> {
    driver.list_schemas().await.expect("list_schemas")
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
// Strings / KV
// ---------------------------------------------------------------------------

#[tokio::test]
async fn strings_set_get_mset_mget_incr_append() {
    let (_c, driver) = start_redis().await;
    let d = driver.as_ref();

    // SET reports OK and a write affects one key.
    let set = run(d, "SET greeting hello").await;
    assert_eq!(as_text(scalar(&set)), "OK");
    assert_eq!(set.rows_affected, Some(1));

    assert_eq!(as_text(scalar(&run(d, "GET greeting").await)), "hello");

    // MSET several pairs, MGET them back in order.
    run(d, "MSET a 1 b 2 c 3").await;
    let mget = run(d, "MGET a b c").await;
    assert_eq!(array_values(&mget), vec!["1", "2", "3"]);

    // INCR creates and increments an integer counter.
    assert_eq!(as_int(scalar(&run(d, "INCR hits").await)), 1);
    assert_eq!(as_int(scalar(&run(d, "INCR hits").await)), 2);
    assert_eq!(as_int(scalar(&run(d, "INCR hits").await)), 3);

    // APPEND extends a string and returns the new length.
    run(d, "SET note foo").await;
    let appended = run(d, "APPEND note bar").await;
    assert_eq!(as_int(scalar(&appended)), 6);
    assert_eq!(as_text(scalar(&run(d, "GET note").await)), "foobar");

    // A missing key reads back as null.
    assert_eq!(scalar(&run(d, "GET nope").await), &QueryValue::Null);
}

// ---------------------------------------------------------------------------
// Hashes
// ---------------------------------------------------------------------------

#[tokio::test]
async fn hashes_hset_hget_hgetall_hdel() {
    let (_c, driver) = start_redis().await;
    let d = driver.as_ref();

    // HSET returns the number of NEW fields added.
    let hset = run(d, "HSET user:1 name alice age 30 city paris").await;
    assert_eq!(as_int(scalar(&hset)), 3);
    assert_eq!(hset.rows_affected, Some(3));

    assert_eq!(as_text(scalar(&run(d, "HGET user:1 name").await)), "alice");

    // HGETALL (RESP2) is a flat [field, value, ...] array.
    let all = run(d, "HGETALL user:1").await;
    assert_eq!(
        sorted(array_values(&all)),
        sorted(vec![
            "name".into(),
            "alice".into(),
            "age".into(),
            "30".into(),
            "city".into(),
            "paris".into(),
        ])
    );

    // HDEL removes a field; the field then reads back as null.
    assert_eq!(as_int(scalar(&run(d, "HDEL user:1 city").await)), 1);
    assert_eq!(scalar(&run(d, "HGET user:1 city").await), &QueryValue::Null);
    assert_eq!(as_int(scalar(&run(d, "HLEN user:1").await)), 2);
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

#[tokio::test]
async fn lists_push_range_pop() {
    let (_c, driver) = start_redis().await;
    let d = driver.as_ref();

    // RPUSH appends to the tail, LPUSH prepends to the head.
    assert_eq!(as_int(scalar(&run(d, "RPUSH q a b c").await)), 3);
    assert_eq!(as_int(scalar(&run(d, "LPUSH q z").await)), 4);

    // Full ordered contents.
    let range = run(d, "LRANGE q 0 -1").await;
    assert_eq!(array_values(&range), vec!["z", "a", "b", "c"]);

    // LPOP removes from the head.
    assert_eq!(as_text(scalar(&run(d, "LPOP q").await)), "z");
    assert_eq!(array_values(&run(d, "LRANGE q 0 -1").await), vec!["a", "b", "c"]);
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

#[tokio::test]
async fn sets_add_members_inter_union() {
    let (_c, driver) = start_redis().await;
    let d = driver.as_ref();

    assert_eq!(as_int(scalar(&run(d, "SADD s1 a b c").await)), 3);
    assert_eq!(as_int(scalar(&run(d, "SADD s2 b c d").await)), 3);

    // SMEMBERS / SINTER / SUNION are unordered — compare as sorted sets.
    assert_eq!(sorted(array_values(&run(d, "SMEMBERS s1").await)), vec!["a", "b", "c"]);
    assert_eq!(sorted(array_values(&run(d, "SINTER s1 s2").await)), vec!["b", "c"]);
    assert_eq!(
        sorted(array_values(&run(d, "SUNION s1 s2").await)),
        vec!["a", "b", "c", "d"]
    );
}

// ---------------------------------------------------------------------------
// Sorted sets
// ---------------------------------------------------------------------------

#[tokio::test]
async fn sorted_sets_add_range_byscore_rank() {
    let (_c, driver) = start_redis().await;
    let d = driver.as_ref();

    assert_eq!(as_int(scalar(&run(d, "ZADD board 1 a 2 b 3 c 4 d").await)), 4);

    // ZRANGE (no WITHSCORES) yields members in score order.
    assert_eq!(
        array_values(&run(d, "ZRANGE board 0 -1").await),
        vec!["a", "b", "c", "d"]
    );

    // ZRANGEBYSCORE restricts to an inclusive score window.
    assert_eq!(
        array_values(&run(d, "ZRANGEBYSCORE board 2 3").await),
        vec!["b", "c"]
    );

    // ZRANK is the zero-based position in score order.
    assert_eq!(as_int(scalar(&run(d, "ZRANK board a").await)), 0);
    assert_eq!(as_int(scalar(&run(d, "ZRANK board d").await)), 3);
}

// ---------------------------------------------------------------------------
// TTL / expiry
// ---------------------------------------------------------------------------

#[tokio::test]
async fn expire_ttl_and_key_expiry() {
    let (_c, driver) = start_redis().await;
    let d = driver.as_ref();

    run(d, "SET session abc").await;

    // No TTL set yet -> -1.
    assert_eq!(as_int(scalar(&run(d, "TTL session").await)), -1);

    // EXPIRE arms a TTL; TTL then reports a value in (0, 100].
    assert_eq!(as_int(scalar(&run(d, "EXPIRE session 100").await)), 1);
    let ttl = as_int(scalar(&run(d, "TTL session").await));
    assert!((1..=100).contains(&ttl), "ttl should be within window, got {ttl}");

    // A short PEXPIRE actually evicts the key once it elapses.
    run(d, "SET ephemeral x").await;
    run(d, "PEXPIRE ephemeral 50").await;
    assert_eq!(as_int(scalar(&run(d, "EXISTS ephemeral").await)), 1);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(as_int(scalar(&run(d, "EXISTS ephemeral").await)), 0);
    assert_eq!(scalar(&run(d, "GET ephemeral").await), &QueryValue::Null);
}

// ---------------------------------------------------------------------------
// EXISTS / DEL / TYPE
// ---------------------------------------------------------------------------

#[tokio::test]
async fn exists_del_type() {
    let (_c, driver) = start_redis().await;
    let d = driver.as_ref();

    run(d, "SET str:1 hello").await;
    run(d, "RPUSH list:1 a b").await;
    run(d, "HSET hash:1 f v").await;

    // TYPE reflects the stored kind.
    assert_eq!(as_text(scalar(&run(d, "TYPE str:1").await)), "string");
    assert_eq!(as_text(scalar(&run(d, "TYPE list:1").await)), "list");
    assert_eq!(as_text(scalar(&run(d, "TYPE hash:1").await)), "hash");
    assert_eq!(as_text(scalar(&run(d, "TYPE missing").await)), "none");

    // EXISTS counts present keys (here 3 of 3).
    assert_eq!(as_int(scalar(&run(d, "EXISTS str:1 list:1 hash:1").await)), 3);
    assert_eq!(as_int(scalar(&run(d, "EXISTS missing").await)), 0);

    // DEL removes keys; the deleted key no longer exists.
    assert_eq!(as_int(scalar(&run(d, "DEL str:1 list:1").await)), 2);
    assert_eq!(as_int(scalar(&run(d, "EXISTS str:1 list:1 hash:1").await)), 1);
}

// ---------------------------------------------------------------------------
// SCAN cursor iteration (via the SQL keys wrapper, which loops SCAN internally)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn scan_cursor_iteration() {
    let (_c, driver) = start_redis().await;
    let d = driver.as_ref();

    // Seed enough keys to force multiple SCAN batches (the driver uses COUNT 100).
    for i in 0..250 {
        run(d, &format!("SET item:{i} v{i}")).await;
    }
    run(d, "RPUSH other:list a").await;

    // `SELECT * FROM keys WHERE key LIKE 'item:*'` drives the SCAN cursor loop
    // across all batches and returns one row per matching key.
    let scan = run_sql(d, "SELECT * FROM keys WHERE key LIKE 'item:*' LIMIT 1000").await;
    assert_eq!(
        scan.columns,
        vec![ColumnSpec::new("key", "text"), ColumnSpec::new("type", "text")]
    );
    assert_eq!(scan.rows.len(), 250, "every seeded item key should be scanned");
    // The non-matching key is excluded by the pattern.
    assert!(scan.rows.iter().all(|row| as_text(&row[0]).starts_with("item:")));
    assert!(scan.rows.iter().all(|row| as_text(&row[1]) == "string"));

    // Unbounded scan also sees the list key with its correct type.
    let all = run_sql(d, "SELECT * FROM keys LIMIT 1000").await;
    assert_eq!(all.rows.len(), 251);
    assert!(
        all.rows
            .iter()
            .any(|row| as_text(&row[0]) == "other:list" && as_text(&row[1]) == "list")
    );
}

// ---------------------------------------------------------------------------
// SQL key-read wrapper (`SELECT * FROM "key"`) -> read_key, one path per type
// ---------------------------------------------------------------------------

#[tokio::test]
async fn sql_select_reads_each_key_type() {
    let (_c, driver) = start_redis().await;
    let d = driver.as_ref();

    // Seed one key of every type with native writes...
    run(d, "SET greeting hello").await;
    run(d, "RPUSH q a b c").await;
    run(d, "SADD s x y z").await;
    run(d, "HSET h f1 v1 f2 v2").await;
    run(d, "ZADD board 1 a 2 b").await;
    run(d, "XADD events * k1 v1").await;
    run(d, "XADD events * k2 v2").await;

    // ...then read each back through the SQL wrapper, which dispatches on the
    // key's type (GET / LRANGE / SMEMBERS / HGETALL / ZRANGE / XRANGE).

    // string -> GET -> scalar text
    assert_eq!(as_text(scalar(&run_sql(d, "SELECT * FROM greeting").await)), "hello");

    // list -> LRANGE -> ordered values
    assert_eq!(array_values(&run_sql(d, "SELECT * FROM q").await), vec!["a", "b", "c"]);

    // set -> SMEMBERS -> unordered values
    assert_eq!(sorted(array_values(&run_sql(d, "SELECT * FROM s").await)), vec!["x", "y", "z"]);

    // hash -> HGETALL -> flat field/value pairs
    assert_eq!(
        sorted(array_values(&run_sql(d, "SELECT * FROM h").await)),
        sorted(vec!["f1".into(), "v1".into(), "f2".into(), "v2".into()])
    );

    // zset -> ZRANGE WITHSCORES -> flat member/score pairs in score order
    assert_eq!(
        array_values(&run_sql(d, "SELECT * FROM board").await),
        vec!["a", "1", "b", "2"]
    );

    // stream -> XRANGE -> one row per entry (entry payloads surface as JSON)
    let stream = run_sql(d, "SELECT * FROM events").await;
    assert_eq!(
        stream.columns,
        vec![ColumnSpec::new("index", "int"), ColumnSpec::new("value", "text")]
    );
    assert_eq!(stream.rows.len(), 2, "both stream entries should be returned");

    // missing key -> null
    assert_eq!(scalar(&run_sql(d, "SELECT * FROM \"absent\"").await), &QueryValue::Null);
}

// ---------------------------------------------------------------------------
// Per-key-type schema-browser lifecycle (write -> list_schemas -> delete)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn key_type_browser_lifecycle() {
    let (_c, driver) = start_redis().await;
    let d = driver.as_ref();

    // One key of every type Redis (and the browser) supports.
    run(d, "SET k:string hello").await;
    run(d, "RPUSH k:list a b c").await;
    run(d, "SADD k:set a b c").await;
    run(d, "HSET k:hash f1 v1 f2 v2").await;
    run(d, "ZADD k:zset 1 a 2 b").await;
    run(d, "XADD k:stream * field value").await;

    let expected = [
        ("k:string", SchemaNodeKind::RedisStringKey),
        ("k:list", SchemaNodeKind::RedisListKey),
        ("k:set", SchemaNodeKind::RedisSetKey),
        ("k:hash", SchemaNodeKind::RedisHashKey),
        ("k:zset", SchemaNodeKind::RedisZsetKey),
        ("k:stream", SchemaNodeKind::RedisStreamKey),
    ];

    // The browser groups keys under a `db0` Database node.
    let tree = schema_tree(d).await;
    assert!(
        tree.iter().any(|n| n.name == "db0" && n.kind == SchemaNodeKind::Database),
        "tree should expose the db0 database node"
    );

    // Each key appears with exactly the right per-type kind.
    for (name, kind) in expected {
        let node = find_node(&tree, name)
            .unwrap_or_else(|| panic!("{name} should be listed in the schema browser"));
        assert_eq!(node.kind, kind, "{name} should have kind {kind:?}");
    }

    // Deleting the keys removes them from the browser (negative case).
    run(d, "DEL k:string k:list k:set k:hash k:zset k:stream").await;
    let after = schema_tree(d).await;
    for (name, _) in expected {
        assert!(
            find_node(&after, name).is_none(),
            "{name} should be gone after DEL"
        );
    }
}

// ---------------------------------------------------------------------------
// Multi-database schema browsing — each db node lists only its own keys
// ---------------------------------------------------------------------------

#[tokio::test]
async fn list_schemas_scans_each_database_independently() {
    let (_c, driver) = start_redis().await;
    let d = driver.as_ref();

    // A key that lives only in db0...
    run(d, "SET only:db0 v").await;
    // ...and a distinct key that lives only in db1.
    run(d, "SELECT 1").await;
    run(d, "SET only:db1 v").await;
    run(d, "SELECT 0").await;

    let tree = schema_tree(d).await;

    // Both databases surface as Database nodes.
    let db0 = tree
        .iter()
        .find(|n| n.name == "db0" && n.kind == SchemaNodeKind::Database)
        .expect("db0 node present");
    let db1 = tree
        .iter()
        .find(|n| n.name == "db1" && n.kind == SchemaNodeKind::Database)
        .expect("db1 node present");

    // Each node lists ONLY its own database's keys. Before the SELECT-per-db fix,
    // db1 was scanned against the connection's current db (db0), so it wrongly
    // showed `only:db0` and never `only:db1`.
    assert!(db0.children.iter().any(|k| k.name == "only:db0"));
    assert!(db0.children.iter().all(|k| k.name != "only:db1"));
    assert!(db1.children.iter().any(|k| k.name == "only:db1"));
    assert!(db1.children.iter().all(|k| k.name != "only:db0"));

    // Browsing left the connection on its home database (db0), so a subsequent
    // query still reads db0's keys.
    assert_eq!(as_text(scalar(&run(d, "GET only:db0").await)), "v");
    assert_eq!(scalar(&run(d, "GET only:db1").await), &QueryValue::Null);
}

// ---------------------------------------------------------------------------
// SQL reads targeting a specific database via the `dbN.` source prefix
// ---------------------------------------------------------------------------

#[tokio::test]
async fn sql_reads_key_from_named_database() {
    let (_c, driver) = start_redis().await;
    let d = driver.as_ref();

    // A string on the home database (db0)...
    run(d, "SET home:key home_val").await;
    // ...and a hash that lives only in db1.
    run(d, "SELECT 1").await;
    run(d, "HSET cache:stats hits 12345 misses 678").await;
    run(d, "SELECT 0").await;

    // `SELECT * FROM db1.cache:stats` hops to db1, reads the hash, and returns
    // its fields — the key is invisible to a plain (home-db) read.
    let stats = run_sql(d, "SELECT * FROM db1.cache:stats").await;
    assert_eq!(
        sorted(array_values(&stats)),
        sorted(vec!["hits".into(), "12345".into(), "misses".into(), "678".into()])
    );
    assert_eq!(
        scalar(&run_sql(d, "SELECT * FROM \"cache:stats\"").await),
        &QueryValue::Null
    );

    // The db1 read restored the home database, so a home-db key still reads back.
    assert_eq!(
        as_text(scalar(&run_sql(d, "SELECT * FROM \"home:key\"").await)),
        "home_val"
    );

    // A `dbN.keys` listing scans that database's keyspace.
    let db1_keys = run_sql(d, "SELECT * FROM db1.keys").await;
    assert_eq!(
        db1_keys.columns,
        vec![ColumnSpec::new("key", "text"), ColumnSpec::new("type", "text")]
    );
    assert!(db1_keys.rows.iter().any(|row| as_text(&row[0]) == "cache:stats"));
}

// ---------------------------------------------------------------------------
// Access control (Redis ACL), with positive and negative assertions
// ---------------------------------------------------------------------------

#[tokio::test]
async fn acl_user_permissions() {
    let (container, admin) = start_redis().await;
    let a = admin.as_ref();

    // Create a restricted user: may read/write only keys matching `cached:*`,
    // plus the connection commands the client needs to authenticate/select.
    run(
        a,
        "ACL SETUSER alice on >secret ~cached:* +@read +@write +@connection",
    )
    .await;

    // Positive: the admin-visible ACL list now names the user.
    let acl_list = run(a, "ACL LIST").await;
    assert!(
        acl_list
            .rows
            .iter()
            .any(|row| as_text(&row[1]).contains("user alice")),
        "ACL LIST should include the new user"
    );
    // GETUSER returns a non-empty rule description.
    assert!(!run(a, "ACL GETUSER alice").await.rows.is_empty());

    // Connect a second driver authenticated as alice.
    let alice_driver = connect(&container, "alice", "secret").await;
    let alice = alice_driver.as_ref();

    // Positive: alice can read/write keys inside her pattern.
    assert_eq!(as_text(scalar(&run(alice, "SET cached:x 1").await)), "OK");
    assert_eq!(as_text(scalar(&run(alice, "GET cached:x").await)), "1");

    // Negative: a key outside `cached:*` is denied (NOPERM on key).
    let key_denied = alice
        .run_query("SET other:y 1", &[], QueryLanguage::Native)
        .await;
    assert!(key_denied.is_err(), "writing outside the key pattern must be denied");

    // Negative: an admin-only command alice lacks is denied (NOPERM on command).
    let cmd_denied = alice
        .run_query("CONFIG GET maxmemory", &[], QueryLanguage::Native)
        .await;
    assert!(cmd_denied.is_err(), "admin command must be denied for alice");

    // The denied writes left no trace — the admin confirms `other:y` is absent.
    assert_eq!(as_int(scalar(&run(a, "EXISTS other:y").await)), 0);
}
