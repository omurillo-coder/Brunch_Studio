import { useProject, useProjectStore } from '../../store'
import type { NodePosition, NodeType } from '../../domain'
import styles from './LeftPanel.module.css'

const NODE_TYPE_LABEL: Record<NodeType, string> = {
  start: 'Inicio',
  content: 'Pantalla',
  decision: 'Decisión',
  final: 'Final',
}

/**
 * Tipos que se pueden crear desde este panel. No incluye `start`: solo
 * puede existir un nodo de Inicio por proyecto (lo crea `createProject`
 * automáticamente), así que no tiene sentido ofrecer un botón para crear
 * un segundo.
 */
const CREATABLE_TYPES: NodeType[] = ['content', 'decision', 'final']

/**
 * Heurística de posición para nodos creados desde este panel: cascadeo en
 * una cuadrícula de 5 columnas, origen en (80, 80), separación de 220px en
 * horizontal y 160px en vertical. No pretende ser un layout definitivo
 * (eso llega con el lienzo real de React Flow en la fase siguiente), solo
 * evitar que los nodos nuevos se apilen exactamente unos sobre otros.
 */
function nextCascadePosition(existingNodeCount: number): NodePosition {
  const columns = 5
  const column = existingNodeCount % columns
  const row = Math.floor(existingNodeCount / columns)
  return { x: 80 + column * 220, y: 80 + row * 160 }
}

/** Panel izquierdo: crear nodos y navegar la lista de nodos existentes. */
export function LeftPanel() {
  const project = useProject()
  const createNode = useProjectStore((state) => state.createNode)
  const selectNode = useProjectStore((state) => state.selectNode)

  function handleCreate(type: NodeType) {
    const position = nextCascadePosition(project.graph.nodes.length)
    createNode(type, position)

    // `createNode` no devuelve el nodo creado; como los números visibles
    // son estrictamente crecientes y nunca se reciclan (ver
    // `domain/id.ts`), el nodo recién creado es siempre el de mayor
    // `number` justo después de crearlo.
    const nodes = useProjectStore.getState().project.graph.nodes
    const created = nodes.reduce((max, node) => (node.number > max.number ? node : max))
    selectNode(created.id)
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.addSection}>
        {CREATABLE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={styles.addButton}
            onClick={() => handleCreate(type)}
          >
            + {NODE_TYPE_LABEL[type]}
          </button>
        ))}
      </div>

      <ul className={styles.nodeList}>
        {project.graph.nodes.map((node) => (
          <li key={node.id}>
            <button type="button" className={styles.nodeItem} onClick={() => selectNode(node.id)}>
              <span className={styles.nodeType}>{NODE_TYPE_LABEL[node.type]}</span>
              <span className={styles.nodeNumber}>{node.number}</span>
              <span className={styles.nodeTitle}>{node.title.trim() || 'Sin título'}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
