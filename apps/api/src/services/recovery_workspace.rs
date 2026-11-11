//! Ephemeral recovery work belongs on the configured backup volume, not /tmp.
use crate::{config::RecoveryConfig, errors::AppError};
use cap_fs_ext::DirExt;
use cap_std::{ambient_authority, fs::Dir};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

pub(crate) struct RecoveryWorkspace {
    parent: Dir,
    name: String,
    path: PathBuf,
}

impl RecoveryWorkspace {
    pub(crate) fn new(root: &Path, limits: &RecoveryConfig) -> Result<Arc<Self>, AppError> {
        std::fs::create_dir_all(root)?;
        if fs2::available_space(root)? < limits.min_free_bytes {
            return Err(AppError::RecoveryInsufficientStorage(
                "Recovery workspace would consume reserved free space.".into(),
            ));
        }
        let root_dir = Dir::open_ambient_dir(root, ambient_authority())?;
        match root_dir.create_dir(".recovery-work") {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
        let parent = root_dir.open_dir_nofollow(".recovery-work")?;
        let name = uuid::Uuid::new_v4().to_string();
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
        parent.create_dir_with(&name, &builder)?;
        let workspace = Arc::new(Self {
            parent,
            path: root.join(".recovery-work").join(&name),
            name,
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
        let _ = self.parent.remove_dir_all(&self.name);
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
        assert!(second.path().is_dir());
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
