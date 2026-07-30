use std::hash::{DefaultHasher, Hash, Hasher};

use serde::Serialize;

use super::constants::{ALIAS_SEPARATOR, IDENT_UNDERSCORE, REF_SEPARATOR};

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
pub struct FederationRef {
    pub connection: String,
    pub schema: Option<String>,
    pub table: String,
}

impl FederationRef {
    pub fn dotted_name(&self) -> String {
        match &self.schema {
            Some(s) => format!(
                "{}{REF_SEPARATOR}{}{REF_SEPARATOR}{}",
                self.connection, s, self.table
            ),
            None => format!("{}{REF_SEPARATOR}{}", self.connection, self.table),
        }
    }

    /// Table name this ref is registered under in DataFusion.
    pub fn local_alias(&self) -> String {
        let joined = match &self.schema {
            Some(s) => format!(
                "{}{ALIAS_SEPARATOR}{}{ALIAS_SEPARATOR}{}",
                self.connection, s, self.table
            ),
            None => format!("{}{ALIAS_SEPARATOR}{}", self.connection, self.table),
        };
        Self::to_bare_identifier(&joined)
    }

    /// A quoted name may hold anything, so illegal chars collapse to `_`. That is
    /// lossy, hence the hash suffix: `my conn` and `my-conn` stay distinct tables.
    fn to_bare_identifier(joined: &str) -> String {
        let mut out: String = joined
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == IDENT_UNDERSCORE {
                    c
                } else {
                    IDENT_UNDERSCORE
                }
            })
            .collect();
        if out.starts_with(|c: char| c.is_ascii_digit()) {
            out.insert(0, IDENT_UNDERSCORE);
        }
        if out == joined {
            return out;
        }
        let mut hasher = DefaultHasher::new();
        joined.hash(&mut hasher);
        format!("{out}{ALIAS_SEPARATOR}{:016x}", hasher.finish())
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct FederationResult {
    pub query: String,
    pub references: Vec<FederationRef>,
}
