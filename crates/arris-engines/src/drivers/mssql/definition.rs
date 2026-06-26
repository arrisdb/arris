use crate::DriverError;
use crate::drivers::errors::Result;

use tiberius::Row as MssqlRow;

use super::MssqlDriver;
use super::MssqlClient;

/// One column of a reconstructed `CREATE TABLE`.
#[derive(Clone, Debug)]
pub(super) struct TableColumn {
    pub name: String,
    /// Fully formatted SQL type (e.g. `varchar(50)`, `decimal(18,2)`), or
    /// `None` for computed columns (which have no declared type).
    pub type_str: Option<String>,
    pub nullable: bool,
    /// `(seed, increment)` when the column is an IDENTITY.
    pub identity: Option<(i64, i64)>,
    /// Default-constraint expression text, already parenthesised by the engine
    /// (e.g. `((0))`, `(getdate())`).
    pub default_expr: Option<String>,
    /// Computed-column expression text, already parenthesised.
    pub computed_expr: Option<String>,
}

/// A table-level constraint clause rendered verbatim inside the column list.
#[derive(Clone, Debug)]
pub(super) struct TableConstraint {
    pub clause: String,
}

/// One key column inside an index definition.
#[derive(Clone, Debug)]
pub(super) struct IndexColumn {
    pub name: String,
    pub descending: bool,
    pub is_included: bool,
}

/// One schema-level permission row for `DefinitionBuilder::create_schema`.
#[derive(Clone, Debug)]
pub(super) struct SchemaGrant {
    /// Permission keyword as `sys.database_permissions` reports it (e.g.
    /// `SELECT`, `EXECUTE`).
    pub permission: String,
    /// `state_desc`: `GRANT`, `DENY`, or `GRANT_WITH_GRANT_OPTION`.
    pub state: String,
    pub grantee: String,
}

/// Structured index metadata used to reconstruct a `CREATE INDEX` statement.
#[derive(Clone, Debug)]
pub(super) struct IndexDef {
    pub name: String,
    pub schema: String,
    pub table: String,
    pub is_unique: bool,
    pub is_clustered: bool,
    pub columns: Vec<IndexColumn>,
    pub filter: Option<String>,
}

impl MssqlDriver {
    /// Runs `sql` and returns every cell of every row as `Option<String>`,
    /// using the same `simple_query`/`into_results` mechanism `list_schemas`
    /// relies on. Cells must already be projected as strings in the SQL.
    pub(super) async fn definition_string_rows(&self, sql: &str) -> Result<Vec<Vec<Option<String>>>> {
        let mut guard = self.inner.lock().await;
        let client: &mut MssqlClient = guard.as_mut().ok_or(DriverError::NotConnected)?;
        let results = client
            .simple_query(sql)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .into_results()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        let mut out = Vec::new();
        for set in results {
            for row in set {
                let n = row.columns().len();
                let mut cells = Vec::with_capacity(n);
                for i in 0..n {
                    cells.push(Self::cell_to_string(&row, i));
                }
                out.push(cells);
            }
        }
        Ok(out)
    }

    /// Reads a single result cell as a `String`, tolerating the SQL numeric and
    /// boolean catalog types (`int`/`bigint`/`smallint`/`tinyint`/`bit`) that
    /// `sys.*` columns surface without an explicit `CONVERT`. Returns `None` for
    /// SQL `NULL` or a type this driver has no need to render.
    fn cell_to_string(row: &MssqlRow, i: usize) -> Option<String> {
        if let Ok(Some(s)) = row.try_get::<&str, _>(i) {
            return Some(s.to_owned());
        }
        if let Ok(Some(v)) = row.try_get::<i32, _>(i) {
            return Some(v.to_string());
        }
        if let Ok(Some(v)) = row.try_get::<i64, _>(i) {
            return Some(v.to_string());
        }
        if let Ok(Some(v)) = row.try_get::<i16, _>(i) {
            return Some(v.to_string());
        }
        if let Ok(Some(v)) = row.try_get::<u8, _>(i) {
            return Some(v.to_string());
        }
        if let Ok(Some(v)) = row.try_get::<bool, _>(i) {
            return Some(v.to_string());
        }
        None
    }

    /// Single-cell string accessor: first column of the first row.
    pub(super) async fn definition_scalar(&self, sql: &str) -> Result<Option<String>> {
        Ok(self
            .definition_string_rows(sql)
            .await?
            .into_iter()
            .next()
            .and_then(|mut row| row.drain(..).next().flatten()))
    }

    /// Dispatches an `ObjectRef` to the appropriate definition builder.
    pub(super) async fn build_object_definition(
        &self,
        object: &crate::ObjectRef,
    ) -> Result<String> {
        use crate::SchemaNodeKind::*;

        let schema = object.schema.as_deref().unwrap_or("dbo");
        match object.kind {
            // Module-text objects: SQL Server stores the original CREATE text.
            View | MaterializedView | Procedure | Function | Trigger => {
                self.module_definition(schema, &object.name).await
            }
            Sequence => self.sequence_definition(schema, &object.name).await,
            Index => self.index_definition(schema, &object.name).await,
            Table => self.table_definition(schema, &object.name).await,
            // A schema node's own name is the schema; the `schema` qualifier
            // (filled with the database) is not used here.
            Schema => self.schema_definition(&object.name).await,
            other => Err(DriverError::Unsupported(format!(
                "MSSQL: no definition for {other:?}"
            ))),
        }
    }

    /// Reconstruct `CREATE SCHEMA ... AUTHORIZATION` plus the schema-level
    /// `GRANT`/`DENY` statements from `sys.schemas` and `sys.database_permissions`.
    async fn schema_definition(&self, name: &str) -> Result<String> {
        let n = DefinitionBuilder::escape_literal(name);

        let owner_sql = format!(
            "SELECT dp.name FROM sys.schemas s \
             JOIN sys.database_principals dp ON s.principal_id = dp.principal_id \
             WHERE s.name = N'{n}'"
        );
        let owner = self
            .definition_scalar(&owner_sql)
            .await?
            .ok_or_else(|| DriverError::QueryFailed("object not found or no definition".into()))?;

        let grant_sql = format!(
            "SELECT perm.permission_name, perm.state_desc, grantee.name \
             FROM sys.database_permissions perm \
             JOIN sys.database_principals grantee \
               ON perm.grantee_principal_id = grantee.principal_id \
             WHERE perm.class = 3 AND perm.major_id = SCHEMA_ID(N'{n}') \
             ORDER BY grantee.name, perm.permission_name"
        );
        let cell = |row: &[Option<String>], i: usize| row.get(i).cloned().flatten();
        let grants: Vec<SchemaGrant> = self
            .definition_string_rows(&grant_sql)
            .await?
            .into_iter()
            .filter_map(|row| {
                Some(SchemaGrant {
                    permission: cell(&row, 0)?,
                    state: cell(&row, 1).unwrap_or_default(),
                    grantee: cell(&row, 2)?,
                })
            })
            .collect();

        Ok(DefinitionBuilder::create_schema(name, &owner, &grants))
    }

    /// `OBJECT_DEFINITION` returns the verbatim module text (the original
    /// `CREATE` statement) for views, procedures, functions and triggers.
    async fn module_definition(&self, schema: &str, name: &str) -> Result<String> {
        let qualified = format!("[{}].[{}]", schema.replace(']', "]]"), name.replace(']', "]]"));
        let literal = DefinitionBuilder::escape_literal(&qualified);
        let sql = format!("SELECT OBJECT_DEFINITION(OBJECT_ID(N'{literal}'))");
        match self.definition_scalar(&sql).await? {
            Some(text) => Ok(text),
            None => Err(DriverError::QueryFailed(
                "object not found or no definition".into(),
            )),
        }
    }

    /// Reconstructs a `CREATE SEQUENCE` from `sys.sequences`.
    async fn sequence_definition(&self, schema: &str, name: &str) -> Result<String> {
        let s = DefinitionBuilder::escape_literal(schema);
        let n = DefinitionBuilder::escape_literal(name);
        let sql = format!(
            "SELECT ty.name, \
                    CONVERT(varchar(64), seq.start_value), \
                    CONVERT(varchar(64), seq.increment), \
                    CONVERT(varchar(64), seq.minimum_value), \
                    CONVERT(varchar(64), seq.maximum_value), \
                    CONVERT(varchar(8), seq.is_cycling), \
                    CONVERT(varchar(8), seq.is_cached), \
                    CONVERT(varchar(64), seq.cache_size) \
             FROM sys.sequences seq \
             JOIN sys.schemas s ON seq.schema_id = s.schema_id \
             JOIN sys.types ty ON seq.system_type_id = ty.system_type_id \
                 AND seq.user_type_id = ty.user_type_id \
             WHERE s.name = N'{s}' AND seq.name = N'{n}'"
        );
        let rows = self.definition_string_rows(&sql).await?;
        let row = rows.into_iter().next().ok_or_else(|| {
            DriverError::QueryFailed("object not found or no definition".into())
        })?;
        let cell = |i: usize| row.get(i).cloned().flatten().unwrap_or_default();

        let type_name = cell(0);
        let start = cell(1);
        let increment = cell(2);
        let min = cell(3);
        let max = cell(4);
        let is_cycling = cell(5) == "1";
        let is_cached = cell(6) == "1";
        let cache_size = cell(7);

        let cycle = if is_cycling { "CYCLE" } else { "NO CYCLE" };
        let cache = if is_cached {
            if cache_size.is_empty() {
                "CACHE".to_owned()
            } else {
                format!("CACHE {cache_size}")
            }
        } else {
            "NO CACHE".to_owned()
        };

        Ok(format!(
            "CREATE SEQUENCE {}.{} AS {type_name} START WITH {start} INCREMENT BY {increment} \
             MINVALUE {min} MAXVALUE {max} {cycle} {cache};",
            DefinitionBuilder::quote(schema),
            DefinitionBuilder::quote(name),
        ))
    }

    /// Loads a single index by name within `schema` and renders `CREATE INDEX`.
    async fn index_definition(&self, schema: &str, name: &str) -> Result<String> {
        // The schema tree stores index nodes as `<table>.<index>`. Accept both
        // the bare index name and the `table.index` form; the table is always
        // re-derived from `sys.objects`, so the table hint is advisory only.
        let index_name = name.rsplit('.').next().unwrap_or(name);
        let idx = self.load_index(schema, index_name).await?;
        Ok(DefinitionBuilder::create_index(&idx))
    }

    /// Fetches structured `IndexDef` for one index. Table is derived from
    /// `sys.objects` (`o.name`), so the caller need not supply it.
    async fn load_index(&self, schema: &str, index_name: &str) -> Result<IndexDef> {
        let s = DefinitionBuilder::escape_literal(schema);
        let n = DefinitionBuilder::escape_literal(index_name);

        let header_sql = format!(
            "SELECT o.name, \
                    CONVERT(varchar(8), i.is_unique), \
                    i.type_desc, \
                    i.filter_definition \
             FROM sys.indexes i \
             JOIN sys.objects o ON i.object_id = o.object_id \
             JOIN sys.schemas s ON o.schema_id = s.schema_id \
             WHERE i.name = N'{n}' AND s.name = N'{s}' \
               AND i.index_id > 0 AND o.type IN ('U','V')"
        );
        let header = self
            .definition_string_rows(&header_sql)
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| DriverError::QueryFailed("object not found or no definition".into()))?;
        let cell = |row: &[Option<String>], i: usize| row.get(i).cloned().flatten();

        let table = cell(&header, 0).unwrap_or_default();
        let is_unique = cell(&header, 1).as_deref() == Some("1");
        let is_clustered = cell(&header, 2)
            .map(|t| t.to_uppercase().contains("CLUSTERED") && !t.to_uppercase().contains("NONCLUSTERED"))
            .unwrap_or(false);
        let filter = cell(&header, 3).filter(|f| !f.is_empty());

        let col_sql = format!(
            "SELECT c.name, \
                    CONVERT(varchar(8), ic.is_descending_key), \
                    CONVERT(varchar(8), ic.is_included_column) \
             FROM sys.indexes i \
             JOIN sys.objects o ON i.object_id = o.object_id \
             JOIN sys.schemas s ON o.schema_id = s.schema_id \
             JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id \
             JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id \
             WHERE i.name = N'{n}' AND s.name = N'{s}' \
             ORDER BY ic.is_included_column, ic.key_ordinal, ic.index_column_id"
        );
        let columns = self
            .definition_string_rows(&col_sql)
            .await?
            .into_iter()
            .filter_map(|row| {
                Some(IndexColumn {
                    name: cell(&row, 0)?,
                    descending: cell(&row, 1).as_deref() == Some("1"),
                    is_included: cell(&row, 2).as_deref() == Some("1"),
                })
            })
            .collect();

        Ok(IndexDef {
            name: index_name.to_owned(),
            schema: schema.to_owned(),
            table,
            is_unique,
            is_clustered,
            columns,
            filter,
        })
    }

    /// Full-fidelity `CREATE TABLE` reconstruction plus trailing `CREATE INDEX`
    /// statements for any non-constraint indexes.
    async fn table_definition(&self, schema: &str, name: &str) -> Result<String> {
        let columns = self.table_columns(schema, name).await?;
        if columns.is_empty() {
            return Err(DriverError::QueryFailed(
                "object not found or no definition".into(),
            ));
        }
        let constraints = self.table_constraints(schema, name).await?;
        let mut ddl = DefinitionBuilder::create_table(schema, name, &columns, &constraints);

        for idx_name in self.table_standalone_indexes(schema, name).await? {
            let idx = self.load_index(schema, &idx_name).await?;
            ddl.push('\n');
            ddl.push_str(&DefinitionBuilder::create_index(&idx));
        }
        Ok(ddl)
    }

    /// Column metadata in ordinal order for one table.
    async fn table_columns(&self, schema: &str, name: &str) -> Result<Vec<TableColumn>> {
        let s = DefinitionBuilder::escape_literal(schema);
        let n = DefinitionBuilder::escape_literal(name);
        let sql = format!(
            "SELECT c.name, \
                    ty.name, \
                    CONVERT(varchar(16), c.max_length), \
                    CONVERT(varchar(16), c.precision), \
                    CONVERT(varchar(16), c.scale), \
                    CONVERT(varchar(8), c.is_nullable), \
                    CONVERT(varchar(8), c.is_identity), \
                    CONVERT(varchar(64), ic.seed_value), \
                    CONVERT(varchar(64), ic.increment_value), \
                    cc.definition, \
                    dc.definition \
             FROM sys.columns c \
             JOIN sys.objects o ON c.object_id = o.object_id \
             JOIN sys.schemas s ON o.schema_id = s.schema_id \
             JOIN sys.types ty ON c.user_type_id = ty.user_type_id \
             LEFT JOIN sys.identity_columns ic ON c.object_id = ic.object_id AND c.column_id = ic.column_id \
             LEFT JOIN sys.computed_columns cc ON c.object_id = cc.object_id AND c.column_id = cc.column_id \
             LEFT JOIN sys.default_constraints dc ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id \
             WHERE s.name = N'{s}' AND o.name = N'{n}' \
             ORDER BY c.column_id"
        );
        let rows = self.definition_string_rows(&sql).await?;
        let cell = |row: &[Option<String>], i: usize| row.get(i).cloned().flatten();
        let parse = |v: Option<String>| v.and_then(|s| s.parse::<i32>().ok());

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let col_name = cell(&row, 0)?;
                let base_type = cell(&row, 1)?;
                let max_length = parse(cell(&row, 2)).unwrap_or(0);
                let precision = parse(cell(&row, 3)).unwrap_or(0);
                let scale = parse(cell(&row, 4)).unwrap_or(0);
                let nullable = cell(&row, 5).as_deref() != Some("0");
                let is_identity = cell(&row, 6).as_deref() == Some("1");
                let seed = cell(&row, 7).and_then(|s| s.parse::<i64>().ok());
                let inc = cell(&row, 8).and_then(|s| s.parse::<i64>().ok());
                let computed_expr = cell(&row, 9);
                let default_expr = cell(&row, 10);

                let identity = match (is_identity, seed, inc) {
                    (true, Some(s), Some(i)) => Some((s, i)),
                    (true, _, _) => Some((1, 1)),
                    _ => None,
                };
                let type_str = if computed_expr.is_some() {
                    None
                } else {
                    Some(DefinitionBuilder::format_type(
                        &base_type, max_length, precision, scale,
                    ))
                };
                Some(TableColumn {
                    name: col_name,
                    type_str,
                    nullable,
                    identity,
                    default_expr,
                    computed_expr,
                })
            })
            .collect())
    }

    /// Primary-key / unique / check / foreign-key constraint clauses for one
    /// table, in a stable order (PK, unique, check, FK).
    async fn table_constraints(&self, schema: &str, name: &str) -> Result<Vec<TableConstraint>> {
        let s = DefinitionBuilder::escape_literal(schema);
        let n = DefinitionBuilder::escape_literal(name);

        let mut clauses: Vec<TableConstraint> = Vec::new();

        // PRIMARY KEY / UNIQUE — from sys.key_constraints + sys.index_columns.
        let key_sql = format!(
            "SELECT kc.name, kc.type, i.type_desc, c.name \
             FROM sys.key_constraints kc \
             JOIN sys.objects o ON kc.parent_object_id = o.object_id \
             JOIN sys.schemas s ON o.schema_id = s.schema_id \
             JOIN sys.indexes i ON kc.parent_object_id = i.object_id AND kc.unique_index_id = i.index_id \
             JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id \
             JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id \
             WHERE s.name = N'{s}' AND o.name = N'{n}' \
             ORDER BY kc.name, ic.key_ordinal"
        );
        let key_rows = self.definition_string_rows(&key_sql).await?;
        let cell = |row: &[Option<String>], i: usize| row.get(i).cloned().flatten();

        // Group consecutive rows by constraint name.
        let mut grouped: Vec<(String, String, String, Vec<String>)> = Vec::new();
        for row in &key_rows {
            let cname = cell(row, 0).unwrap_or_default();
            let ctype = cell(row, 1).unwrap_or_default();
            let type_desc = cell(row, 2).unwrap_or_default();
            let col = cell(row, 3).unwrap_or_default();
            match grouped.last_mut() {
                Some((existing, _, _, cols)) if *existing == cname => cols.push(col),
                _ => grouped.push((cname, ctype.trim().to_owned(), type_desc, vec![col])),
            }
        }
        for (cname, ctype, type_desc, cols) in grouped {
            let col_list = cols
                .iter()
                .map(|c| DefinitionBuilder::quote(c))
                .collect::<Vec<_>>()
                .join(", ");
            let clause = if ctype == "PK" {
                let clustered = if type_desc.to_uppercase().contains("NONCLUSTERED") {
                    "NONCLUSTERED"
                } else {
                    "CLUSTERED"
                };
                format!(
                    "CONSTRAINT {} PRIMARY KEY {clustered} ({col_list})",
                    DefinitionBuilder::quote(&cname)
                )
            } else {
                format!(
                    "CONSTRAINT {} UNIQUE ({col_list})",
                    DefinitionBuilder::quote(&cname)
                )
            };
            clauses.push(TableConstraint { clause });
        }

        // CHECK constraints.
        let check_sql = format!(
            "SELECT cc.name, cc.definition \
             FROM sys.check_constraints cc \
             JOIN sys.objects o ON cc.parent_object_id = o.object_id \
             JOIN sys.schemas s ON o.schema_id = s.schema_id \
             WHERE s.name = N'{s}' AND o.name = N'{n}' \
             ORDER BY cc.name"
        );
        for row in self.definition_string_rows(&check_sql).await? {
            let cname = cell(&row, 0).unwrap_or_default();
            let def = cell(&row, 1).unwrap_or_default();
            clauses.push(TableConstraint {
                clause: format!(
                    "CONSTRAINT {} CHECK {def}",
                    DefinitionBuilder::quote(&cname)
                ),
            });
        }

        // FOREIGN KEYs with ON DELETE / ON UPDATE actions.
        let fk_sql = format!(
            "SELECT fk.name, \
                    pc.name, \
                    rs.name, ro.name, rc.name, \
                    fk.delete_referential_action_desc, \
                    fk.update_referential_action_desc, \
                    fkc.constraint_column_id \
             FROM sys.foreign_keys fk \
             JOIN sys.objects o ON fk.parent_object_id = o.object_id \
             JOIN sys.schemas s ON o.schema_id = s.schema_id \
             JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id \
             JOIN sys.columns pc ON fkc.parent_object_id = pc.object_id AND fkc.parent_column_id = pc.column_id \
             JOIN sys.objects ro ON fkc.referenced_object_id = ro.object_id \
             JOIN sys.schemas rs ON ro.schema_id = rs.schema_id \
             JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id \
             WHERE s.name = N'{s}' AND o.name = N'{n}' \
             ORDER BY fk.name, fkc.constraint_column_id"
        );
        let fk_rows = self.definition_string_rows(&fk_sql).await?;
        // Group by FK name preserving column order.
        let mut fks: Vec<(String, String, String, String, Vec<String>, Vec<String>)> = Vec::new();
        for row in &fk_rows {
            let fname = cell(row, 0).unwrap_or_default();
            let parent_col = cell(row, 1).unwrap_or_default();
            let ref_schema = cell(row, 2).unwrap_or_default();
            let ref_table = cell(row, 3).unwrap_or_default();
            let ref_col = cell(row, 4).unwrap_or_default();
            let on_delete = cell(row, 5).unwrap_or_default();
            let on_update = cell(row, 6).unwrap_or_default();
            match fks.last_mut() {
                Some((existing, _, _, _, pcols, rcols)) if *existing == fname => {
                    pcols.push(parent_col);
                    rcols.push(ref_col);
                }
                _ => fks.push((
                    fname,
                    ref_schema,
                    ref_table,
                    format!("{on_delete}|{on_update}"),
                    vec![parent_col],
                    vec![ref_col],
                )),
            }
        }
        for (fname, ref_schema, ref_table, actions, pcols, rcols) in fks {
            let pcol_list = pcols
                .iter()
                .map(|c| DefinitionBuilder::quote(c))
                .collect::<Vec<_>>()
                .join(", ");
            let rcol_list = rcols
                .iter()
                .map(|c| DefinitionBuilder::quote(c))
                .collect::<Vec<_>>()
                .join(", ");
            let mut parts = (actions.split('|')).map(|s| s.to_owned());
            let on_delete = parts.next().unwrap_or_default();
            let on_update = parts.next().unwrap_or_default();
            let mut clause = format!(
                "CONSTRAINT {} FOREIGN KEY ({pcol_list}) REFERENCES {}.{} ({rcol_list})",
                DefinitionBuilder::quote(&fname),
                DefinitionBuilder::quote(&ref_schema),
                DefinitionBuilder::quote(&ref_table),
            );
            if on_delete != "NO_ACTION" && !on_delete.is_empty() {
                clause.push_str(&format!(" ON DELETE {}", on_delete.replace('_', " ")));
            }
            if on_update != "NO_ACTION" && !on_update.is_empty() {
                clause.push_str(&format!(" ON UPDATE {}", on_update.replace('_', " ")));
            }
            clauses.push(TableConstraint { clause });
        }

        Ok(clauses)
    }

    /// Names of standalone (non-constraint, non-PK/unique) indexes on a table,
    /// which become trailing `CREATE INDEX` statements.
    async fn table_standalone_indexes(&self, schema: &str, name: &str) -> Result<Vec<String>> {
        let s = DefinitionBuilder::escape_literal(schema);
        let n = DefinitionBuilder::escape_literal(name);
        let sql = format!(
            "SELECT i.name \
             FROM sys.indexes i \
             JOIN sys.objects o ON i.object_id = o.object_id \
             JOIN sys.schemas s ON o.schema_id = s.schema_id \
             WHERE s.name = N'{s}' AND o.name = N'{n}' \
               AND i.index_id > 0 AND i.name IS NOT NULL \
               AND i.is_primary_key = 0 AND i.is_unique_constraint = 0 \
               AND i.is_hypothetical = 0 \
             ORDER BY i.name"
        );
        Ok(self
            .definition_string_rows(&sql)
            .await?
            .into_iter()
            .filter_map(|row| row.into_iter().next().flatten())
            .collect())
    }
}

/// Pure DDL-assembly helpers. Grouped on a zero-sized type so the module holds
/// no free functions, matching the engine module conventions.
pub(super) struct DefinitionBuilder;

impl DefinitionBuilder {
    /// Bracket-quotes an identifier, doubling any embedded `]`.
    pub(super) fn quote(name: &str) -> String {
        format!("[{}]", name.replace(']', "]]"))
    }

    /// Single-quote escaping for an identifier embedded in an `N'...'` literal.
    pub(super) fn escape_literal(value: &str) -> String {
        value.replace('\'', "''")
    }

    /// Builds the SQL Server type string from `sys.types` / `sys.columns`
    /// metadata. `max_length` is in bytes as `sys.columns` reports it.
    pub(super) fn format_type(
        base: &str,
        max_length: i32,
        precision: i32,
        scale: i32,
    ) -> String {
        let lower = base.to_lowercase();
        match lower.as_str() {
            // Character / binary types carry a length.
            "varchar" | "char" | "varbinary" | "binary" => {
                if max_length == -1 {
                    format!("{lower}(max)")
                } else {
                    format!("{lower}({max_length})")
                }
            }
            // Unicode character types report byte length; divide by 2.
            "nvarchar" | "nchar" => {
                if max_length == -1 {
                    format!("{lower}(max)")
                } else {
                    format!("{lower}({})", max_length / 2)
                }
            }
            // Precision/scale types.
            "decimal" | "numeric" => format!("{lower}({precision},{scale})"),
            // Time-family types carry only fractional-second scale.
            "datetime2" | "time" | "datetimeoffset" => {
                if scale == 7 {
                    lower
                } else {
                    format!("{lower}({scale})")
                }
            }
            // Everything else (int, bigint, bit, datetime, uniqueidentifier,
            // money, real, float without explicit mantissa, …) takes no
            // parameters.
            _ => lower,
        }
    }

    /// Renders one column line for the `CREATE TABLE` body (no leading indent,
    /// no trailing comma).
    pub(super) fn column_line(col: &TableColumn) -> String {
        let mut parts = vec![Self::quote(&col.name)];

        if let Some(expr) = &col.computed_expr {
            // Computed column: `[c] AS (expr)`.
            parts.push(format!("AS {expr}"));
            return parts.join(" ");
        }

        if let Some(type_str) = &col.type_str {
            parts.push(type_str.clone());
        }
        if let Some((seed, inc)) = col.identity {
            parts.push(format!("IDENTITY({seed},{inc})"));
        }
        parts.push(if col.nullable { "NULL".to_owned() } else { "NOT NULL".to_owned() });
        if let Some(expr) = &col.default_expr {
            parts.push(format!("DEFAULT {expr}"));
        }
        parts.join(" ")
    }

    /// Assembles a full `CREATE TABLE` statement from structured column and
    /// constraint inputs. Constraints are appended after the columns.
    pub(super) fn create_table(
        schema: &str,
        name: &str,
        columns: &[TableColumn],
        constraints: &[TableConstraint],
    ) -> String {
        let mut lines: Vec<String> = columns.iter().map(Self::column_line).collect();
        lines.extend(constraints.iter().map(|c| c.clause.clone()));
        let body = lines
            .iter()
            .map(|l| format!("    {l}"))
            .collect::<Vec<_>>()
            .join(",\n");
        format!(
            "CREATE TABLE {}.{} (\n{}\n);",
            Self::quote(schema),
            Self::quote(name),
            body
        )
    }

    /// Assembles a `CREATE INDEX` statement from structured metadata.
    pub(super) fn create_index(idx: &IndexDef) -> String {
        let unique = if idx.is_unique { "UNIQUE " } else { "" };
        let clustered = if idx.is_clustered { "CLUSTERED" } else { "NONCLUSTERED" };

        let key_cols: Vec<String> = idx
            .columns
            .iter()
            .filter(|c| !c.is_included)
            .map(|c| {
                let dir = if c.descending { "DESC" } else { "ASC" };
                format!("{} {dir}", Self::quote(&c.name))
            })
            .collect();

        let included: Vec<String> = idx
            .columns
            .iter()
            .filter(|c| c.is_included)
            .map(|c| Self::quote(&c.name))
            .collect();

        let mut stmt = format!(
            "CREATE {unique}{clustered} INDEX {} ON {}.{} ({})",
            Self::quote(&idx.name),
            Self::quote(&idx.schema),
            Self::quote(&idx.table),
            key_cols.join(", ")
        );
        if !included.is_empty() {
            stmt.push_str(&format!(" INCLUDE ({})", included.join(", ")));
        }
        if let Some(filter) = &idx.filter {
            stmt.push_str(&format!(" WHERE {filter}"));
        }
        stmt.push(';');
        stmt
    }

    /// Assembles `CREATE SCHEMA [name] AUTHORIZATION [owner];` followed by the
    /// schema-level `GRANT`/`DENY` statements. `GRANT_WITH_GRANT_OPTION` renders
    /// as a `GRANT ... WITH GRANT OPTION`.
    pub(super) fn create_schema(name: &str, owner: &str, grants: &[SchemaGrant]) -> String {
        let mut out = format!(
            "CREATE SCHEMA {} AUTHORIZATION {};",
            Self::quote(name),
            Self::quote(owner)
        );
        for g in grants {
            let verb = if g.state == "DENY" { "DENY" } else { "GRANT" };
            let suffix = if g.state == "GRANT_WITH_GRANT_OPTION" {
                " WITH GRANT OPTION"
            } else {
                ""
            };
            out.push_str(&format!(
                "\n{verb} {} ON SCHEMA::{} TO {}{suffix};",
                g.permission,
                Self::quote(name),
                Self::quote(&g.grantee)
            ));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_type_varchar_with_length() {
        assert_eq!(DefinitionBuilder::format_type("varchar", 50, 0, 0), "varchar(50)");
        assert_eq!(DefinitionBuilder::format_type("char", 10, 0, 0), "char(10)");
    }

    #[test]
    fn format_type_nvarchar_halves_byte_length() {
        assert_eq!(DefinitionBuilder::format_type("nvarchar", 100, 0, 0), "nvarchar(50)");
        assert_eq!(DefinitionBuilder::format_type("nchar", 20, 0, 0), "nchar(10)");
    }

    #[test]
    fn format_type_max_length() {
        assert_eq!(DefinitionBuilder::format_type("nvarchar", -1, 0, 0), "nvarchar(max)");
        assert_eq!(DefinitionBuilder::format_type("varbinary", -1, 0, 0), "varbinary(max)");
    }

    #[test]
    fn format_type_decimal_precision_scale() {
        assert_eq!(DefinitionBuilder::format_type("decimal", 0, 18, 2), "decimal(18,2)");
        assert_eq!(DefinitionBuilder::format_type("numeric", 0, 10, 0), "numeric(10,0)");
    }

    #[test]
    fn format_type_plain_types_have_no_params() {
        assert_eq!(DefinitionBuilder::format_type("int", 4, 10, 0), "int");
        assert_eq!(DefinitionBuilder::format_type("datetime", 8, 0, 0), "datetime");
        assert_eq!(DefinitionBuilder::format_type("bit", 1, 0, 0), "bit");
    }

    #[test]
    fn format_type_datetime2_scale() {
        assert_eq!(DefinitionBuilder::format_type("datetime2", 8, 0, 7), "datetime2");
        assert_eq!(DefinitionBuilder::format_type("datetime2", 6, 0, 3), "datetime2(3)");
    }

    #[test]
    fn quote_escapes_closing_bracket() {
        assert_eq!(DefinitionBuilder::quote("col"), "[col]");
        assert_eq!(DefinitionBuilder::quote("we]rd"), "[we]]rd]");
    }

    #[test]
    fn escape_literal_doubles_single_quotes() {
        assert_eq!(DefinitionBuilder::escape_literal("o'brien"), "o''brien");
        assert_eq!(DefinitionBuilder::escape_literal("plain"), "plain");
    }

    #[test]
    fn column_line_plain_not_null() {
        let col = TableColumn {
            name: "id".into(),
            type_str: Some("int".into()),
            nullable: false,
            identity: None,
            default_expr: None,
            computed_expr: None,
        };
        assert_eq!(DefinitionBuilder::column_line(&col), "[id] int NOT NULL");
    }

    #[test]
    fn column_line_identity_with_default() {
        let col = TableColumn {
            name: "id".into(),
            type_str: Some("int".into()),
            nullable: false,
            identity: Some((1, 1)),
            default_expr: None,
            computed_expr: None,
        };
        assert_eq!(
            DefinitionBuilder::column_line(&col),
            "[id] int IDENTITY(1,1) NOT NULL"
        );
    }

    #[test]
    fn column_line_nullable_with_default() {
        let col = TableColumn {
            name: "created".into(),
            type_str: Some("datetime".into()),
            nullable: true,
            identity: None,
            default_expr: Some("(getdate())".into()),
            computed_expr: None,
        };
        assert_eq!(
            DefinitionBuilder::column_line(&col),
            "[created] datetime NULL DEFAULT (getdate())"
        );
    }

    #[test]
    fn column_line_computed() {
        let col = TableColumn {
            name: "total".into(),
            type_str: None,
            nullable: true,
            identity: None,
            default_expr: None,
            computed_expr: Some("([qty]*[price])".into()),
        };
        assert_eq!(
            DefinitionBuilder::column_line(&col),
            "[total] AS ([qty]*[price])"
        );
    }

    #[test]
    fn create_table_assembles_columns_and_constraints() {
        let columns = vec![
            TableColumn {
                name: "id".into(),
                type_str: Some("int".into()),
                nullable: false,
                identity: Some((1, 1)),
                default_expr: None,
                computed_expr: None,
            },
            TableColumn {
                name: "name".into(),
                type_str: Some("nvarchar(50)".into()),
                nullable: false,
                identity: None,
                default_expr: None,
                computed_expr: None,
            },
        ];
        let constraints = vec![TableConstraint {
            clause: "CONSTRAINT [PK_users] PRIMARY KEY CLUSTERED ([id])".into(),
        }];
        let ddl = DefinitionBuilder::create_table("dbo", "users", &columns, &constraints);
        let expected = "CREATE TABLE [dbo].[users] (\n    \
            [id] int IDENTITY(1,1) NOT NULL,\n    \
            [name] nvarchar(50) NOT NULL,\n    \
            CONSTRAINT [PK_users] PRIMARY KEY CLUSTERED ([id])\n);";
        assert_eq!(ddl, expected);
    }

    #[test]
    fn create_index_nonclustered_with_include_and_filter() {
        let idx = IndexDef {
            name: "IX_users_email".into(),
            schema: "dbo".into(),
            table: "users".into(),
            is_unique: true,
            is_clustered: false,
            columns: vec![
                IndexColumn { name: "email".into(), descending: false, is_included: false },
                IndexColumn { name: "created".into(), descending: true, is_included: false },
                IndexColumn { name: "name".into(), descending: false, is_included: true },
            ],
            filter: Some("([email] IS NOT NULL)".into()),
        };
        assert_eq!(
            DefinitionBuilder::create_index(&idx),
            "CREATE UNIQUE NONCLUSTERED INDEX [IX_users_email] ON [dbo].[users] \
             ([email] ASC, [created] DESC) INCLUDE ([name]) WHERE ([email] IS NOT NULL);"
        );
    }

    #[test]
    fn create_schema_with_authorization_and_grants() {
        let grants = vec![
            SchemaGrant {
                permission: "SELECT".into(),
                state: "GRANT".into(),
                grantee: "reporter".into(),
            },
            SchemaGrant {
                permission: "EXECUTE".into(),
                state: "GRANT_WITH_GRANT_OPTION".into(),
                grantee: "app_role".into(),
            },
            SchemaGrant {
                permission: "DELETE".into(),
                state: "DENY".into(),
                grantee: "guest".into(),
            },
        ];
        let ddl = DefinitionBuilder::create_schema("reporting", "dbo", &grants);
        assert_eq!(
            ddl,
            "CREATE SCHEMA [reporting] AUTHORIZATION [dbo];\n\
             GRANT SELECT ON SCHEMA::[reporting] TO [reporter];\n\
             GRANT EXECUTE ON SCHEMA::[reporting] TO [app_role] WITH GRANT OPTION;\n\
             DENY DELETE ON SCHEMA::[reporting] TO [guest];"
        );
    }

    #[test]
    fn create_schema_without_grants() {
        let ddl = DefinitionBuilder::create_schema("sales", "dbo", &[]);
        assert_eq!(ddl, "CREATE SCHEMA [sales] AUTHORIZATION [dbo];");
    }

    #[test]
    fn create_index_plain_clustered() {
        let idx = IndexDef {
            name: "IX_id".into(),
            schema: "dbo".into(),
            table: "t".into(),
            is_unique: false,
            is_clustered: true,
            columns: vec![IndexColumn {
                name: "id".into(),
                descending: false,
                is_included: false,
            }],
            filter: None,
        };
        assert_eq!(
            DefinitionBuilder::create_index(&idx),
            "CREATE CLUSTERED INDEX [IX_id] ON [dbo].[t] ([id] ASC);"
        );
    }
}
