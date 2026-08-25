import { Topbar } from '../Topbar/Topbar'
import { LeftPanel } from '../LeftPanel/LeftPanel'
import { Inspector } from '../Inspector/Inspector'
import { Canvas } from '../Canvas/Canvas'
import { PlayerScreen } from '../../player/PlayerScreen'
import { usePreviewMode } from '../../store'
import { useAutosave } from './useAutosave'
import styles from './EditorScreen.module.css'

export interface EditorScreenProps {
  /** Ruta absoluta del `.brunch` abierto; destino del autoguardado (fase 9). */
  filePath: string
  /**
   * Vuelve a `HomeScreen` en la misma ventana ("Cerrar proyecto" de
   * `Topbar`). `EditorScreen` no lo invoca directamente: primero fuerza
   * cualquier guardado pendiente (ver `handleCloseProject`) y solo entonces
   * llama a este callback, que en `App.tsx` (`AppShell`) pone
   * `openProjectPath` de vuelta a `null`.
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
 */
export function EditorScreen({ filePath, onCloseProject }: EditorScreenProps) {
  const previewMode = usePreviewMode()
  const { flushPendingSave } = useAutosave(filePath)

  async function handleCloseProject() {
    await flushPendingSave()
    onCloseProject()
  }

  if (previewMode) {
    return <PlayerScreen filePath={filePath} />
  }

  return (
    <div className={styles.screen}>
      <Topbar filePath={filePath} onCloseProject={() => void handleCloseProject()} />
      <div className={styles.body}>
        <LeftPanel />
        <Canvas />
        <Inspector filePath={filePath} />
      </div>
    </div>
  )
}
