import { useProject } from '../../store'
import styles from './CanvasPlaceholder.module.css'

/**
 * Área reservada para el lienzo real de React Flow (fase siguiente). Sin
 * interactividad de grafo todavía y sin ningún texto de "próximamente" —
 * solo el espacio dominante de la pantalla con un fondo discreto de puntos
 * y un contador sobrio de nodos, para no parecer un hueco vacío roto.
 */
export function CanvasPlaceholder() {
  const project = useProject()

  return (
    <div className={styles.canvas}>
      <span className={styles.nodeCount}>{project.graph.nodes.length}</span>
    </div>
  )
}
