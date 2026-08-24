import dagre from '@dagrejs/dagre'
import { deriveEdges } from '../../../domain'
import type { NodePosition, ProjectDocument } from '../../../domain'
import { INITIAL_NODE_HEIGHT, INITIAL_NODE_WIDTH } from '../adapter'

/**
 * Auto-layout del lienzo: reordena todos los nodos de un proyecto según la
 * estructura real del grafo (`deriveEdges`), en vez de la rejilla simple sin
 * relación con las conexiones que hoy produce la importación de `.twee`
 * (ver `NODES_PER_ROW`/`NODE_COLUMN_SPACING`/`NODE_ROW_SPACING` en
 * `src/import/twee/tweeConverter.ts`).
 *
 * Implementación: `@dagrejs/dagre` (fork activamente mantenido de `dagre`,
 * la librería estándar para esto junto a `@xyflow/react` — hay ejemplos
 * oficiales de la propia librería usándola así). Calcula un layout
 * jerárquico DIRIGIDO horizontal, de izquierda a derecha (`rankdir: 'LR'`).
 *
 * Dirección elegida (horizontal, no vertical): el recorrido de un escenario
 * de este editor es fundamentalmente una secuencia de pasos hacia delante
 * (el Player avanza de diapositiva en diapositiva, con ramas ocasionales),
 * que un lector occidental ya interpreta de forma natural de izquierda a
 * derecha. Es además el criterio por defecto habitual para flujos
 * narrativos paso a paso (el mismo que usan la mayoría de herramientas de
 * autoría de "choice-based" narratives). Una disposición vertical no aporta
 * nada aquí y encajaría peor con lienzos anchos con pocas ramas simultáneas
 * (más ancho de pantalla disponible que alto).
 *
 * Pura y determinista: mismo `ProjectDocument` de entrada → mismas
 * posiciones de salida siempre. No muta `project` ni conoce ninguna
 * instancia de `@xyflow/react` — quien llama decide qué hacer con el
 * resultado (ver `store.applyLayout` y el botón "Ordenar automáticamente"
 * de `Canvas`).
 */

/**
 * Tamaño de nodo asumido para el cálculo de espaciado. Deliberadamente los
 * mismos valores que ya asume el resto del lienzo real para un nodo sin
 * medir todavía (`INITIAL_NODE_WIDTH`/`INITIAL_NODE_HEIGHT` de
 * `adapter.ts`), y no un tamaño inventado aparte: así el espaciado que
 * calcula `dagre` no queda desajustado respecto al tamaño con el que
 * `@xyflow/react` pinta las tarjetas de verdad.
 */
const LAYOUT_NODE_WIDTH = INITIAL_NODE_WIDTH
const LAYOUT_NODE_HEIGHT = INITIAL_NODE_HEIGHT

/**
 * Separación entre nodos, en píxeles de lienzo:
 * - `RANK_SEPARATION`: entre columnas consecutivas (eje de avance del
 *   flujo, horizontal en `rankdir: 'LR'`).
 * - `NODE_SEPARATION`: entre nodos de una misma columna (eje perpendicular).
 *
 * Valores holgados a propósito: una diapositiva con respuestas puede
 * pintarse algo más alta que `LAYOUT_NODE_HEIGHT` (aproximación, ver
 * comentario en `adapter.ts`), así que conviene margen de sobra para que
 * las tarjetas reales no queden pegadas ni sus aristas superpuestas.
 */
const RANK_SEPARATION = 120
const NODE_SEPARATION = 48

/** Un movimiento calculado por el auto-layout: mismo formato que `NodeMove`
 *  de dominio (`src/domain/project.ts`), consumido tal cual por
 *  `store.applyLayout`. */
export interface AutoLayoutMove {
  nodeId: string
  position: NodePosition
}

/**
 * Calcula la posición de cada nodo del proyecto según un layout jerárquico
 * dirigido de izquierda a derecha, construido a partir de las aristas
 * derivadas del dominio (`deriveEdges`) — la misma fuente de verdad que ya
 * usa el lienzo para pintar las conexiones, así que el layout calculado
 * siempre coincide con lo que se ve conectado en el lienzo.
 *
 * Casos cubiertos explícitamente (ver tests):
 * - Diapositiva de inicio (`graph.startNodeId`) siempre en la columna más a
 *   la izquierda (el arranque del flujo): se descartan, SOLO para el
 *   cálculo de rangos (no para el grafo real, que no se toca), las aristas
 *   que entran en ella. En el caso normal, sin ningún ciclo que vuelva al
 *   inicio, esto no cambia nada porque esa arista no existiría de todos
 *   modos; en un grafo con un ciclo que sí vuelve al inicio, este descarte
 *   garantiza que la diapositiva de inicio siga arrancando el recorrido en
 *   vez de quedar desplazada a media secuencia.
 * - Un ciclo (p.ej. A→B→A) no rompe el cálculo: `dagre` ya rompe ciclos
 *   internamente (invierte, solo para el cálculo de rangos, una arista del
 *   ciclo) antes de calcular el layout — no lanza ni se cuelga.
 * - Un nodo sin ninguna arista entrante ni saliente recibe igualmente una
 *   posición propia sin solapar con el resto: para `dagre` sigue siendo un
 *   nodo más del mismo grafo (en la columna 0, con un "orden" propio dentro
 *   de ella), así que el propio algoritmo de posicionado calcula su hueco
 *   como el de cualquier otro nodo, conectado o no.
 * - Determinista: no hay aleatoriedad ni dependencia de ningún estado
 *   externo (orden de iteración de `project.graph.nodes`, tal cual).
 */
export function computeAutoLayout(project: ProjectDocument): AutoLayoutMove[] {
  const { nodes } = project.graph
  if (nodes.length === 0) return []

  const startNodeId = project.graph.startNodeId
  const edges = deriveEdges(project)

  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: 'LR', nodesep: NODE_SEPARATION, ranksep: RANK_SEPARATION })
  graph.setDefaultEdgeLabel(() => ({}))

  for (const node of nodes) {
    graph.setNode(node.id, { width: LAYOUT_NODE_WIDTH, height: LAYOUT_NODE_HEIGHT })
  }
  for (const edge of edges) {
    if (edge.target === startNodeId) continue
    graph.setEdge(edge.source, edge.target)
  }

  dagre.layout(graph)

  return nodes.map((node) => {
    const layoutNode = graph.node(node.id)
    const centerX = layoutNode?.x ?? 0
    const centerY = layoutNode?.y ?? 0
    return {
      nodeId: node.id,
      // `dagre` posiciona cada nodo por su CENTRO; el dominio (igual que
      // `@xyflow/react`) usa la esquina superior izquierda, así que se
      // recentra restando la mitad del tamaño asumido.
      position: {
        x: centerX - LAYOUT_NODE_WIDTH / 2,
        y: centerY - LAYOUT_NODE_HEIGHT / 2,
      },
    }
  })
}
