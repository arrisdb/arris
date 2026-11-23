use std::fs;
use std::path::Path;

use serde_yml::Value;

use super::constants::{
    CONFIG_FILES, CONNECTION_NAME_PREFIX, CONNECTION_TYPE_KEY, DEFAULT_GATEWAY_KEY,
    GATEWAY_CONNECTION_KEY, GATEWAY_CONNECTIONS, GATEWAYS_KEY,
};
use crate::connection::PrefillError;
use crate::connection::types::ConnectionPrefill;

/// Turns one sqlmesh gateway connection into a connection prefill; secrets are never read.
pub struct GatewayConnectionMapper;

impl GatewayConnectionMapper {
    /// `gateway` defaults to `default_gateway`, else the first gateway listed.
    pub fn map(
        config_yaml: &str,
        gateway: Option<&str>,
    ) -> Result<ConnectionPrefill, PrefillError> {
        let root: Value = serde_yml::from_str(config_yaml)
            .map_err(|e| PrefillError::Invalid(format!("{}: {e}", CONFIG_FILES[0])))?;
        let gateways = root
            .get(GATEWAYS_KEY)
            .and_then(Value::as_mapping)
            .ok_or_else(|| PrefillError::NotFound(format!("`{GATEWAYS_KEY}`")))?;
        let name = match gateway {
            Some(g) => g.to_owned(),
            None => root
                .get(DEFAULT_GATEWAY_KEY)
                .and_then(Value::as_str)
                .or_else(|| gateways.keys().next().and_then(Value::as_str))
                .ok_or_else(|| PrefillError::NotFound(format!("`{GATEWAYS_KEY}`")))?
                .to_owned(),
        };
        let connection = gateways
            .get(name.as_str())
            .and_then(|g| g.get(GATEWAY_CONNECTION_KEY))
            .and_then(Value::as_mapping)
            .ok_or_else(|| PrefillError::NotFound(format!("gateway `{name}` connection")))?;
        let kind_name = connection
            .get(CONNECTION_TYPE_KEY)
            .and_then(Value::as_str)
            .unwrap_or_default();
        let (_, kind, keys) = GATEWAY_CONNECTIONS
            .iter()
            .find(|(t, ..)| *t == kind_name)
            .ok_or_else(|| PrefillError::UnsupportedAdapter(kind_name.to_owned()))?;
        let conn_name = format!("{CONNECTION_NAME_PREFIX}{name}");
        Ok(ConnectionPrefill::from_mapping(
            conn_name, *kind, connection, keys,
        ))
    }

    /// Reads `config.yaml` (or `config.yml`); a Python config is not supported.
    pub fn from_project(
        dir: &Path,
        gateway: Option<&str>,
    ) -> Result<ConnectionPrefill, PrefillError> {
        let text = CONFIG_FILES
            .iter()
            .find_map(|file| fs::read_to_string(dir.join(file)).ok())
            .ok_or_else(|| {
                PrefillError::NotFound(dir.join(CONFIG_FILES[0]).display().to_string())
            })?;
        Self::map(&text, gateway)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DatabaseKind;

    const CONFIG: &str = r#"
gateways:
  local:
    connection:
      type: duckdb
      database: data/local.duckdb
  warehouse:
    connection:
      type: postgres
      host: pg.internal
      port: 5432
      user: sqlmesh
      password: topsecret
      database: dw
  lake:
    connection:
      type: spark
default_gateway: warehouse
"#;

    #[test]
    fn default_gateway_maps_postgres() {
        let p = GatewayConnectionMapper::map(CONFIG, None).unwrap();
        assert_eq!(p.name, "sqlmesh-warehouse");
        assert_eq!(p.kind, DatabaseKind::Postgres);
        assert_eq!(p.fields.host, "pg.internal");
        assert_eq!(p.fields.database, "dw");
        assert!(!serde_json::to_string(&p).unwrap().contains("topsecret"));
    }

    #[test]
    fn named_gateway_maps_duckdb_file() {
        let p = GatewayConnectionMapper::map(CONFIG, Some("local")).unwrap();
        assert_eq!(p.kind, DatabaseKind::Duckdb);
        assert_eq!(p.fields.file_path.as_deref(), Some("data/local.duckdb"));
    }

    #[test]
    fn unsupported_connection_type_errors() {
        let err = GatewayConnectionMapper::map(CONFIG, Some("lake")).unwrap_err();
        assert!(matches!(err, PrefillError::UnsupportedAdapter(ref t) if t == "spark"));
    }

    #[test]
    fn missing_gateway_is_not_found() {
        let err = GatewayConnectionMapper::map(CONFIG, Some("nope")).unwrap_err();
        assert!(matches!(err, PrefillError::NotFound(_)));
    }
}
