use super::api::ColumnMeta;
use crate::{SchemaNode, SchemaNodeKind};

pub(super) struct SfObject {
    pub schema: String,
    pub name: String,
    pub kind: SchemaNodeKind,
}

pub(super) struct SfColumn {
    pub schema: String,
    pub table: String,
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

fn col_str(row: &[Option<String>], idx: usize) -> Option<String> {
    row.get(idx).and_then(|v| v.clone())
}

/// Extract the database names from a `SHOW DATABASES` result. Snowflake returns
/// a `name` column; locate it by header so we don't depend on column position,
/// falling back to the documented index 1 if the header is absent.
pub(super) fn database_names_from_show(
    columns: &[ColumnMeta],
    rows: &[Vec<Option<String>>],
) -> Vec<String> {
    let name_idx = columns
        .iter()
        .position(|c| c.name.eq_ignore_ascii_case("name"))
        .unwrap_or(1);
    rows.iter().filter_map(|r| col_str(r, name_idx)).collect()
}

pub(super) fn assemble_database_node(
    database: &str,
    schemas: &[String],
    objects: &[SfObject],
    columns: &[SfColumn],
) -> SchemaNode {
    let mut db_node = SchemaNode::new(database, SchemaNodeKind::Database, database);

    for schema_name in schemas {
        let path = format!("{database}.{schema_name}");
        let mut schema_node = SchemaNode::new(schema_name, SchemaNodeKind::Schema, &path);

        for obj in objects.iter().filter(|o| o.schema == *schema_name) {
            let obj_path = format!("{database}.{schema_name}.{}", obj.name);
            let mut obj_node = SchemaNode::new(&obj.name, obj.kind, &obj_path);

            if matches!(
                obj.kind,
                SchemaNodeKind::Table
                    | SchemaNodeKind::View
                    | SchemaNodeKind::MaterializedView
                    | SchemaNodeKind::ForeignTable
            ) {
                for col in columns
                    .iter()
                    .filter(|c| c.schema == *schema_name && c.table == obj.name)
                {
                    let col_path = format!("{obj_path}.{}", col.name);
                    let nullable = if col.nullable { "NULL" } else { "NOT NULL" };
                    let detail = format!("{} {nullable}", col.data_type);
                    obj_node.children.push(
                        SchemaNode::new(&col.name, SchemaNodeKind::Column, &col_path)
                            .with_detail(detail),
                    );
                }
            }

            schema_node.children.push(obj_node);
        }

        db_node.children.push(schema_node);
    }

    db_node
}

#[cfg(test)]
mod tests {
    use super::*;

    fn col(name: &str) -> ColumnMeta {
        ColumnMeta {
            name: name.to_owned(),
            data_type: "TEXT".to_owned(),
        }
    }

    fn cell(s: &str) -> Option<String> {
        Some(s.to_owned())
    }

    #[test]
    fn database_names_uses_name_column_by_header() {
        // SHOW DATABASES: created_on, name, is_default, ...
        let columns = vec![col("created_on"), col("name"), col("is_default")];
        let rows = vec![
            vec![cell("2024-01-01"), cell("ANALYTICS"), cell("N")],
            vec![cell("2024-01-02"), cell("RAW"), cell("N")],
        ];
        let names = database_names_from_show(&columns, &rows);
        assert_eq!(names, vec!["ANALYTICS".to_owned(), "RAW".to_owned()]);
    }

    #[test]
    fn database_names_falls_back_to_index_one_without_header() {
        let columns = vec![col("c0"), col("c1")];
        let rows = vec![vec![cell("x"), cell("MYDB")]];
        let names = database_names_from_show(&columns, &rows);
        assert_eq!(names, vec!["MYDB".to_owned()]);
    }

    #[test]
    fn database_names_skips_null_names() {
        let columns = vec![col("created_on"), col("name")];
        let rows = vec![
            vec![cell("2024-01-01"), cell("DB1")],
            vec![cell("2024-01-02"), None],
        ];
        let names = database_names_from_show(&columns, &rows);
        assert_eq!(names, vec!["DB1".to_owned()]);
    }

    #[test]
    fn database_names_empty_rows_yield_empty() {
        let columns = vec![col("created_on"), col("name")];
        let names = database_names_from_show(&columns, &[]);
        assert!(names.is_empty());
    }
}
