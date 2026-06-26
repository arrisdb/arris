use arris_engines::{ErrorCode, IpcError};

pub fn ipc_err(e: impl std::fmt::Display) -> IpcError {
    IpcError {
        code: ErrorCode::Other,
        message: e.to_string(),
    }
}

pub async fn list_editor_fonts() -> Result<Vec<String>, std::io::Error> {
    #[cfg(target_os = "macos")]
    {
        let output = tokio::process::Command::new("/usr/sbin/system_profiler")
            .args(["SPFontsDataType", "-json", "-detailLevel", "mini"])
            .output()
            .await?;
        if !output.status.success() {
            return Ok(vec![]);
        }
        let Ok(json) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
            return Ok(vec![]);
        };
        let mut families = std::collections::BTreeSet::new();
        if let Some(items) = json.get("SPFontsDataType").and_then(|v| v.as_array()) {
            for item in items {
                if item.get("enabled").and_then(|v| v.as_str()) == Some("no") {
                    continue;
                }
                let Some(typefaces) = item.get("typefaces").and_then(|v| v.as_array()) else {
                    continue;
                };
                for typeface in typefaces {
                    if typeface.get("enabled").and_then(|v| v.as_str()) == Some("no") {
                        continue;
                    }
                    if let Some(family) = typeface.get("family").and_then(|v| v.as_str()) {
                        let family = family.trim();
                        if !family.is_empty() {
                            families.insert(family.to_string());
                        }
                    }
                }
            }
        }
        return Ok(families.into_iter().collect());
    }

    #[cfg(not(target_os = "macos"))]
    Ok(vec![])
}
