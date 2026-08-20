import { Topbar } from '../Topbar/Topbar'
import { LeftPanel } from '../LeftPanel/LeftPanel'
import { Inspector } from '../Inspector/Inspector'
import { Canvas } from '../Canvas/Canvas'
import { PlayerScreen } from '../../player/PlayerScreen'
import { usePreviewMode } from '../../store'
import { useAutosave } from './useAutosave'
import styles from './EditorScreen.module.css'

export interface EditorScreenProps {
  /** Ruta absoluta del `.branch` abierto; destino del autoguardado (fase 9). */
  filePath: string
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
 */
export function EditorScreen({ filePath }: EditorScreenProps) {
  const previewMode = usePreviewMode()
  useAutosave(filePath)

  if (previewMode) {
    return <PlayerScreen />
  }

  return (
    <div className={styles.screen}>
      <Topbar />
      <div className={styles.body}>
        <LeftPanel />
        <Canvas />
        <Inspector />
      </div>
    </div>
  )
}
