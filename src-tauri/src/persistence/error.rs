//! Tipo de error serializable para la capa de persistencia.
//!
//! Se serializa con tag adyacente (`kind` + `content`) para que el frontend
//! TypeScript pueda distinguir de forma fiable el tipo de fallo (archivo no
//! encontrado, archivo inválido, versión de esquema no soportada, IO/SQLite
//! genérico) sin depender del texto exacto del mensaje.

use std::fmt;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "kind", content = "content")]
pub enum PersistenceError {
    /// La ruta indicada no existe (al abrir o guardar un `.brunch`).
    NotFound(String),
    /// Se intentó crear un `.brunch` en una ruta que ya existe.
    AlreadyExists(String),
    /// El archivo existe pero no es un `.brunch` válido (no es SQLite, o le
    /// faltan las tablas mínimas esperadas).
    InvalidFile(String),
    /// El `schema_version` del documento/contenedor no es el soportado por
    /// este binario.
    UnsupportedSchemaVersion { found: i64, supported: i64 },
    /// El JSON del documento no se pudo interpretar (p.ej. no tiene un
    /// campo `schemaVersion` numérico).
    InvalidDocument(String),
    /// El archivo indicado para importar como asset no tiene una extensión
    /// reconocida como imagen o audio. El contenido es la ruta original
    /// (para poder mostrar al usuario qué archivo se rechazó).
    UnsupportedAssetType(String),
    /// El archivo indicado para importar como asset supera
    /// `assets::MAX_ASSET_BYTES`. Se detecta con `std::fs::metadata` (sin
    /// leer el contenido) antes de intentar cargarlo en memoria.
    AssetTooLarge { max_bytes: u64, actual_bytes: u64 },
    /// Se intentó abrir un `.brunch` que ya está abierto en OTRA ventana de
    /// esta misma instancia de la app (ver `crate::open_registry`). El
    /// contenido es la ruta que se intentó abrir, para poder mostrarla en el
    /// mensaje al usuario. Evita el escenario de pérdida de datos silenciosa
    /// en el que dos ventanas autoguardan el mismo archivo por separado.
    AlreadyOpenElsewhere(String),
    /// Error de E/S genérico.
    Io(String),
    /// Error de SQLite genérico no cubierto por las variantes anteriores.
    Sqlite(String),
}

impl fmt::Display for PersistenceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PersistenceError::NotFound(path) => write!(f, "no se encontró el archivo: {path}"),
            PersistenceError::AlreadyExists(path) => {
                write!(f, "ya existe un archivo en la ruta: {path}")
            }
            PersistenceError::InvalidFile(reason) => {
                write!(f, "el archivo no es un .brunch válido: {reason}")
            }
            PersistenceError::UnsupportedSchemaVersion { found, supported } => write!(
                f,
                "versión de esquema no soportada: encontrada {found}, soportada {supported}"
            ),
            PersistenceError::InvalidDocument(reason) => {
                write!(f, "documento inválido: {reason}")
            }
            PersistenceError::UnsupportedAssetType(path) => write!(
                f,
                "tipo de archivo no soportado como asset (ni imagen ni audio reconocidos): {path}"
            ),
            PersistenceError::AssetTooLarge { max_bytes, actual_bytes } => write!(
                f,
                "el archivo es demasiado grande para importarse como asset: {actual_bytes} bytes (máximo {max_bytes} bytes)"
            ),
            PersistenceError::AlreadyOpenElsewhere(path) => {
                write!(f, "el proyecto ya está abierto en otra ventana: {path}")
            }
            PersistenceError::Io(message) => write!(f, "error de E/S: {message}"),
            PersistenceError::Sqlite(message) => write!(f, "error de SQLite: {message}"),
        }
    }
}

impl std::error::Error for PersistenceError {}

impl From<std::io::Error> for PersistenceError {
    fn from(err: std::io::Error) -> Self {
        PersistenceError::Io(err.to_string())
    }
}

impl From<rusqlite::Error> for PersistenceError {
    fn from(err: rusqlite::Error) -> Self {
        // Caso frecuente y significativo: el archivo no es una base de
        // datos SQLite (p.ej. el usuario apuntó a un archivo cualquiera con
        // extensión `.brunch`). Lo mapeamos a `InvalidFile` en vez de dejar
        // el mensaje genérico de SQLite.
        if let rusqlite::Error::SqliteFailure(sqlite_err, _) = &err {
            if sqlite_err.code == rusqlite::ErrorCode::NotADatabase {
                return PersistenceError::InvalidFile("el archivo no es una base SQLite".into());
            }
        }
        PersistenceError::Sqlite(err.to_string())
    }
}
