import { Topbar } from '../Topbar/Topbar'
import { LeftPanel } from '../LeftPanel/LeftPanel'
import { Inspector } from '../Inspector/Inspector'
import { Canvas } from '../Canvas/Canvas'
import styles from './EditorScreen.module.css'

/**
 * Shell visual del editor: barra superior + panel izquierdo + lienzo
 * (`@xyflow/react`, fase 5) + inspector derecho. El lienzo central es el
 * que domina el espacio; el resto son paneles compactos.
 */
export function EditorScreen() {
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
