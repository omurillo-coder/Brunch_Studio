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

/// Extensiones válidas de un `.brunch` (hallazgo de auditoría, ver
/// `persistence::validate_target_path`): un único punto para no repetir el
/// literal `["brunch"]` en cada comando que abre/crea/guarda un proyecto.
const BRUNCH_EXTENSIONS: &[&str] = &["brunch"];

/// Crea un `.brunch` nuevo en `path`: inicializa el esquema SQLite y guarda
/// `document_json` (el `ProjectDocument` inicial, ya construido en TS con
/// `createProject()` y serializado a JSON) como su contenido.
///
/// Falla con `PersistenceError::AlreadyExists` si `path` ya existe.
#[tauri::command]
pub fn create_branch_project(path: String, document_json: String) -> Result<(), PersistenceError> {
    let path = Path::new(&path);
    persistence::validate_target_path(path, BRUNCH_EXTENSIONS)?;
    persistence::create_project_file(path, &document_json)
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
    persistence::validate_target_path(Path::new(&path), BRUNCH_EXTENSIONS)?;

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
    let path = Path::new(&path);
    persistence::validate_target_path(path, BRUNCH_EXTENSIONS)?;
    persistence::save_project_file(path, &document_json)
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
    let project_path = Path::new(&project_path);
    let source_path = Path::new(&source_path);
    persistence::validate_target_path(project_path, BRUNCH_EXTENSIONS)?;
    // `source_path` no se valida por extensión aquí: `persistence::import_asset`
    // ya rechaza cualquier tipo no reconocido como imagen/audio/vídeo por su
    // propia extensión (`UnsupportedAssetType`, ver `assets.rs`), de forma
    // más precisa que un único conjunto fijo — repetirlo aquí solo
    // duplicaría esa lista. Sí debe ser absoluta, igual que cualquier otra
    // ruta que llegue a un comando.
    persistence::validate_absolute_path(source_path)?;
    persistence::import_asset(project_path, source_path)
}

/// Devuelve los bytes (en base64) y metadatos de un asset ya importado en
/// el `.brunch` en `project_path`.
#[tauri::command]
pub fn get_asset(project_path: String, asset_id: String) -> Result<AssetDataDto, PersistenceError> {
    let project_path = Path::new(&project_path);
    persistence::validate_target_path(project_path, BRUNCH_EXTENSIONS)?;
    persistence::get_asset(project_path, &asset_id)
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
    let project_path = Path::new(&project_path);
    persistence::validate_target_path(project_path, BRUNCH_EXTENSIONS)?;
    persistence::gc_orphan_assets(project_path, &keep_asset_ids)
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
    let path = Path::new(&path);
    persistence::validate_target_path(path, &["html"])?;
    persistence::write_html_bundle(path, &html)
}

/// Escribe en `path` un `.zip` con el MISMO `index.html` autónomo de
/// `export_html_bundle` como única entrada en la raíz — petición de usuario
/// ("la versión HTML quiero que me la des comprimida en ZIP ya"): el flujo
/// "Exportar HTML" del frontend (`useHtmlExport.ts`) usa este comando en vez
/// de `export_html_bundle`, un `.zip` es más fácil de enviar por correo/
/// mensajería que un `.html` suelto. `html` es texto opaco para Rust, igual
/// que en `export_html_bundle`; la ruta la elige el usuario con el diálogo
/// nativo de guardar (`pickExportHtmlPath` en `AppServices`, que ahora
/// propone `.zip`).
#[tauri::command]
pub fn export_html_zip_bundle(path: String, html: String) -> Result<(), PersistenceError> {
    let path = Path::new(&path);
    persistence::validate_target_path(path, &["zip"])?;
    persistence::write_html_zip_bundle(path, &html)
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
    let path = Path::new(&path);
    persistence::validate_target_path(path, &["md"])?;
    persistence::write_html_bundle(path, &content)
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
    let path = Path::new(&path);
    persistence::validate_target_path(path, &["zip"])?;
    persistence::write_scorm_package(path, &html, &manifest)
}

/// Lee el contenido de texto de un archivo arbitrario elegido por el usuario
/// (p.ej. un `.twee` a importar). Rust no interpreta el contenido: solo lee
/// bytes UTF-8 tal cual; la ruta la elige el usuario con el diálogo nativo de
/// abrir (`pickImportTweePath` en `AppServices`).
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, PersistenceError> {
    let path = Path::new(&path);
    persistence::validate_target_path(path, &["twee", "tw"])?;
    persistence::read_text_file(path)
}

#[cfg(test)]
mod tests {
    //! Hallazgo de auditoría ("la frontera IPC que expone los comandos a
    //! React no tiene tests"): cubre específicamente la validación de ruta
    //! nueva (`persistence::validate_target_path`, ver `path_safety.rs`) en
    //! cada comando que la recibió — no repite aquí la lógica de negocio de
    //! cada uno (ya probada a fondo en sus respectivos módulos de
    //! `persistence`). `#[tauri::command]` no impide llamar a las funciones
    //! como funciones Rust normales en un test — el atributo solo genera
    //! código adicional de registro IPC alrededor, la firma subyacente sigue
    //! siendo una función pública corriente.
    //!
    //! `open_branch_project`/`release_open_project` quedan fuera: dependen
    //! de `tauri::WebviewWindow`/`tauri::State`, que necesitan una app Tauri
    //! en marcha para construirse — fuera del alcance razonable de un test
    //! unitario de esta capa.
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
            "graph": { "nodes": [] },
            "editor": { "viewport": { "x": 0.0, "y": 0.0, "zoom": 1.0 } }
        })
        .to_string()
    }

    #[test]
    fn create_branch_project_rejects_a_relative_path() {
        let result = create_branch_project("proyecto.brunch".into(), sample_document_json());
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))), "se esperaba InvalidPath, fue {result:?}");
    }

    #[test]
    fn create_branch_project_rejects_a_mismatched_extension() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("proyecto.html");
        let result = create_branch_project(path.display().to_string(), sample_document_json());
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))), "se esperaba InvalidPath, fue {result:?}");
    }

    #[test]
    fn create_branch_project_accepts_an_absolute_brunch_path() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("proyecto.brunch");
        let result = create_branch_project(path.display().to_string(), sample_document_json());
        assert!(result.is_ok(), "se esperaba Ok, fue {result:?}");
        assert!(path.exists());
    }

    #[test]
    fn save_branch_project_rejects_a_relative_path() {
        let result = save_branch_project("proyecto.brunch".into(), sample_document_json());
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn save_branch_project_rejects_a_mismatched_extension() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("proyecto.txt");
        let result = save_branch_project(path.display().to_string(), sample_document_json());
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn get_asset_rejects_a_relative_project_path() {
        let result = get_asset("proyecto.brunch".into(), "asset-1".into());
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn get_asset_rejects_a_mismatched_project_extension() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("proyecto.zip");
        let result = get_asset(path.display().to_string(), "asset-1".into());
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn gc_orphan_assets_rejects_a_relative_project_path() {
        let result = gc_orphan_assets("proyecto.brunch".into(), vec![]);
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn import_asset_rejects_a_relative_project_path() {
        let dir = TempDir::new().unwrap();
        let source = dir.path().join("foto.png");
        std::fs::write(&source, [0u8; 4]).unwrap();
        let result = import_asset("proyecto.brunch".into(), source.display().to_string());
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn import_asset_rejects_a_relative_source_path_even_with_a_valid_project_path() {
        let dir = TempDir::new().unwrap();
        let project_path = dir.path().join("proyecto.brunch");
        create_branch_project(project_path.display().to_string(), sample_document_json())
            .unwrap();

        let result = import_asset(project_path.display().to_string(), "foto.png".into());
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn export_html_bundle_rejects_a_relative_path() {
        let result = export_html_bundle("salida.html".into(), "<p>hola</p>".into());
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn export_html_bundle_rejects_a_mismatched_extension() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("salida.zip");
        let result = export_html_bundle(path.display().to_string(), "<p>hola</p>".into());
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn export_html_bundle_accepts_an_absolute_html_path() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("salida.html");
        let result = export_html_bundle(path.display().to_string(), "<p>hola</p>".into());
        assert!(result.is_ok(), "se esperaba Ok, fue {result:?}");
    }

    #[test]
    fn export_html_zip_bundle_rejects_a_mismatched_extension() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("salida.html");
        let result = export_html_zip_bundle(path.display().to_string(), "<p>hola</p>".into());
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn export_html_zip_bundle_accepts_an_absolute_zip_path() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("salida.zip");
        let result = export_html_zip_bundle(path.display().to_string(), "<p>hola</p>".into());
        assert!(result.is_ok(), "se esperaba Ok, fue {result:?}");
    }

    #[test]
    fn export_text_document_rejects_a_mismatched_extension() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("revision.html");
        let result = export_text_document(path.display().to_string(), "# Revisión".into());
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn export_text_document_accepts_an_absolute_md_path() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("revision.md");
        let result = export_text_document(path.display().to_string(), "# Revisión".into());
        assert!(result.is_ok(), "se esperaba Ok, fue {result:?}");
    }

    #[test]
    fn export_scorm_package_rejects_a_mismatched_extension() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("paquete.html");
        let result = export_scorm_package(path.display().to_string(), "<p>hola</p>".into(), "<manifest/>".into());
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn export_scorm_package_accepts_an_absolute_zip_path() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("paquete.zip");
        let result = export_scorm_package(path.display().to_string(), "<p>hola</p>".into(), "<manifest/>".into());
        assert!(result.is_ok(), "se esperaba Ok, fue {result:?}");
    }

    #[test]
    fn read_text_file_rejects_a_relative_path() {
        let result = read_text_file("historia.twee".into());
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn read_text_file_rejects_a_mismatched_extension() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("historia.txt");
        std::fs::write(&path, "contenido").unwrap();
        let result = read_text_file(path.display().to_string());
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn read_text_file_accepts_both_twee_and_tw_extensions() {
        let dir = TempDir::new().unwrap();
        let twee_path = dir.path().join("historia.twee");
        let tw_path = dir.path().join("historia.tw");
        std::fs::write(&twee_path, "contenido twee").unwrap();
        std::fs::write(&tw_path, "contenido tw").unwrap();

        assert_eq!(read_text_file(twee_path.display().to_string()).unwrap(), "contenido twee");
        assert_eq!(read_text_file(tw_path.display().to_string()).unwrap(), "contenido tw");
    }
}
