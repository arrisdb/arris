use rusqlite::types::{Value as SqlValue, ValueRef};

use crate::QueryValue;

pub(super) fn map_value_ref(v: ValueRef<'_>) -> QueryValue {
    match v {
        ValueRef::Null => QueryValue::Null,
        ValueRef::Integer(i) => QueryValue::Int(i),
        ValueRef::Real(f) => QueryValue::Double(f),
        ValueRef::Text(t) => match std::str::from_utf8(t) {
            Ok(s) => QueryValue::Text(s.to_owned()),
            Err(_) => QueryValue::Data(t.to_vec()),
        },
        ValueRef::Blob(b) => QueryValue::Data(b.to_vec()),
    }
}

pub(super) fn map_query_value(v: &QueryValue) -> SqlValue {
    match v {
        QueryValue::Null => SqlValue::Null,
        QueryValue::Bool(b) => SqlValue::Integer(if *b { 1 } else { 0 }),
        QueryValue::Int(i) => SqlValue::Integer(*i),
        QueryValue::Double(f) => SqlValue::Real(*f),
        QueryValue::Text(s) | QueryValue::Json(s) | QueryValue::Decimal(s) => {
            SqlValue::Text(s.clone())
        }
        QueryValue::Data(d) => SqlValue::Blob(d.clone()),
    }
}
