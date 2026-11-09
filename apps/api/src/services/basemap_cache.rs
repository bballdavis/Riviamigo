//! Basemap-only eviction. Operational Redis keys never participate in this index.
use crate::config::SecurityConfig;
use redis::AsyncCommands;

const INDEX: &str = "external:cache:basemap:lru";
const COSTS: &str = "external:cache:basemap:costs";
const TOTAL: &str = "external:cache:basemap:bytes";
const PUT: &str = r#"
local key=KEYS[1]
local index,costs,total=KEYS[2],KEYS[3],KEYS[4]
local budget,ttl=tonumber(ARGV[4]),tonumber(ARGV[5])
local function remove(k)
  local cost=tonumber(redis.call('HGET',costs,k) or '0')
  redis.call('UNLINK',k,k..':content-type',k..':max-age')
  redis.call('HDEL',costs,k); redis.call('ZREM',index,k)
  local remaining=math.max(0,tonumber(redis.call('GET',total) or '0')-cost)
  redis.call('SET',total,remaining)
end
-- Reclaim stale index entries and evict a bounded number of oldest resources.
-- Count key/index/TTL bookkeeping as well as payload and response metadata.
local estimate=math.ceil(#ARGV[1]*1.5)+#ARGV[2]+#ARGV[3]+5*#key+2048
if estimate > budget then return 0 end
local initialized=redis.pcall('SET',total,'0','NX')
if type(initialized)=='table' and initialized.err then return 0 end
if redis.call('HEXISTS',costs,key)==1 then remove(key) end
for i=1,64 do
  local oldest=redis.call('ZRANGE',index,0,0)[1]
  if not oldest then break end
  if redis.call('EXISTS',oldest)==1 and tonumber(redis.call('GET',total) or '0')+estimate<=budget then break end
  remove(oldest)
end
if tonumber(redis.call('GET',total) or '0')+estimate > budget then return 0 end
local result=redis.pcall('SET',key,ARGV[1],'EX',ttl)
if type(result)=='table' and result.err then return 0 end
result=redis.pcall('SET',key..':content-type',ARGV[2],'EX',ttl)
if type(result)=='table' and result.err then redis.call('UNLINK',key); return 0 end
result=redis.pcall('SET',key..':max-age',ARGV[3],'EX',ttl)
if type(result)=='table' and result.err then redis.call('UNLINK',key,key..':content-type'); return 0 end
local actual=redis.call('MEMORY','USAGE',key)+redis.call('MEMORY','USAGE',key..':content-type')+redis.call('MEMORY','USAGE',key..':max-age')+2*#key+512
if actual > estimate or tonumber(redis.call('GET',total) or '0')+actual > budget then
  redis.call('UNLINK',key,key..':content-type',key..':max-age'); return 0
end
result=redis.pcall('HSET',costs,key,actual)
if type(result)=='table' and result.err then redis.call('UNLINK',key,key..':content-type',key..':max-age'); return 0 end
result=redis.pcall('ZADD',index,ARGV[6],key)
if type(result)=='table' and result.err then redis.call('HDEL',costs,key); redis.call('UNLINK',key,key..':content-type',key..':max-age'); return 0 end
redis.call('INCRBY',total,actual)
return 1
"#;

pub async fn store(
    client: &redis::Client,
    key: &str,
    bytes: &[u8],
    content_type: &str,
    max_age: u64,
    config: &SecurityConfig,
) {
    if !key.starts_with("external:basemap:") {
        return;
    }
    let result = async {
        let mut connection = client.get_multiplexed_async_connection().await?;
        redis::Script::new(PUT)
            .key(key)
            .key(INDEX)
            .key(COSTS)
            .key(TOTAL)
            .arg(bytes)
            .arg(content_type)
            .arg(max_age)
            .arg(config.basemap_cache_max_bytes)
            .arg(config.basemap_cache_ttl_seconds)
            .arg(chrono::Utc::now().timestamp_millis())
            .invoke_async::<i64>(&mut connection)
            .await
    }
    .await;
    if let Err(error) = result {
        tracing::debug!(?error, "basemap cache write skipped");
    }
}

pub async fn touch(connection: &mut redis::aio::MultiplexedConnection, key: &str) {
    let _: Result<i64, _> = redis::cmd("ZADD")
        .arg(INDEX)
        .arg("XX")
        .arg(chrono::Utc::now().timestamp_millis())
        .arg(key)
        .query_async(connection)
        .await;
}

/// Invalidate legacy permanent entries in bounded SCAN batches. New entries
/// always have TTLs; this makes a warm cache miss safe during the upgrade.
pub fn start_maintenance(client: redis::Client) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut cursor = 0u64;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let Ok(mut connection) = client.get_multiplexed_async_connection().await else {
                continue;
            };
            let Ok((next, keys)) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg("external:basemap:*")
                .arg("COUNT")
                .arg(100)
                .query_async::<(u64, Vec<String>)>(&mut connection)
                .await
            else {
                continue;
            };
            for key in keys {
                if matches!(connection.ttl::<_, i64>(&key).await, Ok(-1)) {
                    let _: Result<i64, _> = redis::cmd("UNLINK")
                        .arg(&key)
                        .query_async(&mut connection)
                        .await;
                }
            }
            cursor = next;
            if cursor == 0 {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires a dedicated RIVIAMIGO_TEST_REDIS_URL"]
    async fn shared_budget_ttl_legacy_cleanup_and_operational_keys() {
        let client =
            redis::Client::open(std::env::var("RIVIAMIGO_TEST_REDIS_URL").unwrap()).unwrap();
        let mut conn = client.get_multiplexed_async_connection().await.unwrap();
        let _: () = redis::cmd("FLUSHDB").query_async(&mut conn).await.unwrap();
        let _: () = conn.set("session:fixture", "protected").await.unwrap();
        let config = SecurityConfig {
            basemap_cache_max_bytes: 50_000,
            basemap_cache_ttl_seconds: 60,
            ..Default::default()
        };
        for index in 0..10 {
            store(
                &client,
                &format!("external:basemap:fixture:{index}"),
                &vec![0; 20_000],
                "image/png",
                60,
                &config,
            )
            .await;
        }
        let total: u64 = conn.get(TOTAL).await.unwrap();
        assert!(total > 0 && total <= config.basemap_cache_max_bytes);
        let entries: Vec<String> = conn.zrange(INDEX, 0, -1).await.unwrap();
        assert!(entries.len() <= 2 && !entries.is_empty());
        for key in entries {
            let ttl: i64 = conn.ttl(key).await.unwrap();
            assert!(ttl > 0 && ttl <= 60);
        }
        let legacy = "external:basemap:legacy:fixture";
        let _: () = conn.set(legacy, "old").await.unwrap();
        let task = start_maintenance(client.clone());
        for _ in 0..40 {
            if !conn.exists::<_, bool>(legacy).await.unwrap() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        task.abort();
        assert!(!conn.exists::<_, bool>(legacy).await.unwrap());
        assert_eq!(
            conn.get::<_, String>("session:fixture").await.unwrap(),
            "protected"
        );
        let _: () = redis::cmd("FLUSHDB").query_async(&mut conn).await.unwrap();
    }
}
