//! Escritura del bundle HTML autónomo generado por el frontend
//! (Milestone 3, fase 1).
//!
//! A diferencia del resto de este módulo, aquí no hay ningún contenedor
//! SQLite ni esquema que validar: el frontend construye en TypeScript un
//! único `index.html` autocontenido (documento + runtime del Player + assets
//! embebidos como `data:` URI, ver `src/export/`) y esto solo lo escribe tal
//! cual en la ruta que el usuario haya elegido en el diálogo nativo de
//! guardar.
//!
//! Round-trip exacto: el contenido se escribe sin ninguna transformación (ni
//! normalización de saltos de línea ni BOM), así que releer el archivo
//! devuelve byte a byte el mismo texto que envió el frontend.

use std::io::Write;
use std::path::Path;

use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use super::error::PersistenceError;

/// Escribe `html` en `path`, creando los directorios intermedios que falten.
///
/// Cualquier fallo de E/S (ruta no escribible, permisos, un componente
/// intermedio que en realidad es un archivo…) se propaga como
/// `PersistenceError::Io` — nunca `unwrap()`/`panic!`, mismo criterio que el
/// resto de la capa de persistencia.
///
/// Deliberadamente NO comprueba si `path` ya existe: el diálogo nativo de
/// "Guardar como…" ya avisa al usuario de la sobrescritura antes de devolver
/// la ruta, así que rechazarla aquí (como hace `create_project_file` con
/// `AlreadyExists`) impediría reexportar sobre el mismo archivo, que es el
/// caso normal al iterar sobre una experiencia.
pub fn write_html_bundle(path: &Path, html: &str) -> Result<(), PersistenceError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }

    std::fs::write(path, html)?;
    Ok(())
}

/// Escribe `html` en `path` como un `.zip` con una única entrada en la raíz,
/// `index.html` — petición de usuario ("la versión HTML quiero que me la
/// des comprimida en ZIP ya"): un `.zip` es más fácil de enviar por correo/
/// mensajería que un `.html` suelto (algunos filtros de correo corporativo
/// bloquean adjuntos HTML directamente) y, gracias a la compresión deflate,
/// más ligero en tránsito.
///
/// Mismo criterio de creación de carpetas intermedias, sobrescritura y
/// mapeo de errores que `write_html_bundle`. Mismo mecanismo de zip que
/// `write_scorm_package` (`scorm.rs`, una entrada más: `imsmanifest.xml`),
/// deliberadamente duplicado aquí en pequeño en vez de compartir sus
/// helpers privados — es media docena de líneas, y así este archivo no
/// depende de la existencia del módulo SCORM para su propio caso (más
/// simple) de "un único archivo dentro de un zip".
pub fn write_html_zip_bundle(path: &Path, html: &str) -> Result<(), PersistenceError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let file = std::fs::File::create(path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zip.start_file("index.html", options)
        .map_err(|err| PersistenceError::Io(err.to_string()))?;
    zip.write_all(html.as_bytes())?;
    zip.finish().map_err(|err| PersistenceError::Io(err.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const SAMPLE_HTML: &str = concat!(
        "<!doctype html>\n<html lang=\"es\"><head><meta charset=\"utf-8\">",
        "<title>Escenario de prueba</title></head><body>",
        "<p>Acentos y eñes: puntuación, diapositiva, ¿continuar?</p>",
        "</body></html>\n"
    );

    #[test]
    fn write_html_bundle_writes_content_that_can_be_read_back_exactly() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("experiencia.html");

        write_html_bundle(&path, SAMPLE_HTML).expect("escribir el bundle debe funcionar");

        assert!(path.exists(), "el archivo .html debe existir");
        let read_back = std::fs::read_to_string(&path).unwrap();
        assert_eq!(read_back, SAMPLE_HTML, "el HTML debe conservarse exactamente");
    }

    #[test]
    fn write_html_bundle_overwrites_an_existing_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("experiencia.html");

        write_html_bundle(&path, "<p>primera versión</p>").unwrap();
        write_html_bundle(&path, SAMPLE_HTML).unwrap();

        let read_back = std::fs::read_to_string(&path).unwrap();
        assert_eq!(read_back, SAMPLE_HTML);
    }

    #[test]
    fn write_html_bundle_creates_missing_parent_directories() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("exportaciones").join("2026").join("a.html");

        write_html_bundle(&path, SAMPLE_HTML).unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), SAMPLE_HTML);
    }

    #[test]
    fn write_html_bundle_on_unwritable_path_returns_io_error_not_panic() {
        let dir = TempDir::new().unwrap();
        // Un archivo normal usado como si fuese un directorio: el padre
        // "existe" (así que no se intenta crearlo) pero no es un directorio,
        // por lo que la escritura falla con un error de E/S controlado.
        let blocking_file = dir.path().join("no-soy-una-carpeta");
        std::fs::write(&blocking_file, b"contenido").unwrap();
        let path = blocking_file.join("experiencia.html");

        let result = write_html_bundle(&path, SAMPLE_HTML);
        assert!(matches!(result, Err(PersistenceError::Io(_))), "se esperaba Io, fue {result:?}");
    }

    #[test]
    fn write_html_bundle_on_a_directory_path_returns_io_error() {
        let dir = TempDir::new().unwrap();
        let result = write_html_bundle(dir.path(), SAMPLE_HTML);
        assert!(matches!(result, Err(PersistenceError::Io(_))), "se esperaba Io, fue {result:?}");
    }

    fn read_single_zip_entry(path: &Path) -> (String, String) {
        use std::io::Read;
        use zip::ZipArchive;

        let file = std::fs::File::open(path).unwrap();
        let mut archive = ZipArchive::new(file).expect("debe ser un zip válido");
        assert_eq!(archive.len(), 1, "el zip debe tener exactamente una entrada");
        let mut entry = archive.by_index(0).unwrap();
        let mut content = String::new();
        entry.read_to_string(&mut content).unwrap();
        (entry.name().to_string(), content)
    }

    #[test]
    fn write_html_zip_bundle_creates_a_zip_with_a_single_index_html_entry() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("experiencia.zip");

        write_html_zip_bundle(&path, SAMPLE_HTML).expect("empaquetar el zip debe funcionar");

        assert!(path.exists(), "el archivo .zip debe existir");
        let (name, content) = read_single_zip_entry(&path);
        assert_eq!(name, "index.html");
        assert_eq!(content, SAMPLE_HTML, "el HTML debe conservarse exactamente dentro del zip");
    }

    #[test]
    fn write_html_zip_bundle_overwrites_an_existing_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("experiencia.zip");

        write_html_zip_bundle(&path, "<p>primera versión</p>").unwrap();
        write_html_zip_bundle(&path, SAMPLE_HTML).unwrap();

        let (_, content) = read_single_zip_entry(&path);
        assert_eq!(content, SAMPLE_HTML);
    }

    #[test]
    fn write_html_zip_bundle_creates_missing_parent_directories() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("exportaciones").join("2026").join("a.zip");

        write_html_zip_bundle(&path, SAMPLE_HTML).unwrap();

        let (_, content) = read_single_zip_entry(&path);
        assert_eq!(content, SAMPLE_HTML);
    }

    #[test]
    fn write_html_zip_bundle_on_unwritable_path_returns_io_error_not_panic() {
        let dir = TempDir::new().unwrap();
        let blocking_file = dir.path().join("no-soy-una-carpeta");
        std::fs::write(&blocking_file, b"contenido").unwrap();
        let path = blocking_file.join("experiencia.zip");

        let result = write_html_zip_bundle(&path, SAMPLE_HTML);
        assert!(matches!(result, Err(PersistenceError::Io(_))), "se esperaba Io, fue {result:?}");
    }

    #[test]
    fn write_html_zip_bundle_on_a_directory_path_returns_io_error() {
        let dir = TempDir::new().unwrap();
        let result = write_html_zip_bundle(dir.path(), SAMPLE_HTML);
        assert!(matches!(result, Err(PersistenceError::Io(_))), "se esperaba Io, fue {result:?}");
    }
}
