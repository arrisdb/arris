use super::constants::{READ_ONLY_FIRST_KEYWORDS, WRITE_KEYWORDS};

/// Decides whether SQL may run without a click. Errs towards "no": a false negative
/// costs one click, a false positive writes to a database nobody approved.
pub struct ReadOnlySql;

impl ReadOnlySql {
    pub fn check(sql: &str) -> bool {
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
            "",
        ] {
            assert!(!ReadOnlySql::check(sql), "{sql}");
        }
    }
}
