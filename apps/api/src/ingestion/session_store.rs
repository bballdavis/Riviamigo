//! Encrypts/decrypts Rivian credential bundles using the `age` crate.

use age::x25519;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RivianTokenBundle {
    pub access_token: String,
    pub refresh_token: String,
    pub app_session_token: String,
    pub user_session_token: String,
    pub csrf_token: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl RivianTokenBundle {
    /// Returns an error if any token field that is strictly required for API
    /// calls is empty.
    ///
    /// Only `access_token` and `refresh_token` are required:
    /// - `access_token`: needed as the Bearer token for every Rivian GQL call.
    /// - `refresh_token`: retained for future use; token renewal today works by
    ///   refreshing the CSRF session via `createCsrfToken` (see `rivian_refresh_csrf`).
    ///
    /// `user_session_token`, `app_session_token`, and `csrf_token` are NOT
    /// required here because they are refreshed on demand via `createCsrfToken`
    /// when the session expires.
    ///
    /// Call this immediately after decrypting a bundle to catch genuinely
    /// corrupted blobs early, without rejecting valid bundles that happen to
    /// have an empty `user_session_token`.
    pub fn validate(&self) -> anyhow::Result<()> {
        if self.access_token.is_empty() {
            anyhow::bail!("RivianTokenBundle: access_token is empty");
        }
        if self.refresh_token.is_empty() {
            anyhow::bail!("RivianTokenBundle: refresh_token is empty");
        }
        Ok(())
    }
}

pub fn encrypt_json<T: Serialize>(
    value: &T,
    identity: &x25519::Identity,
) -> anyhow::Result<Vec<u8>> {
    let recipient = identity.to_public();
    let plaintext = serde_json::to_vec(value)?;

    let encryptor = age::Encryptor::with_recipients(vec![Box::new(recipient)])
        .ok_or_else(|| anyhow::anyhow!("no recipients"))?;

    let mut ciphertext = vec![];
    let mut writer = encryptor.wrap_output(&mut ciphertext)?;
    writer.write_all(&plaintext)?;
    writer.finish()?;
    Ok(ciphertext)
}

pub fn decrypt_json<T: DeserializeOwned>(
    ciphertext: &[u8],
    identity: &x25519::Identity,
) -> anyhow::Result<T> {
    let decryptor = match age::Decryptor::new(ciphertext)? {
        age::Decryptor::Recipients(d) => d,
        _ => return Err(anyhow::anyhow!("unexpected age format")),
    };

    let mut plaintext = vec![];
    let mut reader = decryptor.decrypt(std::iter::once(identity as &dyn age::Identity))?;
    reader.read_to_end(&mut plaintext)?;
    Ok(serde_json::from_slice(&plaintext)?)
}

pub fn encrypt_tokens(
    bundle: &RivianTokenBundle,
    identity: &x25519::Identity,
) -> anyhow::Result<Vec<u8>> {
    encrypt_json(bundle, identity)
}

pub fn decrypt_tokens(
    ciphertext: &[u8],
    identity: &x25519::Identity,
) -> anyhow::Result<RivianTokenBundle> {
    decrypt_json(ciphertext, identity)
}
