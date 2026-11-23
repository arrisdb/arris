use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::SystemTime;

use arris_engines::{DbtEngine, ToolKind, ToolRunRecord, ToolRunSummary};
use chrono::Utc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

use super::{AnalyticsTool, CliError, LINE_FEED, TOOL_RUN_OUTPUT_TAIL_BYTES};

/// Runs a native dbt / sqlmesh command in this process's environment and records it.
pub struct ToolRunner {
    tool: AnalyticsTool,
    dir: PathBuf,
    dir_label: String,
    args: Vec<String>,
}

impl ToolRunner {
    pub fn new(tool: AnalyticsTool, dir: PathBuf, dir_label: String, args: Vec<String>) -> Self {
        Self {
            tool,
            dir,
            dir_label,
            args,
        }
    }

    /// `ARRIS_<TOOL>_BIN` when set, else the tool name looked up on `PATH`.
    pub fn executable(&self) -> String {
        std::env::var(self.tool.bin_env)
            .ok()
            .filter(|bin| !bin.is_empty())
            .unwrap_or_else(|| self.tool.executable.to_owned())
    }

    /// Tees output to the terminal; a tool that cannot start is `ToolNotFound`.
    pub async fn run(&self) -> Result<ToolRunRecord, CliError> {
        let started = SystemTime::now();
        let started_at = Utc::now();
        let exe = self.executable();
        let mut child = Command::new(&exe)
            .args(&self.args)
            .current_dir(&self.dir)
            .stdin(Stdio::inherit())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| match e.kind() {
                ErrorKind::NotFound | ErrorKind::PermissionDenied => CliError::ToolNotFound(exe),
                _ => e.into(),
            })?;
        let output_tail = Self::pump(&mut child).await?;
        let status = child.wait().await?;
        Ok(ToolRunRecord {
            id: String::new(),
            tool: self.tool.kind,
            args: self.args.clone(),
            dir: self.dir_label.clone(),
            started_at,
            finished_at: Some(Utc::now()),
            exit_code: status.code(),
            output_tail,
            summary: self.summary(started),
        })
    }

    async fn pump(child: &mut Child) -> std::io::Result<String> {
        let mut tail = String::new();
        let mut out = child
            .stdout
            .take()
            .map(|s| BufReader::new(s).split(LINE_FEED));
        let mut err = child
            .stderr
            .take()
            .map(|s| BufReader::new(s).split(LINE_FEED));
        while out.is_some() || err.is_some() {
            tokio::select! {
                line = async { out.as_mut().unwrap().next_segment().await }, if out.is_some() => {
                    match line? {
                        Some(bytes) => {
                            println!("{}", String::from_utf8_lossy(&bytes));
                            Self::push_tail(&mut tail, &bytes);
                        }
                        None => out = None,
                    }
                }
                line = async { err.as_mut().unwrap().next_segment().await }, if err.is_some() => {
                    match line? {
                        Some(bytes) => {
                            eprintln!("{}", String::from_utf8_lossy(&bytes));
                            Self::push_tail(&mut tail, &bytes);
                        }
                        None => err = None,
                    }
                }
            }
        }
        Ok(tail)
    }

    /// Appends one line, then drops the oldest bytes past the cap on a char boundary.
    fn push_tail(tail: &mut String, line: &[u8]) {
        tail.push_str(&String::from_utf8_lossy(line));
        tail.push(char::from(LINE_FEED));
        if tail.len() > TOOL_RUN_OUTPUT_TAIL_BYTES {
            let mut cut = tail.len() - TOOL_RUN_OUTPUT_TAIL_BYTES;
            while !tail.is_char_boundary(cut) {
                cut += 1;
            }
            tail.drain(..cut);
        }
    }

    /// dbt's `run_results.json`, only when this run wrote it.
    fn summary(&self, started: SystemTime) -> Option<ToolRunSummary> {
        if self.tool.kind != ToolKind::Dbt {
            return None;
        }
        let engine = DbtEngine::new();
        let file = engine.run_results_file(&self.dir);
        let modified = fs::metadata(file).and_then(|m| m.modified()).ok()?;
        if modified < started {
            return None;
        }
        let results = engine.load_run_results(self.dir.clone()).ok()?;
        Some(engine.run_summary(&results))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_tail_keeps_the_newest_bytes() {
        let mut tail = String::new();
        let line = "é".repeat(TOOL_RUN_OUTPUT_TAIL_BYTES);
        ToolRunner::push_tail(&mut tail, line.as_bytes());
        ToolRunner::push_tail(&mut tail, b"last");
        assert!(tail.len() <= TOOL_RUN_OUTPUT_TAIL_BYTES);
        assert!(tail.ends_with("last\n"));
    }
}
