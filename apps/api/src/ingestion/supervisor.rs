//! Manages one Tokio task per vehicle.

use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::{config::Config, ingestion::worker::run_vehicle_worker};

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use tokio::time::timeout;

    /// Build a minimal `Config` suitable for unit tests (no real DB connections made).
    fn test_config() -> Config {
        Config {
            database_url: "postgres://invalid/invalid".into(),
            redis_url: "redis://127.0.0.1/".into(),
            jwt_secret: None,
            jwt_public_key: None,
            age_encryption_key: None,
            port: 3001,
            allowed_origins: vec![],
            s3_endpoint: None,
            s3_access_key: None,
            s3_secret_key: None,
            backup_artifact_dir: std::env::temp_dir()
                .join("riviamigo-backups-test")
                .to_string_lossy()
                .into_owned(),
            vehicle_image_cache_dir: std::env::temp_dir()
                .join("riviamigo-vehicle-images-test")
                .to_string_lossy()
                .into_owned(),
            backup_driver: "pg_dump".into(),
            backup_poll_interval_seconds: 60,
            restore_agent_url: "http://127.0.0.1:3002".into(),
            restore_agent_key_file: "/backups/.restore-agent-key".into(),
            rivian_ws_reconnect_initial_seconds: 10,
            rivian_ws_reconnect_max_seconds: 900,
            rivian_raw_event_retention_days: 7,
            rivian_persist_raw_events: false,
            rivian_suppress_duplicate_telemetry: true,
            riviamigo_env: None,
            cookie_insecure: Some("1".into()),
            rate_limit: crate::config::RateLimitConfig::default(),
        }
    }

    /// Build a `WorkerSupervisor` whose `run()` loop can be driven by the caller
    /// via the returned `SupervisorHandle`. Workers in `extra_workers` are
    /// pre-injected so tests can verify `StopWorker` / `Shutdown` behaviour
    /// without touching the real worker factory.
    fn make_supervisor_with_workers(
        extra_workers: HashMap<Uuid, (JoinHandle<()>, broadcast::Sender<()>)>,
    ) -> (SupervisorHandle, WorkerSupervisor) {
        use sqlx::postgres::PgPoolOptions;
        let pool = PgPoolOptions::new()
            .connect_lazy("postgres://invalid/invalid")
            .expect("lazy pool");
        let redis = redis::Client::open("redis://127.0.0.1/").expect("redis client");
        let (cmd_tx, cmd_rx) = mpsc::channel(64);
        let sup = WorkerSupervisor {
            pool,
            redis,
            age_key: "test-key".into(),
            config: test_config(),
            workers: extra_workers,
            cmd_rx,
        };
        (SupervisorHandle { tx: cmd_tx }, sup)
    }

    // ── noop handle ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn noop_handle_accepts_all_commands_without_panicking() {
        let handle = SupervisorHandle::noop();
        let id = Uuid::new_v4();
        handle
            .send(SupervisorCommand::StartWorker { vehicle_id: id })
            .await;
        handle
            .send(SupervisorCommand::StopWorker { vehicle_id: id })
            .await;
        handle.send(SupervisorCommand::Shutdown).await;
    }

    // ── StopWorker sends shutdown signal ─────────────────────────────────────

    #[tokio::test]
    async fn stop_worker_signals_shutdown_broadcast() {
        let vehicle_id = Uuid::new_v4();

        // A worker that parks until it receives the broadcast shutdown signal.
        let (shutdown_tx, mut shutdown_rx) = broadcast::channel::<()>(1);
        let received_shutdown = Arc::new(AtomicBool::new(false));
        let received_clone = Arc::clone(&received_shutdown);
        let handle = tokio::spawn(async move {
            let _ = shutdown_rx.recv().await;
            received_clone.store(true, Ordering::SeqCst);
        });

        let mut workers = HashMap::new();
        workers.insert(vehicle_id, (handle, shutdown_tx));

        let (handle, mut sup) = make_supervisor_with_workers(workers);

        // Drive the supervisor loop in a background task.
        tokio::spawn(async move { sup.run().await });

        handle
            .send(SupervisorCommand::StopWorker { vehicle_id })
            .await;

        // Give the worker time to process the broadcast and set the flag.
        timeout(Duration::from_secs(2), async {
            while !received_shutdown.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("worker should have received the shutdown broadcast within 2s");
    }

    // ── StartWorker is idempotent ─────────────────────────────────────────────

    #[tokio::test]
    async fn start_worker_twice_does_not_spawn_duplicate() {
        // We can't easily inspect the workers map from outside, so we verify
        // idempotency indirectly: a second StartWorker for the same vehicle_id
        // must NOT send a second shutdown broadcast when we subsequently stop it.
        let vehicle_id = Uuid::new_v4();

        let (shutdown_tx, mut shutdown_rx) = broadcast::channel::<()>(1);
        let signal_count = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let signal_clone = Arc::clone(&signal_count);
        let handle = tokio::spawn(async move {
            // Count how many shutdown signals arrive.
            while shutdown_rx.recv().await.is_ok() {
                signal_clone.fetch_add(1, Ordering::SeqCst);
            }
        });

        let mut workers = HashMap::new();
        workers.insert(vehicle_id, (handle, shutdown_tx));

        let (sup_handle, mut sup) = make_supervisor_with_workers(workers);
        tokio::spawn(async move { sup.run().await });

        // This second StartWorker should be ignored (vehicle already registered).
        sup_handle
            .send(SupervisorCommand::StartWorker { vehicle_id })
            .await;
        sup_handle
            .send(SupervisorCommand::StopWorker { vehicle_id })
            .await;

        tokio::time::sleep(Duration::from_millis(200)).await;

        // Only one shutdown signal should have arrived (from the one real worker).
        assert_eq!(
            signal_count.load(Ordering::SeqCst),
            1,
            "duplicate StartWorker must not result in extra shutdown signals"
        );
    }

    // ── Shutdown drains all workers ───────────────────────────────────────────

    #[tokio::test]
    async fn shutdown_signals_all_workers() {
        let ids: Vec<Uuid> = (0..3).map(|_| Uuid::new_v4()).collect();
        let mut workers = HashMap::new();

        let flags: Vec<Arc<AtomicBool>> = ids
            .iter()
            .map(|_| Arc::new(AtomicBool::new(false)))
            .collect();

        for (id, flag) in ids.iter().zip(flags.iter()) {
            let (shutdown_tx, mut shutdown_rx) = broadcast::channel::<()>(1);
            let flag_clone = Arc::clone(flag);
            let handle = tokio::spawn(async move {
                let _ = shutdown_rx.recv().await;
                flag_clone.store(true, Ordering::SeqCst);
            });
            workers.insert(*id, (handle, shutdown_tx));
        }

        let (sup_handle, mut sup) = make_supervisor_with_workers(workers);
        tokio::spawn(async move { sup.run().await });

        sup_handle.send(SupervisorCommand::Shutdown).await;

        timeout(Duration::from_secs(2), async {
            loop {
                if flags.iter().all(|f| f.load(Ordering::SeqCst)) {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("all workers should receive shutdown within 2s");
    }
}

#[derive(Debug)]
pub enum SupervisorCommand {
    StartWorker { vehicle_id: Uuid },
    StopWorker { vehicle_id: Uuid },
    Shutdown,
}

#[derive(Debug, Clone)]
pub struct SupervisorHandle {
    tx: mpsc::Sender<SupervisorCommand>,
}

impl SupervisorHandle {
    pub async fn send(&self, cmd: SupervisorCommand) {
        let _ = self.tx.send(cmd).await;
    }

    /// Creates a handle whose commands are silently dropped — for use in tests.
    pub fn noop() -> Self {
        let (tx, _rx) = mpsc::channel(1);
        Self { tx }
    }
}

pub struct WorkerSupervisor {
    pool: sqlx::PgPool,
    redis: redis::Client,
    age_key: String,
    config: Config,
    workers: HashMap<Uuid, (JoinHandle<()>, broadcast::Sender<()>)>,
    cmd_rx: mpsc::Receiver<SupervisorCommand>,
}

impl WorkerSupervisor {
    pub fn start(
        pool: sqlx::PgPool,
        redis: redis::Client,
        age_key: String,
        config: Config,
    ) -> SupervisorHandle {
        let (cmd_tx, cmd_rx) = mpsc::channel(64);

        let mut sup = WorkerSupervisor {
            pool,
            redis,
            age_key,
            config,
            workers: HashMap::new(),
            cmd_rx,
        };

        tokio::spawn(async move { sup.run().await });

        SupervisorHandle { tx: cmd_tx }
    }

    async fn run(&mut self) {
        while let Some(cmd) = self.cmd_rx.recv().await {
            match cmd {
                SupervisorCommand::StartWorker { vehicle_id } => {
                    if self.workers.contains_key(&vehicle_id) {
                        continue;
                    }
                    let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
                    let handle = tokio::spawn(run_vehicle_worker(
                        vehicle_id,
                        self.pool.clone(),
                        self.redis.clone(),
                        self.age_key.clone(),
                        self.config.clone(),
                        shutdown_rx,
                    ));
                    self.workers.insert(vehicle_id, (handle, shutdown_tx));
                    tracing::info!(vehicle_id = %vehicle_id, "worker started");
                }
                SupervisorCommand::StopWorker { vehicle_id } => {
                    if let Some((handle, shutdown_tx)) = self.workers.remove(&vehicle_id) {
                        let _ = shutdown_tx.send(());
                        tokio::spawn(async move {
                            tokio::pin!(handle);
                            tokio::select! {
                                _ = &mut handle => {},
                                _ = tokio::time::sleep(Duration::from_secs(5)) => {
                                    handle.abort();
                                    tracing::warn!(vehicle_id = %vehicle_id, "worker did not stop within 5s; aborted");
                                }
                            }
                        });
                        tracing::info!(vehicle_id = %vehicle_id, "worker stop requested");
                    }
                }
                SupervisorCommand::Shutdown => {
                    let drain: Vec<_> = self.workers.drain().collect();
                    for (vid, (handle, shutdown_tx)) in drain {
                        let _ = shutdown_tx.send(());
                        tokio::spawn(async move {
                            tokio::pin!(handle);
                            tokio::select! {
                                _ = &mut handle => {},
                                _ = tokio::time::sleep(Duration::from_secs(5)) => {
                                    handle.abort();
                                    tracing::warn!(vehicle_id = %vid, "worker did not stop within 5s on shutdown; aborted");
                                }
                            }
                        });
                    }
                    break;
                }
            }
        }
    }
}
