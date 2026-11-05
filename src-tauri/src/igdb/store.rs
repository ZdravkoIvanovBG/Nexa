//! Device-local storage for the user's Twitch Client ID and Client Secret.
//!
//! Scope: one entry per operating-system user account on this device, shared
//! by every Nexa profile and Nexa account signed in on it. The entry is never
//! part of Nexa's settings file, localStorage, cloud sync or `.harbx` backups,
//! all of which live elsewhere.
//!
//! Backends:
//! - Windows: Windows Credential Manager (a generic credential, protected by
//!   DPAPI for the signed-in Windows user).
//! - macOS: the login Keychain.
//! - Everything else (Linux, Flatpak, Android, iOS): unsupported. There is no
//!   plaintext fallback; the Settings UI explains that IGDB credentials can't
//!   be saved in this build.
//!
//! Both Client ID and Secret are stored together as one entry, so replacing
//! them is a single write: the store never holds a new ID with an old secret.

use serde::{Deserialize, Serialize};

use super::secret::Secret;
use super::validate;

#[derive(Clone)]
pub struct StoredCredentials {
    pub client_id: String,
    pub client_secret: Secret,
    /// Unix seconds when Twitch last accepted these credentials.
    pub verified_at: Option<u64>,
}

impl std::fmt::Debug for StoredCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoredCredentials")
            .field("client_id", &"[redacted]")
            .field("client_secret", &self.client_secret)
            .field("verified_at", &self.verified_at)
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(any(windows, target_os = "macos"), allow(dead_code))]
pub enum StoreError {
    /// This build has no secure storage backend.
    Unsupported,
    /// The OS store refused or failed the operation (locked keychain, no
    /// logon session, policy, I/O). Nothing was changed.
    Unavailable,
    /// An entry exists but can't be read as Nexa IGDB credentials.
    Corrupted,
}

pub trait CredentialStore: Send + Sync + 'static {
    fn supported(&self) -> bool {
        true
    }
    fn load(&self) -> Result<Option<StoredCredentials>, StoreError>;
    /// Replace the stored entry in one write.
    fn save(&self, credentials: &StoredCredentials) -> Result<(), StoreError>;
    /// Remove the entry. Succeeds when there is none.
    fn delete(&self) -> Result<(), StoreError>;
}

const BLOB_VERSION: u8 = 1;

#[derive(Serialize)]
struct BlobOut<'a> {
    v: u8,
    client_id: &'a str,
    client_secret: &'a str,
    verified_at: Option<u64>,
}

#[derive(Deserialize)]
struct BlobIn {
    v: u8,
    client_id: String,
    client_secret: String,
    verified_at: Option<u64>,
}

#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
pub(crate) fn encode(credentials: &StoredCredentials) -> Secret {
    let blob = BlobOut {
        v: BLOB_VERSION,
        client_id: &credentials.client_id,
        client_secret: credentials.client_secret.expose(),
        verified_at: credentials.verified_at,
    };
    // Serializing plain strings and numbers cannot fail.
    Secret::new(serde_json::to_string(&blob).unwrap_or_default())
}

#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
pub(crate) fn decode(raw: &str) -> Result<StoredCredentials, StoreError> {
    let mut blob: BlobIn = serde_json::from_str(raw).map_err(|_| StoreError::Corrupted)?;
    let secret = Secret::new(std::mem::take(&mut blob.client_secret));
    if blob.v != BLOB_VERSION
        || !validate::client_id(&blob.client_id)
        || !validate::client_secret(secret.expose())
    {
        return Err(StoreError::Corrupted);
    }
    Ok(StoredCredentials {
        client_id: blob.client_id,
        client_secret: secret,
        verified_at: blob.verified_at,
    })
}

/// No secure backend on this platform. Every operation reports `Unsupported`.
#[cfg_attr(any(windows, target_os = "macos"), allow(dead_code))]
pub struct UnsupportedStore;

impl CredentialStore for UnsupportedStore {
    fn supported(&self) -> bool {
        false
    }
    fn load(&self) -> Result<Option<StoredCredentials>, StoreError> {
        Err(StoreError::Unsupported)
    }
    fn save(&self, _: &StoredCredentials) -> Result<(), StoreError> {
        Err(StoreError::Unsupported)
    }
    fn delete(&self) -> Result<(), StoreError> {
        Err(StoreError::Unsupported)
    }
}

#[cfg(any(windows, target_os = "macos"))]
pub use native::KeyringStore;

#[cfg(any(windows, target_os = "macos"))]
mod native {
    use super::*;
    use zeroize::Zeroize;

    /// The OS credential store through the `keyring` crate, compiled with only
    /// the Windows or macOS backend.
    pub struct KeyringStore {
        service: &'static str,
        user: &'static str,
    }

    impl KeyringStore {
        /// Windows shows this entry as `twitch-app.Nexa IGDB` in Credential
        /// Manager → Windows Credentials.
        pub const SERVICE: &'static str = "Nexa IGDB";
        pub const USER: &'static str = "twitch-app";

        pub fn new(service: &'static str, user: &'static str) -> Self {
            Self { service, user }
        }

        fn entry(&self) -> Result<keyring::Entry, StoreError> {
            keyring::Entry::new(self.service, self.user).map_err(|_| StoreError::Unavailable)
        }
    }

    // keyring errors are dropped unread: they can carry OS text, and the
    // decoded bytes of `BadEncoding` would be the stored secret itself.
    impl CredentialStore for KeyringStore {
        fn load(&self) -> Result<Option<StoredCredentials>, StoreError> {
            match self.entry()?.get_password() {
                Ok(mut raw) => {
                    let decoded = decode(&raw);
                    raw.zeroize();
                    decoded.map(Some)
                }
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(keyring::Error::BadEncoding(mut bytes)) => {
                    bytes.zeroize();
                    Err(StoreError::Corrupted)
                }
                Err(keyring::Error::Ambiguous(_)) => Err(StoreError::Corrupted),
                Err(_) => Err(StoreError::Unavailable),
            }
        }

        fn save(&self, credentials: &StoredCredentials) -> Result<(), StoreError> {
            let blob = encode(credentials);
            self.entry()?
                .set_password(blob.expose())
                .map_err(|_| StoreError::Unavailable)
        }

        fn delete(&self) -> Result<(), StoreError> {
            match self.entry()?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err(StoreError::Unavailable),
            }
        }
    }
}

/// The store this build uses.
pub fn platform_store() -> std::sync::Arc<dyn CredentialStore> {
    #[cfg(any(windows, target_os = "macos"))]
    {
        std::sync::Arc::new(KeyringStore::new(KeyringStore::SERVICE, KeyringStore::USER))
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        std::sync::Arc::new(UnsupportedStore)
    }
}

/// In-memory store with failure injection, for tests. Never touches the OS store.
#[cfg(test)]
pub mod memory {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct MemoryStore {
        pub raw: Mutex<Option<String>>,
        pub fail_load: AtomicBool,
        pub fail_save: AtomicBool,
        pub fail_delete: AtomicBool,
        pub loads: AtomicUsize,
        pub saves: AtomicUsize,
    }

    impl MemoryStore {
        pub fn with(credentials: &StoredCredentials) -> Self {
            let store = Self::default();
            *store.raw.lock().unwrap() = Some(encode(credentials).expose().to_string());
            store
        }
        pub fn raw(&self) -> Option<String> {
            self.raw.lock().unwrap().clone()
        }
    }

    impl CredentialStore for MemoryStore {
        fn load(&self) -> Result<Option<StoredCredentials>, StoreError> {
            self.loads.fetch_add(1, Ordering::SeqCst);
            if self.fail_load.load(Ordering::SeqCst) {
                return Err(StoreError::Unavailable);
            }
            match self.raw.lock().unwrap().as_deref() {
                None => Ok(None),
                Some(raw) => decode(raw).map(Some),
            }
        }
        fn save(&self, credentials: &StoredCredentials) -> Result<(), StoreError> {
            if self.fail_save.load(Ordering::SeqCst) {
                return Err(StoreError::Unavailable);
            }
            self.saves.fetch_add(1, Ordering::SeqCst);
            *self.raw.lock().unwrap() = Some(encode(credentials).expose().to_string());
            Ok(())
        }
        fn delete(&self) -> Result<(), StoreError> {
            if self.fail_delete.load(Ordering::SeqCst) {
                return Err(StoreError::Unavailable);
            }
            *self.raw.lock().unwrap() = None;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn creds() -> StoredCredentials {
        StoredCredentials {
            client_id: "abcdefghij0123456789klmnopqrst".into(),
            client_secret: Secret::new("s3cr3tvalue0123456789abcdefghi".into()),
            verified_at: Some(1_700_000_000),
        }
    }

    #[test]
    fn blob_round_trips() {
        let blob = encode(&creds());
        let back = decode(blob.expose()).unwrap();
        assert_eq!(back.client_id, creds().client_id);
        assert_eq!(back.client_secret.expose(), creds().client_secret.expose());
        assert_eq!(back.verified_at, Some(1_700_000_000));
    }

    #[test]
    fn corrupted_blobs_are_rejected() {
        for raw in [
            "",
            "not json",
            "{}",
            r#"{"v":2,"client_id":"abcdefghij","client_secret":"abcdefghij","verified_at":null}"#,
            r#"{"v":1,"client_id":"bad id!","client_secret":"abcdefghij","verified_at":null}"#,
            r#"{"v":1,"client_id":"abcdefghij","client_secret":"","verified_at":null}"#,
        ] {
            assert_eq!(decode(raw).err(), Some(StoreError::Corrupted), "{raw}");
        }
    }

    #[test]
    fn debug_redacts_both_values() {
        let printed = format!("{:?}", creds());
        assert!(!printed.contains("abcdefghij0123456789"));
        assert!(!printed.contains("s3cr3t"));
    }

    #[test]
    fn unsupported_store_never_falls_back() {
        let store = UnsupportedStore;
        assert!(!store.supported());
        assert_eq!(store.load().err(), Some(StoreError::Unsupported));
        assert_eq!(store.save(&creds()).err(), Some(StoreError::Unsupported));
        assert_eq!(store.delete().err(), Some(StoreError::Unsupported));
    }

    /// Round-trips a dummy, non-secret value through the real OS store under a
    /// separate test entry, then removes it. Run on purpose only:
    /// `cargo test --lib igdb::store -- --ignored`.
    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    #[ignore]
    fn os_store_round_trip_with_dummy_value() {
        let store = KeyringStore::new("Nexa IGDB (test)", "dummy");
        let dummy = StoredCredentials {
            client_id: "dummyclientid0000000000000000".into(),
            client_secret: Secret::new("dummysecretvalue000000000000".into()),
            verified_at: None,
        };
        store.delete().unwrap();
        assert!(store.load().unwrap().is_none());
        store.save(&dummy).unwrap();
        let back = store.load().unwrap().unwrap();
        assert_eq!(back.client_id, dummy.client_id);
        assert_eq!(back.client_secret.expose(), dummy.client_secret.expose());
        store.delete().unwrap();
        assert!(store.load().unwrap().is_none());
        store.delete().unwrap();
    }
}
