//! Ephemeral recovery work belongs on the configured backup volume, not /tmp.
//!
//! Each workspace is a UUID directory beneath `.recovery-work`, paired with a
//! sibling `<uuid>.lock` file that its owner holds an exclusive advisory lock
//! on for the workspace's lifetime. The operating system releases that lock
//! when the owning process exits, however it exits, so a workspace whose lock
//! can be taken was abandoned by a crash. The API and the restore agent share
//! this directory; both reclaim abandoned workspaces before creating a new
//! one, and neither can remove a workspace that is still in use.
use crate::{config::RecoveryConfig, errors::AppError};
use cap_fs_ext::DirExt;
use cap_std::{ambient_authority, fs::Dir};
use std::{
    fs::File,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::Arc,
};

const WORK_DIR: &str = ".recovery-work";
const LOCK_SUFFIX: &str = ".lock";
/// A lock file this young may belong to an owner that created it but has not
/// locked it yet, so the sweep leaves it alone.
const LOCK_FILE_GRACE: std::time::Duration = std::time::Duration::from_secs(60);
/// A workspace directory with no lock file was made by a build that predates
/// lock files, or lost its lock file. During an upgrade such a build may still
/// be using it, so it is reclaimed only once it is clearly stale.
const UNLOCKED_DIR_GRACE: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

/// Workspaces this process owns. Advisory locks already exclude them on a
/// local filesystem; this also covers filesystems that emulate `flock` with
/// per-process locks, where this process could otherwise lock its own file.
static ACTIVE_WORKSPACES: std::sync::Mutex<std::collections::BTreeSet<String>> =
    std::sync::Mutex::new(std::collections::BTreeSet::new());

fn active_workspaces() -> std::sync::MutexGuard<'static, std::collections::BTreeSet<String>> {
    ACTIVE_WORKSPACES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(crate) struct RecoveryWorkspace {
    parent: Dir,
    name: String,
    path: PathBuf,
    /// Exclusive lock on `<name>.lock`, released after `Drop` removes the
    /// workspace. Held only for its effect on other sweeps.
    _lock: File,
}

fn lock_name(id: &str) -> String {
    format!("{id}{LOCK_SUFFIX}")
}

/// Workspace ids under `.recovery-work`, whether only the directory, only the
/// lock file, or both survive. Entries that are not ours are left alone.
fn workspace_ids(parent: &Dir) -> std::io::Result<std::collections::BTreeSet<String>> {
    let mut ids = std::collections::BTreeSet::new();
    for entry in parent.entries()? {
        let Ok(name) = entry?.file_name().into_string() else {
            continue;
        };
        let id = name.strip_suffix(LOCK_SUFFIX).unwrap_or(&name);
        if uuid::Uuid::try_parse(id).is_ok_and(|uuid| uuid.hyphenated().to_string() == id) {
            ids.insert(id.to_string());
        }
    }
    Ok(ids)
}

/// Removes one workspace if no live process holds its lock. Returns whether
/// it was reclaimed.
fn reclaim_if_abandoned(parent: &Dir, id: &str) -> std::io::Result<bool> {
    let lock_name = lock_name(id);
    let lock = match parent.open(&lock_name) {
        Ok(file) => {
            if younger_than(parent, &lock_name, LOCK_FILE_GRACE)? {
                return Ok(false);
            }
            file
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            if younger_than(parent, id, UNLOCKED_DIR_GRACE)? {
                return Ok(false);
            }
            // Give the stale directory a lock file so the reclaim is still
            // exclusive against another sweeping process.
            parent.open_with(
                &lock_name,
                cap_std::fs::OpenOptions::new().write(true).create(true),
            )?
        }
        Err(error) => return Err(error),
    }
    .into_std();
    match lock.try_lock() {
        Ok(()) => {}
        Err(std::fs::TryLockError::WouldBlock) => return Ok(false),
        Err(std::fs::TryLockError::Error(error)) => return Err(error),
    }
    match parent.remove_dir_all(id) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    match parent.remove_file(&lock_name) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    Ok(true)
}

/// Whether `name` under `parent` was modified less than `grace` ago. A
/// missing entry, or a clock that reads earlier than the entry, counts as
/// young so the sweep errs toward leaving it.
fn younger_than(parent: &Dir, name: &str, grace: std::time::Duration) -> std::io::Result<bool> {
    let modified = match parent.metadata(name) {
        Ok(metadata) => metadata.modified()?.into_std(),
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(true),
        Err(error) => return Err(error),
    };
    Ok(std::time::SystemTime::now()
        .duration_since(modified)
        .map_or(true, |age| age < grace))
}

/// Whether the open `lock` is still the file named `lock_name`. A sweep in
/// another process can unlink a lock file between its creation and its lock;
/// an owner holding such an orphaned lock would not protect its workspace.
#[cfg(unix)]
fn lock_still_linked(parent: &Dir, lock_name: &str, lock: &File) -> std::io::Result<bool> {
    use cap_std::fs::MetadataExt as _;
    use std::os::unix::fs::MetadataExt as _;
    let held = lock.metadata()?;
    match parent.metadata(lock_name) {
        Ok(named) => Ok(named.dev() == held.dev() && named.ino() == held.ino()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

#[cfg(not(unix))]
fn lock_still_linked(_parent: &Dir, _lock_name: &str, _lock: &File) -> std::io::Result<bool> {
    // Windows refuses to delete a file another handle has open.
    Ok(true)
}

/// Best-effort removal of workspaces abandoned by a crashed process, so their
/// extracted backup contents stop consuming the free-space reserve. Only
/// UUID-named entries directly under `.recovery-work` are considered, and a
/// workspace whose owner is still running is never touched.
fn sweep_abandoned_workspaces(parent: &Dir) -> usize {
    let ids = match workspace_ids(parent) {
        Ok(ids) => ids,
        Err(error) => {
            tracing::warn!(%error, "recovery_workspace.sweep_list_failed");
            return 0;
        }
    };
    let mut reclaimed = 0;
    for id in ids {
        if active_workspaces().contains(&id) {
            continue;
        }
        match reclaim_if_abandoned(parent, &id) {
            Ok(true) => reclaimed += 1,
            Ok(false) => {}
            Err(error) => {
                tracing::warn!(workspace = %id, %error, "recovery_workspace.sweep_failed");
            }
        }
    }
    if reclaimed > 0 {
        tracing::info!(reclaimed, "recovery_workspace.abandoned_reclaimed");
    }
    reclaimed
}

impl RecoveryWorkspace {
    /// Async callers use this: creating a workspace may first delete large
    /// abandoned trees, which must not block a runtime worker thread.
    pub(crate) async fn create(
        root: &Path,
        limits: &RecoveryConfig,
    ) -> Result<Arc<Self>, AppError> {
        let root = root.to_path_buf();
        let limits = limits.clone();
        tokio::task::spawn_blocking(move || Self::new(&root, &limits))
            .await
            .map_err(|error| {
                AppError::Internal(anyhow::anyhow!("recovery workspace task failed: {error}"))
            })?
    }

    pub(crate) fn new(root: &Path, limits: &RecoveryConfig) -> Result<Arc<Self>, AppError> {
        std::fs::create_dir_all(root)?;
        let root_dir = Dir::open_ambient_dir(root, ambient_authority())?;
        match root_dir.create_dir(WORK_DIR) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
        let parent = root_dir.open_dir_nofollow(WORK_DIR)?;
        // Reclaim abandoned workspaces first so their space counts below.
        sweep_abandoned_workspaces(&parent);
        if fs2::available_space(root)? < limits.min_free_bytes {
            return Err(AppError::RecoveryInsufficientStorage(
                "Recovery workspace would consume reserved free space.".into(),
            ));
        }
        let name = uuid::Uuid::new_v4().to_string();
        active_workspaces().insert(name.clone());
        let forget = |parent: &Dir, remove_lock: bool| {
            if remove_lock {
                let _ = parent.remove_file(lock_name(&name));
            }
            active_workspaces().remove(&name);
        };
        // Take the lock before the directory exists, so no sweep can see the
        // directory without a held lock.
        let lock = match parent.open_with(
            lock_name(&name),
            cap_std::fs::OpenOptions::new().write(true).create_new(true),
        ) {
            Ok(lock) => lock.into_std(),
            Err(error) => {
                forget(&parent, false);
                return Err(error.into());
            }
        };
        if let Err(error) = lock.try_lock() {
            forget(&parent, true);
            return Err(AppError::Internal(anyhow::anyhow!(
                "could not lock a new recovery workspace: {error}"
            )));
        }
        match lock_still_linked(&parent, &lock_name(&name), &lock) {
            Ok(true) => {}
            Ok(false) => {
                forget(&parent, false);
                return Err(AppError::Internal(anyhow::anyhow!(
                    "a concurrent sweep removed a new recovery workspace's lock file; try again"
                )));
            }
            Err(error) => {
                forget(&parent, true);
                return Err(error.into());
            }
        }
        let builder = cap_std::fs::DirBuilder::new();
        // cap-std directory handles may use O_PATH on Linux, which cannot be
        // fchmod'ed. Apply private permissions atomically at mkdir instead.
        #[cfg(unix)]
        let builder = {
            use cap_std::fs::DirBuilderExt;
            let mut builder = builder;
            builder.mode(0o700);
            builder
        };
        if let Err(error) = parent.create_dir_with(&name, &builder) {
            forget(&parent, true);
            return Err(error.into());
        }
        let workspace = Arc::new(Self {
            parent,
            path: root.join(WORK_DIR).join(&name),
            name,
            _lock: lock,
        });
        Ok(workspace)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) async fn extract(
        self: &Arc<Self>,
        package: &Path,
        limits: &RecoveryConfig,
    ) -> Result<(), AppError> {
        let workspace = Arc::clone(self);
        let package = package.to_owned();
        let limits = limits.clone();
        // A cancelled HTTP future must not remove the workspace underneath
        // spawn_blocking: its last owner cleans up when extraction finishes.
        tokio::task::spawn_blocking(move || {
            crate::services::recovery_extract::extract(&package, workspace.path(), &limits)
        })
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?
        .map_err(crate::services::backups::classify_recovery_error)
    }
}

impl Drop for RecoveryWorkspace {
    fn drop(&mut self) {
        // Remove the directory, then the lock file; the lock itself is
        // released afterwards when `_lock` is dropped.
        let _ = self.parent.remove_dir_all(&self.name);
        let _ = self.parent.remove_file(lock_name(&self.name));
        active_workspaces().remove(&self.name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_backup_volume_preserves_reserve_and_removes_only_its_workspace() {
        let root = tempfile::tempdir().unwrap();
        let mut limits = RecoveryConfig {
            // A reserve no disk can satisfy, so the refusal does not race
            // other writers freeing space between measurement and check.
            min_free_bytes: u64::MAX,
            ..RecoveryConfig::default()
        };
        assert!(matches!(
            RecoveryWorkspace::new(root.path(), &limits),
            Err(AppError::RecoveryInsufficientStorage(_))
        ));
        limits.min_free_bytes = 0;
        let first = RecoveryWorkspace::new(root.path(), &limits).unwrap();
        let second = RecoveryWorkspace::new(root.path(), &limits).unwrap();
        let first_path = first.path().to_owned();
        assert!(first_path.starts_with(root.path().join(".recovery-work")));
        std::fs::write(first_path.join("database.dump"), b"private fixture").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&first_path).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        drop(first);
        assert!(!first_path.exists());
        assert!(!first_path.with_extension("lock").exists());
        assert!(second.path().is_dir());
        drop(second);
        assert_eq!(
            std::fs::read_dir(root.path().join(WORK_DIR))
                .unwrap()
                .count(),
            0
        );
    }

    #[test]
    fn reclaims_abandoned_workspaces_but_never_one_in_use() {
        let root = tempfile::tempdir().unwrap();
        let work = root.path().join(WORK_DIR);
        std::fs::create_dir_all(&work).unwrap();
        let limits = RecoveryConfig {
            min_free_bytes: 0,
            ..Default::default()
        };

        // Left by a crash: directory only, directory plus unlocked lock file,
        // and a lone lock file from a crash before the directory was made.
        let dir_only = uuid::Uuid::new_v4().to_string();
        let with_lock = uuid::Uuid::new_v4().to_string();
        let lone_lock = uuid::Uuid::new_v4().to_string();
        for id in [&dir_only, &with_lock] {
            std::fs::create_dir_all(work.join(id).join("nested")).unwrap();
            std::fs::write(work.join(id).join("nested/database.dump"), b"fixture").unwrap();
        }
        std::fs::write(work.join(lock_name(&with_lock)), b"").unwrap();
        std::fs::write(work.join(lock_name(&lone_lock)), b"").unwrap();
        // Crash leftovers are old; age them past both grace periods.
        backdate(&work.join(&dir_only), UNLOCKED_DIR_GRACE);
        backdate(&work.join(lock_name(&with_lock)), LOCK_FILE_GRACE);
        backdate(&work.join(lock_name(&lone_lock)), LOCK_FILE_GRACE);

        // Held by another live owner: its lock is taken on a separate handle,
        // as another process would hold it.
        let held = uuid::Uuid::new_v4().to_string();
        std::fs::create_dir_all(work.join(&held)).unwrap();
        let held_lock = File::create(work.join(lock_name(&held))).unwrap();
        held_lock.try_lock().unwrap();
        backdate(&work.join(lock_name(&held)), LOCK_FILE_GRACE);

        // Entries that are not workspaces are never touched.
        std::fs::create_dir_all(work.join("operator-notes")).unwrap();
        std::fs::write(work.join("not-a-uuid.lock"), b"").unwrap();

        let live = RecoveryWorkspace::new(root.path(), &limits).unwrap();
        let fresh = RecoveryWorkspace::new(root.path(), &limits).unwrap();

        for id in [&dir_only, &with_lock, &lone_lock] {
            assert!(!work.join(id).exists(), "{id} directory reclaimed");
            assert!(!work.join(lock_name(id)).exists(), "{id} lock reclaimed");
        }
        assert!(work.join(&held).is_dir());
        assert!(work.join(lock_name(&held)).exists());
        // Creating `fresh` swept again without touching `live`.
        assert!(live.path().is_dir());
        assert!(fresh.path().is_dir());
        assert!(work.join("operator-notes").is_dir());
        assert!(work.join("not-a-uuid.lock").exists());

        // Once its owner exits, the held workspace is reclaimed too.
        drop(held_lock);
        drop(fresh);
        let _next = RecoveryWorkspace::new(root.path(), &limits).unwrap();
        assert!(!work.join(&held).exists());
        assert!(live.path().is_dir());
    }

    /// Sets `path`'s modification time to `age` plus a minute in the past.
    fn backdate(path: &Path, age: std::time::Duration) {
        let when = std::time::SystemTime::now() - age - std::time::Duration::from_secs(60);
        File::open(path).unwrap().set_modified(when).unwrap();
    }

    #[test]
    fn leaves_fresh_unlocked_entries_for_their_owners() {
        let root = tempfile::tempdir().unwrap();
        let work = root.path().join(WORK_DIR);
        std::fs::create_dir_all(&work).unwrap();
        let limits = RecoveryConfig {
            min_free_bytes: 0,
            ..Default::default()
        };
        // An owner that has created its lock file but not locked it yet, and
        // an in-use workspace from an older build that writes no lock file.
        let unlocked_lock = uuid::Uuid::new_v4().to_string();
        let legacy_dir = uuid::Uuid::new_v4().to_string();
        std::fs::write(work.join(lock_name(&unlocked_lock)), b"").unwrap();
        std::fs::create_dir_all(work.join(&legacy_dir)).unwrap();
        std::fs::write(work.join(&legacy_dir).join("database.dump"), b"fixture").unwrap();

        let _workspace = RecoveryWorkspace::new(root.path(), &limits).unwrap();

        assert!(work.join(lock_name(&unlocked_lock)).exists());
        assert!(work.join(&legacy_dir).join("database.dump").exists());
        assert!(!work.join(lock_name(&legacy_dir)).exists());
    }

    #[cfg(unix)]
    #[test]
    fn detects_a_lock_file_unlinked_before_it_was_locked() {
        let root = tempfile::tempdir().unwrap();
        let parent = Dir::open_ambient_dir(root.path(), ambient_authority()).unwrap();
        let name = lock_name(&uuid::Uuid::new_v4().to_string());
        let lock = parent
            .open_with(
                &name,
                cap_std::fs::OpenOptions::new().write(true).create_new(true),
            )
            .unwrap()
            .into_std();
        assert!(lock_still_linked(&parent, &name, &lock).unwrap());
        // Another sweep unlinks it, then a new file takes the same name.
        parent.remove_file(&name).unwrap();
        assert!(!lock_still_linked(&parent, &name, &lock).unwrap());
        parent.write(&name, b"").unwrap();
        assert!(!lock_still_linked(&parent, &name, &lock).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlinked_workspace_parent() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join(".recovery-work")).unwrap();
        let limits = RecoveryConfig {
            min_free_bytes: 0,
            ..Default::default()
        };
        assert!(RecoveryWorkspace::new(root.path(), &limits).is_err());
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
    }
}
