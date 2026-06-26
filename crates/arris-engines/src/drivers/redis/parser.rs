use crate::DriverError;

use crate::drivers::errors::Result;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum RedisSqlQuery {
    Keys { db: Option<i64>, pattern: String, limit: usize },
    Key { db: Option<i64>, key: String },
}

/// Splits an optional `dbN.` database selector off the front of a FROM source.
/// `db1.cache:stats` -> (Some(1), "cache:stats"); `customers:1` -> (None, "customers:1").
fn split_db_prefix(source: &str) -> (Option<i64>, String) {
    if let Some(rest) = source.strip_prefix("db") {
        if let Some(dot) = rest.find('.') {
            let (num, key) = (&rest[..dot], &rest[dot + 1..]);
            if !num.is_empty() && num.bytes().all(|b| b.is_ascii_digit()) {
                if let Ok(db) = num.parse::<i64>() {
                    return (Some(db), key.to_string());
                }
            }
        }
    }
    (None, source.to_string())
}

pub(super) fn parse_commands(text: &str) -> Vec<Vec<String>> {
    text.lines()
        .map(|line| line.trim())
        .map(|line| line.strip_suffix(';').unwrap_or(line).trim_end())
        .filter(|line| !line.is_empty() && !line.starts_with('#') && !line.starts_with("//"))
        .map(parse_command_line)
        .collect()
}

fn parse_command_line(line: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut chars = line.chars().peekable();

    while let Some(&ch) = chars.peek() {
        if ch.is_whitespace() {
            chars.next();
            continue;
        }

        if ch == '"' || ch == '\'' {
            chars.next();
            let mut token = String::new();
            while let Some(&c) = chars.peek() {
                if c == ch {
                    chars.next();
                    break;
                }
                if c == '\\' {
                    chars.next();
                    if let Some(&escaped) = chars.peek() {
                        match escaped {
                            'n' => token.push('\n'),
                            't' => token.push('\t'),
                            '\\' => token.push('\\'),
                            _ => {
                                token.push(escaped);
                            }
                        }
                        chars.next();
                        continue;
                    }
                }
                token.push(c);
                chars.next();
            }
            args.push(token);
        } else {
            let mut token = String::new();
            while let Some(&c) = chars.peek() {
                if c.is_whitespace() {
                    break;
                }
                token.push(c);
                chars.next();
            }
            args.push(token);
        }
    }

    if let Some(first) = args.first_mut() {
        *first = first.to_uppercase();
    }
    args
}

pub(super) fn parse_redis_sql(text: &str) -> Result<Option<RedisSqlQuery>> {
    let statement = text
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with("--")
                && !line.starts_with('#')
                && !line.starts_with("//")
        })
        .collect::<Vec<_>>()
        .join(" ");
    let statement = statement.trim().trim_end_matches(';').trim();
    if statement.is_empty() {
        return Ok(None);
    }

    let tokens = tokenize_redis_sql(statement);
    if tokens.is_empty() || !eq_token(&tokens[0], "select") {
        return Ok(None);
    }

    let from_idx = tokens
        .iter()
        .position(|token| eq_token(token, "from"))
        .ok_or_else(|| DriverError::InvalidArgument("Redis SQL requires FROM".into()))?;
    let raw_source = tokens
        .get(from_idx + 1)
        .ok_or_else(|| DriverError::InvalidArgument("Redis SQL requires a source".into()))?;
    let (db, source) = split_db_prefix(raw_source);

    let limit = parse_sql_limit(&tokens)?.unwrap_or(1000);
    if eq_token(&source, "keys") || eq_token(&source, "keyspace") {
        let pattern = parse_sql_pattern(&tokens)?.unwrap_or_else(|| "*".into());
        return Ok(Some(RedisSqlQuery::Keys { db, pattern, limit }));
    }

    Ok(Some(RedisSqlQuery::Key { db, key: source }))
}

fn parse_sql_limit(tokens: &[String]) -> Result<Option<usize>> {
    let Some(idx) = tokens.iter().position(|token| eq_token(token, "limit")) else {
        return Ok(None);
    };
    let raw = tokens
        .get(idx + 1)
        .ok_or_else(|| DriverError::InvalidArgument("Redis SQL LIMIT requires a value".into()))?;
    raw.parse::<usize>()
        .map(Some)
        .map_err(|_| DriverError::InvalidArgument("Redis SQL LIMIT must be a number".into()))
}

fn parse_sql_pattern(tokens: &[String]) -> Result<Option<String>> {
    let Some(idx) = tokens.iter().position(|token| eq_token(token, "where")) else {
        return Ok(None);
    };
    let field = tokens
        .get(idx + 1)
        .ok_or_else(|| DriverError::InvalidArgument("Redis SQL WHERE requires a field".into()))?;
    let op = tokens.get(idx + 2).ok_or_else(|| {
        DriverError::InvalidArgument("Redis SQL WHERE requires an operator".into())
    })?;
    let value = tokens
        .get(idx + 3)
        .ok_or_else(|| DriverError::InvalidArgument("Redis SQL WHERE requires a value".into()))?;

    if !(eq_token(field, "key") || eq_token(field, "pattern") || eq_token(field, "match")) {
        return Err(DriverError::InvalidArgument(
            "Redis SQL WHERE supports key, pattern, or match".into(),
        ));
    }
    if !(op == "=" || eq_token(op, "like")) {
        return Err(DriverError::InvalidArgument(
            "Redis SQL WHERE supports = or LIKE".into(),
        ));
    }

    Ok(Some(value.clone()))
}

fn tokenize_redis_sql(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut chars = input.chars().peekable();

    while let Some(&ch) = chars.peek() {
        if ch.is_whitespace() || matches!(ch, ',' | ';' | '(' | ')') {
            chars.next();
            continue;
        }
        if ch == '=' || ch == '*' {
            tokens.push(ch.to_string());
            chars.next();
            continue;
        }
        if ch == '\'' || ch == '"' || ch == '`' {
            chars.next();
            let mut token = String::new();
            while let Some(&c) = chars.peek() {
                chars.next();
                if c == ch {
                    break;
                }
                if c == '\\' {
                    if let Some(&escaped) = chars.peek() {
                        token.push(escaped);
                        chars.next();
                    }
                } else {
                    token.push(c);
                }
            }
            tokens.push(token);
            continue;
        }

        let mut token = String::new();
        while let Some(&c) = chars.peek() {
            if c.is_whitespace() || matches!(c, ',' | ';' | '(' | ')' | '=') {
                break;
            }
            token.push(c);
            chars.next();
        }
        tokens.push(token);
    }

    tokens
}

fn eq_token(actual: &str, expected: &str) -> bool {
    actual.eq_ignore_ascii_case(expected)
}
