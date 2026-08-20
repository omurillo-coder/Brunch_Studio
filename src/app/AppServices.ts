import type { ProjectRepository } from '../persistence'

/**
 * Dependencias externas de la aplicación que dependen del entorno de
 * ejecución real (backend Tauri, diálogos nativos del sistema operativo) y
 * que por eso se inyectan en vez de importarse directamente desde los
 * componentes de `src/editor`.
 *
 * Agrupar las tres piezas en una sola interfaz permite sustituirlas todas
 * juntas desde un único punto (`AppServicesProvider`) en tests: los
 * componentes de pantalla nunca importan `TauriProjectRepository` ni
 * `@tauri-apps/plugin-dialog`, solo llaman a `useAppServices()`.
 */
export interface AppServices {
  repository: ProjectRepository
  /**
   * Abre el diálogo nativo de "Guardar como…"; `null` si el usuario cancela.
   * `suggestedName` (el nombre de proyecto que el usuario acaba de escribir
   * en "Nuevo proyecto") se usa para preseleccionar el nombre de archivo
   * propuesto en el propio diálogo — el usuario sigue pudiendo cambiarlo
   * antes de guardar.
   */
  pickSaveProjectPath: (suggestedName?: string) => Promise<string | null>
  /** Abre el diálogo nativo de "Abrir…"; `null` si el usuario cancela. */
  pickOpenProjectPath: () => Promise<string | null>
}
