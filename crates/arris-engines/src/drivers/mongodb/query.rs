use futures_util::stream::StreamExt;
use mongodb::bson::Document;
use mongodb::options::{
    AggregateOptions, CountOptions, FindOneOptions, FindOptions,
};

use crate::{
    ColumnSpec, DriverError, QueryLanguage, QueryResult, QueryValue,
};
use crate::drivers::errors::Result;

use super::mutation::{json_to_doc, json_to_pipeline};
use super::parser::{Chain, MongoRequest, Verb};

pub(super) fn parse_request(text: &str, language: QueryLanguage) -> Result<MongoRequest> {
    match language {
        QueryLanguage::Native => super::parser::parse(text)
            .map_err(|e| DriverError::InvalidArgument(e.to_string())),
        QueryLanguage::Sql => super::sql::parse(text)
            .map_err(|e| DriverError::InvalidArgument(e.to_string())),
    }
}

pub(super) async fn execute_find<F>(
    coll: &mongodb::Collection<Document>,
    request: &MongoRequest,
    elapsed: F,
) -> Result<QueryResult>
where
    F: Fn() -> f64,
{
    let filter: Document = match request.args.first() {
        Some(v) if !v.is_null() => json_to_doc(v, "find filter")?,
        _ => Document::new(),
    };
    let projection: Option<Document> = match request.args.get(1) {
        Some(v) if !v.is_null() => Some(json_to_doc(v, "find projection")?),
        _ => None,
    };
    let mut limit: Option<i64> = None;
    let mut skip: Option<u64> = None;
    let mut sort: Option<Document> = None;
    let mut chain_projection: Option<Document> = None;
    for c in &request.chain {
        match c {
            Chain::Limit(n) => limit = Some(*n),
            Chain::Skip(n) => skip = Some((*n).max(0) as u64),
            Chain::Sort(v) => sort = Some(json_to_doc(v, "sort")?),
            Chain::Project(v) => chain_projection = Some(json_to_doc(v, "project")?),
        }
    }
    let projection = projection.or(chain_projection);

    let docs: Vec<Document> = if matches!(request.verb, Verb::FindOne) {
        let opts = FindOneOptions::builder()
            .projection(projection)
            .sort(sort)
            .skip(skip)
            .build();
        match coll
            .find_one(filter)
            .with_options(opts)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
        {
            Some(d) => vec![d],
            None => Vec::new(),
        }
    } else {
        let opts = FindOptions::builder()
            .projection(projection)
            .sort(sort)
            .limit(limit)
            .skip(skip)
            .build();
        let mut cursor = coll
            .find(filter)
            .with_options(opts)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
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
