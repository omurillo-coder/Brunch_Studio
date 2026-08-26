import { useEffect, useState } from 'react'
import { Topbar } from '../Topbar/Topbar'
import { LeftPanel } from '../LeftPanel/LeftPanel'
import { Inspector } from '../Inspector/Inspector'
import { VariablesPanel } from '../Variables/VariablesPanel'
import { Canvas } from '../Canvas/Canvas'
import { PlayerScreen } from '../../player/PlayerScreen'
import { usePreviewMode } from '../../store'
import { loadLeftPanelVisible, saveLeftPanelVisible } from '../uiPreferences'
import { useAutosave } from './useAutosave'
import { useWindowCloseGuard } from './useWindowCloseGuard'
import { useNativeMenuActions } from './useNativeMenuActions'
import styles from './EditorScreen.module.css'

export interface EditorScreenProps {
  /** Ruta absoluta del `.brunch` abierto; destino del autoguardado (fase 9). */
  filePath: string
  /**
   * Vuelve a `HomeScreen` en la misma ventana ("Cerrar proyecto" del menú
   * nativo "Archivo", ver `useNativeMenuActions`). `EditorScreen` no lo
   * invoca directamente: primero fuerza cualquier guardado pendiente (ver
   * `handleCloseProject`) y solo entonces llama a este callback, que en
   * `App.tsx` (`AppShell`) pone `openProjectPath` de vuelta a `null`.
   */
  onCloseProject: () => void
}

/**
 * Shell visual del editor: barra superior + panel izquierdo + lienzo
 * (`@xyflow/react`, fase 5) + inspector derecho. El lienzo central es el
 * que domina el espacio; el resto son paneles compactos.
 *
 * Modo "Probar" (fase 8): cuando `previewMode` está activo (botón
 * ▶ Probar de `Topbar`), este componente sustituye el shell de edición
 * completo por `PlayerScreen` — no una ventana nueva, ni un panel dentro
 * del shell. Así queda garantizado que mientras se está en el Player no
 * conviven en pantalla ninguno de los controles de edición (Topbar,
 * LeftPanel, Canvas, Inspector).
 *
 * Autoguardado (fase 9): `useAutosave(filePath)` se llama aquí, ANTES del
 * `if (previewMode)`, deliberadamente — no dentro de la rama del shell de
 * edición. `EditorScreen` nunca se desmonta al conmutar Editor↔Player (solo
 * cambia qué JSX devuelve este mismo componente), así que colocar el hook
 * aquí garantiza que su listener de `Ctrl+S`/`Cmd+S` y su temporizador de
 * debounce sigan "vivos" mientras el usuario está en el Player, en vez de
 * reiniciarse cada vez que se alterna entre ambos modos.
 *
 * "Cerrar proyecto": antes de avisar a `onCloseProject` (que desmonta este
 * componente al volver a `HomeScreen`), `handleCloseProject` fuerza
 * cualquier guardado pendiente vía `flushPendingSave` de `useAutosave`. Sin
 * este paso, un cambio hecho dentro de la ventana de debounce
 * (`AUTOSAVE_DEBOUNCE_MS`, ver `useAutosave.ts`) se perdería: al desmontarse
 * el efecto de autoguardado limpia su temporizador pendiente (`clearTimeout`
 * en el cleanup) en vez de dejarlo completarse, así que hay que adelantar esa
 * escritura explícitamente antes de desmontar.
 *
 * Panel izquierdo ocultable (tarea 1): `leftPanelVisible` es un estado local
 * de este componente (no del store de dominio ni del documento `.brunch` —
 * es preferencia de la app, no del proyecto), inicializado con el valor
 * guardado en `localStorage` y persistido de nuevo cada vez que cambia. Al
 * ocultarse, `LeftPanel` simplemente no se monta: `Canvas` (`flex: 1 1 auto`
 * en `EditorScreen.module.css`) ocupa el espacio liberado sin más cambios de
 * layout.
 *
 * Panel de variables (fase 2 del milestone "Variables/condiciones", Tarea
 * 1): `variablesPanelVisible` es, igual que `leftPanelVisible`, un estado
 * local puramente de sesión de edición — a propósito SIN persistir en
 * `localStorage` (a diferencia del panel izquierdo): es un panel de uso
 * puntual (crear/ajustar variables), no una preferencia de layout estable
 * que tenga sentido recordar entre sesiones. Cuando está visible,
 * SUSTITUYE al `Inspector` en vez de convivir con él (uno de los tres
 * diseños que sugiere el enunciado de la tarea) — ambos son paneles de
 * ancho similar a la derecha del lienzo, y mostrarlos a la vez recortaría
 * mucho el espacio del lienzo sin aportar nada (editar variables no
 * depende de qué nodo esté seleccionado). El botón "Variables" de `Topbar`
 * alterna este estado; el propio `VariablesPanel` también puede cerrarse
 * con su botón "✕" interno (mismo callback `onClose`).
 */
export function EditorScreen({ filePath, onCloseProject }: EditorScreenProps) {
  const previewMode = usePreviewMode()
  const { flushPendingSave } = useAutosave(filePath)
  // Guardián de cierre de ventana (tarea "cerrar con cambios pendientes"):
  // mismo criterio que `useAutosave` en cuanto a colocación — antes del
  // `if (previewMode)`, para que el listener sobreviva intacto a la
  // conmutación Editor↔Player. Ver comentario de diseño en
  // `useWindowCloseGuard.ts`.
  useWindowCloseGuard({ flushPendingSave })
  const [leftPanelVisible, setLeftPanelVisible] = useState(() => loadLeftPanelVisible())
  const [variablesPanelVisible, setVariablesPanelVisible] = useState(false)

  useEffect(() => {
    saveLeftPanelVisible(leftPanelVisible)
  }, [leftPanelVisible])

  async function handleCloseProject() {
    await flushPendingSave()
    onCloseProject()
  }

  // Menú nativo "Archivo" (tarea 2): "Nueva ventana"/"Cerrar proyecto" viven
  // ahora ahí en vez de como botones en `Topbar` — ver el comentario de
  // diseño en `useNativeMenuActions.ts`. Mismo criterio de colocación que
  // `useAutosave`/`useWindowCloseGuard`: antes del `if (previewMode)`, para
  // que los listeners sigan activos mientras el usuario está en el Player.
  useNativeMenuActions({ onCloseProject: () => void handleCloseProject() })

  if (previewMode) {
    return <PlayerScreen filePath={filePath} />
  }

  return (
    <div className={styles.screen}>
      <Topbar
        filePath={filePath}
        leftPanelVisible={leftPanelVisible}
        onToggleLeftPanel={() => setLeftPanelVisible((visible) => !visible)}
        variablesPanelVisible={variablesPanelVisible}
        onToggleVariablesPanel={() => setVariablesPanelVisible((visible) => !visible)}
      />
      <div className={styles.body}>
        {leftPanelVisible && <LeftPanel />}
        <Canvas />
        {variablesPanelVisible ? (
          <VariablesPanel onClose={() => setVariablesPanelVisible(false)} />
        ) : (
          <Inspector filePath={filePath} />
        )}
      </div>
    </div>
  )
}
