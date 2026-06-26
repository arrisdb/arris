use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
pub struct FederationRef {
    pub connection: String,
    pub schema: Option<String>,
    pub table: String,
}

impl FederationRef {
    pub fn dotted_name(&self) -> String {
        match &self.schema {
            Some(s) => format!("{}.{}.{}", self.connection, s, self.table),
            None => format!("{}.{}", self.connection, self.table),
        }
    }

    pub fn local_alias(&self) -> String {
        match &self.schema {
            Some(s) => format!("{}__{}__{}", self.connection, s, self.table),
            None => format!("{}__{}", self.connection, self.table),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct FederationResult {
    pub query: String,
    pub references: Vec<FederationRef>,
}
