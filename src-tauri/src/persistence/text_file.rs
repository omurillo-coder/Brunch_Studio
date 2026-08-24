//! Lectura de texto arbitrario de un archivo elegido por el usuario.
//!
//! A diferencia del resto de este módulo, esto no tiene nada que ver con el
//! formato `.brunch` (SQLite): sirve para leer el contenido de texto plano de
//! un archivo cualquiera (p.ej. un `.twee` a importar) elegido con el diálogo
//! nativo de abrir (`pickImportTweePath` en `AppServices`). Rust no
//! interpreta el contenido: solo lee bytes UTF-8 y los devuelve tal cual.

use std::path::Path;

use super::error::PersistenceError;

/// Lee el contenido de texto de `path`.
///
/// Falla con `PersistenceError::NotFound` si la ruta no existe, y con
/// `PersistenceError::Io` para cualquier otro fallo de E/S (permisos,
/// contenido que no es UTF-8 válido, etc.) — nunca `unwrap()`/`panic!`, mismo
/// criterio que el resto de la capa de persistencia.
pub fn read_text_file(path: &Path) -> Result<String, PersistenceError> {
    if !path.exists() {
        return Err(PersistenceError::NotFound(path.display().to_string()));
    }

    let content = std::fs::read_to_string(path)?;
    Ok(content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn read_text_file_reads_utf8_content_exactly() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("historia.twee");
        std::fs::write(&path, "Hola, ¿qué tal? Ñandú.\n:: Pasaje\nTexto.\n").unwrap();

        let content = read_text_file(&path).expect("debe leer el archivo");
        assert_eq!(content, "Hola, ¿qué tal? Ñandú.\n:: Pasaje\nTexto.\n");
    }

    #[test]
    fn read_text_file_on_missing_path_returns_not_found_error_not_panic() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("no-existe.twee");
        assert!(!path.exists());

        let result = read_text_file(&path);
        assert!(matches!(result, Err(PersistenceError::NotFound(_))), "se esperaba NotFound, fue {result:?}");
    }

    #[test]
    fn read_text_file_on_non_utf8_content_returns_io_error_not_panic() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("binario.twee");
        // Secuencia de bytes que no es UTF-8 válido.
        std::fs::write(&path, [0xff, 0xfe, 0x00, 0x81]).unwrap();

        let result = read_text_file(&path);
        assert!(matches!(result, Err(PersistenceError::Io(_))), "se esperaba Io, fue {result:?}");
    }

    #[test]
    fn read_text_file_on_a_directory_path_returns_io_error() {
        let dir = TempDir::new().unwrap();
        let result = read_text_file(dir.path());
        assert!(matches!(result, Err(PersistenceError::Io(_))), "se esperaba Io, fue {result:?}");
    }
}
