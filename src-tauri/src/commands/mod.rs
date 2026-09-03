//! Comandos Tauri expuestos al frontend.
//!
//! Cada comando es una fachada muy delgada sobre `crate::persistence`: solo
//! convierte `String` -> `&Path` y propaga `Result`. Ninguno usa
//! `unwrap()`/`panic!` — cualquier fallo se propaga como `PersistenceError`
//! (serializable) para que el frontend pueda distinguir el tipo de error.

use std::path::Path;

use tauri::Manager;

use crate::open_registry::OpenProjectRegistry;
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
///
/// Único punto compartido por TODOS los flujos que abren un `.brunch` ya
/// existente ("Abrir proyecto" en `HomeScreen.tsx`, doble clic desde
/// Finder/Explorador vía `open_file.rs`, "Nueva ventana" con una ruta
/// concreta) — por eso es también el sitio único donde se aplica la guarda
/// contra abrir el MISMO archivo en dos ventanas a la vez (ver
/// `crate::open_registry`): antes de leer/parsear el archivo de verdad, se
/// reserva la ruta a nombre de la ventana que llama (`window`, inyectado por
/// Tauri). Si ya estaba reservada por OTRA ventana, se trae esa ventana al
/// frente (`set_focus`) y se rechaza con `AlreadyOpenElsewhere` sin tocar el
/// archivo. Si `open_project_file` falla por cualquier otro motivo (no
/// encontrado, inválido…), se deshace la reserva recién hecha: la ventana no
/// se queda "poseyendo" una ruta que en realidad no llegó a abrir.
#[tauri::command]
pub fn open_branch_project(
    path: String,
    window: tauri::WebviewWindow,
    registry: tauri::State<'_, OpenProjectRegistry>,
) -> Result<String, PersistenceError> {
    let window_label = window.label().to_string();

    if let Err(other_label) = registry.try_acquire(Path::new(&path), &window_label) {
        if let Some(other_window) = window.app_handle().get_webview_window(&other_label) {
            if let Err(error) = other_window.set_focus() {
                log::warn!("No se pudo enfocar la ventana '{other_label}' que ya tiene el proyecto abierto: {error}");
            }
        }
        return Err(PersistenceError::AlreadyOpenElsewhere(path));
    }

    persistence::open_project_file(Path::new(&path)).inspect_err(|_| {
        registry.release_path_if_owned(Path::new(&path), &window_label);
    })
}

/// Libera, si la había, la ruta `.brunch` que esta ventana tenía reservada
/// en `OpenProjectRegistry` (ver `crate::open_registry`) — invocado desde
/// `EditorScreen.handleCloseProject` (`src/editor/EditorScreen/EditorScreen.tsx`)
/// justo ANTES de volver a `HomeScreen`, para que la ventana pueda abrir
/// (u otra ventana pueda abrir) ese mismo archivo de nuevo sin que la app lo
/// considere todavía "abierto aquí". El cierre real de la ventana libera la
/// reserva por su cuenta (ver el `on_window_event` registrado en `lib.rs`),
/// así que este comando solo hace falta para el caso "misma ventana, vuelve
/// a Inicio sin cerrarse".
#[tauri::command]
pub fn release_open_project(window: tauri::WebviewWindow, registry: tauri::State<'_, OpenProjectRegistry>) {
    registry.release_window(window.label());
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

/// Elimina de la tabla `assets` del `.brunch` en `project_path` las filas
/// cuyo `id` no esté en `keep_asset_ids`, y devuelve cuántas se eliminaron.
///
/// `keep_asset_ids` ya viene calculado desde TypeScript (recorriendo el
/// documento con `collectReferencedAssetIds`, en `src/export/exportAssets.ts`):
/// este comando, como el resto de `persistence`, no interpreta la forma del
/// documento. Se llama tras cada guardado real (`useAutosave`); un fallo
/// aquí no debe impedir que el documento se haya guardado ya.
#[tauri::command]
pub fn gc_orphan_assets(
    project_path: String,
    keep_asset_ids: Vec<String>,
) -> Result<u32, PersistenceError> {
    persistence::gc_orphan_assets(Path::new(&project_path), &keep_asset_ids)
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

/// Escribe en `path` un documento de texto plano/Markdown generado en
/// TypeScript — hoy, únicamente el "documento para revisión con IA"
/// (`src/export/aiReviewExport.ts`, petición de usuario: "que este archivo
/// lo pudiese ver ChatGPT o alguna otra IA").
///
/// Reutiliza `persistence::write_html_bundle` tal cual, sin duplicar la
/// lógica de escritura: esa función ya es genérica de verdad pese a su
/// nombre (un simple `std::fs::write` con creación de carpetas intermedias,
/// ver su comentario) — nunca interpretó ni validó el `html` que recibía,
/// así que sirve igual para cualquier otro texto. `content` es texto opaco
/// para Rust, igual que `html` en `export_html_bundle`; la ruta la elige el
/// usuario con el diálogo nativo de guardar (`pickExportAiReviewPath` en
/// `AppServices`).
#[tauri::command]
pub fn export_text_document(path: String, content: String) -> Result<(), PersistenceError> {
    persistence::write_html_bundle(Path::new(&path), &content)
}

/// Escribe en `path` el paquete SCORM 2004 4ª edición (`.zip`) generado a partir de los
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

/// Lee el contenido de texto de un archivo arbitrario elegido por el usuario
/// (p.ej. un `.twee` a importar). Rust no interpreta el contenido: solo lee
/// bytes UTF-8 tal cual; la ruta la elige el usuario con el diálogo nativo de
/// abrir (`pickImportTweePath` en `AppServices`).
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, PersistenceError> {
    persistence::read_text_file(Path::new(&path))
}
