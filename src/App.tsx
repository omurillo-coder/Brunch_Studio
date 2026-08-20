import { useState } from 'react'
import { AppServicesProvider } from './app/AppServicesContext'
import type { AppServices } from './app/AppServices'
import { HomeScreen } from './editor/HomeScreen/HomeScreen'
import { EditorScreen } from './editor/EditorScreen/EditorScreen'

export interface AppProps {
  /**
   * Inyección de dependencias para tests: ver `AppServicesProvider`. En
   * producción se omite y se usan los servicios reales (Tauri + diálogos
   * nativos).
   */
  services?: Partial<AppServices>
}

/**
 * Decide qué pantalla mostrar: `HomeScreen` mientras no hay ningún
 * proyecto abierto, `EditorScreen` en cuanto `HomeScreen` reporta una ruta
 * de archivo (recién creada o recién abierta).
 *
 * Deliberadamente un `useState` simple en vez de una ruta con
 * react-router: solo hay dos pantallas y la navegación entre ellas no
 * necesita historial de navegador, deep-linking ni URLs — añadir un router
 * sería complejidad sin beneficio real en este punto.
 *
 * La ruta del archivo abierto se pasa a `EditorScreen` (fase 9): el
 * autoguardado necesita saber dónde escribir. Se guarda aquí porque es un
 * detalle de la sesión de la app, no del documento en sí (por eso no vive
 * en `useProjectStore`).
 */
function AppShell() {
  const [openProjectPath, setOpenProjectPath] = useState<string | null>(null)

  if (!openProjectPath) {
    return <HomeScreen onProjectOpened={setOpenProjectPath} />
  }

  return <EditorScreen filePath={openProjectPath} />
}

function App({ services }: AppProps) {
  return (
    <AppServicesProvider services={services}>
      <AppShell />
    </AppServicesProvider>
  )
}

export default App
