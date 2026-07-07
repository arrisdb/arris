use arris_engines::{ErrorCode, IpcError};
use sha2::{Digest, Sha256};

/// Hex chars of the binary SHA-256 shown in the About panel (full digest is 64).
const BINARY_HASH_DISPLAY_LEN: usize = 16;

pub fn ipc_err(e: impl std::fmt::Display) -> IpcError {
    IpcError {
        code: ErrorCode::Other,
        message: e.to_string(),
    }
}

/// SHA-256 of the running executable, truncated to the first
/// `BINARY_HASH_DISPLAY_LEN` hex chars for the About panel.
pub fn binary_hash() -> std::io::Result<String> {
    let bytes = std::fs::read(std::env::current_exe()?)?;
    let digest = Sha256::digest(&bytes);
    let mut hex = String::with_capacity(BINARY_HASH_DISPLAY_LEN);
    for byte in digest.iter().take(BINARY_HASH_DISPLAY_LEN / 2) {
        hex.push_str(&format!("{byte:02x}"));
    }
    Ok(hex)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_hash_is_16_lowercase_hex_chars() {
        let hash = binary_hash().expect("hash current test binary");
        assert_eq!(hash.len(), BINARY_HASH_DISPLAY_LEN);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn binary_hash_is_stable_across_calls() {
        assert_eq!(binary_hash().unwrap(), binary_hash().unwrap());
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
