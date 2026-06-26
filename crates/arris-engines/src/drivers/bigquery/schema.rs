use crate::{SchemaNode, SchemaNodeKind};

pub(super) struct DatasetMeta {
    pub(super) id: String,
}

pub(super) struct TableMeta {
    pub(super) id: String,
    pub(super) kind: TableKind,
}

pub(super) enum TableKind {
    Table,
    View,
    MaterializedView,
}

impl TableKind {
    pub(super) fn from_bq_type(s: &str) -> Self {
        match s {
            "VIEW" => Self::View,
            "MATERIALIZED_VIEW" | "MATERIALIZED VIEW" => Self::MaterializedView,
            _ => Self::Table,
        }
    }

    fn schema_node_kind(&self) -> SchemaNodeKind {
        match self {
            Self::Table => SchemaNodeKind::Table,
            Self::View => SchemaNodeKind::View,
            Self::MaterializedView => SchemaNodeKind::MaterializedView,
        }
    }
}

pub(super) struct ColumnMeta {
    pub(super) name: String,
    pub(super) data_type: String,
}

fn build_table_node(
    project: &str,
    dataset: &str,
    table: &TableMeta,
    columns: &[ColumnMeta],
) -> SchemaNode {
    let path = format!("{project}.{dataset}.{}", table.id);
    let children = columns
        .iter()
        .map(|c| {
            SchemaNode::new(&c.name, SchemaNodeKind::Column, format!("{path}.{}", c.name))
                .with_detail(&c.data_type)
        })
        .collect();
    SchemaNode::new(&table.id, table.kind.schema_node_kind(), path).with_children(children)
}

/// Builds a single dataset's `Schema` node populated with its table/column
/// children. Returned by `list_schema` so the frontend can lazily fill in one
/// dataset's tables on selection without refetching the whole project.
pub(super) fn build_dataset_node(
    project: &str,
    dataset: &DatasetMeta,
    tables: &[(TableMeta, Vec<ColumnMeta>)],
) -> SchemaNode {
    let path = format!("{project}.{}", dataset.id);
    let children = tables
        .iter()
        .map(|(t, cols)| build_table_node(project, &dataset.id, t, cols))
        .collect();
    SchemaNode::new(&dataset.id, SchemaNodeKind::Schema, path).with_children(children)
}

/// Datasets-only tree: a `Database` root whose children are the dataset
/// `Schema` nodes with **no** table children. Returned by `list_schemas` so a
/// connection loads cheaply (one `SCHEMATA` query); each dataset's tables are
/// fetched lazily on selection via [`build_dataset_node`].
pub(super) fn build_datasets_only(project: &str, datasets: &[DatasetMeta]) -> Vec<SchemaNode> {
    let children: Vec<SchemaNode> = datasets
        .iter()
        .map(|ds| {
            let path = format!("{project}.{}", ds.id);
            SchemaNode::new(&ds.id, SchemaNodeKind::Schema, path)
        })
        .collect();
    let root = SchemaNode::new(project, SchemaNodeKind::Database, project).with_children(children);
    vec![root]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_dataset_node_produces_correct_hierarchy() {
        let dataset = DatasetMeta { id: "ds1".into() };
        let tables = vec![(
            TableMeta {
                id: "users".into(),
                kind: TableKind::Table,
            },
            vec![
                ColumnMeta { name: "id".into(), data_type: "INT64".into() },
                ColumnMeta { name: "name".into(), data_type: "STRING".into() },
            ],
        )];

        let ds = build_dataset_node("my-project", &dataset, &tables);
        assert_eq!(ds.name, "ds1");
        assert_eq!(ds.kind, SchemaNodeKind::Schema);
        assert_eq!(ds.path, "my-project.ds1");
        assert_eq!(ds.children.len(), 1);

        let tbl = &ds.children[0];
        assert_eq!(tbl.name, "users");
        assert_eq!(tbl.kind, SchemaNodeKind::Table);
        assert_eq!(tbl.path, "my-project.ds1.users");
        assert_eq!(tbl.children.len(), 2);

        let col = &tbl.children[0];
        assert_eq!(col.name, "id");
        assert_eq!(col.kind, SchemaNodeKind::Column);
        assert_eq!(col.detail.as_deref(), Some("INT64"));
    }

    #[test]
    fn build_datasets_only_omits_table_children() {
        let datasets = vec![
            DatasetMeta { id: "ds1".into() },
            DatasetMeta { id: "ds2".into() },
        ];
        let tree = build_datasets_only("my-project", &datasets);
        assert_eq!(tree.len(), 1);
        let root = &tree[0];
        assert_eq!(root.name, "my-project");
        assert_eq!(root.kind, SchemaNodeKind::Database);
        assert_eq!(root.children.len(), 2);

        let ds1 = &root.children[0];
        assert_eq!(ds1.name, "ds1");
        assert_eq!(ds1.kind, SchemaNodeKind::Schema);
        assert_eq!(ds1.path, "my-project.ds1");
        // Datasets-only: no tables fetched yet.
        assert!(ds1.children.is_empty());
        assert!(root.children[1].children.is_empty());
    }

    #[test]
    fn build_datasets_only_handles_empty_datasets() {
        let tree = build_datasets_only("proj", &[]);
        assert_eq!(tree.len(), 1);
        assert!(tree[0].children.is_empty());
    }

    #[test]
    fn table_kind_from_bq_type() {
        assert!(matches!(TableKind::from_bq_type("TABLE"), TableKind::Table));
        assert!(matches!(TableKind::from_bq_type("BASE TABLE"), TableKind::Table));
        assert!(matches!(TableKind::from_bq_type("VIEW"), TableKind::View));
        assert!(matches!(TableKind::from_bq_type("MATERIALIZED_VIEW"), TableKind::MaterializedView));
        assert!(matches!(TableKind::from_bq_type("MATERIALIZED VIEW"), TableKind::MaterializedView));
        assert!(matches!(TableKind::from_bq_type("EXTERNAL"), TableKind::Table));
    }

    #[test]
    fn view_nodes_use_correct_kind() {
        let dataset = DatasetMeta { id: "ds".into() };
        let tables = vec![(
            TableMeta {
                id: "my_view".into(),
                kind: TableKind::View,
            },
            vec![],
        )];
        let ds = build_dataset_node("p", &dataset, &tables);
        let view = &ds.children[0];
        assert_eq!(view.kind, SchemaNodeKind::View);
    }
}
