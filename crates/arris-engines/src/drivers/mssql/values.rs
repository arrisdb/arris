use std::borrow::Cow;

use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use tiberius::ColumnData;
pub use tiberius::ToSql;

use tiberius::ColumnType;

use crate::QueryValue;

pub(super) fn mssql_column_type_name(column_type: ColumnType) -> &'static str {
    match column_type {
        ColumnType::Null => "null",
        ColumnType::Bit | ColumnType::Bitn => "bit",
        ColumnType::Int1 => "tinyint",
        ColumnType::Int2 => "smallint",
        ColumnType::Int4 | ColumnType::Intn => "int",
        ColumnType::Int8 => "bigint",
        ColumnType::Datetime4 => "smalldatetime",
        ColumnType::Float4 => "real",
        ColumnType::Float8 | ColumnType::Floatn => "float",
        ColumnType::Money => "money",
        ColumnType::Money4 => "smallmoney",
        ColumnType::Datetime | ColumnType::Datetimen => "datetime",
        ColumnType::Guid => "uniqueidentifier",
        ColumnType::Decimaln => "decimal",
        ColumnType::Numericn => "numeric",
        ColumnType::Daten => "date",
        ColumnType::Timen => "time",
        ColumnType::Datetime2 => "datetime2",
        ColumnType::DatetimeOffsetn => "datetimeoffset",
        ColumnType::BigVarBin => "varbinary",
        ColumnType::BigVarChar => "varchar",
        ColumnType::BigBinary => "binary",
        ColumnType::BigChar => "char",
        ColumnType::NVarchar => "nvarchar",
        ColumnType::NChar => "nchar",
        ColumnType::Xml => "xml",
        ColumnType::Udt => "udt",
        ColumnType::Text => "text",
        ColumnType::Image => "image",
        ColumnType::NText => "ntext",
        ColumnType::SSVariant => "sql_variant",
    }
}

fn days_since_1900_to_date(days: i64) -> NaiveDate {
    let base = NaiveDate::from_ymd_opt(1900, 1, 1).unwrap();
    base + chrono::Duration::days(days)
}

fn days_since_epoch_to_date(days: u32) -> NaiveDate {
    let base = NaiveDate::from_ymd_opt(1, 1, 1).unwrap();
    base + chrono::Duration::days(days as i64)
}

fn increments_to_time(increments: u64, scale: u8) -> NaiveTime {
    let divisor = 10u64.pow(scale as u32);
    let total_secs = increments / divisor;
    let frac = increments % divisor;
    let nanos = if divisor > 0 {
        (frac * 1_000_000_000) / divisor
    } else {
        0
    };
    NaiveTime::from_hms_nano_opt(
        (total_secs / 3600) as u32,
        ((total_secs % 3600) / 60) as u32,
        (total_secs % 60) as u32,
        nanos as u32,
    )
    .unwrap_or_default()
}

pub struct SqlParam(pub QueryValue);

impl ToSql for SqlParam {
    fn to_sql(&self) -> ColumnData<'_> {
        match &self.0 {
            QueryValue::Null => ColumnData::String(None),
            QueryValue::Bool(b) => ColumnData::Bit(Some(*b)),
            QueryValue::Int(i) => ColumnData::I64(Some(*i)),
            QueryValue::Double(d) => ColumnData::F64(Some(*d)),
            QueryValue::Text(s) => ColumnData::String(Some(Cow::Borrowed(s.as_str()))),
            QueryValue::Data(d) => ColumnData::Binary(Some(Cow::Borrowed(d.as_slice()))),
            QueryValue::Json(s) => ColumnData::String(Some(Cow::Borrowed(s.as_str()))),
            QueryValue::Decimal(s) => ColumnData::String(Some(Cow::Borrowed(s.as_str()))),
        }
    }
}

pub fn column_data_to_query(data: ColumnData<'_>) -> QueryValue {
    match data {
        ColumnData::U8(None)
        | ColumnData::I16(None)
        | ColumnData::I32(None)
        | ColumnData::I64(None)
        | ColumnData::F32(None)
        | ColumnData::F64(None)
        | ColumnData::Bit(None)
        | ColumnData::String(None)
        | ColumnData::Guid(None)
        | ColumnData::Binary(None)
        | ColumnData::Numeric(None)
        | ColumnData::Xml(None)
        | ColumnData::DateTime(None)
        | ColumnData::SmallDateTime(None)
        | ColumnData::DateTime2(None)
        | ColumnData::DateTimeOffset(None)
        | ColumnData::Time(None)
        | ColumnData::Date(None) => QueryValue::Null,

        ColumnData::Bit(Some(b)) => QueryValue::Bool(b),
        ColumnData::U8(Some(v)) => QueryValue::Int(i64::from(v)),
        ColumnData::I16(Some(v)) => QueryValue::Int(i64::from(v)),
        ColumnData::I32(Some(v)) => QueryValue::Int(i64::from(v)),
        ColumnData::I64(Some(v)) => QueryValue::Int(v),
        ColumnData::F32(Some(v)) => QueryValue::Double(f64::from(v)),
        ColumnData::F64(Some(v)) => QueryValue::Double(v),
        ColumnData::String(Some(s)) => QueryValue::Text(s.into_owned()),
        ColumnData::Guid(Some(g)) => QueryValue::Text(g.to_string()),
        ColumnData::Binary(Some(b)) => QueryValue::Data(b.into_owned()),
        ColumnData::Numeric(Some(n)) => QueryValue::Decimal(n.to_string()),
        ColumnData::Xml(Some(x)) => QueryValue::Text(x.into_owned().into_string()),
        ColumnData::DateTime(Some(dt)) => {
            let date = days_since_1900_to_date(dt.days() as i64);
            let total_ms = (dt.seconds_fragments() as u64 * 1000) / 300;
            let secs = (total_ms / 1000) as u32;
            let ms = (total_ms % 1000) as u32;
            let time = NaiveTime::from_hms_milli_opt(secs / 3600, (secs % 3600) / 60, secs % 60, ms)
                .unwrap_or_default();
            QueryValue::Text(NaiveDateTime::new(date, time).format("%Y-%m-%d %H:%M:%S%.3f").to_string())
        }
        ColumnData::SmallDateTime(Some(dt)) => {
            let date = days_since_1900_to_date(dt.days() as i64);
            let mins = dt.seconds_fragments() as u32;
            let time = NaiveTime::from_hms_opt(mins / 60, mins % 60, 0).unwrap_or_default();
            QueryValue::Text(NaiveDateTime::new(date, time).format("%Y-%m-%d %H:%M:%S").to_string())
        }
        ColumnData::DateTime2(Some(dt)) => {
            let date = days_since_epoch_to_date(dt.date().days());
            let time = increments_to_time(dt.time().increments(), dt.time().scale());
            QueryValue::Text(NaiveDateTime::new(date, time).format("%Y-%m-%d %H:%M:%S%.f").to_string())
        }
        ColumnData::DateTimeOffset(Some(dto)) => {
            let dt2 = dto.datetime2();
            let date = days_since_epoch_to_date(dt2.date().days());
            let time = increments_to_time(dt2.time().increments(), dt2.time().scale());
            QueryValue::Text(NaiveDateTime::new(date, time).format("%Y-%m-%d %H:%M:%S%.f").to_string())
        }
        ColumnData::Time(Some(t)) => {
            let time = increments_to_time(t.increments(), t.scale());
            QueryValue::Text(time.format("%H:%M:%S%.f").to_string())
        }
        ColumnData::Date(Some(d)) => {
            let date = days_since_epoch_to_date(d.days());
            QueryValue::Text(date.format("%Y-%m-%d").to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn column_type_name(data: &ColumnData<'_>) -> &'static str {
        match data {
            ColumnData::U8(_) => "tinyint",
            ColumnData::I16(_) => "smallint",
            ColumnData::I32(_) => "int",
            ColumnData::I64(_) => "bigint",
            ColumnData::F32(_) => "real",
            ColumnData::F64(_) => "float",
            ColumnData::Bit(_) => "bit",
            ColumnData::String(_) => "nvarchar",
            ColumnData::Guid(_) => "uniqueidentifier",
            ColumnData::Binary(_) => "varbinary",
            ColumnData::Numeric(_) => "decimal",
            ColumnData::Xml(_) => "xml",
            ColumnData::DateTime(_) => "datetime",
            ColumnData::SmallDateTime(_) => "smalldatetime",
            ColumnData::DateTime2(_) => "datetime2",
            ColumnData::DateTimeOffset(_) => "datetimeoffset",
            ColumnData::Time(_) => "time",
            ColumnData::Date(_) => "date",
        }
    }

    #[test]
    fn sql_param_int() {
        let p = SqlParam(QueryValue::Int(42));
        assert!(matches!(p.to_sql(), ColumnData::I64(Some(42))));
    }

    #[test]
    fn sql_param_bool() {
        let p = SqlParam(QueryValue::Bool(true));
        assert!(matches!(p.to_sql(), ColumnData::Bit(Some(true))));
    }

    #[test]
    fn sql_param_null() {
        let p = SqlParam(QueryValue::Null);
        assert!(matches!(p.to_sql(), ColumnData::String(None)));
    }

    #[test]
    fn column_data_null_variants() {
        assert_eq!(column_data_to_query(ColumnData::I32(None)), QueryValue::Null);
        assert_eq!(column_data_to_query(ColumnData::String(None)), QueryValue::Null);
        assert_eq!(column_data_to_query(ColumnData::Bit(None)), QueryValue::Null);
    }

    #[test]
    fn column_data_i32_to_int() {
        assert_eq!(column_data_to_query(ColumnData::I32(Some(7))), QueryValue::Int(7));
    }

    #[test]
    fn column_data_f64_to_double() {
        assert_eq!(column_data_to_query(ColumnData::F64(Some(3.14))), QueryValue::Double(3.14));
    }

    #[test]
    fn column_data_string_to_text() {
        let cd = ColumnData::String(Some(Cow::Owned("hello".to_owned())));
        assert_eq!(column_data_to_query(cd), QueryValue::Text("hello".into()));
    }

    #[test]
    fn column_data_binary_to_data() {
        let bs = vec![0u8, 1, 2];
        let cd = ColumnData::Binary(Some(Cow::Owned(bs.clone())));
        assert_eq!(column_data_to_query(cd), QueryValue::Data(bs));
    }

    #[test]
    fn type_name_covers_common_types() {
        assert_eq!(column_type_name(&ColumnData::I32(None)), "int");
        assert_eq!(column_type_name(&ColumnData::I64(None)), "bigint");
        assert_eq!(column_type_name(&ColumnData::String(None)), "nvarchar");
        assert_eq!(column_type_name(&ColumnData::Bit(None)), "bit");
        assert_eq!(column_type_name(&ColumnData::F64(None)), "float");
    }
}
