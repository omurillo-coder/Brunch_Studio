import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { TauriProjectRepository } from '../persistence'
import type { AppServices } from './AppServices'

/** Único filtro de extensión de archivo que reconoce este editor. */
const BRANCH_FILE_FILTERS = [{ name: 'Proyecto Branch Studio', extensions: ['branch'] }]

async function pickSaveProjectPathWithNativeDialog(): Promise<string | null> {
  const path = await save({ filters: BRANCH_FILE_FILTERS })
  return path ?? null
}

async function pickOpenProjectPathWithNativeDialog(): Promise<string | null> {
  const selected = await open({ filters: BRANCH_FILE_FILTERS, multiple: false, directory: false })
  return typeof selected === 'string' ? selected : null
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
}

const AppServicesContext = createContext<AppServices>(defaultAppServices)

export interface AppServicesProviderProps {
  /**
   * Sustituye una o varias dependencias por defecto. Pensado para tests:
   * p.ej. pasar `{ repository: new MemoryProjectRepository(), pickOpenProjectPath: async () => '/fake.branch' }`
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
