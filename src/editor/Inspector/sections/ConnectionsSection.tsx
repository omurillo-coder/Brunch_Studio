import { useProjectStore } from '../../../store'
import { deriveEdges } from '../../../domain'
import type { Node, ProjectDocument } from '../../../domain'
import styles from '../Inspector.module.css'
import { nodeOptionLabel } from '../Inspector'

/**
 * Diapositivas conectadas con el nodo seleccionado (fase de navegación
 * rápida): las que APUNTAN a este nodo, y las que ESTE nodo referencia.
 * Calculado con `deriveEdges` (dominio): esa función ya encapsula
 * exactamente la definición de "salida" de un nodo (el `targetNodeId` de una
 * diapositiva "de continuar", o el de cada respuesta con destino de una "de
 * decisión"), así que no se duplica esa regla aquí.
 */
function incomingNodesOf(project: ProjectDocument, nodeId: string): Node[] {
  const edges = deriveEdges(project)
  const sourceIds = new Set(edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source))
  return project.graph.nodes.filter((node) => sourceIds.has(node.id))
}

function outgoingNodesOf(project: ProjectDocument, nodeId: string): Node[] {
  const edges = deriveEdges(project)
  const targetIds = new Set(edges.filter((edge) => edge.source === nodeId).map((edge) => edge.target))
  return project.graph.nodes.filter((node) => targetIds.has(node.id))
}

/**
 * Navegación rápida entre diapositivas conectadas: quién apunta a este nodo
 * y a quién apunta este nodo. Cada elemento es clicable y reutiliza
 * `focusNode` (mismo mecanismo que `LeftPanel`) para seleccionar y centrar
 * el lienzo en el nodo elegido — no se inventa un mecanismo nuevo. No se
 * muestra nada si el nodo no tiene ninguna conexión en ningún sentido.
 */
export function ConnectionsSection({ node, project }: { node: Node; project: ProjectDocument }) {
  const focusNode = useProjectStore((state) => state.focusNode)
  const incoming = incomingNodesOf(project, node.id)
  const outgoing = outgoingNodesOf(project, node.id)

  if (incoming.length === 0 && outgoing.length === 0) return null

  return (
    <div className={styles.connectionsSection}>
      {incoming.length > 0 && (
        <div>
          <h3 className={styles.connectionsTitle}>Diapositivas que llevan aquí</h3>
          <ul className={styles.connectionsList}>
            {incoming.map((source) => (
              <li key={source.id}>
                <button
                  type="button"
                  className={styles.connectionItem}
                  onClick={() => focusNode(source.id)}
                >
                  {nodeOptionLabel(source)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {outgoing.length > 0 && (
        <div>
          <h3 className={styles.connectionsTitle}>A dónde lleva esta diapositiva</h3>
          <ul className={styles.connectionsList}>
            {outgoing.map((target) => (
              <li key={target.id}>
                <button
                  type="button"
                  className={styles.connectionItem}
                  onClick={() => focusNode(target.id)}
                >
                  {nodeOptionLabel(target)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
