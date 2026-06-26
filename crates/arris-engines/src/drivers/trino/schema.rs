use serde_json::Value;

use super::api::TrinoApi;
use crate::drivers::errors::Result;
use crate::{SchemaNode, SchemaNodeKind};

pub(super) struct TrObject {
    pub schema: String,
    pub name: String,
    pub kind: SchemaNodeKind,
}

pub(super) struct TrColumn {
    pub schema: String,
    pub table: String,
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

fn tr_kind(table_type: &str) -> SchemaNodeKind {
    match table_type {
        "VIEW" => SchemaNodeKind::View,
        _ => SchemaNodeKind::Table,
    }
}

fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

fn text_cell(row: &[Value], idx: usize) -> Option<String> {
    match row.get(idx) {
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

async fn list_catalogs(api: &TrinoApi) -> Result<Vec<String>> {
    let resp = api.query("SHOW CATALOGS").await?;
    Ok(resp.rows.iter().filter_map(|r| text_cell(r, 0)).collect())
}

async fn list_catalog_schemas(api: &TrinoApi, catalog: &str) -> Result<Vec<String>> {
    let cat = quote_ident(catalog);
    let resp = api
        .query(&format!(
            "SELECT schema_name FROM {cat}.information_schema.schemata \
             WHERE schema_name <> 'information_schema' ORDER BY schema_name"
        ))
        .await?;
    Ok(resp.rows.iter().filter_map(|r| text_cell(r, 0)).collect())
}

/// Cheap: enumerate catalogs only. Each catalog becomes a `Database` node with
/// EMPTY children. Trino is catalog -> schema -> table, and the frontend's
/// dropdown picks CATALOGS; a catalog's schemas (and their tables/columns) load
/// on demand via `list_schema` when the user selects the catalog. One
/// `SHOW CATALOGS` query, nothing per-schema or per-table here.
pub(super) async fn build_trino_schema_tree(api: &TrinoApi) -> Result<Vec<SchemaNode>> {
    let catalogs = list_catalogs(api).await?;
    Ok(catalogs
        .iter()
        .map(|c| SchemaNode::new(c, SchemaNodeKind::Database, c))
        .collect())
}

/// Lazy per-catalog load. The frontend passes a catalog name (Trino's selector
/// picks catalogs). Enumerate the catalog's schemas, load each schema's
/// tables/views and their columns, and return the populated `Database` (catalog)
/// node carrying the same `{catalog}` path `list_schemas` produced so the
/// frontend merges it by path (`replaceNodeByPath`).
pub(super) async fn build_trino_schema(api: &TrinoApi, catalog: &str) -> Result<Vec<SchemaNode>> {
    let schemas = list_catalog_schemas(api, catalog).await?;

    let mut schema_nodes = Vec::new();
    for schema in &schemas {
        if let Ok(node) = build_schema_node(api, catalog, schema).await {
            schema_nodes.push(node);
        }
    }
    Ok(vec![assemble_catalog(catalog, schema_nodes)])
}

async fn build_schema_node(api: &TrinoApi, catalog: &str, schema: &str) -> Result<SchemaNode> {
    let cat = quote_ident(catalog);
    let lit = schema.replace('\'', "''");

    let obj_resp = api
        .query(&format!(
            "SELECT table_schema, table_name, table_type FROM {cat}.information_schema.tables \
             WHERE table_schema = '{lit}' ORDER BY table_name"
        ))
        .await?;
    let objects: Vec<TrObject> = obj_resp
        .rows
        .iter()
        .filter_map(|r| {
            Some(TrObject {
                schema: text_cell(r, 0)?,
                name: text_cell(r, 1)?,
                kind: tr_kind(&text_cell(r, 2)?),
            })
        })
        .collect();

    let col_resp = api
        .query(&format!(
            "SELECT table_schema, table_name, column_name, data_type, is_nullable \
             FROM {cat}.information_schema.columns \
             WHERE table_schema = '{lit}' \
             ORDER BY table_name, ordinal_position"
        ))
        .await?;
    let columns: Vec<TrColumn> = col_resp
        .rows
        .iter()
        .filter_map(|r| {
            Some(TrColumn {
                schema: text_cell(r, 0)?,
                table: text_cell(r, 1)?,
                name: text_cell(r, 2)?,
                data_type: text_cell(r, 3)?,
                nullable: text_cell(r, 4).map(|v| v == "YES").unwrap_or(true),
            })
        })
        .collect();

    Ok(assemble_schema(catalog, schema, &objects, &columns))
}

/// Build a `Database` (catalog) node from already-populated `Schema` children.
/// Used by the lazy `build_trino_schema` to wrap a catalog's loaded schemas.
pub(super) fn assemble_catalog(catalog: &str, schemas: Vec<SchemaNode>) -> SchemaNode {
    SchemaNode::new(catalog, SchemaNodeKind::Database, catalog).with_children(schemas)
}

/// Build a single populated `Schema` node (path `{catalog}.{schema}`) with its
/// tables/views and their columns. Used by the lazy `build_trino_schema`.
pub(super) fn assemble_schema(
    catalog: &str,
    schema: &str,
    objects: &[TrObject],
    columns: &[TrColumn],
) -> SchemaNode {
    let schema_path = format!("{catalog}.{schema}");
    let mut schema_node = SchemaNode::new(schema, SchemaNodeKind::Schema, &schema_path);

    for obj in objects.iter().filter(|o| o.schema == *schema) {
        let obj_path = format!("{catalog}.{schema}.{}", obj.name);
        let mut obj_node = SchemaNode::new(&obj.name, obj.kind, &obj_path);

        for col in columns
            .iter()
            .filter(|c| c.schema == *schema && c.table == obj.name)
        {
            let col_path = format!("{obj_path}.{}", col.name);
            let nullable = if col.nullable { "NULL" } else { "NOT NULL" };
            let detail = format!("{} {nullable}", col.data_type);
            obj_node.children.push(
                SchemaNode::new(&col.name, SchemaNodeKind::Column, &col_path)
                    .with_detail(detail),
            );
        }

        schema_node.children.push(obj_node);
    }

    schema_node
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tr_kind_maps_views_and_tables() {
        assert_eq!(tr_kind("BASE TABLE"), SchemaNodeKind::Table);
        assert_eq!(tr_kind("VIEW"), SchemaNodeKind::View);
        assert_eq!(tr_kind("anything"), SchemaNodeKind::Table);
    }

    #[test]
    fn quote_ident_escapes_double_quotes() {
        assert_eq!(quote_ident("memory"), "\"memory\"");
        assert_eq!(quote_ident("we\"ird"), "\"we\"\"ird\"");
    }

    #[test]
    fn assemble_catalog_wraps_populated_schema_children() {
        // Lazy per-catalog load: the catalog Database node carries the schemas
        // that were loaded for it, each already populated with its objects.
        let default = assemble_schema(
            "memory",
            "default",
            &[TrObject { schema: "default".into(), name: "users".into(), kind: SchemaNodeKind::Table }],
            &[],
        );
        let analytics = assemble_schema("memory", "analytics", &[], &[]);
        let node = assemble_catalog("memory", vec![default, analytics]);

        assert_eq!(node.name, "memory");
        assert_eq!(node.kind, SchemaNodeKind::Database);
        assert_eq!(node.path, "memory");
        assert_eq!(node.children.len(), 2);

        let default = node.children.iter().find(|s| s.name == "default").unwrap();
        assert_eq!(default.kind, SchemaNodeKind::Schema);
        assert_eq!(default.path, "memory.default");
        assert_eq!(default.children.len(), 1);
        assert_eq!(default.children[0].name, "users");

        let analytics = node.children.iter().find(|s| s.name == "analytics").unwrap();
        assert_eq!(analytics.path, "memory.analytics");
        assert!(analytics.children.is_empty());
    }

    #[test]
    fn assemble_catalog_empty_schemas_has_no_children() {
        let node = assemble_catalog("memory", vec![]);
        assert!(node.children.is_empty());
    }

    #[test]
    fn assemble_schema_nests_table_and_column_with_catalog_qualified_path() {
        let node = assemble_schema(
            "memory",
            "default",
            &[
                TrObject { schema: "default".into(), name: "users".into(), kind: SchemaNodeKind::Table },
                TrObject { schema: "default".into(), name: "events_v".into(), kind: SchemaNodeKind::View },
            ],
            &[TrColumn {
                schema: "default".into(),
                table: "users".into(),
                name: "id".into(),
                data_type: "bigint".into(),
                nullable: false,
            }],
        );

        // The returned node is the bare Schema container with the SAME path the
        // cheap `assemble_catalog` produced for it — the frontend merges by path.
        assert_eq!(node.name, "default");
        assert_eq!(node.kind, SchemaNodeKind::Schema);
        assert_eq!(node.path, "memory.default");
        assert_eq!(node.children.len(), 2);

        let users = node.children.iter().find(|t| t.name == "users").unwrap();
        assert_eq!(users.kind, SchemaNodeKind::Table);
        assert_eq!(users.path, "memory.default.users");
        assert_eq!(users.children[0].name, "id");
        assert_eq!(users.children[0].path, "memory.default.users.id");
        assert_eq!(users.children[0].detail.as_deref(), Some("bigint NOT NULL"));

        let events = node.children.iter().find(|t| t.name == "events_v").unwrap();
        assert_eq!(events.kind, SchemaNodeKind::View);
        assert!(events.children.is_empty());
    }

    #[test]
    fn assemble_schema_empty_objects_has_no_children() {
        let node = assemble_schema("memory", "default", &[], &[]);
        assert_eq!(node.path, "memory.default");
        assert!(node.children.is_empty());
    }
}
