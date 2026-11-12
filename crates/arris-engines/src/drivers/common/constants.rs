/// Leading keywords of statements that can only read.
pub(super) const READ_ONLY_FIRST_KEYWORDS: [&str; 6] =
    ["SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "VALUES"];
/// Any of these anywhere in a statement means it may write.
pub(super) const WRITE_KEYWORDS: [&str; 19] = [
    "INSERT", "UPDATE", "DELETE", "MERGE", "UPSERT", "REPLACE", "DROP", "ALTER", "CREATE",
    "TRUNCATE", "GRANT", "REVOKE", "INTO", "CALL", "EXEC", "EXECUTE", "COPY", "VACUUM", "SET",
];
