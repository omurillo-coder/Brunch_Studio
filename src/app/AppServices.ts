import type {
  AssetRepository,
  HtmlBundleWriter,
  ProjectRepository,
  ScormPackageWriter,
  TextFileReader,
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
   * Abre el diálogo nativo de "Abrir…" filtrado a extensiones de imagen,
   * audio o vídeo según `kind`, para que el usuario elija un archivo del
   * disco que luego se importa como asset (`assetRepository.importAsset`).
   * `null` si cancela. Este diálogo solo obtiene la ruta: no lee bytes en JS.
   */
  pickImportAssetPath: (kind: 'image' | 'audio' | 'video') => Promise<string | null>
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
   * paquete SCORM 2004 4ª edición (`.zip`) de la exportación; `null` si el usuario
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
  /**
   * Abre el diálogo nativo de "Abrir…" filtrado a archivos `.twee`/`.tw`,
   * para importar un archivo Twee como proyecto nuevo (ver `src/import/twee`).
   * `null` si el usuario cancela.
   */
  pickImportTweePath: () => Promise<string | null>
  /** Lee el texto de un archivo arbitrario del disco (p.ej. el `.twee` elegido con `pickImportTweePath`). */
  textFileReader: TextFileReader
  /**
   * Ruta `.brunch` que ESTA ventana debe abrir directamente al arrancar, en
   * vez de mostrar `HomeScreen` — `null` si no hay ninguna. Cubre dos
   * orígenes: el sistema operativo invocó el ejecutable con la ruta de un
   * `.brunch` como argumento (Windows/Linux, asociación de tipo de archivo
   * del instalador), o el usuario hizo doble clic en un `.brunch` en macOS y
   * el backend Rust decidió que esta ventana concreta debía abrirlo (ver
   * `src-tauri/src/open_file.rs`). Se consume una única vez: llamadas
   * posteriores devuelven `null` aunque la primera haya encontrado algo.
   */
  getInitialOpenPath: () => Promise<string | null>
  /**
   * Libera, si la había, la ruta `.brunch` que ESTA ventana tenía reservada
   * en el registro de proyectos abiertos de Rust (`OpenProjectRegistry`, ver
   * `src-tauri/src/open_registry.rs`) — comando `release_open_project`.
   * Se invoca desde `EditorScreen.handleCloseProject` justo ANTES de volver
   * a `HomeScreen`, para que ese mismo archivo pueda reabrirse (en esta
   * ventana o en otra) sin que la app lo considere ya abierto. El cierre
   * real de la ventana libera la reserva por su cuenta en Rust, así que este
   * servicio solo hace falta para "Cerrar proyecto" sin cerrar la ventana.
   */
  releaseOpenProject: () => Promise<void>
}
