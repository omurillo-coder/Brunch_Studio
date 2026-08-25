//! Menú nativo de la aplicación (tarea 2): un submenú "Archivo" propio con
//! "Nueva ventana" y "Cerrar proyecto", insertado en la estructura mínima
//! que cualquier app de escritorio espera (menú de la app con
//! Acerca de/Ocultar/Salir en macOS, "Edición" con cortar/copiar/pegar,
//! "Ventana", "Ayuda") en vez de sustituirla entera.
//!
//! ---------------------------------------------------------------------------
//! Un único menú para toda la app, no uno por ventana
//! ---------------------------------------------------------------------------
//! `app.set_menu(menu)` (llamado una vez en `setup()`, ver `lib.rs`) fija un
//! menú "de toda la app": en macOS es, literalmente, la única barra de menú
//! que existe (no hay "menú de esta ventana"); en Windows cada ventana recibe
//! su propio menú nativo, pero automáticamente el mismo, en el momento de
//! crearse — código de Tauri (`tauri::window::WindowBuilder::build`) resuelve
//! el menú de cada ventana nueva a `self.menu.or_else(|| app.menu())`, así
//! que toda ventana que no pida explícitamente el suyo (ninguna de esta app
//! lo hace) hereda este mismo menú — incluidas las que `openNewProjectWindow`
//! (`src/app/openNewProjectWindow.ts`) crea dinámicamente desde el frontend.
//! No hace falta ningún código adicional para que el menú "funcione igual en
//! todas las ventanas".
//!
//! ---------------------------------------------------------------------------
//! Qué ventana concreta recibe el clic
//! ---------------------------------------------------------------------------
//! El evento nativo de menú (`MenuEvent`) no indica desde qué ventana se
//! disparó — Tauri lo entrega por igual a todos los listeners registrados
//! (`App::on_menu_event`, app-wide en este diseño). Por eso `handle_click`
//! localiza la ventana con el foco (`WebviewWindow::is_focused`) y le emite
//! un evento Tauri específico a ELLA — igual que ocurre de forma nativa: el
//! usuario interactúa con la barra de menú mientras una ventana concreta
//! tiene el foco, y es esa ventana la que debe reaccionar. El frontend de
//! cada ventana escucha esos eventos con `useNativeMenuActions`
//! (`src/editor/EditorScreen/useNativeMenuActions.ts`), montado desde
//! `EditorScreen`, y ejecuta EXACTAMENTE la misma función que antes disparaban
//! los botones ahora retirados de `Topbar` (`openNewProjectWindow()` /
//! `handleCloseProject()`).

use tauri::menu::{AboutMetadata, Menu, MenuEvent, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Identificador del ítem "Nueva ventana" del submenú "Archivo". El
/// frontend escucha un evento Tauri con este mismo nombre.
pub const MENU_NEW_WINDOW: &str = "menu-new-window";
/// Identificador del ítem "Cerrar proyecto" del submenú "Archivo". Sin
/// acelerador: `CmdOrCtrl+W` es la convención esperada para "cerrar la
/// ventana" (ya cubierta por el `close_window` estándar más abajo, con su
/// propio guardián de cambios sin guardar en `useWindowCloseGuard`) y
/// asignárselo a esta acción distinta ("volver a Inicio en la misma
/// ventana") confundiría las dos.
pub const MENU_CLOSE_PROJECT: &str = "menu-close-project";

/// Construye el menú nativo completo de la aplicación.
pub fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg_info = app.package_info();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        ..Default::default()
    };

    let new_window_item = MenuItemBuilder::with_id(MENU_NEW_WINDOW, "Nueva ventana")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let close_project_item =
        MenuItemBuilder::with_id(MENU_CLOSE_PROJECT, "Cerrar proyecto").build(app)?;

    // "Archivo": las dos acciones propias de esta app, seguidas del ítem
    // estándar "Cerrar ventana" (con su acelerador nativo `CmdOrCtrl+W`) —
    // mismo lugar donde macOS/Windows lo esperan por convención.
    let file_menu = SubmenuBuilder::new(app, "Archivo")
        .item(&new_window_item)
        .item(&close_project_item)
        .separator()
        .close_window()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edición")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Ventana")
        .minimize()
        .maximize()
        .build()?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, pkg_info.name.clone())
            .about(Some(about_metadata))
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .separator()
            .quit()
            .build()?;
        let view_menu = SubmenuBuilder::new(app, "Ver").fullscreen().build()?;
        let help_menu = SubmenuBuilder::new(app, "Ayuda").build()?;

        Menu::with_items(
            app,
            &[
                &app_menu,
                &file_menu,
                &edit_menu,
                &view_menu,
                &window_menu,
                &help_menu,
            ],
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        let help_menu = SubmenuBuilder::new(app, "Ayuda")
            .about(Some(about_metadata))
            .build()?;

        Menu::with_items(app, &[&file_menu, &edit_menu, &window_menu, &help_menu])
    }
}

/// Ventana con foco y, si ninguna la tiene (foco perdido por el sistema en
/// el instante exacto del clic — improbable pero no imposible), la primera
/// disponible: nunca se descarta el clic por falta de un foco claro mientras
/// exista al menos una ventana abierta.
fn focused_or_first_window<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::WebviewWindow<R>> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| windows.values().next())
        .cloned()
}

/// Handler de `Builder::on_menu_event`: reenvía "Nueva ventana"/"Cerrar
/// proyecto" como evento Tauri hacia la ventana con foco. Ignora
/// silenciosamente cualquier otro id (p.ej. los ítems predefinidos de
/// Edición/Ventana, que Tauri ya resuelve él solo sin pasar por aquí).
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().0.as_str();
    if id != MENU_NEW_WINDOW && id != MENU_CLOSE_PROJECT {
        return;
    }

    match focused_or_first_window(app) {
        Some(window) => {
            if let Err(error) = window.emit(id, ()) {
                log::error!(
                    "No se pudo emitir el evento de menú '{id}' a la ventana '{}': {error}",
                    window.label()
                );
            }
        }
        None => log::warn!("Menú nativo: no hay ninguna ventana a la que enviar '{id}'."),
    }
}
