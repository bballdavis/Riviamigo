//! Bounded extraction into a service-owned recovery staging directory.
use crate::{config::RecoveryConfig, errors::AppError};
use flate2::read::GzDecoder;
use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration as StdDuration,
};
use tar::Archive;

pub(crate) fn extract(
    package_path: &Path,
    destination: &Path,
    limits: &RecoveryConfig,
) -> Result<(), AppError> {
    let deadline =
        std::time::Instant::now() + StdDuration::from_secs(limits.restore_deadline_seconds);
    // Validate before extraction and then perform a second constrained stream
    // pass. Validation is not reusable state: callers may replace a path
    // between two operations, so the extractor must defend itself as well.
    crate::services::backups::validate_recovery_package_sync_with_limits(package_path, limits)?;
    std::fs::create_dir_all(destination)?;

    let compressed_bytes = std::fs::metadata(package_path)?.len();
    if compressed_bytes > limits.max_upload_bytes {
        return Err(AppError::Validation(
            "Recovery package exceeds the configured compressed byte limit.".into(),
        ));
    }
    let file = File::open(package_path)?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    let mut created = Vec::<PathBuf>::new();
    let result = (|| -> Result<(), AppError> {
        let mut members = HashSet::<String>::new();
        let mut expanded_bytes = 0_u64;
        let mut member_count = 0_usize;
        for entry in archive
            .entries()
            .map_err(|error| AppError::Validation(format!("Invalid recovery archive: {error}")))?
        {
            let mut entry = entry.map_err(|error| {
                AppError::Validation(format!("Invalid recovery archive entry: {error}"))
            })?;
            let path = entry
                .path()
                .map_err(|error| AppError::Validation(format!("Invalid archive path: {error}")))?;
            let normalized = path.to_string_lossy().replace('\\', "/");
            let entry_type = entry.header().entry_type();
            if !entry_type.is_file() && !entry_type.is_dir()
                || path.is_absolute()
                || normalized.starts_with('/')
                || normalized.trim_end_matches('/').split('/').any(|segment| {
                    segment == "."
                        || segment == ".."
                        || segment.is_empty()
                        || segment.contains(':')
                        || segment.chars().any(char::is_control)
                })
                || !members.insert(normalized.clone())
            {
                return Err(AppError::Validation(
                    "Unsafe recovery archive member.".into(),
                ));
            }
            member_count += 1;
            if member_count > limits.max_members {
                return Err(AppError::Validation(
                    "Recovery package has too many archive members.".into(),
                ));
            }
            let allowed = matches!(
                normalized.as_str(),
                "manifest.json"
                    | "database.dump"
                    | "backup-settings.json"
                    | "operational-history.json"
            ) || normalized == "vehicle-image-cache"
                || normalized.starts_with("vehicle-image-cache/");
            if !allowed {
                return Err(AppError::Validation(format!(
                    "Unexpected recovery package member: {normalized}"
                )));
            }
            if entry_type.is_dir() {
                continue;
            }
            if std::time::Instant::now() >= deadline {
                return Err(AppError::RecoveryDeadline(
                    "Recovery validation deadline exceeded.".into(),
                ));
            }
            let entry_size = entry.size();
            if entry_size > crate::services::backups::metadata_limit(&normalized, limits) {
                return Err(AppError::Validation(format!("Recovery package member {normalized} exceeds its configured metadata or member size limit.")));
            }
            expanded_bytes = expanded_bytes.checked_add(entry_size).ok_or_else(|| {
                AppError::Validation("Recovery package expanded size overflowed.".into())
            })?;
            if entry_size > limits.max_member_bytes || expanded_bytes > limits.max_expanded_bytes {
                return Err(AppError::Validation(
                    "Recovery package exceeds extraction limits.".into(),
                ));
            }
            if expanded_bytes
                > compressed_bytes
                    .max(1)
                    .saturating_mul(limits.max_compression_ratio)
            {
                return Err(AppError::Validation(
                    "Recovery package exceeds the maximum expansion ratio.".into(),
                ));
            }
            let target = destination.join(&path);
            let parent = target
                .parent()
                .ok_or_else(|| AppError::Validation("Invalid recovery archive path.".into()))?;
            std::fs::create_dir_all(parent)?;
            let mut output = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(|error| {
                    AppError::Validation(format!(
                        "Recovery package would overwrite an existing file: {error}"
                    ))
                })?;
            created.push(target);
            let mut copied = 0_u64;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                if std::time::Instant::now() >= deadline {
                    return Err(AppError::RecoveryDeadline(
                        "Recovery extraction deadline exceeded.".into(),
                    ));
                }
                let length = entry.read(&mut buffer)?;
                if length == 0 {
                    break;
                }
                if fs2::available_space(destination)?
                    < limits.min_free_bytes.saturating_add(length as u64)
                {
                    return Err(AppError::RecoveryInsufficientStorage(
                        "Recovery extraction would consume reserved free space.".into(),
                    ));
                }
                output.write_all(&buffer[..length])?;
                copied += length as u64;
            }
            if copied != entry_size {
                return Err(AppError::Validation(format!(
                    "Recovery package member {normalized} size changed during extraction."
                )));
            }
            output.flush()?;
        }
        Ok(())
    })();
    if result.is_err() {
        for path in created.into_iter().rev() {
            let _ = std::fs::remove_file(path);
        }
    }
    result
}
