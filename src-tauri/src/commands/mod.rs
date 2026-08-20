//! Comandos Tauri expuestos al frontend.
//!
//! Cada comando es una fachada muy delgada sobre `crate::persistence`: solo
//! convierte `String` -> `&Path` y propaga `Result`. Ninguno usa
//! `unwrap()`/`panic!` — cualquier fallo se propaga como `PersistenceError`
//! (serializable) para que el frontend pueda distinguir el tipo de error.

use std::path::Path;

use crate::persistence::{self, PersistenceError};

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
