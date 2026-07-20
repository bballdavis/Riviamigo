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
        // Validate that the persisted keys are parseable before trusting them.
        // A corrupted row would otherwise cause a confusing late failure inside
        // JwtKeys::new or during the first token sign/verify.
        jsonwebtoken::EncodingKey::from_rsa_pem(priv_pem.as_bytes())
            .map_err(|e| anyhow::anyhow!("persisted jwt_private_key in system_config is corrupt — clear it and restart to regenerate: {e}"))?;
        jsonwebtoken::DecodingKey::from_rsa_pem(pub_pem.as_bytes())
            .map_err(|e| anyhow::anyhow!("persisted jwt_public_key in system_config is corrupt — clear it and restart to regenerate: {e}"))?;
        age.trim()
            .parse::<age::x25519::Identity>()
            .map_err(|e| anyhow::anyhow!("persisted age_key in system_config is corrupt — clear it and restart to regenerate: {e}"))?;
        tracing::info!("loaded JWT and AGE keys from database");
        return Ok(BootstrappedKeys {
            jwt_private_pem: priv_pem,
            jwt_public_pem: pub_pem,
            age_key: age,
        });
    }

    tracing::info!("generating new JWT RSA-2048 keypair and AGE X25519 identity");
    let generated = generate_keys().context("key generation failed")?;

    // Use an advisory lock so concurrent boots don't both generate separate keypairs.
    // Only one session will insert; the others will see ON CONFLICT DO NOTHING and
    // then re-read the winner's row below.
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(1234567890)")
        .execute(&mut *tx)
        .await
        .context("acquiring key bootstrap lock")?;
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

    // Re-read to ensure all instances use the winning keypair.
    let row: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT
            (SELECT value FROM riviamigo.system_config WHERE key = 'jwt_private_key'),
            (SELECT value FROM riviamigo.system_config WHERE key = 'jwt_public_key'),
            (SELECT value FROM riviamigo.system_config WHERE key = 'age_key')",
    )
    .fetch_one(pool)
    .await
    .context("re-reading persisted keys")?;

    let (priv_pem, pub_pem, age) = match row {
        (Some(a), Some(b), Some(c)) => (a, b, c),
        _ => anyhow::bail!("keys missing from system_config after insert"),
    };

    tracing::info!("generated keys persisted to database");
    Ok(BootstrappedKeys {
        jwt_private_pem: priv_pem,
        jwt_public_pem: pub_pem,
        age_key: age,
    })
}

pub(crate) fn generate_keys() -> anyhow::Result<BootstrappedKeys> {
    use aws_lc_rs::{
        encoding::{AsDer, Pkcs8V1Der, PublicKeyX509Der},
        rsa::{KeySize, PrivateDecryptingKey},
    };

    let private_key = PrivateDecryptingKey::generate(KeySize::Rsa2048)
        .map_err(|_| anyhow::anyhow!("RSA key generation failed"))?;
    let private_der = AsDer::<Pkcs8V1Der>::as_der(&private_key)
        .map_err(|_| anyhow::anyhow!("encode private key failed"))?;
    let public_der = AsDer::<PublicKeyX509Der>::as_der(&private_key.public_key())
        .map_err(|_| anyhow::anyhow!("encode public key failed"))?;
    let jwt_private_pem = pem::encode(&pem::Pem::new("PRIVATE KEY", private_der.as_ref()));
    let jwt_public_pem = pem::encode(&pem::Pem::new("PUBLIC KEY", public_der.as_ref()));

    let age_identity = age::x25519::Identity::generate();
    let age_key = age_identity.to_string().expose_secret().to_owned();

    Ok(BootstrappedKeys {
        jwt_private_pem,
        jwt_public_pem,
        age_key,
    })
}
