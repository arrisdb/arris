use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use serde_yml::Value;

use super::DbtEngine;
use super::constants::{
    CONNECTION_NAME_SEPARATOR, ENV_PROFILES_DIR, HOME_PROFILES_DIR, OUTPUT_TYPE_KEY,
    PROFILE_ADAPTERS, PROFILE_OUTPUTS_KEY, PROFILE_TARGET_KEY, PROFILES_FILE, PROJECT_FILE,
};
use crate::connection::PrefillError;
use crate::connection::types::ConnectionPrefill;

/// Turns one dbt profile target into a connection prefill; secrets are never read.
pub struct ProfileConnectionMapper;

impl ProfileConnectionMapper {
    /// `target` defaults to the profile's own `target`.
    pub fn map(
        profiles_yaml: &str,
        profile: &str,
        target: Option<&str>,
    ) -> Result<ConnectionPrefill, PrefillError> {
        let root: Value = serde_yml::from_str(profiles_yaml)
            .map_err(|e| PrefillError::Invalid(format!("{PROFILES_FILE}: {e}")))?;
        let entry = root
            .get(profile)
            .ok_or_else(|| PrefillError::NotFound(format!("profile `{profile}`")))?;
        let target = match target {
            Some(t) => t.to_owned(),
            None => entry
                .get(PROFILE_TARGET_KEY)
                .and_then(Value::as_str)
                .ok_or_else(|| PrefillError::NotFound(format!("default target of `{profile}`")))?
                .to_owned(),
        };
        let output = entry
            .get(PROFILE_OUTPUTS_KEY)
            .and_then(|o| o.get(target.as_str()))
            .and_then(Value::as_mapping)
            .ok_or_else(|| PrefillError::NotFound(format!("target `{target}` of `{profile}`")))?;
        let adapter = output
            .get(OUTPUT_TYPE_KEY)
            .and_then(Value::as_str)
            .unwrap_or_default();
        let (_, kind, keys) = PROFILE_ADAPTERS
            .iter()
            .find(|(name, ..)| *name == adapter)
            .ok_or_else(|| PrefillError::UnsupportedAdapter(adapter.to_owned()))?;
        let name = format!("{profile}{CONNECTION_NAME_SEPARATOR}{target}");
        Ok(ConnectionPrefill::from_mapping(name, *kind, output, keys))
    }

    /// Reads the profile named in `dbt_project.yml` from the profiles file dbt would use.
    pub fn from_project(
        dir: &Path,
        target: Option<&str>,
    ) -> Result<ConnectionPrefill, PrefillError> {
        let project_file = dir.join(PROJECT_FILE);
        let project = DbtEngine::new()
            .parse_project_yaml(&Self::read(&project_file)?)
            .map_err(|e| PrefillError::Invalid(format!("{}: {e}", project_file.display())))?;
        let profiles = Self::profiles_path(dir, std::env::var_os(ENV_PROFILES_DIR))
            .ok_or_else(|| PrefillError::NotFound(PROFILES_FILE.to_owned()))?;
        Self::map(&Self::read(&profiles)?, &project.profile, target)
    }

    /// `DBT_PROFILES_DIR`, else the project dir, else `~/.dbt`.
    fn profiles_path(dir: &Path, env_dir: Option<OsString>) -> Option<PathBuf> {
        if let Some(env_dir) = env_dir {
            return Some(PathBuf::from(env_dir).join(PROFILES_FILE));
        }
        let local = dir.join(PROFILES_FILE);
        if local.is_file() {
            return Some(local);
        }
        dirs::home_dir().map(|home| home.join(HOME_PROFILES_DIR).join(PROFILES_FILE))
    }

    fn read(path: &Path) -> Result<String, PrefillError> {
        fs::read_to_string(path).map_err(|_| PrefillError::NotFound(path.display().to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DatabaseKind;

    const PROFILES: &str = r#"
shop:
  target: dev
  outputs:
    dev:
      type: postgres
      host: db.local
      port: 5433
      user: analyst
      password: hunter2
      dbname: shop
      schema: public
    prod:
      type: postgres
      host: "{{ env_var('PROD_HOST') }}"
      user: "{{ env_var('PROD_USER') }}"
      password: "{{ env_var('PROD_PASSWORD') }}"
      dbname: shop
    sf:
      type: snowflake
      account: ab12345.eu-west-1
      user: loader
      password: secret
      private_key: "-----BEGIN-----"
      role: transformer
      database: analytics
      warehouse: compute_wh
      schema: dbt
    bq:
      type: bigquery
      method: service-account
      project: my-gcp
      keyfile: /keys/sa.json
      location: EU
    local:
      type: duckdb
      path: ./warehouse.duckdb
    spark:
      type: spark
      host: spark.local
"#;

    #[test]
    fn postgres_target_maps_connection_fields() {
        let p = ProfileConnectionMapper::map(PROFILES, "shop", None).unwrap();
        assert_eq!(p.name, "shop-dev");
        assert_eq!(p.kind, DatabaseKind::Postgres);
        assert_eq!(
            (
                p.fields.host.as_str(),
                p.fields.port,
                p.fields.user.as_str()
            ),
            ("db.local", 5433, "analyst")
        );
        assert_eq!(p.fields.database, "shop");
    }

    #[test]
    fn snowflake_maps_account_and_options() {
        let p = ProfileConnectionMapper::map(PROFILES, "shop", Some("sf")).unwrap();
        assert_eq!(p.kind, DatabaseKind::Snowflake);
        assert_eq!(p.fields.host, "ab12345.eu-west-1");
        assert_eq!(p.fields.database, "analytics");
        assert_eq!(
            p.fields.options,
            "warehouse=compute_wh&role=transformer&schema=dbt"
        );
    }

    #[test]
    fn bigquery_maps_project_and_keyfile() {
        let p = ProfileConnectionMapper::map(PROFILES, "shop", Some("bq")).unwrap();
        assert_eq!(p.kind, DatabaseKind::Bigquery);
        assert_eq!(p.fields.database, "my-gcp");
        assert_eq!(p.fields.credentials_file.as_deref(), Some("/keys/sa.json"));
        assert_eq!(p.fields.location.as_deref(), Some("EU"));
    }

    #[test]
    fn duckdb_maps_path() {
        let p = ProfileConnectionMapper::map(PROFILES, "shop", Some("local")).unwrap();
        assert_eq!(p.kind, DatabaseKind::Duckdb);
        assert_eq!(p.fields.file_path.as_deref(), Some("./warehouse.duckdb"));
    }

    #[test]
    fn literal_password_never_mapped() {
        for target in ["dev", "sf"] {
            let p = ProfileConnectionMapper::map(PROFILES, "shop", Some(target)).unwrap();
            let json = serde_json::to_string(&p).unwrap();
            for secret in ["hunter2", "secret", "BEGIN"] {
                assert!(!json.contains(secret), "{target} leaked {secret}");
            }
        }
    }

    #[test]
    fn env_var_values_dropped() {
        let p = ProfileConnectionMapper::map(PROFILES, "shop", Some("prod")).unwrap();
        assert!(p.fields.host.is_empty());
        assert!(p.fields.user.is_empty());
        assert_eq!(p.fields.database, "shop");
    }

    #[test]
    fn unsupported_adapter_errors() {
        let err = ProfileConnectionMapper::map(PROFILES, "shop", Some("spark")).unwrap_err();
        assert!(matches!(err, PrefillError::UnsupportedAdapter(ref a) if a == "spark"));
    }

    #[test]
    fn missing_profile_or_target_is_not_found() {
        let missing = ProfileConnectionMapper::map(PROFILES, "nope", None).unwrap_err();
        assert!(matches!(missing, PrefillError::NotFound(_)));
        let target = ProfileConnectionMapper::map(PROFILES, "shop", Some("qa")).unwrap_err();
        assert!(matches!(target, PrefillError::NotFound(_)));
    }

    #[test]
    fn profiles_path_prefers_env_then_project() {
        let dir = tempfile::tempdir().unwrap();
        let env = ProfileConnectionMapper::profiles_path(dir.path(), Some("/env".into()));
        assert_eq!(env, Some(PathBuf::from("/env").join(PROFILES_FILE)));
        fs::write(dir.path().join(PROFILES_FILE), PROFILES).unwrap();
        let local = ProfileConnectionMapper::profiles_path(dir.path(), None);
        assert_eq!(local, Some(dir.path().join(PROFILES_FILE)));
    }
}
