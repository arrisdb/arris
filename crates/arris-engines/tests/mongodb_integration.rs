//! Integration tests for the MongoDB driver against a real `mongo:8` instance
//! started via `testcontainers`. Read/write queries run through the engine's
//! `DatabaseDriver::run_query` / `explain_query` / `list_schemas` (the same path
//! the app uses) and the returned `QueryResult` / `PlanResult` / `SchemaNode`
//! tree is asserted.
//!
//! Requires Docker. Run with:
//!   `cargo test -p arris-engines --test mongodb_integration`
//! Each test owns its own container, so they are independent and parallel-safe.
//!
//! MongoDB is non-relational: the engine's native request grammar exposes only
//! the document verbs (`find` / `aggregate` / `count` / `insert` / `update` /
//! `delete`). DDL that has no verb — `createCollection`, `createIndexes`,
//! `createView`, `createUser` — is issued through the raw `mongodb` client to
//! set up each scenario, then the *observable* result is asserted through the
//! engine (queries + `list_schemas`). Mongo has no triggers, sequences, stored
//! procedures, or materialized views, so those relational object kinds are not
//! exercised here; the schema-browser kinds Mongo does surface are collections,
//! indexes, and views.

use std::time::Duration;

use arris_engines::{
    ConnectionConfig, DatabaseDriver, DatabaseKind, ExplainMode, PlanNode, QueryLanguage,
    QueryResult, QueryValue, SchemaNode, SchemaNodeKind, driver_for_kind,
};
use mongodb::bson::{Document, doc};
use mongodb::options::IndexOptions;
use mongodb::{Client, IndexModel};
use testcontainers_modules::mongo::Mongo;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ImageExt};

// ── harness ─────────────────────────────────────────────────────────────────

/// Default database every test writes into. The default-db is sourced from the
/// connection config, so unqualified `db.<coll>` requests resolve here.
const DB: &str = "testdb";

/// Connect a fresh Mongo engine driver, retrying while the container's mongod
/// finishes coming up (the auth image restarts mongod after seeding the root
/// user, so the first connection can race the restart).
async fn connect_driver(cfg: &ConnectionConfig) -> Box<dyn DatabaseDriver> {
    let driver = driver_for_kind(DatabaseKind::Mongodb).expect("mongo driver");
    for attempt in 0..40 {
        match driver.connect(cfg).await {
            Ok(()) => return driver,
            Err(_) if attempt < 39 => tokio::time::sleep(Duration::from_millis(500)).await,
            Err(e) => panic!("connect to mongo failed: {e:?}"),
        }
    }
    unreachable!()
}

/// Boot a fresh `mongo:8` container (no auth) and return a connected engine
/// driver plus a raw client for issuing DDL the engine grammar can't express.
/// The container guard must be kept alive for the duration of the test.
async fn start_mongo() -> (ContainerAsync<Mongo>, Box<dyn DatabaseDriver>, Client) {
    let container = Mongo::default()
        .with_tag("8")
        .start()
        .await
        .expect("start mongo container");
    let host = container.get_host().await.expect("container host").to_string();
    let port = container
        .get_host_port_ipv4(27017)
        .await
        .expect("container port");

    let mut cfg = ConnectionConfig::new("it-mongo", DatabaseKind::Mongodb);
    cfg.host = host.clone();
    cfg.port = port;
    cfg.database = DB.to_string();
    let driver = connect_driver(&cfg).await;

    let client = Client::with_uri_str(format!("mongodb://{host}:{port}/"))
        .await
        .expect("raw mongo client");
    (container, driver, client)
}

/// Boot a `mongo:8` container with authentication enabled (root user created
/// from env). Returns a raw root client for user administration plus the host
/// and port so the test can connect additional drivers as restricted users.
async fn start_mongo_auth() -> (ContainerAsync<Mongo>, Client, String, u16) {
    let container = Mongo::default()
        .with_tag("8")
        .with_env_var("MONGO_INITDB_ROOT_USERNAME", "root")
        .with_env_var("MONGO_INITDB_ROOT_PASSWORD", "rootpw")
        .start()
        .await
        .expect("start mongo container (auth)");
    let host = container.get_host().await.expect("container host").to_string();
    let port = container
        .get_host_port_ipv4(27017)
        .await
        .expect("container port");

    let root = Client::with_uri_str(format!("mongodb://root:rootpw@{host}:{port}/?authSource=admin"))
        .await
        .expect("root mongo client");
    // The auth image restarts mongod after creating the root user; wait until an
    // authenticated ping succeeds before handing the client back.
    for attempt in 0..40 {
        if root.database("admin").run_command(doc! { "ping": 1 }).await.is_ok() {
            break;
        }
        assert!(attempt < 39, "mongo (auth) never became ready");
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    (container, root, host, port)
}

/// Connect an engine driver authenticating as `user` against `DB`.
async fn driver_as(host: &str, port: u16, user: &str, password: &str) -> Box<dyn DatabaseDriver> {
    let mut cfg = ConnectionConfig::new("it-mongo-user", DatabaseKind::Mongodb);
    cfg.host = host.to_string();
    cfg.port = port;
    cfg.database = DB.to_string();
    cfg.user = user.to_string();
    cfg.password = password.to_string();
    cfg.options = format!("authSource={DB}");
    connect_driver(&cfg).await
}

async fn run(driver: &dyn DatabaseDriver, q: &str) -> QueryResult {
    driver
        .run_query(q, &[], QueryLanguage::Native)
        .await
        .unwrap_or_else(|e| panic!("query failed: {q}\n  error: {e:?}"))
}

/// Run a query through the SQL frontend (`QueryLanguage::Sql`), which translates
/// SQL into a Mongo find / countDocuments / aggregate request before executing.
async fn run_sql(driver: &dyn DatabaseDriver, sql: &str) -> QueryResult {
    driver
        .run_query(sql, &[], QueryLanguage::Sql)
        .await
        .unwrap_or_else(|e| panic!("sql query failed: {sql}\n  error: {e:?}"))
}

/// Run a write and assert how many documents it reported as affected.
async fn exec_affected(driver: &dyn DatabaseDriver, q: &str) -> i64 {
    run(driver, q)
        .await
        .rows_affected
        .unwrap_or_else(|| panic!("expected rows_affected for: {q}"))
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

fn as_f64(v: &QueryValue) -> f64 {
    match v {
        QueryValue::Double(d) => *d,
        other => panic!("expected Double, got {other:?}"),
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

/// Locate a named cell in a row — robust against column ordering, which Mongo
/// derives from each document's stored field order.
fn cell<'a>(result: &'a QueryResult, row: usize, name: &str) -> &'a QueryValue {
    let idx = result
        .columns
        .iter()
        .position(|c| c.name == name)
        .unwrap_or_else(|| panic!("no column named {name} in {:?}", result.columns));
    &result.rows[row][idx]
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
    tree.extend(driver.list_schema(DB).await.expect("list_schema"));
    tree
}

fn parse_json(v: &QueryValue) -> serde_json::Value {
    serde_json::from_str(as_json(v)).expect("array cell is valid JSON")
}

// ── CRUD ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn crud_insert_find_update_delete() {
    let (_c, driver, _raw) = start_mongo().await;
    let d = driver.as_ref();

    // insertMany reports the inserted count.
    let inserted = exec_affected(
        d,
        r#"db.users.insertMany([
            {"name":"alice","age":30,"tags":["a"]},
            {"name":"bob","age":25,"tags":["b"]},
            {"name":"carol","age":40,"tags":["c"]}
        ])"#,
    )
    .await;
    assert_eq!(inserted, 3);

    // insertOne reports a single affected document.
    assert_eq!(
        exec_affected(d, r#"db.users.insertOne({"name":"dave","age":22,"tags":[]})"#).await,
        1
    );

    // find with filter + projection + sort + limit. JSON integers land as int64.
    let top = run(
        d,
        r#"db.users.find({"age":{"$gte":25}},{"name":1,"age":1,"_id":0}).sort({"age":-1}).limit(2)"#,
    )
    .await;
    // Projection emits both fields (Mongo orders them by the projection doc,
    // which serde_json sorts, so assert the set + locate cells by name).
    let names = col_names(&top);
    assert_eq!(names.len(), 2);
    assert!(names.contains(&"name") && names.contains(&"age"), "got {names:?}");
    assert_eq!(col_type(&top, "age"), "int64");
    assert_eq!(top.rows.len(), 2);
    assert_eq!(as_text(cell(&top, 0, "name")), "carol");
    assert_eq!(as_i64(cell(&top, 0, "age")), 40);
    assert_eq!(as_text(cell(&top, 1, "name")), "alice");
    assert_eq!(as_i64(cell(&top, 1, "age")), 30);

    // updateOne with $set.
    assert_eq!(
        exec_affected(d, r#"db.users.updateOne({"name":"alice"},{"$set":{"age":31}})"#).await,
        1
    );
    let alice = run(d, r#"db.users.find({"name":"alice"},{"age":1,"_id":0})"#).await;
    assert_eq!(as_i64(scalar(&alice)), 31);

    // updateMany with $inc bumps every document's age by one.
    assert_eq!(
        exec_affected(d, r#"db.users.updateMany({},{"$inc":{"age":1}})"#).await,
        4
    );
    let alice2 = run(d, r#"db.users.find({"name":"alice"},{"age":1,"_id":0})"#).await;
    assert_eq!(as_i64(scalar(&alice2)), 32);

    // updateOne with $push appends to an array field.
    assert_eq!(
        exec_affected(d, r#"db.users.updateOne({"name":"bob"},{"$push":{"tags":"vip"}})"#).await,
        1
    );
    let bob_tags = run(d, r#"db.users.find({"name":"bob"},{"tags":1,"_id":0})"#).await;
    assert_eq!(as_json(scalar(&bob_tags)), r#"["b","vip"]"#);

    // deleteOne removes a single document.
    assert_eq!(exec_affected(d, r#"db.users.deleteOne({"name":"dave"})"#).await, 1);

    // deleteMany removes everyone now aged >= 40 (carol, bumped to 41).
    assert_eq!(
        exec_affected(d, r#"db.users.deleteMany({"age":{"$gte":40}})"#).await,
        1
    );

    // countDocuments confirms the survivors: alice (32) and bob (26).
    let count = run(d, r#"db.users.countDocuments({})"#).await;
    assert_eq!(col_names(&count), ["count"]);
    assert_eq!(as_i64(scalar(&count)), 2);
}

// ── Aggregation: $match / $group / $sort / $project + $sum / $avg ────────────

#[tokio::test]
async fn aggregate_match_group_sort_project() {
    let (_c, driver, _raw) = start_mongo().await;
    let d = driver.as_ref();

    run(
        d,
        r#"db.sales.insertMany([
            {"region":"east","product":"a","amount":10},
            {"region":"east","product":"b","amount":20},
            {"region":"east","product":"c","amount":30},
            {"region":"west","product":"a","amount":40},
            {"region":"west","product":"b","amount":50}
        ])"#,
    )
    .await;

    let r = run(
        d,
        r#"db.sales.aggregate([
            {"$match":{"amount":{"$gte":20}}},
            {"$group":{"_id":"$region","total":{"$sum":"$amount"},"avg":{"$avg":"$amount"}}},
            {"$sort":{"_id":1}},
            {"$project":{"region":"$_id","total":1,"avg":1,"_id":0}}
        ])"#,
    )
    .await;

    // east keeps amounts {20,30} -> sum 50, avg 25; west keeps {40,50} -> sum 90, avg 45.
    assert_eq!(r.rows.len(), 2);
    assert_eq!(as_text(cell(&r, 0, "region")), "east");
    assert_eq!(as_i64(cell(&r, 0, "total")), 50);
    assert_eq!(as_f64(cell(&r, 0, "avg")), 25.0);
    assert_eq!(as_text(cell(&r, 1, "region")), "west");
    assert_eq!(as_i64(cell(&r, 1, "total")), 90);
    assert_eq!(as_f64(cell(&r, 1, "avg")), 45.0);
}

// ── Aggregation: $lookup (join) + $unwind ───────────────────────────────────

#[tokio::test]
async fn aggregate_lookup_and_unwind() {
    let (_c, driver, _raw) = start_mongo().await;
    let d = driver.as_ref();

    run(
        d,
        r#"db.customers.insertMany([
            {"_id":1,"name":"alice"},
            {"_id":2,"name":"bob"}
        ])"#,
    )
    .await;
    run(
        d,
        r#"db.orders.insertMany([
            {"_id":100,"cust":1,"item":"x","price":10},
            {"_id":101,"cust":1,"item":"y","price":20},
            {"_id":102,"cust":2,"item":"z","price":30}
        ])"#,
    )
    .await;

    // $lookup joins orders into each customer; $size measures the joined array.
    let sized = run(
        d,
        r#"db.customers.aggregate([
            {"$lookup":{"from":"orders","localField":"_id","foreignField":"cust","as":"orders"}},
            {"$project":{"name":1,"orderCount":{"$size":"$orders"},"_id":0}},
            {"$sort":{"name":1}}
        ])"#,
    )
    .await;
    assert_eq!(sized.rows.len(), 2);
    assert_eq!(as_text(cell(&sized, 0, "name")), "alice");
    assert_eq!(as_i64(cell(&sized, 0, "orderCount")), 2);
    assert_eq!(as_text(cell(&sized, 1, "name")), "bob");
    assert_eq!(as_i64(cell(&sized, 1, "orderCount")), 1);

    // $lookup + $unwind flattens to one row per joined order, then regroups.
    let grouped = run(
        d,
        r#"db.customers.aggregate([
            {"$lookup":{"from":"orders","localField":"_id","foreignField":"cust","as":"orders"}},
            {"$unwind":"$orders"},
            {"$group":{"_id":"$name","orderCount":{"$sum":1},"revenue":{"$sum":"$orders.price"}}},
            {"$sort":{"_id":1}}
        ])"#,
    )
    .await;
    assert_eq!(grouped.rows.len(), 2);
    assert_eq!(as_text(cell(&grouped, 0, "_id")), "alice");
    assert_eq!(as_i64(cell(&grouped, 0, "orderCount")), 2);
    assert_eq!(as_i64(cell(&grouped, 0, "revenue")), 30);
    assert_eq!(as_text(cell(&grouped, 1, "_id")), "bob");
    assert_eq!(as_i64(cell(&grouped, 1, "orderCount")), 1);
    assert_eq!(as_i64(cell(&grouped, 1, "revenue")), 30);
}

// ── Aggregation: $facet + $push / $addToSet accumulators ────────────────────

#[tokio::test]
async fn aggregate_facet_and_accumulators() {
    let (_c, driver, _raw) = start_mongo().await;
    let d = driver.as_ref();

    run(
        d,
        r#"db.events.insertMany([
            {"type":"click","user":"a","val":1},
            {"type":"click","user":"a","val":2},
            {"type":"click","user":"b","val":3},
            {"type":"view","user":"a","val":4},
            {"type":"view","user":"c","val":5}
        ])"#,
    )
    .await;

    // $facet runs two independent sub-pipelines over the same input in one pass.
    let facet = run(
        d,
        r#"db.events.aggregate([
            {"$facet":{
                "byType":[{"$group":{"_id":"$type","n":{"$sum":1}}},{"$sort":{"_id":1}}],
                "users":[{"$group":{"_id":null,"all":{"$addToSet":"$user"}}}]
            }}
        ])"#,
    )
    .await;
    assert_eq!(facet.rows.len(), 1);

    // byType sub-pipeline: two groups, click then view (sorted).
    let by_type = parse_json(cell(&facet, 0, "byType"));
    let by_type = by_type.as_array().expect("byType is an array");
    assert_eq!(by_type.len(), 2);
    assert_eq!(by_type[0]["_id"], "click");
    assert_eq!(by_type[1]["_id"], "view");

    // users sub-pipeline: $addToSet de-duplicates to the distinct user set.
    let users = parse_json(cell(&facet, 0, "users"));
    let set = users[0]["all"].as_array().expect("addToSet is an array");
    let mut names: Vec<&str> = set.iter().map(|v| v.as_str().unwrap()).collect();
    names.sort();
    assert_eq!(names, ["a", "b", "c"]);

    // $push preserves every value (and order) within each group.
    let pushed = run(
        d,
        r#"db.events.aggregate([
            {"$match":{"type":"click"}},
            {"$group":{"_id":"$user","vals":{"$push":"$val"}}},
            {"$sort":{"_id":1}}
        ])"#,
    )
    .await;
    assert_eq!(pushed.rows.len(), 2);
    assert_eq!(as_text(cell(&pushed, 0, "_id")), "a");
    assert_eq!(parse_json(cell(&pushed, 0, "vals")).as_array().unwrap().len(), 2);
    assert_eq!(as_text(cell(&pushed, 1, "_id")), "b");
    assert_eq!(parse_json(cell(&pushed, 1, "vals")).as_array().unwrap().len(), 1);
}

// ── Nested document & array field queries ───────────────────────────────────

#[tokio::test]
async fn nested_document_and_array_queries() {
    let (_c, driver, _raw) = start_mongo().await;
    let d = driver.as_ref();

    run(
        d,
        r#"db.products.insertMany([
            {"name":"p1","specs":{"cpu":"x","ram":8},"tags":["sale","new"]},
            {"name":"p2","specs":{"cpu":"y","ram":16},"tags":["new"]},
            {"name":"p3","specs":{"cpu":"x","ram":32},"tags":["clearance"]}
        ])"#,
    )
    .await;

    // Dot-notation query into a nested document field.
    let cpu_x = run(
        d,
        r#"db.products.find({"specs.cpu":"x"},{"name":1,"_id":0}).sort({"name":1})"#,
    )
    .await;
    assert_eq!(cpu_x.rows.len(), 2);
    assert_eq!(as_text(&cpu_x.rows[0][0]), "p1");
    assert_eq!(as_text(&cpu_x.rows[1][0]), "p3");

    // Array membership: matching a scalar against an array field.
    let new_products = run(
        d,
        r#"db.products.find({"tags":"new"},{"name":1,"_id":0}).sort({"name":1})"#,
    )
    .await;
    assert_eq!(new_products.rows.len(), 2);
    assert_eq!(as_text(&new_products.rows[0][0]), "p1");
    assert_eq!(as_text(&new_products.rows[1][0]), "p2");

    // Range predicate on a nested numeric field.
    let big_ram = run(d, r#"db.products.countDocuments({"specs.ram":{"$gte":16}})"#).await;
    assert_eq!(as_i64(scalar(&big_ram)), 2);
}

// ── Collection lifecycle: create → use → drop, via the schema browser ───────

#[tokio::test]
async fn collection_lifecycle_via_schema_browser() {
    let (_c, driver, raw) = start_mongo().await;
    let d = driver.as_ref();
    let db = raw.database(DB);

    // CREATE: createCollection is DDL with no engine verb — issue it raw.
    db.create_collection("inventory").await.expect("create collection");
    run(
        d,
        r#"db.inventory.insertMany([{"sku":"a","qty":5},{"sku":"b","qty":9}])"#,
    )
    .await;

    // USE through the engine.
    let all = run(d, r#"db.inventory.find({},{"sku":1,"_id":0}).sort({"sku":1})"#).await;
    assert_eq!(all.rows.len(), 2);
    assert_eq!(as_text(&all.rows[0][0]), "a");
    assert_eq!(as_text(&all.rows[1][0]), "b");

    // The schema browser surfaces it as a Collection.
    assert!(has_node(&schema_tree(d).await, "inventory", SchemaNodeKind::Collection));

    // DROP via the raw client; it leaves the browser and is empty when queried.
    db.collection::<Document>("inventory")
        .drop()
        .await
        .expect("drop collection");
    assert!(!has_node(&schema_tree(d).await, "inventory", SchemaNodeKind::Collection));
    let gone = run(d, r#"db.inventory.find({})"#).await;
    assert_eq!(gone.rows.len(), 0);
}

// ── Index lifecycle: create / appears in browser / used by planner / drop ───

fn plan_uses_index(node: &PlanNode) -> bool {
    node.label.contains("IXSCAN")
        || node.node_type.contains("IXSCAN")
        || node.children.iter().any(plan_uses_index)
}

#[tokio::test]
async fn index_lifecycle_and_explain_usage() {
    let (_c, driver, raw) = start_mongo().await;
    let d = driver.as_ref();
    let coll = raw.database(DB).collection::<Document>("items");

    let seed: Vec<Document> = (0..1000)
        .map(|i| doc! { "sku": format!("sku{i}"), "qty": i })
        .collect();
    coll.insert_many(seed).await.expect("seed items");

    // CREATE INDEX (createIndexes DDL) via the raw client.
    let index = IndexModel::builder()
        .keys(doc! { "sku": 1 })
        .options(IndexOptions::builder().name("idx_items_sku".to_string()).build())
        .build();
    coll.create_index(index).await.expect("create index");

    // The schema browser surfaces the index.
    assert!(has_node(&schema_tree(d).await, "idx_items_sku", SchemaNodeKind::Index));

    // The planner uses it — read the plan through the engine's explain path.
    let plan = driver
        .explain_query(
            r#"db.items.find({"sku":"sku500"})"#,
            &[],
            QueryLanguage::Native,
            ExplainMode::DryRun,
        )
        .await
        .expect("explain");
    assert!(
        plan_uses_index(&plan.root),
        "expected an IXSCAN, got plan: {}",
        plan.raw
    );

    // DROP removes our named index (the implicit `_id_` index remains).
    coll.drop_index("idx_items_sku").await.expect("drop index");
    assert!(!has_node(&schema_tree(d).await, "idx_items_sku", SchemaNodeKind::Index));
}

// ── View lifecycle: createView (aggregation-backed) → query → drop ──────────

#[tokio::test]
async fn view_lifecycle_via_schema_browser() {
    let (_c, driver, raw) = start_mongo().await;
    let d = driver.as_ref();
    let db = raw.database(DB);

    run(
        d,
        r#"db.orders.insertMany([
            {"item":"x","price":10},
            {"item":"y","price":20},
            {"item":"z","price":30}
        ])"#,
    )
    .await;

    // CREATE VIEW backed by an aggregation pipeline (createView DDL).
    db.run_command(doc! {
        "create": "high_value",
        "viewOn": "orders",
        "pipeline": vec![doc! { "$match": { "price": { "$gte": 20 } } }],
    })
    .await
    .expect("create view");

    // USE the view through the engine — it is queried just like a collection.
    let v = run(
        d,
        r#"db.high_value.find({},{"item":1,"price":1,"_id":0}).sort({"price":1})"#,
    )
    .await;
    assert_eq!(v.rows.len(), 2);
    assert_eq!(as_text(cell(&v, 0, "item")), "y");
    assert_eq!(as_i64(cell(&v, 0, "price")), 20);
    assert_eq!(as_text(cell(&v, 1, "item")), "z");
    assert_eq!(as_i64(cell(&v, 1, "price")), 30);

    // The schema browser surfaces it as a View, not a Collection.
    let tree = schema_tree(d).await;
    assert!(has_node(&tree, "high_value", SchemaNodeKind::View));
    assert!(!has_node(&tree, "high_value", SchemaNodeKind::Collection));

    // DROP the view; it leaves the browser.
    db.collection::<Document>("high_value")
        .drop()
        .await
        .expect("drop view");
    assert!(!has_node(&schema_tree(d).await, "high_value", SchemaNodeKind::View));
}

// ── Access control: users, roles, grant/revoke, positive + negative ─────────

#[tokio::test]
async fn access_control_roles_grant_revoke() {
    let (_c, root, host, port) = start_mongo_auth().await;
    let db = root.database(DB);

    // Seed a collection as the root user.
    db.collection::<Document>("secrets")
        .insert_many(vec![doc! { "k": "a" }, doc! { "k": "b" }])
        .await
        .expect("seed secrets");

    // createUser with a read-only role on `testdb`.
    db.run_command(doc! {
        "createUser": "reader",
        "pwd": "readerpw",
        "roles": vec![doc! { "role": "read", "db": DB }],
    })
    .await
    .expect("create user");

    // POSITIVE: the reader can read through the engine.
    let reader = driver_as(&host, port, "reader", "readerpw").await;
    let found = run(reader.as_ref(), r#"db.secrets.find({},{"k":1,"_id":0}).sort({"k":1})"#).await;
    assert_eq!(found.rows.len(), 2);
    assert_eq!(as_text(&found.rows[0][0]), "a");
    assert_eq!(as_text(&found.rows[1][0]), "b");

    // NEGATIVE: the reader cannot write.
    assert!(
        reader
            .run_query(r#"db.secrets.insertOne({"k":"c"})"#, &[], QueryLanguage::Native)
            .await
            .is_err()
    );

    // GRANT readWrite — a fresh connection picks up the new privilege.
    db.run_command(doc! {
        "grantRolesToUser": "reader",
        "roles": vec![doc! { "role": "readWrite", "db": DB }],
    })
    .await
    .expect("grant readWrite");
    let writer = driver_as(&host, port, "reader", "readerpw").await;
    assert_eq!(
        exec_affected(writer.as_ref(), r#"db.secrets.insertOne({"k":"c"})"#).await,
        1
    );

    // REVOKE readWrite — writes are denied again, reads still work.
    db.run_command(doc! {
        "revokeRolesFromUser": "reader",
        "roles": vec![doc! { "role": "readWrite", "db": DB }],
    })
    .await
    .expect("revoke readWrite");
    let revoked = driver_as(&host, port, "reader", "readerpw").await;
    assert!(
        revoked
            .run_query(r#"db.secrets.insertOne({"k":"d"})"#, &[], QueryLanguage::Native)
            .await
            .is_err()
    );
    let still = run(revoked.as_ref(), r#"db.secrets.countDocuments({})"#).await;
    assert_eq!(as_i64(scalar(&still)), 3); // a, b, c

    // DROP the user.
    db.run_command(doc! { "dropUser": "reader" })
        .await
        .expect("drop user");
}

// ── SQL frontend: SQL → Mongo translation, executed end-to-end ──────────────
//
// These drive `QueryLanguage::Sql`, exercising the `sql` module that rewrites a
// SELECT into a Mongo find / countDocuments / aggregate request. Writes still go
// through the native verbs (the SQL frontend is read-only); the reads below run
// as SQL and assert the real documents that come back, so the whole translate →
// execute → tabularize path is covered, not just the parser.

#[tokio::test]
async fn sql_select_find_projection_filter_sort_limit() {
    let (_c, driver, _raw) = start_mongo().await;
    let d = driver.as_ref();

    run(
        d,
        r#"db.users.insertMany([
            {"name":"alice","age":30},
            {"name":"bob","age":25},
            {"name":"carol","age":40},
            {"name":"dave","age":22}
        ])"#,
    )
    .await;

    // SELECT col-list + WHERE + ORDER BY + LIMIT → find with projection/sort/limit.
    let r = run_sql(
        d,
        "SELECT name, age FROM users WHERE age >= 25 ORDER BY age DESC LIMIT 2",
    )
    .await;
    let names = col_names(&r);
    assert_eq!(names.len(), 2);
    assert!(names.contains(&"name") && names.contains(&"age"), "got {names:?}");
    assert_eq!(r.rows.len(), 2);
    assert_eq!(as_text(cell(&r, 0, "name")), "carol");
    assert_eq!(as_i64(cell(&r, 0, "age")), 40);
    assert_eq!(as_text(cell(&r, 1, "name")), "alice");
    assert_eq!(as_i64(cell(&r, 1, "age")), 30);

    // SELECT * keeps every field (no projection); OFFSET skips.
    let star = run_sql(d, "SELECT * FROM users ORDER BY age ASC OFFSET 1").await;
    assert_eq!(star.rows.len(), 3); // dave skipped (youngest)
    assert_eq!(as_text(cell(&star, 0, "name")), "bob"); // ages: 22(dave),25,30,40
}

#[tokio::test]
async fn sql_count_star_uses_count_documents() {
    let (_c, driver, _raw) = start_mongo().await;
    let d = driver.as_ref();

    run(
        d,
        r#"db.users.insertMany([
            {"name":"alice","age":30},
            {"name":"bob","age":25},
            {"name":"carol","age":40},
            {"name":"dave","age":22}
        ])"#,
    )
    .await;

    // COUNT(*) with a filter routes through countDocuments.
    let c = run_sql(d, "SELECT COUNT(*) FROM users WHERE age >= 25").await;
    assert_eq!(col_names(&c), ["count"]);
    assert_eq!(as_i64(scalar(&c)), 3);
}

#[tokio::test]
async fn sql_group_by_translates_to_aggregate() {
    let (_c, driver, _raw) = start_mongo().await;
    let d = driver.as_ref();

    run(
        d,
        r#"db.sales.insertMany([
            {"region":"east","amount":10},
            {"region":"east","amount":20},
            {"region":"east","amount":30},
            {"region":"west","amount":40},
            {"region":"west","amount":50}
        ])"#,
    )
    .await;

    // GROUP BY + COUNT/SUM/AVG with aliases → aggregate pipeline ($group/$project).
    let r = run_sql(
        d,
        "SELECT region, COUNT(*) AS n, SUM(amount) AS total, AVG(amount) AS avg_amt \
         FROM sales GROUP BY region ORDER BY region ASC",
    )
    .await;
    assert_eq!(r.rows.len(), 2);
    assert_eq!(as_text(cell(&r, 0, "region")), "east");
    assert_eq!(as_i64(cell(&r, 0, "n")), 3);
    assert_eq!(as_i64(cell(&r, 0, "total")), 60);
    assert_eq!(as_f64(cell(&r, 0, "avg_amt")), 20.0);
    assert_eq!(as_text(cell(&r, 1, "region")), "west");
    assert_eq!(as_i64(cell(&r, 1, "n")), 2);
    assert_eq!(as_i64(cell(&r, 1, "total")), 90);
    assert_eq!(as_f64(cell(&r, 1, "avg_amt")), 45.0);

    // DISTINCT also lowers to an aggregate ($group on the field).
    let distinct = run_sql(d, "SELECT DISTINCT region FROM sales ORDER BY region ASC").await;
    assert_eq!(distinct.rows.len(), 2);
    assert_eq!(as_text(cell(&distinct, 0, "region")), "east");
    assert_eq!(as_text(cell(&distinct, 1, "region")), "west");
}

#[tokio::test]
async fn sql_where_operator_translation() {
    let (_c, driver, _raw) = start_mongo().await;
    let d = driver.as_ref();

    // p2 deliberately omits `tag` so IS NULL exercises the missing-field case.
    run(
        d,
        r#"db.products.insertMany([
            {"name":"p1","price":10,"category":"x","tag":"sale"},
            {"name":"p2","price":20,"category":"y"},
            {"name":"p3","price":30,"category":"x","tag":"new"},
            {"name":"p4","price":40,"category":"z","tag":"newish"}
        ])"#,
    )
    .await;

    // Helper: COUNT(*) with a WHERE clause, exercising each operator's translation.
    async fn count_where(d: &dyn DatabaseDriver, predicate: &str) -> i64 {
        let sql = format!("SELECT COUNT(*) FROM products WHERE {predicate}");
        as_i64(scalar(&run_sql(d, &sql).await))
    }

    assert_eq!(count_where(d, "category IN ('x','z')").await, 3); // p1,p3,p4
    assert_eq!(count_where(d, "category != 'x'").await, 2); // p2,p4
    assert_eq!(count_where(d, "price BETWEEN 15 AND 35").await, 2); // p2,p3
    assert_eq!(count_where(d, "price NOT BETWEEN 15 AND 35").await, 2); // p1,p4
    assert_eq!(count_where(d, "name LIKE 'p%'").await, 4);
    assert_eq!(count_where(d, "tag LIKE 'new%'").await, 2); // new, newish
    assert_eq!(count_where(d, "tag IS NULL").await, 1); // p2 (missing field)
    assert_eq!(count_where(d, "tag IS NOT NULL").await, 3);
    assert_eq!(count_where(d, "price >= 20 AND category = 'x'").await, 1); // p3
    assert_eq!(count_where(d, "price < 20 OR price > 35").await, 2); // p1,p4

    // A filtered projection returns the matching rows, not just a count.
    let rows = run_sql(
        d,
        "SELECT name FROM products WHERE category = 'x' ORDER BY name ASC",
    )
    .await;
    assert_eq!(rows.rows.len(), 2);
    assert_eq!(as_text(cell(&rows, 0, "name")), "p1");
    assert_eq!(as_text(cell(&rows, 1, "name")), "p3");
}

#[tokio::test]
async fn sql_insert_translates_to_mongo_write() {
    let (_c, driver, _raw) = start_mongo().await;
    let d = driver.as_ref();

    // Single-row INSERT → insertOne (1 affected).
    let one = run_sql(d, "INSERT INTO people (name, age) VALUES ('alice', 30)").await;
    assert_eq!(one.rows_affected, Some(1));

    // Multi-row INSERT → insertMany (2 affected).
    let many = run_sql(
        d,
        "INSERT INTO people (name, age) VALUES ('bob', 25), ('carol', 41)",
    )
    .await;
    assert_eq!(many.rows_affected, Some(2));

    // All three documents are now present and queryable via SQL.
    let count = run_sql(d, "SELECT COUNT(*) FROM people").await;
    assert_eq!(as_i64(scalar(&count)), 3);

    let alice = run_sql(d, "SELECT name, age FROM people WHERE name = 'alice'").await;
    assert_eq!(alice.rows.len(), 1);
    assert_eq!(as_text(cell(&alice, 0, "name")), "alice");
    assert_eq!(as_i64(cell(&alice, 0, "age")), 30);
}

#[tokio::test]
async fn sql_update_translates_to_update_many() {
    let (_c, driver, _raw) = start_mongo().await;
    let d = driver.as_ref();

    run(
        d,
        r#"db.people.insertMany([
            {"name":"alice","status":"trial"},
            {"name":"bob","status":"trial"},
            {"name":"carol","status":"active"}
        ])"#,
    )
    .await;

    // UPDATE affects every matching row → updateMany (2 trial → active).
    let upd = run_sql(d, "UPDATE people SET status = 'active' WHERE status = 'trial'").await;
    assert_eq!(upd.rows_affected, Some(2));

    let active = run_sql(d, "SELECT COUNT(*) FROM people WHERE status = 'active'").await;
    assert_eq!(as_i64(scalar(&active)), 3);
    let trial = run_sql(d, "SELECT COUNT(*) FROM people WHERE status = 'trial'").await;
    assert_eq!(as_i64(scalar(&trial)), 0);
}

#[tokio::test]
async fn sql_delete_translates_to_delete_many() {
    let (_c, driver, _raw) = start_mongo().await;
    let d = driver.as_ref();

    run(
        d,
        r#"db.people.insertMany([
            {"name":"alice","age":17},
            {"name":"bob","age":20},
            {"name":"carol","age":15}
        ])"#,
    )
    .await;

    // DELETE removes every matching row → deleteMany (2 minors removed).
    let del = run_sql(d, "DELETE FROM people WHERE age < 18").await;
    assert_eq!(del.rows_affected, Some(2));

    let remaining = run_sql(d, "SELECT name FROM people").await;
    assert_eq!(remaining.rows.len(), 1);
    assert_eq!(as_text(cell(&remaining, 0, "name")), "bob");
}

#[tokio::test]
async fn sql_dml_errors_surface_cleanly() {
    let (_c, driver, _raw) = start_mongo().await;

    // Column/value arity mismatch and unknown statements are rejected, not run.
    for bad in [
        r#"INSERT INTO t (a, b) VALUES (1)"#,
        r#"UPDATE t SET a = other_col"#,
        r#"TRUNCATE t"#,
    ] {
        assert!(
            driver
                .run_query(bad, &[], QueryLanguage::Sql)
                .await
                .is_err(),
            "expected SQL frontend to reject: {bad}"
        );
    }
}

// ── streaming ingestion (canvas cell path) ──────────────────────────────────
// `run_query_stream` on a `find` fixes columns from the first chunk's field
// union, then streams the rest. Drives the app's `ingest_cell_stream` path.

mod streaming_scenario;
use streaming_scenario::BOARD;

use arris_engines::{
    CanvasEngine, CanvasError, QueryEngine, CELL_INGEST_BYTE_BUDGET, CELL_RESULT_PAGE_ROWS,
};
use tokio_util::sync::CancellationToken;

fn canvas_engine() -> CanvasEngine {
    streaming_scenario::canvas_engine("mongodb")
}

/// Insert `count` docs `{n, label}` into `testdb.src` via the raw client, in
/// bounded batches (Mongo has no server-side row generator).
async fn seed_src(client: &Client, count: i64) {
    let coll = client.database(DB).collection::<Document>("src");
    let batch: i64 = 10_000;
    let mut start = 1;
    while start <= count {
        let end = (start + batch - 1).min(count);
        let docs: Vec<Document> = (start..=end)
            .map(|n| doc! { "n": n, "label": format!("row-{n}") })
            .collect();
        coll.insert_many(docs).await.expect("seed insert");
        start = end + 1;
    }
}

#[tokio::test]
async fn streaming_ingests_100k_docs_with_exact_totals_and_page() {
    let (_c, driver, client) = start_mongo().await;
    seed_src(&client, 100_000).await;
    let engine = canvas_engine();

    let stream = driver
        .run_query_stream(r#"db.src.find({}).sort({"n":1})"#, &[], QueryLanguage::Native)
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
    assert_eq!(names, vec!["_id", "n", "label"]);
    assert_eq!(out.result.rows[0][1], QueryValue::Int(1));
    assert_eq!(out.result.rows[0][2], QueryValue::Text("row-1".into()));
    assert_eq!(out.result.rows[499][1], QueryValue::Int(500));

    // A chained cell aggregates the FULL cached result, not the 500-row page.
    let agg = engine
        .run_cell(BOARD, "sums", "SELECT COUNT(*) AS c, SUM(n) AS s FROM big")
        .await
        .expect("chained aggregate");
    assert_eq!(agg.result.rows[0][0], QueryValue::Int(100_000));
    assert_eq!(agg.result.rows[0][1], QueryValue::Int(5_000_050_000));
}

#[tokio::test]
async fn streaming_columns_cover_the_whole_first_chunk_not_just_the_page() {
    // Columns come from the first chunk's union, not the 500-row page: a field
    // on doc 501 (past the page, within the chunk) still earns a column.
    let (_c, driver, client) = start_mongo().await;
    let coll = client.database(DB).collection::<Document>("src");
    let head: Vec<Document> = (1..=500).map(|n| doc! { "a": n }).collect();
    coll.insert_many(head).await.expect("seed head");
    coll.insert_one(doc! { "a": 501_i64, "late": "surfaced" })
        .await
        .expect("seed tail");
    let engine = canvas_engine();

    let stream = driver
        .run_query_stream(r#"db.src.find({}).sort({"a":1})"#, &[], QueryLanguage::Native)
        .await
        .expect("open stream");
    let out = engine
        .ingest_cell_stream(BOARD, "wide", stream, None, CELL_INGEST_BYTE_BUDGET, None)
        .await
        .expect("ingest stream");

    assert_eq!(out.total_rows, 501);
    assert!(out.complete);
    assert_eq!(out.result.rows.len(), CELL_RESULT_PAGE_ROWS);
    let names: Vec<&str> = out.result.columns.iter().map(|c| c.name.as_str()).collect();
    assert!(names.contains(&"late"), "late field must have a column: {names:?}");

    // The page never shows `late` (it's on row 501), yet the cache holds it.
    let agg = engine
        .run_cell(BOARD, "late_row", "SELECT late FROM wide WHERE late IS NOT NULL")
        .await
        .expect("chained select");
    assert_eq!(agg.result.rows.len(), 1);
    assert_eq!(agg.result.rows[0][0], QueryValue::Text("surfaced".into()));
}

#[tokio::test]
async fn streaming_cancel_registers_no_cache_entry() {
    let (_c, driver, client) = start_mongo().await;
    seed_src(&client, 5_000).await;
    let engine = canvas_engine();

    let stream = driver
        .run_query_stream(r#"db.src.find({})"#, &[], QueryLanguage::Native)
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

    // The driver is healthy for new queries after the aborted stream drops.
    let r = driver
        .run_query(r#"db.src.countDocuments({})"#, &[], QueryLanguage::Native)
        .await
        .expect("query after cancel");
    assert_eq!(r.rows[0][0], QueryValue::Int(5_000));
}

#[tokio::test]
async fn streaming_byte_budget_truncates_and_reports_incomplete() {
    let (_c, driver, client) = start_mongo().await;
    seed_src(&client, 100_000).await;
    let engine = canvas_engine();

    let stream = driver
        .run_query_stream(r#"db.src.find({}).sort({"n":1})"#, &[], QueryLanguage::Native)
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
    let (_c, driver, client) = start_mongo().await;
    seed_src(&client, 10_000).await;
    let engine = canvas_engine();

    // Mongo has no SQL LIMIT wrap (PaginationStrategy::None), so the per-cell
    // limit becomes an ingest-side row cap and the query text is untouched.
    let (sql, row_cap) = QueryEngine::apply_cell_limit(
        r#"db.src.find({}).sort({"n":1})"#,
        &driver.pagination_strategy(),
        Some(500),
    );
    assert_eq!(sql, r#"db.src.find({}).sort({"n":1})"#);
    assert_eq!(row_cap, Some(500));

    let stream = driver
        .run_query_stream(&sql, &[], QueryLanguage::Native)
        .await
        .expect("open stream");
    let out = engine
        .ingest_cell_stream(BOARD, "lim", stream, None, 1 << 30, row_cap)
        .await
        .expect("ingest stream");

    assert_eq!(out.total_rows, 500);
    assert!(out.complete, "a row-capped run is a complete result");
    assert_eq!(out.result.rows.len(), 500);
}
