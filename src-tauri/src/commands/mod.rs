//! Comandos Tauri expuestos al frontend.
//!
//! Cada comando es una fachada muy delgada sobre `crate::persistence`: solo
//! convierte `String` -> `&Path` y propaga `Result`. Ninguno usa
//! `unwrap()`/`panic!` — cualquier fallo se propaga como `PersistenceError`
//! (serializable) para que el frontend pueda distinguir el tipo de error.

use std::path::Path;

use crate::persistence::{self, AssetDataDto, AssetMetaDto, PersistenceError};

/// Crea un `.brunch` nuevo en `path`: inicializa el esquema SQLite y guarda
/// `document_json` (el `ProjectDocument` inicial, ya construido en TS con
/// `createProject()` y serializado a JSON) como su contenido.
///
/// Falla con `PersistenceError::AlreadyExists` si `path` ya existe.
#[tauri::command]
pub fn create_branch_project(path: String, document_json: String) -> Result<(), PersistenceError> {
    persistence::create_project_file(Path::new(&path), &document_json)
}

/// Abre un `.brunch` existente en `path` y devuelve el JSON del
/// `ProjectDocument` guardado, tal cual (el frontend lo valida con
/// `ProjectDocumentSchema.parse` antes de confiar en él).
#[tauri::command]
pub fn open_branch_project(path: String) -> Result<String, PersistenceError> {
    persistence::open_project_file(Path::new(&path))
}

/// Sobrescribe, dentro de una transacción, el `ProjectDocument` de un
/// `.brunch` ya existente en `path`.
#[tauri::command]
pub fn save_branch_project(path: String, document_json: String) -> Result<(), PersistenceError> {
    persistence::save_project_file(Path::new(&path), &document_json)
}

/// Importa el archivo en `source_path` (una ruta absoluta del disco del
/// usuario, obtenida en TS con el diálogo nativo `open()` — este comando no
/// abre ningún diálogo) como asset del `.brunch` en `project_path`. Lee los
/// bytes en Rust; el lado JS/webview nunca los toca directamente.
///
/// Deduplica por `sha256` del contenido: importar el mismo contenido dos
/// veces devuelve el mismo `id` sin insertar una fila nueva.
#[tauri::command]
pub fn import_asset(
    project_path: String,
    source_path: String,
) -> Result<AssetMetaDto, PersistenceError> {
    persistence::import_asset(Path::new(&project_path), Path::new(&source_path))
}

/// Devuelve los bytes (en base64) y metadatos de un asset ya importado en
/// el `.brunch` en `project_path`.
#[tauri::command]
pub fn get_asset(project_path: String, asset_id: String) -> Result<AssetDataDto, PersistenceError> {
    persistence::get_asset(Path::new(&project_path), &asset_id)
}

/// Escribe en `path` el `index.html` autónomo generado en TypeScript
/// (`src/export/htmlBundle.ts`): un único archivo con el documento, el
/// runtime del Player y todos los assets embebidos como `data:` URI.
///
/// `html` es texto opaco para Rust: este comando no lo interpreta ni lo
/// valida, solo lo escribe tal cual. La ruta la elige el usuario con el
/// diálogo nativo de guardar (`pickExportHtmlPath` en `AppServices`).
#[tauri::command]
pub fn export_html_bundle(path: String, html: String) -> Result<(), PersistenceError> {
    persistence::write_html_bundle(Path::new(&path), &html)
}

/// Escribe en `path` el paquete SCORM 1.2 (`.zip`) generado a partir de los
/// dos textos ya construidos en TypeScript: el mismo `index.html` autónomo
/// de `export_html_bundle` (`src/export/htmlBundle.ts`) y el
/// `imsmanifest.xml` (`src/export/scormManifest.ts`).
///
/// `html` y `manifest` son texto opaco para Rust: este comando no los
/// interpreta ni los valida, solo los mete en el `.zip`. La ruta la elige el
/// usuario con el diálogo nativo de guardar (`pickExportScormPath` en
/// `AppServices`).
#[tauri::command]
pub fn export_scorm_package(
    path: String,
    html: String,
    manifest: String,
) -> Result<(), PersistenceError> {
    persistence::write_scorm_package(Path::new(&path), &html, &manifest)
}
