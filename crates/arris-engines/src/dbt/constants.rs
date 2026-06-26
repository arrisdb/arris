/// Manifest schema major versions this parser has been tested against.
///
/// `manifest.json`'s `metadata.dbt_schema_version` looks like
/// `https://schemas.getdbt.com/dbt/manifest/v12.json`. Versions outside this
/// range still parse (every field is optional) but the viewer surfaces a
/// non-blocking warning. Extend this list as new dbt releases are validated.
pub(super) const SUPPORTED_MANIFEST_SCHEMA_VERSIONS: &[u32] = &[10, 11, 12];
