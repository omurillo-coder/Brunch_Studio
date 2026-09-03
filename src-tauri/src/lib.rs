mod app_menu;
mod commands;
mod open_file;
mod open_registry;
mod persistence;

use open_file::{PendingOpenPaths, StartupState};
use open_registry::OpenProjectRegistry;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    // Primer plugin de la cadena a propósito (recomendación de Tauri): en
    // Windows/Linux, si el usuario hace doble clic en un segundo `.brunch`
    // mientras la app ya está corriendo, el sistema lanzaría por defecto un
    // proceso nuevo por cada intento. Este plugin detecta esa segunda
    // instancia, impide que arranque y reenvía sus argumentos (`argv`) a la
    // instancia ya en marcha — aquí simplemente se busca en ellos una ruta
    // `.brunch` y, si aparece, se abre en una ventana nueva (mismo mecanismo
    // que usa `RunEvent::Opened` en macOS, ver `open_file::open_path_in_new_window`).
    // En macOS no hace falta para este caso (el propio sistema operativo ya
    // reenvía la apertura a la instancia existente en vez de lanzar una
    // nueva, ver comentario de `open_file.rs`), pero registrarlo no estorba.
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      if let Some(path) = open_file::brunch_path_from_args(argv) {
        open_file::open_path_in_new_window(app, path);
      }
    }))
    .plugin(tauri_plugin_dialog::init())
    .on_menu_event(app_menu::handle_menu_event)
    // Libera, en `OpenProjectRegistry` (ver comentario de módulo en
    // `open_registry.rs`), cualquier ruta `.brunch` que la ventana
    // destruida tuviera reservada — uno de los dos mecanismos de
    // liberación (el otro es el comando explícito `release_open_project`,
    // para "Cerrar proyecto" sin cerrar la ventana). `Destroyed` y no
    // `CloseRequested`: este último puede cancelarse (ver
    // `useWindowCloseGuard.ts`), así que solo `Destroyed` garantiza que la
    // ventana de verdad ha dejado de existir.
    .on_window_event(|window, event| {
      if matches!(event, tauri::WindowEvent::Destroyed) {
        if let Some(registry) = window.try_state::<OpenProjectRegistry>() {
          registry.release_window(window.label());
        }
      }
    })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      app.manage(PendingOpenPaths::new());
      app.manage(StartupState::new());
      // Registro de rutas `.brunch` abiertas (ver `open_registry.rs`):
      // evita que el mismo archivo se abra a la vez en dos ventanas.
      app.manage(OpenProjectRegistry::new());
      // Arranque en frío (tarea 1): si el propio sistema operativo invocó el
      // ejecutable con la ruta de un `.brunch` como argumento (asociación de
      // tipo de archivo del instalador en Windows/Linux; respaldo en
      // macOS), se guarda aquí para que la ventana "main" la reclame en
      // cuanto su frontend monte (ver `open_file::take_pending_open_path`).
      open_file::register_cold_start_path(app.handle());

      // Menú nativo (tarea 2): un único menú de app, compartido por todas
      // las ventanas — ver el comentario de diseño en `app_menu.rs`.
      let menu = app_menu::build_app_menu(app.handle())?;
      app.set_menu(menu)?;

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::create_branch_project,
      commands::open_branch_project,
      commands::release_open_project,
      commands::save_branch_project,
      commands::import_asset,
      commands::get_asset,
      commands::gc_orphan_assets,
      commands::export_html_bundle,
      commands::export_text_document,
      commands::export_scorm_package,
      commands::read_text_file,
      open_file::take_pending_open_path,
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  #[cfg_attr(
    not(any(target_os = "macos", target_os = "ios", target_os = "android")),
    allow(unused_variables)
  )]
  app.run(|_app_handle, event| {
    // `RunEvent::Opened` solo existe en macOS/iOS/Android (ver su propio
    // `#[cfg]` en el crate `tauri`): es la vía por la que el sistema entrega
    // la ruta de un `.brunch` abierto desde Finder, tanto en el arranque en
    // frío como con la app ya corriendo (ver el comentario de módulo de
    // `open_file.rs` para cómo se distingue un caso del otro).
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
    if let tauri::RunEvent::Opened { urls } = event {
      open_file::handle_opened_urls(_app_handle, urls);
    }
  });
}
