//! Manages one Tokio task per vehicle.
//!
//! The supervisor is the single place that decides whether a vehicle's
//! worker may run: it refuses every start while the Rivian connection is off
//! for this server, and each launched worker first confirms that a manager
//! has not paused collection for its vehicle. Callers can therefore send
//! `StartWorker` freely (vehicle add, credential refresh, resume, boot).
//!
//! A stopped worker keeps its slot until its task has ended, so a quick
//! pause and resume never runs two workers (and two Rivian sockets) for one
//! vehicle: the resumed worker starts only after the old one is gone.
//!
//! A worker that returns on its own because a dependency was unavailable
//! (`WorkerExit::Retry`: the database, Redis, or the collector lock) is
//! started again after a backoff, so a vehicle does not stay dark until
//! someone restarts the API. Other exits wait for the action that fixes them.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;
use tokio::time::Instant;
use uuid::Uuid;

use crate::{
    config::Config,
    ingestion::worker::{run_vehicle_worker, WorkerExit},
};

type WorkerEntry = (JoinHandle<()>, broadcast::Sender<()>);
type WorkerFuture = Pin<Box<dyn Future<Output = WorkerExit> + Send + 'static>>;

/// How long a stopping worker may take to finish before it is aborted.
const WORKER_STOP_TIMEOUT: Duration = Duration::from_secs(5);

/// First delay before restarting a worker that exited on a transient failure.
const WORKER_RETRY_BASE: Duration = Duration::from_secs(5);

/// Longest delay between restarts while the failure persists.
const WORKER_RETRY_MAX: Duration = Duration::from_secs(300);

/// A worker that ran at least this long before exiting had recovered, so its
/// next restart starts again from the base delay.
const WORKER_RETRY_RESET_AFTER: Duration = Duration::from_secs(600);

/// The delay before restart number `attempt` (0-based): doubling from the base,
/// capped at the maximum.
fn worker_retry_delay(attempt: u32) -> Duration {
    WORKER_RETRY_BASE
        .saturating_mul(2u32.saturating_pow(attempt.min(16)))
        .min(WORKER_RETRY_MAX)
}

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
/// worker is told to stop. A paused vehicle is not restarted on its own;
/// resuming it starts the worker.
async fn run_unless_paused<C, CF, R, RF>(
    vehicle_id: Uuid,
    mut shutdown: broadcast::Receiver<()>,
    retry: Duration,
    mut is_paused: C,
    run: R,
) -> WorkerExit
where
    C: FnMut() -> CF,
    CF: Future<Output = Result<bool, sqlx::Error>>,
    R: FnOnce(broadcast::Receiver<()>) -> RF,
    RF: Future<Output = WorkerExit>,
{
    loop {
        match is_paused().await {
            Ok(false) => break,
            Ok(true) => {
                tracing::info!(
                    vehicle_id = %vehicle_id,
                    "worker not started: collection is paused for this vehicle"
                );
                return WorkerExit::NeedsAction;
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
                    _ = shutdown.recv() => return WorkerExit::Stopped,
                }
            }
        }
    }
    run(shutdown).await
}

/// One vehicle's worker as the supervisor tracks it.
enum WorkerSlot {
    Running(WorkerEntry),
    /// Told to stop; the previous task may still hold Rivian sockets. A start
    /// requested meanwhile waits until that task has finished.
    Stopping {
        restart: bool,
    },
    /// Exited on a transient failure; a restart of launch `generation` is
    /// scheduled. A `StartWorker` meanwhile starts it at once, and a
    /// `StopWorker` cancels the restart.
    RetryPending {
        generation: u64,
    },
}

/// The latest launch of one vehicle's worker.
struct Launch {
    generation: u64,
    started_at: Instant,
    /// Transient exits in a row, which sets the next restart's delay.
    retry_attempt: u32,
}

/// What a `StartWorker` should do for the vehicle's current slot.
#[derive(Debug, PartialEq, Eq)]
enum StartAction {
    Spawn,
    AlreadyRunning,
    /// The previous worker is still stopping; start once it has finished.
    Deferred,
}

fn prepare_worker_start(workers: &mut HashMap<Uuid, WorkerSlot>, vehicle_id: Uuid) -> StartAction {
    match workers.get_mut(&vehicle_id) {
        Some(WorkerSlot::Running((handle, _))) if !handle.is_finished() => {
            StartAction::AlreadyRunning
        }
        Some(WorkerSlot::Running(_)) => {
            workers.remove(&vehicle_id);
            StartAction::Spawn
        }
        Some(WorkerSlot::Stopping { restart }) => {
            *restart = true;
            StartAction::Deferred
        }
        Some(WorkerSlot::RetryPending { .. }) => {
            workers.remove(&vehicle_id);
            StartAction::Spawn
        }
        None => StartAction::Spawn,
    }
}

/// Signal a worker to stop and wait for its task to end, aborting it after
/// `timeout`. The abort is awaited for up to `timeout` as well; only a task
/// stuck in blocking code can still be running when this returns, and that
/// is logged as an error.
async fn stop_worker_task(
    vehicle_id: Uuid,
    mut handle: JoinHandle<()>,
    shutdown_tx: broadcast::Sender<()>,
    timeout: Duration,
) {
    let _ = shutdown_tx.send(());
    if tokio::time::timeout(timeout, &mut handle).await.is_err() {
        handle.abort();
        // An abort lands at the task's next await point; a task stuck in
        // blocking code never reaches one, so bound the wait rather than hold
        // the vehicle's slot (and any deferred restart) forever.
        let aborted = tokio::time::timeout(timeout, handle).await.is_ok();
        if aborted {
            tracing::warn!(
                vehicle_id = %vehicle_id,
                timeout_seconds = timeout.as_secs(),
                "worker did not stop in time; aborted"
            );
        } else {
            tracing::error!(
                vehicle_id = %vehicle_id,
                timeout_seconds = timeout.as_secs(),
                "worker ignored its abort; releasing its slot while it may still run"
            );
        }
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
    workers: HashMap<Uuid, WorkerSlot>,
    cmd_rx: mpsc::Receiver<SupervisorCommand>,
    /// Vehicles whose stopping worker task has ended.
    stopped_tx: mpsc::UnboundedSender<Uuid>,
    stopped_rx: mpsc::UnboundedReceiver<Uuid>,
    stop_timeout: Duration,
    /// Workers that returned: (vehicle, launch generation, why).
    exited_tx: mpsc::UnboundedSender<(Uuid, u64, WorkerExit)>,
    exited_rx: mpsc::UnboundedReceiver<(Uuid, u64, WorkerExit)>,
    /// Scheduled restarts that are due: (vehicle, generation that exited).
    retry_tx: mpsc::UnboundedSender<(Uuid, u64)>,
    retry_rx: mpsc::UnboundedReceiver<(Uuid, u64)>,
    launches: HashMap<Uuid, Launch>,
    next_generation: u64,
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
        let launcher = Arc::new(RivianWorkerLauncher {
            pool,
            redis,
            age_key,
            config,
        });
        let mut sup = WorkerSupervisor::new(launcher, workers_enabled, cmd_rx);

        tokio::spawn(async move { sup.run().await });

        SupervisorHandle { tx: cmd_tx }
    }

    fn new(
        launcher: Arc<dyn WorkerLauncher>,
        workers_enabled: bool,
        cmd_rx: mpsc::Receiver<SupervisorCommand>,
    ) -> Self {
        let (stopped_tx, stopped_rx) = mpsc::unbounded_channel();
        let (exited_tx, exited_rx) = mpsc::unbounded_channel();
        let (retry_tx, retry_rx) = mpsc::unbounded_channel();
        WorkerSupervisor {
            launcher,
            workers_enabled,
            workers: HashMap::new(),
            cmd_rx,
            stopped_tx,
            stopped_rx,
            stop_timeout: WORKER_STOP_TIMEOUT,
            exited_tx,
            exited_rx,
            retry_tx,
            retry_rx,
            launches: HashMap::new(),
            next_generation: 0,
        }
    }

    async fn run(&mut self) {
        loop {
            tokio::select! {
                cmd = self.cmd_rx.recv() => {
                    let Some(cmd) = cmd else { break };
                    if !self.handle_command(cmd) {
                        break;
                    }
                }
                Some(vehicle_id) = self.stopped_rx.recv() => self.worker_stopped(vehicle_id),
                Some((vehicle_id, generation, exit)) = self.exited_rx.recv() => {
                    self.worker_exited(vehicle_id, generation, exit);
                }
                Some((vehicle_id, generation)) = self.retry_rx.recv() => {
                    self.retry_due(vehicle_id, generation);
                }
            }
        }
    }

    /// Apply one command. Returns false when the supervisor should exit.
    fn handle_command(&mut self, cmd: SupervisorCommand) -> bool {
        match cmd {
            SupervisorCommand::StartWorker { vehicle_id } => {
                if !self.workers_enabled {
                    tracing::info!(
                        vehicle_id = %vehicle_id,
                        "worker not started: Rivian connection is off for this server"
                    );
                    return true;
                }
                match prepare_worker_start(&mut self.workers, vehicle_id) {
                    StartAction::Spawn => self.spawn_worker(vehicle_id),
                    StartAction::AlreadyRunning => {}
                    StartAction::Deferred => tracing::info!(
                        vehicle_id = %vehicle_id,
                        "worker start deferred until the previous worker has stopped"
                    ),
                }
            }
            SupervisorCommand::StopWorker { vehicle_id } => {
                match self.workers.remove(&vehicle_id) {
                    Some(WorkerSlot::Running((handle, shutdown_tx))) => {
                        let stopped_tx = self.stopped_tx.clone();
                        let timeout = self.stop_timeout;
                        tokio::spawn(async move {
                            stop_worker_task(vehicle_id, handle, shutdown_tx, timeout).await;
                            let _ = stopped_tx.send(vehicle_id);
                        });
                        self.workers
                            .insert(vehicle_id, WorkerSlot::Stopping { restart: false });
                        tracing::info!(vehicle_id = %vehicle_id, "worker stop requested");
                    }
                    Some(WorkerSlot::Stopping { .. }) => {
                        // Already stopping; a later stop cancels any deferred start.
                        self.workers
                            .insert(vehicle_id, WorkerSlot::Stopping { restart: false });
                    }
                    Some(WorkerSlot::RetryPending { .. }) => {
                        // Removing the slot is enough: the scheduled restart
                        // finds no pending slot and does nothing.
                        tracing::info!(vehicle_id = %vehicle_id, "scheduled worker restart cancelled");
                    }
                    None => {}
                }
            }
            SupervisorCommand::Shutdown => {
                let timeout = self.stop_timeout;
                for (vehicle_id, slot) in self.workers.drain() {
                    if let WorkerSlot::Running((handle, shutdown_tx)) = slot {
                        tokio::spawn(stop_worker_task(vehicle_id, handle, shutdown_tx, timeout));
                    }
                }
                return false;
            }
        }
        true
    }

    fn spawn_worker(&mut self, vehicle_id: Uuid) {
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        self.next_generation += 1;
        let generation = self.next_generation;
        let retry_attempt = self
            .launches
            .get(&vehicle_id)
            .map_or(0, |launch| launch.retry_attempt);
        self.launches.insert(
            vehicle_id,
            Launch {
                generation,
                started_at: Instant::now(),
                retry_attempt,
            },
        );
        let worker = self.launcher.launch(vehicle_id, shutdown_rx);
        let exited_tx = self.exited_tx.clone();
        let handle = tokio::spawn(async move {
            let exit = worker.await;
            let _ = exited_tx.send((vehicle_id, generation, exit));
        });
        self.workers
            .insert(vehicle_id, WorkerSlot::Running((handle, shutdown_tx)));
        tracing::info!(vehicle_id = %vehicle_id, "worker started");
    }

    /// A worker returned without being told to stop. A transient failure is
    /// restarted after a backoff; any other exit frees the slot until the
    /// action that fixes it (a resume, a reconnect) sends `StartWorker`.
    fn worker_exited(&mut self, vehicle_id: Uuid, generation: u64, exit: WorkerExit) {
        let Some(launch) = self
            .launches
            .get_mut(&vehicle_id)
            .filter(|launch| launch.generation == generation)
        else {
            return;
        };
        if !matches!(self.workers.get(&vehicle_id), Some(WorkerSlot::Running(_))) {
            // A stop already owns the slot; `worker_stopped` handles it.
            return;
        }
        if exit != WorkerExit::Retry || !self.workers_enabled {
            self.workers.remove(&vehicle_id);
            tracing::info!(vehicle_id = %vehicle_id, ?exit, "worker exited");
            return;
        }
        if launch.started_at.elapsed() >= WORKER_RETRY_RESET_AFTER {
            launch.retry_attempt = 0;
        }
        let delay = worker_retry_delay(launch.retry_attempt);
        launch.retry_attempt = launch.retry_attempt.saturating_add(1);
        self.workers
            .insert(vehicle_id, WorkerSlot::RetryPending { generation });
        let retry_tx = self.retry_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            let _ = retry_tx.send((vehicle_id, generation));
        });
        tracing::warn!(
            vehicle_id = %vehicle_id,
            retry_seconds = delay.as_secs(),
            "worker exited on a transient failure; restarting it after a delay"
        );
    }

    /// A scheduled restart is due. It runs only if nothing (a start, a stop, a
    /// newer exit) has replaced the pending slot since it was scheduled.
    fn retry_due(&mut self, vehicle_id: Uuid, generation: u64) {
        let pending = matches!(
            self.workers.get(&vehicle_id),
            Some(WorkerSlot::RetryPending { generation: pending }) if *pending == generation
        );
        if !pending {
            return;
        }
        self.workers.remove(&vehicle_id);
        if self.workers_enabled {
            self.spawn_worker(vehicle_id);
        }
    }

    /// The stopping worker's task has ended: free the slot and run a start
    /// that arrived meanwhile. The new worker re-checks the collection pause.
    fn worker_stopped(&mut self, vehicle_id: Uuid) {
        let Some(WorkerSlot::Stopping { restart }) = self.workers.get(&vehicle_id) else {
            return;
        };
        let restart = *restart;
        self.workers.remove(&vehicle_id);
        tracing::info!(vehicle_id = %vehicle_id, "worker stopped");
        if restart && self.workers_enabled {
            self.spawn_worker(vehicle_id);
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
                WorkerExit::Stopped
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
        make_supervisor(Arc::new(ParkedLauncher), extra_workers)
    }

    fn make_supervisor(
        launcher: Arc<dyn WorkerLauncher>,
        extra_workers: HashMap<Uuid, WorkerEntry>,
    ) -> (SupervisorHandle, WorkerSupervisor) {
        let (cmd_tx, cmd_rx) = mpsc::channel(64);
        let mut sup = WorkerSupervisor::new(launcher, true, cmd_rx);
        sup.workers = extra_workers
            .into_iter()
            .map(|(vehicle_id, entry)| (vehicle_id, WorkerSlot::Running(entry)))
            .collect();
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
            move |_| async move {
                ran_clone.store(true, Ordering::SeqCst);
                WorkerExit::Stopped
            },
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
            move |_| async move {
                ran_clone.store(true, Ordering::SeqCst);
                WorkerExit::Stopped
            },
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
            move |_| async move {
                ran_clone.store(true, Ordering::SeqCst);
                WorkerExit::Stopped
            },
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
                move |_| async move {
                    ran_clone.store(true, Ordering::SeqCst);
                    WorkerExit::Stopped
                },
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
        workers.insert(vehicle_id, WorkerSlot::Running((completed, shutdown_tx)));

        assert_eq!(
            prepare_worker_start(&mut workers, vehicle_id),
            StartAction::Spawn
        );
        assert!(!workers.contains_key(&vehicle_id));
    }

    // ── Stop then start never overlaps two workers ────────────────────────────

    /// Workers that take `stop_delay` to finish after the stop signal, the way
    /// a real worker closes its sockets. Tracks how many run at once.
    struct SlowStopLauncher {
        stop_delay: Duration,
        launched: AtomicU32,
        active: Arc<AtomicU32>,
        max_active: Arc<AtomicU32>,
    }

    impl SlowStopLauncher {
        fn new(stop_delay: Duration) -> Arc<Self> {
            Arc::new(Self {
                stop_delay,
                launched: AtomicU32::new(0),
                active: Arc::new(AtomicU32::new(0)),
                max_active: Arc::new(AtomicU32::new(0)),
            })
        }
    }

    impl WorkerLauncher for SlowStopLauncher {
        fn launch(&self, _vehicle_id: Uuid, mut shutdown: broadcast::Receiver<()>) -> WorkerFuture {
            self.launched.fetch_add(1, Ordering::SeqCst);
            let active = Arc::clone(&self.active);
            let max_active = Arc::clone(&self.max_active);
            let stop_delay = self.stop_delay;
            Box::pin(async move {
                let now = active.fetch_add(1, Ordering::SeqCst) + 1;
                max_active.fetch_max(now, Ordering::SeqCst);
                let _ = shutdown.recv().await;
                tokio::time::sleep(stop_delay).await;
                active.fetch_sub(1, Ordering::SeqCst);
                WorkerExit::Stopped
            })
        }
    }

    async fn wait_until(condition: impl Fn() -> bool) {
        timeout(Duration::from_secs(30), async {
            while !condition() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("condition should hold");
    }

    #[tokio::test(start_paused = true)]
    async fn a_quick_pause_and_resume_waits_for_the_old_worker_to_stop() {
        let vehicle_id = Uuid::new_v4();
        let launcher = SlowStopLauncher::new(Duration::from_secs(2));
        let (handle, mut sup) = make_supervisor(launcher.clone(), HashMap::new());
        tokio::spawn(async move { sup.run().await });

        handle
            .send(SupervisorCommand::StartWorker { vehicle_id })
            .await;
        wait_until(|| launcher.active.load(Ordering::SeqCst) == 1).await;
        handle
            .send(SupervisorCommand::StopWorker { vehicle_id })
            .await;
        handle
            .send(SupervisorCommand::StartWorker { vehicle_id })
            .await;

        // The resume is held while the first worker is still closing.
        tokio::time::sleep(Duration::from_secs(1)).await;
        assert_eq!(launcher.launched.load(Ordering::SeqCst), 1);

        wait_until(|| launcher.launched.load(Ordering::SeqCst) == 2).await;
        wait_until(|| launcher.active.load(Ordering::SeqCst) == 1).await;
        assert_eq!(
            launcher.max_active.load(Ordering::SeqCst),
            1,
            "two workers must never run for one vehicle"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_stop_while_stopping_cancels_the_deferred_start() {
        let vehicle_id = Uuid::new_v4();
        let launcher = SlowStopLauncher::new(Duration::from_secs(2));
        let (handle, mut sup) = make_supervisor(launcher.clone(), HashMap::new());
        tokio::spawn(async move { sup.run().await });

        handle
            .send(SupervisorCommand::StartWorker { vehicle_id })
            .await;
        wait_until(|| launcher.active.load(Ordering::SeqCst) == 1).await;
        for command in [
            SupervisorCommand::StopWorker { vehicle_id },
            SupervisorCommand::StartWorker { vehicle_id },
            SupervisorCommand::StopWorker { vehicle_id },
        ] {
            handle.send(command).await;
        }

        wait_until(|| launcher.active.load(Ordering::SeqCst) == 0).await;
        tokio::time::sleep(Duration::from_secs(10)).await;
        assert_eq!(launcher.launched.load(Ordering::SeqCst), 1);

        // The slot is free again once the old worker has gone.
        handle
            .send(SupervisorCommand::StartWorker { vehicle_id })
            .await;
        wait_until(|| launcher.launched.load(Ordering::SeqCst) == 2).await;
    }

    #[tokio::test(start_paused = true)]
    async fn a_worker_that_ignores_stop_is_aborted_before_the_restart() {
        let vehicle_id = Uuid::new_v4();
        // Far longer than the supervisor's stop timeout.
        let launcher = SlowStopLauncher::new(Duration::from_secs(3600));
        let (handle, mut sup) = make_supervisor(launcher.clone(), HashMap::new());
        sup.stop_timeout = Duration::from_secs(5);
        tokio::spawn(async move { sup.run().await });

        handle
            .send(SupervisorCommand::StartWorker { vehicle_id })
            .await;
        wait_until(|| launcher.active.load(Ordering::SeqCst) == 1).await;
        handle
            .send(SupervisorCommand::StopWorker { vehicle_id })
            .await;
        handle
            .send(SupervisorCommand::StartWorker { vehicle_id })
            .await;

        tokio::time::sleep(Duration::from_secs(4)).await;
        assert_eq!(launcher.launched.load(Ordering::SeqCst), 1);
        wait_until(|| launcher.launched.load(Ordering::SeqCst) == 2).await;
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

    // ── A worker that exits on its own ────────────────────────────────────────

    /// What one launch of a scripted worker does.
    #[derive(Clone, Copy)]
    enum Step {
        /// Run for this long, then return this exit.
        ExitAfter(Duration, WorkerExit),
        /// Run until told to stop.
        Park,
    }

    /// Workers that follow `steps` in order, one step per launch; launches
    /// past the end park.
    struct ScriptedLauncher {
        steps: Vec<Step>,
        launched: AtomicU32,
    }

    impl ScriptedLauncher {
        fn new(steps: Vec<Step>) -> Arc<Self> {
            Arc::new(Self {
                steps,
                launched: AtomicU32::new(0),
            })
        }

        fn launched(&self) -> u32 {
            self.launched.load(Ordering::SeqCst)
        }
    }

    impl WorkerLauncher for ScriptedLauncher {
        fn launch(&self, _vehicle_id: Uuid, mut shutdown: broadcast::Receiver<()>) -> WorkerFuture {
            let index = self.launched.fetch_add(1, Ordering::SeqCst) as usize;
            let step = self.steps.get(index).copied().unwrap_or(Step::Park);
            Box::pin(async move {
                match step {
                    Step::ExitAfter(ran_for, exit) => {
                        tokio::time::sleep(ran_for).await;
                        exit
                    }
                    Step::Park => {
                        let _ = shutdown.recv().await;
                        WorkerExit::Stopped
                    }
                }
            })
        }
    }

    fn start_supervisor(launcher: Arc<ScriptedLauncher>) -> SupervisorHandle {
        let (handle, mut sup) = make_supervisor(launcher, HashMap::new());
        tokio::spawn(async move { sup.run().await });
        handle
    }

    const RETRY_NOW: Step = Step::ExitAfter(Duration::ZERO, WorkerExit::Retry);

    #[test]
    fn retry_delay_doubles_from_the_base_and_is_capped() {
        let delays: Vec<u64> = (0..8).map(|n| worker_retry_delay(n).as_secs()).collect();
        assert_eq!(delays, [5, 10, 20, 40, 80, 160, 300, 300]);
        assert_eq!(worker_retry_delay(u32::MAX), WORKER_RETRY_MAX);
    }

    #[tokio::test]
    async fn a_paused_vehicle_reports_that_it_needs_a_resume() {
        let (_tx, rx) = broadcast::channel(1);
        let exit = run_unless_paused(
            Uuid::new_v4(),
            rx,
            Duration::from_millis(1),
            || async { Ok(true) },
            |_| async { WorkerExit::Stopped },
        )
        .await;
        assert_eq!(exit, WorkerExit::NeedsAction);
    }

    #[tokio::test(start_paused = true)]
    async fn a_transient_exit_is_restarted_with_a_growing_delay() {
        let vehicle_id = Uuid::new_v4();
        let launcher = ScriptedLauncher::new(vec![RETRY_NOW, RETRY_NOW]);
        let handle = start_supervisor(launcher.clone());

        handle
            .send(SupervisorCommand::StartWorker { vehicle_id })
            .await;
        wait_until(|| launcher.launched() == 1).await;

        // First restart after the 5s base delay, not before.
        tokio::time::sleep(Duration::from_secs(4)).await;
        assert_eq!(launcher.launched(), 1);
        wait_until(|| launcher.launched() == 2).await;

        // The second exit in a row waits twice as long.
        tokio::time::sleep(Duration::from_secs(9)).await;
        assert_eq!(launcher.launched(), 2);
        wait_until(|| launcher.launched() == 3).await;
    }

    #[tokio::test(start_paused = true)]
    async fn the_delay_resets_after_a_worker_ran_for_a_while() {
        let vehicle_id = Uuid::new_v4();
        let ran_long = Step::ExitAfter(WORKER_RETRY_RESET_AFTER, WorkerExit::Retry);
        let launcher = ScriptedLauncher::new(vec![RETRY_NOW, RETRY_NOW, ran_long]);
        let handle = start_supervisor(launcher.clone());

        handle
            .send(SupervisorCommand::StartWorker { vehicle_id })
            .await;
        // Two quick exits: restarts after 5s, then 10s.
        wait_until(|| launcher.launched() == 3).await;

        // The third launch ran long enough to count as recovered, so its
        // restart comes after the base delay again, not 20s.
        tokio::time::sleep(WORKER_RETRY_RESET_AFTER + Duration::from_secs(4)).await;
        assert_eq!(launcher.launched(), 3);
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert_eq!(launcher.launched(), 4);
    }

    #[tokio::test(start_paused = true)]
    async fn an_exit_that_needs_action_is_not_restarted() {
        let vehicle_id = Uuid::new_v4();
        let launcher = ScriptedLauncher::new(vec![Step::ExitAfter(
            Duration::ZERO,
            WorkerExit::NeedsAction,
        )]);
        let handle = start_supervisor(launcher.clone());

        handle
            .send(SupervisorCommand::StartWorker { vehicle_id })
            .await;
        wait_until(|| launcher.launched() == 1).await;
        tokio::time::sleep(Duration::from_secs(3600)).await;
        assert_eq!(launcher.launched(), 1);

        // The action that fixes it (a resume, a reconnect) starts it again.
        handle
            .send(SupervisorCommand::StartWorker { vehicle_id })
            .await;
        wait_until(|| launcher.launched() == 2).await;
    }

    #[tokio::test(start_paused = true)]
    async fn a_stop_cancels_a_scheduled_restart() {
        let vehicle_id = Uuid::new_v4();
        let launcher = ScriptedLauncher::new(vec![RETRY_NOW]);
        let handle = start_supervisor(launcher.clone());

        handle
            .send(SupervisorCommand::StartWorker { vehicle_id })
            .await;
        wait_until(|| launcher.launched() == 1).await;
        tokio::time::sleep(Duration::from_secs(1)).await;
        handle
            .send(SupervisorCommand::StopWorker { vehicle_id })
            .await;

        tokio::time::sleep(Duration::from_secs(3600)).await;
        assert_eq!(launcher.launched(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_start_during_the_delay_runs_at_once_and_only_once() {
        let vehicle_id = Uuid::new_v4();
        let launcher = ScriptedLauncher::new(vec![RETRY_NOW]);
        let handle = start_supervisor(launcher.clone());

        handle
            .send(SupervisorCommand::StartWorker { vehicle_id })
            .await;
        wait_until(|| launcher.launched() == 1).await;
        tokio::time::sleep(Duration::from_secs(1)).await;
        handle
            .send(SupervisorCommand::StartWorker { vehicle_id })
            .await;
        wait_until(|| launcher.launched() == 2).await;

        // The restart that was scheduled for the first exit must not start a
        // second worker next to the one just started.
        tokio::time::sleep(Duration::from_secs(3600)).await;
        assert_eq!(launcher.launched(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_worker_stopped_on_request_is_not_restarted() {
        let vehicle_id = Uuid::new_v4();
        let launcher = ScriptedLauncher::new(vec![Step::Park]);
        let handle = start_supervisor(launcher.clone());

        handle
            .send(SupervisorCommand::StartWorker { vehicle_id })
            .await;
        wait_until(|| launcher.launched() == 1).await;
        handle
            .send(SupervisorCommand::StopWorker { vehicle_id })
            .await;

        tokio::time::sleep(Duration::from_secs(3600)).await;
        assert_eq!(launcher.launched(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn no_restart_once_the_rivian_connection_is_off() {
        let vehicle_id = Uuid::new_v4();
        let launcher = ScriptedLauncher::new(vec![RETRY_NOW]);
        let (handle, mut sup) = make_supervisor(launcher.clone(), HashMap::new());
        assert!(sup.handle_command(SupervisorCommand::StartWorker { vehicle_id }));
        sup.workers_enabled = false;
        // Keep `handle` alive so the loop runs and sees the worker's exit.
        tokio::spawn(async move { sup.run().await });

        tokio::time::sleep(Duration::from_secs(3600)).await;
        assert_eq!(launcher.launched(), 1);
        drop(handle);
    }
}
