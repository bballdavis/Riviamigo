use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use std::{collections::HashSet, path::PathBuf};
use uuid::Uuid;

#[derive(Debug, FromRow)]
struct VehicleImageRow {
    placement: String,
    design: Option<String>,
    size: Option<String>,
    resolution: Option<String>,
    url: String,
    overlays: serde_json::Value,
    metadata: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct VehicleImageOverlay {
    url: String,
    overlay: Option<String>,
    #[serde(rename = "zIndex")]
    z_index: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
struct DemoFixtureManifest {
    model: String,
    images: Vec<DemoFixtureImageEntry>,
}

#[derive(Debug, Clone, Serialize)]
struct DemoFixtureImageEntry {
    placement: String,
    design: Option<String>,
    size: Option<String>,
    resolution: Option<String>,
    url: String,
    overlays: Vec<VehicleImageOverlay>,
    metadata: serde_json::Value,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let vehicle_id = args.next().ok_or_else(|| {
        anyhow::anyhow!(
            "usage: cargo run --bin export_vehicle_image_fixture -- <vehicle_id> <model>"
        )
    })?;
    let model = args
        .next()
        .ok_or_else(|| {
            anyhow::anyhow!(
                "usage: cargo run --bin export_vehicle_image_fixture -- <vehicle_id> <model>"
            )
        })?
        .to_uppercase();
    let vehicle_id = Uuid::parse_str(&vehicle_id)?;
    let database_url = std::env::var("DATABASE_URL")?;

    let pool = riviamigo_api::db::pool::create_pool(&database_url).await?;
    let rows = sqlx::query_as::<_, VehicleImageRow>(
        "SELECT placement, design, size, resolution, url, overlays, metadata
         FROM riviamigo.vehicle_images
         WHERE vehicle_id = $1
         ORDER BY created_at, placement, design NULLS LAST",
    )
    .bind(vehicle_id)
    .fetch_all(&pool)
    .await?;

    if rows.is_empty() {
        anyhow::bail!("no cached vehicle_images rows found for {vehicle_id}");
    }

    let output_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../web/public/vehicle-images/fixtures")
        .join(model.to_lowercase());
    std::fs::create_dir_all(&output_dir)?;

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;
    let mut manifest_images = Vec::with_capacity(rows.len());
    let mut used_filenames = HashSet::new();

    for row in rows {
        let base_file =
            download_fixture_asset(&client, &output_dir, &row.url, &mut used_filenames).await?;
        let mut overlays = Vec::new();
        for overlay in serde_json::from_value::<Vec<VehicleImageOverlay>>(row.overlays.clone())
            .unwrap_or_default()
        {
            let overlay_file =
                download_fixture_asset(&client, &output_dir, &overlay.url, &mut used_filenames)
                    .await?;
            overlays.push(VehicleImageOverlay {
                url: format!(
                    "/vehicle-images/fixtures/{}/{}",
                    model.to_lowercase(),
                    overlay_file
                ),
                overlay: overlay.overlay,
                z_index: overlay.z_index,
            });
        }

        let mut metadata = row.metadata.clone();
        if let Some(obj) = metadata.as_object_mut() {
            obj.insert(
                "source_url".into(),
                serde_json::Value::String(row.url.clone()),
            );
            obj.insert("packaged".into(), serde_json::Value::Bool(true));
            obj.insert("model".into(), serde_json::Value::String(model.clone()));
        }

        manifest_images.push(DemoFixtureImageEntry {
            placement: row.placement,
            design: row.design,
            size: row.size,
            resolution: row.resolution,
            url: format!(
                "/vehicle-images/fixtures/{}/{}",
                model.to_lowercase(),
                base_file
            ),
            overlays,
            metadata,
        });
    }

    let manifest = DemoFixtureManifest {
        model: model.clone(),
        images: manifest_images,
    };

    std::fs::write(
        output_dir.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;

    println!(
        "exported {} image entries to {}",
        manifest.images.len(),
        output_dir.display()
    );
    Ok(())
}

async fn download_fixture_asset(
    client: &Client,
    output_dir: &PathBuf,
    source_url: &str,
    used_filenames: &mut HashSet<String>,
) -> anyhow::Result<String> {
    let response = client.get(source_url).send().await?.error_for_status()?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/webp")
        .to_string();
    let bytes = response.bytes().await?;

    let basename = source_url
        .split('/')
        .next_back()
        .unwrap_or("asset.webp")
        .split('?')
        .next()
        .unwrap_or("asset.webp");
    let extension = if basename.contains('.') {
        basename.rsplit('.').next().unwrap_or("webp").to_string()
    } else if content_type == "image/png" {
        "png".into()
    } else {
        "webp".into()
    };
    let prefix = &hex::encode(Sha256::digest(source_url.as_bytes()))[..12];
    let filename = format!("{prefix}_{basename}");
    let filename = if used_filenames.insert(filename.clone()) {
        filename
    } else {
        format!("{prefix}_dup.{extension}")
    };
    tokio::fs::write(output_dir.join(&filename), &bytes).await?;
    Ok(filename)
}
