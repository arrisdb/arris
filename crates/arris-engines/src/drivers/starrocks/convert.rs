//! Bidirectional `QueryValue` ↔ `mysql_async::Value` mapping for StarRocks.
//! StarRocks returns standard MySQL-protocol column types, so the same decoding
//! the `mysql` driver uses applies here. Functions are associated to the unit
//! `Convert` struct to honor the "no free-floating functions" rule.

use mysql_async::Value;
use mysql_async::consts::ColumnType;

use crate::QueryValue;

pub(super) struct Convert;

impl Convert {
    pub(super) fn query_to_mysql(v: &QueryValue) -> Value {
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

    pub(super) fn mysql_to_query(value: Value, col_type: ColumnType) -> QueryValue {
        match value {
            Value::NULL => QueryValue::Null,
            Value::Int(n) => QueryValue::Int(n),
            Value::UInt(n) => i64::try_from(n)
                .map(QueryValue::Int)
                .unwrap_or_else(|_| QueryValue::Text(n.to_string())),
            Value::Float(f) => QueryValue::Double(f as f64),
            Value::Double(d) => QueryValue::Double(d),
            Value::Bytes(bs) => Self::bytes_to_query(bs, col_type),
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
                let mut out =
                    format!("{}{:02}:{:02}:{:02}", if neg { "-" } else { "" }, total_h, m, s);
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
            MYSQL_TYPE_TINY_BLOB | MYSQL_TYPE_MEDIUM_BLOB | MYSQL_TYPE_LONG_BLOB
            | MYSQL_TYPE_BLOB => QueryValue::Data(bs),
            MYSQL_TYPE_JSON => match String::from_utf8(bs) {
                Ok(s) => QueryValue::Json(s),
                Err(e) => QueryValue::Data(e.into_bytes()),
            },
            // The text protocol delivers numeric columns as ASCII bytes; parse
            // the integer family to `Int` so the UI renders unquoted numbers.
            MYSQL_TYPE_TINY | MYSQL_TYPE_SHORT | MYSQL_TYPE_INT24 | MYSQL_TYPE_LONG
            | MYSQL_TYPE_LONGLONG | MYSQL_TYPE_YEAR => Self::parse_int_bytes(bs),
            MYSQL_TYPE_FLOAT | MYSQL_TYPE_DOUBLE => Self::parse_double_bytes(bs),
            // DECIMAL is exact and may exceed f64 precision; preserve the literal
            // digit string so it renders as an unquoted number losslessly.
            MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => match String::from_utf8(bs) {
                Ok(s) => QueryValue::Decimal(s),
                Err(e) => QueryValue::Data(e.into_bytes()),
            },
            _ => Self::bytes_to_text(bs),
        }
    }

    fn parse_int_bytes(bs: Vec<u8>) -> QueryValue {
        match std::str::from_utf8(&bs)
            .ok()
            .and_then(|s| s.trim().parse::<i64>().ok())
        {
            Some(n) => QueryValue::Int(n),
            None => Self::bytes_to_text(bs),
        }
    }

    fn parse_double_bytes(bs: Vec<u8>) -> QueryValue {
        match std::str::from_utf8(&bs)
            .ok()
            .and_then(|s| s.trim().parse::<f64>().ok())
        {
            Some(d) => QueryValue::Double(d),
            None => Self::bytes_to_text(bs),
        }
    }

    fn bytes_to_text(bs: Vec<u8>) -> QueryValue {
        match String::from_utf8(bs) {
            Ok(s) => QueryValue::Text(s),
            Err(e) => QueryValue::Data(e.into_bytes()),
        }
    }

    /// Maps a `ColumnType` to the short type-hint string the UI displays.
    pub(super) fn column_type_str(t: ColumnType) -> &'static str {
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
}
