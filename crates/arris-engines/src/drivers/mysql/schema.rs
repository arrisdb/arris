use indexmap::IndexMap;

use crate::{SchemaNode, SchemaNodeKind};

pub(super) type MysqlTableRow = (String, String, String);
pub(super) type MysqlColumnRow = (String, String, String, String, String, i64);
pub(super) type MysqlRoutineRow = (String, String, String);
pub(super) type MysqlNamedObjectRow = (String, String);

fn mysql_table_kind(table_type: &str) -> SchemaNodeKind {
    match table_type {
        "BASE TABLE" | "SYSTEM VERSIONED" => SchemaNodeKind::Table,
        "VIEW" => SchemaNodeKind::View,
        "SEQUENCE" => SchemaNodeKind::Sequence,
        _ => SchemaNodeKind::Table,
    }
}

pub(super) fn build_mysql_schema_tree(
    dbs: Vec<String>,
    tables: Vec<MysqlTableRow>,
    cols: Vec<MysqlColumnRow>,
    routines: Vec<MysqlRoutineRow>,
    events: Vec<MysqlNamedObjectRow>,
    triggers: Vec<MysqlNamedObjectRow>,
) -> Vec<SchemaNode> {
    let mut tree: IndexMap<String, IndexMap<String, SchemaNode>> = IndexMap::new();
    for db in dbs {
        tree.insert(db, IndexMap::new());
    }
    for (db, tbl, ttype) in tables {
        let kind = mysql_table_kind(&ttype);
        let path = format!("{db}.{tbl}");
        tree.entry(db)
            .or_default()
            .insert(format!("table:{tbl}"), SchemaNode::new(tbl, kind, path));
    }
    for (db, tbl, col, col_type, is_nullable, _ord) in cols {
        let detail = if is_nullable == "NO" {
            format!("{col_type} NOT NULL")
        } else {
            col_type
        };
        if let Some(t) = tree.get_mut(&db) {
            if let Some(node) = t.get_mut(&format!("table:{tbl}")) {
                let col_path = format!("{}.{}", node.path, col);
                node.children.push(
                    SchemaNode::new(col, SchemaNodeKind::Column, col_path).with_detail(detail),
                );
            }
        }
    }
    for (db, name, routine_type) in routines {
        let kind = if routine_type.eq_ignore_ascii_case("PROCEDURE") {
            SchemaNodeKind::Procedure
        } else {
            SchemaNodeKind::Function
        };
        let key = format!("routine:{}:{name}", routine_type.to_lowercase());
        let path = format!("{db}.routines.{name}");
        tree.entry(db)
            .or_default()
            .entry(key)
            .or_insert_with(|| SchemaNode::new(name, kind, path));
    }
    for (db, name) in events {
        let key = format!("event:{name}");
        let path = format!("{db}.events.{name}");
        tree.entry(db)
            .or_default()
            .entry(key)
            .or_insert_with(|| SchemaNode::new(name, SchemaNodeKind::Event, path));
    }
    for (db, name) in triggers {
        let key = format!("trigger:{name}");
        let path = format!("{db}.triggers.{name}");
        tree.entry(db)
            .or_default()
            .entry(key)
            .or_insert_with(|| SchemaNode::new(name, SchemaNodeKind::Trigger, path));
    }

    let mut out: Vec<SchemaNode> = tree
        .into_iter()
        .map(|(db, tbls)| {
            let path = db.clone();
            SchemaNode::new(db, SchemaNodeKind::Database, path)
                .with_children(tbls.into_values().collect())
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}
