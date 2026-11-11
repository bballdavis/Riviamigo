//! Manages one Tokio task per vehicle.
//!
//! The supervisor is the single place that decides whether a vehicle's
//! worker may run: it refuses every start while the Rivian connection is off
//! for this server, and each launched worker first confirms that a manager
//! has not paused collection for its vehicle. Callers can therefore send
//! `StartWorker` freely (vehicle add, credential refresh, resume, boot).

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::{config::Config, ingestion::worker::run_vehicle_worker};

type WorkerEntry = (JoinHandle<()>, broadcast::Sender<()>);
type WorkerFuture = Pin<Box<dyn Future<Output = ()> + Send + 'static>>;

/// How long a worker waits before re-reading its vehicle's collection setting
/// after the database could not answer.
const PAUSE_CHECK_RETRY: Duration = Duration::from_secs(5);

/// Builds the task that runs one vehicle's worker. Tests substitute a fake.
trait WorkerLauncher: Send + Sync {
    fn launch(&self, vehicle_id: Uuid, shutdown: broadcast::Receiver<()>) -> WorkerFuture;
}

/// The production launcher: the Rivian vehicle worker, behind the per-vehicle
/// collection pause.
struct RivianWorkerLauncher {
    pool: sqlx::PgPool,
    redis: redis::Client,
    age_key: String,
    config: Config,
}

impl WorkerLauncher for RivianWorkerLauncher {
    fn launch(&self, vehicle_id: Uuid, shutdown: broadcast::Receiver<()>) -> WorkerFuture {
        let pool = self.pool.clone();
        let redis = self.redis.clone();
        let age_key = self.age_key.clone();
        let config = self.config.clone();
        let gate_pool = pool.clone();
        Box::pin(run_unless_paused(
            vehicle_id,
            shutdown,
            PAUSE_CHECK_RETRY,
            move || collection_paused(gate_pool.clone(), vehicle_id),
            move |shutdown| run_vehicle_worker(vehicle_id, pool, redis, age_key, config, shutdown),
        ))
    }
}

/// Whether a manager paused collection for this vehicle. A vehicle row that no
/// longer exists is not paused; the worker reports that state itself.
async fn collection_paused(pool: sqlx::PgPool, vehicle_id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        "SELECT COALESCE(
             (SELECT collection_paused FROM riviamigo.vehicles WHERE id = $1),
             FALSE
         )",
    )
    .bind(vehicle_id)
    .fetch_one(&pool)
    .await
}

/// Run the worker only when its vehicle's collection is not paused. A failed
/// read is retried (never treated as "not paused") until it succeeds or the
/// worker is told to stop.
async fn run_unless_paused<C, CF, R, RF>(
    vehicle_id: Uuid,
    mut shutdown: broadcast::Receiver<()>,
    retry: Duration,
    mut is_paused: C,
    run: R,
) where
    C: FnMut() -> CF,
    CF: Future<Output = Result<bool, sqlx::Error>>,
    R: FnOnce(broadcast::Receiver<()>) -> RF,
    RF: Future<Output = ()>,
{
    loop {
        match is_paused().await {
            Ok(false) => break,
            Ok(true) => {
                tracing::info!(
                    vehicle_id = %vehicle_id,
                    "worker not started: collection is paused for this vehicle"
                );
                return;
            }
            Err(error) => {
                tracing::warn!(
                    vehicle_id = %vehicle_id,
                    err = %error,
                    retry_seconds = retry.as_secs(),
                    "worker start deferred: the vehicle's collection setting could not be read"
                );
                tokio::select! {
                    _ = tokio::time::sleep(retry) => {}
                    _ = shutdown.recv() => return,
                }
            }
        }
    }
    run(shutdown).await
}

fn prepare_worker_start(workers: &mut HashMap<Uuid, WorkerEntry>, vehicle_id: Uuid) -> bool {
    match workers.get(&vehicle_id) {
        Some((handle, _)) if !handle.is_finished() => false,
        Some(_) => {
            workers.remove(&vehicle_id);
            true
        }
        None => true,
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
    pub async fn send(&self, cmd: SupervisorCommand) -> bool {
        self.tx.send(cmd).await.is_ok()
    }

    /// Creates a handle whose commands are silently dropped — for use in tests.
    pub fn noop() -> Self {
        let (tx, _rx) = mpsc::channel(1);
        Self { tx }
    }
}

pub struct WorkerSupervisor {
    launcher: Arc<dyn WorkerLauncher>,
    /// False when the Rivian connection is switched off for this server.
    workers_enabled: bool,
    workers: HashMap<Uuid, WorkerEntry>,
    cmd_rx: mpsc::Receiver<SupervisorCommand>,
}

impl WorkerSupervisor {
    pub fn start(
        pool: sqlx::PgPool,
        redis: redis::Client,
        age_key: String,
        config: Config,
        workers_enabled: bool,
    ) -> SupervisorHandle {
        let (cmd_tx, cmd_rx) = mpsc::channel(64);

        let mut sup = WorkerSupervisor {
            launcher: Arc::new(RivianWorkerLauncher {
                pool,
                redis,
                age_key,
                config,
            }),
            workers_enabled,
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
                    if !self.workers_enabled {
                        tracing::info!(
                            vehicle_id = %vehicle_id,
                            "worker not started: Rivian connection is off for this server"
                        );
                        continue;
                    }
                    if !prepare_worker_start(&mut self.workers, vehicle_id) {
                        continue;
                    }
                    let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
                    let handle = tokio::spawn(self.launcher.launch(vehicle_id, shutdown_rx));
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc,
    };
    use tokio::time::timeout;

    /// A launcher whose workers park until told to stop.
    struct ParkedLauncher;

    impl WorkerLauncher for ParkedLauncher {
        fn launch(&self, _vehicle_id: Uuid, mut shutdown: broadcast::Receiver<()>) -> WorkerFuture {
            Box::pin(async move {
                let _ = shutdown.recv().await;
            })
        }
    }

    /// Build a `WorkerSupervisor` whose `run()` loop can be driven by the caller
    /// via the returned `SupervisorHandle`. Workers in `extra_workers` are
    /// pre-injected so tests can verify `StopWorker` / `Shutdown` behaviour
    /// without touching the real worker factory.
    fn make_supervisor_with_workers(
        extra_workers: HashMap<Uuid, WorkerEntry>,
    ) -> (SupervisorHandle, WorkerSupervisor) {
        let (cmd_tx, cmd_rx) = mpsc::channel(64);
        let sup = WorkerSupervisor {
            launcher: Arc::new(ParkedLauncher),
            workers_enabled: true,
            workers: extra_workers,
            cmd_rx,
        };
        (SupervisorHandle { tx: cmd_tx }, sup)
    }

    // ── collection pause ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn a_paused_vehicle_never_starts_its_worker() {
        let ran = Arc::new(AtomicBool::new(false));
        let ran_clone = Arc::clone(&ran);
        let (_tx, rx) = broadcast::channel(1);
        run_unless_paused(
            Uuid::new_v4(),
            rx,
            Duration::from_millis(1),
            || async { Ok(true) },
            move |_| async move { ran_clone.store(true, Ordering::SeqCst) },
        )
        .await;
        assert!(!ran.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn an_active_vehicle_starts_its_worker() {
        let ran = Arc::new(AtomicBool::new(false));
        let ran_clone = Arc::clone(&ran);
        let (_tx, rx) = broadcast::channel(1);
        run_unless_paused(
            Uuid::new_v4(),
            rx,
            Duration::from_millis(1),
            || async { Ok(false) },
            move |_| async move { ran_clone.store(true, Ordering::SeqCst) },
        )
        .await;
        assert!(ran.load(Ordering::SeqCst));
    }

    #[tokio::test(start_paused = true)]
    async fn an_unreadable_pause_setting_is_retried_not_assumed() {
        let checks = Arc::new(AtomicU32::new(0));
        let checks_clone = Arc::clone(&checks);
        let ran = Arc::new(AtomicBool::new(false));
        let ran_clone = Arc::clone(&ran);
        let (_tx, rx) = broadcast::channel(1);
        run_unless_paused(
            Uuid::new_v4(),
            rx,
            Duration::from_secs(5),
            move || {
                let attempt = checks_clone.fetch_add(1, Ordering::SeqCst);
                async move {
                    if attempt < 2 {
                        Err(sqlx::Error::PoolTimedOut)
                    } else {
                        Ok(true)
                    }
                }
            },
            move |_| async move { ran_clone.store(true, Ordering::SeqCst) },
        )
        .await;
        assert_eq!(checks.load(Ordering::SeqCst), 3);
        assert!(
            !ran.load(Ordering::SeqCst),
            "the retried read found the vehicle paused"
        );
    }

    #[tokio::test]
    async fn stopping_while_the_pause_setting_is_unreadable_does_not_start() {
        let ran = Arc::new(AtomicBool::new(false));
        let ran_clone = Arc::clone(&ran);
        let (tx, rx) = broadcast::channel(1);
        tx.send(()).unwrap();
        timeout(
            Duration::from_secs(2),
            run_unless_paused(
                Uuid::new_v4(),
                rx,
                Duration::from_secs(3600),
                || async { Err(sqlx::Error::PoolTimedOut) },
                move |_| async move { ran_clone.store(true, Ordering::SeqCst) },
            ),
        )
        .await
        .expect("a stop request ends the wait");
        assert!(!ran.load(Ordering::SeqCst));
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

    #[tokio::test]
    async fn send_reports_when_supervisor_channel_is_closed() {
        let (tx, rx) = mpsc::channel(1);
        drop(rx);
        let handle = SupervisorHandle { tx };

        assert!(
            !handle
                .send(SupervisorCommand::StartWorker {
                    vehicle_id: Uuid::new_v4(),
                })
                .await
        );
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

    // ── Rivian connection switched off ────────────────────────────────────────

    #[tokio::test]
    async fn start_worker_is_ignored_while_the_rivian_connection_is_off() {
        let (handle, mut sup) = make_supervisor_with_workers(HashMap::new());
        sup.workers_enabled = false;
        assert!(
            handle
                .send(SupervisorCommand::StartWorker {
                    vehicle_id: Uuid::new_v4(),
                })
                .await
        );
        // Closing the channel ends the run loop once the queued command is handled.
        drop(handle);
        timeout(Duration::from_secs(2), sup.run())
            .await
            .expect("supervisor should stop when its channel closes");
        assert!(sup.workers.is_empty());
    }

    // ── StartWorker is idempotent ─────────────────────────────────────────────

    #[tokio::test]
    async fn start_worker_twice_does_not_spawn_duplicate() {
        // We can't easily inspect the workers map from outside, so we verify
        // idempotency indirectly: a second StartWorker for the same vehicle_id
        // must NOT send a second shutdown broadcast when we subsequently stop it.
        let vehicle_id = Uuid::new_v4();

        let (shutdown_tx, mut shutdown_rx) = broadcast::channel::<()>(1);
        let signal_count = Arc::new(AtomicU32::new(0));
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

    #[tokio::test]
    async fn finished_worker_slot_can_be_started_again() {
        let vehicle_id = Uuid::new_v4();
        let (shutdown_tx, _shutdown_rx) = broadcast::channel::<()>(1);
        let completed = tokio::spawn(async {});
        timeout(Duration::from_secs(2), async {
            while !completed.is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("test worker should finish");
        assert!(completed.is_finished());

        let mut workers = HashMap::new();
        workers.insert(vehicle_id, (completed, shutdown_tx));

        assert!(prepare_worker_start(&mut workers, vehicle_id));
        assert!(!workers.contains_key(&vehicle_id));
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
