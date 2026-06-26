use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::TableRef;
use crate::connection::ScopedConnection;

#[derive(Copy, Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    Neon,
    ClassicDark,
    Light,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SidebarMetaTab {
    Files,
    Git,
    Agents,
}

impl Default for SidebarMetaTab {
    fn default() -> Self {
        Self::Files
    }
}

#[derive(Copy, Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeywordCase {
    Preserve,
    #[default]
    Upper,
    Lower,
}

#[derive(Copy, Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IndentStyle {
    #[default]
    Standard,
    TabularLeft,
    TabularRight,
}

#[derive(Copy, Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogicalOperatorNewline {
    #[default]
    Before,
    After,
}

#[derive(Copy, Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CommaPosition {
    #[default]
    Trailing,
    Leading,
}

#[derive(Copy, Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CsvDelimiter {
    #[default]
    Comma,
    Semicolon,
    Tab,
    Pipe,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SqlFormatterSettings {
    pub keyword_case: KeywordCase,
    pub identifier_case: KeywordCase,
    pub data_type_case: KeywordCase,
    pub function_case: KeywordCase,
    pub indent_style: IndentStyle,
    pub tab_width: u8,
    pub use_tabs: bool,
    pub logical_operator_newline: LogicalOperatorNewline,
    pub expression_width: u32,
    pub lines_between_queries: u8,
    pub dense_operators: bool,
    pub newline_before_semicolon: bool,
    pub comma_position: CommaPosition,
}

impl Default for SqlFormatterSettings {
    fn default() -> Self {
        Self {
            keyword_case: KeywordCase::Upper,
            identifier_case: KeywordCase::Preserve,
            data_type_case: KeywordCase::Preserve,
            function_case: KeywordCase::Preserve,
            indent_style: IndentStyle::Standard,
            tab_width: 2,
            use_tabs: false,
            logical_operator_newline: LogicalOperatorNewline::Before,
            expression_width: 50,
            lines_between_queries: 2,
            dense_operators: false,
            newline_before_semicolon: false,
            comma_position: CommaPosition::Trailing,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PythonFormatterSettings {
    pub indent_width: u8,
    pub max_blank_lines: u8,
    pub trim_trailing_whitespace: bool,
}

impl Default for PythonFormatterSettings {
    fn default() -> Self {
        Self {
            indent_width: 4,
            max_blank_lines: 2,
            trim_trailing_whitespace: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct JsonFormatterSettings {
    pub indent_width: u8,
    pub use_tabs: bool,
    pub sort_keys: bool,
}

impl Default for JsonFormatterSettings {
    fn default() -> Self {
        Self {
            indent_width: 2,
            use_tabs: false,
            sort_keys: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct YamlFormatterSettings {
    pub indent_width: u8,
}

impl Default for YamlFormatterSettings {
    fn default() -> Self {
        Self { indent_width: 2 }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CsvFormatterSettings {
    pub delimiter: CsvDelimiter,
    pub trim_fields: bool,
    pub quote_all_fields: bool,
}

impl Default for CsvFormatterSettings {
    fn default() -> Self {
        Self {
            delimiter: CsvDelimiter::Comma,
            trim_fields: true,
            quote_all_fields: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MarkdownListMarker {
    #[default]
    Dash,
    Asterisk,
    Plus,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MarkdownFormatterSettings {
    pub list_marker: MarkdownListMarker,
    pub trim_trailing_whitespace: bool,
}

impl Default for MarkdownFormatterSettings {
    fn default() -> Self {
        Self {
            list_marker: MarkdownListMarker::Dash,
            trim_trailing_whitespace: true,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FormatterSettings {
    pub sql: SqlFormatterSettings,
    pub python: PythonFormatterSettings,
    pub json: JsonFormatterSettings,
    pub yaml: YamlFormatterSettings,
    pub csv: CsvFormatterSettings,
    pub markdown: MarkdownFormatterSettings,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppPreferences {
    pub theme: Theme,
    pub sidebar_left_tab: SidebarMetaTab,
    pub editor_font_size: f32,
    pub editor_font_family: Option<String>,
    pub editor_color_scheme: String,
    pub syntax_overrides: HashMap<String, String>,
    pub indent_guides: bool,
    pub statement_border: bool,
    pub ui_font_family: Option<String>,
    pub ui_font_size: f32,
    pub icon_size: f32,
    pub show_row_detail_pane: bool,
    pub sidebar_left_visible: bool,
    pub sidebar_right_visible: bool,
    pub bottom_pane_visible: bool,
    pub reopen_last_project: bool,
    pub autosave: bool,
    pub terminal_shell: String,
    pub terminal_font_size: f32,
    pub terminal_font_family: Option<String>,
    /// Interval in milliseconds for auto-refreshing connection schemas. `0`
    /// disables auto-refresh.
    pub connection_auto_refresh_ms: u64,
    /// When enabled, curated redaction-safe debug events are persisted locally.
    /// When disabled (the default), nothing is collected.
    pub debug_mode: bool,
    /// Directory names hidden from the file tree. Fully user-controlled (seeded
    /// from [`crate::DEFAULT_SKIP_DIRS`]); the user's list replaces the default.
    pub file_tree_skip_dirs: Vec<String>,
    pub formatter: FormatterSettings,
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            theme: Theme::Neon,
            sidebar_left_tab: SidebarMetaTab::Files,
            editor_font_size: 13.0,
            editor_font_family: None,
            editor_color_scheme: "oneDark".to_string(),
            syntax_overrides: HashMap::new(),
            indent_guides: true,
            statement_border: false,
            ui_font_family: None,
            ui_font_size: 14.0,
            icon_size: 14.0,
            show_row_detail_pane: false,
            sidebar_left_visible: true,
            sidebar_right_visible: true,
            bottom_pane_visible: true,
            reopen_last_project: true,
            autosave: true,
            terminal_shell: String::new(),
            terminal_font_size: 13.0,
            terminal_font_family: None,
            connection_auto_refresh_ms: 0,
            debug_mode: false,
            file_tree_skip_dirs: crate::DEFAULT_SKIP_DIRS
                .iter()
                .map(|s| s.to_string())
                .collect(),
            formatter: FormatterSettings::default(),
        }
    }
}

/// Runtime / IPC shape of a persisted console or notebook tab. Carries the live
/// `text` (SQL body or full nbformat `.ipynb` JSON). On disk the text lives in a
/// sidecar file, never inline in the index (see `ConsoleTabsStore`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedConsoleTab {
    pub id: String,
    pub title: String,
    pub text: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub cursor: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_federation: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_ref: Option<TableRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_editable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedFederationTab {
    pub id: String,
    pub title: String,
    pub participating_connection_ids: Vec<String>,
    #[serde(default)]
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedPinnedQuery {
    pub id: String,
    pub name: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    pub kind: String,
}

/// One run-history chip persisted to disk. Mirrors the frontend `QueryRunResult`
/// minus its result set / diff payload — those are intentionally dropped so the
/// file stays small. On restart the chips reappear empty and the user re-runs to
/// repopulate the grid. The monotonic `ordinal` and per-tab `seq` survive so run
/// numbers are never reused.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedRunHistoryEntry {
    pub id: String,
    pub seq: u32,
    pub ordinal: u32,
    pub tab_id: String,
    pub tab_title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_type: Option<String>,
    pub started_at: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<f64>,
    pub status: String,
    pub sql_snapshot: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_name: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff_index: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOpenResult {
    pub root: String,
    pub connections: Vec<ScopedConnection>,
    pub tabs: Vec<PersistedConsoleTab>,
    pub federation_tabs: Vec<PersistedFederationTab>,
}
