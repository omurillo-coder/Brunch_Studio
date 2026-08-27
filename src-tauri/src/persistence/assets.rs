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

/// Límite de tamaño de un archivo importable como asset de imagen/audio: 15 MiB.
///
/// Por qué 15 MB: de sobra para una imagen o un clip de audio corto de buena
/// calidad, pero lo bastante bajo para no permitir que un archivo enorme
/// hinche sin control el `.brunch` (SQLite, que guarda los bytes tal cual en
/// la columna `data`) ni las exportaciones (`export_html_bundle`/
/// `export_scorm_package` embeben cada asset como `data:` URI en base64
/// dentro de un único HTML — la codificación base64 ya de por sí añade ~33%
/// de tamaño).
pub const MAX_ASSET_BYTES: u64 = 15 * 1024 * 1024;

/// Límite de tamaño de un archivo importable como asset de VÍDEO: 100 MiB.
///
/// Por qué un límite propio, más alto que `MAX_ASSET_BYTES`: un vídeo real
/// (aunque sea breve y de calidad moderada) pesa muy por encima de los 15 MB
/// pensados para imagen/audio — aplicarle el mismo límite lo haría
/// prácticamente inutilizable. Por qué 100 MB y no más: el export HTML/SCORM
/// sigue embebiendo TODO como `data:` URI en base64 (~33% más pesado) dentro
/// de un único archivo, y muchas plataformas LMS imponen su propio límite de
/// tamaño de paquete SCORM (típicamente entre 50 y 250 MB) — 100 MB de vídeo
/// origen ya produce un paquete considerablemente más pesado en base64, así
/// que subir el límite sin más criterio arriesgaría paquetes que ni el LMS
/// destino acepta. 100 MB es un punto intermedio razonable: cubre un vídeo
/// corto/de apoyo de buena calidad sin disparar el tamaño del paquete
/// exportado.
pub const MAX_VIDEO_ASSET_BYTES: u64 = 100 * 1024 * 1024;

/// Límite de tamaño aplicable a un asset ya clasificado por `detect_mime_type`
/// (`"image"`/`"audio"`/`"video"`, ver esa función): `MAX_VIDEO_ASSET_BYTES`
/// para vídeo, `MAX_ASSET_BYTES` para cualquier otro tipo reconocido.
fn max_bytes_for(asset_type: &str) -> u64 {
    if asset_type == "video" {
        MAX_VIDEO_ASSET_BYTES
    } else {
        MAX_ASSET_BYTES
    }
}

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
/// `assets.type` (`"image"`/`"audio"`/`"video"` — la columna es `TEXT` sin
/// restricción `CHECK`, así que un tercer valor no rompe nada que ya
/// asumiera solo dos posibles). Devuelve `UnsupportedAssetType` si la
/// extensión no está en la lista reconocida — ni falta ni panic.
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
        "mp4" => Ok(("video", "video/mp4")),
        "webm" => Ok(("video", "video/webm")),
        "mov" => Ok(("video", "video/quicktime")),
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
    let max_bytes = max_bytes_for(asset_type);

    // Comprueba el tamaño con `std::fs::metadata` (no carga nada en memoria)
    // ANTES de `std::fs::read`: un archivo que supere el límite se rechaza
    // sin llegar a leerse por completo. El límite depende del tipo ya
    // detectado (`max_bytes_for`): 100 MB para vídeo, 15 MB para el resto.
    let actual_bytes = std::fs::metadata(source_path)?.len();
    if actual_bytes > max_bytes {
        return Err(PersistenceError::AssetTooLarge {
            max_bytes,
            actual_bytes,
        });
    }

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

/// Elimina, dentro de una única transacción, las filas de `assets` cuyo `id`
/// NO esté en `keep_asset_ids` — assets que ningún nodo/respuesta del
/// documento referencia ya (nodo borrado, imagen/audio quitado o
/// reemplazado). Devuelve cuántas filas se eliminaron.
///
/// Mismo principio ya establecido en este módulo: Rust trata el
/// `ProjectDocument` como opaco, así que no recorre su JSON para decidir qué
/// asset sigue en uso. Es TypeScript quien ya sabe recorrerlo
/// (`collectReferencedAssetIds` en `src/export/exportAssets.ts`) y pasa aquí
/// la lista de ids "a conservar" ya calculada.
pub fn gc_orphan_assets(
    project_path: &Path,
    keep_asset_ids: &[String],
) -> Result<u32, PersistenceError> {
    let conn = open_existing_project(project_path)?;
    let tx = conn.unchecked_transaction()?;

    let deleted = if keep_asset_ids.is_empty() {
        // Sin ningún id a conservar: cualquier asset presente es huérfano.
        tx.execute("DELETE FROM assets", [])?
    } else {
        let placeholders = keep_asset_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!("DELETE FROM assets WHERE id NOT IN ({placeholders})");
        tx.execute(&sql, rusqlite::params_from_iter(keep_asset_ids.iter()))?
    };

    tx.commit()?;
    Ok(deleted as u32)
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
    fn mime_detection_covers_video_extensions() {
        let dir = TempDir::new().unwrap();
        let project_path = setup_project(&dir, "mime-detection-video");

        let mp4_path = dir.path().join("clip.mp4");
        std::fs::write(&mp4_path, b"bytes de video mp4").unwrap();
        let mp4_meta = import_asset(&project_path, &mp4_path).unwrap();
        assert_eq!(mp4_meta.mime_type, "video/mp4");

        let webm_path = dir.path().join("clip.webm");
        std::fs::write(&webm_path, b"bytes de video webm").unwrap();
        let webm_meta = import_asset(&project_path, &webm_path).unwrap();
        assert_eq!(webm_meta.mime_type, "video/webm");

        let mov_path = dir.path().join("clip.mov");
        std::fs::write(&mov_path, b"bytes de video mov").unwrap();
        let mov_meta = import_asset(&project_path, &mov_path).unwrap();
        assert_eq!(mov_meta.mime_type, "video/quicktime");
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

    #[test]
    fn import_asset_at_or_under_size_limit_succeeds() {
        let dir = TempDir::new().unwrap();
        let project_path = setup_project(&dir, "under-limit");

        let source_path = dir.path().join("pequena.png");
        std::fs::write(&source_path, vec![0u8; 1024]).unwrap();

        let result = import_asset(&project_path, &source_path);
        assert!(result.is_ok(), "un archivo bajo el límite debe importarse");
        assert_eq!(count_assets(&project_path), 1);
    }

    #[test]
    fn import_asset_over_size_limit_returns_controlled_error_without_reading_it_fully() {
        let dir = TempDir::new().unwrap();
        let project_path = setup_project(&dir, "too-large");

        // `set_len` crea un archivo "sparse" del tamaño exacto que hace
        // falta para el test sin escribir contenido real de 15 MB: rápido y
        // suficiente para probar la comprobación de tamaño.
        let source_path = dir.path().join("enorme.png");
        let file = std::fs::File::create(&source_path).unwrap();
        file.set_len(MAX_ASSET_BYTES + 1).unwrap();

        let result = import_asset(&project_path, &source_path);
        match result {
            Err(PersistenceError::AssetTooLarge { max_bytes, actual_bytes }) => {
                assert_eq!(max_bytes, MAX_ASSET_BYTES);
                assert_eq!(actual_bytes, MAX_ASSET_BYTES + 1);
            }
            other => panic!("se esperaba AssetTooLarge, se obtuvo: {other:?}"),
        }
        // No debe haberse insertado ninguna fila: se rechazó antes de leer.
        assert_eq!(count_assets(&project_path), 0);
    }

    #[test]
    fn import_video_asset_over_image_limit_but_under_video_limit_succeeds() {
        let dir = TempDir::new().unwrap();
        let project_path = setup_project(&dir, "video-between-limits");

        // 20 MB: por encima de MAX_ASSET_BYTES (15 MB, límite de
        // imagen/audio) pero por debajo de MAX_VIDEO_ASSET_BYTES (100 MB) —
        // debe aceptarse porque el tipo detectado es "video".
        let source_path = dir.path().join("clip.mp4");
        let file = std::fs::File::create(&source_path).unwrap();
        file.set_len(20 * 1024 * 1024).unwrap();
        assert!(20 * 1024 * 1024 > MAX_ASSET_BYTES);
        assert!(20 * 1024 * 1024 < MAX_VIDEO_ASSET_BYTES);

        let result = import_asset(&project_path, &source_path);
        assert!(result.is_ok(), "un vídeo de 20 MB debe importarse: {result:?}");
        assert_eq!(count_assets(&project_path), 1);
    }

    #[test]
    fn import_video_asset_over_video_limit_returns_controlled_error() {
        let dir = TempDir::new().unwrap();
        let project_path = setup_project(&dir, "video-over-limit");

        let source_path = dir.path().join("clip.mp4");
        let file = std::fs::File::create(&source_path).unwrap();
        file.set_len(MAX_VIDEO_ASSET_BYTES + 1).unwrap();

        let result = import_asset(&project_path, &source_path);
        match result {
            Err(PersistenceError::AssetTooLarge { max_bytes, actual_bytes }) => {
                assert_eq!(max_bytes, MAX_VIDEO_ASSET_BYTES);
                assert_eq!(actual_bytes, MAX_VIDEO_ASSET_BYTES + 1);
            }
            other => panic!("se esperaba AssetTooLarge, se obtuvo: {other:?}"),
        }
        assert_eq!(count_assets(&project_path), 0);
    }

    fn insert_raw_asset(project_path: &Path, id: &str) {
        let conn = Connection::open(project_path).unwrap();
        conn.execute(
            "INSERT INTO assets (id, type, filename, mime_type, sha256, data) \
             VALUES (?1, 'image', 'x.png', 'image/png', ?1, X'00')",
            [id],
        )
        .unwrap();
    }

    #[test]
    fn gc_orphan_assets_deletes_rows_not_in_keep_list() {
        let dir = TempDir::new().unwrap();
        let project_path = setup_project(&dir, "gc-orphans");
        insert_raw_asset(&project_path, "keep-1");
        insert_raw_asset(&project_path, "orphan-1");
        insert_raw_asset(&project_path, "orphan-2");

        let deleted = gc_orphan_assets(&project_path, &["keep-1".to_string()]).unwrap();

        assert_eq!(deleted, 2);
        assert_eq!(count_assets(&project_path), 1);
        let conn = Connection::open(&project_path).unwrap();
        let remaining: String = conn
            .query_row("SELECT id FROM assets", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining, "keep-1");
    }

    #[test]
    fn gc_orphan_assets_with_empty_keep_list_deletes_everything() {
        let dir = TempDir::new().unwrap();
        let project_path = setup_project(&dir, "gc-empty-keep-list");
        insert_raw_asset(&project_path, "orphan-1");
        insert_raw_asset(&project_path, "orphan-2");

        let deleted = gc_orphan_assets(&project_path, &[]).unwrap();

        assert_eq!(deleted, 2);
        assert_eq!(count_assets(&project_path), 0);
    }

    #[test]
    fn gc_orphan_assets_when_all_survive_deletes_nothing() {
        let dir = TempDir::new().unwrap();
        let project_path = setup_project(&dir, "gc-all-survive");
        insert_raw_asset(&project_path, "keep-1");
        insert_raw_asset(&project_path, "keep-2");

        let deleted = gc_orphan_assets(
            &project_path,
            &["keep-1".to_string(), "keep-2".to_string()],
        )
        .unwrap();

        assert_eq!(deleted, 0);
        assert_eq!(count_assets(&project_path), 2);
    }

    #[test]
    fn gc_orphan_assets_on_project_with_no_assets_does_not_fail() {
        let dir = TempDir::new().unwrap();
        let project_path = setup_project(&dir, "gc-no-assets");

        let deleted = gc_orphan_assets(&project_path, &[]).unwrap();
        assert_eq!(deleted, 0);

        let deleted_with_keep =
            gc_orphan_assets(&project_path, &["nonexistent".to_string()]).unwrap();
        assert_eq!(deleted_with_keep, 0);
    }
}
