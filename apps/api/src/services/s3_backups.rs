use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result};
use aws_sdk_s3::{
    config::{
        timeout::TimeoutConfig, Credentials, Region, RequestChecksumCalculation,
        ResponseChecksumValidation,
    },
    primitives::ByteStream,
    types::{CompletedMultipartUpload, CompletedPart},
    Client,
};
use chrono::{DateTime, Utc};
use tokio::fs::{self, File};
use tokio::io::AsyncReadExt;
use uuid::Uuid;

const MULTIPART_THRESHOLD: u64 = 64 * 1024 * 1024;
const MULTIPART_PART_SIZE: usize = 64 * 1024 * 1024;
const MAX_CATALOG_OBJECTS: usize = 100;

#[derive(Clone, Debug)]
pub struct S3Settings {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub prefix: String,
    pub access_key: String,
    pub secret_key: String,
    pub policy: crate::services::s3_transport::S3Policy,
}

#[derive(Clone, Debug)]
pub struct RemoteObject {
    pub key: String,
    pub file_name: String,
    pub size_bytes: i64,
    pub checksum_sha256: Option<String>,
    pub created_at: DateTime<Utc>,
    pub metadata: HashMap<String, String>,
}

pub fn normalize_prefix(value: &str) -> Result<String> {
    Ok(crate::services::artifact_files::validate_prefix(value)?)
}

pub fn object_key(prefix: &str, created_at: DateTime<Utc>, run_id: Uuid) -> Result<String> {
    let name = format!(
        "backup-{}-{}.rma.tar.gz",
        created_at.format("%Y%m%dT%H%M%SZ"),
        run_id.simple()
    );
    let prefix = normalize_prefix(prefix)?;
    Ok(if prefix.is_empty() {
        name
    } else {
        format!(
            "{prefix}/{}/{}/{name}",
            created_at.format("%Y"),
            created_at.format("%m")
        )
    })
}

pub fn locator(bucket: &str, key: &str) -> String {
    format!("s3://{}/{}", bucket.trim(), key.trim_start_matches('/'))
}

pub fn key_from_locator<'a>(bucket: &str, value: &'a str) -> Option<&'a str> {
    value.strip_prefix(&format!("s3://{}/", bucket.trim()))
}

pub fn key_belongs_to_prefix(prefix: &str, key: &str) -> bool {
    let Ok(prefix) = normalize_prefix(prefix) else {
        return false;
    };
    crate::services::artifact_files::validate_prefix(key).is_ok()
        && key.ends_with(".rma.tar.gz")
        && (prefix.is_empty() || key.starts_with(&format!("{prefix}/")))
}

fn client(settings: &S3Settings) -> Result<Client> {
    normalize_prefix(&settings.prefix)?;
    let credentials = Credentials::new(
        settings.access_key.clone(),
        settings.secret_key.clone(),
        None,
        None,
        "riviamigo-backups",
    );
    let mut builder = aws_sdk_s3::Config::builder()
        .behavior_version_latest()
        .region(Region::new(settings.region.clone()))
        .credentials_provider(credentials)
        .timeout_config(
            TimeoutConfig::builder()
                .connect_timeout(std::time::Duration::from_secs(5))
                .read_timeout(std::time::Duration::from_secs(30))
                .operation_timeout(std::time::Duration::from_secs(300))
                .build(),
        )
        .http_client(crate::services::s3_transport::S3HttpClient(
            settings.policy.clone(),
        ))
        // Newer AWS SDK releases default to optional checksum trailers. Some
        // S3-compatible servers (including Garage) close those aws-chunked
        // requests, so only use protocol checksums when an operation requires one.
        .request_checksum_calculation(RequestChecksumCalculation::WhenRequired)
        .response_checksum_validation(ResponseChecksumValidation::WhenRequired);
    if !settings.endpoint.trim().is_empty() {
        builder = builder
            .endpoint_url(settings.endpoint.trim())
            .force_path_style(true);
    }
    Ok(Client::from_conf(builder.build()))
}

pub async fn test_connection(settings: &S3Settings) -> Result<()> {
    let client = client(settings)?;
    let key = format!(
        "{}/.riviamigo-connection-test-{}",
        normalize_prefix(&settings.prefix)?,
        Uuid::new_v4()
    )
    .trim_start_matches('/')
    .to_string();
    let payload = format!("riviamigo-s3-test:{}", Uuid::new_v4());
    client
        .put_object()
        .bucket(&settings.bucket)
        .key(&key)
        .body(ByteStream::from(payload.clone().into_bytes()))
        .send()
        .await
        .context("S3 write probe failed")?;
    let result = async {
        let listed = client
            .list_objects_v2()
            .bucket(&settings.bucket)
            .prefix(&key)
            .send()
            .await
            .context("S3 list probe failed")?;
        anyhow::ensure!(
            listed
                .contents()
                .iter()
                .any(|object| object.key() == Some(key.as_str())),
            "S3 list probe did not return the written object"
        );
        let mut stream = client
            .get_object()
            .bucket(&settings.bucket)
            .key(&key)
            .send()
            .await
            .context("S3 read probe failed")?
            .body;
        let mut downloaded = Vec::with_capacity(payload.len());
        while let Some(bytes) = stream
            .try_next()
            .await
            .context("S3 read probe body failed")?
        {
            anyhow::ensure!(
                downloaded.len().saturating_add(bytes.len()) <= payload.len(),
                "S3 read probe returned an oversized body"
            );
            downloaded.extend_from_slice(&bytes);
        }
        anyhow::ensure!(
            downloaded == payload.as_bytes(),
            "S3 read probe returned different bytes"
        );
        Ok::<(), anyhow::Error>(())
    }
    .await;
    let delete = client
        .delete_object()
        .bucket(&settings.bucket)
        .key(&key)
        .send()
        .await
        .context("S3 delete probe failed");
    result?;
    delete?;
    Ok(())
}

pub async fn upload(
    settings: &S3Settings,
    key: &str,
    path: &Path,
    checksum_sha256: &str,
    run_id: Uuid,
    created_at: DateTime<Utc>,
) -> Result<()> {
    let size = fs::metadata(path).await?.len();
    let metadata = HashMap::from([
        (
            "riviamigo-format".to_string(),
            "riviamigo-recovery-v3".to_string(),
        ),
        ("riviamigo-sha256".to_string(), checksum_sha256.to_string()),
        ("riviamigo-run-id".to_string(), run_id.to_string()),
        ("riviamigo-created-at".to_string(), created_at.to_rfc3339()),
    ]);
    if size < MULTIPART_THRESHOLD {
        client(settings)?
            .put_object()
            .bucket(&settings.bucket)
            .key(key)
            .set_metadata(Some(metadata))
            .body(ByteStream::from_path(path).await?)
            .send()
            .await
            .context("S3 upload failed")?;
        return Ok(());
    }
    multipart_upload(settings, key, path, metadata).await
}

async fn multipart_upload(
    settings: &S3Settings,
    key: &str,
    path: &Path,
    metadata: HashMap<String, String>,
) -> Result<()> {
    let client = client(settings)?;
    let upload = client
        .create_multipart_upload()
        .bucket(&settings.bucket)
        .key(key)
        .set_metadata(Some(metadata))
        .send()
        .await
        .context("could not start S3 multipart upload")?;
    let upload_id = upload
        .upload_id()
        .context("S3 did not return a multipart upload id")?
        .to_string();
    let result = async {
        let mut file = File::open(path).await?;
        let mut completed = Vec::new();
        let mut part_number = 1;
        loop {
            let mut buffer = vec![0_u8; MULTIPART_PART_SIZE];
            let mut read = 0;
            while read < buffer.len() {
                let count = file.read(&mut buffer[read..]).await?;
                if count == 0 {
                    break;
                }
                read += count;
            }
            if read == 0 {
                break;
            }
            buffer.truncate(read);
            let output = client
                .upload_part()
                .bucket(&settings.bucket)
                .key(key)
                .upload_id(&upload_id)
                .part_number(part_number)
                .body(ByteStream::from(buffer))
                .send()
                .await
                .with_context(|| format!("S3 multipart upload failed at part {part_number}"))?;
            completed.push(
                CompletedPart::builder()
                    .part_number(part_number)
                    .set_e_tag(output.e_tag().map(str::to_string))
                    .build(),
            );
            part_number += 1;
        }
        client
            .complete_multipart_upload()
            .bucket(&settings.bucket)
            .key(key)
            .upload_id(&upload_id)
            .multipart_upload(
                CompletedMultipartUpload::builder()
                    .set_parts(Some(completed))
                    .build(),
            )
            .send()
            .await
            .context("could not complete S3 multipart upload")?;
        Ok::<(), anyhow::Error>(())
    }
    .await;
    if result.is_err() {
        let _ = client
            .abort_multipart_upload()
            .bucket(&settings.bucket)
            .key(key)
            .upload_id(&upload_id)
            .send()
            .await;
    }
    result
}

pub async fn download(
    settings: &S3Settings,
    key: &str,
    root: &Path,
    id: Uuid,
    limits: &crate::config::RecoveryConfig,
) -> Result<std::path::PathBuf> {
    anyhow::ensure!(
        key_belongs_to_prefix(&settings.prefix, key),
        "S3 object is outside the configured package prefix"
    );
    tokio::time::timeout(
        std::time::Duration::from_secs(limits.restore_deadline_seconds),
        async {
            let output = client(settings)?
                .get_object()
                .bucket(&settings.bucket)
                .key(key)
                .send()
                .await
                .context("S3 download failed")?;
            if let Some(length) = output.content_length() {
                anyhow::ensure!(
                    length >= 0 && length as u64 <= limits.max_upload_bytes,
                    "S3 package exceeds the compressed byte limit"
                );
                anyhow::ensure!(
                    fs2::available_space(root)?
                        >= limits.min_free_bytes.saturating_add(length as u64),
                    "insufficient free space for S3 package"
                );
            }
            let mut reader = output.body.into_async_read();
            Ok::<_, anyhow::Error>(
                crate::services::artifact_files::stage_reader(root, id, &mut reader, limits)
                    .await?,
            )
        },
    )
    .await
    .context("S3 download deadline exceeded")?
}

pub async fn download_stream(settings: &S3Settings, key: &str) -> Result<ByteStream> {
    Ok(client(settings)?
        .get_object()
        .bucket(&settings.bucket)
        .key(key)
        .send()
        .await
        .context("S3 download failed")?
        .body)
}

pub async fn delete(settings: &S3Settings, key: &str) -> Result<()> {
    client(settings)?
        .delete_object()
        .bucket(&settings.bucket)
        .key(key)
        .send()
        .await
        .context("S3 delete failed")?;
    Ok(())
}

pub async fn list(settings: &S3Settings) -> Result<Vec<RemoteObject>> {
    let client = client(settings)?;
    let prefix = normalize_prefix(&settings.prefix)?;
    let mut continuation = None;
    let mut rows = Vec::new();
    loop {
        let response = client
            .list_objects_v2()
            .bucket(&settings.bucket)
            .set_prefix((!prefix.is_empty()).then_some(prefix.clone()))
            .set_continuation_token(continuation)
            .send()
            .await
            .context("S3 catalog listing failed")?;
        for object in response.contents() {
            let Some(key) = object.key() else {
                continue;
            };
            if !key.ends_with(".rma.tar.gz") {
                continue;
            }
            let head = client
                .head_object()
                .bucket(&settings.bucket)
                .key(key)
                .send()
                .await
                .context("S3 catalog metadata lookup failed")?;
            let metadata = head.metadata().cloned().unwrap_or_default();
            let created_at = metadata
                .get("riviamigo-created-at")
                .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                .map(|value| value.with_timezone(&Utc))
                .or_else(|| {
                    object
                        .last_modified()
                        .and_then(|value| DateTime::parse_from_rfc3339(&value.to_string()).ok())
                        .map(|value| value.with_timezone(&Utc))
                })
                .unwrap_or_else(Utc::now);
            rows.push(RemoteObject {
                key: key.to_string(),
                file_name: key.rsplit('/').next().unwrap_or(key).to_string(),
                size_bytes: object.size().unwrap_or(0),
                checksum_sha256: metadata.get("riviamigo-sha256").cloned(),
                created_at,
                metadata,
            });
            if rows.len() >= MAX_CATALOG_OBJECTS {
                break;
            }
        }
        if rows.len() >= MAX_CATALOG_OBJECTS || response.is_truncated() != Some(true) {
            break;
        }
        continuation = response.next_continuation_token().map(str::to_string);
    }
    rows.sort_by_key(|row| std::cmp::Reverse(row.created_at));
    Ok(rows)
}

#[cfg(test)]
mod tests;
