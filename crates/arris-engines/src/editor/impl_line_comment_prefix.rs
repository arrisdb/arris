use serde::Serialize;

#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize)]
pub struct LineCommentPrefix {
    pub leading: &'static str,
}

impl LineCommentPrefix {
    pub const fn new(leading: &'static str) -> Self {
        Self { leading }
    }

    pub fn for_language(language_id: &str) -> Option<Self> {
        Some(Self::new(match language_id {
            "sql" | "postgres" | "mysql" | "mariadb" | "sqlite" | "mssql" | "oracle"
            | "snowflake" | "redshift" | "bigquery" | "duckdb" | "clickhouse"
            | "mongodb" => "--",
            "mongoshell" | "javascript" | "typescript" | "kafkasql" | "redis" => "//",
            "python" | "yaml" | "toml" | "dockerfile" | "makefile" | "bash" | "shell" => "#",
            _ => return None,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sql_dialects_use_double_dash() {
        for lang in [
            "sql",
            "postgres",
            "mysql",
            "mssql",
            "snowflake",
            "duckdb",
            "mongodb",
        ] {
            assert_eq!(
                LineCommentPrefix::for_language(lang).unwrap().leading,
                "--",
                "lang={lang}"
            );
        }
    }

    #[test]
    fn mongoshell_and_javascript_use_double_slash() {
        assert_eq!(
            LineCommentPrefix::for_language("mongoshell").unwrap().leading,
            "//"
        );
        assert_eq!(
            LineCommentPrefix::for_language("javascript").unwrap().leading,
            "//"
        );
    }

    #[test]
    fn python_yaml_toml_use_hash() {
        assert_eq!(
            LineCommentPrefix::for_language("python").unwrap().leading,
            "#"
        );
        assert_eq!(
            LineCommentPrefix::for_language("yaml").unwrap().leading,
            "#"
        );
        assert_eq!(
            LineCommentPrefix::for_language("toml").unwrap().leading,
            "#"
        );
    }

    #[test]
    fn unknown_language_returns_none() {
        assert!(LineCommentPrefix::for_language("brainfuck").is_none());
        assert!(LineCommentPrefix::for_language("").is_none());
    }
}
