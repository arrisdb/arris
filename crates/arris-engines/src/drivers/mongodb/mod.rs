//! MongoDB driver — uses the official `mongodb` crate.
//!
//! Mirrors `Packages/DatabaseKit/Sources/MongoDriver/MongoDriver.swift`:
//! - `connect()` parses a `mongodb://` / `mongodb+srv://` URI built from the
//!   `ConnectionConfig`, opens a `Client`, then pings the admin DB so that
//!   lazy-connect failures surface immediately (matches Swift behaviour).
//! - `list_schemas()` is lazy: it lists databases (excluding internal ones) as
//!   empty container nodes only. `list_schema(db)` then lists that database's
//!   collections and samples up to 100 documents per collection to discover
//!   field names and types for autosuggestion (the expensive part, run only for
//!   the database the user selects).
//! - `run_query()` dispatches either native Mongo shell-style requests
//!   (`db.<coll>.<verb>(<args>).chain(...)`) or the SQL frontend to find /
//!   aggregate / count / insert / update / delete.
//! - `explain_query()` runs `db.runCommand({ explain: <command>, verbosity })`
//!   and walks the response into a `PlanNode` tree.
//! - CRUD helpers route through the `_id` primary key (Mongo has no schema PK).

mod explain;
mod mutation;
mod parser;
mod query;
mod schema;
mod sql;
mod tabular;
mod uri;

use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use futures_util::stream::StreamExt;
use mongodb::bson::{Document, doc};
use mongodb::options::{ClientOptions, InsertManyOptions};
use mongodb::Client;

use crate::{
    ConnectionConfig, DriverError, ExplainMode, MutationResult,
    QueryLanguage, QueryResult, QueryValue, RowDelete, RowInsert, SchemaNode,
    SchemaNodeKind, TableRef,
};
use crate::drivers::errors::Result;

use explain::walk_explain;
use mutation::{changes_to_set_doc, insert_doc_from, primary_key_filter};
use parser::Verb;
use query::{
    build_explain_command, execute_aggregate, execute_count, execute_delete, execute_find,
    execute_insert, execute_update, parse_request,
};
use schema::{collection_detail, collection_node_kind, fields_from_docs, index_nodes};

use crate::drivers::DatabaseDriver;

#[derive(Default)]
pub struct MongoDriver {
    inner: tokio::sync::Mutex<Option<ConnState>>,
}

struct ConnState {
    client: Arc<Client>,
    /// Default database — used when a request doesn't specify one. Sourced
    /// from the connection config (or "test" if blank, matching Mongo's
    /// shell default).
    default_db: String,
}

impl MongoDriver {
    pub fn new() -> Self {
        Self::default()
    }

    async fn state(&self) -> Result<(Arc<Client>, String)> {
        let guard = self.inner.lock().await;
        guard
            .as_ref()
            .map(|s| (s.client.clone(), s.default_db.clone()))
            .ok_or(DriverError::NotConnected)
    }

    fn db_for_table(&self, table: &TableRef, default_db: &str) -> String {
        table
            .database
            .clone()
            .or_else(|| table.schema.clone())
            .unwrap_or_else(|| default_db.to_owned())
    }
}

#[async_trait]
impl DatabaseDriver for MongoDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        let uri = uri::build_uri(config);
        let mut opts = ClientOptions::parse(&uri)
            .await
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;
        opts.app_name = Some("arris".into());

        let client = Client::with_options(opts)
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;

        // Ping `admin` so a bad URI / unreachable host fails here instead of
        // on the first query (libmongoc lazy-connects otherwise — matches the
        // Swift driver's `mongo_connect_ping` behaviour).
        client
            .database("admin")
            .run_command(doc! { "ping": 1 })
            .await
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;

        let default_db = if config.database.is_empty() {
            "test".to_owned()
        } else {
            config.database.clone()
        };
        *self.inner.lock().await = Some(ConnState {
            client: Arc::new(client),
            default_db,
        });
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    fn pagination_strategy(&self) -> crate::PaginationStrategy {
        // Mongo's SQL frontend only understands a single `SELECT ... FROM
        // <collection>`; it has no derived-table / subquery support. The
        // default `SubqueryOffset` wraps queries as
        // `SELECT * FROM (<sql>) AS _p LIMIT ... OFFSET ...`, which the SQL
        // parser rejects with "expected identifier" on the `(`. Slice in
        // memory instead so the original SQL reaches the driver untouched
        // (matches the other NoSQL drivers: Elasticsearch, Redis).
        crate::PaginationStrategy::None
    }

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        let (client, _) = self.state().await?;
        let mut db_names: Vec<String> = client
            .list_database_names()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        db_names.retain(|n| !matches!(n.as_str(), "admin" | "local" | "config"));
        db_names.sort();

        // Lazy: database containers only, with empty children. Listing each
        // database's collections and sampling up to 100 documents per
        // collection for field/type inference is the expensive part; it moves
        // to `list_schema` and runs only for the database the user selects.
        Ok(db_names
            .into_iter()
            .map(|db_name| SchemaNode::new(db_name.clone(), SchemaNodeKind::Database, db_name))
            .collect())
    }

    async fn list_schema(&self, schema: &str) -> Result<Vec<SchemaNode>> {
        let (client, _) = self.state().await?;
        let coll_nodes = self.collection_nodes(&client, schema).await?;
        Ok(vec![
            SchemaNode::new(schema.to_owned(), SchemaNodeKind::Database, schema.to_owned())
                .with_children(coll_nodes),
        ])
    }

    async fn run_query(
        &self,
        text: &str,
        _params: &[QueryValue],
        language: QueryLanguage,
    ) -> Result<QueryResult> {
        let request = parse_request(text, language)?;
        let started = Instant::now();
        self.dispatch_request(request, || started.elapsed().as_secs_f64())
            .await
    }

    async fn explain_query(
        &self,
        text: &str,
        _params: &[QueryValue],
        language: QueryLanguage,
        mode: ExplainMode,
    ) -> Result<crate::PlanResult> {
        let request = parse_request(text, language)?;
        if !request.verb.is_read() {
            return Err(DriverError::ExplainUnsupported);
        }
        let (client, default_db) = self.state().await?;
        let db_name = request.database.as_deref().unwrap_or(&default_db);
        let inner_command = build_explain_command(&request)?;
        let verbosity = match mode {
            ExplainMode::DryRun => "queryPlanner",
            ExplainMode::Analyze => "executionStats",
        };
        let cmd = doc! {
            "explain": inner_command,
            "verbosity": verbosity,
        };
        let resp = client
            .database(db_name)
            .run_command(cmd)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let raw_value: serde_json::Value = serde_json::to_value(&resp)
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let raw = serde_json::to_string_pretty(&raw_value).unwrap_or_default();
        let root = walk_explain(&raw_value);
        Ok(crate::PlanResult::new(root, mode, raw))
    }

    async fn primary_key(&self, _table: &TableRef) -> Result<Option<Vec<String>>> {
        // Mongo has no declared PK; `_id` is always implicit (mirrors Swift).
        Ok(Some(vec!["_id".to_owned()]))
    }

    async fn update_row(
        &self,
        table: &TableRef,
        primary_key: &crate::ValueMap,
        changes: &crate::ValueMap,
    ) -> Result<MutationResult> {
        let (client, default_db) = self.state().await?;
        let db_name = self.db_for_table(table, &default_db);
        let coll = client
            .database(&db_name)
            .collection::<Document>(&table.name);
        let filter = primary_key_filter(primary_key.iter())?;
        let update = changes_to_set_doc(changes.iter());
        let stmt = format!(
            "db.{}.updateOne({}, {})",
            table.name, filter, update
        );
        let res = coll
            .update_one(filter, update)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        Ok(MutationResult {
            rows_affected: res.modified_count as usize,
            statements: vec![stmt],
        })
    }

    async fn insert_rows(&self, table: &TableRef, inserts: &[RowInsert]) -> Result<MutationResult> {
        if inserts.is_empty() {
            return Ok(MutationResult::default());
        }
        let (client, default_db) = self.state().await?;
        let db_name = self.db_for_table(table, &default_db);
        let coll = client
            .database(&db_name)
            .collection::<Document>(&table.name);
        let docs: Vec<Document> = inserts
            .iter()
            .map(|i| insert_doc_from(i.values.iter()))
            .collect();
        let stmt = format!(
            "db.{}.insertMany([{} doc(s)])",
            table.name, docs.len()
        );
        let res = coll
            .insert_many(docs)
            .with_options(InsertManyOptions::builder().ordered(true).build())
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        Ok(MutationResult {
            rows_affected: res.inserted_ids.len(),
            statements: vec![stmt],
        })
    }

    async fn delete_rows(&self, table: &TableRef, deletes: &[RowDelete]) -> Result<MutationResult> {
        let (client, default_db) = self.state().await?;
        let db_name = self.db_for_table(table, &default_db);
        let coll = client
            .database(&db_name)
            .collection::<Document>(&table.name);
        let mut result = MutationResult::default();
        for del in deletes {
            let filter = primary_key_filter(del.primary_key.iter())?;
            let stmt = format!("db.{}.deleteOne({})", table.name, filter);
            let res = coll
                .delete_one(filter)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            result.rows_affected += res.deleted_count as usize;
            result.statements.push(stmt);
        }
        Ok(result)
    }

    async fn close(&self) {
        // Dropping the `Client` lets background threads exit. The mongodb
        // driver pools connections internally; nothing else to clean up.
        *self.inner.lock().await = None;
    }
}

impl MongoDriver {
    /// List one database's collections and, per collection, sample up to 100
    /// documents to discover field names and types plus index nodes. This is
    /// the expensive schema work, run lazily per-selected-database from
    /// `list_schema` rather than eagerly across every database.
    async fn collection_nodes(
        &self,
        client: &Client,
        db_name: &str,
    ) -> Result<Vec<SchemaNode>> {
        let db = client.database(db_name);
        let mut collection_specs: Vec<mongodb::results::CollectionSpecification> = Vec::new();
        let mut collections = db
            .list_collections()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        while let Some(item) = collections.next().await {
            collection_specs.push(item.map_err(|e| DriverError::QueryFailed(e.to_string()))?);
        }
        collection_specs.sort_by(|a, b| a.name.cmp(&b.name));

        let mut coll_nodes: Vec<SchemaNode> = Vec::with_capacity(collection_specs.len());
        for spec in collection_specs {
            let coll_name = spec.name.clone();
            let coll_path = format!("{db_name}.{coll_name}");
            let collection = db.collection::<Document>(&coll_name);
            let mut cursor = collection
                .find(doc! {})
                .limit(100)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            let mut sample_docs = Vec::new();
            while let Some(item) = cursor.next().await {
                sample_docs.push(item.map_err(|e| DriverError::QueryFailed(e.to_string()))?);
            }
            let mut children = fields_from_docs(&sample_docs, &coll_path);
            children.extend(index_nodes(&collection, &spec, &coll_path).await?);
            coll_nodes.push(
                SchemaNode::new(coll_name, collection_node_kind(&spec), coll_path)
                    .with_detail(collection_detail(&spec))
                    .with_children(children),
            );
        }
        Ok(coll_nodes)
    }

    async fn dispatch_request<F>(&self, request: parser::MongoRequest, elapsed: F) -> Result<QueryResult>
    where
        F: Fn() -> f64,
    {
        let (client, default_db) = self.state().await?;
        let db_name = request.database.as_deref().unwrap_or(&default_db);
        let coll = client
            .database(db_name)
            .collection::<Document>(&request.collection);

        match request.verb {
            Verb::Find | Verb::FindOne => execute_find(&coll, &request, elapsed).await,
            Verb::Aggregate => execute_aggregate(&coll, &request, elapsed).await,
            Verb::CountDocuments | Verb::EstimatedDocumentCount => {
                execute_count(&coll, &request, elapsed).await
            }
            Verb::InsertOne | Verb::InsertMany => execute_insert(&coll, &request, elapsed).await,
            Verb::UpdateOne | Verb::UpdateMany => execute_update(&coll, &request, elapsed).await,
            Verb::DeleteOne | Verb::DeleteMany => execute_delete(&coll, &request, elapsed).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::doc;
    use mongodb::options::IndexOptions;
    use mongodb::IndexModel;
    use serde_json::json;

    use mutation::{coerce_id, json_to_doc};
    use query::build_explain_command;
    use schema::{
        collection_detail, collection_node_kind, fields_from_docs, schema_index_nodes,
    };

    #[test]
    fn driver_starts_disconnected() {
        let d = MongoDriver::new();
        let connected = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(d.is_connected());
        assert!(!connected);
    }

    #[test]
    fn pagination_strategy_is_none() {
        // Mongo has no SQL subquery support; the query engine must slice in
        // memory rather than wrap the SQL in a derived table.
        let d = MongoDriver::new();
        assert_eq!(d.pagination_strategy(), crate::PaginationStrategy::None);
    }

    #[test]
    fn coerce_id_text_promotes_24char_hex_to_objectid() {
        let v = QueryValue::Text("507f1f77bcf86cd799439011".into());
        match coerce_id(&v) {
            mongodb::bson::Bson::ObjectId(_) => (),
            other => panic!("expected ObjectId, got {other:?}"),
        }
    }

    #[test]
    fn coerce_id_text_keeps_non_hex_string() {
        let v = QueryValue::Text("hello".into());
        match coerce_id(&v) {
            mongodb::bson::Bson::String(s) => assert_eq!(s, "hello"),
            other => panic!("expected String, got {other:?}"),
        }
    }

    #[test]
    fn json_to_doc_rejects_non_object() {
        let err = json_to_doc(&json!([1, 2, 3]), "filter").unwrap_err();
        assert!(matches!(err, DriverError::InvalidArgument(_)));
    }

    #[test]
    fn build_explain_command_for_find_includes_filter_and_chain() {
        let req = parser::parse(r#"db.users.find({"a":1}).limit(5).sort({"a":-1})"#).unwrap();
        let cmd = build_explain_command(&req).unwrap();
        assert_eq!(cmd.get_str("find").unwrap(), "users");
        assert_eq!(cmd.get_i64("limit").unwrap(), 5);
        assert!(cmd.contains_key("sort"));
        assert!(cmd.contains_key("filter"));
    }

    #[test]
    fn build_explain_command_for_aggregate_wraps_pipeline() {
        let req = parser::parse(r#"db.orders.aggregate([{"$match":{"x":1}}])"#).unwrap();
        let cmd = build_explain_command(&req).unwrap();
        assert_eq!(cmd.get_str("aggregate").unwrap(), "orders");
        assert!(cmd.contains_key("pipeline"));
    }

    #[test]
    fn build_explain_command_rejects_writes() {
        let req = parser::parse(r#"db.users.deleteOne({"_id":"x"})"#).unwrap();
        let err = build_explain_command(&req).unwrap_err();
        assert!(matches!(err, DriverError::ExplainUnsupported));
    }

    #[test]
    fn walk_explain_picks_winning_plan_stage() {
        let v = json!({
            "queryPlanner": {
                "winningPlan": {
                    "stage": "FETCH",
                    "inputStage": { "stage": "IXSCAN", "keyPattern": { "a": 1 } }
                }
            }
        });
        let plan = walk_explain(&v);
        assert_eq!(plan.label, "FETCH");
        assert_eq!(plan.children.len(), 1);
        assert_eq!(plan.children[0].label, "IXSCAN");
    }

    #[test]
    fn primary_key_filter_rejects_empty() {
        let pk: indexmap::IndexMap<String, QueryValue> = indexmap::IndexMap::new();
        let err = primary_key_filter(pk.iter()).unwrap_err();
        assert!(matches!(err, DriverError::InvalidArgument(_)));
    }

    #[test]
    fn fields_from_docs_empty_returns_empty() {
        let result = fields_from_docs(&[], "db.coll");
        assert!(result.is_empty());
    }

    #[test]
    fn fields_from_docs_id_first_then_other_fields() {
        let oid = mongodb::bson::oid::ObjectId::new();
        let docs = vec![
            doc! { "_id": oid, "name": "alice", "age": 30 },
            doc! { "_id": oid, "age": 31, "city": "NYC" },
        ];
        let cols = fields_from_docs(&docs, "mydb.users");
        let names: Vec<&str> = cols.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["_id", "name", "age", "city"]);
        assert!(cols.iter().all(|c| c.kind == SchemaNodeKind::Column));
    }

    #[test]
    fn fields_from_docs_includes_type_detail() {
        let docs = vec![doc! { "count": 42, "label": "x", "active": true }];
        let cols = fields_from_docs(&docs, "db.c");
        let find = |name: &str| cols.iter().find(|c| c.name == name).unwrap();
        assert_eq!(find("count").detail.as_deref(), Some("int32"));
        assert_eq!(find("label").detail.as_deref(), Some("string"));
        assert_eq!(find("active").detail.as_deref(), Some("bool"));
    }

    #[test]
    fn fields_from_docs_uses_hierarchical_path() {
        let docs = vec![doc! { "_id": 1, "x": 2 }];
        let cols = fields_from_docs(&docs, "mydb.orders");
        assert_eq!(cols[0].path, "mydb.orders._id");
        assert_eq!(cols[1].path, "mydb.orders.x");
    }

    #[test]
    fn fields_from_docs_no_id_when_absent() {
        let docs = vec![doc! { "a": 1 }];
        let cols = fields_from_docs(&docs, "db.c");
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0].name, "a");
    }

    #[test]
    fn collection_detail_distinguishes_mongo_collection_types() {
        let mut regular = mongodb::results::CollectionSpecification::default();
        regular.collection_type = mongodb::results::CollectionType::Collection;
        assert_eq!(collection_node_kind(&regular), SchemaNodeKind::Collection);
        assert_eq!(collection_detail(&regular), "regular");

        let mut capped = regular.clone();
        capped.options.capped = Some(true);
        assert_eq!(collection_detail(&capped), "capped");

        let mut timeseries = mongodb::results::CollectionSpecification::default();
        timeseries.collection_type = mongodb::results::CollectionType::Timeseries;
        assert_eq!(
            collection_node_kind(&timeseries),
            SchemaNodeKind::Collection
        );
        assert_eq!(collection_detail(&timeseries), "time-series");

        let mut view = mongodb::results::CollectionSpecification::default();
        view.collection_type = mongodb::results::CollectionType::View;
        assert_eq!(collection_node_kind(&view), SchemaNodeKind::View);
        assert_eq!(collection_detail(&view), "view");
    }

    #[test]
    fn schema_index_nodes_surface_names_paths_and_details() {
        let indexes = vec![
            IndexModel::builder()
                .keys(doc! { "email": 1 })
                .options(
                    IndexOptions::builder()
                        .name(Some("email_unique".to_owned()))
                        .unique(true)
                        .build(),
                )
                .build(),
            IndexModel::builder()
                .keys(doc! { "created_at": -1 })
                .build(),
        ];
        let nodes = schema_index_nodes(indexes, "app.users");

        assert_eq!(nodes[0].name, "email_unique");
        assert_eq!(nodes[0].kind, SchemaNodeKind::Index);
        assert_eq!(nodes[0].path, "app.users.__index__.email_unique");
        assert_eq!(
            nodes[0].detail.as_deref(),
            Some("index on email asc \u{00b7} unique"),
        );
        assert_eq!(nodes[1].name, "created_at: -1");
        assert_eq!(nodes[1].detail.as_deref(), Some("index on created_at desc"));
    }
}
