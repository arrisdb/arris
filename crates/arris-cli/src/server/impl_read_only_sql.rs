use super::{
    MONGO_READ_METHODS, MONGO_SHELL_STMT_PREFIX, MONGO_VALUE_HELPERS, MONGO_WRITE_STAGES,
    READ_ONLY_FIRST_KEYWORDS, WRITE_KEYWORDS,
};

/// Decides whether SQL may run without a click. Errs towards "no": a false negative
/// costs one click, a false positive writes to a database nobody approved.
pub struct ReadOnlySql;

impl ReadOnlySql {
    pub fn check(sql: &str) -> bool {
        if sql.trim_start().starts_with(MONGO_SHELL_STMT_PREFIX) {
            return Self::check_mongo(sql);
        }
        let code = Self::strip_literals_and_comments(sql);
        let trimmed = code.trim().trim_end_matches(';');
        if trimmed.contains(';') {
            return false;
        }
        let mut words = trimmed
            .split(|c: char| !c.is_alphanumeric() && c != '_')
            .filter(|w| !w.is_empty())
            .map(str::to_ascii_uppercase);
        let starts_read_only = words
            .next()
            .is_some_and(|w| READ_ONLY_FIRST_KEYWORDS.contains(&w.as_str()));
        starts_read_only && !words.any(|w| WRITE_KEYWORDS.contains(&w.as_str()))
    }

    /// One `db.` statement whose every call is a read method or a value helper.
    fn check_mongo(stmt: &str) -> bool {
        if MONGO_WRITE_STAGES.iter().any(|stage| stmt.contains(stage)) {
            return false;
        }
        let code = Self::strip_literals_and_comments(stmt);
        let trimmed = code.trim().trim_end_matches(';');
        if trimmed.contains(';') {
            return false;
        }
        trimmed.match_indices('(').all(|(at, _)| {
            let before = &trimmed[..at];
            let name_start = before
                .rfind(|c: char| !c.is_alphanumeric() && c != '_')
                .map_or(0, |i| i + 1);
            let name = &before[name_start..];
            if before[..name_start].trim_end().ends_with('.') {
                MONGO_READ_METHODS.contains(&name)
            } else {
                name.is_empty() || MONGO_VALUE_HELPERS.contains(&name)
            }
        })
    }

    fn strip_literals_and_comments(sql: &str) -> String {
        let mut out = String::with_capacity(sql.len());
        let mut chars = sql.chars().peekable();
        while let Some(c) = chars.next() {
            match c {
                '\'' | '"' | '`' => {
                    for next in chars.by_ref() {
                        if next == c {
                            break;
                        }
                    }
                    out.push(' ');
                }
                '-' if chars.peek() == Some(&'-') => {
                    for next in chars.by_ref() {
                        if next == '\n' {
                            break;
                        }
                    }
                    out.push(' ');
                }
                '/' if chars.peek() == Some(&'*') => {
                    chars.next();
                    let mut previous = ' ';
                    for next in chars.by_ref() {
                        if previous == '*' && next == '/' {
                            break;
                        }
                        previous = next;
                    }
                    out.push(' ');
                }
                _ => out.push(c),
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_run_without_a_click() {
        for sql in [
            "SELECT * FROM t;",
            "  select 'DELETE; it' from t",
            "-- drop this\nSELECT 1",
            "/* update */ SELECT 1",
            "WITH a AS (SELECT 1) SELECT * FROM a",
            "SHOW TABLES",
            "db.orders.countDocuments({})",
            "db.orders.find({ status: 'paid', at: { $gt: ISODate('2025-01-01') } }).sort({ at: -1 }).limit(5)",
            "db.orders.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])",
            "db.getCollectionNames()",
        ] {
            assert!(ReadOnlySql::check(sql), "{sql}");
        }
    }

    #[test]
    fn writes_and_anything_doubtful_wait_for_a_click() {
        for sql in [
            "INSERT INTO t VALUES (1)",
            "update t set x = 1",
            "DROP TABLE t",
            "WITH a AS (DELETE FROM t RETURNING *) SELECT * FROM a",
            "SELECT * INTO copy FROM t",
            "SELECT 1; DELETE FROM t",
            "EXPLAIN ANALYZE DELETE FROM t",
            "SELECT * FROM t FOR UPDATE",
            "-- only a comment",
            "db.orders.insertOne({ a: 1 })",
            "db.orders.find({}).forEach(printjson)",
            "db.orders.aggregate([{ $out: 'copy' }])",
            "db.orders.aggregate([{ '$merge': { into: 'copy' } }])",
            "db.orders.find({}); db.orders.drop()",
            "db.dropDatabase()",
            "",
        ] {
            assert!(!ReadOnlySql::check(sql), "{sql}");
        }
    }
}
