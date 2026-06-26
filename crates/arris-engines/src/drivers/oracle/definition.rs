use oracle_rs::{LobValue, Value};

use crate::drivers::errors::Result;
use crate::{DriverError, ObjectRef, SchemaNodeKind};

use super::OracleDriver;

impl OracleDriver {
    /// Oracle metadata object-type string for `DBMS_METADATA.GET_DDL`. Returns
    /// `None` for kinds that have no `GET_DDL` representation.
    pub(super) fn metadata_type(kind: SchemaNodeKind) -> Option<&'static str> {
        match kind {
            SchemaNodeKind::Table => Some("TABLE"),
            SchemaNodeKind::View => Some("VIEW"),
            SchemaNodeKind::MaterializedView => Some("MATERIALIZED_VIEW"),
            SchemaNodeKind::Function => Some("FUNCTION"),
            SchemaNodeKind::Procedure => Some("PROCEDURE"),
            SchemaNodeKind::Trigger => Some("TRIGGER"),
            SchemaNodeKind::Index => Some("INDEX"),
            SchemaNodeKind::Sequence => Some("SEQUENCE"),
            // In Oracle a schema IS a user, so its DDL comes from the `USER`
            // metadata object (`GET_DDL('USER', '<schema>')`).
            SchemaNodeKind::Schema => Some("USER"),
            _ => None,
        }
    }

    /// Fetch a `DBMS_METADATA.GET_DDL` CLOB and read it as a `String`. The DDL
    /// comes back as the single column of the single row; small CLOBs arrive
    /// inline while larger ones are read from the LOB locator.
    pub(super) async fn fetch_ddl(&self, sql: &str) -> Result<String> {
        let guard = self.inner.lock().await;
        let conn = guard.as_ref().ok_or(DriverError::NotConnected)?;

        let result = conn
            .query(sql, &[])
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        let value = result
            .rows
            .into_iter()
            .next()
            .and_then(|row| row.into_values().into_iter().next())
            .ok_or_else(|| DriverError::QueryFailed("object not found".into()))?;

        match value {
            Value::String(s) => Ok(s),
            Value::Lob(lob) => match lob {
                LobValue::Locator(loc) => conn
                    .read_clob(&loc)
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string())),
                other => other
                    .as_string()
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))
                    .map(|s| s.unwrap_or_default()),
            },
            Value::Null => Err(DriverError::QueryFailed("object not found".into())),
            other => Ok(format!("{other:?}")),
        }
    }

    pub(super) async fn object_definition_inner(&self, object: &ObjectRef) -> Result<String> {
        let object_type = Self::metadata_type(object.kind).ok_or_else(|| {
            DriverError::Unsupported(format!(
                "object definition is not supported for {:?}",
                object.kind
            ))
        })?;

        // Best-effort readability tuning. Runs on the same pinned connection as
        // the GET_DDL query below; ignore failures so a locked-down session
        // still yields raw DDL.
        {
            let guard = self.inner.lock().await;
            if let Some(conn) = guard.as_ref() {
                let _ = conn
                    .execute(
                        "BEGIN \
                         DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM,'STORAGE',false); \
                         DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM,'SEGMENT_ATTRIBUTES',false); \
                         DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM,'SQLTERMINATOR',true); \
                         DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM,'PRETTY',true); \
                         END;",
                        &[],
                    )
                    .await;
            }
        }

        let name = object.name.replace('\'', "''");
        let sql = match &object.schema {
            Some(schema) => {
                let schema = schema.replace('\'', "''");
                format!(
                    "SELECT DBMS_METADATA.GET_DDL('{object_type}', '{name}', '{schema}') FROM dual"
                )
            }
            None => format!("SELECT DBMS_METADATA.GET_DDL('{object_type}', '{name}') FROM dual"),
        };

        let ddl = self.fetch_ddl(&sql).await?;
        Ok(ddl.trim().to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_type_maps_supported_kinds() {
        assert_eq!(OracleDriver::metadata_type(SchemaNodeKind::Table), Some("TABLE"));
        assert_eq!(OracleDriver::metadata_type(SchemaNodeKind::View), Some("VIEW"));
        assert_eq!(
            OracleDriver::metadata_type(SchemaNodeKind::MaterializedView),
            Some("MATERIALIZED_VIEW")
        );
        assert_eq!(
            OracleDriver::metadata_type(SchemaNodeKind::Function),
            Some("FUNCTION")
        );
        assert_eq!(
            OracleDriver::metadata_type(SchemaNodeKind::Procedure),
            Some("PROCEDURE")
        );
        assert_eq!(
            OracleDriver::metadata_type(SchemaNodeKind::Trigger),
            Some("TRIGGER")
        );
        assert_eq!(OracleDriver::metadata_type(SchemaNodeKind::Index), Some("INDEX"));
        assert_eq!(
            OracleDriver::metadata_type(SchemaNodeKind::Sequence),
            Some("SEQUENCE")
        );
        // A schema maps to the Oracle `USER` metadata object.
        assert_eq!(OracleDriver::metadata_type(SchemaNodeKind::Schema), Some("USER"));
    }

    #[test]
    fn metadata_type_rejects_unsupported_kinds() {
        assert_eq!(OracleDriver::metadata_type(SchemaNodeKind::Column), None);
        assert_eq!(OracleDriver::metadata_type(SchemaNodeKind::Database), None);
        assert_eq!(OracleDriver::metadata_type(SchemaNodeKind::Type), None);
    }
}
