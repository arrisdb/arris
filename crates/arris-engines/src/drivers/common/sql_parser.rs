use sqlparser::ast::Statement;
use sqlparser::dialect::Dialect;
use sqlparser::parser::Parser;

#[derive(Debug, Default)]
struct DriverDialect;

impl Dialect for DriverDialect {
    fn is_identifier_start(&self, ch: char) -> bool {
        ch.is_alphabetic() || ch == '_' || ch == '#' || ch == '@' || ch == '$'
    }

    fn is_identifier_part(&self, ch: char) -> bool {
        ch.is_alphanumeric() || ch == '_' || ch == '#' || ch == '@' || ch == '$'
    }

    fn is_delimited_identifier_start(&self, ch: char) -> bool {
        ch == '"' || ch == '`'
    }
}

pub fn parse_sql_statement(sql: &str) -> Result<Statement, String> {
    let trimmed = crate::QueryEngine::trim_trailing_sql_semicolon(sql);
    let stmts =
        Parser::parse_sql(&DriverDialect, trimmed).map_err(|e| e.to_string())?;
    stmts
        .into_iter()
        .next()
        .ok_or_else(|| "Empty query".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_select() {
        let stmt = parse_sql_statement("SELECT * FROM t").unwrap();
        assert!(matches!(stmt, Statement::Query(_)));
    }

    #[test]
    fn parses_dollar_identifier() {
        let stmt = parse_sql_statement("SELECT $city FROM t").unwrap();
        assert!(matches!(stmt, Statement::Query(_)));
    }

    #[test]
    fn parses_backtick_identifier() {
        let stmt = parse_sql_statement("SELECT * FROM `my-topic`").unwrap();
        assert!(matches!(stmt, Statement::Query(_)));
    }

    #[test]
    fn rejects_empty_input() {
        assert!(parse_sql_statement("").is_err());
    }

    #[test]
    fn strips_trailing_semicolon() {
        let stmt = parse_sql_statement("SELECT 1;").unwrap();
        assert!(matches!(stmt, Statement::Query(_)));
    }
}
