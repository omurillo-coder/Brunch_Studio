//! Esquema SQLite del contenedor `.brunch` y mecanismo mínimo de migración.
//!
//! El "esquema del contenedor" (las 3 tablas: `metadata`, `project_document`,
//! `assets`) se versiona con `PRAGMA user_version` y es independiente del
//! `schemaVersion` del `ProjectDocument` (que vive dentro de `metadata` como
//! la clave `schema_version` y dentro del propio JSON). Hoy solo existe una
//! migración de contenedor (la creación inicial de tablas), pero el patrón
//! de lista de migraciones queda preparado para añadir más en el futuro sin
//! tocar el código que las aplica.

use rusqlite::Connection;

use super::error::PersistenceError;

/// Versión del `schemaVersion` del `ProjectDocument` soportada por este
/// binario. Si un `.brunch` declara una versión distinta (mayor, por un
/// binario más nuevo que lo escribió, o menor, si en el futuro dejamos de
/// soportar versiones antiguas sin migrarlas), `open_project_file` /
/// `save_project_file` devuelven `UnsupportedSchemaVersion`.
pub const CURRENT_SCHEMA_VERSION: i64 = 1;

/// Fila única de `project_document`.
pub const DOCUMENT_ROW_ID: &str = "main";

/// Clave de `metadata` que guarda el `schemaVersion` del documento.
pub const SCHEMA_VERSION_KEY: &str = "schema_version";

/// Migraciones del esquema del contenedor, en orden. Cada entrada es
/// `(versión, sql)`; se aplican en una única transacción todas las
/// versiones por encima de `PRAGMA user_version` actual, y al final se deja
/// `user_version` en la versión más alta aplicada.
const MIGRATIONS: &[(i64, &str)] = &[(
    1,
    r#"
    CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
    );
    CREATE TABLE IF NOT EXISTS project_document (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        type TEXT,
        filename TEXT,
        mime_type TEXT,
        sha256 TEXT,
        data BLOB
    );
    "#,
)];

/// Aplica, dentro de una transacción, todas las migraciones de contenedor
/// pendientes (con `versión > user_version` actual). Idempotente: se puede
/// llamar tanto al crear un `.brunch` nuevo como al abrir uno existente.
pub fn run_migrations(conn: &Connection) -> Result<(), PersistenceError> {
    let current_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    let tx = conn.unchecked_transaction()?;
    let mut highest_applied = current_version;
    for (version, sql) in MIGRATIONS {
        if *version > current_version {
            tx.execute_batch(sql)?;
            highest_applied = highest_applied.max(*version);
        }
    }
    if highest_applied != current_version {
        tx.execute_batch(&format!("PRAGMA user_version = {highest_applied}"))?;
    }
    tx.commit()?;
    Ok(())
}

/// Fija explícitamente `journal_mode = DELETE` (nunca WAL) para los
/// ficheros `.brunch`: el producto es un único archivo editado en el sitio
/// que el usuario elija, y WAL puede dejar ficheros auxiliares `-wal`/`-shm`
/// junto a él, lo que no queremos para este formato.
pub fn ensure_delete_journal_mode(conn: &Connection) -> Result<(), PersistenceError> {
    let mode: String = conn.query_row("PRAGMA journal_mode = DELETE", [], |row| row.get(0))?;
    if !mode.eq_ignore_ascii_case("delete") {
        return Err(PersistenceError::Sqlite(format!(
            "no se pudo fijar journal_mode=DELETE (modo actual: {mode})"
        )));
    }
    Ok(())
}

/// Comprueba que las tablas mínimas del contenedor existen. Se usa al abrir
/// o guardar un `.brunch` ya existente para distinguir "SQLite válido pero
/// no es un `.brunch`" de un fallo genérico.
pub fn verify_container_tables(conn: &Connection) -> Result<(), PersistenceError> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN \
         ('metadata', 'project_document', 'assets')",
    )?;
    let found: i64 = stmt.query_map([], |row| row.get::<_, String>(0))?.count() as i64;
    if found < 3 {
        return Err(PersistenceError::InvalidFile(
            "faltan tablas del esquema (metadata/project_document/assets)".into(),
        ));
    }
    Ok(())
}
