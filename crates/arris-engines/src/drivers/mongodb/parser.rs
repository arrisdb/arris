//! Native Mongo shell-style request parser. Mirrors the Swift
//! `MongoRequest` parser: `db.<coll>.<verb>(<args>).chain(...)` with strict
//! JSON arguments. Phase 1 supports the 10 verbs the Swift app exposes.
//!
//! The namespace before the verb accepts every form a user reaches for:
//! `db.coll.verb()` and bare `coll.verb()` (connection's current database),
//! `<database>.coll.verb()` (e.g. `appdb.customers.find()`), and
//! `db.<database>.coll.verb()`. A single trailing `;` is tolerated.
//!
//! Example inputs:
//!
//! ```text
//! db.users.find({"active":true}).limit(5)
//! db.orders.aggregate([{"$match":{"x":1}},{"$group":{"_id":"$y","n":{"$sum":1}}}])
//! db.users.insertOne({"name":"a"})
//! db.users.updateMany({"x":1},{"$set":{"y":2}})
//! db.users.deleteOne({"_id":"abc"})
//! ```
//!
//! Expressions outside strict JSON (shell helpers like `ObjectId(...)`,
//! `ISODate(...)`) are deliberately rejected — Phase 2 will reuse this
//! parser inside the language module to provide proper highlighting.

#[derive(Clone, Debug, PartialEq)]
pub struct MongoRequest {
    pub database: Option<String>,
    pub collection: String,
    pub verb: Verb,
    /// Strict-JSON arguments, in source order. `find()` accepts up to two
    /// (filter, projection); aggregate accepts a single pipeline array.
    pub args: Vec<serde_json::Value>,
    pub chain: Vec<Chain>,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Verb {
    Find,
    FindOne,
    Aggregate,
    CountDocuments,
    EstimatedDocumentCount,
    InsertOne,
    InsertMany,
    UpdateOne,
    UpdateMany,
    DeleteOne,
    DeleteMany,
}

impl Verb {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Find => "find",
            Self::FindOne => "findOne",
            Self::Aggregate => "aggregate",
            Self::CountDocuments => "countDocuments",
            Self::EstimatedDocumentCount => "estimatedDocumentCount",
            Self::InsertOne => "insertOne",
            Self::InsertMany => "insertMany",
            Self::UpdateOne => "updateOne",
            Self::UpdateMany => "updateMany",
            Self::DeleteOne => "deleteOne",
            Self::DeleteMany => "deleteMany",
        }
    }

    pub fn is_read(self) -> bool {
        matches!(
            self,
            Self::Find
                | Self::FindOne
                | Self::Aggregate
                | Self::CountDocuments
                | Self::EstimatedDocumentCount
        )
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Chain {
    Limit(i64),
    Skip(i64),
    Sort(serde_json::Value),
    Project(serde_json::Value),
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ParseError {
    #[error("expected `db.<collection>.<verb>(...)`: {0}")]
    Shape(String),
    #[error("unknown verb '{0}'")]
    UnknownVerb(String),
    #[error("invalid JSON in argument {index}: {message}")]
    InvalidJson { index: usize, message: String },
    #[error("verb '{verb}' expects {expected} arg(s), got {got}")]
    ArgCount {
        verb: &'static str,
        expected: &'static str,
        got: usize,
    },
    #[error("chain `{0}` not supported (allowed: limit, skip, sort, project)")]
    UnknownChain(String),
}

pub fn parse(input: &str) -> Result<MongoRequest, ParseError> {
    // mongosh statements may terminate with a single `;` — tolerate one.
    let trimmed = input.trim();
    let trimmed = trimmed.strip_suffix(';').unwrap_or(trimmed).trim_end();
    let mut p = Parser::new(trimmed);

    // Read the dotted path up to the verb. The verb is the final identifier —
    // the one immediately followed by `(`. Everything before it is the
    // namespace (`[db.]<database>.<collection>` or `[db.]<collection>`).
    let mut idents = Vec::new();
    loop {
        idents.push(p.read_identifier()?);
        p.skip_whitespace();
        match p.peek_char() {
            Some('.') => p.expect_char('.')?,
            Some('(') => break,
            _ => {
                return Err(ParseError::Shape(format!(
                    "expected `.` or `(` at: {}",
                    p.tail()
                )))
            }
        }
    }
    if idents.len() < 2 {
        return Err(ParseError::Shape(
            "expected `[<database>.]<collection>.<verb>(...)`".into(),
        ));
    }
    let verb_name = idents.pop().expect("len checked >= 2");
    // A literal leading `db` means "the connection's current database"; drop it
    // so the remaining segments are the real database/collection path.
    let mut ns: &[String] = &idents;
    if ns.len() > 1 && ns[0] == "db" {
        ns = &ns[1..];
    }
    let (database, collection) = match ns {
        [collection] => (None, collection.clone()),
        [database, collection] => (Some(database.clone()), collection.clone()),
        _ => {
            return Err(ParseError::Shape(format!(
                "expected `[db.][<database>.]<collection>.<verb>` — too many path segments: {}",
                idents.join(".")
            )))
        }
    };
    let verb = parse_verb(&verb_name)?;
    let args_raw = p.read_paren_group()?;
    let args = split_top_level_args(&args_raw)
        .into_iter()
        .enumerate()
        .map(|(i, raw)| {
            serde_json::from_str::<serde_json::Value>(raw.trim()).map_err(|e| {
                ParseError::InvalidJson {
                    index: i,
                    message: e.to_string(),
                }
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    validate_arg_count(verb, args.len())?;

    let mut chain = Vec::new();
    while p.skip_whitespace() && p.peek_char() == Some('.') {
        p.expect_char('.')?;
        let name = p.read_identifier()?;
        let raw = p.read_paren_group()?;
        let parts = split_top_level_args(&raw);
        chain.push(parse_chain(&name, &parts)?);
    }

    p.skip_whitespace();
    if !p.is_eof() {
        return Err(ParseError::Shape(format!(
            "unexpected trailing input: {}",
            p.tail()
        )));
    }

    Ok(MongoRequest {
        database,
        collection,
        verb,
        args,
        chain,
    })
}

fn parse_verb(name: &str) -> Result<Verb, ParseError> {
    Ok(match name {
        "find" => Verb::Find,
        "findOne" => Verb::FindOne,
        "aggregate" => Verb::Aggregate,
        "countDocuments" => Verb::CountDocuments,
        "estimatedDocumentCount" => Verb::EstimatedDocumentCount,
        "insertOne" => Verb::InsertOne,
        "insertMany" => Verb::InsertMany,
        "updateOne" => Verb::UpdateOne,
        "updateMany" => Verb::UpdateMany,
        "deleteOne" => Verb::DeleteOne,
        "deleteMany" => Verb::DeleteMany,
        other => return Err(ParseError::UnknownVerb(other.to_owned())),
    })
}

fn parse_chain(name: &str, args: &[String]) -> Result<Chain, ParseError> {
    let single_int = || -> Result<i64, ParseError> {
        if args.len() != 1 {
            return Err(ParseError::ArgCount {
                verb: "chain",
                expected: "1",
                got: args.len(),
            });
        }
        args[0]
            .trim()
            .parse::<i64>()
            .map_err(|e| ParseError::InvalidJson {
                index: 0,
                message: e.to_string(),
            })
    };
    let single_json = || -> Result<serde_json::Value, ParseError> {
        if args.len() != 1 {
            return Err(ParseError::ArgCount {
                verb: "chain",
                expected: "1",
                got: args.len(),
            });
        }
        serde_json::from_str(args[0].trim()).map_err(|e| ParseError::InvalidJson {
            index: 0,
            message: e.to_string(),
        })
    };
    Ok(match name {
        "limit" => Chain::Limit(single_int()?),
        "skip" => Chain::Skip(single_int()?),
        "sort" => Chain::Sort(single_json()?),
        "project" | "projection" => Chain::Project(single_json()?),
        other => return Err(ParseError::UnknownChain(other.to_owned())),
    })
}

fn validate_arg_count(verb: Verb, got: usize) -> Result<(), ParseError> {
    let allowed: &[usize] = match verb {
        Verb::Find | Verb::FindOne => &[0, 1, 2],
        Verb::Aggregate => &[1],
        Verb::CountDocuments => &[0, 1],
        Verb::EstimatedDocumentCount => &[0],
        Verb::InsertOne => &[1],
        Verb::InsertMany => &[1],
        Verb::UpdateOne | Verb::UpdateMany => &[2],
        Verb::DeleteOne | Verb::DeleteMany => &[1],
    };
    if !allowed.contains(&got) {
        let expected = match verb {
            Verb::Find | Verb::FindOne => "0..2",
            Verb::CountDocuments => "0..1",
            Verb::EstimatedDocumentCount => "0",
            Verb::Aggregate
            | Verb::InsertOne
            | Verb::InsertMany
            | Verb::DeleteOne
            | Verb::DeleteMany => "1",
            Verb::UpdateOne | Verb::UpdateMany => "2",
        };
        return Err(ParseError::ArgCount {
            verb: verb.as_str(),
            expected,
            got,
        });
    }
    Ok(())
}

/// Splits a top-level argument list (`a, {b:1}, [c,d]`) by commas while
/// honouring brace / bracket / quote nesting. Returns each chunk verbatim
/// (whitespace + all). An empty input returns an empty vector.
fn split_top_level_args(raw: &str) -> Vec<String> {
    if raw.trim().is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut depth_curly = 0i32;
    let mut depth_square = 0i32;
    let mut depth_paren = 0i32;
    let mut in_string: Option<char> = None;
    let mut escape = false;
    let mut start = 0usize;
    let bytes = raw.as_bytes();

    for (i, &b) in bytes.iter().enumerate() {
        let c = b as char;
        if let Some(quote) = in_string {
            if escape {
                escape = false;
            } else if c == '\\' {
                escape = true;
            } else if c == quote {
                in_string = None;
            }
            continue;
        }
        match c {
            '"' | '\'' => in_string = Some(c),
            '{' => depth_curly += 1,
            '}' => depth_curly -= 1,
            '[' => depth_square += 1,
            ']' => depth_square -= 1,
            '(' => depth_paren += 1,
            ')' => depth_paren -= 1,
            ',' if depth_curly == 0 && depth_square == 0 && depth_paren == 0 => {
                out.push(raw[start..i].to_owned());
                start = i + 1;
            }
            _ => {}
        }
    }
    out.push(raw[start..].to_owned());
    out
}

struct Parser<'a> {
    input: &'a str,
    cursor: usize,
}

impl<'a> Parser<'a> {
    fn new(input: &'a str) -> Self {
        Self { input, cursor: 0 }
    }

    fn tail(&self) -> &str {
        &self.input[self.cursor..]
    }

    fn is_eof(&self) -> bool {
        self.cursor >= self.input.len()
    }

    fn peek_char(&self) -> Option<char> {
        self.tail().chars().next()
    }

    fn skip_whitespace(&mut self) -> bool {
        while let Some(c) = self.peek_char() {
            if c.is_whitespace() {
                self.cursor += c.len_utf8();
            } else {
                break;
            }
        }
        !self.is_eof()
    }

    fn expect_char(&mut self, c: char) -> Result<(), ParseError> {
        self.skip_whitespace();
        if self.peek_char() == Some(c) {
            self.cursor += c.len_utf8();
            Ok(())
        } else {
            Err(ParseError::Shape(format!(
                "expected '{c}' at: {}",
                self.tail()
            )))
        }
    }

    fn read_identifier(&mut self) -> Result<String, ParseError> {
        self.skip_whitespace();
        let start = self.cursor;
        while let Some(c) = self.peek_char() {
            if c.is_alphanumeric() || c == '_' || c == '$' {
                self.cursor += c.len_utf8();
            } else {
                break;
            }
        }
        if self.cursor == start {
            return Err(ParseError::Shape(format!(
                "expected identifier at: {}",
                self.tail()
            )));
        }
        Ok(self.input[start..self.cursor].to_owned())
    }

    /// Reads everything between a balanced `( ... )`. Strings and nested
    /// braces / brackets / parens are honoured. Returns the inner slice
    /// (without surrounding parens).
    fn read_paren_group(&mut self) -> Result<String, ParseError> {
        self.expect_char('(')?;
        let start = self.cursor;
        let mut depth = 1i32;
        let mut depth_curly = 0i32;
        let mut depth_square = 0i32;
        let mut in_string: Option<char> = None;
        let mut escape = false;
        let bytes = self.input.as_bytes();
        while self.cursor < bytes.len() {
            let c = bytes[self.cursor] as char;
            if let Some(quote) = in_string {
                if escape {
                    escape = false;
                } else if c == '\\' {
                    escape = true;
                } else if c == quote {
                    in_string = None;
                }
                self.cursor += 1;
                continue;
            }
            match c {
                '"' | '\'' => in_string = Some(c),
                '{' => depth_curly += 1,
                '}' => depth_curly -= 1,
                '[' => depth_square += 1,
                ']' => depth_square -= 1,
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 && depth_curly == 0 && depth_square == 0 {
                        let inner = self.input[start..self.cursor].to_owned();
                        self.cursor += 1; // consume `)`
                        return Ok(inner);
                    }
                }
                _ => {}
            }
            self.cursor += 1;
        }
        Err(ParseError::Shape(
            "unterminated argument list — missing `)`".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_find_no_args() {
        let r = parse("db.users.find()").unwrap();
        assert_eq!(r.database, None);
        assert_eq!(r.collection, "users");
        assert_eq!(r.verb, Verb::Find);
        assert!(r.args.is_empty());
        assert!(r.chain.is_empty());
    }

    #[test]
    fn parses_find_with_filter() {
        let r = parse(r#"db.users.find({"active":true})"#).unwrap();
        assert_eq!(r.verb, Verb::Find);
        assert_eq!(r.args, vec![json!({"active": true})]);
    }

    #[test]
    fn parses_find_with_filter_and_projection() {
        let r = parse(r#"db.users.find({"a":1},{"b":1})"#).unwrap();
        assert_eq!(r.args.len(), 2);
        assert_eq!(r.args[1], json!({"b": 1}));
    }

    #[test]
    fn parses_aggregate_pipeline() {
        let r = parse(r#"db.orders.aggregate([{"$match":{"x":1}},{"$count":"n"}])"#).unwrap();
        assert_eq!(r.verb, Verb::Aggregate);
        assert!(matches!(r.args[0], serde_json::Value::Array(_)));
    }

    #[test]
    fn parses_chain_limit_skip_sort() {
        let r = parse(r#"db.users.find({}).limit(10).skip(5).sort({"id":-1})"#).unwrap();
        assert_eq!(r.chain.len(), 3);
        assert_eq!(r.chain[0], Chain::Limit(10));
        assert_eq!(r.chain[1], Chain::Skip(5));
        assert!(matches!(r.chain[2], Chain::Sort(_)));
    }

    #[test]
    fn parses_insert_update_delete() {
        let r = parse(r#"db.users.insertOne({"x":1})"#).unwrap();
        assert_eq!(r.verb, Verb::InsertOne);

        let r = parse(r#"db.users.updateMany({"x":1},{"$set":{"y":2}})"#).unwrap();
        assert_eq!(r.verb, Verb::UpdateMany);
        assert_eq!(r.args.len(), 2);

        let r = parse(r#"db.users.deleteOne({"_id":"abc"})"#).unwrap();
        assert_eq!(r.verb, Verb::DeleteOne);
    }

    #[test]
    fn rejects_unknown_verb() {
        let err = parse("db.users.foo()").unwrap_err();
        assert!(matches!(err, ParseError::UnknownVerb(_)));
    }

    #[test]
    fn rejects_unknown_chain() {
        let err = parse("db.users.find().explain()").unwrap_err();
        assert!(matches!(err, ParseError::UnknownChain(_)));
    }

    #[test]
    fn rejects_invalid_json() {
        let err = parse("db.users.find({bad})").unwrap_err();
        assert!(matches!(err, ParseError::InvalidJson { .. }));
    }

    #[test]
    fn rejects_wrong_arg_count() {
        let err = parse("db.users.updateOne({})").unwrap_err();
        assert!(matches!(err, ParseError::ArgCount { .. }));
    }

    #[test]
    fn allows_whitespace_and_newlines_inside_args() {
        let r = parse("db.users.find({\n  \"a\": 1\n})").unwrap();
        assert_eq!(r.args, vec![json!({"a": 1})]);
    }

    #[test]
    fn split_top_level_args_handles_nested_braces() {
        let parts = split_top_level_args(r#"{"a":1,"b":2},{"c":3}"#);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], r#"{"a":1,"b":2}"#);
        assert_eq!(parts[1], r#"{"c":3}"#);
    }

    #[test]
    fn split_top_level_args_handles_strings_with_commas() {
        let parts = split_top_level_args(r#"{"k":"a,b"},{"k":"c"}"#);
        assert_eq!(parts.len(), 2);
    }

    #[test]
    fn collection_can_have_underscores_and_digits() {
        let r = parse("db.event_log_2025.find()").unwrap();
        assert_eq!(r.collection, "event_log_2025");
    }

    #[test]
    fn parses_database_qualified_collection() {
        let r = parse("db.appdb.customers.find({})").unwrap();
        assert_eq!(r.database.as_deref(), Some("appdb"));
        assert_eq!(r.collection, "customers");
        assert_eq!(r.verb, Verb::Find);
    }

    #[test]
    fn parses_database_name_as_leading_segment() {
        // `appdb.customers.find()` — leading segment is a real database name,
        // not the literal `db` keyword.
        let r = parse("appdb.customers.find()").unwrap();
        assert_eq!(r.database.as_deref(), Some("appdb"));
        assert_eq!(r.collection, "customers");
        assert_eq!(r.verb, Verb::Find);
        assert!(r.args.is_empty());
    }

    #[test]
    fn parses_bare_collection() {
        // `customers.find()` — no database, falls back to the connection default.
        let r = parse("customers.find({\"a\":1})").unwrap();
        assert_eq!(r.database, None);
        assert_eq!(r.collection, "customers");
        assert_eq!(r.verb, Verb::Find);
        assert_eq!(r.args, vec![json!({"a": 1})]);
    }

    #[test]
    fn tolerates_single_trailing_semicolon() {
        let r = parse("appdb.customers.find();").unwrap();
        assert_eq!(r.database.as_deref(), Some("appdb"));
        assert_eq!(r.collection, "customers");
        assert_eq!(r.verb, Verb::Find);

        // Trailing whitespace around the `;` is fine too.
        let r = parse("  db.users.find()  ;  ").unwrap();
        assert_eq!(r.collection, "users");
    }

    #[test]
    fn trailing_semicolon_works_with_chains() {
        let r = parse("appdb.users.find({}).limit(5);").unwrap();
        assert_eq!(r.database.as_deref(), Some("appdb"));
        assert_eq!(r.chain, vec![Chain::Limit(5)]);
    }

    #[test]
    fn rejects_too_many_path_segments() {
        let err = parse("a.b.c.d.find()").unwrap_err();
        assert!(matches!(err, ParseError::Shape(_)));
    }

    #[test]
    fn rejects_missing_verb() {
        let err = parse("customers").unwrap_err();
        assert!(matches!(err, ParseError::Shape(_)));
    }

    #[test]
    fn rejects_trailing_garbage() {
        let err = parse("db.users.find()  garbage").unwrap_err();
        assert!(matches!(err, ParseError::Shape(_)));
    }
}
