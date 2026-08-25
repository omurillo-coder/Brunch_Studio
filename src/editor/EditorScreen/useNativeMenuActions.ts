import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { openNewProjectWindow } from '../../app/openNewProjectWindow'

/**
 * Conecta el menú nativo "Archivo" (submenú construido en Rust,
 * `src-tauri/src/app_menu.rs`) con las mismas acciones que antes disparaban
 * los botones "Nueva ventana"/"Cerrar proyecto", ahora retirados de
 * `Topbar` — no se duplica ninguna lógica: "Nueva ventana" llama a la misma
 * `openNewProjectWindow()` de siempre, y "Cerrar proyecto" invoca tal cual
 * el `onCloseProject` que ya pasa `EditorScreen` (mismo `handleCloseProject`
 * que fuerza el guardado pendiente antes de volver a `HomeScreen`).
 *
 * ---------------------------------------------------------------------------
 * Por qué se escucha con eventos Tauri (`listen`) y no se llama directo
 * ---------------------------------------------------------------------------
 * El clic ocurre en Rust (`handle_menu_event`, `app_menu.rs`), que no puede
 * invocar código de React directamente: emite un evento Tauri
 * (`menu-new-window`/`menu-close-project`) hacia la ventana con foco, y este
 * hook —montado una vez por ventana, desde `EditorScreen`— es quien escucha
 * y ejecuta la acción correspondiente en ESA ventana.
 *
 * ---------------------------------------------------------------------------
 * Por qué vive en `EditorScreen` y no más arriba (`App.tsx`)
 * ---------------------------------------------------------------------------
 * Mismo alcance que tenían los botones originales en `Topbar`: solo
 * disponibles mientras hay un proyecto abierto en esta ventana. El menú
 * nativo en sí (la barra de menú del sistema) está siempre visible —no se
 * puede ocultar por pantalla sin más plumbing— pero sus dos ítems propios
 * solo tienen efecto mientras `EditorScreen` está montado, igual que antes
 * solo existían como botones dentro de `Topbar`. Ver el informe de la tarea
 * para más detalle de esta decisión.
 */
export interface UseNativeMenuActionsOptions {
  /** Mismo `handleCloseProject` que invocaba el botón "Cerrar proyecto" de `Topbar`. */
  onCloseProject: () => void
}

export function useNativeMenuActions({ onCloseProject }: UseNativeMenuActionsOptions): void {
  // Referencia siempre-fresca, mismo patrón que `useWindowCloseGuard`: los
  // listeners se instalan una única vez (`useEffect` con dependencias `[]`)
  // pero deben invocar siempre la versión más reciente de `onCloseProject`.
  const onCloseProjectRef = useRef(onCloseProject)
  useEffect(() => {
    onCloseProjectRef.current = onCloseProject
  }, [onCloseProject])

  useEffect(() => {
    let cancelled = false
    const unlisteners: Array<() => void> = []

    async function setup() {
      try {
        const unlistenNewWindow = await listen('menu-new-window', () => {
          openNewProjectWindow()
        })
        if (cancelled) {
          unlistenNewWindow()
        } else {
          unlisteners.push(unlistenNewWindow)
        }

        const unlistenCloseProject = await listen('menu-close-project', () => {
          onCloseProjectRef.current()
        })
        if (cancelled) {
          unlistenCloseProject()
        } else {
          unlisteners.push(unlistenCloseProject)
        }
      } catch (error) {
        // Sin backend Tauri real detrás de `listen()` (tests, `npm run dev`
        // fuera de un webview Tauri): no hay ningún menú nativo real del que
        // recibir eventos, así que no tiene sentido más que no instalarlos.
        // Mismo criterio que `useWindowCloseGuard`.
        console.warn(
          '[useNativeMenuActions] No se pudieron registrar los listeners del menú nativo.',
          error,
        )
      }
    }

    void setup()

    return () => {
      cancelled = true
      unlisteners.forEach((unlisten) => unlisten())
    }
  }, [])
}
