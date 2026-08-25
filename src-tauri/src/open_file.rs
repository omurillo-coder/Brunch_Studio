//! Apertura de un `.brunch` desde el sistema operativo (doble clic en
//! Finder/Explorador, "Abrir con…", etc.) — tarea 1 de la asociación de tipo
//! de archivo.
//!
//! ---------------------------------------------------------------------------
//! Los tres orígenes posibles de "abre este archivo"
//! ---------------------------------------------------------------------------
//! 1. **Arranque en frío en Windows/Linux**: el instalador registra la
//!    asociación de `.brunch` (`bundle.fileAssociations`, ver
//!    `tauri.conf.json`) invocando el ejecutable con la ruta como argumento
//!    (`std::env::args()`). Se detecta en `setup()` con
//!    [`brunch_path_from_args`] y se guarda para la ventana "main" (la label
//!    por defecto de la única ventana declarada en `tauri.conf.json`).
//! 2. **macOS, con o sin la app ya corriendo**: el sistema entrega la ruta
//!    vía Apple Events, que Tauri traduce a `RunEvent::Opened { urls }` en el
//!    closure de `.run(...)` — tanto en el arranque en frío (la app aún no
//!    tenía ninguna ventana) como con la app ya en marcha (macOS reenvía el
//!    evento a la instancia existente en vez de lanzar un proceso nuevo).
//!    Ver [`handle_opened_urls`].
//! 3. **Windows/Linux con la app ya corriendo**: el sistema SÍ lanzaría un
//!    proceso nuevo por cada doble clic si no se evita explícitamente — de
//!    ahí `tauri-plugin-single-instance` (registrado en `lib.rs`, primer
//!    plugin de la cadena): detecta la segunda instancia, impide que
//!    arranque y reenvía sus argumentos a la instancia ya en marcha.
//!
//! ---------------------------------------------------------------------------
//! Cómo se distingue "en frío" de "con la app ya corriendo" para (2)
//! ---------------------------------------------------------------------------
//! `RunEvent::Opened` no indica por sí mismo si es la app arrancando o una
//! reapertura posterior. Se usa [`StartupState`] como aproximación: parte en
//! `false` y pasa a `true` la PRIMERA vez que cualquier ventana llama al
//! comando [`take_pending_open_path`] (justo lo que hace `AppShell` nada más
//! montarse). Mientras siga en `false`, un `Opened` se trata como parte del
//! arranque en frío (se guarda para que la ventana "main" lo recoja); en
//! cuanto pasa a `true`, un `Opened` implica que la app ya estaba operativa,
//! así que el archivo se abre en una ventana nueva sin tocar las existentes.
//!
//! ---------------------------------------------------------------------------
//! Cómo se comunica la ruta al frontend
//! ---------------------------------------------------------------------------
//! Ni argv ni `RunEvent::Opened` llegan en un momento en el que se pueda
//! garantizar que el frontend de la ventana destino ya está montado y
//! escuchando eventos — usar `emit()` a ciegas arriesga una condición de
//! carrera real (el evento llega antes de que exista el listener). En su
//! lugar, cada ruta pendiente se guarda en [`PendingOpenPaths`], indexada por
//! la label de la ventana que debe abrirla, y el comando
//! [`take_pending_open_path`] la entrega (una única vez — `remove`, no
//! `get`) cuando esa ventana la reclama al montar. `AppShell` (`src/App.tsx`)
//! llama a este comando en un `useEffect` nada más montar.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

/// Extensión reconocida para los proyectos de Brunch Studio. Debe coincidir
/// con `bundle.fileAssociations[0].ext` en `tauri.conf.json`.
const PROJECT_EXTENSION: &str = "brunch";

/// Label de la ventana declarada en `tauri.conf.json` (`app.windows[0]`, sin
/// `label` explícito -> por defecto "main" en Tauri 2).
const MAIN_WINDOW_LABEL: &str = "main";

/// Rutas `.brunch` pendientes de que la ventana con esa label las reclame al
/// montar su frontend. Ver el comentario de módulo para el ciclo de vida
/// completo.
pub struct PendingOpenPaths(Mutex<HashMap<String, String>>);

impl Default for PendingOpenPaths {
    fn default() -> Self {
        Self::new()
    }
}

impl PendingOpenPaths {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }

    fn insert(&self, window_label: impl Into<String>, path: impl Into<String>) {
        self.0
            .lock()
            .expect("poisoned PendingOpenPaths mutex")
            .insert(window_label.into(), path.into());
    }

    fn take(&self, window_label: &str) -> Option<String> {
        self.0
            .lock()
            .expect("poisoned PendingOpenPaths mutex")
            .remove(window_label)
    }
}

/// `true` en cuanto alguna ventana ha reclamado (con éxito o sin él) su ruta
/// pendiente al menos una vez — ver el comentario de módulo. Empieza en
/// `false` en `setup()`.
pub struct StartupState(AtomicBool);

impl Default for StartupState {
    fn default() -> Self {
        Self::new()
    }
}

impl StartupState {
    pub fn new() -> Self {
        Self(AtomicBool::new(false))
    }

    fn mark_started(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    fn has_started(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// `true` si `path` tiene la extensión `.brunch` (sin distinguir mayúsculas).
fn is_brunch_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case(PROJECT_EXTENSION))
}

/// Busca, entre los argumentos de línea de comandos, el primero que sea un
/// archivo `.brunch`. Ignora `args[0]` (el propio ejecutable). Cubre el
/// arranque en frío al hacer doble clic en un `.brunch` en Windows/Linux (el
/// instalador registra la asociación invocando el ejecutable con la ruta
/// como argumento) y sirve de respaldo en macOS, donde normalmente no hace
/// falta porque la ruta llega vía `RunEvent::Opened`.
pub fn brunch_path_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .skip(1)
        .find(|arg| is_brunch_file(Path::new(arg)))
}

/// Registra en `setup()` cualquier `.brunch` recibido por línea de comandos
/// (arranque en frío) para que la ventana "main" lo recoja al montar.
pub fn register_cold_start_path<R: Runtime>(app: &AppHandle<R>) {
    if let Some(path) = brunch_path_from_args(std::env::args()) {
        if let Some(pending) = app.try_state::<PendingOpenPaths>() {
            pending.insert(MAIN_WINDOW_LABEL, path);
        }
    }
}

/// Comando invocado por el frontend (`getInitialOpenPath`, `src/app/`) nada
/// más montar cada ventana: devuelve (y consume) la ruta `.brunch` pendiente
/// para SU label, si la hay. `window_label` lo obtiene el frontend de
/// `getCurrentWindow().label`.
#[tauri::command]
pub fn take_pending_open_path(
    window_label: String,
    pending: tauri::State<'_, PendingOpenPaths>,
    startup: tauri::State<'_, StartupState>,
) -> Option<String> {
    startup.mark_started();
    pending.take(&window_label)
}

/// Abre `path` en una ventana nueva e independiente — mismo patrón que
/// `src/app/openNewProjectWindow.ts` (label `project-<uuid>`, mismo tamaño y
/// título), pero disparado desde Rust porque quien pide abrir el archivo es
/// el sistema operativo, no un clic en la interfaz: la app ya está corriendo
/// (macOS: `RunEvent::Opened` después del arranque; Windows/Linux: segunda
/// instancia detectada por `tauri-plugin-single-instance`). Registra la ruta
/// en `PendingOpenPaths` ANTES de crear la ventana para que su frontend, al
/// montarse y llamar a `take_pending_open_path`, la encuentre ya disponible.
pub fn open_path_in_new_window<R: Runtime>(app: &AppHandle<R>, path: String) {
    let label = format!("project-{}", uuid::Uuid::new_v4());

    if let Some(pending) = app.try_state::<PendingOpenPaths>() {
        pending.insert(label.clone(), path);
    } else {
        log::error!("PendingOpenPaths no estaba gestionado: no se puede abrir '{label}'.");
        return;
    }

    let result = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Brunch Studio")
        .inner_size(800.0, 600.0)
        .build();

    if let Err(error) = result {
        log::error!("No se pudo abrir una ventana nueva para el archivo recibido: {error}");
    }
}

/// Maneja `RunEvent::Opened` (macOS/iOS): filtra las URLs que sean archivos
/// `.brunch` y las enruta según si la app ya llevaba un rato operativa o
/// seguía en pleno arranque en frío (ver el comentario de módulo).
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
pub fn handle_opened_urls<R: Runtime>(app: &AppHandle<R>, urls: Vec<tauri::Url>) {
    for url in urls {
        let Ok(path) = url.to_file_path() else {
            continue;
        };
        if !is_brunch_file(&path) {
            continue;
        }
        let path_string = path.to_string_lossy().into_owned();

        let already_started = app
            .try_state::<StartupState>()
            .map(|state| state.has_started())
            .unwrap_or(true);

        if already_started {
            open_path_in_new_window(app, path_string);
        } else if let Some(pending) = app.try_state::<PendingOpenPaths>() {
            pending.insert(MAIN_WINDOW_LABEL, path_string);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_brunch_file_acepta_la_extension_sin_distinguir_mayusculas() {
        assert!(is_brunch_file(Path::new("/tmp/proyecto.brunch")));
        assert!(is_brunch_file(Path::new("/tmp/PROYECTO.BRUNCH")));
        assert!(!is_brunch_file(Path::new("/tmp/proyecto.twee")));
        assert!(!is_brunch_file(Path::new("/tmp/sin-extension")));
    }

    #[test]
    fn brunch_path_from_args_ignora_el_ejecutable_y_encuentra_el_primero() {
        let args = vec![
            "brunch-studio.exe".to_string(),
            "--flag".to_string(),
            "C:\\Usuarios\\ana\\proyecto.brunch".to_string(),
        ];
        assert_eq!(
            brunch_path_from_args(args),
            Some("C:\\Usuarios\\ana\\proyecto.brunch".to_string())
        );
    }

    #[test]
    fn brunch_path_from_args_devuelve_none_sin_ningun_argumento_brunch() {
        let args = vec!["brunch-studio".to_string(), "--headless".to_string()];
        assert_eq!(brunch_path_from_args(args), None);
    }

    #[test]
    fn pending_open_paths_take_consume_una_unica_vez() {
        let pending = PendingOpenPaths::new();
        pending.insert("main", "/tmp/a.brunch");

        assert_eq!(pending.take("main"), Some("/tmp/a.brunch".to_string()));
        assert_eq!(pending.take("main"), None);
    }

    #[test]
    fn startup_state_empieza_sin_marcar_y_mark_started_es_permanente() {
        let state = StartupState::new();
        assert!(!state.has_started());
        state.mark_started();
        assert!(state.has_started());
        state.mark_started();
        assert!(state.has_started());
    }
}
