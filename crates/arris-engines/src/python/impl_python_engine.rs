use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::mpsc::UnboundedReceiver;

use crate::{Engine, QueryResult};
use super::impl_kernel_session::KernelSession;
use super::impl_venv_registry::VenvRegistry;
use super::impl_sql_cell::SqlCell;
use super::impl_venv::Venv;
use super::{
    Completion, CreatedVenv, InterpreterSource, KernelOutput, PythonError, PythonInterpreter,
};

pub struct PythonEngine {
    /// One running kernel per console tab, keyed by the frontend console id.
    sessions: DashMap<String, Arc<KernelSession>>,
}

impl PythonEngine {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
        }
    }

    /// Discover interpreters the console can bind to: system ones (PATH, pyenv,
    /// common dirs) plus user-created venvs remembered across restarts. Deduped
    /// by path, discovery winning when a path appears in both.
    pub fn list_interpreters(&self) -> Vec<PythonInterpreter> {
        let mut out = Venv::discover();
        let mut seen: HashSet<_> = out.iter().map(|i| i.path.clone()).collect();
        for interp in VenvRegistry::interpreters() {
            if seen.insert(interp.path.clone()) {
                out.push(interp);
            }
        }
        out
    }

    /// Register a user-picked interpreter (e.g. chosen via a file browser):
    /// probe its version and remember it so it joins the dropdown and survives
    /// restarts. Errors if the path is not a working Python interpreter.
    pub fn add_interpreter(&self, python: &Path) -> Result<PythonInterpreter, PythonError> {
        let interpreter = Venv::interpreter_at(python, InterpreterSource::Venv)
            .ok_or_else(|| PythonError::InterpreterNotFound(python.to_path_buf()))?;
        VenvRegistry::add(&interpreter.path)?;
        Ok(interpreter)
    }

    /// Create a venv at `dest` from `base_python`, ensure `ipykernel` is present,
    /// and remember the interpreter so it survives app restarts.
    pub fn create_venv(&self, base_python: &Path, dest: &Path) -> Result<CreatedVenv, PythonError> {
        let interpreter = Venv::create(base_python, dest)?;
        let ipykernel_ready = Venv::ensure_ipykernel(&interpreter.path)?;
        VenvRegistry::add(&interpreter.path)?;
        Ok(CreatedVenv {
            interpreter,
            ipykernel_ready,
        })
    }

    /// Ensure `ipykernel` is installed in an existing interpreter the user picked.
    pub fn ensure_kernel(&self, python: &Path) -> Result<bool, PythonError> {
        Venv::ensure_ipykernel(python)
    }

    /// Start (or restart) the kernel for a console, returning a stream of its
    /// output. Any kernel already bound to this console is shut down first.
    pub async fn start_kernel(
        &self,
        console_id: String,
        python: &Path,
    ) -> Result<UnboundedReceiver<KernelOutput>, PythonError> {
        if let Some((_, existing)) = self.sessions.remove(&console_id) {
            existing.shutdown().await;
        }
        let (session, rx) = KernelSession::start(python).await?;
        self.sessions.insert(console_id, Arc::new(session));
        Ok(rx)
    }

    /// Run code in a console's kernel, returning the `execute_request` id.
    pub async fn execute(&self, console_id: &str, code: String) -> Result<String, PythonError> {
        let session = self.session(console_id)?;
        session.execute(code).await
    }

    /// Bind a SQL query result into a console's kernel as a pandas DataFrame
    /// named `var_name`. The result is serialized to an in-memory Arrow IPC
    /// stream, embedded in a generated snippet, and executed; the returned
    /// `execute_request` id routes the preview/summary output back to the cell.
    pub async fn run_sql_cell(
        &self,
        console_id: &str,
        result: &QueryResult,
        var_name: &str,
    ) -> Result<String, PythonError> {
        let snippet = SqlCell::bind_snippet(result, var_name)?;
        self.session(console_id)?.execute(snippet).await
    }

    /// Request kernel-aware completions for `code` at `cursor_pos` in a console.
    pub async fn complete(
        &self,
        console_id: &str,
        code: String,
        cursor_pos: usize,
    ) -> Result<Completion, PythonError> {
        self.session(console_id)?.complete(code, cursor_pos).await
    }

    /// Interrupt the running cell in a console's kernel.
    pub fn interrupt(&self, console_id: &str) -> Result<(), PythonError> {
        self.session(console_id)?.interrupt()
    }

    /// Shut down and forget a console's kernel.
    pub async fn shutdown(&self, console_id: &str) {
        if let Some((_, session)) = self.sessions.remove(console_id) {
            session.shutdown().await;
        }
    }

    fn session(&self, console_id: &str) -> Result<Arc<KernelSession>, PythonError> {
        self.sessions
            .get(console_id)
            .map(|r| r.value().clone())
            .ok_or(PythonError::NoSession)
    }
}

impl Default for PythonEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine for PythonEngine {
    fn name(&self) -> &str {
        "python"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_name_is_python() {
        assert_eq!(PythonEngine::new().name(), "python");
    }

    #[test]
    fn add_interpreter_rejects_non_python_path() {
        let err = PythonEngine::new()
            .add_interpreter(Path::new("/no/such/python"))
            .unwrap_err();
        assert!(matches!(err, PythonError::InterpreterNotFound(_)));
    }
}
