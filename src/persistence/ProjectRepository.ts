import type { ProjectDocument } from '../domain'

/**
 * Contrato de persistencia de un `ProjectDocument` en un archivo `.brunch`
 * en una ruta arbitraria del sistema de ficheros.
 *
 * `path` es siempre la ruta absoluta completa al archivo `.brunch` elegido
 * por el usuario (p.ej. mediante un diálogo nativo de guardar/abrir en una
 * fase posterior) — este módulo no decide rutas, solo opera sobre las que
 * se le pasan.
 *
 * Todas las operaciones son asíncronas y pueden rechazar la promesa; las
 * implementaciones documentan qué forma de error usan (`TauriProjectRepository`
 * rechaza con el `PersistenceError` serializado que devuelve Rust;
 * `MemoryProjectRepository` rechaza con un `Error` de JS estándar).
 */
export interface ProjectRepository {
  /**
   * Crea un `.brunch` nuevo en `path` con `document` como contenido inicial.
   * Debe rechazar si ya existe un proyecto en esa ruta.
   */
  createProject(path: string, document: ProjectDocument): Promise<void>

  /**
   * Abre el `.brunch` existente en `path` y devuelve su `ProjectDocument`,
   * ya validado contra `ProjectDocumentSchema`. Debe rechazar si la ruta no
   * existe o el contenido no es válido.
   */
  openProject(path: string): Promise<ProjectDocument>

  /**
   * Sobrescribe el `ProjectDocument` del `.brunch` ya existente en `path`.
   * Debe rechazar si la ruta no existe.
   */
  saveProject(path: string, document: ProjectDocument): Promise<void>
}
