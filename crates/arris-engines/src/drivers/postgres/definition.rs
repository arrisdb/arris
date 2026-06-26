//! DDL / definition reconstruction for the Postgres driver. Composes
//! `CREATE ...` statements from catalog queries so the "Show Definition"
//! command can display a faithful, copy-pasteable source for any schema
//! object. The catalog round-trips (view bodies, function bodies, index defs,
//! constraint defs) are read with `pg_get_*def` server functions; only the
//! TABLE path assembles the statement column-by-column from catalog rows.
//!
//! Pure string-formatting lives in the `build_*` helpers (unit-tested without
//! a database); the `*_def` async functions own the catalog I/O.

use std::sync::Arc;

use tokio_postgres::Client;

use crate::{DriverError, ObjectRef, SchemaNodeKind};
use crate::drivers::errors::Result;

use super::query::pg_err_msg;

/// One reconstructed table column for `build_create_table`.
pub(super) struct ColumnDef {
    pub name: String,
    /// Rendered SQL type, e.g. `integer`, `character varying(64)`.
    pub type_sql: String,
    pub not_null: bool,
    /// Column `DEFAULT` expression already rendered by `pg_get_expr`, if any.
    pub default: Option<String>,
}

/// One reconstructed table-level constraint for `build_create_table`. `def` is
/// the full clause from `pg_get_constraintdef` (e.g. `PRIMARY KEY ("a", "b")`).
pub(super) struct ConstraintDef {
    pub name: String,
    pub def: String,
}

/// One reconstructed sequence's attributes for `build_create_sequence`.
pub(super) struct SequenceDef {
    pub start: String,
    pub increment: String,
    pub min: String,
    pub max: String,
    pub cache: String,
    pub cycle: bool,
}

/// Double-quote a Postgres identifier, escaping any embedded double quotes.
fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

/// Single-quote a Postgres string literal, doubling any embedded single quotes.
fn quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Every privilege granted to one grantee on a schema, for `build_create_schema`.
pub(super) struct SchemaGrant {
    /// Grantee role name, or `None` for the `PUBLIC` pseudo-role (aclexplode
    /// reports `PUBLIC` as grantee oid `0`, which matches no `pg_roles` row).
    pub grantee: Option<String>,
    /// Privilege keywords (e.g. `USAGE`, `CREATE`) granted to `grantee`.
    pub privileges: Vec<String>,
}

/// `'schema.name'`-style literal for a `::regclass` cast, with single quotes in
/// the components escaped so the literal stays well-formed.
fn regclass_literal(schema: &str, name: &str) -> String {
    format!("{}.{}", schema, name).replace('\'', "''")
}

/// Assemble a `CREATE TABLE` statement (plus trailing `CREATE INDEX`
/// statements) from the reconstructed catalog pieces. Constraints are emitted
/// inside the parenthesised body, after every column. Indexes already backing
/// a constraint are expected to be filtered out by the caller.
fn build_create_table(
    schema: &str,
    name: &str,
    columns: &[ColumnDef],
    constraints: &[ConstraintDef],
    index_defs: &[String],
) -> String {
    let mut lines: Vec<String> = Vec::new();
    for col in columns {
        let mut line = format!("    {} {}", quote_ident(&col.name), col.type_sql);
        if col.not_null {
            line.push_str(" NOT NULL");
        }
        if let Some(default) = &col.default {
            line.push_str(&format!(" DEFAULT {default}"));
        }
        lines.push(line);
    }
    for c in constraints {
        lines.push(format!(
            "    CONSTRAINT {} {}",
            quote_ident(&c.name),
            c.def
        ));
    }

    let mut out = format!(
        "CREATE TABLE {}.{} (\n{}\n);",
        quote_ident(schema),
        quote_ident(name),
        lines.join(",\n"),
    );
    for idx in index_defs {
        out.push('\n');
        out.push_str(idx);
        out.push(';');
    }
    out
}

/// Assemble a `CREATE SEQUENCE` statement from the reconstructed attributes.
fn build_create_sequence(schema: &str, name: &str, seq: &SequenceDef) -> String {
    format!(
        "CREATE SEQUENCE {}.{}\n  START WITH {}\n  INCREMENT BY {}\n  MINVALUE {}\n  MAXVALUE {}\n  CACHE {}\n  {};",
        quote_ident(schema),
        quote_ident(name),
        seq.start,
        seq.increment,
        seq.min,
        seq.max,
        seq.cache,
        if seq.cycle { "CYCLE" } else { "NO CYCLE" },
    )
}

/// `CREATE OR REPLACE VIEW ... AS <body>;` from a `pg_get_viewdef` body.
fn build_create_view(schema: &str, name: &str, body: &str) -> String {
    format!(
        "CREATE OR REPLACE VIEW {}.{} AS\n{};",
        quote_ident(schema),
        quote_ident(name),
        body.trim_end().trim_end_matches(';'),
    )
}

/// `CREATE MATERIALIZED VIEW ... AS <body>;` from a `pg_get_viewdef` body.
fn build_create_materialized_view(schema: &str, name: &str, body: &str) -> String {
    format!(
        "CREATE MATERIALIZED VIEW {}.{} AS\n{};",
        quote_ident(schema),
        quote_ident(name),
        body.trim_end().trim_end_matches(';'),
    )
}

/// Assemble the full schema definition: `CREATE SCHEMA` plus the optional
/// `COMMENT ON SCHEMA`, the `ALTER ... OWNER TO`, and one `GRANT` per grantee —
/// matching DataGrip's reconstructed schema DDL.
fn build_create_schema(
    name: &str,
    owner: &str,
    comment: Option<&str>,
    grants: &[SchemaGrant],
) -> String {
    let ident = quote_ident(name);
    let mut out = format!("CREATE SCHEMA {ident};");
    if let Some(comment) = comment {
        out.push_str(&format!(
            "\nCOMMENT ON SCHEMA {ident} IS {};",
            quote_literal(comment)
        ));
    }
    out.push_str(&format!(
        "\nALTER SCHEMA {ident} OWNER TO {};",
        quote_ident(owner)
    ));
    for grant in grants {
        let grantee = match &grant.grantee {
            Some(role) => quote_ident(role),
            None => "PUBLIC".to_owned(),
        };
        out.push_str(&format!(
            "\nGRANT {} ON SCHEMA {ident} TO {grantee};",
            grant.privileges.join(", ")
        ));
    }
    out
}

/// Read the single text value from the first row/column, if present.
fn first_text(rows: &[tokio_postgres::Row]) -> Option<String> {
    rows.get(0).and_then(|r| r.try_get::<_, String>(0).ok())
}

/// `pg_get_viewdef` body for a (materialized) view, located via `::regclass`.
async fn view_body(client: &Client, schema: &str, name: &str) -> Result<String> {
    let lit = regclass_literal(schema, name);
    let sql = format!("SELECT pg_get_viewdef('{lit}'::regclass, true)");
    let rows = client
        .query(&sql, &[])
        .await
        .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
    first_text(&rows)
        .ok_or_else(|| DriverError::QueryFailed(format!("view '{schema}.{name}' not found")))
}

/// All `pg_get_functiondef` bodies for a name (one per overload), joined by a
/// blank line.
async fn function_def(client: &Client, schema: &str, name: &str) -> Result<String> {
    let rows = client
        .query(
            "SELECT pg_get_functiondef(p.oid) \
             FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid \
             WHERE n.nspname = $1 AND p.proname = $2 \
             ORDER BY p.oid",
            &[&schema, &name],
        )
        .await
        .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
    let defs: Vec<String> = rows
        .iter()
        .filter_map(|r| r.try_get::<_, String>(0).ok())
        .collect();
    if defs.is_empty() {
        return Err(DriverError::QueryFailed(format!(
            "routine '{schema}.{name}' not found"
        )));
    }
    Ok(defs.join("\n\n"))
}

/// `pg_get_triggerdef` for a trigger by schema + name.
async fn trigger_def(client: &Client, schema: &str, name: &str) -> Result<String> {
    let rows = client
        .query(
            "SELECT pg_get_triggerdef(t.oid) \
             FROM pg_trigger t \
             JOIN pg_class c ON t.tgrelid = c.oid \
             JOIN pg_namespace n ON c.relnamespace = n.oid \
             WHERE NOT t.tgisinternal AND n.nspname = $1 AND t.tgname = $2",
            &[&schema, &name],
        )
        .await
        .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
    let body = first_text(&rows)
        .ok_or_else(|| DriverError::QueryFailed(format!("trigger '{schema}.{name}' not found")))?;
    Ok(format!("{};", body.trim_end().trim_end_matches(';')))
}

/// `indexdef` from `pg_indexes` for a standalone index by schema + name.
async fn index_def(client: &Client, schema: &str, name: &str) -> Result<String> {
    let rows = client
        .query(
            "SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2",
            &[&schema, &name],
        )
        .await
        .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
    let body = first_text(&rows)
        .ok_or_else(|| DriverError::QueryFailed(format!("index '{schema}.{name}' not found")))?;
    Ok(format!("{};", body.trim_end().trim_end_matches(';')))
}

/// Reconstruct a `CREATE SEQUENCE` from `pg_sequences`.
async fn sequence_def(client: &Client, schema: &str, name: &str) -> Result<String> {
    let rows = client
        .query(
            "SELECT start_value::text, min_value::text, max_value::text, \
                    increment_by::text, cache_size::text, cycle \
             FROM pg_sequences WHERE schemaname = $1 AND sequencename = $2",
            &[&schema, &name],
        )
        .await
        .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
    let row = rows
        .get(0)
        .ok_or_else(|| DriverError::QueryFailed(format!("sequence '{schema}.{name}' not found")))?;
    let seq = SequenceDef {
        start: row.get::<_, String>(0),
        min: row.get::<_, String>(1),
        max: row.get::<_, String>(2),
        increment: row.get::<_, String>(3),
        cache: row.get::<_, String>(4),
        cycle: row.get::<_, bool>(5),
    };
    Ok(build_create_sequence(schema, name, &seq))
}

/// Reconstruct a full `CREATE TABLE` (columns + constraints) followed by the
/// `CREATE INDEX` statements for indexes not backing a constraint.
async fn table_def(client: &Client, schema: &str, name: &str) -> Result<String> {
    // Resolve the table oid once; reused for every catalog lookup below.
    let lit = regclass_literal(schema, name);
    let oid_rows = client
        .query(&format!("SELECT '{lit}'::regclass::oid"), &[])
        .await
        .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
    let oid: u32 = oid_rows
        .get(0)
        .and_then(|r| r.try_get::<_, u32>(0).ok())
        .ok_or_else(|| DriverError::QueryFailed(format!("table '{schema}.{name}' not found")))?;

    // Columns: name, rendered type, NOT NULL, and rendered DEFAULT expression.
    let col_rows = client
        .query(
            "SELECT a.attname, \
                    format_type(a.atttypid, a.atttypmod), \
                    a.attnotnull, \
                    pg_get_expr(d.adbin, d.adrelid) \
             FROM pg_attribute a \
             LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
             WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped \
             ORDER BY a.attnum",
            &[&oid],
        )
        .await
        .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
    let columns: Vec<ColumnDef> = col_rows
        .iter()
        .map(|r| ColumnDef {
            name: r.get::<_, String>(0),
            type_sql: r.get::<_, String>(1),
            not_null: r.get::<_, bool>(2),
            default: r.try_get::<_, String>(3).ok(),
        })
        .collect();

    // Constraints, ordered so primary key comes first ('p' < 'u' < 'c' < 'f').
    let con_rows = client
        .query(
            "SELECT conname, pg_get_constraintdef(oid), contype \
             FROM pg_constraint WHERE conrelid = $1 ORDER BY contype, conname",
            &[&oid],
        )
        .await
        .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
    let constraints: Vec<ConstraintDef> = con_rows
        .iter()
        .map(|r| ConstraintDef {
            name: r.get::<_, String>(0),
            def: r.get::<_, String>(1),
        })
        .collect();

    // Indexes that back a primary key or unique constraint share the
    // constraint's name; exclude them so we don't duplicate the constraint as a
    // standalone CREATE [UNIQUE] INDEX.
    let constraint_names: std::collections::HashSet<&str> =
        constraints.iter().map(|c| c.name.as_str()).collect();
    let idx_rows = client
        .query(
            "SELECT c.relname, pg_get_indexdef(i.indexrelid) \
             FROM pg_index i \
             JOIN pg_class c ON c.oid = i.indexrelid \
             WHERE i.indrelid = $1 \
             ORDER BY c.relname",
            &[&oid],
        )
        .await
        .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
    let index_defs: Vec<String> = idx_rows
        .iter()
        .filter(|r| !constraint_names.contains(r.get::<_, String>(0).as_str()))
        .map(|r| r.get::<_, String>(1))
        .collect();

    Ok(build_create_table(
        schema,
        name,
        &columns,
        &constraints,
        &index_defs,
    ))
}

/// Reconstruct a schema's DDL from `pg_namespace`: owner via `pg_get_userbyid`,
/// comment via `obj_description`, and the access grants via `aclexplode`.
async fn schema_def(client: &Client, name: &str) -> Result<String> {
    let meta = client
        .query(
            "SELECT pg_catalog.pg_get_userbyid(n.nspowner), \
                    pg_catalog.obj_description(n.oid, 'pg_namespace') \
             FROM pg_catalog.pg_namespace n WHERE n.nspname = $1",
            &[&name],
        )
        .await
        .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
    let row = meta
        .get(0)
        .ok_or_else(|| DriverError::QueryFailed(format!("schema '{name}' not found")))?;
    let owner: String = row.get(0);
    let comment: Option<String> = row.get(1);

    // Expand the schema's ACL; a `PUBLIC` grant surfaces as grantee oid 0, which
    // matches no `pg_roles` row, so its `rolname` comes back NULL.
    let grant_rows = client
        .query(
            "SELECT r.rolname, a.privilege_type \
             FROM pg_catalog.pg_namespace n \
             CROSS JOIN LATERAL aclexplode(n.nspacl) a \
             LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee \
             WHERE n.nspname = $1 \
             ORDER BY r.rolname NULLS FIRST, a.privilege_type",
            &[&name],
        )
        .await
        .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;

    // Fold consecutive rows (the query is ordered by grantee) into one grant per
    // grantee carrying all its privileges.
    let mut grants: Vec<SchemaGrant> = Vec::new();
    for r in &grant_rows {
        let grantee: Option<String> = r.get(0);
        let privilege: String = r.get(1);
        match grants.last_mut() {
            Some(g) if g.grantee == grantee => g.privileges.push(privilege),
            _ => grants.push(SchemaGrant {
                grantee,
                privileges: vec![privilege],
            }),
        }
    }

    Ok(build_create_schema(name, &owner, comment.as_deref(), &grants))
}

/// Resolve `object` against the connected Postgres catalog and return its
/// reconstructed DDL. The schema defaults to `public` when unset.
pub(super) async fn object_definition(
    client: &Arc<Client>,
    object: &ObjectRef,
) -> Result<String> {
    let schema = object.schema.as_deref().unwrap_or("public");
    let name = object.name.as_str();
    match object.kind {
        SchemaNodeKind::View => {
            let body = view_body(client, schema, name).await?;
            Ok(build_create_view(schema, name, &body))
        }
        SchemaNodeKind::MaterializedView => {
            let body = view_body(client, schema, name).await?;
            Ok(build_create_materialized_view(schema, name, &body))
        }
        SchemaNodeKind::Function | SchemaNodeKind::Procedure => {
            function_def(client, schema, name).await
        }
        SchemaNodeKind::Trigger => trigger_def(client, schema, name).await,
        SchemaNodeKind::Index => index_def(client, schema, name).await,
        SchemaNodeKind::Sequence => sequence_def(client, schema, name).await,
        SchemaNodeKind::Table => table_def(client, schema, name).await,
        // A schema node's own name is the schema; ignore the (database) `schema`
        // qualifier here.
        SchemaNodeKind::Schema => schema_def(client, name).await,
        other => Err(DriverError::Unsupported(format!(
            "Postgres: no definition for {other:?}"
        ))),
    }
}

/// The `SHOW TABLE` / `SHOW VIEW` statement that returns ready-made DDL for a
/// Redshift table or view, or `None` for any other kind (which the caller
/// routes through the catalog reconstruction instead).
fn redshift_show_sql(object: &ObjectRef) -> Option<String> {
    let keyword = match object.kind {
        SchemaNodeKind::Table => "SHOW TABLE",
        SchemaNodeKind::View => "SHOW VIEW",
        _ => return None,
    };
    let schema = object.schema.as_deref().unwrap_or("public");
    Some(format!(
        "{keyword} {}.{}",
        quote_ident(schema),
        quote_ident(&object.name)
    ))
}

/// Redshift DDL retrieval. Redshift's Postgres-8 dialect lacks the `pg_get_*def`
/// server functions, but `SHOW TABLE` / `SHOW VIEW` return a ready-made `CREATE`
/// statement (run over the simple-query protocol, as `SHOW` is a utility
/// statement). Other object kinds fall back to the catalog reconstruction.
pub(super) async fn redshift_object_definition(
    client: &Arc<Client>,
    object: &ObjectRef,
) -> Result<String> {
    let Some(sql) = redshift_show_sql(object) else {
        return object_definition(client, object).await;
    };
    let messages = client
        .simple_query(&sql)
        .await
        .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
    let ddl = messages
        .iter()
        .find_map(|m| match m {
            tokio_postgres::SimpleQueryMessage::Row(row) => {
                row.get(0).map(|s| s.to_owned())
            }
            _ => None,
        })
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| {
            DriverError::QueryFailed(format!(
                "Redshift: definition for '{}' not found",
                object.name
            ))
        })?;
    Ok(format!("{};", ddl.trim_end().trim_end_matches(';')))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(kind: SchemaNodeKind, schema: Option<&str>, name: &str) -> ObjectRef {
        ObjectRef {
            kind,
            database: None,
            schema: schema.map(Into::into),
            name: name.into(),
        }
    }

    #[test]
    fn redshift_show_sql_for_table_and_view() {
        assert_eq!(
            redshift_show_sql(&obj(SchemaNodeKind::Table, Some("sales"), "orders")).unwrap(),
            "SHOW TABLE \"sales\".\"orders\""
        );
        assert_eq!(
            redshift_show_sql(&obj(SchemaNodeKind::View, None, "v")).unwrap(),
            "SHOW VIEW \"public\".\"v\""
        );
    }

    #[test]
    fn redshift_show_sql_none_for_other_kinds() {
        assert!(redshift_show_sql(&obj(SchemaNodeKind::Function, Some("s"), "f")).is_none());
        assert!(redshift_show_sql(&obj(SchemaNodeKind::Index, Some("s"), "i")).is_none());
    }

    #[test]
    fn redshift_show_sql_escapes_identifiers() {
        assert_eq!(
            redshift_show_sql(&obj(SchemaNodeKind::Table, Some("we\"ird"), "ta\"ble")).unwrap(),
            "SHOW TABLE \"we\"\"ird\".\"ta\"\"ble\""
        );
    }

    #[test]
    fn quote_ident_wraps_and_escapes() {
        assert_eq!(quote_ident("users"), "\"users\"");
        assert_eq!(quote_ident("My Table"), "\"My Table\"");
        assert_eq!(quote_ident("we\"ird"), "\"we\"\"ird\"");
    }

    #[test]
    fn regclass_literal_escapes_single_quotes() {
        assert_eq!(regclass_literal("public", "users"), "public.users");
        assert_eq!(regclass_literal("pub'lic", "t"), "pub''lic.t");
    }

    #[test]
    fn build_create_view_appends_semicolon_and_strips_existing() {
        let out = build_create_view("public", "v", "SELECT 1");
        assert_eq!(out, "CREATE OR REPLACE VIEW \"public\".\"v\" AS\nSELECT 1;");
        // A body that already ends with a semicolon doesn't double up.
        let out2 = build_create_view("public", "v", "SELECT 1;");
        assert_eq!(out2, "CREATE OR REPLACE VIEW \"public\".\"v\" AS\nSELECT 1;");
    }

    #[test]
    fn build_create_materialized_view_uses_materialized_keyword() {
        let out = build_create_materialized_view("s", "mv", "SELECT a FROM t");
        assert_eq!(
            out,
            "CREATE MATERIALIZED VIEW \"s\".\"mv\" AS\nSELECT a FROM t;"
        );
    }

    #[test]
    fn build_create_schema_full_fidelity() {
        let grants = vec![
            SchemaGrant {
                grantee: None,
                privileges: vec!["USAGE".into()],
            },
            SchemaGrant {
                grantee: Some("pg_database_owner".into()),
                privileges: vec!["CREATE".into(), "USAGE".into()],
            },
        ];
        let out = build_create_schema(
            "public",
            "pg_database_owner",
            Some("standard public schema"),
            &grants,
        );
        assert_eq!(
            out,
            "CREATE SCHEMA \"public\";\n\
             COMMENT ON SCHEMA \"public\" IS 'standard public schema';\n\
             ALTER SCHEMA \"public\" OWNER TO \"pg_database_owner\";\n\
             GRANT USAGE ON SCHEMA \"public\" TO PUBLIC;\n\
             GRANT CREATE, USAGE ON SCHEMA \"public\" TO \"pg_database_owner\";"
        );
    }

    #[test]
    fn build_create_schema_without_comment_or_grants() {
        let out = build_create_schema("analytics", "alice", None, &[]);
        assert_eq!(
            out,
            "CREATE SCHEMA \"analytics\";\n\
             ALTER SCHEMA \"analytics\" OWNER TO \"alice\";"
        );
    }

    #[test]
    fn build_create_schema_escapes_comment_quotes() {
        let out = build_create_schema("s", "o", Some("it's mine"), &[]);
        assert!(out.contains("IS 'it''s mine';"), "{out}");
    }

    #[test]
    fn quote_literal_wraps_and_escapes() {
        assert_eq!(quote_literal("plain"), "'plain'");
        assert_eq!(quote_literal("o'brien"), "'o''brien'");
    }

    #[test]
    fn build_create_sequence_renders_all_clauses() {
        let seq = SequenceDef {
            start: "1".into(),
            increment: "1".into(),
            min: "1".into(),
            max: "9223372036854775807".into(),
            cache: "1".into(),
            cycle: false,
        };
        let out = build_create_sequence("public", "s_id_seq", &seq);
        assert_eq!(
            out,
            "CREATE SEQUENCE \"public\".\"s_id_seq\"\n  \
             START WITH 1\n  INCREMENT BY 1\n  MINVALUE 1\n  \
             MAXVALUE 9223372036854775807\n  CACHE 1\n  NO CYCLE;"
        );
    }

    #[test]
    fn build_create_sequence_emits_cycle_when_set() {
        let seq = SequenceDef {
            start: "5".into(),
            increment: "2".into(),
            min: "1".into(),
            max: "100".into(),
            cache: "10".into(),
            cycle: true,
        };
        let out = build_create_sequence("public", "s", &seq);
        assert!(out.ends_with("CACHE 10\n  CYCLE;"));
        assert!(out.contains("START WITH 5"));
        assert!(out.contains("INCREMENT BY 2"));
    }

    #[test]
    fn build_create_table_full_fidelity_columns_constraints_indexes() {
        let columns = vec![
            ColumnDef {
                name: "id".into(),
                type_sql: "integer".into(),
                not_null: true,
                default: Some("nextval('s_id_seq'::regclass)".into()),
            },
            ColumnDef {
                name: "email".into(),
                type_sql: "character varying(255)".into(),
                not_null: true,
                default: None,
            },
            ColumnDef {
                name: "bio".into(),
                type_sql: "text".into(),
                not_null: false,
                default: None,
            },
        ];
        let constraints = vec![
            ConstraintDef {
                name: "users_pkey".into(),
                def: "PRIMARY KEY (id)".into(),
            },
            ConstraintDef {
                name: "users_email_key".into(),
                def: "UNIQUE (email)".into(),
            },
        ];
        let indexes = vec!["CREATE INDEX users_bio_idx ON public.users USING btree (bio)".into()];
        let out = build_create_table("public", "users", &columns, &constraints, &indexes);
        let expected = "CREATE TABLE \"public\".\"users\" (\n\
            \x20   \"id\" integer NOT NULL DEFAULT nextval('s_id_seq'::regclass),\n\
            \x20   \"email\" character varying(255) NOT NULL,\n\
            \x20   \"bio\" text,\n\
            \x20   CONSTRAINT \"users_pkey\" PRIMARY KEY (id),\n\
            \x20   CONSTRAINT \"users_email_key\" UNIQUE (email)\n\
            );\n\
            CREATE INDEX users_bio_idx ON public.users USING btree (bio);";
        assert_eq!(out, expected);
    }

    #[test]
    fn build_create_table_without_constraints_or_indexes() {
        let columns = vec![ColumnDef {
            name: "n".into(),
            type_sql: "integer".into(),
            not_null: false,
            default: None,
        }];
        let out = build_create_table("public", "t", &columns, &[], &[]);
        assert_eq!(
            out,
            "CREATE TABLE \"public\".\"t\" (\n    \"n\" integer\n);"
        );
    }
}
