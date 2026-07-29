use riviamigo_api::{logging, parallax};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    logging::init();
    let database_url = database_url()?;
    parallax::run(&database_url).await
}

fn database_url() -> anyhow::Result<String> {
    if let Ok(value) =
        std::env::var("PARALLAX_DATABASE_URL").or_else(|_| std::env::var("DATABASE_URL"))
    {
        return Ok(value);
    }

    if let Ok(host) = std::env::var("POSTGRES_HOST") {
        let user = std::env::var("POSTGRES_USER").unwrap_or_else(|_| "riviamigo".into());
        let password = std::env::var("POSTGRES_PASSWORD")
            .map_err(|_| anyhow::anyhow!("POSTGRES_PASSWORD is required with POSTGRES_HOST"))?;
        let database = std::env::var("POSTGRES_DB").unwrap_or_else(|_| "riviamigo".into());
        let port = std::env::var("POSTGRES_PORT").unwrap_or_else(|_| "5432".into());
        let mut url = url::Url::parse(&format!("postgresql://{host}:{port}/{database}"))?;
        url.set_username(&user)
            .map_err(|_| anyhow::anyhow!("invalid POSTGRES_USER"))?;
        url.set_password(Some(&password))
            .map_err(|_| anyhow::anyhow!("invalid POSTGRES_PASSWORD"))?;
        return Ok(url.to_string());
    }

    Ok("postgresql://riviamigo:devpassword@localhost:5432/riviamigo".into())
}
