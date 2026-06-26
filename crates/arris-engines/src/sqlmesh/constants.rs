/// Top-level config keys that only a genuine SQLMesh `config.yaml` carries.
///
/// SQLMesh accepts a config with no `project` field, but every real project
/// declares at least one of these (a gateway, a default gateway/connection, or
/// `model_defaults`). The generic `project` key is deliberately excluded: a
/// plain app `config.yaml` (e.g. a Python tool) is valid YAML and may well have
/// `project:`, which is exactly the false positive this list prevents.
pub(super) const SQLMESH_CONFIG_MARKER_KEYS: &[&str] = &[
    "gateways",
    "default_gateway",
    "model_defaults",
    "default_connection",
    "default_test_connection",
    "default_scheduler",
    "model_naming",
    "physical_schema_mapping",
    "snapshot_ttl",
    "linter",
    "notification_targets",
    "before_all",
    "after_all",
];
