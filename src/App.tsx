import { lazy, Suspense, useEffect, useState } from 'react'
import { AppServicesProvider, useAppServices } from './app/AppServicesContext'
import type { AppServices } from './app/AppServices'
import { openExistingProject } from './app/openExistingProject'
import { showAlreadyOpenElsewhereWarningIfApplicable } from './app/alreadyOpenElsewhereWarning'
import { HomeScreen } from './editor/HomeScreen/HomeScreen'
import { useProjectStore } from './store'
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
 * "Cerrar proyecto" (menú nativo "Archivo", ver `useNativeMenuActions`) hace
 * el camino inverso: pone `openProjectPath` de vuelta a `null` para volver a
 * `HomeScreen` sin cerrar la ventana ni la aplicación. El mismo `useState`
 * que decide qué pantalla mostrar basta para esto — no hace falta ningún
 * estado nuevo.
 *
 * ---------------------------------------------------------------------------
 * Ruta inicial (tarea "abrir un `.brunch` desde Finder/Explorador")
 * ---------------------------------------------------------------------------
 * Al montar, se consulta una única vez `getInitialOpenPath()` (`AppServices`,
 * ver `src/app/AppServicesContext.tsx`): si esta ventana tiene una ruta
 * `.brunch` pendiente de abrir (porque el sistema operativo la pasó al
 * arrancar, o porque Rust decidió que esta ventana nueva debía abrirla — ver
 * `src-tauri/src/open_file.rs`), se abre con el MISMO flujo que "Abrir
 * proyecto" en `HomeScreen` (`openExistingProject` + `loadProject`) y se
 * salta directamente a `EditorScreen`, sin pasar por `HomeScreen`. Si no hay
 * ninguna ruta pendiente (el caso normal: arranque sin argumentos, o
 * "Nueva ventana" desde el menú/Topbar), no cambia nada — `HomeScreen` sigue
 * siendo la pantalla inicial exactamente como antes.
 *
 * Un fallo al abrir esa ruta inicial (archivo borrado, corrupto, o no
 * reconocible) se trata con el mismo mensaje que ya usa "Abrir proyecto" en
 * `HomeScreen`: se pasa como `initialError` para que lo muestre con su
 * propio `role="alert"`, en vez de duplicar esa UI aquí o dejar la ventana
 * en blanco en silencio.
 */
function AppShell() {
  const [openProjectPath, setOpenProjectPath] = useState<string | null>(null)
  const [initialOpenError, setInitialOpenError] = useState<string | null>(null)
  const { repository, getInitialOpenPath } = useAppServices()
  const loadProject = useProjectStore((state) => state.loadProject)

  useEffect(() => {
    let cancelled = false

    async function openInitialProjectIfAny() {
      const path = await getInitialOpenPath()
      if (!path || cancelled) return
      try {
        const document = await openExistingProject(repository, path)
        if (cancelled) return
        loadProject(document)
        setOpenProjectPath(path)
      } catch (error) {
        if (cancelled) return
        // Mismo criterio que "Abrir proyecto" en `HomeScreen`: si el motivo
        // concreto es que ya está abierto en otra ventana, el propio
        // diálogo nativo de aviso ya lo explica — no hace falta (ni se
        // debe) mostrar además el mensaje genérico de abajo.
        const alreadyWarned = await showAlreadyOpenElsewhereWarningIfApplicable(error)
        if (!cancelled && !alreadyWarned) {
          setInitialOpenError(
            'No se ha podido abrir ese archivo. Comprueba que es un proyecto de Brunch Studio válido.',
          )
        }
      }
    }

    void openInitialProjectIfAny()
    return () => {
      cancelled = true
    }
  }, [getInitialOpenPath, repository, loadProject])

  if (!openProjectPath) {
    return <HomeScreen onProjectOpened={setOpenProjectPath} initialError={initialOpenError} />
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
