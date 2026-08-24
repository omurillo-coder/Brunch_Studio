import type {
  AssetRepository,
  HtmlBundleWriter,
  ProjectRepository,
  ScormPackageWriter,
} from '../persistence'

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
  /**
   * Abre el diálogo nativo de "Abrir…" filtrado a extensiones de imagen o
   * audio según `kind`, para que el usuario elija un archivo del disco que
   * luego se importa como asset (`assetRepository.importAsset`). `null` si
   * cancela. Este diálogo solo obtiene la ruta: no lee bytes en JS.
   */
  pickImportAssetPath: (kind: 'image' | 'audio') => Promise<string | null>
  /**
   * Abre el diálogo nativo de "Guardar como…" para elegir dónde escribir el
   * `index.html` autónomo de la exportación; `null` si el usuario cancela.
   * `suggestedName` (normalmente el nombre del proyecto) preselecciona el
   * nombre de archivo propuesto, con extensión `.html`. Mismo patrón que
   * `pickSaveProjectPath`.
   */
  pickExportHtmlPath: (suggestedName?: string) => Promise<string | null>
  /**
   * Abre el diálogo nativo de "Guardar como…" para elegir dónde escribir el
   * paquete SCORM 1.2 (`.zip`) de la exportación; `null` si el usuario
   * cancela. `suggestedName` preselecciona el nombre de archivo propuesto,
   * con extensión `.zip`. Mismo patrón que `pickExportHtmlPath`.
   */
  pickExportScormPath: (suggestedName?: string) => Promise<string | null>
  /** Importa/lee assets binarios (imagen/audio) de un `.brunch`. */
  assetRepository: AssetRepository
  /** Escribe en disco el HTML autónomo generado por `src/export`. */
  htmlBundleWriter: HtmlBundleWriter
  /** Escribe en disco el paquete SCORM (`.zip`) generado por `src/export`. */
  scormPackageWriter: ScormPackageWriter
}
