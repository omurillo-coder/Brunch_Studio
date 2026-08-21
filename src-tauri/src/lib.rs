mod commands;
mod persistence;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::create_branch_project,
      commands::open_branch_project,
      commands::save_branch_project,
      commands::import_asset,
      commands::get_asset,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
