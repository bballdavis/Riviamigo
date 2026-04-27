//! Manages one Tokio task per vehicle.

use std::collections::HashMap;
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::{config::Config, ingestion::worker::run_vehicle_worker};

#[derive(Debug)]
pub enum SupervisorCommand {
    StartWorker { vehicle_id: Uuid },
    StopWorker  { vehicle_id: Uuid },
    Shutdown,
}

#[derive(Clone)]
pub struct SupervisorHandle {
    tx: mpsc::Sender<SupervisorCommand>,
}

impl SupervisorHandle {
    pub async fn send(&self, cmd: SupervisorCommand) {
        let _ = self.tx.send(cmd).await;
    }
}

pub struct WorkerSupervisor {
    pool:        sqlx::PgPool,
    redis:       redis::Client,
    age_key:     String,
    config:      Config,
    workers:     HashMap<Uuid, (JoinHandle<()>, broadcast::Sender<()>)>,
    cmd_rx:      mpsc::Receiver<SupervisorCommand>,
}

impl WorkerSupervisor {
    pub fn start(
        pool:    sqlx::PgPool,
        redis:   redis::Client,
        config:  Config,
    ) -> SupervisorHandle {
        let age_key = config.age_key.clone();
        let (cmd_tx, cmd_rx) = mpsc::channel(64);

        let mut sup = WorkerSupervisor {
            pool, redis, age_key, config,
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
                    if self.workers.contains_key(&vehicle_id) { continue; }
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
                        handle.abort();
                        tracing::info!(vehicle_id = %vehicle_id, "worker stopped");
                    }
                }
                SupervisorCommand::Shutdown => {
                    for (_, (handle, shutdown_tx)) in self.workers.drain() {
                        let _ = shutdown_tx.send(());
                        handle.abort();
                    }
                    break;
                }
            }
        }
    }
}
