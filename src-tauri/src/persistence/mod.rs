//! Persistencia en disco del fichero `.brunch`.
//!
//! El `.brunch` es, internamente, un fichero SQLite abierto directamente
//! desde Rust con `rusqlite` (feature `bundled`, sin depender de una
//! libsqlite3 del sistema) — no se usa `@tauri-apps/plugin-sql` como
//! sistema principal de persistencia del documento, precisamente para poder
//! abrir un `.brunch` en cualquier ruta arbitraria que elija el usuario.
//!
//! El `ProjectDocument` completo se guarda como una única fila de texto JSON
//! (`project_document.json`); Rust no conoce ni valida su forma completa
//! (eso es responsabilidad de Zod en TypeScript) — solo lee el campo
//! `schemaVersion` para decidir si sabe leerlo.

mod assets;
mod error;
mod repository;
mod schema;

pub use assets::{get_asset, import_asset, AssetDataDto, AssetMetaDto};
pub use error::PersistenceError;
pub use repository::{create_project_file, open_project_file, save_project_file};
// Reexportado para uso futuro (p.ej. comandos que informen de la versión de
// esquema soportada); no se consume todavía desde `commands`.
#[allow(unused_imports)]
pub use schema::CURRENT_SCHEMA_VERSION;
