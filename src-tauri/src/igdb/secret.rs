//! In-memory holder for the Twitch Client Secret, the access token and any
//! request body that carries them.
//!
//! - `Debug` prints a fixed placeholder, and there is no `Display` or
//!   `Serialize`, so a secret cannot reach a log line, an error message, a
//!   crash report or a command response by accident.
//! - The buffer is zeroed when the value is dropped.

use zeroize::Zeroize;

pub struct Secret(String);

impl Secret {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    /// The raw value. Only for building the outgoing request or the stored blob.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl Clone for Secret {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret([redacted])")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_never_prints_the_value() {
        let secret = Secret::new("hunter2-value".into());
        let printed = format!("{secret:?} {:?}", Some(secret.clone()));
        assert!(!printed.contains("hunter2"));
        assert!(printed.contains("redacted"));
        assert_eq!(secret.expose(), "hunter2-value");
    }
}
