use duckdb::Connection;

use crate::{DriverError, SchemaNode, SchemaNodeKind, TableRef};
use crate::drivers::errors::Result;

use super::query::query_rows;

pub(super) fn build_schema_nodes(conn: &Connection, db_name: &str) -> Result<Vec<SchemaNode>> {
    let tables: Vec<(String, String, String)> = query_rows(
        conn,
        "SELECT table_schema, table_name, table_type \
         FROM information_schema.tables \
         WHERE table_schema NOT IN ('information_schema', 'pg_catalog') \
         ORDER BY table_schema, table_type, table_name",
        |row| {
            (
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, String>(1).unwrap_or_default(),
                row.get::<_, String>(2).unwrap_or_default(),
            )
        },
    )?;

    let columns: Vec<(String, String, String, String, String)> = query_rows(
        conn,
        "SELECT table_schema, table_name, column_name, data_type, is_nullable \
         FROM information_schema.columns \
         WHERE table_schema NOT IN ('information_schema', 'pg_catalog') \
         ORDER BY table_schema, table_name, ordinal_position",
        |row| {
            (
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, String>(1).unwrap_or_default(),
                row.get::<_, String>(2).unwrap_or_default(),
                row.get::<_, String>(3).unwrap_or_default(),
                row.get::<_, String>(4).unwrap_or_default(),
            )
        },
    )?;

    let sequences: Vec<(String, String)> = query_rows(
        conn,
        "SELECT schema_name, sequence_name \
         FROM duckdb_sequences() \
         WHERE NOT temporary \
         ORDER BY schema_name, sequence_name",
        |row| {
            (
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, String>(1).unwrap_or_default(),
            )
        },
    )?;

    let indexes: Vec<(String, String)> = query_rows(
        conn,
        "SELECT schema_name, index_name \
         FROM duckdb_indexes() \
         ORDER BY schema_name, index_name",
        |row| {
            (
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, String>(1).unwrap_or_default(),
            )
        },
    )?;

    let functions: Vec<(String, String, String)> = query_rows(
        conn,
        "SELECT schema_name, function_name, function_type \
         FROM duckdb_functions() \
         WHERE NOT internal \
           AND schema_name NOT IN ('information_schema', 'pg_catalog') \
         ORDER BY schema_name, function_name",
        |row| {
            (
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, String>(1).unwrap_or_default(),
                row.get::<_, String>(2).unwrap_or_default(),
            )
        },
    )?;

    build_schema_tree(db_name, tables, columns, sequences, indexes, functions)
}

pub(super) fn build_schema_tree(
    db_name: &str,
    tables: Vec<(String, String, String)>,
    columns: Vec<(String, String, String, String, String)>,
    sequences: Vec<(String, String)>,
    indexes: Vec<(String, String)>,
    functions: Vec<(String, String, String)>,
) -> Result<Vec<SchemaNode>> {
    let mut tree: indexmap::IndexMap<String, indexmap::IndexMap<String, SchemaNode>> =
        indexmap::IndexMap::new();

    for (schema, name, ttype) in &tables {
        let kind = match ttype.as_str() {
            "VIEW" => SchemaNodeKind::View,
            _ => SchemaNodeKind::Table,
        };
        let path = format!("{db_name}.{schema}.{name}");
        tree.entry(schema.clone())
            .or_default()
            .insert(name.clone(), SchemaNode::new(name.clone(), kind, path));
    }

    for (schema, table, col_name, data_type, nullable) in &columns {
        let detail = if nullable == "NO" {
            format!("{data_type} NOT NULL")
        } else {
            data_type.clone()
        };
        if let Some(objs) = tree.get_mut(schema) {
            if let Some(node) = objs.get_mut(table) {
                let col_path = format!("{}.{col_name}", node.path);
                node.children.push(
                    SchemaNode::new(col_name.clone(), SchemaNodeKind::Column, col_path)
                        .with_detail(detail),
                );
            }
        }
    }

    for (schema, name) in &sequences {
        let key = format!("seq:{name}");
        let path = format!("{db_name}.{schema}.{name}");
        tree.entry(schema.clone())
            .or_default()
            .entry(key)
            .or_insert_with(|| SchemaNode::new(name.clone(), SchemaNodeKind::Sequence, path));
    }

    for (schema, name) in &indexes {
        let key = format!("idx:{name}");
        let path = format!("{db_name}.{schema}.{name}");
        tree.entry(schema.clone())
            .or_default()
            .entry(key)
            .or_insert_with(|| SchemaNode::new(name.clone(), SchemaNodeKind::Index, path));
    }

    for (schema, name, _ftype) in &functions {
        let key = format!("fn:{name}");
        let path = format!("{db_name}.{schema}.{name}");
        tree.entry(schema.clone())
            .or_default()
            .entry(key)
            .or_insert_with(|| SchemaNode::new(name.clone(), SchemaNodeKind::Function, path));
    }

    let mut schema_nodes: Vec<SchemaNode> = tree
        .into_iter()
        .map(|(schema, objs)| {
            let path = format!("{db_name}.{schema}");
            SchemaNode::new(schema, SchemaNodeKind::Schema, path)
                .with_children(objs.into_values().collect())
        })
        .collect();
    schema_nodes.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(vec![
        SchemaNode::new(db_name, SchemaNodeKind::Database, db_name)
            .with_children(schema_nodes),
    ])
}

pub(super) fn primary_key_columns(conn: &Connection, table: &TableRef) -> Result<Vec<String>> {
    let pragma = format!(
        "PRAGMA table_info('{}')",
        table.name.replace('\'', "''")
    );
    let mut stmt = conn
        .prepare(&pragma)
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    let mut rows = stmt
        .query([])
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    let mut pk: Vec<(i32, String)> = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?
    {
        let cid: i32 = row.get(0).unwrap_or(0);
        let name: String = row.get(1).unwrap_or_default();
        let is_pk: bool = row.get(5).unwrap_or(false);
        if is_pk {
            pk.push((cid, name));
        }
    }
    pk.sort_by_key(|(i, _)| *i);
    Ok(pk.into_iter().map(|(_, n)| n).collect())
}
