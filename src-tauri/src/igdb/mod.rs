//! IGDB access with the user's own Twitch developer credentials.
//!
//! The Client Secret enters Rust once, through `igdb_set_credentials`, and
//! never leaves it: no command returns it or the access token, and neither
//! appears in errors or logs. The frontend sends only an allowlisted endpoint
//! name and a validated Apicalypse body to `igdb_query`.
//!
//! Credentials are device-local (see `store.rs` for scope and platforms).
//! Nothing here makes a network request until the frontend calls
//! `igdb_set_credentials`, `igdb_verify_credentials` or `igdb_query`; there is
//! no background refresh.

pub mod commands;
mod http;
mod limiter;
mod secret;
mod service;
mod store;
mod validate;

#[cfg(test)]
mod tests;

pub use commands::production_state;
