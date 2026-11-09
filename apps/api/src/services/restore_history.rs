//! Bounded JSON parsing with one catalog record in flight. Historical JSON
//! shape is retained; fields are processed in dependency order on three passes.
use super::restore_jobs::{
    self, BackupArtifactSnapshot, BackupCatalogSnapshot, BackupRestoreRequestSnapshot,
    BackupRunSnapshot,
};
use serde::de::{DeserializeSeed, Error, IgnoredAny, MapAccess, SeqAccess, Visitor};
use std::{
    fmt,
    fs::File,
    io::{BufReader, Read},
    path::Path,
};

struct BoundedRead {
    file: File,
    remaining: u64,
}
impl Read for BoundedRead {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let length = buffer.len().min(self.remaining.saturating_add(1) as usize);
        let read = self.file.read(&mut buffer[..length])?;
        if read as u64 > self.remaining {
            return Err(std::io::Error::other(
                "recovery metadata exceeds its byte limit",
            ));
        }
        self.remaining -= read as u64;
        Ok(read)
    }
}
pub fn read_bounded_json<T: serde::de::DeserializeOwned>(
    path: &Path,
    maximum: u64,
) -> anyhow::Result<T> {
    let file = File::open(path)?;
    anyhow::ensure!(
        file.metadata()?.len() <= maximum,
        "recovery metadata exceeds its byte limit"
    );
    Ok(serde_json::from_reader(BufReader::new(BoundedRead {
        file,
        remaining: maximum,
    }))?)
}

#[derive(Clone, Copy)]
struct CatalogSeed<'a> {
    field: &'a str,
    sender: &'a tokio::sync::mpsc::Sender<BackupCatalogSnapshot>,
}
impl<'de> DeserializeSeed<'de> for CatalogSeed<'_> {
    type Value = ();
    fn deserialize<D: serde::Deserializer<'de>>(self, de: D) -> Result<(), D::Error> {
        de.deserialize_map(self)
    }
}
impl<'de> Visitor<'de> for CatalogSeed<'_> {
    type Value = ();
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a recovery catalog object")
    }
    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<(), M::Error> {
        let mut found = false;
        while let Some(key) = map.next_key::<String>()? {
            if key == self.field {
                if found {
                    return Err(M::Error::custom("duplicate catalog field"));
                }
                found = true;
                map.next_value_seed(ArraySeed(self))?;
            } else {
                map.next_value::<IgnoredAny>()?;
            }
        }
        Ok(())
    }
    fn visit_seq<S: SeqAccess<'de>>(self, mut seq: S) -> Result<(), S::Error> {
        loop {
            let mut record = BackupCatalogSnapshot::default();
            match self.field {
                "runs" => match seq.next_element::<BackupRunSnapshot>()? {
                    Some(row) => record.runs.push(row),
                    None => break,
                },
                "artifacts" => match seq.next_element::<BackupArtifactSnapshot>()? {
                    Some(row) => record.artifacts.push(row),
                    None => break,
                },
                "restore_requests" => match seq.next_element::<BackupRestoreRequestSnapshot>()? {
                    Some(row) => record.restore_requests.push(row),
                    None => break,
                },
                _ => unreachable!(),
            }
            // An archive's availability claim is inert. The target catalog is
            // merged last and access independently verifies the actual object.
            restore_jobs::mark_source_artifact_availability(&mut record, None);
            self.sender
                .blocking_send(record)
                .map_err(|_| S::Error::custom("catalog import cancelled"))?;
        }
        Ok(())
    }
}

struct ArraySeed<'a>(CatalogSeed<'a>);
impl<'de> DeserializeSeed<'de> for ArraySeed<'_> {
    type Value = ();
    fn deserialize<D: serde::Deserializer<'de>>(self, de: D) -> Result<(), D::Error> {
        de.deserialize_seq(self.0)
    }
}

pub async fn merge(pool: &sqlx::PgPool, path: &Path, maximum: u64) -> anyhow::Result<()> {
    for field in ["runs", "artifacts", "restore_requests"] {
        let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
        let path = path.to_owned();
        let task = tokio::task::spawn_blocking(move || {
            let file = File::open(path)?;
            anyhow::ensure!(
                file.metadata()?.len() <= maximum,
                "operational history exceeds its byte limit"
            );
            let mut de = serde_json::Deserializer::from_reader(BufReader::new(BoundedRead {
                file,
                remaining: maximum,
            }));
            CatalogSeed {
                field,
                sender: &sender,
            }
            .deserialize(&mut de)?;
            de.end()?;
            Ok::<_, anyhow::Error>(())
        });
        while let Some(record) = receiver.recv().await {
            restore_jobs::merge_catalog_snapshot(pool, &record).await?;
        }
        task.await??;
    }
    Ok(())
}
