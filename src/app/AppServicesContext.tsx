import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import {
  TauriAssetRepository,
  TauriHtmlBundleWriter,
  TauriProjectRepository,
} from '../persistence'
import type { AppServices } from './AppServices'

/** Único filtro de extensión de archivo que reconoce este editor. */
const BRUNCH_FILE_FILTERS = [{ name: 'Proyecto Brunch Studio', extensions: ['brunch'] }]

/** Filtro del diálogo de guardado de la exportación a HTML autónomo. */
const HTML_FILE_FILTERS = [{ name: 'Página web', extensions: ['html'] }]

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
  assetRepository: new TauriAssetRepository(),
  htmlBundleWriter: new TauriHtmlBundleWriter(),
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
