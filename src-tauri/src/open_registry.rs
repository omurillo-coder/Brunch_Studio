//! Registro en memoria de qué ventana tiene abierto cada `.brunch`.
//!
//! ---------------------------------------------------------------------------
//! El problema que evita
//! ---------------------------------------------------------------------------
//! Cada ventana de Tauri autoguarda su propio `.brunch` de forma
//! independiente (`useAutosave`, `src/editor/EditorScreen/useAutosave.ts`).
//! Si el MISMO archivo se abre en dos ventanas a la vez, cada una escribe a
//! disco por su cuenta y la última en guardar gana sin avisar — pérdida de
//! datos silenciosa. Este registro impide llegar a ese estado: antes de leer
//! un `.brunch` de disco (`commands::open_branch_project`), se comprueba
//! aquí si esa ruta ya está a nombre de otra ventana y, si lo está, se
//! rechaza la apertura en vez de proceder.
//!
//! ---------------------------------------------------------------------------
//! Normalización de rutas
//! ---------------------------------------------------------------------------
//! La clave del mapa es la ruta CANONICALIZADA (`std::fs::canonicalize`):
//! dos rutas que apuntan al mismo archivo pero están escritas de forma
//! distinta (relativa vs. absoluta, con `..`, con enlaces simbólicos, con
//! mayúsculas distintas en Windows…) deben tratarse como la MISMA entrada.
//! Si `canonicalize` falla (p.ej. condición de carrera rarísima en la que el
//! archivo desaparece entre comprobaciones), se usa la ruta tal cual como
//! respaldo: es preferible una normalización imperfecta a que un error de
//! E/S en este paso impida abrir un archivo que sí existe.
//!
//! ---------------------------------------------------------------------------
//! Los dos mecanismos de liberación
//! ---------------------------------------------------------------------------
//! 1. Cierre real de la ventana (`WindowEvent::Destroyed`, registrado en
//!    `lib.rs` con `Builder::on_window_event`): libera cualquier ruta a
//!    nombre de esa `label`.
//! 2. "Cerrar proyecto" (misma ventana, vuelve a `HomeScreen` sin cerrarse):
//!    el comando `release_open_project` (`commands::release_open_project`),
//!    invocado desde `EditorScreen.handleCloseProject` ANTES de volver a
//!    `HomeScreen`.
//!
//! Ambos casos llaman a [`OpenProjectRegistry::release_window`]: por
//! invariante, una ventana nunca tiene más de una ruta registrada a la vez
//! (el frontend no permite pasar de un `.brunch` a otro sin pasar antes por
//! "Cerrar proyecto"), así que no hace falta distinguir cuál liberar.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Registro `ruta canonicalizada -> label de la ventana que la tiene
/// abierta`, gestionado por Tauri (`app.manage(...)`) como estado
/// compartido de toda la app.
pub struct OpenProjectRegistry(Mutex<HashMap<PathBuf, String>>);

impl Default for OpenProjectRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl OpenProjectRegistry {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }

    /// Normaliza `path` con `canonicalize`, o la devuelve tal cual si falla
    /// (ver comentario de módulo).
    fn normalize(path: &Path) -> PathBuf {
        std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
    }

    /// Intenta registrar `path` a nombre de `window_label`.
    ///
    /// - Si la ruta no estaba registrada, o lo estaba ya a nombre de ESTA
    ///   MISMA ventana: la (re)registra y devuelve `Ok(())`.
    /// - Si estaba registrada a nombre de OTRA ventana: no toca el
    ///   registro y devuelve `Err(label de esa otra ventana)`.
    pub fn try_acquire(&self, path: &Path, window_label: &str) -> Result<(), String> {
        let normalized = Self::normalize(path);
        let mut registry = self.0.lock().expect("poisoned OpenProjectRegistry mutex");

        if let Some(existing_label) = registry.get(&normalized) {
            if existing_label != window_label {
                return Err(existing_label.clone());
            }
        }

        registry.insert(normalized, window_label.to_string());
        Ok(())
    }

    /// Deshace un `try_acquire` fallido: quita `path` del registro SOLO si
    /// sigue a nombre de `window_label` (p.ej. si `open_project_file` falló
    /// justo después de reservar la ruta). No toca nada si, entre medias,
    /// la entrada pasó a pertenecer a otra ventana o ya no existe.
    pub fn release_path_if_owned(&self, path: &Path, window_label: &str) {
        let normalized = Self::normalize(path);
        let mut registry = self.0.lock().expect("poisoned OpenProjectRegistry mutex");
        if registry.get(&normalized).map(String::as_str) == Some(window_label) {
            registry.remove(&normalized);
        }
    }

    /// Libera cualquier ruta registrada a nombre de `window_label` — cierre
    /// real de la ventana, o "Cerrar proyecto" explícito. No falla si esa
    /// ventana no tenía ninguna ruta registrada.
    pub fn release_window(&self, window_label: &str) {
        let mut registry = self.0.lock().expect("poisoned OpenProjectRegistry mutex");
        registry.retain(|_, label| label != window_label);
    }

    #[cfg(test)]
    fn is_registered_to(&self, path: &Path, window_label: &str) -> bool {
        let normalized = Self::normalize(path);
        let registry = self.0.lock().expect("poisoned OpenProjectRegistry mutex");
        registry.get(&normalized).map(String::as_str) == Some(window_label)
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.0.lock().expect("poisoned OpenProjectRegistry mutex").len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_file(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        std::fs::write(&path, b"contenido").unwrap();
        path
    }

    #[test]
    fn registrar_una_ruta_y_reabrirla_desde_otra_ventana_falla() {
        let dir = TempDir::new().unwrap();
        let path = temp_file(&dir, "proyecto.brunch");
        let registry = OpenProjectRegistry::new();

        assert!(registry.try_acquire(&path, "main").is_ok());

        let result = registry.try_acquire(&path, "project-2");
        assert_eq!(result, Err("main".to_string()));
        // La segunda ventana no debe haber tomado posesión de la ruta.
        assert!(registry.is_registered_to(&path, "main"));
    }

    #[test]
    fn reabrir_desde_la_misma_ventana_no_falla() {
        let dir = TempDir::new().unwrap();
        let path = temp_file(&dir, "proyecto.brunch");
        let registry = OpenProjectRegistry::new();

        assert!(registry.try_acquire(&path, "main").is_ok());
        assert!(registry.try_acquire(&path, "main").is_ok());
        assert!(registry.is_registered_to(&path, "main"));
        assert_eq!(registry.len(), 1);
    }

    #[test]
    fn liberar_por_cierre_de_ventana_permite_reabrir_en_otra() {
        let dir = TempDir::new().unwrap();
        let path = temp_file(&dir, "proyecto.brunch");
        let registry = OpenProjectRegistry::new();

        registry.try_acquire(&path, "main").unwrap();
        registry.release_window("main");

        assert!(registry.try_acquire(&path, "project-2").is_ok());
        assert!(registry.is_registered_to(&path, "project-2"));
    }

    #[test]
    fn liberar_explicitamente_permite_reabrir_en_otra() {
        // Mismo mecanismo que "cierre de ventana" (`release_window`), pero
        // invocado como lo haría el comando `release_open_project` desde
        // "Cerrar proyecto" sin cerrar la ventana de verdad.
        let dir = TempDir::new().unwrap();
        let path = temp_file(&dir, "proyecto.brunch");
        let registry = OpenProjectRegistry::new();

        registry.try_acquire(&path, "main").unwrap();
        registry.release_window("main");

        assert!(registry.try_acquire(&path, "project-2").is_ok());
    }

    #[test]
    fn dos_rutas_distintas_no_interfieren_entre_si() {
        let dir = TempDir::new().unwrap();
        let path_a = temp_file(&dir, "a.brunch");
        let path_b = temp_file(&dir, "b.brunch");
        let registry = OpenProjectRegistry::new();

        assert!(registry.try_acquire(&path_a, "main").is_ok());
        assert!(registry.try_acquire(&path_b, "project-2").is_ok());

        assert!(registry.is_registered_to(&path_a, "main"));
        assert!(registry.is_registered_to(&path_b, "project-2"));

        // Cerrar "main" no afecta a la entrada de "project-2".
        registry.release_window("main");
        assert!(registry.is_registered_to(&path_b, "project-2"));
        assert_eq!(registry.len(), 1);
    }

    #[test]
    fn canonicalizacion_trata_rutas_equivalentes_como_la_misma() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        let real_path = temp_file(&dir, "sub/proyecto.brunch");

        // Misma ruta, pero con un segmento "subir y volver a bajar" —
        // sintácticamente distinta, mismo archivo real tras canonicalizar.
        let equivalent_path = dir.path().join("sub").join("..").join("sub").join("proyecto.brunch");
        assert_ne!(real_path, equivalent_path, "deben ser distintas antes de canonicalizar");

        let registry = OpenProjectRegistry::new();
        registry.try_acquire(&real_path, "main").unwrap();

        let result = registry.try_acquire(&equivalent_path, "project-2");
        assert_eq!(result, Err("main".to_string()));
    }

    #[test]
    fn release_path_if_owned_deshace_un_registro_reciente() {
        let dir = TempDir::new().unwrap();
        let path = temp_file(&dir, "proyecto.brunch");
        let registry = OpenProjectRegistry::new();

        registry.try_acquire(&path, "main").unwrap();
        registry.release_path_if_owned(&path, "main");

        assert!(registry.try_acquire(&path, "project-2").is_ok());
    }

    #[test]
    fn release_path_if_owned_no_toca_una_entrada_de_otra_ventana() {
        let dir = TempDir::new().unwrap();
        let path = temp_file(&dir, "proyecto.brunch");
        let registry = OpenProjectRegistry::new();

        registry.try_acquire(&path, "main").unwrap();
        // "project-2" nunca llegó a poseerla (su try_acquire habría
        // fallado); intentar liberarla en su nombre no debe afectar a "main".
        registry.release_path_if_owned(&path, "project-2");

        assert!(registry.is_registered_to(&path, "main"));
    }
}
