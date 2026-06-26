//! Pure conversions between DynamoDB `AttributeValue`s and the engine's
//! `QueryValue`, plus `serde_json::Value` bridging for nested maps/lists/sets.
//!
//! DynamoDB attributes are a tagged union (S, N, BOOL, NULL, B, M, L, SS, NS,
//! BS). Scalars map onto the matching `QueryValue`; numbers that fit an `i64`
//! become `Int`, the rest stay exact as `Decimal` (DynamoDB numbers carry up to
//! 38 digits of precision, so they must never round-trip through `f64`).
//! Composite attributes (maps, lists, sets) have no flat `QueryValue`, so they
//! are rendered as a JSON string and surfaced as `QueryValue::Json`.

use std::collections::HashMap;

use aws_sdk_dynamodb::primitives::Blob;
use aws_sdk_dynamodb::types::AttributeValue;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde_json::{Map as JsonMap, Number, Value as Json};

use crate::QueryValue;

/// Parses a DynamoDB number string into the most faithful `QueryValue`: an
/// `Int` when it fits `i64`, otherwise an exact `Decimal` (digits preserved).
fn number_to_value(n: &str) -> QueryValue {
    if let Ok(i) = n.parse::<i64>() {
        QueryValue::Int(i)
    } else {
        QueryValue::Decimal(n.to_owned())
    }
}

/// Parses a DynamoDB number string into a JSON number, falling back to a string
/// when it cannot be represented (e.g. precision beyond `f64`).
fn number_to_json(n: &str) -> Json {
    if let Ok(i) = n.parse::<i64>() {
        Json::Number(Number::from(i))
    } else if let Ok(f) = n.parse::<f64>() {
        Number::from_f64(f).map(Json::Number).unwrap_or_else(|| Json::String(n.to_owned()))
    } else {
        Json::String(n.to_owned())
    }
}

/// Recursively renders an `AttributeValue` as a `serde_json::Value` so composite
/// attributes can be carried inside `QueryValue::Json`. Binary is base64-encoded.
fn attr_to_json(av: &AttributeValue) -> Json {
    match av {
        AttributeValue::S(s) => Json::String(s.clone()),
        AttributeValue::N(n) => number_to_json(n),
        AttributeValue::Bool(b) => Json::Bool(*b),
        AttributeValue::Null(_) => Json::Null,
        AttributeValue::B(b) => Json::String(BASE64.encode(b.as_ref())),
        AttributeValue::M(m) => {
            let mut obj = JsonMap::new();
            for (k, v) in m {
                obj.insert(k.clone(), attr_to_json(v));
            }
            Json::Object(obj)
        }
        AttributeValue::L(l) => Json::Array(l.iter().map(attr_to_json).collect()),
        AttributeValue::Ss(ss) => Json::Array(ss.iter().map(|s| Json::String(s.clone())).collect()),
        AttributeValue::Ns(ns) => Json::Array(ns.iter().map(|n| number_to_json(n)).collect()),
        AttributeValue::Bs(bs) => {
            Json::Array(bs.iter().map(|b| Json::String(BASE64.encode(b.as_ref()))).collect())
        }
        // `AttributeValue` is `#[non_exhaustive]`; unknown future kinds render null.
        _ => Json::Null,
    }
}

/// Maps an `AttributeValue` onto a flat `QueryValue` for tabular display.
/// Composite kinds collapse to a `Json` string.
fn attr_to_query_value(av: &AttributeValue) -> QueryValue {
    match av {
        AttributeValue::S(s) => QueryValue::Text(s.clone()),
        AttributeValue::N(n) => number_to_value(n),
        AttributeValue::Bool(b) => QueryValue::Bool(*b),
        AttributeValue::Null(_) => QueryValue::Null,
        AttributeValue::B(b) => QueryValue::Data(b.as_ref().to_vec()),
        AttributeValue::M(_)
        | AttributeValue::L(_)
        | AttributeValue::Ss(_)
        | AttributeValue::Ns(_)
        | AttributeValue::Bs(_) => {
            QueryValue::Json(serde_json::to_string(&attr_to_json(av)).unwrap_or_default())
        }
        _ => QueryValue::Null,
    }
}

/// Recursively builds an `AttributeValue` from a `serde_json::Value` (the inverse
/// of [`attr_to_json`], used when a `QueryValue::Json` is written back).
fn json_to_attr(v: &Json) -> AttributeValue {
    match v {
        Json::Null => AttributeValue::Null(true),
        Json::Bool(b) => AttributeValue::Bool(*b),
        Json::Number(n) => AttributeValue::N(n.to_string()),
        Json::String(s) => AttributeValue::S(s.clone()),
        Json::Array(a) => AttributeValue::L(a.iter().map(json_to_attr).collect()),
        Json::Object(o) => {
            let mut m = HashMap::with_capacity(o.len());
            for (k, val) in o {
                m.insert(k.clone(), json_to_attr(val));
            }
            AttributeValue::M(m)
        }
    }
}

/// Maps a `QueryValue` onto an `AttributeValue` for writes (`PutItem`,
/// `UpdateItem`, `DeleteItem` keys, PartiQL parameters). A `Json` value is
/// reparsed so nested maps/lists round-trip; if it is not valid JSON it is
/// stored as a string.
fn query_value_to_attr(v: &QueryValue) -> AttributeValue {
    match v {
        QueryValue::Null => AttributeValue::Null(true),
        QueryValue::Bool(b) => AttributeValue::Bool(*b),
        QueryValue::Int(i) => AttributeValue::N(i.to_string()),
        QueryValue::Double(d) => AttributeValue::N(d.to_string()),
        QueryValue::Decimal(s) => AttributeValue::N(s.clone()),
        QueryValue::Text(s) => AttributeValue::S(s.clone()),
        QueryValue::Data(bytes) => AttributeValue::B(Blob::new(bytes.clone())),
        QueryValue::Json(s) => match serde_json::from_str::<Json>(s) {
            Ok(parsed) => json_to_attr(&parsed),
            Err(_) => AttributeValue::S(s.clone()),
        },
    }
}

/// Friendly type name for an `AttributeValue`, used as the displayed column type
/// in query results and the schema browser (DynamoDB has no declared column
/// types, so the type is read off the value itself).
fn attr_type_name(av: &AttributeValue) -> &'static str {
    match av {
        AttributeValue::S(_) => "string",
        AttributeValue::N(_) => "number",
        AttributeValue::Bool(_) => "boolean",
        AttributeValue::Null(_) => "null",
        AttributeValue::B(_) => "binary",
        AttributeValue::M(_) => "map",
        AttributeValue::L(_) => "list",
        AttributeValue::Ss(_) => "string set",
        AttributeValue::Ns(_) => "number set",
        AttributeValue::Bs(_) => "binary set",
        _ => "unknown",
    }
}

pub(super) use self::exports::*;

mod exports {
    use super::*;

    /// See [`super::attr_to_query_value`].
    pub(in crate::drivers::dynamodb) fn item_value(av: &AttributeValue) -> QueryValue {
        attr_to_query_value(av)
    }

    /// See [`super::query_value_to_attr`].
    pub(in crate::drivers::dynamodb) fn attr_value(v: &QueryValue) -> AttributeValue {
        query_value_to_attr(v)
    }

    /// See [`super::attr_type_name`].
    pub(in crate::drivers::dynamodb) fn type_name(av: &AttributeValue) -> &'static str {
        attr_type_name(av)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn string_maps_to_text() {
        let av = AttributeValue::S("hello".into());
        assert_eq!(item_value(&av), QueryValue::Text("hello".into()));
    }

    #[test]
    fn integer_number_maps_to_int() {
        let av = AttributeValue::N("42".into());
        assert_eq!(item_value(&av), QueryValue::Int(42));
        let neg = AttributeValue::N("-7".into());
        assert_eq!(item_value(&neg), QueryValue::Int(-7));
    }

    #[test]
    fn high_precision_number_stays_decimal() {
        // 38-digit DynamoDB number cannot fit i64 — must survive exactly.
        let big = "123456789012345678901234567890";
        let av = AttributeValue::N(big.into());
        assert_eq!(item_value(&av), QueryValue::Decimal(big.into()));
    }

    #[test]
    fn fractional_number_stays_decimal() {
        let av = AttributeValue::N("3.14".into());
        assert_eq!(item_value(&av), QueryValue::Decimal("3.14".into()));
    }

    #[test]
    fn bool_and_null_map_directly() {
        assert_eq!(item_value(&AttributeValue::Bool(true)), QueryValue::Bool(true));
        assert_eq!(item_value(&AttributeValue::Null(true)), QueryValue::Null);
    }

    #[test]
    fn binary_maps_to_data() {
        let av = AttributeValue::B(Blob::new(vec![0xde, 0xad]));
        assert_eq!(item_value(&av), QueryValue::Data(vec![0xde, 0xad]));
    }

    #[test]
    fn map_renders_as_json_object() {
        let mut m = HashMap::new();
        m.insert("name".to_owned(), AttributeValue::S("alice".into()));
        m.insert("age".to_owned(), AttributeValue::N("30".into()));
        let QueryValue::Json(s) = item_value(&AttributeValue::M(m)) else {
            panic!("expected Json");
        };
        let parsed: Json = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed["name"], Json::String("alice".into()));
        assert_eq!(parsed["age"], Json::Number(30.into()));
    }

    #[test]
    fn list_renders_as_json_array() {
        let l = AttributeValue::L(vec![
            AttributeValue::N("1".into()),
            AttributeValue::S("x".into()),
        ]);
        let QueryValue::Json(s) = item_value(&l) else { panic!("expected Json") };
        assert_eq!(s, r#"[1,"x"]"#);
    }

    #[test]
    fn string_set_renders_as_json_array() {
        let ss = AttributeValue::Ss(vec!["a".into(), "b".into()]);
        let QueryValue::Json(s) = item_value(&ss) else { panic!("expected Json") };
        assert_eq!(s, r#"["a","b"]"#);
    }

    #[test]
    fn binary_set_renders_base64_array() {
        let bs = AttributeValue::Bs(vec![Blob::new(vec![0x01]), Blob::new(vec![0x02])]);
        let QueryValue::Json(s) = item_value(&bs) else { panic!("expected Json") };
        let parsed: Json = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed, Json::Array(vec![
            Json::String(BASE64.encode([0x01])),
            Json::String(BASE64.encode([0x02])),
        ]));
    }

    #[test]
    fn write_scalars_map_to_attribute_values() {
        assert!(matches!(attr_value(&QueryValue::Null), AttributeValue::Null(true)));
        assert!(matches!(attr_value(&QueryValue::Bool(false)), AttributeValue::Bool(false)));
        match attr_value(&QueryValue::Int(5)) {
            AttributeValue::N(n) => assert_eq!(n, "5"),
            other => panic!("expected N, got {other:?}"),
        }
        match attr_value(&QueryValue::Decimal("9.99".into())) {
            AttributeValue::N(n) => assert_eq!(n, "9.99"),
            other => panic!("expected N, got {other:?}"),
        }
        match attr_value(&QueryValue::Text("hi".into())) {
            AttributeValue::S(s) => assert_eq!(s, "hi"),
            other => panic!("expected S, got {other:?}"),
        }
    }

    #[test]
    fn write_data_maps_to_blob() {
        match attr_value(&QueryValue::Data(vec![0x01, 0x02])) {
            AttributeValue::B(b) => assert_eq!(b.as_ref(), &[0x01, 0x02]),
            other => panic!("expected B, got {other:?}"),
        }
    }

    #[test]
    fn write_json_object_maps_to_attribute_map() {
        let v = QueryValue::Json(r#"{"k":1,"nested":{"a":"b"}}"#.into());
        match attr_value(&v) {
            AttributeValue::M(m) => {
                assert!(matches!(m.get("k"), Some(AttributeValue::N(n)) if n == "1"));
                assert!(matches!(m.get("nested"), Some(AttributeValue::M(_))));
            }
            other => panic!("expected M, got {other:?}"),
        }
    }

    #[test]
    fn write_json_array_maps_to_list() {
        let v = QueryValue::Json("[1,2,3]".into());
        match attr_value(&v) {
            AttributeValue::L(l) => assert_eq!(l.len(), 3),
            other => panic!("expected L, got {other:?}"),
        }
    }

    #[test]
    fn write_invalid_json_falls_back_to_string() {
        let v = QueryValue::Json("{not json".into());
        match attr_value(&v) {
            AttributeValue::S(s) => assert_eq!(s, "{not json"),
            other => panic!("expected S, got {other:?}"),
        }
    }

    #[test]
    fn type_name_labels_each_kind() {
        assert_eq!(type_name(&AttributeValue::S("x".into())), "string");
        assert_eq!(type_name(&AttributeValue::N("1".into())), "number");
        assert_eq!(type_name(&AttributeValue::Bool(true)), "boolean");
        assert_eq!(type_name(&AttributeValue::Null(true)), "null");
        assert_eq!(type_name(&AttributeValue::B(Blob::new(vec![1]))), "binary");
        assert_eq!(type_name(&AttributeValue::M(HashMap::new())), "map");
        assert_eq!(type_name(&AttributeValue::L(vec![])), "list");
        assert_eq!(type_name(&AttributeValue::Ss(vec!["a".into()])), "string set");
        assert_eq!(type_name(&AttributeValue::Ns(vec!["1".into()])), "number set");
        assert_eq!(type_name(&AttributeValue::Bs(vec![Blob::new(vec![1])])), "binary set");
    }

    #[test]
    fn round_trips_nested_map() {
        let mut m = HashMap::new();
        m.insert("id".to_owned(), AttributeValue::N("1".into()));
        let mut inner = HashMap::new();
        inner.insert("city".to_owned(), AttributeValue::S("NYC".into()));
        m.insert("addr".to_owned(), AttributeValue::M(inner));
        let original = AttributeValue::M(m);

        let qv = item_value(&original);
        let back = attr_value(&qv);
        match back {
            AttributeValue::M(m) => {
                assert!(matches!(m.get("id"), Some(AttributeValue::N(n)) if n == "1"));
                assert!(matches!(m.get("addr"), Some(AttributeValue::M(_))));
            }
            other => panic!("expected M, got {other:?}"),
        }
    }
}
