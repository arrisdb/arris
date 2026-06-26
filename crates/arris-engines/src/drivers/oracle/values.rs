use oracle_rs::Value;

use crate::QueryValue;

pub fn oracle_value_to_query(value: Value) -> QueryValue {
    match value {
        Value::Null => QueryValue::Null,
        Value::Boolean(b) => QueryValue::Bool(b),
        Value::Integer(i) => QueryValue::Int(i),
        Value::Float(f) => QueryValue::Double(f),
        Value::String(s) => QueryValue::Text(s),
        Value::Bytes(b) => QueryValue::Data(b),
        Value::Number(n) => QueryValue::Text(n.as_str().to_owned()),
        Value::Date(d) => QueryValue::Text(format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            d.year, d.month, d.day, d.hour, d.minute, d.second
        )),
        Value::Timestamp(t) => QueryValue::Text(format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:06}",
            t.year, t.month, t.day, t.hour, t.minute, t.second, t.microsecond
        )),
        Value::RowId(r) => QueryValue::Text(r.to_string().unwrap_or_default()),
        Value::Lob(_) => QueryValue::Text("<LOB>".into()),
        Value::Json(j) => QueryValue::Json(j.to_string()),
        Value::Vector(v) => QueryValue::Text(format!("<VECTOR: {} dims>", v.dimensions())),
        Value::Cursor(_) => QueryValue::Text("<CURSOR>".into()),
        Value::Collection(_) => QueryValue::Text("<COLLECTION>".into()),
    }
}

pub fn query_value_to_oracle(value: &QueryValue) -> Value {
    match value {
        QueryValue::Null => Value::Null,
        QueryValue::Bool(b) => Value::Boolean(*b),
        QueryValue::Int(i) => Value::Integer(*i),
        QueryValue::Double(d) => Value::Float(*d),
        QueryValue::Text(s) | QueryValue::Decimal(s) => Value::String(s.clone()),
        QueryValue::Data(d) => Value::Bytes(d.clone()),
        QueryValue::Json(s) => {
            serde_json::from_str(s).map(Value::Json).unwrap_or_else(|_| Value::String(s.clone()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn null_converts() {
        assert_eq!(oracle_value_to_query(Value::Null), QueryValue::Null);
    }

    #[test]
    fn int_converts() {
        assert_eq!(oracle_value_to_query(Value::Integer(42)), QueryValue::Int(42));
    }

    #[test]
    fn float_converts() {
        assert_eq!(
            oracle_value_to_query(Value::Float(3.14)),
            QueryValue::Double(3.14)
        );
    }

    #[test]
    fn string_converts() {
        assert_eq!(
            oracle_value_to_query(Value::String("hello".into())),
            QueryValue::Text("hello".into())
        );
    }

    #[test]
    fn bytes_converts() {
        let data = vec![1u8, 2, 3];
        assert_eq!(
            oracle_value_to_query(Value::Bytes(data.clone())),
            QueryValue::Data(data)
        );
    }

    #[test]
    fn query_value_to_oracle_roundtrip() {
        assert!(matches!(query_value_to_oracle(&QueryValue::Null), Value::Null));
        assert!(matches!(
            query_value_to_oracle(&QueryValue::Int(42)),
            Value::Integer(42)
        ));
        assert!(matches!(
            query_value_to_oracle(&QueryValue::Bool(true)),
            Value::Boolean(true)
        ));
    }
}
