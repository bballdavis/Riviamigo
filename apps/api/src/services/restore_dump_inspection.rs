use crate::{
    config::RecoveryConfig, errors::AppError, services::recovery_workspace::RecoveryWorkspace,
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DumpInspection {
    pub has_riviamigo_schema: bool,
    pub has_timeseries_schema: bool,
}

pub async fn inspect_recovery_dump(
    package: &Path,
    root: &Path,
    limits: &RecoveryConfig,
) -> Result<DumpInspection, AppError> {
    let workspace = RecoveryWorkspace::new(root, limits)?;
    workspace.extract(package, limits).await?;
    let pg_restore = resolve_pg_restore_executable().await.ok_or_else(|| {
        AppError::DependencyUnavailable("pg_restore is unavailable for restore preflight".into())
    })?;
    let inspection = async {
        let mut child = Command::new(pg_restore)
            .arg("--schema-only")
            .arg("--file=-")
            .arg(workspace.path().join("database.dump"))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| {
                AppError::DependencyUnavailable(format!(
                    "pg_restore is unavailable for restore preflight: {error}"
                ))
            })?;
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        // Consume both pipes concurrently. Neither attacker-controlled schema
        // output nor diagnostics may grow an in-memory process-output buffer.
        let (schema, diagnostics) =
            tokio::try_join!(scan_schema(stdout), read_diagnostics(stderr))?;
        let status = child.wait().await?;
        if !status.success() {
            return Err(AppError::RecoveryInvalid(format!(
                "pg_restore could not inspect the recovery dump: {}",
                String::from_utf8_lossy(&diagnostics).trim()
            )));
        }
        Ok(schema)
    };
    tokio::time::timeout(
        Duration::from_secs(limits.restore_deadline_seconds),
        inspection,
    )
    .await
    .map_err(|_| AppError::RecoveryDeadline("Recovery dump inspection deadline exceeded.".into()))?
}

async fn scan_schema(mut stdout: impl AsyncRead + Unpin) -> Result<DumpInspection, AppError> {
    let mut result = DumpInspection {
        has_riviamigo_schema: false,
        has_timeseries_schema: false,
    };
    let mut buffer = [0_u8; 64 * 1024 + 32];
    let mut retained = 0;
    loop {
        let count = stdout.read(&mut buffer[retained..]).await?;
        if count == 0 {
            return Ok(result);
        }
        let length = retained + count;
        result.has_riviamigo_schema |= buffer[..length]
            .windows(b"CREATE SCHEMA riviamigo".len())
            .any(|value| value == b"CREATE SCHEMA riviamigo");
        result.has_timeseries_schema |= buffer[..length]
            .windows(b"CREATE SCHEMA timeseries".len())
            .any(|value| value == b"CREATE SCHEMA timeseries");
        retained = length.min(32);
        buffer.copy_within(length - retained..length, 0);
    }
}

async fn read_diagnostics(mut stderr: impl AsyncRead + Unpin) -> Result<Vec<u8>, AppError> {
    let mut diagnostics = Vec::with_capacity(8 * 1024);
    let mut buffer = [0_u8; 8 * 1024];
    loop {
        let count = stderr.read(&mut buffer).await?;
        if count == 0 {
            return Ok(diagnostics);
        }
        let keep = count.min(8 * 1024 - diagnostics.len());
        diagnostics.extend_from_slice(&buffer[..keep]);
    }
}

async fn resolve_pg_restore_executable() -> Option<PathBuf> {
    if Command::new("pg_restore")
        .arg("--version")
        .kill_on_drop(true)
        .output()
        .await
        .is_ok_and(|output| output.status.success())
    {
        return Some(PathBuf::from("pg_restore"));
    }
    find_windows_pg_restore()
}

#[cfg(windows)]
fn find_windows_pg_restore() -> Option<PathBuf> {
    for root in [
        std::env::var_os("ProgramFiles"),
        std::env::var_os("ProgramFiles(x86)"),
    ]
    .into_iter()
    .flatten()
    {
        let postgres = PathBuf::from(root).join("PostgreSQL");
        let Ok(entries) = std::fs::read_dir(postgres) else {
            continue;
        };
        let mut versions = entries.filter_map(Result::ok).collect::<Vec<_>>();
        versions.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));
        for version in versions {
            let candidate = version.path().join("bin").join("pg_restore.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn find_windows_pg_restore() -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn inspection_uses_configured_metadata_limits_and_cleans_up() {
        use flate2::{write::GzEncoder, Compression};
        use tar::{Builder, Header};
        let root = tempfile::tempdir().unwrap();
        let package = root.path().join("fixture.rma.tar.gz");
        let mut archive = Builder::new(GzEncoder::new(
            std::fs::File::create(&package).unwrap(),
            Compression::default(),
        ));
        let mut header = Header::new_gnu();
        header.set_size(9);
        header.set_cksum();
        archive
            .append_data(&mut header, "manifest.json", &b"123456789"[..])
            .unwrap();
        archive.into_inner().unwrap().finish().unwrap();
        let backups = root.path().join("backups");
        let limits = RecoveryConfig {
            min_free_bytes: 0,
            max_manifest_bytes: 8,
            ..Default::default()
        };
        assert!(matches!(
            inspect_recovery_dump(&package, &backups, &limits).await,
            Err(AppError::RecoveryTooLarge(_))
        ));
        assert_eq!(
            std::fs::read_dir(backups.join(".recovery-work"))
                .unwrap()
                .count(),
            0
        );
        assert!(package.exists());
    }

    #[tokio::test]
    async fn schema_markers_cross_pipe_chunks_and_diagnostics_stay_bounded() {
        let (reader, mut writer) = tokio::io::duplex(1);
        let output = tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            writer
                .write_all(b"CREATE SCHEMA riviamigo;\nCREATE SCHEMA timeseries;\n")
                .await
                .unwrap();
        });
        let inspected = scan_schema(reader).await.unwrap();
        output.await.unwrap();
        assert!(inspected.has_riviamigo_schema && inspected.has_timeseries_schema);
        assert_eq!(
            read_diagnostics(&vec![b'x'; 1024 * 1024][..])
                .await
                .unwrap()
                .len(),
            8 * 1024
        );
    }
}
