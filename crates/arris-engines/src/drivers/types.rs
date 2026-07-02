use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── QueryValue ──────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "lowercase")]
pub enum QueryValue {
    Null,
    Bool(bool),
    Int(i64),
    Double(f64),
    Text(String),
    Data(#[serde(with = "hex_bytes")] Vec<u8>),
    Json(String),
    /// An exact decimal (e.g. SQL `NUMERIC`/`DECIMAL`) carried as its literal
    /// digit string. Kept as a string — never `f64` — so arbitrary precision
    /// survives; the row-detail view renders it as an unquoted JSON number.
    Decimal(String),
}

impl QueryValue {
    pub fn display_string(&self) -> String {
        match self {
            Self::Null => "NULL".to_owned(),
            Self::Bool(true) => "true".to_owned(),
            Self::Bool(false) => "false".to_owned(),
            Self::Int(v) => v.to_string(),
            Self::Double(v) => v.to_string(),
            Self::Text(v) => v.clone(),
            Self::Data(d) => {
                let mut out = String::with_capacity(2 + d.len() * 2);
                out.push_str("0x");
                for b in d {
                    use std::fmt::Write;
                    write!(out, "{b:02x}").unwrap();
                }
                out
            }
            Self::Json(s) => s.clone(),
            Self::Decimal(s) => s.clone(),
        }
    }

    pub fn is_null(&self) -> bool {
        matches!(self, Self::Null)
    }

    pub fn coerce_text(self) -> Self {
        let s = match &self {
            Self::Text(s) => s.as_str(),
            _ => return self,
        };
        if s.is_empty() || s.eq_ignore_ascii_case("null") {
            return Self::Null;
        }
        match s.to_lowercase().as_str() {
            "true" => return Self::Bool(true),
            "false" => return Self::Bool(false),
            _ => {}
        }
        if let Ok(i) = s.parse::<i64>() {
            return Self::Int(i);
        }
        if let Ok(f) = s.parse::<f64>() {
            if s.contains('.') || s.contains('e') || s.contains('E') {
                return Self::Double(f);
            }
        }
        if (s.starts_with('{') && s.ends_with('}'))
            || (s.starts_with('[') && s.ends_with(']'))
        {
            if serde_json::from_str::<serde_json::Value>(s).is_ok() {
                return Self::Json(s.to_owned());
            }
        }
        self
    }
}

mod hex_bytes {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(bytes: &[u8], s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut out = String::with_capacity(bytes.len() * 2);
        for b in bytes {
            use std::fmt::Write;
            write!(out, "{b:02x}").unwrap();
        }
        s.serialize_str(&out)
    }

    pub fn deserialize<'de, D>(d: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(d)?;
        if s.len() % 2 != 0 {
            return Err(serde::de::Error::custom("hex string must have even length"));
        }
        (0..s.len())
            .step_by(2)
            .map(|i| {
                u8::from_str_radix(&s[i..i + 2], 16)
                    .map_err(|e| serde::de::Error::custom(e.to_string()))
            })
            .collect()
    }
}

// ── ColumnSpec / StatementType / QueryResult ────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnSpec {
    pub name: String,
    pub type_hint: String,
}

impl ColumnSpec {
    pub fn new(name: impl Into<String>, type_hint: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            type_hint: type_hint.into(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StatementType {
    #[default]
    Query,
    Mutation,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnSpec>,
    pub rows: Vec<Vec<QueryValue>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows_affected: Option<i64>,
    #[serde(default)]
    pub elapsed: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_more: Option<bool>,
    #[serde(default)]
    pub statement_type: StatementType,
}

impl QueryResult {
    pub fn new(columns: Vec<ColumnSpec>, rows: Vec<Vec<QueryValue>>) -> Self {
        Self {
            columns,
            rows,
            rows_affected: None,
            elapsed: 0.0,
            ..Default::default()
        }
    }

    pub fn empty() -> Self {
        Self::new(Vec::new(), Vec::new())
    }
}

// ── ExplainMode / QueryLanguage / SqlDialect ────────────────────────────────

#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExplainMode {
    DryRun,
    Analyze,
}

#[derive(Copy, Clone, Debug, Default, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QueryLanguage {
    #[default]
    Native,
    Sql,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SqlDialect {
    Postgres,
    Mysql,
    Sqlite,
    Mongodb,
    Bigquery,
    Redshift,
    Snowflake,
    Mssql,
    Oracle,
    Duckdb,
    Clickhouse,
    Elasticsearch,
}

// ── TransactionMode / IsolationLevel ─────────────────────────────────────────

/// How statements are committed for a connection. `Auto` commits every
/// statement immediately (server default); `Manual` opens a transaction on the
/// first statement and waits for an explicit commit/rollback.
#[derive(Copy, Clone, Debug, Default, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransactionMode {
    #[default]
    Auto,
    Manual,
}

/// SQL transaction isolation level. `Default` leaves the server's configured
/// level untouched (no `ISOLATION LEVEL` clause emitted).
#[derive(Copy, Clone, Debug, Default, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IsolationLevel {
    #[default]
    Default,
    ReadCommitted,
    RepeatableRead,
    Serializable,
}

impl IsolationLevel {
    /// The SQL spelling of this level (e.g. `READ COMMITTED`), or `None` for
    /// `Default` (meaning: emit no `ISOLATION LEVEL` clause). The spelling is
    /// identical across Postgres and MySQL.
    pub fn sql_name(self) -> Option<&'static str> {
        match self {
            Self::Default => None,
            Self::ReadCommitted => Some("READ COMMITTED"),
            Self::RepeatableRead => Some("REPEATABLE READ"),
            Self::Serializable => Some("SERIALIZABLE"),
        }
    }
}

// ── SchemaNode / SchemaNodeKind / TableRef ───────────────────────────────────

#[derive(Copy, Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SchemaNodeKind {
    Database,
    Schema,
    Table,
    View,
    MaterializedView,
    ForeignTable,
    Collection,
    Column,
    Index,
    Sequence,
    Function,
    Procedure,
    Trigger,
    Event,
    Type,
    Key,
    RedisStringKey,
    RedisListKey,
    RedisSetKey,
    RedisHashKey,
    RedisZsetKey,
    RedisStreamKey,
    ElasticsearchIndex,
    ElasticsearchAlias,
    ElasticsearchIndexTemplate,
    ElasticsearchDataStream,
    Topic,
    ConsumerGroup,
    Group,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SchemaNode {
    pub name: String,
    pub kind: SchemaNodeKind,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default)]
    pub children: Vec<SchemaNode>,
}

impl SchemaNode {
    pub fn new(name: impl Into<String>, kind: SchemaNodeKind, path: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            kind,
            path: path.into(),
            detail: None,
            children: Vec::new(),
        }
    }

    pub fn with_children(mut self, children: Vec<SchemaNode>) -> Self {
        self.children = children;
        self
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn id(&self) -> &str {
        &self.path
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TableRef {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    pub name: String,
}

impl TableRef {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            database: None,
            schema: None,
            name: name.into(),
        }
    }

    pub fn schema_qualified(schema: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            database: None,
            schema: Some(schema.into()),
            name: name.into(),
        }
    }

    pub fn fully_qualified(
        database: impl Into<String>,
        schema: impl Into<String>,
        name: impl Into<String>,
    ) -> Self {
        Self {
            database: Some(database.into()),
            schema: Some(schema.into()),
            name: name.into(),
        }
    }

    pub fn dotted(&self) -> String {
        match (&self.database, &self.schema) {
            (Some(d), Some(s)) => format!("{d}.{s}.{}", self.name),
            (None, Some(s)) => format!("{s}.{}", self.name),
            (None, None) | (Some(_), None) => self.name.clone(),
        }
    }
}

// ── ObjectRef ────────────────────────────────────────────────────────────────

/// Identifies a single schema object whose DDL / definition is requested
/// (e.g. for the "Show Definition" command). `kind` selects which catalog the
/// driver consults; `database`/`schema` qualify the object when the source
/// nests objects under them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectRef {
    pub kind: SchemaNodeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    pub name: String,
}

impl ObjectRef {
    pub fn new(kind: SchemaNodeKind, name: impl Into<String>) -> Self {
        Self {
            kind,
            database: None,
            schema: None,
            name: name.into(),
        }
    }

    /// Like `new`, but qualified by a schema (e.g. Postgres/DuckDB `main`).
    pub fn with_schema(
        kind: SchemaNodeKind,
        schema: impl Into<String>,
        name: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            database: None,
            schema: Some(schema.into()),
            name: name.into(),
        }
    }

    /// The object viewed as a `TableRef` (same database/schema/name), useful
    /// for table-shaped objects.
    pub fn as_table_ref(&self) -> TableRef {
        TableRef {
            database: self.database.clone(),
            schema: self.schema.clone(),
            name: self.name.clone(),
        }
    }
}

// ── PlanAttribute / PlanNode / PlanResult ────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlanAttribute {
    #[serde(default = "Uuid::new_v4")]
    pub id: Uuid,
    pub key: String,
    pub value: String,
}

impl PlanAttribute {
    pub fn new(key: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4(),
            key: key.into(),
            value: value.into(),
        }
    }
}

impl PartialEq for PlanAttribute {
    fn eq(&self, other: &Self) -> bool {
        self.key == other.key && self.value == other.value
    }
}

impl Eq for PlanAttribute {}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlanNode {
    #[serde(default = "Uuid::new_v4")]
    pub id: Uuid,
    pub label: String,
    pub node_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub self_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows_actual: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows_estimated: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_total: Option<f64>,
    #[serde(default)]
    pub attributes: Vec<PlanAttribute>,
    #[serde(default)]
    pub children: Vec<PlanNode>,
}

impl PlanNode {
    pub fn new(label: impl Into<String>, node_type: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4(),
            label: label.into(),
            node_type: node_type.into(),
            total_ms: None,
            self_ms: None,
            rows_actual: None,
            rows_estimated: None,
            cost_total: None,
            attributes: Vec::new(),
            children: Vec::new(),
        }
    }

    pub fn derived_self_ms(&self) -> Option<f64> {
        if let Some(s) = self.self_ms {
            return Some(s);
        }
        let total = self.total_ms?;
        let child_total: f64 = self
            .children
            .iter()
            .filter_map(|c| c.total_ms)
            .sum();
        Some((total - child_total).max(0.0))
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlanResult {
    pub root: PlanNode,
    pub mode: ExplainMode,
    pub raw: String,
}

impl PlanResult {
    pub fn new(root: PlanNode, mode: ExplainMode, raw: impl Into<String>) -> Self {
        Self {
            root,
            mode,
            raw: raw.into(),
        }
    }

    pub fn total_ms(&self) -> Option<f64> {
        self.root.total_ms
    }
}

// ── Row Mutation Types ──────────────────────────────────────────────────────

pub type ValueMap = IndexMap<String, QueryValue>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RowEdit {
    pub primary_key: ValueMap,
    pub changes: ValueMap,
}

impl RowEdit {
    pub fn new(primary_key: ValueMap, changes: ValueMap) -> Self {
        Self { primary_key, changes }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RowInsert {
    pub values: ValueMap,
}

impl RowInsert {
    pub fn new(values: ValueMap) -> Self {
        Self { values }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RowDelete {
    pub primary_key: ValueMap,
}

impl RowDelete {
    pub fn new(primary_key: ValueMap) -> Self {
        Self { primary_key }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct MutationResult {
    pub rows_affected: usize,
    pub statements: Vec<String>,
}

impl MutationResult {
    pub fn merge(&mut self, other: MutationResult) {
        self.rows_affected += other.rows_affected;
        self.statements.extend(other.statements);
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TableMutationBatch {
    #[serde(default)]
    pub updates: Vec<RowEdit>,
    #[serde(default)]
    pub inserts: Vec<RowInsert>,
    #[serde(default)]
    pub deletes: Vec<RowDelete>,
}

impl TableMutationBatch {
    pub fn is_empty(&self) -> bool {
        self.updates.is_empty() && self.inserts.is_empty() && self.deletes.is_empty()
    }

    pub fn total_count(&self) -> usize {
        self.updates.len() + self.inserts.len() + self.deletes.len()
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_string_null_bool_int_double_text() {
        assert_eq!(QueryValue::Null.display_string(), "NULL");
        assert_eq!(QueryValue::Bool(true).display_string(), "true");
        assert_eq!(QueryValue::Bool(false).display_string(), "false");
        assert_eq!(QueryValue::Int(42).display_string(), "42");
        assert_eq!(QueryValue::Double(1.5).display_string(), "1.5");
        assert_eq!(QueryValue::Text("hello".into()).display_string(), "hello");
    }

    #[test]
    fn display_string_data_uses_lowercase_hex_with_prefix() {
        let v = QueryValue::Data(vec![0xde, 0xad, 0xbe, 0xef]);
        assert_eq!(v.display_string(), "0xdeadbeef");
    }

    #[test]
    fn display_string_json_passthrough() {
        let v = QueryValue::Json("{\"a\":1}".into());
        assert_eq!(v.display_string(), "{\"a\":1}");
    }

    #[test]
    fn is_null_helper() {
        assert!(QueryValue::Null.is_null());
        assert!(!QueryValue::Int(0).is_null());
    }

    #[test]
    fn json_round_trip_preserves_kind() {
        let v = QueryValue::Int(7);
        let s = serde_json::to_string(&v).unwrap();
        assert_eq!(s, r#"{"kind":"int","value":7}"#);
        let back: QueryValue = serde_json::from_str(&s).unwrap();
        assert_eq!(back, v);
    }

    #[test]
    fn decimal_serializes_as_decimal_kind_and_displays_digits() {
        let v = QueryValue::Decimal("129.00".into());
        assert_eq!(v.display_string(), "129.00");
        let s = serde_json::to_string(&v).unwrap();
        assert_eq!(s, r#"{"kind":"decimal","value":"129.00"}"#);
        let back: QueryValue = serde_json::from_str(&s).unwrap();
        assert_eq!(back, v);
    }

    #[test]
    fn json_round_trip_for_data_uses_hex_string() {
        let v = QueryValue::Data(vec![0x01, 0x02, 0xff]);
        let s = serde_json::to_string(&v).unwrap();
        assert_eq!(s, r#"{"kind":"data","value":"0102ff"}"#);
        let back: QueryValue = serde_json::from_str(&s).unwrap();
        assert_eq!(back, v);
    }

    #[test]
    fn column_spec_from_json() {
        let spec: ColumnSpec =
            serde_json::from_str(r#"{"name":"x","type_hint":"int4"}"#).unwrap();
        assert_eq!(spec.name, "x");
        assert_eq!(spec.type_hint, "int4");
    }

    #[test]
    fn empty_query_result_is_empty() {
        let r = QueryResult::empty();
        assert!(r.columns.is_empty());
        assert!(r.rows.is_empty());
        assert_eq!(r.rows_affected, None);
        assert_eq!(r.elapsed, 0.0);
    }

    #[test]
    fn coerce_text_bool() {
        assert_eq!(QueryValue::Text("true".into()).coerce_text(), QueryValue::Bool(true));
        assert_eq!(QueryValue::Text("false".into()).coerce_text(), QueryValue::Bool(false));
        assert_eq!(QueryValue::Text("TRUE".into()).coerce_text(), QueryValue::Bool(true));
        assert_eq!(QueryValue::Text("False".into()).coerce_text(), QueryValue::Bool(false));
    }

    #[test]
    fn coerce_text_int() {
        assert_eq!(QueryValue::Text("42".into()).coerce_text(), QueryValue::Int(42));
        assert_eq!(QueryValue::Text("-7".into()).coerce_text(), QueryValue::Int(-7));
        assert_eq!(QueryValue::Text("0".into()).coerce_text(), QueryValue::Int(0));
    }

    #[test]
    fn coerce_text_double() {
        assert_eq!(QueryValue::Text("3.14".into()).coerce_text(), QueryValue::Double(3.14));
        assert_eq!(QueryValue::Text("1e10".into()).coerce_text(), QueryValue::Double(1e10));
    }

    #[test]
    fn coerce_text_null() {
        assert_eq!(QueryValue::Text("".into()).coerce_text(), QueryValue::Null);
        assert_eq!(QueryValue::Text("null".into()).coerce_text(), QueryValue::Null);
        assert_eq!(QueryValue::Text("NULL".into()).coerce_text(), QueryValue::Null);
    }

    #[test]
    fn coerce_text_json() {
        assert_eq!(
            QueryValue::Text(r#"{"a":1}"#.into()).coerce_text(),
            QueryValue::Json(r#"{"a":1}"#.into()),
        );
        assert_eq!(
            QueryValue::Text("[1,2]".into()).coerce_text(),
            QueryValue::Json("[1,2]".into()),
        );
    }

    #[test]
    fn coerce_text_passthrough() {
        assert_eq!(
            QueryValue::Text("hello".into()).coerce_text(),
            QueryValue::Text("hello".into()),
        );
    }

    #[test]
    fn coerce_non_text_passthrough() {
        assert_eq!(QueryValue::Int(5).coerce_text(), QueryValue::Int(5));
        assert_eq!(QueryValue::Bool(true).coerce_text(), QueryValue::Bool(true));
        assert_eq!(QueryValue::Null.coerce_text(), QueryValue::Null);
    }

    #[test]
    fn explain_mode_camel_case_serialization() {
        assert_eq!(serde_json::to_string(&ExplainMode::DryRun).unwrap(), "\"dryRun\"");
        assert_eq!(serde_json::to_string(&ExplainMode::Analyze).unwrap(), "\"analyze\"");
    }

    #[test]
    fn query_language_round_trip() {
        assert_eq!(serde_json::to_string(&QueryLanguage::Native).unwrap(), "\"native\"");
        assert_eq!(serde_json::to_string(&QueryLanguage::Sql).unwrap(), "\"sql\"");
        assert_eq!(QueryLanguage::default(), QueryLanguage::Native);
    }

    #[test]
    fn sql_dialect_round_trip() {
        for variant in [
            SqlDialect::Postgres, SqlDialect::Mysql, SqlDialect::Sqlite,
            SqlDialect::Mongodb, SqlDialect::Bigquery,
            SqlDialect::Redshift, SqlDialect::Snowflake, SqlDialect::Mssql,
            SqlDialect::Oracle, SqlDialect::Duckdb, SqlDialect::Clickhouse,
            SqlDialect::Elasticsearch,
        ] {
            let s = serde_json::to_string(&variant).unwrap();
            let back: SqlDialect = serde_json::from_str(&s).unwrap();
            assert_eq!(variant, back);
        }
    }

    #[test]
    fn isolation_level_sql_names() {
        assert_eq!(IsolationLevel::Default.sql_name(), None);
        assert_eq!(IsolationLevel::ReadCommitted.sql_name(), Some("READ COMMITTED"));
        assert_eq!(IsolationLevel::RepeatableRead.sql_name(), Some("REPEATABLE READ"));
        assert_eq!(IsolationLevel::Serializable.sql_name(), Some("SERIALIZABLE"));
    }

    #[test]
    fn transaction_mode_defaults_to_auto_and_round_trips() {
        assert_eq!(TransactionMode::default(), TransactionMode::Auto);
        assert_eq!(serde_json::to_string(&TransactionMode::Auto).unwrap(), "\"auto\"");
        assert_eq!(serde_json::to_string(&TransactionMode::Manual).unwrap(), "\"manual\"");
    }

    #[test]
    fn isolation_level_camel_case_serialization() {
        assert_eq!(IsolationLevel::default(), IsolationLevel::Default);
        assert_eq!(serde_json::to_string(&IsolationLevel::Default).unwrap(), "\"default\"");
        assert_eq!(serde_json::to_string(&IsolationLevel::ReadCommitted).unwrap(), "\"readCommitted\"");
        assert_eq!(serde_json::to_string(&IsolationLevel::RepeatableRead).unwrap(), "\"repeatableRead\"");
        assert_eq!(serde_json::to_string(&IsolationLevel::Serializable).unwrap(), "\"serializable\"");
    }

    #[test]
    fn schema_node_id_equals_path() {
        let n = SchemaNode::new("users", SchemaNodeKind::Table, "db.public.users");
        assert_eq!(n.id(), "db.public.users");
    }

    #[test]
    fn schema_node_detail_and_children_optional_in_json() {
        let n = SchemaNode::new("users", SchemaNodeKind::Table, "p.users");
        let s = serde_json::to_string(&n).unwrap();
        assert_eq!(s, r#"{"name":"users","kind":"table","path":"p.users","children":[]}"#);
    }

    #[test]
    fn schema_node_kind_camel_case_for_compound_variants() {
        assert_eq!(serde_json::to_string(&SchemaNodeKind::MaterializedView).unwrap(), "\"materializedView\"");
        assert_eq!(serde_json::to_string(&SchemaNodeKind::ForeignTable).unwrap(), "\"foreignTable\"");
        assert_eq!(serde_json::to_string(&SchemaNodeKind::ConsumerGroup).unwrap(), "\"consumerGroup\"");
        assert_eq!(serde_json::to_string(&SchemaNodeKind::RedisStringKey).unwrap(), "\"redisStringKey\"");
        assert_eq!(serde_json::to_string(&SchemaNodeKind::RedisZsetKey).unwrap(), "\"redisZsetKey\"");
        assert_eq!(serde_json::to_string(&SchemaNodeKind::ElasticsearchIndex).unwrap(), "\"elasticsearchIndex\"");
        assert_eq!(serde_json::to_string(&SchemaNodeKind::ElasticsearchAlias).unwrap(), "\"elasticsearchAlias\"");
        assert_eq!(serde_json::to_string(&SchemaNodeKind::ElasticsearchIndexTemplate).unwrap(), "\"elasticsearchIndexTemplate\"");
        assert_eq!(serde_json::to_string(&SchemaNodeKind::ElasticsearchDataStream).unwrap(), "\"elasticsearchDataStream\"");
    }

    #[test]
    fn table_ref_dotted_renders_correctly() {
        assert_eq!(TableRef::new("users").dotted(), "users");
        assert_eq!(TableRef::schema_qualified("public", "users").dotted(), "public.users");
        assert_eq!(TableRef::fully_qualified("app", "public", "users").dotted(), "app.public.users");
    }

    #[test]
    fn table_ref_omits_db_when_only_db_set() {
        let t = TableRef { database: Some("app".into()), schema: None, name: "users".into() };
        assert_eq!(t.dotted(), "users");
    }

    #[test]
    fn attribute_equality_ignores_id() {
        let a = PlanAttribute::new("k", "v");
        let b = PlanAttribute::new("k", "v");
        assert_eq!(a, b);
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn derived_self_ms_uses_self_when_present() {
        let mut n = PlanNode::new("Seq Scan", "SeqScan");
        n.self_ms = Some(7.0);
        n.total_ms = Some(20.0);
        assert_eq!(n.derived_self_ms(), Some(7.0));
    }

    #[test]
    fn derived_self_ms_subtracts_children_when_self_missing() {
        let mut child = PlanNode::new("Scan", "Scan");
        child.total_ms = Some(8.0);
        let mut parent = PlanNode::new("Hash Join", "HashJoin");
        parent.total_ms = Some(20.0);
        parent.children = vec![child];
        assert_eq!(parent.derived_self_ms(), Some(12.0));
    }

    #[test]
    fn derived_self_ms_clamps_at_zero() {
        let mut child = PlanNode::new("Scan", "Scan");
        child.total_ms = Some(50.0);
        let mut parent = PlanNode::new("Wrap", "Wrap");
        parent.total_ms = Some(10.0);
        parent.children = vec![child];
        assert_eq!(parent.derived_self_ms(), Some(0.0));
    }

    #[test]
    fn derived_self_ms_none_when_no_total() {
        let n = PlanNode::new("X", "X");
        assert_eq!(n.derived_self_ms(), None);
    }

    #[test]
    fn plan_result_total_passes_through_root() {
        let mut root = PlanNode::new("R", "R");
        root.total_ms = Some(42.0);
        let pr = PlanResult::new(root, ExplainMode::Analyze, "raw");
        assert_eq!(pr.total_ms(), Some(42.0));
    }

    fn pk(value: i64) -> ValueMap {
        let mut m = ValueMap::new();
        m.insert("id".into(), QueryValue::Int(value));
        m
    }

    #[test]
    fn empty_batch_is_empty_and_zero_count() {
        let b = TableMutationBatch::default();
        assert!(b.is_empty());
        assert_eq!(b.total_count(), 0);
    }

    #[test]
    fn batch_total_count_sums_all_kinds() {
        let mut updates = ValueMap::new();
        updates.insert("name".into(), QueryValue::Text("X".into()));
        let b = TableMutationBatch {
            updates: vec![RowEdit::new(pk(1), updates.clone())],
            inserts: vec![RowInsert::new(updates.clone()), RowInsert::new(updates)],
            deletes: vec![RowDelete::new(pk(2))],
        };
        assert!(!b.is_empty());
        assert_eq!(b.total_count(), 4);
    }

    #[test]
    fn value_map_preserves_insertion_order() {
        let mut m = ValueMap::new();
        m.insert("c".into(), QueryValue::Int(3));
        m.insert("a".into(), QueryValue::Int(1));
        m.insert("b".into(), QueryValue::Int(2));
        let keys: Vec<&String> = m.keys().collect();
        assert_eq!(keys, vec!["c", "a", "b"]);
    }
}
