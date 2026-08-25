import { useEffect, useRef } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
import { useProjectStore } from '../../store'

/**
 * Guardián de cierre de ventana: intercepta el cierre real del sistema
 * operativo (botón rojo/aspa, Cmd+Q, "Cerrar ventana" del menú…) para
 * preguntar antes si hay cambios sin guardar, en vez de perderlos en
 * silencio.
 *
 * ---------------------------------------------------------------------------
 * Por qué vive en un hook propio (no dentro de `useAutosave`)
 * ---------------------------------------------------------------------------
 * Son dos responsabilidades distintas — "cuándo escribir a disco" vs. "qué
 * hacer si el sistema operativo pide cerrar la ventana" — que solo comparten
 * `flushPendingSave`. Separarlas evita que `useAutosave` tenga que conocer
 * `@tauri-apps/api/window`/`@tauri-apps/plugin-dialog`, y deja este hook
 * fácil de testear con sus propios mocks (ver el test que lo acompaña).
 * Pensado para llamarse una única vez desde `EditorScreen`, justo al lado de
 * `useAutosave` (antes del `if (previewMode)`, por el mismo motivo: no debe
 * reinstalarse cada vez que se conmuta Editor↔Player).
 *
 * ---------------------------------------------------------------------------
 * Cómo se decide si "hay algo sin guardar"
 * ---------------------------------------------------------------------------
 * Se lee `saveStatus` del store (ver `store/types.ts`) directamente en el
 * momento del cierre, sin suscribirse a él: `scheduleSave` (`useAutosave`)
 * pone `saveStatus: 'saving'` INMEDIATAMENTE al programar el temporizador de
 * debounce, no solo mientras la escritura está en vuelo — así que
 * `saveStatus === 'saving'` ya cubre tanto "cambio reciente todavía dentro
 * de la ventana de debounce" como "escritura en curso ahora mismo", sin
 * tener que inspeccionar el temporizador interno de `useAutosave` por
 * separado. También se trata `'error'` como "hay algo sin guardar": si el
 * último intento de guardado falló, el documento en memoria sigue sin
 * coincidir con el disco, y cerrar sin preguntar perdería esos cambios en
 * silencio — aunque no sea, en sentido estricto, un guardado "pendiente" de
 * debounce. `'idle'`/`'saved'` son los únicos casos en los que no hace falta
 * preguntar nada.
 *
 * ---------------------------------------------------------------------------
 * Por qué por-ventana y no un guardián global
 * ---------------------------------------------------------------------------
 * `getCurrentWindow()` siempre resuelve a LA ventana Tauri en la que corre
 * este código, y cada ventana de "Nueva ventana" (ver
 * `src/app/openNewProjectWindow.ts`) tiene su propio contexto de JavaScript
 * — su propia instancia de módulo de `useProjectStore`, su propio
 * `EditorScreen`. Montar este hook desde `EditorScreen` (que solo existe una
 * vez por ventana, con el proyecto de ESA ventana) ya basta para que el
 * guardián actúe sobre el estado de guardado correcto sin ningún mecanismo
 * adicional de "a qué ventana pertenezco".
 *
 * ---------------------------------------------------------------------------
 * El diálogo: tres desenlaces con un único diálogo nativo de 3 botones
 * ---------------------------------------------------------------------------
 * `@tauri-apps/plugin-dialog` (v2.4.0+, ya instalado en 2.7.2) admite
 * `message()` con `buttons: { yes, no, cancel }` — un diálogo nativo de
 * VERDAD con tres botones (`YesNoCancelCustom` en el lado Rust), no dos
 * diálogos encadenados. Se prefiere a `ask()`/`confirm()` (solo 2 botones,
 * ver spec de la tarea) precisamente porque permite modelar los tres
 * desenlaces pedidos con un único diálogo, sin la ambigüedad de no poder
 * distinguir "el usuario pulsó el botón negativo" de "el usuario cerró el
 * diálogo con Escape" que sí tendría un `ask()` de 2 botones.
 * - "Guardar y salir" (`Yes`): fuerza el guardado pendiente
 *   (`flushPendingSave`, expuesto por `useAutosave`) y espera a que
 *   termine antes de cerrar.
 * - "Salir sin guardar" (`No`): cierra directamente, sin guardar nada.
 * - "Cancelar" (`Cancel`, también lo que dispara Escape o cerrar el propio
 *   diálogo): no hace nada más — la ventana se queda abierta tal cual.
 *
 * ---------------------------------------------------------------------------
 * Cómo se evita el bucle infinito al cerrar de verdad
 * ---------------------------------------------------------------------------
 * `Window.close()` volvería a emitir `closeRequested` (así lo documenta la
 * propia API), lo que dispararía este mismo listener otra vez. Por eso el
 * cierre real, tanto en "Guardar y salir" como en "Salir sin guardar", usa
 * `Window.destroy()` — "se comporta como `close()` pero fuerza el cierre en
 * vez de emitir `closeRequested`" (doc oficial): cierra la ventana sin
 * volver a pasar por este guardián.
 */
export interface UseWindowCloseGuardOptions {
  /**
   * Fuerza cualquier guardado pendiente y espera a que termine. Se pasa tal
   * cual el `flushPendingSave` devuelto por `useAutosave(filePath)` — mismo
   * mecanismo que ya usa `EditorScreen.handleCloseProject` para "Cerrar
   * proyecto".
   */
  flushPendingSave: () => Promise<void>
}

/** Mensaje mostrado en el diálogo nativo de confirmación. */
const UNSAVED_CHANGES_MESSAGE = 'Tienes cambios sin guardar. ¿Quieres guardarlos antes de salir?'

export function useWindowCloseGuard({ flushPendingSave }: UseWindowCloseGuardOptions): void {
  // Referencia siempre-fresca para que el listener (instalado una única vez,
  // ver el `useEffect` de dependencias `[]` más abajo) nunca invoque una
  // versión obsoleta de `flushPendingSave` capturada en un cierre antiguo.
  const flushPendingSaveRef = useRef(flushPendingSave)
  useEffect(() => {
    flushPendingSaveRef.current = flushPendingSave
  }, [flushPendingSave])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined

    async function setup() {
      try {
        const appWindow = getCurrentWindow()
        const stop = await appWindow.onCloseRequested(async (event) => {
          const saveStatus = useProjectStore.getState().saveStatus
          const hasUnsavedChanges = saveStatus === 'saving' || saveStatus === 'error'
          if (!hasUnsavedChanges) {
            // Todo guardado: se deja cerrar sin preguntar nada.
            return
          }

          // Cancela el cierre inmediato mientras se pregunta.
          event.preventDefault()

          const choice = await message(UNSAVED_CHANGES_MESSAGE, {
            title: 'Cambios sin guardar',
            kind: 'warning',
            buttons: { yes: 'Guardar y salir', no: 'Salir sin guardar', cancel: 'Cancelar' },
          })

          if (choice === 'Cancel') {
            // La ventana se queda abierta tal cual.
            return
          }

          if (choice === 'Yes') {
            await flushPendingSaveRef.current()
          }

          // `destroy()`, no `close()`: cierra sin volver a emitir
          // `closeRequested` (ver comentario de diseño arriba).
          await appWindow.destroy()
        })

        if (cancelled) {
          stop()
        } else {
          unlisten = stop
        }
      } catch (error) {
        // Sin backend Tauri real detrás de `getCurrentWindow()`/
        // `onCloseRequested()` (p.ej. esta app corriendo fuera de un webview
        // Tauri, o un test que renderiza `EditorScreen` sin mockear
        // `@tauri-apps/api/window` porque no le interesa este guardián — ver
        // `Topbar.test.tsx`/`App.test.tsx`, que sí montan `EditorScreen`
        // completo): no hay ninguna ventana real que cerrar, así que no
        // tiene sentido más que no instalar el guardián. Nunca debe tirar la
        // app abajo ni dejar una promesa rechazada sin gestionar.
        console.warn('[useWindowCloseGuard] No se pudo registrar el guardián de cierre de ventana.', error)
      }
    }

    void setup()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])
}
