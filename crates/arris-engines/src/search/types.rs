#[derive(Debug, Clone)]
pub struct ScannedFile {
    pub path: String,
    pub mtime_ns: u64,
    pub size: u64,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMatch {
    pub path: String,
    pub filename: String,
    pub score: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentMatch {
    pub path: String,
    pub filename: String,
    pub line_num: usize,
    pub line_content: String,
    pub match_start: usize,
    pub match_end: usize,
}

#[cfg(test)]
#[derive(Debug, Clone)]
pub struct IndexStats {
    pub file_count: usize,
    pub line_count: usize,
    pub db_size_bytes: u64,
}
