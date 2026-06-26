use rusqlite::Connection;

use crate::{DriverError, SchemaNode, SchemaNodeKind, TableRef};
use crate::drivers::errors::Result;

pub(super) fn build_schema_nodes(conn: &Connection, db_name: &str) -> Result<Vec<SchemaNode>> {
    let mut tables: Vec<(String, String)> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type, name")
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let mut rows = stmt
            .query([])
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        while let Some(row) = rows
            .next()
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
        {
            let name: String = row
                .get(0)
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            let kind: String = row
                .get(1)
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            tables.push((name, kind));
        }
    }

    let mut nodes: Vec<SchemaNode> = Vec::new();
    for (name, kind) in tables {
        let node_kind = match kind.as_str() {
            "table" => SchemaNodeKind::Table,
            "view" => SchemaNodeKind::View,
            "index" => SchemaNodeKind::Index,
            "trigger" => SchemaNodeKind::Trigger,
            _ => continue,
        };
        let path = format!("{db_name}.{name}");
        let mut node = SchemaNode::new(name.clone(), node_kind, &path);

        if matches!(node_kind, SchemaNodeKind::Table | SchemaNodeKind::View) {
            let pragma = format!("PRAGMA table_info(\"{}\")", name.replace('"', "\"\""));
            if let Ok(mut s) = conn.prepare(&pragma) {
                if let Ok(mut rs) = s.query([]) {
                    while let Some(r) = rs.next().unwrap_or(None) {
                        let col_name: String = r.get(1).unwrap_or_default();
                        let col_type: String = r.get(2).unwrap_or_default();
                        let not_null: i32 = r.get(3).unwrap_or(0);
                        let detail = if not_null == 0 {
                            col_type
                        } else {
                            format!("{col_type} NOT NULL")
                        };
                        let col_path = format!("{path}.{col_name}");
                        node.children.push(
                            SchemaNode::new(col_name, SchemaNodeKind::Column, col_path)
                                .with_detail(detail),
                        );
                    }
                }
            }
        }
        nodes.push(node);
    }

    Ok(vec![
        SchemaNode::new(db_name, SchemaNodeKind::Database, db_name).with_children(nodes),
    ])
}

pub(super) fn primary_key_columns(conn: &Connection, table: &TableRef) -> Result<Vec<String>> {
    let pragma = format!(
        "PRAGMA table_info(\"{}\")",
        table.name.replace('"', "\"\"")
    );
    let mut stmt = conn
        .prepare(&pragma)
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    let mut rows = stmt
        .query([])
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    let mut pk: Vec<(i32, String)> = Vec::new();
    while let Some(r) = rows
        .next()
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?
    {
        let name: String = r
            .get(1)
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let pk_idx: i32 = r.get(5).unwrap_or(0);
        if pk_idx > 0 {
            pk.push((pk_idx, name));
        }
    }
    pk.sort_by_key(|(i, _)| *i);
    Ok(pk.into_iter().map(|(_, n)| n).collect())
}
