//! Validación superficial de las rutas que llegan a los comandos de Tauri
//! desde el frontend, ANTES de tocar el disco.
//!
//! Hallazgo de auditoría: "los comandos de Tauri no validan que las rutas
//! caigan dentro de una carpeta permitida" — todas las rutas que recibe esta
//! app llegan siempre de un diálogo nativo del sistema operativo
//! (`tauri-plugin-dialog`, ver `pickSaveProjectPath`/`pickOpenProjectPath`/
//! etc. en `src/app/AppServicesContext.tsx`), nunca escritas a mano por el
//! usuario ni construidas por Rust. Esta app permite deliberadamente abrir/
//! guardar en CUALQUIER carpeta que el usuario elija (no es un editor de
//! "workspace" con una única raíz permitida) — así que la defensa aquí no es
//! "la ruta debe caer dentro de X carpeta", sino dos comprobaciones baratas
//! que cualquier ruta que de verdad viniera de un diálogo nativo cumple
//! siempre: que sea ABSOLUTA (nunca relativa al directorio de trabajo actual
//! del proceso) y que su EXTENSIÓN encaje con lo que ese comando concreto
//! debería tocar. Si alguna de las dos falla, la ruta casi con toda
//! seguridad no vino de un diálogo nativo — p.ej. un IPC invocado
//! directamente desde un webview comprometido (ver también la CSP nueva en
//! `tauri.conf.json`, la otra mitad de este mismo hallazgo).

use std::path::Path;

use super::error::PersistenceError;

/// Comprueba que `path` es una ruta absoluta. Sin esto, una ruta relativa
/// colada por un IPC comprometido se resolvería contra el directorio de
/// trabajo actual del proceso de la app (indefinido/no elegido por el
/// usuario) en vez de fallar con claridad.
pub fn validate_absolute_path(path: &Path) -> Result<(), PersistenceError> {
    if !path.is_absolute() {
        return Err(PersistenceError::InvalidPath(format!(
            "la ruta debe ser absoluta: {}",
            path.display()
        )));
    }
    Ok(())
}

/// Igual que `validate_absolute_path`, y además exige que la extensión de
/// `path` sea una de `allowed_extensions` (comparación insensible a
/// mayúsculas/minúsculas, sin el punto — p.ej. `&["brunch"]`).
pub fn validate_target_path(
    path: &Path,
    allowed_extensions: &[&str],
) -> Result<(), PersistenceError> {
    validate_absolute_path(path)?;

    let extension = path.extension().and_then(|ext| ext.to_str());
    let matches = extension.is_some_and(|ext| {
        allowed_extensions
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(ext))
    });

    if !matches {
        return Err(PersistenceError::InvalidPath(format!(
            "extensión no permitida para esta operación (se esperaba {allowed_extensions:?}): {}",
            path.display()
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_absolute_path_accepts_an_absolute_path() {
        assert!(validate_absolute_path(Path::new("/tmp/proyecto.brunch")).is_ok());
    }

    #[test]
    fn validate_absolute_path_rejects_a_relative_path() {
        let result = validate_absolute_path(Path::new("proyecto.brunch"));
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn validate_absolute_path_rejects_a_relative_path_with_traversal() {
        let result = validate_absolute_path(Path::new("../../etc/passwd"));
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn validate_target_path_accepts_a_matching_extension() {
        assert!(
            validate_target_path(Path::new("/tmp/proyecto.brunch"), &["brunch"]).is_ok()
        );
    }

    #[test]
    fn validate_target_path_accepts_any_of_several_allowed_extensions() {
        assert!(validate_target_path(Path::new("/tmp/historia.twee"), &["twee", "tw"]).is_ok());
        assert!(validate_target_path(Path::new("/tmp/historia.tw"), &["twee", "tw"]).is_ok());
    }

    #[test]
    fn validate_target_path_is_case_insensitive() {
        assert!(validate_target_path(Path::new("/tmp/Proyecto.BRUNCH"), &["brunch"]).is_ok());
    }

    #[test]
    fn validate_target_path_rejects_a_mismatched_extension() {
        let result = validate_target_path(Path::new("/tmp/proyecto.html"), &["brunch"]);
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn validate_target_path_rejects_a_missing_extension() {
        let result = validate_target_path(Path::new("/tmp/proyecto"), &["brunch"]);
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }

    #[test]
    fn validate_target_path_rejects_a_relative_path_even_with_a_matching_extension() {
        let result = validate_target_path(Path::new("proyecto.brunch"), &["brunch"]);
        assert!(matches!(result, Err(PersistenceError::InvalidPath(_))));
    }
}
