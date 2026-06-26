//! `QueryValue` ↔ tokio-postgres binding glue.
//!
//! Outbound: `PgValue` wraps `&QueryValue` and dispatches `ToSql` based on the
//! tag, producing the most natural Postgres type for each tag.
//!
//! Inbound: `row_value` reads a column by index, mapping the column type OID
//! to the right `QueryValue` variant. Types we don't recognise fall back to
//! reading the raw text via `format_type` and are returned as `Text`.

use std::error::Error;

use bytes::BytesMut;
use tokio_postgres::Row;
use tokio_postgres::types::{FromSql, IsNull, Kind, ToSql, Type, to_sql_checked};

use crate::QueryValue;

/// Number of decimal digits packed into one NUMERIC wire digit (base 10000).
const NUMERIC_NBASE_DIGITS: usize = 4;
/// `sign` field values from the NUMERIC binary header.
const NUMERIC_POS: u16 = 0x0000;
const NUMERIC_NEG: u16 = 0x4000;
const NUMERIC_NAN: u16 = 0xC000;
const NUMERIC_PINF: u16 = 0xD000;
const NUMERIC_NINF: u16 = 0xF000;

/// Inbound decoder for Postgres `NUMERIC`/`DECIMAL`.
///
/// tokio-postgres ships no `FromSql` impl that turns a binary NUMERIC into a
/// native Rust type without pulling in a decimal crate, so we parse the wire
/// format directly into an exact decimal string. Surfaced as `QueryValue::Text`
/// to preserve full precision (no f64 rounding), matching the mssql driver.
pub(super) struct PgNumeric(pub String);

impl PgNumeric {
    /// Decode the Postgres NUMERIC binary layout into an exact decimal string.
    ///
    /// Header (big-endian): `ndigits: i16`, `weight: i16`, `sign: u16`,
    /// `dscale: u16`, followed by `ndigits` base-10000 digits (`i16`). The first
    /// digit carries place value `10000^weight`; `dscale` is the number of
    /// decimal digits to render after the point.
    fn decode(raw: &[u8]) -> Option<String> {
        if raw.len() < 8 {
            return None;
        }
        let ndigits = i16::from_be_bytes([raw[0], raw[1]]);
        let weight = i16::from_be_bytes([raw[2], raw[3]]);
        let sign = u16::from_be_bytes([raw[4], raw[5]]);
        let dscale = u16::from_be_bytes([raw[6], raw[7]]) as usize;

        match sign {
            NUMERIC_NAN => return Some("NaN".to_owned()),
            NUMERIC_PINF => return Some("Infinity".to_owned()),
            NUMERIC_NINF => return Some("-Infinity".to_owned()),
            NUMERIC_POS | NUMERIC_NEG => {}
            _ => return None,
        }

        let ndigits = ndigits as usize;
        if raw.len() < 8 + ndigits * 2 {
            return None;
        }
        let mut digits = Vec::with_capacity(ndigits);
        for i in 0..ndigits {
            let off = 8 + i * 2;
            digits.push(i16::from_be_bytes([raw[off], raw[off + 1]]));
        }

        let mut out = String::new();
        if sign == NUMERIC_NEG {
            out.push('-');
        }

        // Integer part: digit groups at place 10000^weight .. 10000^0.
        if weight < 0 {
            out.push('0');
        } else {
            for i in 0..=weight {
                let d = digits.get(i as usize).copied().unwrap_or(0);
                if i == 0 {
                    out.push_str(&d.to_string());
                } else {
                    out.push_str(&format!("{d:0width$}", width = NUMERIC_NBASE_DIGITS));
                }
            }
        }

        // Fractional part: exactly `dscale` decimal digits, zero-padded.
        if dscale > 0 {
            out.push('.');
            let mut frac = String::with_capacity(dscale + NUMERIC_NBASE_DIGITS);
            let mut idx = weight as isize + 1;
            while frac.len() < dscale {
                let d = if idx >= 0 {
                    digits.get(idx as usize).copied().unwrap_or(0)
                } else {
                    0
                };
                frac.push_str(&format!("{d:0width$}", width = NUMERIC_NBASE_DIGITS));
                idx += 1;
            }
            frac.truncate(dscale);
            out.push_str(&frac);
        }

        Some(out)
    }
}

impl<'a> FromSql<'a> for PgNumeric {
    fn from_sql(
        _ty: &Type,
        raw: &'a [u8],
    ) -> std::result::Result<Self, Box<dyn Error + Sync + Send>> {
        Self::decode(raw)
            .map(PgNumeric)
            .ok_or_else(|| "invalid NUMERIC binary payload".into())
    }

    fn accepts(ty: &Type) -> bool {
        matches!(*ty, Type::NUMERIC)
    }
}

/// Outbound binder: implements `ToSql` for our type-erased value enum.
pub struct PgValue<'a>(pub &'a QueryValue);

impl<'a> std::fmt::Debug for PgValue<'a> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "PgValue({:?})", self.0)
    }
}

impl<'a> ToSql for PgValue<'a> {
    fn to_sql(
        &self,
        ty: &Type,
        out: &mut BytesMut,
    ) -> std::result::Result<IsNull, Box<dyn Error + Sync + Send>> {
        match self.0 {
            QueryValue::Null => Ok(IsNull::Yes),
            QueryValue::Bool(b) => b.to_sql(ty, out),
            QueryValue::Int(i) => match *ty {
                Type::INT2 => (*i as i16).to_sql(ty, out),
                Type::INT4 => (*i as i32).to_sql(ty, out),
                Type::INT8 => i.to_sql(ty, out),
                Type::FLOAT4 => (*i as f32).to_sql(ty, out),
                Type::FLOAT8 => (*i as f64).to_sql(ty, out),
                Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME => {
                    i.to_string().to_sql(ty, out)
                }
                _ => i.to_sql(ty, out),
            },
            QueryValue::Double(f) => match *ty {
                Type::FLOAT4 => (*f as f32).to_sql(ty, out),
                Type::FLOAT8 => f.to_sql(ty, out),
                Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME => {
                    f.to_string().to_sql(ty, out)
                }
                _ => f.to_sql(ty, out),
            },
            // Exact decimals bind identically to text: parse for int/float
            // target columns, otherwise hand the string to the driver (e.g.
            // a NUMERIC column).
            QueryValue::Text(s) | QueryValue::Decimal(s) => match *ty {
                Type::INT2 => s
                    .parse::<i16>()
                    .map_err(|e| Box::new(e) as Box<dyn Error + Sync + Send>)?
                    .to_sql(ty, out),
                Type::INT4 => s
                    .parse::<i32>()
                    .map_err(|e| Box::new(e) as Box<dyn Error + Sync + Send>)?
                    .to_sql(ty, out),
                Type::INT8 => s
                    .parse::<i64>()
                    .map_err(|e| Box::new(e) as Box<dyn Error + Sync + Send>)?
                    .to_sql(ty, out),
                Type::FLOAT4 => s
                    .parse::<f32>()
                    .map_err(|e| Box::new(e) as Box<dyn Error + Sync + Send>)?
                    .to_sql(ty, out),
                Type::FLOAT8 => s
                    .parse::<f64>()
                    .map_err(|e| Box::new(e) as Box<dyn Error + Sync + Send>)?
                    .to_sql(ty, out),
                _ if matches!(ty.kind(), Kind::Enum(_)) => {
                    out.extend_from_slice(s.as_bytes());
                    Ok(IsNull::No)
                }
                _ => s.to_sql(ty, out),
            },
            QueryValue::Data(d) => d.as_slice().to_sql(ty, out),
            QueryValue::Json(s) => {
                let parsed: serde_json::Value = serde_json::from_str(s)
                    .map_err(|e| Box::new(e) as Box<dyn Error + Sync + Send>)?;
                parsed.to_sql(ty, out)
            }
        }
    }

    fn accepts(_ty: &Type) -> bool {
        true
    }

    to_sql_checked!();
}

/// Inbound row → QueryValue mapping.
pub fn row_value(row: &Row, idx: usize) -> QueryValue {
    let col = &row.columns()[idx];
    let ty = col.type_();

    if matches!(ty.kind(), Kind::Array(_)) {
        // Array types are surfaced as JSON for parity with Swift driver.
        if let Ok(v) = row.try_get::<_, Option<serde_json::Value>>(idx) {
            return v
                .map(|j| QueryValue::Json(j.to_string()))
                .unwrap_or(QueryValue::Null);
        }
        if let Ok(s) = row.try_get::<_, Option<String>>(idx) {
            return s.map(QueryValue::Text).unwrap_or(QueryValue::Null);
        }
        return QueryValue::Null;
    }

    match *ty {
        Type::BOOL => row
            .try_get::<_, Option<bool>>(idx)
            .ok()
            .flatten()
            .map(QueryValue::Bool)
            .unwrap_or(QueryValue::Null),
        Type::INT2 => row
            .try_get::<_, Option<i16>>(idx)
            .ok()
            .flatten()
            .map(|v| QueryValue::Int(v as i64))
            .unwrap_or(QueryValue::Null),
        Type::INT4 => row
            .try_get::<_, Option<i32>>(idx)
            .ok()
            .flatten()
            .map(|v| QueryValue::Int(v as i64))
            .unwrap_or(QueryValue::Null),
        Type::INT8 => row
            .try_get::<_, Option<i64>>(idx)
            .ok()
            .flatten()
            .map(QueryValue::Int)
            .unwrap_or(QueryValue::Null),
        Type::FLOAT4 => row
            .try_get::<_, Option<f32>>(idx)
            .ok()
            .flatten()
            .map(|v| QueryValue::Double(v as f64))
            .unwrap_or(QueryValue::Null),
        Type::FLOAT8 => row
            .try_get::<_, Option<f64>>(idx)
            .ok()
            .flatten()
            .map(QueryValue::Double)
            .unwrap_or(QueryValue::Null),
        Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME => row
            .try_get::<_, Option<String>>(idx)
            .ok()
            .flatten()
            .map(QueryValue::Text)
            .unwrap_or(QueryValue::Null),
        Type::NUMERIC => row
            .try_get::<_, Option<PgNumeric>>(idx)
            .ok()
            .flatten()
            .map(|n| QueryValue::Decimal(n.0))
            .unwrap_or(QueryValue::Null),
        Type::BYTEA => row
            .try_get::<_, Option<Vec<u8>>>(idx)
            .ok()
            .flatten()
            .map(QueryValue::Data)
            .unwrap_or(QueryValue::Null),
        Type::JSON | Type::JSONB => row
            .try_get::<_, Option<serde_json::Value>>(idx)
            .ok()
            .flatten()
            .map(|v| QueryValue::Json(v.to_string()))
            .unwrap_or(QueryValue::Null),
        Type::UUID => row
            .try_get::<_, Option<uuid::Uuid>>(idx)
            .ok()
            .flatten()
            .map(|v| QueryValue::Text(v.to_string()))
            .unwrap_or(QueryValue::Null),
        Type::TIMESTAMP => row
            .try_get::<_, Option<chrono::NaiveDateTime>>(idx)
            .ok()
            .flatten()
            .map(|v| QueryValue::Text(v.to_string()))
            .unwrap_or(QueryValue::Null),
        Type::TIMESTAMPTZ => row
            .try_get::<_, Option<chrono::DateTime<chrono::Utc>>>(idx)
            .ok()
            .flatten()
            .map(|v| QueryValue::Text(v.to_rfc3339()))
            .unwrap_or(QueryValue::Null),
        Type::DATE => row
            .try_get::<_, Option<chrono::NaiveDate>>(idx)
            .ok()
            .flatten()
            .map(|v| QueryValue::Text(v.to_string()))
            .unwrap_or(QueryValue::Null),
        Type::TIME => row
            .try_get::<_, Option<chrono::NaiveTime>>(idx)
            .ok()
            .flatten()
            .map(|v| QueryValue::Text(v.to_string()))
            .unwrap_or(QueryValue::Null),
        _ => row
            .try_get::<_, Option<String>>(idx)
            .ok()
            .flatten()
            .map(QueryValue::Text)
            .unwrap_or(QueryValue::Null),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pg_value_debug_includes_inner() {
        let v = QueryValue::Int(7);
        let p = PgValue(&v);
        let s = format!("{p:?}");
        assert!(s.contains("Int"));
    }

    /// Build a NUMERIC binary payload from header fields + base-10000 digits.
    fn numeric_bytes(digits: &[i16], weight: i16, sign: u16, dscale: u16) -> Vec<u8> {
        let mut v = Vec::with_capacity(8 + digits.len() * 2);
        v.extend_from_slice(&(digits.len() as i16).to_be_bytes());
        v.extend_from_slice(&weight.to_be_bytes());
        v.extend_from_slice(&sign.to_be_bytes());
        v.extend_from_slice(&dscale.to_be_bytes());
        for d in digits {
            v.extend_from_slice(&d.to_be_bytes());
        }
        v
    }

    fn decode(digits: &[i16], weight: i16, sign: u16, dscale: u16) -> String {
        PgNumeric::decode(&numeric_bytes(digits, weight, sign, dscale))
            .expect("valid numeric payload")
    }

    #[test]
    fn numeric_decodes_fraction() {
        // 1234.5678
        assert_eq!(decode(&[1234, 5678], 0, NUMERIC_POS, 4), "1234.5678");
    }

    #[test]
    fn numeric_pads_trailing_scale_zeros() {
        // 100.00 — fractional groups absent, padded to dscale.
        assert_eq!(decode(&[100], 0, NUMERIC_POS, 2), "100.00");
    }

    #[test]
    fn numeric_decodes_negative_integer() {
        assert_eq!(decode(&[42], 0, NUMERIC_NEG, 0), "-42");
    }

    #[test]
    fn numeric_decodes_zero() {
        assert_eq!(decode(&[], 0, NUMERIC_POS, 0), "0");
    }

    #[test]
    fn numeric_decodes_zero_with_scale() {
        assert_eq!(decode(&[], 0, NUMERIC_POS, 2), "0.00");
    }

    #[test]
    fn numeric_decodes_leading_zero_fraction() {
        // 0.0001234 — weight < 0, integer part collapses to "0".
        assert_eq!(decode(&[1, 2340], -1, NUMERIC_POS, 7), "0.0001234");
    }

    #[test]
    fn numeric_preserves_precision_beyond_f64() {
        // 1.00000001 — 8 fractional digits, exact.
        assert_eq!(decode(&[1, 0, 1], 0, NUMERIC_POS, 8), "1.00000001");
    }

    #[test]
    fn numeric_preserves_integer_beyond_i64() {
        // 99999999999999999999 (20 nines) — exceeds i64::MAX, stays exact.
        assert_eq!(
            decode(&[9999, 9999, 9999, 9999, 9999], 4, NUMERIC_POS, 0),
            "99999999999999999999"
        );
    }

    #[test]
    fn numeric_decodes_trailing_integer_zero_groups() {
        // 10000 — single digit at weight 1, trailing group implied zero.
        assert_eq!(decode(&[1], 1, NUMERIC_POS, 0), "10000");
    }

    #[test]
    fn numeric_decodes_nan() {
        assert_eq!(decode(&[], 0, NUMERIC_NAN, 0), "NaN");
    }

    #[test]
    fn numeric_rejects_truncated_payload() {
        // Header claims 2 digits but only 1 is present.
        let mut raw = numeric_bytes(&[1234, 5678], 0, NUMERIC_POS, 4);
        raw.truncate(raw.len() - 2);
        assert!(PgNumeric::decode(&raw).is_none());
    }
}
