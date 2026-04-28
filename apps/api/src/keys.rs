use age::secrecy::ExposeSecret;
use anyhow::Context;
use sqlx::PgPool;

pub struct BootstrappedKeys {
    pub jwt_private_pem: String,
    pub jwt_public_pem: String,
    pub age_key: String,
}

/// Returns active cryptographic keys, sourcing them in priority order:
///   1. Environment variables (JWT_SECRET + JWT_PUBLIC_KEY + AGE_ENCRYPTION_KEY)
///   2. system_config table (persisted from a previous boot)
///   3. Freshly generated — stored in system_config for subsequent boots
pub async fn bootstrap_keys(
    pool: &PgPool,
    env_jwt_secret: Option<String>,
    env_jwt_public: Option<String>,
    env_age_key: Option<String>,
) -> anyhow::Result<BootstrappedKeys> {
    if let (Some(priv_pem), Some(pub_pem), Some(age)) =
        (env_jwt_secret, env_jwt_public, env_age_key)
    {
        tracing::info!("using JWT and AGE keys from environment variables");
        return Ok(BootstrappedKeys {
            jwt_private_pem: priv_pem,
            jwt_public_pem: pub_pem,
            age_key: age,
        });
    }

    // Try DB — each subquery returns NULL when the row doesn't exist.
    let row: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT
            (SELECT value FROM riviamigo.system_config WHERE key = 'jwt_private_key'),
            (SELECT value FROM riviamigo.system_config WHERE key = 'jwt_public_key'),
            (SELECT value FROM riviamigo.system_config WHERE key = 'age_key')",
    )
    .fetch_one(pool)
    .await
    .context("reading system_config")?;

    if let (Some(priv_pem), Some(pub_pem), Some(age)) = row {
        tracing::info!("loaded JWT and AGE keys from database");
        return Ok(BootstrappedKeys {
            jwt_private_pem: priv_pem,
            jwt_public_pem: pub_pem,
            age_key: age,
        });
    }

    tracing::info!("generating new JWT RSA-2048 keypair and AGE X25519 identity");
    let generated = generate_keys().context("key generation failed")?;

    let mut tx = pool.begin().await?;
    for (k, v) in [
        ("jwt_private_key", generated.jwt_private_pem.as_str()),
        ("jwt_public_key", generated.jwt_public_pem.as_str()),
        ("age_key", generated.age_key.as_str()),
    ] {
        sqlx::query(
            "INSERT INTO riviamigo.system_config (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO NOTHING",
        )
        .bind(k)
        .bind(v)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    tracing::info!("generated keys persisted to database");
    Ok(generated)
}

pub(crate) fn generate_keys() -> anyhow::Result<BootstrappedKeys> {
    use rsa::pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding};
    use rsa::RsaPrivateKey;

    let mut rng = rand::thread_rng();
    let private_key = RsaPrivateKey::new(&mut rng, 2048).context("RSA key generation")?;

    let jwt_private_pem = private_key
        .to_pkcs8_pem(LineEnding::LF)
        .context("encode private key")?
        .to_string();

    let jwt_public_pem = private_key
        .to_public_key()
        .to_public_key_pem(LineEnding::LF)
        .context("encode public key")?;

    let age_identity = age::x25519::Identity::generate();
    let age_key = age_identity.to_string().expose_secret().to_owned();

    Ok(BootstrappedKeys {
        jwt_private_pem,
        jwt_public_pem,
        age_key,
    })
}
