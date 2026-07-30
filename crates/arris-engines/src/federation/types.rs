use serde::Serialize;

use super::constants::REF_SEPARATOR;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
pub struct FederationRef {
    pub connection: String,
    pub schema: Option<String>,
    pub table: String,
}

impl FederationRef {
    /// Also the name the ref's provider is registered under, quoted on the way
    /// back into SQL, so no name needs sanitizing.
    pub fn dotted_name(&self) -> String {
        match &self.schema {
            Some(s) => format!(
                "{}{REF_SEPARATOR}{}{REF_SEPARATOR}{}",
                self.connection, s, self.table
            ),
            None => format!("{}{REF_SEPARATOR}{}", self.connection, self.table),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct FederationResult {
    pub query: String,
    pub references: Vec<FederationRef>,
}
