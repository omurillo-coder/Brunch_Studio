import { useMemo, useState } from 'react'
import { useProject, useProjectStore, useViewportCenter } from '../../store'
import type { Node, NodePosition, NodeType } from '../../domain'
import { NODE_TYPE_LABEL, START_NODE_LABEL } from '../Canvas/nodes/nodeTypes'
import { extractPlainText, parseRichBody } from '../richText/richTextContent'
import styles from './LeftPanel.module.css'

/**
 * Tipos que se pueden crear desde este panel: los dos que existen en el
 * modelo. Ya no hay un botón de "Decisión" separado — una Diapositiva nace
 * en modo "de continuar" y se convierte en decisión al añadirle respuestas
 * desde el Inspector.
 */
const CREATABLE_TYPES: NodeType[] = ['slide', 'final']

/**
 * Heurística de posición de RESPALDO para nodos creados desde este panel,
 * usada únicamente mientras `Canvas` todavía no ha publicado ningún centro
 * visible (`ui.viewportCenter`, ver store) — no debería ocurrir en la app
 * real (`Canvas` siempre está montado junto a este panel), pero cubre el
 * instante antes de su primer cálculo y cualquier test que renderice
 * `LeftPanel` sin `Canvas`. Cascadeo en una cuadrícula de 5 columnas, origen
 * en (80, 80), separación de 220px en horizontal y 160px en vertical: no
 * pretende ser un layout definitivo, solo evitar que los nodos nuevos se
 * apilen exactamente unos sobre otros.
 */
function nextCascadePosition(existingNodeCount: number): NodePosition {
  const columns = 5
  const column = existingNodeCount % columns
  const row = Math.floor(existingNodeCount / columns)
  return { x: 80 + column * 220, y: 80 + row * 160 }
}

/**
 * Buscador del proyecto (fase 8): `query` ya normalizado (recortado, en
 * minúsculas). Un nodo aparece en la lista filtrada si el término buscado
 * aparece, sin distinguir mayúsculas/minúsculas, en su título, en el texto
 * plano real de su cuerpo, o en el texto de alguna de sus respuestas de
 * decisión.
 *
 * El cuerpo (`node.body`) es JSON de Tiptap serializado, NUNCA se compara
 * como substring directo: eso encontraría falsos positivos en la propia
 * sintaxis JSON (p.ej. buscar "type" "encontraría" cualquier nodo, por la
 * clave `"type":"doc"`). Se parsea con `parseRichBody` (la misma función que
 * usa `RichTextEditor`/la exportación) y se extrae su texto real con
 * `extractPlainText`, compartida con `src/editor/richText/richTextContent.ts`.
 */
function nodeMatchesQuery(node: Node, query: string): boolean {
  if (node.title.toLowerCase().includes(query)) {
    return true
  }
  if (extractPlainText(parseRichBody(node.body)).toLowerCase().includes(query)) {
    return true
  }
  if (node.type === 'slide') {
    return node.responses.some((response) => response.text.toLowerCase().includes(query))
  }
  return false
}

/** Panel izquierdo: buscar/filtrar, crear nodos y navegar la lista de nodos
 *  existentes. */
export function LeftPanel() {
  const project = useProject()
  const createNode = useProjectStore((state) => state.createNode)
  const selectNode = useProjectStore((state) => state.selectNode)
  const focusNode = useProjectStore((state) => state.focusNode)
  const viewportCenter = useViewportCenter()

  const [searchQuery, setSearchQuery] = useState('')
  const normalizedQuery = searchQuery.trim().toLowerCase()

  // Filtra la lista ya existente; no toca `focusNode`/selección, así que
  // hacer clic en un resultado filtrado centra el lienzo exactamente igual
  // que ya hacía antes de este buscador.
  const visibleNodes = useMemo(() => {
    if (!normalizedQuery) {
      return project.graph.nodes
    }
    return project.graph.nodes.filter((node) => nodeMatchesQuery(node, normalizedQuery))
  }, [project.graph.nodes, normalizedQuery])

  function handleCreate(type: NodeType) {
    // Tarea 4: la diapositiva nueva nace centrada en la parte visible del
    // lienzo (`ui.viewportCenter`, publicado por `Canvas`), en vez de en una
    // posición fija o en cascada — con la cascada como respaldo si ese
    // centro todavía no se ha calculado (ver `nextCascadePosition`).
    const position = viewportCenter ?? nextCascadePosition(project.graph.nodes.length)
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

      <div className={styles.searchSection}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Buscar en el proyecto…"
          aria-label="Buscar en el proyecto"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>

      <ul className={styles.nodeList}>
        {visibleNodes.map((node) => (
          <li key={node.id}>
            {/* `focusNode` selecciona el nodo (igual que `selectNode`) y
                además pide al lienzo que centre la vista en él, sin que
                este componente conozca `@xyflow/react` — ver
                `ui.focusRequestNodeId` en `src/store`. Reutilizado tal cual
                sobre la lista ya filtrada por el buscador. */}
            <button type="button" className={styles.nodeItem} onClick={() => focusNode(node.id)}>
              <span className={styles.nodeType}>{NODE_TYPE_LABEL[node.type]}</span>
              {/* Marca discreta del punto de partida del recorrido. Mismo
                  criterio (y misma etiqueta) que en la tarjeta del lienzo:
                  el inicio ya no es un nodo aparte, así que hay que poder
                  distinguirlo de un vistazo entre las demás diapositivas. */}
              {node.id === project.graph.startNodeId && (
                <span className={styles.nodeStartMark} title="Diapositiva de inicio">
                  {START_NODE_LABEL}
                </span>
              )}
              <span className={styles.nodeNumber}>{node.number}</span>
              <span className={styles.nodeTitle}>{node.title.trim() || 'Sin título'}</span>
            </button>
          </li>
        ))}
        {normalizedQuery && visibleNodes.length === 0 && (
          <li className={styles.noResults}>Sin resultados para "{searchQuery.trim()}"</li>
        )}
      </ul>
    </aside>
  )
}
