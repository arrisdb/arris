//! Bidirectional `QueryValue` ↔ `mysql_async::Value` mapping.
//! `Bytes` payloads are inspected against the column type to decide
//! between `Text`, `Json` and raw `Data`.

use mysql_async::Value;
use mysql_async::consts::ColumnType;

use crate::QueryValue;

pub fn query_to_mysql(v: &QueryValue) -> Value {
    match v {
        QueryValue::Null => Value::NULL,
        QueryValue::Bool(b) => Value::Int(if *b { 1 } else { 0 }),
        QueryValue::Int(i) => Value::Int(*i),
        QueryValue::Double(d) => Value::Double(*d),
        QueryValue::Text(t) => Value::Bytes(t.as_bytes().to_vec()),
        QueryValue::Data(d) => Value::Bytes(d.clone()),
        QueryValue::Json(s) => Value::Bytes(s.as_bytes().to_vec()),
        QueryValue::Decimal(s) => Value::Bytes(s.as_bytes().to_vec()),
    }
}

pub fn mysql_to_query(value: Value, col_type: ColumnType) -> QueryValue {
    match value {
        Value::NULL => QueryValue::Null,
        Value::Int(n) => QueryValue::Int(n),
        Value::UInt(n) => i64::try_from(n)
            .map(QueryValue::Int)
            .unwrap_or_else(|_| QueryValue::Text(n.to_string())),
        Value::Float(f) => QueryValue::Double(f as f64),
        Value::Double(d) => QueryValue::Double(d),
        Value::Bytes(bs) => bytes_to_query(bs, col_type),
        Value::Date(y, mo, d, h, mi, s, us) => {
            let mut out = format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}");
            if us > 0 {
                use std::fmt::Write;
                write!(out, ".{us:06}").unwrap();
            }
            QueryValue::Text(out)
        }
        Value::Time(neg, days, h, m, s, us) => {
            let total_h = days * 24 + u32::from(h);
            let mut out = format!(
                "{}{:02}:{:02}:{:02}",
                if neg { "-" } else { "" },
                total_h,
                m,
                s
            );
            if us > 0 {
                use std::fmt::Write;
                write!(out, ".{us:06}").unwrap();
            }
            QueryValue::Text(out)
        }
    }
}

fn bytes_to_query(bs: Vec<u8>, col_type: ColumnType) -> QueryValue {
    use ColumnType::*;
    match col_type {
        MYSQL_TYPE_TINY_BLOB | MYSQL_TYPE_MEDIUM_BLOB | MYSQL_TYPE_LONG_BLOB | MYSQL_TYPE_BLOB => {
            QueryValue::Data(bs)
        }
        MYSQL_TYPE_JSON => match String::from_utf8(bs) {
            Ok(s) => QueryValue::Json(s),
            Err(e) => QueryValue::Data(e.into_bytes()),
        },
        // The text protocol delivers numeric columns as ASCII bytes. Parse the
        // integer family to `Int` so the UI and row-detail JSON render them as
        // unquoted numbers instead of quoted strings. An out-of-range value
        // (e.g. `BIGINT UNSIGNED` above `i64::MAX`) fails to parse and falls
        // back to `Text`, matching the `Value::UInt` overflow handling above.
        MYSQL_TYPE_TINY | MYSQL_TYPE_SHORT | MYSQL_TYPE_INT24 | MYSQL_TYPE_LONG
        | MYSQL_TYPE_LONGLONG | MYSQL_TYPE_YEAR => parse_int_bytes(bs),
        // Approximate-numeric columns map to `Double`.
        MYSQL_TYPE_FLOAT | MYSQL_TYPE_DOUBLE => parse_double_bytes(bs),
        // DECIMAL/NEWDECIMAL are exact and can carry up to 65 digits — beyond
        // f64's ~15 significant digits. They map to `Decimal`, which preserves
        // the literal digit string so the row-detail JSON can render them as
        // unquoted numbers without any lossy float conversion.
        MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => match String::from_utf8(bs) {
            Ok(s) => QueryValue::Decimal(s),
            Err(e) => QueryValue::Data(e.into_bytes()),
        },
        _ => bytes_to_text(bs),
    }
}

fn parse_int_bytes(bs: Vec<u8>) -> QueryValue {
    match std::str::from_utf8(&bs)
        .ok()
        .and_then(|s| s.trim().parse::<i64>().ok())
    {
        Some(n) => QueryValue::Int(n),
        None => bytes_to_text(bs),
    }
}

fn parse_double_bytes(bs: Vec<u8>) -> QueryValue {
    match std::str::from_utf8(&bs)
        .ok()
        .and_then(|s| s.trim().parse::<f64>().ok())
    {
        Some(d) => QueryValue::Double(d),
        None => bytes_to_text(bs),
    }
}

fn bytes_to_text(bs: Vec<u8>) -> QueryValue {
    match String::from_utf8(bs) {
        Ok(s) => QueryValue::Text(s),
        Err(e) => QueryValue::Data(e.into_bytes()),
    }
}

/// Maps a `ColumnType` to the short type-hint string the UI displays.
pub fn column_type_str(t: ColumnType) -> &'static str {
    use ColumnType::*;
    match t {
        MYSQL_TYPE_TINY => "tinyint",
        MYSQL_TYPE_SHORT => "smallint",
        MYSQL_TYPE_INT24 => "mediumint",
        MYSQL_TYPE_LONG => "int",
        MYSQL_TYPE_LONGLONG => "bigint",
        MYSQL_TYPE_FLOAT => "float",
        MYSQL_TYPE_DOUBLE => "double",
        MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => "decimal",
        MYSQL_TYPE_TIMESTAMP | MYSQL_TYPE_TIMESTAMP2 => "timestamp",
        MYSQL_TYPE_DATETIME | MYSQL_TYPE_DATETIME2 => "datetime",
        MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE => "date",
        MYSQL_TYPE_TIME | MYSQL_TYPE_TIME2 => "time",
        MYSQL_TYPE_YEAR => "year",
        MYSQL_TYPE_VAR_STRING => "varchar",
        MYSQL_TYPE_STRING => "char",
        MYSQL_TYPE_VARCHAR => "varchar",
        MYSQL_TYPE_TINY_BLOB => "tinyblob",
        MYSQL_TYPE_MEDIUM_BLOB => "mediumblob",
        MYSQL_TYPE_LONG_BLOB => "longblob",
        MYSQL_TYPE_BLOB => "blob",
        MYSQL_TYPE_JSON => "json",
        MYSQL_TYPE_BIT => "bit",
        MYSQL_TYPE_ENUM => "enum",
        MYSQL_TYPE_SET => "set",
        MYSQL_TYPE_GEOMETRY => "geometry",
        MYSQL_TYPE_NULL => "null",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_int() {
        let v = query_to_mysql(&QueryValue::Int(42));
        assert!(matches!(v, Value::Int(42)));
    }

    #[test]
    fn round_trip_bool_to_int01() {
        assert!(matches!(
            query_to_mysql(&QueryValue::Bool(true)),
            Value::Int(1)
        ));
        assert!(matches!(
            query_to_mysql(&QueryValue::Bool(false)),
            Value::Int(0)
        ));
    }

    #[test]
    fn round_trip_text() {
        match query_to_mysql(&QueryValue::Text("hello".into())) {
            Value::Bytes(bs) => assert_eq!(bs, b"hello".to_vec()),
            _ => panic!("expected bytes"),
        }
    }

    #[test]
    fn null_round_trips() {
        assert_eq!(
            mysql_to_query(Value::NULL, ColumnType::MYSQL_TYPE_NULL),
            QueryValue::Null
        );
    }

    #[test]
    fn uint_promotes_to_int_when_in_range() {
        assert_eq!(
            mysql_to_query(Value::UInt(5), ColumnType::MYSQL_TYPE_LONGLONG),
            QueryValue::Int(5)
        );
    }

    #[test]
    fn uint_overflow_falls_back_to_text() {
        let big = u64::MAX;
        assert_eq!(
            mysql_to_query(Value::UInt(big), ColumnType::MYSQL_TYPE_LONGLONG),
            QueryValue::Text(big.to_string())
        );
    }

    #[test]
    fn bytes_decode_as_text_for_string_columns() {
        let r = mysql_to_query(
            Value::Bytes(b"alice".to_vec()),
            ColumnType::MYSQL_TYPE_VAR_STRING,
        );
        assert_eq!(r, QueryValue::Text("alice".into()));
    }

    #[test]
    fn bytes_decode_as_data_for_blob_columns() {
        let bs = vec![0u8, 1, 2, 0xff];
        let r = mysql_to_query(Value::Bytes(bs.clone()), ColumnType::MYSQL_TYPE_BLOB);
        assert_eq!(r, QueryValue::Data(bs));
    }

    #[test]
    fn bytes_decode_as_int_for_integer_columns() {
        // The text protocol returns INT/BIGINT/etc. as ASCII bytes; they must
        // become `Int` so the row-detail JSON renders unquoted numbers.
        for t in [
            ColumnType::MYSQL_TYPE_TINY,
            ColumnType::MYSQL_TYPE_SHORT,
            ColumnType::MYSQL_TYPE_INT24,
            ColumnType::MYSQL_TYPE_LONG,
            ColumnType::MYSQL_TYPE_LONGLONG,
            ColumnType::MYSQL_TYPE_YEAR,
        ] {
            assert_eq!(
                mysql_to_query(Value::Bytes(b"100".to_vec()), t),
                QueryValue::Int(100),
                "column type {t:?} should decode to Int"
            );
        }
    }

    #[test]
    fn bytes_decode_negative_int() {
        assert_eq!(
            mysql_to_query(Value::Bytes(b"-7".to_vec()), ColumnType::MYSQL_TYPE_LONG),
            QueryValue::Int(-7)
        );
    }

    #[test]
    fn bytes_decode_as_double_for_float_and_double_columns() {
        assert_eq!(
            mysql_to_query(
                Value::Bytes(b"1.5".to_vec()),
                ColumnType::MYSQL_TYPE_FLOAT
            ),
            QueryValue::Double(1.5)
        );
        assert_eq!(
            mysql_to_query(
                Value::Bytes(b"3.25".to_vec()),
                ColumnType::MYSQL_TYPE_DOUBLE
            ),
            QueryValue::Double(3.25)
        );
    }

    #[test]
    fn bytes_decode_decimal_to_exact_decimal_variant() {
        // DECIMAL is exact and may exceed f64 precision, so it maps to the
        // `Decimal` variant which preserves the literal digit string (trailing
        // zeros and all) for unquoted-number rendering.
        assert_eq!(
            mysql_to_query(
                Value::Bytes(b"129.00".to_vec()),
                ColumnType::MYSQL_TYPE_NEWDECIMAL
            ),
            QueryValue::Decimal("129.00".into())
        );
        assert_eq!(
            mysql_to_query(
                Value::Bytes(b"12345678901234567890.12345".to_vec()),
                ColumnType::MYSQL_TYPE_DECIMAL
            ),
            QueryValue::Decimal("12345678901234567890.12345".into())
        );
    }

    #[test]
    fn bytes_int_overflow_falls_back_to_text() {
        // BIGINT UNSIGNED above i64::MAX can't parse to i64; keep it as Text
        // rather than corrupting the value.
        let big = "18446744073709551615";
        assert_eq!(
            mysql_to_query(
                Value::Bytes(big.as_bytes().to_vec()),
                ColumnType::MYSQL_TYPE_LONGLONG
            ),
            QueryValue::Text(big.into())
        );
    }

    #[test]
    fn bytes_decode_as_json_for_json_column() {
        let r = mysql_to_query(
            Value::Bytes(b"{\"a\":1}".to_vec()),
            ColumnType::MYSQL_TYPE_JSON,
        );
        assert_eq!(r, QueryValue::Json("{\"a\":1}".into()));
    }

    #[test]
    fn date_renders_iso_like() {
        let r = mysql_to_query(
            Value::Date(2024, 5, 1, 10, 30, 5, 0),
            ColumnType::MYSQL_TYPE_DATETIME,
        );
        assert_eq!(r, QueryValue::Text("2024-05-01 10:30:05".into()));
    }

    #[test]
    fn date_with_microseconds_renders_fraction() {
        let r = mysql_to_query(
            Value::Date(2024, 5, 1, 10, 30, 5, 123456),
            ColumnType::MYSQL_TYPE_DATETIME,
        );
        assert_eq!(r, QueryValue::Text("2024-05-01 10:30:05.123456".into()));
    }

    #[test]
    fn time_renders_hms_with_sign() {
        let r = mysql_to_query(
            Value::Time(true, 0, 1, 2, 3, 0),
            ColumnType::MYSQL_TYPE_TIME,
        );
        assert_eq!(r, QueryValue::Text("-01:02:03".into()));
    }

    #[test]
    fn time_accumulates_days_into_hours() {
        // 2 days + 3 hours = 51 hours
        let r = mysql_to_query(
            Value::Time(false, 2, 3, 0, 0, 0),
            ColumnType::MYSQL_TYPE_TIME,
        );
        assert_eq!(r, QueryValue::Text("51:00:00".into()));
    }

    #[test]
    fn column_type_str_covers_common_types() {
        assert_eq!(column_type_str(ColumnType::MYSQL_TYPE_LONG), "int");
        assert_eq!(column_type_str(ColumnType::MYSQL_TYPE_LONGLONG), "bigint");
        assert_eq!(column_type_str(ColumnType::MYSQL_TYPE_VAR_STRING), "varchar");
        assert_eq!(column_type_str(ColumnType::MYSQL_TYPE_JSON), "json");
        assert_eq!(column_type_str(ColumnType::MYSQL_TYPE_BLOB), "blob");
    }
}
