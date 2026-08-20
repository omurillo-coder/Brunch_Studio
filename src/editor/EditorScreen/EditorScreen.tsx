import { Topbar } from '../Topbar/Topbar'
import { LeftPanel } from '../LeftPanel/LeftPanel'
import { Inspector } from '../Inspector/Inspector'
import { Canvas } from '../Canvas/Canvas'
import { PlayerScreen } from '../../player/PlayerScreen'
import { usePreviewMode } from '../../store'
import styles from './EditorScreen.module.css'

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
 */
export function EditorScreen() {
  const previewMode = usePreviewMode()

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
