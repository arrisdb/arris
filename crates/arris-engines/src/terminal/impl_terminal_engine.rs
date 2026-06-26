pub struct TerminalEngine;

impl TerminalEngine {
    pub fn collect_shells(
        shell_env: Option<String>,
        exists: impl Fn(&str) -> bool,
    ) -> Vec<String> {
        let mut candidates = Vec::new();
        if let Some(shell) = shell_env {
            if !shell.trim().is_empty() {
                candidates.push(shell);
            }
        }
        candidates.extend(
            ["/bin/zsh", "/bin/bash", "/usr/local/bin/fish", "/bin/sh"]
                .iter()
                .map(|s| s.to_string()),
        );

        let mut shells = Vec::new();
        for shell in candidates {
            if exists(&shell) && !shells.iter().any(|seen| seen == &shell) {
                shells.push(shell);
            }
        }
        shells
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefer_env_and_dedupe() {
        let shells = TerminalEngine::collect_shells(Some("/custom/zsh".into()), |path| {
            matches!(path, "/custom/zsh" | "/bin/zsh" | "/bin/sh")
        });

        assert_eq!(
            shells,
            vec![
                "/custom/zsh".to_string(),
                "/bin/zsh".to_string(),
                "/bin/sh".to_string()
            ]
        );
    }

    #[test]
    fn drop_missing_and_empty_env() {
        let shells = TerminalEngine::collect_shells(Some("".into()), |path| path == "/bin/bash");
        assert_eq!(shells, vec!["/bin/bash".to_string()]);
    }
}
