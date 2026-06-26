use chrono::{DateTime, NaiveTime};
use duckdb::types::{TimeUnit, Value as DuckValue, ValueRef};

use crate::QueryValue;

/// Split a unit-scaled count (DuckDB timestamps/times carry a `TimeUnit` plus an
/// `i64` count of those units since the epoch / midnight) into whole seconds and
/// a non-negative nanosecond remainder. Euclidean division keeps the nanos in
/// `[0, 1e9)` even for pre-epoch negative counts, which the `DateTime`/`NaiveTime`
/// constructors require.
fn split_seconds(unit: TimeUnit, value: i64) -> (i64, u32) {
    let per_sec: i64 = match unit {
        TimeUnit::Second => 1,
        TimeUnit::Millisecond => 1_000,
        TimeUnit::Microsecond => 1_000_000,
        TimeUnit::Nanosecond => 1_000_000_000,
    };
    let secs = value.div_euclid(per_sec);
    let nanos = (value.rem_euclid(per_sec) * (1_000_000_000 / per_sec)) as u32;
    (secs, nanos)
}

/// `Date32` is a count of days since the Unix epoch — render as `YYYY-MM-DD`.
fn format_date32(days: i32) -> Option<String> {
    let dt = DateTime::from_timestamp(86_400 * days as i64, 0)?;
    Some(dt.naive_utc().date().to_string())
}

/// Render a timestamp as `YYYY-MM-DD HH:MM:SS[.ffffff]` (fraction omitted when zero).
fn format_timestamp(unit: TimeUnit, value: i64) -> Option<String> {
    let (secs, nanos) = split_seconds(unit, value);
    let dt = DateTime::from_timestamp(secs, nanos)?;
    Some(dt.naive_utc().to_string())
}

/// Render a time-of-day as `HH:MM:SS[.fffffffff]` (fraction omitted when zero).
fn format_time(unit: TimeUnit, value: i64) -> Option<String> {
    let (secs, nanos) = split_seconds(unit, value);
    let secs = u32::try_from(secs.rem_euclid(86_400)).ok()?;
    let t = NaiveTime::from_num_seconds_from_midnight_opt(secs, nanos)?;
    Some(t.to_string())
}

/// Render a DuckDB interval (months, days, nanoseconds) as readable text, e.g.
/// `1 year 2 months 3 days 04:05:06`. The empty interval renders as `00:00:00`.
fn format_interval(months: i32, days: i32, nanos: i64) -> String {
    fn unit(value: i64, name: &str) -> String {
        format!("{value} {name}{}", if value.abs() == 1 { "" } else { "s" })
    }
    let mut parts: Vec<String> = Vec::new();
    let years = months / 12;
    let rem_months = months % 12;
    if years != 0 {
        parts.push(unit(years as i64, "year"));
    }
    if rem_months != 0 {
        parts.push(unit(rem_months as i64, "month"));
    }
    if days != 0 {
        parts.push(unit(days as i64, "day"));
    }
    if nanos != 0 {
        let total_secs = nanos / 1_000_000_000;
        let h = total_secs / 3_600;
        let m = (total_secs % 3_600) / 60;
        let s = total_secs % 60;
        let frac = (nanos % 1_000_000_000).abs();
        if frac != 0 {
            parts.push(format!("{h:02}:{m:02}:{s:02}.{frac:09}"));
        } else {
            parts.push(format!("{h:02}:{m:02}:{s:02}"));
        }
    }
    if parts.is_empty() {
        "00:00:00".to_owned()
    } else {
        parts.join(" ")
    }
}

pub(super) fn map_value_ref(v: ValueRef<'_>) -> QueryValue {
    match v {
        ValueRef::Null => QueryValue::Null,
        ValueRef::Boolean(b) => QueryValue::Bool(b),
        ValueRef::TinyInt(i) => QueryValue::Int(i as i64),
        ValueRef::SmallInt(i) => QueryValue::Int(i as i64),
        ValueRef::Int(i) => QueryValue::Int(i as i64),
        ValueRef::BigInt(i) => QueryValue::Int(i),
        ValueRef::HugeInt(i) => QueryValue::Text(i.to_string()),
        ValueRef::UTinyInt(i) => QueryValue::Int(i as i64),
        ValueRef::USmallInt(i) => QueryValue::Int(i as i64),
        ValueRef::UInt(i) => QueryValue::Int(i as i64),
        ValueRef::UBigInt(i) => {
            if i <= i64::MAX as u64 {
                QueryValue::Int(i as i64)
            } else {
                QueryValue::Text(i.to_string())
            }
        }
        ValueRef::Float(f) => QueryValue::Double(f as f64),
        ValueRef::Double(f) => QueryValue::Double(f),
        ValueRef::Decimal(d) => QueryValue::Decimal(d.to_string()),
        ValueRef::Date32(days) => match format_date32(days) {
            Some(s) => QueryValue::Text(s),
            None => QueryValue::Text(format!("{v:?}")),
        },
        ValueRef::Timestamp(unit, t) => match format_timestamp(unit, t) {
            Some(s) => QueryValue::Text(s),
            None => QueryValue::Text(format!("{v:?}")),
        },
        ValueRef::Time64(unit, t) => match format_time(unit, t) {
            Some(s) => QueryValue::Text(s),
            None => QueryValue::Text(format!("{v:?}")),
        },
        ValueRef::Interval { months, days, nanos } => {
            QueryValue::Text(format_interval(months, days, nanos))
        }
        ValueRef::Text(t) => match std::str::from_utf8(t) {
            Ok(s) => QueryValue::Text(s.to_owned()),
            Err(_) => QueryValue::Data(t.to_vec()),
        },
        ValueRef::Blob(b) => QueryValue::Data(b.to_vec()),
        _ => QueryValue::Text(format!("{v:?}")),
    }
}

pub(super) fn map_query_value(v: &QueryValue) -> DuckValue {
    match v {
        QueryValue::Null => DuckValue::Null,
        QueryValue::Bool(b) => DuckValue::Boolean(*b),
        QueryValue::Int(i) => DuckValue::BigInt(*i),
        QueryValue::Double(f) => DuckValue::Double(*f),
        QueryValue::Text(s) | QueryValue::Json(s) | QueryValue::Decimal(s) => {
            DuckValue::Text(s.clone())
        }
        QueryValue::Data(d) => DuckValue::Blob(d.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn date32_renders_iso_date() {
        // 19727 days after 1970-01-01 = 2024-01-05.
        assert_eq!(map_value_ref(ValueRef::Date32(19727)), QueryValue::Text("2024-01-05".into()));
        assert_eq!(map_value_ref(ValueRef::Date32(0)), QueryValue::Text("1970-01-01".into()));
    }

    #[test]
    fn timestamp_renders_readable_datetime() {
        // 2023-12-25 10:30:00 UTC in microseconds since epoch.
        assert_eq!(
            map_value_ref(ValueRef::Timestamp(TimeUnit::Microsecond, 1_703_500_200_000_000)),
            QueryValue::Text("2023-12-25 10:30:00".into()),
        );
    }

    #[test]
    fn timestamp_keeps_fractional_seconds() {
        // 1970-01-01 00:00:01.5 in microseconds.
        assert_eq!(
            map_value_ref(ValueRef::Timestamp(TimeUnit::Microsecond, 1_500_000)),
            QueryValue::Text("1970-01-01 00:00:01.500".into()),
        );
    }

    #[test]
    fn timestamp_units_agree() {
        // Same instant (1 second after epoch) expressed in each unit.
        for unit in [
            (TimeUnit::Second, 1),
            (TimeUnit::Millisecond, 1_000),
            (TimeUnit::Microsecond, 1_000_000),
            (TimeUnit::Nanosecond, 1_000_000_000),
        ] {
            assert_eq!(
                map_value_ref(ValueRef::Timestamp(unit.0, unit.1)),
                QueryValue::Text("1970-01-01 00:00:01".into()),
            );
        }
    }

    #[test]
    fn time64_renders_time_of_day() {
        // 10:30:00 in microseconds since midnight.
        let micros = (10 * 3_600 + 30 * 60) * 1_000_000;
        assert_eq!(
            map_value_ref(ValueRef::Time64(TimeUnit::Microsecond, micros)),
            QueryValue::Text("10:30:00".into()),
        );
    }

    #[test]
    fn interval_renders_readable_parts() {
        assert_eq!(
            map_value_ref(ValueRef::Interval { months: 14, days: 3, nanos: 0 }),
            QueryValue::Text("1 year 2 months 3 days".into()),
        );
        assert_eq!(
            map_value_ref(ValueRef::Interval {
                months: 0,
                days: 0,
                nanos: ((4 * 3_600 + 5 * 60 + 6) as i64) * 1_000_000_000,
            }),
            QueryValue::Text("04:05:06".into()),
        );
        assert_eq!(
            map_value_ref(ValueRef::Interval { months: 1, days: 1, nanos: 0 }),
            QueryValue::Text("1 month 1 day".into()),
        );
        assert_eq!(
            map_value_ref(ValueRef::Interval { months: 0, days: 0, nanos: 0 }),
            QueryValue::Text("00:00:00".into()),
        );
    }

    #[test]
    fn scalar_passthroughs_unchanged() {
        assert_eq!(map_value_ref(ValueRef::Null), QueryValue::Null);
        assert_eq!(map_value_ref(ValueRef::Boolean(true)), QueryValue::Bool(true));
        assert_eq!(map_value_ref(ValueRef::Int(42)), QueryValue::Int(42));
        assert_eq!(map_value_ref(ValueRef::Double(1.5)), QueryValue::Double(1.5));
        assert_eq!(map_value_ref(ValueRef::Text(b"hi")), QueryValue::Text("hi".into()));
    }
}
