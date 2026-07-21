use redis::AsyncCommands;

/// Probes the exact Redis client used for encrypted, short-lived session state.
///
/// Keeping this separate from a TCP check proves that authentication is valid too.
pub async fn ping(client: &redis::Client) -> redis::RedisResult<()> {
    let mut connection = client.get_multiplexed_async_connection().await?;
    let _: String = connection.ping().await?;
    Ok(())
}
