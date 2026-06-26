//! Cross-platform keychain wrapper.
//!
//! All secrets live in a **single** keychain item — service `arris`, account
//! `secrets` — holding a JSON vault of every connection password, SSH key
//! passphrase, and the MCP bearer token. One item means macOS prompts for
//! access at most once per session instead of once per connection.
//!
//! Access goes through the [`SecretStore`] trait so persistence logic can be
//! tested without a live macOS keychain (which would prompt in CI).

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::KeychainError;

const SERVICE: &str = "arris";
const ACCOUNT: &str = "secrets";

/// Abstraction over the OS secret store. Production uses [`Keychain`]; tests
/// inject an in-memory implementation so they never touch the real keychain.
pub trait SecretStore: Send + Sync {
    fn set_connection_password(&self, connection_id: &str, password: &str) -> Result<(), KeychainError>;
    fn get_connection_password(&self, connection_id: &str) -> Result<Option<String>, KeychainError>;
    fn delete_connection_password(&self, connection_id: &str) -> Result<(), KeychainError>;

    fn set_ssh_passphrase(&self, connection_id: &str, passphrase: &str) -> Result<(), KeychainError>;
    fn get_ssh_passphrase(&self, connection_id: &str) -> Result<Option<String>, KeychainError>;
    fn delete_ssh_passphrase(&self, connection_id: &str) -> Result<(), KeychainError>;

    fn set_mcp_bearer(&self, token: &str) -> Result<(), KeychainError>;
    fn get_mcp_bearer(&self) -> Result<Option<String>, KeychainError>;
}

/// The single JSON blob stored under the one keychain item.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct Vault {
    #[serde(default)]
    passwords: HashMap<String, String>,
    #[serde(default)]
    ssh: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    mcp_bearer: Option<String>,
}

/// Production secret store backed by one keychain item. The decoded vault is
/// cached after first read so the whole session touches the keychain once.
#[derive(Default)]
pub struct Keychain {
    cache: Mutex<Option<Vault>>,
}

impl Keychain {
    /// Return the cached vault, loading + decoding it from the keychain on first
    /// use. An absent item yields an empty vault.
    fn vault(&self) -> Result<Vault, KeychainError> {
        let mut cache = self.cache.lock().unwrap();
        if let Some(vault) = cache.as_ref() {
            return Ok(vault.clone());
        }
        let vault = match Self::read_raw()? {
            Some(json) => serde_json::from_str(&json).map_err(|e| KeychainError::Decode(e.to_string()))?,
            None => Vault::default(),
        };
        *cache = Some(vault.clone());
        Ok(vault)
    }

    /// Persist the vault to the keychain and refresh the cache.
    fn store(&self, vault: Vault) -> Result<(), KeychainError> {
        let json = serde_json::to_string(&vault).map_err(|e| KeychainError::Decode(e.to_string()))?;
        Self::write_raw(&json)?;
        *self.cache.lock().unwrap() = Some(vault);
        Ok(())
    }

    fn read_raw() -> Result<Option<String>, KeychainError> {
        let entry = keyring::Entry::new(SERVICE, ACCOUNT)
            .map_err(|e| KeychainError::Keyring(e.to_string()))?;
        match entry.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(KeychainError::Keyring(e.to_string())),
        }
    }

    fn write_raw(value: &str) -> Result<(), KeychainError> {
        let entry = keyring::Entry::new(SERVICE, ACCOUNT)
            .map_err(|e| KeychainError::Keyring(e.to_string()))?;
        entry
            .set_password(value)
            .map_err(|e| KeychainError::Keyring(e.to_string()))
    }
}

impl SecretStore for Keychain {
    fn set_connection_password(&self, connection_id: &str, password: &str) -> Result<(), KeychainError> {
        let mut vault = self.vault()?;
        vault.passwords.insert(connection_id.to_string(), password.to_string());
        self.store(vault)
    }

    fn get_connection_password(&self, connection_id: &str) -> Result<Option<String>, KeychainError> {
        Ok(self.vault()?.passwords.get(connection_id).cloned())
    }

    fn delete_connection_password(&self, connection_id: &str) -> Result<(), KeychainError> {
        let mut vault = self.vault()?;
        if vault.passwords.remove(connection_id).is_some() {
            self.store(vault)?;
        }
        Ok(())
    }

    fn set_ssh_passphrase(&self, connection_id: &str, passphrase: &str) -> Result<(), KeychainError> {
        let mut vault = self.vault()?;
        vault.ssh.insert(connection_id.to_string(), passphrase.to_string());
        self.store(vault)
    }

    fn get_ssh_passphrase(&self, connection_id: &str) -> Result<Option<String>, KeychainError> {
        Ok(self.vault()?.ssh.get(connection_id).cloned())
    }

    fn delete_ssh_passphrase(&self, connection_id: &str) -> Result<(), KeychainError> {
        let mut vault = self.vault()?;
        if vault.ssh.remove(connection_id).is_some() {
            self.store(vault)?;
        }
        Ok(())
    }

    fn set_mcp_bearer(&self, token: &str) -> Result<(), KeychainError> {
        let mut vault = self.vault()?;
        vault.mcp_bearer = Some(token.to_string());
        self.store(vault)
    }

    fn get_mcp_bearer(&self) -> Result<Option<String>, KeychainError> {
        Ok(self.vault()?.mcp_bearer)
    }
}

#[cfg(test)]
pub(crate) use mock::MockSecretStore;

#[cfg(test)]
mod mock {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::{KeychainError, SecretStore};

    /// In-memory [`SecretStore`] for tests. Keys are namespaced by secret kind
    /// so connection-password and SSH-passphrase entries never collide.
    #[derive(Default)]
    pub(crate) struct MockSecretStore {
        entries: Mutex<HashMap<String, String>>,
        fail_writes: bool,
    }

    impl MockSecretStore {
        pub(crate) fn new() -> Self {
            Self::default()
        }

        /// A store whose writes always fail — used to assert fail-loud behavior.
        pub(crate) fn failing() -> Self {
            Self {
                entries: Mutex::new(HashMap::new()),
                fail_writes: true,
            }
        }

        /// Read a namespaced key directly (e.g. `pw:<id>`, `ssh:<id>`) for
        /// assertions.
        pub(crate) fn raw_get(&self, key: &str) -> Option<String> {
            self.entries.lock().unwrap().get(key).cloned()
        }

        fn set(&self, key: String, value: &str) -> Result<(), KeychainError> {
            if self.fail_writes {
                return Err(KeychainError::Keyring("mock write failure".into()));
            }
            self.entries.lock().unwrap().insert(key, value.to_string());
            Ok(())
        }

        fn get(&self, key: &str) -> Result<Option<String>, KeychainError> {
            Ok(self.entries.lock().unwrap().get(key).cloned())
        }

        fn delete(&self, key: &str) -> Result<(), KeychainError> {
            self.entries.lock().unwrap().remove(key);
            Ok(())
        }
    }

    impl SecretStore for MockSecretStore {
        fn set_connection_password(&self, id: &str, password: &str) -> Result<(), KeychainError> {
            self.set(format!("pw:{id}"), password)
        }
        fn get_connection_password(&self, id: &str) -> Result<Option<String>, KeychainError> {
            self.get(&format!("pw:{id}"))
        }
        fn delete_connection_password(&self, id: &str) -> Result<(), KeychainError> {
            self.delete(&format!("pw:{id}"))
        }
        fn set_ssh_passphrase(&self, id: &str, passphrase: &str) -> Result<(), KeychainError> {
            self.set(format!("ssh:{id}"), passphrase)
        }
        fn get_ssh_passphrase(&self, id: &str) -> Result<Option<String>, KeychainError> {
            self.get(&format!("ssh:{id}"))
        }
        fn delete_ssh_passphrase(&self, id: &str) -> Result<(), KeychainError> {
            self.delete(&format!("ssh:{id}"))
        }
        fn set_mcp_bearer(&self, token: &str) -> Result<(), KeychainError> {
            self.set("mcp:bearer".into(), token)
        }
        fn get_mcp_bearer(&self) -> Result<Option<String>, KeychainError> {
            self.get("mcp:bearer")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_item_identifiers() {
        assert_eq!(SERVICE, "arris");
        assert_eq!(ACCOUNT, "secrets");
    }

    #[test]
    fn vault_round_trips_through_json() {
        let mut vault = Vault::default();
        vault.passwords.insert("c1".into(), "pw".into());
        vault.ssh.insert("c1".into(), "ssh".into());
        vault.mcp_bearer = Some("tok".into());
        let json = serde_json::to_string(&vault).unwrap();
        let back: Vault = serde_json::from_str(&json).unwrap();
        assert_eq!(back.passwords.get("c1").map(String::as_str), Some("pw"));
        assert_eq!(back.ssh.get("c1").map(String::as_str), Some("ssh"));
        assert_eq!(back.mcp_bearer.as_deref(), Some("tok"));
    }

    #[test]
    fn vault_decodes_empty_object() {
        let back: Vault = serde_json::from_str("{}").unwrap();
        assert!(back.passwords.is_empty());
        assert!(back.ssh.is_empty());
        assert!(back.mcp_bearer.is_none());
    }

    #[test]
    fn mock_round_trips_each_secret_kind() {
        let store = MockSecretStore::new();
        store.set_connection_password("c1", "pw").unwrap();
        store.set_ssh_passphrase("c1", "ssh").unwrap();
        store.set_mcp_bearer("tok").unwrap();
        assert_eq!(store.get_connection_password("c1").unwrap().as_deref(), Some("pw"));
        assert_eq!(store.get_ssh_passphrase("c1").unwrap().as_deref(), Some("ssh"));
        assert_eq!(store.get_mcp_bearer().unwrap().as_deref(), Some("tok"));
    }

    #[test]
    fn mock_delete_clears_only_target_kind() {
        let store = MockSecretStore::new();
        store.set_connection_password("c1", "pw").unwrap();
        store.set_ssh_passphrase("c1", "ssh").unwrap();
        store.delete_connection_password("c1").unwrap();
        assert!(store.get_connection_password("c1").unwrap().is_none());
        assert_eq!(store.get_ssh_passphrase("c1").unwrap().as_deref(), Some("ssh"));
    }

    #[test]
    fn failing_mock_errors_on_write() {
        let store = MockSecretStore::failing();
        assert!(store.set_connection_password("c1", "pw").is_err());
    }

    // Live keychain tests are skipped in CI — they would prompt on macOS.
}
