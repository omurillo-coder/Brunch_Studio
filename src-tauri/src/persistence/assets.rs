//! Importación y lectura de assets binarios (imagen/audio) dentro de la
//! tabla `assets` de un `.brunch` ya existente.
//!
//! El frontend nunca lee bytes de disco directamente: usa el diálogo nativo
//! solo para obtener una ruta (`pickImportAssetPath` en `AppServices`), y es
//! este módulo el que hace `std::fs::read` en el proceso Rust. Los assets se
//! deduplican por `sha256` del contenido: importar dos veces el mismo
//! contenido (aunque venga de rutas/nombres de archivo distintos) devuelve
//! siempre el mismo `id` sin insertar una fila nueva.

use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::error::PersistenceError;
use super::schema::verify_container_tables;

/// Metadatos de un asset recién importado (o ya existente, en el caso de
/// deduplicación), devueltos al frontend.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetMetaDto {
    pub id: String,
    pub mime_type: String,
    pub filename: String,
    pub sha256: String,
}

/// Bytes de un asset ya importado, codificados en base64 para viajar por el
/// mismo canal JSON que el resto de comandos (sin transporte binario
/// especial).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDataDto {
    pub mime_type: String,
    pub filename: String,
    pub data_base64: String,
}

/// Deriva `(tipo, mime_type)` a partir de la extensión de `path` (sin
/// distinguir mayúsculas/minúsculas). `tipo` es el valor que se guarda en
/// `assets.type` (`"image"`/`"audio"`). Devuelve `UnsupportedAssetType` si
/// la extensión no está en la lista reconocida — ni falta ni panic.
fn detect_mime_type(path: &Path) -> Result<(&'static str, &'static str), PersistenceError> {
    let unsupported = || PersistenceError::UnsupportedAssetType(path.display().to_string());

    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .ok_or_else(unsupported)?;

    match extension.as_str() {
        "png" => Ok(("image", "image/png")),
        "jpg" | "jpeg" => Ok(("image", "image/jpeg")),
        "gif" => Ok(("image", "image/gif")),
        "webp" => Ok(("image", "image/webp")),
        "mp3" => Ok(("audio", "audio/mpeg")),
        "wav" => Ok(("audio", "audio/wav")),
        "ogg" => Ok(("audio", "audio/ogg")),
        "m4a" => Ok(("audio", "audio/mp4")),
        _ => Err(unsupported()),
    }
}

/// `sha256` en hexadecimal minúsculas de `bytes`.
fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Abre la conexión al `.brunch` en `project_path`, comprobando primero que
/// existe (igual que `repository.rs`: abrir con `rusqlite::Connection::open`
/// una ruta inexistente la crearía vacía en vez de fallar) y que tiene las
/// tablas mínimas del contenedor.
fn open_existing_project(project_path: &Path) -> Result<Connection, PersistenceError> {
    if !project_path.exists() {
        return Err(PersistenceError::NotFound(
            project_path.display().to_string(),
        ));
    }
    let conn = Connection::open(project_path)?;
    verify_container_tables(&conn)?;
    Ok(conn)
}

/// Importa el archivo en `source_path` como asset del `.brunch` en
/// `project_path`: lee sus bytes, detecta su MIME por extensión, calcula su
/// `sha256` y lo inserta en `assets` — o, si ya existe una fila con ese
/// mismo `sha256`, devuelve el `id` existente sin duplicar nada.
pub fn import_asset(
    project_path: &Path,
    source_path: &Path,
) -> Result<AssetMetaDto, PersistenceError> {
    let (asset_type, mime_type) = detect_mime_type(source_path)?;
    let bytes = std::fs::read(source_path)?;
    let sha256 = sha256_hex(&bytes);
    let filename = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("archivo")
        .to_string();

    let conn = open_existing_project(project_path)?;
    let tx = conn.unchecked_transaction()?;

    let existing_id: Option<String> = tx
        .query_row(
            "SELECT id FROM assets WHERE sha256 = ?1",
            [&sha256],
            |row| row.get(0),
        )
        .optional()?;

    let id = match existing_id {
        Some(id) => id,
        None => {
            let id = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO assets (id, type, filename, mime_type, sha256, data) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                (&id, asset_type, &filename, mime_type, &sha256, &bytes),
            )?;
            id
        }
    };
    tx.commit()?;

    Ok(AssetMetaDto {
        id,
        mime_type: mime_type.to_string(),
        filename,
        sha256,
    })
}

/// Lee de vuelta un asset ya importado por su `id`. `NotFound` si no existe
/// ni el proyecto ni la fila.
pub fn get_asset(project_path: &Path, asset_id: &str) -> Result<AssetDataDto, PersistenceError> {
    let conn = open_existing_project(project_path)?;

    let row: Option<(String, String, Vec<u8>)> = conn
        .query_row(
            "SELECT mime_type, filename, data FROM assets WHERE id = ?1",
            [asset_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;

    let (mime_type, filename, data) =
        row.ok_or_else(|| PersistenceError::NotFound(asset_id.to_string()))?;

    Ok(AssetDataDto {
        mime_type,
        filename,
        data_base64: STANDARD.encode(data),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sample_document_json() -> String {
        serde_json::json!({
            "schemaVersion": 1,
            "metadata": {
                "id": "11111111-1111-1111-1111-111111111111",
                "name": "Proyecto de prueba",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-01T00:00:00.000Z"
            },
            "settings": {},
            "graph": {
                "nodes": [
                    {
                        "id": "22222222-2222-2222-2222-222222222222",
                        "number": 1,
                        "type": "start",
                        "position": { "x": 0.0, "y": 0.0 },
                        "title": "",
                        "body": ""
                    }
                ]
            },
            "editor": {
                "viewport": { "x": 0.0, "y": 0.0, "zoom": 1.0 }
            }
        })
        .to_string()
    }

    fn setup_project(dir: &TempDir, name: &str) -> std::path::PathBuf {
        let path = dir.path().join(format!("{name}.brunch"));
        super::super::repository::create_project_file(&path, &sample_document_json()).unwrap();
        path
    }

    fn count_assets(project_path: &Path) -> i64 {
        let conn = Connection::open(project_path).unwrap();
        conn.query_row("SELECT COUNT(*) FROM assets", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn import_asset_creates_row_and_roundtrips_exact_bytes() {
        let dir = TempDir::new().unwrap();
        let project_path = setup_project(&dir, "import-roundtrip");

        let source_path = dir.path().join("photo.png");
        let bytes = vec![0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5];
        std::fs::write(&source_path, &bytes).unwrap();

        let meta = import_asset(&project_path, &source_path).expect("debe importar");
        assert!(!meta.id.is_empty());
        assert_eq!(meta.mime_type, "image/png");
        assert_eq!(meta.filename, "photo.png");

        let data = get_asset(&project_path, &meta.id).expect("debe poder leerse de vuelta");
        assert_eq!(data.mime_type, "image/png");
        assert_eq!(data.filename, "photo.png");
        assert_eq!(STANDARD.decode(data.data_base64).unwrap(), bytes);
    }

    #[test]
    fn importing_same_content_twice_deduplicates_by_sha256() {
        let dir = TempDir::new().unwrap();
        let project_path = setup_project(&dir, "dedup");

        let bytes = b"contenido de audio identico".to_vec();
        let source_a = dir.path().join("cancion.mp3");
        let source_b = dir.path().join("otra-copia.mp3");
        std::fs::write(&source_a, &bytes).unwrap();
        std::fs::write(&source_b, &bytes).unwrap();

        let first = import_asset(&project_path, &source_a).unwrap();
        let second = import_asset(&project_path, &source_b).unwrap();

        assert_eq!(first.id, second.id, "mismo contenido debe dar el mismo id");
        assert_eq!(first.sha256, second.sha256);
        assert_eq!(
            count_assets(&project_path),
            1,
            "no debe duplicarse la fila en assets"
        );
    }

    #[test]
    fn import_asset_with_unrecognized_extension_returns_controlled_error() {
        let dir = TempDir::new().unwrap();
        let project_path = setup_project(&dir, "unsupported-ext");

        let source_path = dir.path().join("documento.pdf");
        std::fs::write(&source_path, b"no importa el contenido").unwrap();

        let result = import_asset(&project_path, &source_path);
        assert!(matches!(
            result,
            Err(PersistenceError::UnsupportedAssetType(_))
        ));
        assert_eq!(count_assets(&project_path), 0);
    }

    #[test]
    fn get_asset_with_unknown_id_returns_not_found_not_panic() {
        let dir = TempDir::new().unwrap();
        let project_path = setup_project(&dir, "get-missing");

        let result = get_asset(&project_path, "no-existe");
        assert!(matches!(result, Err(PersistenceError::NotFound(_))));
    }

    #[test]
    fn mime_detection_covers_image_and_audio_extensions() {
        let dir = TempDir::new().unwrap();
        let project_path = setup_project(&dir, "mime-detection");

        let image_path = dir.path().join("imagen.jpg");
        std::fs::write(&image_path, b"bytes de imagen").unwrap();
        let image_meta = import_asset(&project_path, &image_path).unwrap();
        assert_eq!(image_meta.mime_type, "image/jpeg");

        let audio_path = dir.path().join("audio.wav");
        std::fs::write(&audio_path, b"bytes de audio").unwrap();
        let audio_meta = import_asset(&project_path, &audio_path).unwrap();
        assert_eq!(audio_meta.mime_type, "audio/wav");
    }

    #[test]
    fn import_asset_into_missing_project_returns_not_found() {
        let dir = TempDir::new().unwrap();
        let project_path = dir.path().join("no-existe.brunch");
        let source_path = dir.path().join("imagen.png");
        std::fs::write(&source_path, b"bytes").unwrap();

        let result = import_asset(&project_path, &source_path);
        assert!(matches!(result, Err(PersistenceError::NotFound(_))));
    }
}
