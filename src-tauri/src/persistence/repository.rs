//! Operaciones de alto nivel sobre un fichero `.branch`: crear, abrir y
//! guardar. Rust trata el JSON del `ProjectDocument` como texto opaco (la
//! forma completa la valida TS/Zod); aquí solo se lee el campo
//! `schemaVersion` de ese JSON para poder decidir si este binario sabe
//! leerlo.

use std::path::Path;

use rusqlite::Connection;
use serde_json::Value;

use super::error::PersistenceError;
use super::schema::{
    ensure_delete_journal_mode, run_migrations, verify_container_tables, CURRENT_SCHEMA_VERSION,
    DOCUMENT_ROW_ID, SCHEMA_VERSION_KEY,
};

/// Extrae `schemaVersion` del JSON de un `ProjectDocument`. No valida nada
/// más de la forma del documento: eso es responsabilidad de Zod en TS.
fn extract_schema_version(document_json: &str) -> Result<i64, PersistenceError> {
    let value: Value = serde_json::from_str(document_json)
        .map_err(|err| PersistenceError::InvalidDocument(format!("JSON inválido: {err}")))?;

    value
        .get("schemaVersion")
        .and_then(Value::as_i64)
        .ok_or_else(|| {
            PersistenceError::InvalidDocument(
                "falta el campo numérico \"schemaVersion\" en el documento".into(),
            )
        })
}

fn check_supported_version(found: i64) -> Result<(), PersistenceError> {
    if found != CURRENT_SCHEMA_VERSION {
        return Err(PersistenceError::UnsupportedSchemaVersion {
            found,
            supported: CURRENT_SCHEMA_VERSION,
        });
    }
    Ok(())
}

/// Crea un `.branch` nuevo en `path`, inicializa el esquema SQLite y guarda
/// `document_json` como el `ProjectDocument` inicial.
///
/// Falla con `AlreadyExists` si ya hay un archivo en esa ruta, para no
/// sobrescribir silenciosamente un proyecto existente.
pub fn create_project_file(path: &Path, document_json: &str) -> Result<(), PersistenceError> {
    if path.exists() {
        return Err(PersistenceError::AlreadyExists(path.display().to_string()));
    }

    let schema_version = extract_schema_version(document_json)?;
    check_supported_version(schema_version)?;

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let conn = Connection::open(path)?;
    ensure_delete_journal_mode(&conn)?;
    run_migrations(&conn)?;

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO metadata (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (SCHEMA_VERSION_KEY, schema_version.to_string()),
    )?;
    tx.execute(
        "INSERT INTO project_document (id, json) VALUES (?1, ?2)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json",
        (DOCUMENT_ROW_ID, document_json),
    )?;
    tx.commit()?;

    Ok(())
}

/// Abre un `.branch` existente en `path` y devuelve el JSON del
/// `ProjectDocument` guardado, tal cual se escribió (round-trip exacto).
pub fn open_project_file(path: &Path) -> Result<String, PersistenceError> {
    if !path.exists() {
        return Err(PersistenceError::NotFound(path.display().to_string()));
    }

    let conn = Connection::open(path)?;
    verify_container_tables(&conn)?;
    run_migrations(&conn)?;

    let stored_version: String = conn
        .query_row(
            "SELECT value FROM metadata WHERE key = ?1",
            [SCHEMA_VERSION_KEY],
            |row| row.get(0),
        )
        .map_err(|_| {
            PersistenceError::InvalidFile("falta metadata.schema_version".into())
        })?;
    let stored_version: i64 = stored_version.parse().map_err(|_| {
        PersistenceError::InvalidFile(format!(
            "metadata.schema_version no es numérico: {stored_version}"
        ))
    })?;
    check_supported_version(stored_version)?;

    let json: String = conn
        .query_row(
            "SELECT json FROM project_document WHERE id = ?1",
            [DOCUMENT_ROW_ID],
            |row| row.get(0),
        )
        .map_err(|_| PersistenceError::InvalidFile("falta la fila de project_document".into()))?;

    Ok(json)
}

/// Sobrescribe, dentro de una transacción, el `ProjectDocument` de un
/// `.branch` ya existente en `path`.
pub fn save_project_file(path: &Path, document_json: &str) -> Result<(), PersistenceError> {
    if !path.exists() {
        return Err(PersistenceError::NotFound(path.display().to_string()));
    }

    let schema_version = extract_schema_version(document_json)?;
    check_supported_version(schema_version)?;

    let conn = Connection::open(path)?;
    verify_container_tables(&conn)?;

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE project_document SET json = ?1 WHERE id = ?2",
        (document_json, DOCUMENT_ROW_ID),
    )?;
    tx.execute(
        "INSERT INTO metadata (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (SCHEMA_VERSION_KEY, schema_version.to_string()),
    )?;
    tx.commit()?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::OptionalExtension;
    use tempfile::TempDir;

    /// Cada test recibe su propio directorio temporal (vía `tempfile`), que
    /// se borra solo al salir de scope (Drop) — así no hace falta limpiar
    /// manualmente ni preocuparse por colisiones de nombre entre tests.
    fn temp_branch_path(dir: &TempDir, name: &str) -> std::path::PathBuf {
        dir.path().join(format!("{name}.branch"))
    }

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
            "graph": {
                "nodes": [
                    {
                        "id": "22222222-2222-2222-2222-222222222222",
                        "number": 1,
                        "type": "start",
                        "position": { "x": 0.0, "y": 0.0 },
                        "title": "",
                        "body": ""
                    }
                ]
            },
            "editor": {
                "viewport": { "x": 0.0, "y": 0.0, "zoom": 1.0 }
            }
        })
        .to_string()
    }

    #[test]
    fn create_project_file_creates_file_with_expected_tables() {
        let dir = TempDir::new().unwrap();
        let path = temp_branch_path(&dir, "create-tables");
        let json = sample_document_json();
        create_project_file(&path, &json).expect("crear proyecto debe funcionar");

        assert!(path.exists(), "el archivo .branch debe existir");

        let conn = Connection::open(&path).unwrap();
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap();
        let tables: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert!(tables.contains(&"metadata".to_string()));
        assert!(tables.contains(&"project_document".to_string()));
        assert!(tables.contains(&"assets".to_string()));
    }

    #[test]
    fn save_and_open_roundtrip_preserves_json_exactly() {
        let dir = TempDir::new().unwrap();
        let path = temp_branch_path(&dir, "roundtrip");
        let original = sample_document_json();

        create_project_file(&path, &original).unwrap();
        let reopened = open_project_file(&path).unwrap();
        assert_eq!(reopened, original, "el JSON debe conservarse exactamente");

        // Y tras un save explícito con contenido distinto también debe
        // hacer roundtrip exacto.
        let mut value: Value = serde_json::from_str(&original).unwrap();
        value["metadata"]["name"] = Value::String("Otro nombre".into());
        let updated = value.to_string();

        save_project_file(&path, &updated).unwrap();
        let reopened_again = open_project_file(&path).unwrap();
        assert_eq!(reopened_again, updated);
    }

    #[test]
    fn open_missing_file_returns_not_found_error_not_panic() {
        let dir = TempDir::new().unwrap();
        let path = temp_branch_path(&dir, "missing");
        assert!(!path.exists());

        let result = open_project_file(&path);
        assert!(matches!(result, Err(PersistenceError::NotFound(_))));
    }

    #[test]
    fn save_missing_file_returns_not_found_error() {
        let dir = TempDir::new().unwrap();
        let path = temp_branch_path(&dir, "missing-save");
        let json = sample_document_json();
        let result = save_project_file(&path, &json);
        assert!(matches!(result, Err(PersistenceError::NotFound(_))));
    }

    #[test]
    fn create_on_existing_path_returns_already_exists() {
        let dir = TempDir::new().unwrap();
        let path = temp_branch_path(&dir, "already-exists");
        let json = sample_document_json();
        create_project_file(&path, &json).unwrap();

        let result = create_project_file(&path, &json);
        assert!(matches!(result, Err(PersistenceError::AlreadyExists(_))));
    }

    #[test]
    fn journal_mode_is_not_wal_after_create() {
        let dir = TempDir::new().unwrap();
        let path = temp_branch_path(&dir, "journal-mode");
        let json = sample_document_json();
        create_project_file(&path, &json).unwrap();

        let conn = Connection::open(&path).unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "delete");
        assert_ne!(mode.to_lowercase(), "wal");
    }

    #[test]
    fn write_happens_inside_a_real_transaction_and_leaves_consistent_state() {
        let dir = TempDir::new().unwrap();
        let path = temp_branch_path(&dir, "transaction");
        let json = sample_document_json();
        create_project_file(&path, &json).unwrap();

        // Tras crear, tanto metadata.schema_version como project_document
        // deben existir consistentemente (ambos se escriben en la misma
        // transacción): si la transacción no fuese real y algo fallase a
        // mitad, no tendríamos ambas filas presentes.
        let conn = Connection::open(&path).unwrap();
        let doc_row: Option<String> = conn
            .query_row(
                "SELECT json FROM project_document WHERE id = 'main'",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        let meta_row: Option<String> = conn
            .query_row(
                "SELECT value FROM metadata WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();

        assert!(doc_row.is_some());
        assert!(meta_row.is_some());
        assert_eq!(meta_row.unwrap(), "1");
    }

    #[test]
    fn initial_migration_sets_schema_version_metadata() {
        let dir = TempDir::new().unwrap();
        let path = temp_branch_path(&dir, "migration-schema-version");
        let json = sample_document_json();
        create_project_file(&path, &json).unwrap();

        let conn = Connection::open(&path).unwrap();
        let user_version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(user_version, 1, "la migración inicial debe fijar user_version=1");

        let schema_version: String = conn
            .query_row(
                "SELECT value FROM metadata WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(schema_version, "1");
    }

    #[test]
    fn open_rejects_unsupported_future_schema_version() {
        let dir = TempDir::new().unwrap();
        let path = temp_branch_path(&dir, "unsupported-version");
        let mut value: Value = serde_json::from_str(&sample_document_json()).unwrap();
        value["schemaVersion"] = Value::from(1);
        create_project_file(&path, &value.to_string()).unwrap();

        // Simula un .branch escrito por un binario futuro con una versión
        // de esquema desconocida para este binario.
        let conn = Connection::open(&path).unwrap();
        conn.execute(
            "UPDATE metadata SET value = '2' WHERE key = 'schema_version'",
            [],
        )
        .unwrap();
        drop(conn);

        let result = open_project_file(&path);
        assert!(matches!(
            result,
            Err(PersistenceError::UnsupportedSchemaVersion {
                found: 2,
                supported: 1
            })
        ));
    }

    #[test]
    fn open_file_that_is_not_a_valid_branch_returns_invalid_file_error() {
        let dir = TempDir::new().unwrap();
        let path = temp_branch_path(&dir, "not-a-branch");
        std::fs::write(&path, b"esto no es una base de datos SQLite").unwrap();

        let result = open_project_file(&path);
        assert!(matches!(result, Err(PersistenceError::InvalidFile(_))));
    }
}
