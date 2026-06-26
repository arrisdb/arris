//! ClickHouse value decoding and literal formatting.
//!
//! Results come back as `JSONCompact`, whose `meta` array carries the ClickHouse
//! type string per column (e.g. `UInt64`, `Nullable(String)`, `Array(Int32)`).
//! `decode_cell` maps each JSON cell to a [`QueryValue`] using that type string,
//! unwrapping `Nullable(...)` / `LowCardinality(...)` wrappers first.
//!
//! ClickHouse renders 64-bit integers and `Decimal`s as JSON strings (to preserve
//! precision), so the integer path accepts both JSON numbers and numeric strings.

use serde_json::Value as Json;

use crate::QueryValue;

/// Strips `Nullable(...)` and `LowCardinality(...)` wrappers, returning the inner
/// base type. Applied repeatedly so `LowCardinality(Nullable(String))` resolves to
/// `String`.
fn unwrap_type(ch_type: &str) -> &str {
    let t = ch_type.trim();
    for wrapper in ["Nullable(", "LowCardinality("] {
        if let Some(rest) = t.strip_prefix(wrapper) {
            if let Some(inner) = rest.strip_suffix(')') {
                return unwrap_type(inner);
            }
        }
    }
    t
}

/// Coarse category for a base ClickHouse type, deciding which `QueryValue`
/// variant a cell maps to.
enum Category {
    Int,
    Float,
    Bool,
    /// Array / Map / Tuple / Nested — preserved as raw JSON.
    Json,
    /// String, FixedString, UUID, Date*, DateTime*, Enum*, IPv4/6, Decimal, …
    Text,
}

fn categorize(base: &str) -> Category {
    if base.starts_with("Int") || base.starts_with("UInt") {
        Category::Int
    } else if base.starts_with("Float") {
        Category::Float
    } else if base == "Bool" || base == "Boolean" {
        Category::Bool
    } else if base.starts_with("Array(")
        || base.starts_with("Map(")
        || base.starts_with("Tuple(")
        || base.starts_with("Nested(")
    {
        Category::Json
    } else {
        // Decimal(...), String, FixedString(N), UUID, Date, DateTime(64), Enum8/16,
        // IPv4, IPv6, and anything else fall through to text.
        Category::Text
    }
}

/// Decodes a single JSONCompact cell using its ClickHouse column type.
pub(super) fn decode_cell(ch_type: &str, v: &Json) -> QueryValue {
    if v.is_null() {
        return QueryValue::Null;
    }
    let base = unwrap_type(ch_type);
    match categorize(base) {
        Category::Int => {
            if let Some(i) = v.as_i64() {
                QueryValue::Int(i)
            } else if let Some(s) = v.as_str() {
                // 64-bit ints arrive quoted; UInt64 above i64::MAX stays text.
                s.parse::<i64>()
                    .map(QueryValue::Int)
                    .unwrap_or_else(|_| QueryValue::Text(s.to_owned()))
            } else {
                QueryValue::Text(v.to_string())
            }
        }
        Category::Float => {
            if let Some(f) = v.as_f64() {
                QueryValue::Double(f)
            } else if let Some(s) = v.as_str() {
                s.parse::<f64>()
                    .map(QueryValue::Double)
                    .unwrap_or_else(|_| QueryValue::Text(s.to_owned()))
            } else {
                QueryValue::Text(v.to_string())
            }
        }
        Category::Bool => match v.as_bool() {
            Some(b) => QueryValue::Bool(b),
            None => QueryValue::Text(v.to_string()),
        },
        Category::Json => QueryValue::Json(v.to_string()),
        Category::Text => match v.as_str() {
            Some(s) => QueryValue::Text(s.to_owned()),
            None => QueryValue::Text(v.to_string()),
        },
    }
}

/// Escapes a string for a single-quoted ClickHouse literal (`\` and `'`).
fn escape_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

/// Formats a [`QueryValue`] as an inline ClickHouse SQL literal. Used by the
/// staged-edit mutation builders, which inline values rather than bind them
/// (ClickHouse `ALTER ... UPDATE/DELETE` are issued as plain statements).
pub(super) fn format_literal(v: &QueryValue) -> String {
    match v {
        QueryValue::Null => "NULL".to_owned(),
        QueryValue::Bool(b) => {
            if *b {
                "1".to_owned()
            } else {
                "0".to_owned()
            }
        }
        QueryValue::Int(i) => i.to_string(),
        QueryValue::Double(f) => f.to_string(),
        QueryValue::Text(s) => format!("'{}'", escape_string(s)),
        QueryValue::Json(s) => format!("'{}'", escape_string(s)),
        QueryValue::Data(d) => {
            let hex: String = d.iter().map(|b| format!("{b:02x}")).collect();
            format!("unhex('{hex}')")
        }
        // Exact decimal: inline as a bare numeric literal (unquoted).
        QueryValue::Decimal(s) => s.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unwraps_nullable_and_lowcardinality() {
        assert_eq!(unwrap_type("Nullable(String)"), "String");
        assert_eq!(unwrap_type("LowCardinality(String)"), "String");
        assert_eq!(unwrap_type("LowCardinality(Nullable(UInt8))"), "UInt8");
        assert_eq!(unwrap_type("Array(Int32)"), "Array(Int32)");
    }

    #[test]
    fn decodes_integers_from_number_and_string() {
        assert_eq!(decode_cell("Int32", &json!(42)), QueryValue::Int(42));
        // 64-bit integers arrive as quoted strings.
        assert_eq!(decode_cell("UInt64", &json!("99")), QueryValue::Int(99));
    }

    #[test]
    fn huge_uint64_stays_text() {
        let big = "18446744073709551615"; // u64::MAX, > i64::MAX
        assert_eq!(
            decode_cell("UInt64", &json!(big)),
            QueryValue::Text(big.to_owned())
        );
    }

    #[test]
    fn decodes_float_bool_null() {
        assert_eq!(decode_cell("Float64", &json!(1.5)), QueryValue::Double(1.5));
        assert_eq!(decode_cell("Bool", &json!(true)), QueryValue::Bool(true));
        assert_eq!(decode_cell("Nullable(Int32)", &json!(null)), QueryValue::Null);
    }

    #[test]
    fn arrays_and_maps_preserved_as_json() {
        match decode_cell("Array(Int32)", &json!([1, 2, 3])) {
            QueryValue::Json(s) => assert_eq!(s, "[1,2,3]"),
            other => panic!("expected json, got {other:?}"),
        }
    }

    #[test]
    fn strings_and_decimals_are_text() {
        assert_eq!(
            decode_cell("String", &json!("hi")),
            QueryValue::Text("hi".to_owned())
        );
        assert_eq!(
            decode_cell("Decimal(10, 2)", &json!("3.14")),
            QueryValue::Text("3.14".to_owned())
        );
    }

    #[test]
    fn format_literal_escapes_quotes() {
        assert_eq!(
            format_literal(&QueryValue::Text("O'Brien".to_owned())),
            "'O\\'Brien'"
        );
        assert_eq!(format_literal(&QueryValue::Int(7)), "7");
        assert_eq!(format_literal(&QueryValue::Bool(true)), "1");
        assert_eq!(format_literal(&QueryValue::Null), "NULL");
    }
}
