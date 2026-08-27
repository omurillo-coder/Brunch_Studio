import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  TauriAssetRepository,
  TauriHtmlBundleWriter,
  TauriProjectRepository,
  TauriScormPackageWriter,
  TauriTextFileReader,
} from '../persistence'
import type { AppServices } from './AppServices'

/** Único filtro de extensión de archivo que reconoce este editor. */
const BRUNCH_FILE_FILTERS = [{ name: 'Proyecto Brunch Studio', extensions: ['brunch'] }]

/** Filtro del diálogo de guardado de la exportación a HTML autónomo. */
const HTML_FILE_FILTERS = [{ name: 'Página web', extensions: ['html'] }]

/** Filtro del diálogo de guardado de la exportación a paquete SCORM. */
const SCORM_FILE_FILTERS = [{ name: 'Paquete SCORM', extensions: ['zip'] }]

/** Filtro del diálogo de abrir para importar un archivo Twee (ver `src/import/twee`). */
const TWEE_FILE_FILTERS = [{ name: 'Archivo Twee', extensions: ['twee', 'tw'] }]

/** Extensiones de imagen/audio reconocidas al importar un asset. */
const ASSET_FILE_FILTERS: Record<'image' | 'audio', { name: string; extensions: string[] }> = {
  image: { name: 'Imagen', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
  audio: { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] },
}

/** Caracteres no válidos en un nombre de archivo en Windows/macOS. */
const INVALID_FILENAME_CHARS = /[/\\:*?"<>|]/g

/**
 * Convierte el nombre de proyecto escrito por el usuario en un nombre de
 * archivo válido en disco: quita caracteres prohibidos, colapsa espacios y
 * recorta puntos o espacios al final (Windows los rechaza). Si no queda
 * nada aprovechable, usa un nombre por defecto en vez de proponer un
 * archivo sin nombre.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(INVALID_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return cleaned.length > 0 ? cleaned : 'Sin título'
}

async function pickSaveProjectPathWithNativeDialog(suggestedName?: string): Promise<string | null> {
  const defaultPath = suggestedName ? `${sanitizeFileName(suggestedName)}.brunch` : undefined
  const path = await save({ filters: BRUNCH_FILE_FILTERS, defaultPath })
  return path ?? null
}

async function pickOpenProjectPathWithNativeDialog(): Promise<string | null> {
  const selected = await open({ filters: BRUNCH_FILE_FILTERS, multiple: false, directory: false })
  return typeof selected === 'string' ? selected : null
}

async function pickImportAssetPathWithNativeDialog(
  kind: 'image' | 'audio',
): Promise<string | null> {
  const selected = await open({
    filters: [ASSET_FILE_FILTERS[kind]],
    multiple: false,
    directory: false,
  })
  return typeof selected === 'string' ? selected : null
}

async function pickExportHtmlPathWithNativeDialog(suggestedName?: string): Promise<string | null> {
  const defaultPath = suggestedName ? `${sanitizeFileName(suggestedName)}.html` : undefined
  const path = await save({ filters: HTML_FILE_FILTERS, defaultPath })
  return path ?? null
}

async function pickExportScormPathWithNativeDialog(suggestedName?: string): Promise<string | null> {
  const defaultPath = suggestedName ? `${sanitizeFileName(suggestedName)}.zip` : undefined
  const path = await save({ filters: SCORM_FILE_FILTERS, defaultPath })
  return path ?? null
}

async function pickImportTweePathWithNativeDialog(): Promise<string | null> {
  const selected = await open({ filters: TWEE_FILE_FILTERS, multiple: false, directory: false })
  return typeof selected === 'string' ? selected : null
}

/**
 * Consulta al backend Rust (`take_pending_open_path`, ver
 * `src-tauri/src/open_file.rs`) si ESTA ventana (identificada por
 * `getCurrentWindow().label`) tiene una ruta `.brunch` pendiente de abrir al
 * arrancar. Envuelto en `try/catch`, igual criterio que
 * `useWindowCloseGuard`: sin backend Tauri real detrás (tests en jsdom,
 * `npm run dev` fuera de un webview Tauri) `invoke`/`getCurrentWindow`
 * simplemente rechazan o lanzan, y aquí se trata como "no hay ninguna ruta
 * pendiente" en vez de tirar la app abajo.
 */
async function getInitialOpenPathFromTauri(): Promise<string | null> {
  try {
    const windowLabel = getCurrentWindow().label
    const path = await invoke<string | null>('take_pending_open_path', { windowLabel })
    return path ?? null
  } catch (error) {
    console.warn('[getInitialOpenPathFromTauri] No se pudo consultar la ruta inicial a abrir.', error)
    return null
  }
}

/**
 * Invoca `release_open_project` (`src-tauri/src/commands/mod.rs`) para que
 * Rust libere, si la había, la ruta `.brunch` que ESTA ventana tenía
 * reservada en `OpenProjectRegistry`. Mismo criterio de robustez que
 * `getInitialOpenPathFromTauri`: envuelto en `try/catch` porque sin backend
 * Tauri real detrás (tests en jsdom, `npm run dev` fuera de un webview
 * Tauri) `invoke` simplemente rechaza, y aquí no hay nada más que hacer
 * salvo no tirar la app abajo — no queda ningún registro real que liberar.
 */
async function releaseOpenProjectInTauri(): Promise<void> {
  try {
    await invoke('release_open_project')
  } catch (error) {
    console.warn('[releaseOpenProjectInTauri] No se pudo liberar el registro de proyecto abierto.', error)
  }
}

/**
 * Servicios "reales" por defecto: repositorio respaldado por los comandos
 * Tauri y diálogos nativos del sistema operativo.
 *
 * Instanciar `TauriProjectRepository` no tiene efectos secundarios (solo
 * invoca comandos cuando se llama a sus métodos), así que es seguro crear
 * uno a nivel de módulo y reutilizarlo.
 */
export const defaultAppServices: AppServices = {
  repository: new TauriProjectRepository(),
  pickSaveProjectPath: pickSaveProjectPathWithNativeDialog,
  pickOpenProjectPath: pickOpenProjectPathWithNativeDialog,
  pickImportAssetPath: pickImportAssetPathWithNativeDialog,
  pickExportHtmlPath: pickExportHtmlPathWithNativeDialog,
  pickExportScormPath: pickExportScormPathWithNativeDialog,
  assetRepository: new TauriAssetRepository(),
  htmlBundleWriter: new TauriHtmlBundleWriter(),
  scormPackageWriter: new TauriScormPackageWriter(),
  pickImportTweePath: pickImportTweePathWithNativeDialog,
  textFileReader: new TauriTextFileReader(),
  getInitialOpenPath: getInitialOpenPathFromTauri,
  releaseOpenProject: releaseOpenProjectInTauri,
}

const AppServicesContext = createContext<AppServices>(defaultAppServices)

export interface AppServicesProviderProps {
  /**
   * Sustituye una o varias dependencias por defecto. Pensado para tests:
   * p.ej. pasar `{ repository: new MemoryProjectRepository(), pickOpenProjectPath: async () => '/fake.brunch' }`
   * sin depender del plugin de diálogo ni de un backend Tauri real.
   */
  services?: Partial<AppServices>
  children: ReactNode
}

export function AppServicesProvider({ services, children }: AppServicesProviderProps) {
  const value: AppServices = { ...defaultAppServices, ...services }
  return <AppServicesContext.Provider value={value}>{children}</AppServicesContext.Provider>
}

export function useAppServices(): AppServices {
  return useContext(AppServicesContext)
}
