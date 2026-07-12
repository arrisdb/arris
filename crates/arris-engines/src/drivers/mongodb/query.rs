use futures_util::stream::{self, StreamExt};
use indexmap::IndexMap;
use mongodb::bson::{Document, RawDocumentBuf};
use mongodb::options::{
    AggregateOptions, CountOptions, FindOneOptions, FindOptions,
};
use mongodb::{Collection, Cursor};

use crate::drivers::common::RowChunkPump;
use crate::drivers::constants::STREAM_CHUNK_ROWS;
use crate::{
    ColumnSpec, DriverError, QueryLanguage, QueryResult, QueryValue, RowChunkStream,
};
use crate::drivers::errors::Result;

use super::mutation::{json_to_doc, json_to_pipeline};
use super::parser::{Chain, MongoRequest, Verb};
use super::tabular::{accumulate_columns_raw, column_index, finalize_columns, project_row_raw};

pub(super) fn parse_request(text: &str, language: QueryLanguage) -> Result<MongoRequest> {
    match language {
        QueryLanguage::Native => super::parser::parse(text)
            .map_err(|e| DriverError::InvalidArgument(e.to_string())),
        QueryLanguage::Sql => super::sql::parse(text)
            .map_err(|e| DriverError::InvalidArgument(e.to_string())),
    }
}

/// Filter, projection, and chain (limit/skip/sort) shared by the find and
/// find-one paths.
struct FindParams {
    filter: Document,
    projection: Option<Document>,
    limit: Option<i64>,
    skip: Option<u64>,
    sort: Option<Document>,
}

fn find_params(request: &MongoRequest) -> Result<FindParams> {
    let filter = match request.args.first() {
        Some(v) if !v.is_null() => json_to_doc(v, "find filter")?,
        _ => Document::new(),
    };
    let mut projection = match request.args.get(1) {
        Some(v) if !v.is_null() => Some(json_to_doc(v, "find projection")?),
        _ => None,
    };
    let mut limit = None;
    let mut skip = None;
    let mut sort = None;
    for c in &request.chain {
        match c {
            Chain::Limit(n) => limit = Some(*n),
            Chain::Skip(n) => skip = Some((*n).max(0) as u64),
            Chain::Sort(v) => sort = Some(json_to_doc(v, "sort")?),
            Chain::Project(v) => projection = Some(json_to_doc(v, "project")?),
        }
    }
    Ok(FindParams { filter, projection, limit, skip, sort })
}

async fn build_find_cursor<T>(coll: &Collection<T>, params: &FindParams) -> Result<Cursor<T>>
where
    T: serde::de::DeserializeOwned + Send + Sync + Unpin + 'static,
{
    let opts = FindOptions::builder()
        .projection(params.projection.clone())
        .sort(params.sort.clone())
        .limit(params.limit)
        .skip(params.skip)
        .build();
    coll.find(params.filter.clone())
        .with_options(opts)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))
}

pub(super) async fn execute_find<F>(
    coll: &Collection<Document>,
    request: &MongoRequest,
    elapsed: F,
) -> Result<QueryResult>
where
    F: Fn() -> f64,
{
    let params = find_params(request)?;
    let docs: Vec<Document> = if matches!(request.verb, Verb::FindOne) {
        let opts = FindOneOptions::builder()
            .projection(params.projection)
            .sort(params.sort)
            .skip(params.skip)
            .build();
        match coll
            .find_one(params.filter)
            .with_options(opts)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
        {
            Some(d) => vec![d],
            None => Vec::new(),
        }
    } else {
        let mut cursor = build_find_cursor(coll, &params).await?;
        let mut out = Vec::new();
        while let Some(item) = cursor.next().await {
            out.push(item.map_err(|e| DriverError::QueryFailed(e.to_string()))?);
        }
        out
    };

    let mut result = super::tabular::tabularize(&docs);
    result.elapsed = elapsed();
    Ok(result)
}

/// Stream a `find` in one cursor pass: buffer the first chunk to fix columns
/// from its field union (`_id` first), then hand the sampled docs plus the rest
/// of the cursor to `RowChunkPump`, which maps bson to rows on a spawned task
/// (overlapping deserialize/convert with the consumer's Arrow build + spill).
/// Fields appearing only beyond the first chunk get no column.
pub(super) async fn stream_find(
    coll: Collection<Document>,
    request: &MongoRequest,
) -> Result<RowChunkStream> {
    let params = find_params(request)?;
    let coll = coll.clone_with_type::<RawDocumentBuf>();
    let mut cursor = build_find_cursor(&coll, &params).await?;

    let mut first: Vec<RawDocumentBuf> = Vec::new();
    let mut union: IndexMap<String, ColumnSpec> = IndexMap::new();
    while first.len() < STREAM_CHUNK_ROWS {
        match cursor.next().await {
            Some(item) => {
                let doc = item.map_err(|e| DriverError::QueryFailed(e.to_string()))?;
                accumulate_columns_raw(&mut union, &doc);
                first.push(doc);
            }
            None => break,
        }
    }
    let columns = finalize_columns(union);
    let index = column_index(&columns);
    let width = columns.len();

    let rest = cursor.map(|r| r.map_err(|e| DriverError::QueryFailed(e.to_string())));
    let rows = stream::iter(first.into_iter().map(Ok::<_, DriverError>)).chain(rest);

    Ok(RowChunkPump::spawn(
        columns,
        move || async move { Ok(rows) },
        move |doc: RawDocumentBuf| project_row_raw(&doc, &index, width),
    ))
}

pub(super) async fn execute_aggregate<F>(
    coll: &mongodb::Collection<Document>,
    request: &MongoRequest,
    elapsed: F,
) -> Result<QueryResult>
where
    F: Fn() -> f64,
{
    let pipeline = json_to_pipeline(&request.args[0])?;
    let opts = AggregateOptions::builder().build();
    let mut cursor = coll
        .aggregate(pipeline)
        .with_options(opts)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    let mut docs = Vec::new();
    while let Some(item) = cursor.next().await {
        docs.push(item.map_err(|e| DriverError::QueryFailed(e.to_string()))?);
    }
    let mut result = super::tabular::tabularize(&docs);
    result.elapsed = elapsed();
    Ok(result)
}

pub(super) async fn execute_count<F>(
    coll: &mongodb::Collection<Document>,
    request: &MongoRequest,
    elapsed: F,
) -> Result<QueryResult>
where
    F: Fn() -> f64,
{
    let n = if matches!(request.verb, Verb::EstimatedDocumentCount) {
        coll.estimated_document_count()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
    } else {
        let filter = match request.args.first() {
            Some(v) if !v.is_null() => json_to_doc(v, "count filter")?,
            _ => Document::new(),
        };
        let opts = CountOptions::builder().build();
        coll.count_documents(filter)
            .with_options(opts)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
    };
    Ok(QueryResult {
        columns: vec![ColumnSpec::new("count", "int64")],
        rows: vec![vec![QueryValue::Int(n as i64)]],
        rows_affected: None,
        elapsed: elapsed(),
        ..Default::default()
    })
}

pub(super) async fn execute_insert<F>(
    coll: &mongodb::Collection<Document>,
    request: &MongoRequest,
    elapsed: F,
) -> Result<QueryResult>
where
    F: Fn() -> f64,
{
    let n = match request.verb {
        Verb::InsertOne => {
            let d = json_to_doc(&request.args[0], "insertOne doc")?;
            coll.insert_one(d)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            1
        }
        Verb::InsertMany => {
            let arr = request.args[0].as_array().ok_or_else(|| {
                DriverError::InvalidArgument("insertMany expects a JSON array".into())
            })?;
            if arr.is_empty() {
                0
            } else {
                let docs: Vec<Document> = arr
                    .iter()
                    .enumerate()
                    .map(|(i, v)| json_to_doc(v, &format!("insertMany doc {i}")))
                    .collect::<Result<_>>()?;
                let res = coll
                    .insert_many(docs)
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
                res.inserted_ids.len()
            }
        }
        _ => unreachable!(),
    };
    Ok(QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
        rows_affected: Some(n as i64),
        elapsed: elapsed(),
        ..Default::default()
    })
}

pub(super) async fn execute_update<F>(
    coll: &mongodb::Collection<Document>,
    request: &MongoRequest,
    elapsed: F,
) -> Result<QueryResult>
where
    F: Fn() -> f64,
{
    let filter = json_to_doc(&request.args[0], "update filter")?;
    let update = json_to_doc(&request.args[1], "update document")?;
    let n = match request.verb {
        Verb::UpdateOne => coll
            .update_one(filter, update)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .modified_count,
        Verb::UpdateMany => coll
            .update_many(filter, update)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .modified_count,
        _ => unreachable!(),
    };
    Ok(QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
        rows_affected: Some(n as i64),
        elapsed: elapsed(),
        ..Default::default()
    })
}

pub(super) async fn execute_delete<F>(
    coll: &mongodb::Collection<Document>,
    request: &MongoRequest,
    elapsed: F,
) -> Result<QueryResult>
where
    F: Fn() -> f64,
{
    let filter = json_to_doc(&request.args[0], "delete filter")?;
    let n = match request.verb {
        Verb::DeleteOne => coll
            .delete_one(filter)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .deleted_count,
        Verb::DeleteMany => coll
            .delete_many(filter)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .deleted_count,
        _ => unreachable!(),
    };
    Ok(QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
        rows_affected: Some(n as i64),
        elapsed: elapsed(),
        ..Default::default()
    })
}

/// Build a "command document" we can pass as the value of `explain`. Only
/// read verbs reach here.
pub(super) fn build_explain_command(request: &MongoRequest) -> Result<Document> {
    let coll = &request.collection;
    Ok(match request.verb {
        Verb::Find | Verb::FindOne => {
            let filter = match request.args.first() {
                Some(v) if !v.is_null() => json_to_doc(v, "find filter")?,
                _ => Document::new(),
            };
            let projection = match request.args.get(1) {
                Some(v) if !v.is_null() => Some(json_to_doc(v, "find projection")?),
                _ => None,
            };
            let mut find = mongodb::bson::doc! { "find": coll, "filter": filter };
            if let Some(p) = projection {
                find.insert("projection", p);
            }
            for c in &request.chain {
                match c {
                    Chain::Limit(n) => {
                        find.insert("limit", *n);
                    }
                    Chain::Skip(n) => {
                        find.insert("skip", *n);
                    }
                    Chain::Sort(v) => {
                        find.insert("sort", json_to_doc(v, "sort")?);
                    }
                    Chain::Project(v) => {
                        find.insert("projection", json_to_doc(v, "project")?);
                    }
                }
            }
            find
        }
        Verb::Aggregate => {
            let pipeline = json_to_pipeline(&request.args[0])?;
            mongodb::bson::doc! {
                "aggregate": coll,
                "pipeline": pipeline,
                "cursor": mongodb::bson::doc! {},
            }
        }
        Verb::CountDocuments => {
            let filter = match request.args.first() {
                Some(v) if !v.is_null() => json_to_doc(v, "count filter")?,
                _ => Document::new(),
            };
            mongodb::bson::doc! { "count": coll, "query": filter }
        }
        Verb::EstimatedDocumentCount => mongodb::bson::doc! { "count": coll },
        _ => return Err(DriverError::ExplainUnsupported),
    })
}
