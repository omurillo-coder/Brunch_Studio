import { lazy, Suspense, useState } from 'react'
import { AppServicesProvider } from './app/AppServicesContext'
import type { AppServices } from './app/AppServices'
import { HomeScreen } from './editor/HomeScreen/HomeScreen'
import styles from './App.module.css'

/**
 * `EditorScreen` (y todo lo que arrastra: Tiptap/ProseMirror para el editor
 * de texto enriquecido, `@xyflow/react` y `@dagrejs/dagre` para el lienzo)
 * es, con diferencia, el bloque más pesado del bundle inicial — y
 * `HomeScreen` ("Nuevo proyecto"/"Abrir proyecto"/"Importar .twee") no
 * necesita nada de eso. Cargarlo con `React.lazy()` deja ese peso fuera del
 * chunk principal: solo se descarga al crear/abrir un proyecto de verdad.
 */
const EditorScreen = lazy(() =>
  import('./editor/EditorScreen/EditorScreen').then((module) => ({
    default: module.EditorScreen,
  })),
)

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
 *
 * "Cerrar proyecto" (Topbar) hace el camino inverso: pone `openProjectPath`
 * de vuelta a `null` para volver a `HomeScreen` sin cerrar la ventana ni la
 * aplicación. El mismo `useState` que decide qué pantalla mostrar basta
 * para esto — no hace falta ningún estado nuevo.
 */
function AppShell() {
  const [openProjectPath, setOpenProjectPath] = useState<string | null>(null)

  if (!openProjectPath) {
    return <HomeScreen onProjectOpened={setOpenProjectPath} />
  }

  return (
    <Suspense fallback={<EditorScreenLoadingFallback />}>
      <EditorScreen filePath={openProjectPath} onCloseProject={() => setOpenProjectPath(null)} />
    </Suspense>
  )
}

/** Sustituto sobrio mientras se descarga el chunk de `EditorScreen`. */
function EditorScreenLoadingFallback() {
  return <p className={styles.loadingFallback}>Cargando…</p>
}

function App({ services }: AppProps) {
  return (
    <AppServicesProvider services={services}>
      <AppShell />
    </AppServicesProvider>
  )
}

export default App
