use indexmap::IndexMap;

use crate::{SchemaNode, SchemaNodeKind};

#[derive(Clone, Debug)]
pub(super) struct MssqlSchema {
    pub database: String,
    pub name: String,
}

#[derive(Clone, Debug)]
pub(super) struct MssqlObject {
    pub database: String,
    pub schema: String,
    pub name: String,
    pub kind: SchemaNodeKind,
}

#[derive(Clone, Debug)]
pub(super) struct MssqlColumn {
    pub database: String,
    pub schema: String,
    pub object: String,
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

fn mssql_object_key(kind: SchemaNodeKind, name: &str) -> String {
    match kind {
        SchemaNodeKind::Table | SchemaNodeKind::View => name.to_owned(),
        SchemaNodeKind::Function => format!("fn:{name}"),
        SchemaNodeKind::Procedure => format!("proc:{name}"),
        SchemaNodeKind::Sequence => format!("seq:{name}"),
        SchemaNodeKind::Type => format!("type:{name}"),
        SchemaNodeKind::Trigger => format!("trg:{name}"),
        SchemaNodeKind::Index => format!("idx:{name}"),
        _ => format!("{kind:?}:{name}"),
    }
}

pub(super) fn mssql_kind_from_catalog(kind: &str) -> Option<SchemaNodeKind> {
    match kind {
        "table" => Some(SchemaNodeKind::Table),
        "view" => Some(SchemaNodeKind::View),
        "function" => Some(SchemaNodeKind::Function),
        "procedure" => Some(SchemaNodeKind::Procedure),
        "sequence" => Some(SchemaNodeKind::Sequence),
        "type" => Some(SchemaNodeKind::Type),
        "trigger" => Some(SchemaNodeKind::Trigger),
        "index" => Some(SchemaNodeKind::Index),
        _ => None,
    }
}

pub(super) fn build_mssql_schema_tree(
    databases: Vec<String>,
    schemas: Vec<MssqlSchema>,
    objects: Vec<MssqlObject>,
    columns: Vec<MssqlColumn>,
) -> Vec<SchemaNode> {
    let mut tree: IndexMap<String, IndexMap<String, IndexMap<String, SchemaNode>>> =
        IndexMap::new();
    for database in databases {
        tree.entry(database).or_default();
    }
    for schema in schemas {
        tree.entry(schema.database)
            .or_default()
            .entry(schema.name)
            .or_default();
    }

    for object in objects {
        let path = format!("{}.{}.{}", object.database, object.schema, object.name);
        let key = mssql_object_key(object.kind, &object.name);
        tree.entry(object.database)
            .or_default()
            .entry(object.schema)
            .or_default()
            .entry(key)
            .or_insert_with(|| SchemaNode::new(object.name, object.kind, path));
    }

    for column in columns {
        let detail = if column.nullable {
            column.data_type
        } else {
            format!("{} NOT NULL", column.data_type)
        };
        if let Some(schemas) = tree.get_mut(&column.database) {
            if let Some(objects) = schemas.get_mut(&column.schema) {
                let table_key = mssql_object_key(SchemaNodeKind::Table, &column.object);
                let view_key = mssql_object_key(SchemaNodeKind::View, &column.object);
                let node = if objects.contains_key(&table_key) {
                    objects.get_mut(&table_key)
                } else {
                    objects.get_mut(&view_key)
                };
                if let Some(node) = node {
                    let col_path = format!("{}.{}", node.path, column.name);
                    node.children.push(
                        SchemaNode::new(column.name, SchemaNodeKind::Column, col_path)
                            .with_detail(detail),
                    );
                }
            }
        }
    }

    let mut database_nodes: Vec<SchemaNode> = tree
        .into_iter()
        .map(|(database, schemas)| {
            let mut schema_nodes: Vec<SchemaNode> = schemas
                .into_iter()
                .map(|(schema, objects)| {
                    let path = format!("{database}.{schema}");
                    SchemaNode::new(schema, SchemaNodeKind::Schema, path)
                        .with_children(objects.into_values().collect())
                })
                .collect();
            schema_nodes.sort_by(|a, b| a.name.cmp(&b.name));
            SchemaNode::new(database.clone(), SchemaNodeKind::Database, database)
                .with_children(schema_nodes)
        })
        .collect();
    database_nodes.sort_by(|a, b| a.name.cmp(&b.name));

    database_nodes
}
