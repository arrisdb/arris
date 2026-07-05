use std::path::{Path, PathBuf};

use super::{AppPreferences, JsonSingletonStore};

pub struct AppPreferencesStore {
    file: PathBuf,
}

impl AppPreferencesStore {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            file: dir.join("app_preferences.json"),
        }
    }
}

impl JsonSingletonStore for AppPreferencesStore {
    type Item = AppPreferences;

    fn file_path(&self) -> &Path {
        &self.file
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::{
        CommaPosition, CsvDelimiter, FormatterSettings, IndentStyle, KeyShortcut, KeymapPreset,
        KeywordCase, LogicalOperatorNewline, Theme,
    };

    #[tokio::test]
    async fn defaults_match_initial_state() {
        let p = AppPreferences::default();
        assert_eq!(p.theme, Theme::Neon);
        assert_eq!(p.editor_font_size, 13.0);
        assert_eq!(p.editor_font_family, None);
        assert_eq!(p.ui_font_family, None);
        assert_eq!(p.ui_font_size, 14.0);
        assert_eq!(p.icon_size, 14.0);
        assert!(!p.show_row_detail_pane);
        assert!(p.autosave);
        assert_eq!(p.terminal_shell, "");
        assert_eq!(p.terminal_font_size, 13.0);
        assert_eq!(p.terminal_font_family, None);
    }

    #[test]
    fn keymap_preset_defaults_and_serde() {
        let p = AppPreferences::default();
        assert_eq!(p.keymap_preset, KeymapPreset::Default);
        assert!(p.keymap_overrides.default.is_empty());
        assert!(p.keymap_overrides.vscode.is_empty());
        assert!(p.keymap_overrides.jetbrains.is_empty());

        let json = serde_json::to_string(&KeymapPreset::Vscode).unwrap();
        assert_eq!(json, "\"vscode\"");
        let jb: KeymapPreset = serde_json::from_str("\"jetbrains\"").unwrap();
        assert_eq!(jb, KeymapPreset::Jetbrains);
    }

    #[test]
    fn keymap_overrides_roundtrip_and_missing_fields() {
        let mut prefs = AppPreferences::default();
        prefs.keymap_preset = KeymapPreset::Jetbrains;
        prefs
            .keymap_overrides
            .jetbrains
            .insert("gitCommit".into(), Some(KeyShortcut { key: "Mod-k".into() }));
        prefs.keymap_overrides.jetbrains.insert("aiGenerate".into(), None);

        let json = serde_json::to_string(&prefs).unwrap();
        let back: AppPreferences = serde_json::from_str(&json).unwrap();
        assert_eq!(back, prefs);

        let legacy: AppPreferences = serde_json::from_str("{}").unwrap();
        assert_eq!(legacy.keymap_preset, KeymapPreset::Default);
    }

    #[tokio::test]
    async fn icon_size_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        p.icon_size = 18.0;
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert_eq!(back.icon_size, 18.0);
    }

    #[tokio::test]
    async fn editor_font_family_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        p.editor_font_family = Some("JetBrains Mono".into());
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert_eq!(back.editor_font_family.as_deref(), Some("JetBrains Mono"));
    }

    #[tokio::test]
    async fn ui_font_family_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        p.ui_font_family = Some("Inter".into());
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert_eq!(back.ui_font_family.as_deref(), Some("Inter"));
    }

    #[tokio::test]
    async fn legacy_file_without_ui_font_family_falls_back_to_none() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(
            &file,
            r#"{"theme":"neon","editorFontSize":13,"queryFontSize":13}"#,
        )
        .unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert_eq!(p.ui_font_family, None);
    }

    #[tokio::test]
    async fn legacy_file_without_editor_font_family_falls_back_to_none() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(
            &file,
            r#"{"theme":"neon","editorFontSize":13,"queryFontSize":13}"#,
        )
        .unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert_eq!(p.editor_font_family, None);
    }

    #[tokio::test]
    async fn legacy_file_without_icon_size_falls_back_to_default() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(
            &file,
            r#"{"theme":"neon","editorFontSize":13,"queryFontSize":13,"uiFontSize":14}"#,
        )
        .unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert_eq!(p.icon_size, 14.0);
    }

    #[tokio::test]
    async fn ui_font_size_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        p.ui_font_size = 16.5;
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert_eq!(back.ui_font_size, 16.5);
    }

    #[tokio::test]
    async fn legacy_file_without_ui_font_size_falls_back_to_default() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(
            &file,
            r#"{"theme":"neon","editorFontSize":13,"queryFontSize":13}"#,
        )
        .unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert_eq!(p.ui_font_size, 14.0);
    }

    #[tokio::test]
    async fn round_trip_through_json_file() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        p.theme = Theme::ClassicDark;
        p.editor_font_size = 16.5;
        p.show_row_detail_pane = true;
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert_eq!(back, p);
    }

    #[tokio::test]
    async fn missing_file_yields_defaults() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert_eq!(p, AppPreferences::default());
    }

    #[tokio::test]
    async fn missing_field_takes_default_due_to_struct_default_attr() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(&file, r#"{"theme":"classicDark"}"#).unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert_eq!(p.theme, Theme::ClassicDark);
        assert_eq!(p.editor_font_size, 13.0);
    }

    #[tokio::test]
    async fn indent_guides_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        p.indent_guides = false;
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert!(!back.indent_guides);
    }

    #[tokio::test]
    async fn legacy_file_without_indent_guides_falls_back_to_enabled() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(
            &file,
            r#"{"theme":"neon","editorFontSize":13,"queryFontSize":13}"#,
        )
        .unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert!(p.indent_guides);
    }

    #[tokio::test]
    async fn statement_border_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        p.statement_border = true;
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert!(back.statement_border);
    }

    #[tokio::test]
    async fn legacy_file_without_statement_border_falls_back_to_disabled() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(
            &file,
            r#"{"theme":"neon","editorFontSize":13,"queryFontSize":13}"#,
        )
        .unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert!(!p.statement_border);
    }

    #[tokio::test]
    async fn editor_color_scheme_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        p.editor_color_scheme = "dracula".to_string();
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert_eq!(back.editor_color_scheme, "dracula");
    }

    #[tokio::test]
    async fn legacy_file_without_editor_color_scheme_falls_back_to_default() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(
            &file,
            r#"{"theme":"neon","editorFontSize":13,"queryFontSize":13}"#,
        )
        .unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert_eq!(p.editor_color_scheme, "oneDark");
    }

    #[tokio::test]
    async fn syntax_overrides_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        p.syntax_overrides
            .insert("keyword".to_string(), "#ff0000".to_string());
        p.syntax_overrides
            .insert("string".to_string(), "#00ff00".to_string());
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert_eq!(back.syntax_overrides, p.syntax_overrides);
    }

    #[tokio::test]
    async fn legacy_file_without_syntax_overrides_falls_back_to_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(
            &file,
            r#"{"theme":"neon","editorFontSize":13,"queryFontSize":13}"#,
        )
        .unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert!(p.syntax_overrides.is_empty());
    }

    #[tokio::test]
    async fn autosave_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        p.autosave = false;
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert!(!back.autosave);
    }

    #[tokio::test]
    async fn legacy_file_without_autosave_falls_back_to_default() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(
            &file,
            r#"{"theme":"neon","editorFontSize":13,"queryFontSize":13}"#,
        )
        .unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert!(p.autosave);
    }

    #[tokio::test]
    async fn terminal_shell_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        p.terminal_shell = "/bin/zsh".into();
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert_eq!(back.terminal_shell, "/bin/zsh");
    }

    #[tokio::test]
    async fn legacy_file_without_terminal_shell_falls_back_to_auto() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(
            &file,
            r#"{"theme":"neon","editorFontSize":13,"queryFontSize":13}"#,
        )
        .unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert_eq!(p.terminal_shell, "");
    }

    #[tokio::test]
    async fn terminal_font_size_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        p.terminal_font_size = 16.0;
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert_eq!(back.terminal_font_size, 16.0);
    }

    #[tokio::test]
    async fn legacy_file_without_terminal_font_size_falls_back_to_default() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(
            &file,
            r#"{"theme":"neon","editorFontSize":13,"queryFontSize":13}"#,
        )
        .unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert_eq!(p.terminal_font_size, 13.0);
    }

    #[tokio::test]
    async fn terminal_font_family_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        p.terminal_font_family = Some("Fira Code".into());
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert_eq!(back.terminal_font_family.as_deref(), Some("Fira Code"));
    }

    #[tokio::test]
    async fn legacy_file_without_terminal_font_family_falls_back_to_none() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(
            &file,
            r#"{"theme":"neon","editorFontSize":13,"queryFontSize":13}"#,
        )
        .unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert_eq!(p.terminal_font_family, None);
    }

    #[tokio::test]
    async fn connection_auto_refresh_ms_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        p.connection_auto_refresh_ms = 60_000;
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert_eq!(back.connection_auto_refresh_ms, 60_000);
    }

    #[tokio::test]
    async fn legacy_file_without_connection_auto_refresh_ms_falls_back_to_disabled() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(
            &file,
            r#"{"theme":"neon","editorFontSize":13,"queryFontSize":13}"#,
        )
        .unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert_eq!(p.connection_auto_refresh_ms, 0);
    }

    #[tokio::test]
    async fn debug_mode_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        assert!(!p.debug_mode);
        p.debug_mode = true;
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert!(back.debug_mode);
    }

    #[tokio::test]
    async fn legacy_file_without_debug_mode_falls_back_to_disabled() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(
            &file,
            r#"{"theme":"neon","editorFontSize":13,"queryFontSize":13}"#,
        )
        .unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert!(!p.debug_mode);
    }

    #[tokio::test]
    async fn file_tree_skip_dirs_defaults_to_engine_default_and_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        assert_eq!(p.file_tree_skip_dirs, crate::FileEngine::default_skip_dirs());
        assert!(!p.file_tree_skip_dirs.contains(&".arris".to_string()));
        p.file_tree_skip_dirs = vec!["node_modules".into(), ".arris".into()];
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert_eq!(back.file_tree_skip_dirs, vec!["node_modules", ".arris"]);
    }

    #[tokio::test]
    async fn legacy_file_without_skip_dirs_falls_back_to_default() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(&file, r#"{"theme":"neon","editorFontSize":13}"#).unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert_eq!(p.file_tree_skip_dirs, crate::FileEngine::default_skip_dirs());
    }

    #[tokio::test]
    async fn formatter_settings_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let mut p = AppPreferences::default();
        p.formatter.sql.keyword_case = KeywordCase::Lower;
        p.formatter.sql.tab_width = 4;
        p.formatter.sql.use_tabs = true;
        p.formatter.sql.indent_style = IndentStyle::TabularLeft;
        p.formatter.sql.logical_operator_newline = LogicalOperatorNewline::After;
        p.formatter.sql.expression_width = 80;
        p.formatter.sql.dense_operators = true;
        p.formatter.sql.newline_before_semicolon = true;
        p.formatter.sql.comma_position = CommaPosition::Leading;
        p.formatter.python.indent_width = 2;
        p.formatter.python.max_blank_lines = 1;
        p.formatter.json.sort_keys = true;
        p.formatter.json.indent_width = 4;
        p.formatter.yaml.indent_width = 4;
        p.formatter.csv.delimiter = CsvDelimiter::Semicolon;
        p.formatter.csv.quote_all_fields = true;
        s.save(&p).await.unwrap();
        let back = s.load().await.unwrap();
        assert_eq!(back.formatter, p.formatter);
    }

    #[tokio::test]
    async fn theme_variants_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        for theme in [Theme::Neon, Theme::ClassicDark, Theme::Light] {
            let mut p = AppPreferences::default();
            p.theme = theme;
            s.save(&p).await.unwrap();
            let back = s.load().await.unwrap();
            assert_eq!(back.theme, theme);
        }
    }

    #[tokio::test]
    async fn legacy_file_without_theme_falls_back_to_neon() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(&file, r#"{"editorFontSize":13}"#).unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert_eq!(p.theme, Theme::Neon);
    }

    #[tokio::test]
    async fn legacy_file_without_formatter_falls_back_to_defaults() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("app_preferences.json");
        std::fs::write(
            &file,
            r#"{"theme":"neon","editorFontSize":13,"queryFontSize":13}"#,
        )
        .unwrap();
        let s = AppPreferencesStore::new(tmp.path().into());
        let p = s.load().await.unwrap();
        assert_eq!(p.formatter, FormatterSettings::default());
    }
}
