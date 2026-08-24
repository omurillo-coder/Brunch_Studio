//! Empaquetado del paquete SCORM 2004 4ª edición generado por el frontend
//! (Milestone 3, fase 2).
//!
//! Igual que `export::write_html_bundle`, este módulo no conoce nada del
//! dominio: el frontend construye en TypeScript el `index.html` autónomo
//! (`buildHtmlBundle`) y el `imsmanifest.xml` (`buildScormManifest`), y esto
//! solo los mete en un `.zip` con dos entradas en la raíz — sin subcarpetas,
//! que es como cualquier LMS (Moodle incluido) espera encontrar
//! `imsmanifest.xml` al abrir el paquete.
//!
//! Compresión: deflate (razonable, sin exigencia especial de SCORM sobre el
//! método de compresión del zip).

use std::io::Write;
use std::path::Path;

use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use super::error::PersistenceError;

/// Crea en `path` un `.zip` con exactamente dos entradas en la raíz:
/// `index.html` (contenido de `html`) e `imsmanifest.xml` (contenido de
/// `manifest`).
///
/// Cualquier fallo de E/S (ruta no escribible, permisos, un componente
/// intermedio que en realidad es un archivo…) se propaga como
/// `PersistenceError::Io` — mismo criterio que `write_html_bundle`. Un fallo
/// al escribir dentro del zip (`zip::result::ZipError`) también se mapea a
/// `Io`: para quien llama es, en la práctica, el mismo tipo de problema
/// (no se pudo completar la escritura en disco).
///
/// Deliberadamente NO comprueba si `path` ya existe, mismo criterio que
/// `write_html_bundle`: el diálogo nativo de "Guardar como…" ya avisa de la
/// sobrescritura antes de devolver la ruta.
pub fn write_scorm_package(
    path: &Path,
    html: &str,
    manifest: &str,
) -> Result<(), PersistenceError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let file = std::fs::File::create(path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    write_zip_entry(&mut zip, "imsmanifest.xml", manifest, options)?;
    write_zip_entry(&mut zip, "index.html", html, options)?;

    zip.finish().map_err(zip_error_to_io)?;
    Ok(())
}

fn write_zip_entry<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    name: &str,
    content: &str,
    options: SimpleFileOptions,
) -> Result<(), PersistenceError> {
    zip.start_file(name, options).map_err(zip_error_to_io)?;
    zip.write_all(content.as_bytes())?;
    Ok(())
}

fn zip_error_to_io(err: zip::result::ZipError) -> PersistenceError {
    PersistenceError::Io(err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use tempfile::TempDir;
    use zip::ZipArchive;

    const SAMPLE_HTML: &str = concat!(
        "<!doctype html>\n<html lang=\"es\"><head><meta charset=\"utf-8\">",
        "<title>Escenario de prueba</title></head><body>",
        "<p>Acentos y eñes: puntuación, diapositiva, ¿continuar?</p>",
        "</body></html>\n"
    );

    const SAMPLE_MANIFEST: &str = concat!(
        "<?xml version=\"1.0\" standalone=\"no\"?>\n",
        "<manifest identifier=\"brunch-test\">",
        "<organizations/><resources/></manifest>\n"
    );

    /// Lee de vuelta un `.zip` como un mapa `nombre de entrada -> contenido`,
    /// para comparar exactamente lo que se escribió.
    fn read_zip_entries(path: &Path) -> std::collections::BTreeMap<String, String> {
        let file = std::fs::File::open(path).unwrap();
        let mut archive = ZipArchive::new(file).expect("debe ser un zip válido");
        let mut entries = std::collections::BTreeMap::new();
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).unwrap();
            let mut content = String::new();
            entry.read_to_string(&mut content).unwrap();
            entries.insert(entry.name().to_string(), content);
        }
        entries
    }

    #[test]
    fn write_scorm_package_creates_a_zip_with_exactly_two_entries() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("experiencia.zip");

        write_scorm_package(&path, SAMPLE_HTML, SAMPLE_MANIFEST)
            .expect("empaquetar el SCORM debe funcionar");

        assert!(path.exists(), "el archivo .zip debe existir");
        let entries = read_zip_entries(&path);
        assert_eq!(
            entries.keys().collect::<Vec<_>>(),
            vec!["imsmanifest.xml", "index.html"],
            "el zip debe contener exactamente estas dos entradas en la raíz"
        );
    }

    #[test]
    fn write_scorm_package_writes_exact_content_for_each_entry() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("experiencia.zip");

        write_scorm_package(&path, SAMPLE_HTML, SAMPLE_MANIFEST).unwrap();

        let entries = read_zip_entries(&path);
        assert_eq!(entries.get("index.html").unwrap(), SAMPLE_HTML);
        assert_eq!(entries.get("imsmanifest.xml").unwrap(), SAMPLE_MANIFEST);
    }

    #[test]
    fn write_scorm_package_creates_missing_parent_directories() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("exportaciones").join("2026").join("a.zip");

        write_scorm_package(&path, SAMPLE_HTML, SAMPLE_MANIFEST).unwrap();

        let entries = read_zip_entries(&path);
        assert_eq!(entries.get("index.html").unwrap(), SAMPLE_HTML);
    }

    #[test]
    fn write_scorm_package_on_unwritable_path_returns_io_error_not_panic() {
        let dir = TempDir::new().unwrap();
        // Un archivo normal usado como si fuese un directorio: el padre
        // "existe" (así que no se intenta crearlo) pero no es un directorio,
        // por lo que la escritura falla con un error de E/S controlado.
        let blocking_file = dir.path().join("no-soy-una-carpeta");
        std::fs::write(&blocking_file, b"contenido").unwrap();
        let path = blocking_file.join("experiencia.zip");

        let result = write_scorm_package(&path, SAMPLE_HTML, SAMPLE_MANIFEST);
        assert!(
            matches!(result, Err(PersistenceError::Io(_))),
            "se esperaba Io, fue {result:?}"
        );
    }

    #[test]
    fn write_scorm_package_on_a_directory_path_returns_io_error() {
        let dir = TempDir::new().unwrap();
        let result = write_scorm_package(dir.path(), SAMPLE_HTML, SAMPLE_MANIFEST);
        assert!(
            matches!(result, Err(PersistenceError::Io(_))),
            "se esperaba Io, fue {result:?}"
        );
    }
}
