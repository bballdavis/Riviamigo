//! Encrypts/decrypts Rivian credential bundles using the `age` crate.

use age::x25519;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RivianTokenBundle {
    pub a_sess:     String,
    pub u_sess:     String,
    pub csrf_token: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub fn encrypt_tokens(
    bundle:   &RivianTokenBundle,
    identity: &x25519::Identity,
) -> anyhow::Result<Vec<u8>> {
    let recipient = identity.to_public();
    let plaintext = serde_json::to_vec(bundle)?;

    let encryptor = age::Encryptor::with_recipients(vec![Box::new(recipient)])
        .ok_or_else(|| anyhow::anyhow!("no recipients"))?;

    let mut ciphertext = vec![];
    let mut writer = encryptor.wrap_output(&mut ciphertext)?;
    writer.write_all(&plaintext)?;
    writer.finish()?;
    Ok(ciphertext)
}

pub fn decrypt_tokens(
    ciphertext: &[u8],
    identity:   &x25519::Identity,
) -> anyhow::Result<RivianTokenBundle> {
    let decryptor = match age::Decryptor::new(ciphertext)? {
        age::Decryptor::Recipients(d) => d,
        _ => return Err(anyhow::anyhow!("unexpected age format")),
    };

    let mut plaintext = vec![];
    let mut reader = decryptor.decrypt(std::iter::once(identity as &dyn age::Identity))?;
    reader.read_to_end(&mut plaintext)?;
    Ok(serde_json::from_slice(&plaintext)?)
}
