import type { Edge as DomainEdge } from '../../../domain'

/**
 * Geometría y agrupación puras del trazado de una arista personalizada del
 * lienzo (punto 3: separar visualmente aristas paralelas/convergentes). Sin
 * dependencia de `@xyflow/react` más allá de los números de posición que ya
 * entrega `EdgeProps` — así es testeable sin montar la librería (ver
 * `__tests__/edgeGeometry.test.ts`). Import de `Edge` de dominio en vez de
 * acoplarse a `@xyflow/react` aquí: es intencional, `adapter.ts` es la única
 * pieza del lienzo que traduce entre ambos mundos.
 *
 * La curva es una bezier cúbica cuyos dos puntos de control se calculan
 * igual que la curva "bezier" por defecto de `@xyflow/react` (tangente
 * horizontal en cada extremo, coherente con que los handles de este lienzo
 * son siempre Left/Right — ver `handles.ts`), desplazados además en
 * perpendicular a la línea recta origen→destino por `offset` píxeles. Con
 * `offset = 0` los puntos de control quedan sobre esa misma línea recta, así
 * que la curva se reduce a una línea recta: el comportamiento visual para
 * una arista "sola" (sin paralelismo) es una línea recta y limpia; con
 * `offset != 0` se convierte en un arco suave hacia un lado, separándola de
 * sus aristas paralelas/convergentes.
 */

export interface EdgePathParams {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  /** Desplazamiento lateral en píxeles (ver `laneOffset` en `adapter.ts`).
   *  Positivo/negativo indican lados opuestos; el signo en sí no tiene
   *  significado semántico, solo debe ser estable entre renders. */
  offset: number
}

export interface EdgePathResult {
  /** Atributo `d` para un `<path>` SVG. */
  path: string
  /** Punto medio de la curva, útil para anclar una futura etiqueta. */
  labelX: number
  labelY: number
}

/** Fracción de la distancia horizontal usada para los puntos de control,
 *  igual a la curvatura por defecto de `@xyflow/react` para su edge
 *  "bezier" (`curvature: 0.25`), para que una arista sin paralelismo
 *  (`offset = 0`, ver más abajo) mantenga el mismo aspecto que antes. */
const DEFAULT_CURVATURE = 0.25
/** Mínimo de "tirón" horizontal de los puntos de control, para que el
 *  trazado no degenere en una línea recta pegada a los nodos cuando
 *  `sourceX`/`targetX` están casi a la misma altura vertical (`dx` pequeño
 *  pero `dy` grande) — un caso frecuente entre nodos apilados. */
const MIN_HORIZONTAL_PULL = 32

export function buildOffsetEdgePath(params: EdgePathParams): EdgePathResult {
  const { sourceX, sourceY, targetX, targetY, offset } = params
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const length = Math.hypot(dx, dy) || 1

  // Vector perpendicular unitario a la línea recta origen→destino, para
  // desplazar los puntos de control "hacia un lado" en vez de a lo largo de
  // la propia línea.
  const perpX = -dy / length
  const perpY = dx / length

  const horizontalPull = Math.max(Math.abs(dx) * DEFAULT_CURVATURE, MIN_HORIZONTAL_PULL)

  const c1x = sourceX + horizontalPull + perpX * offset
  const c1y = sourceY + perpY * offset
  const c2x = targetX - horizontalPull + perpX * offset
  const c2y = targetY + perpY * offset

  const path = `M${sourceX},${sourceY} C${c1x},${c1y} ${c2x},${c2y} ${targetX},${targetY}`

  // Punto de la curva cúbica en t = 0.5: B(0.5) = 1/8 P0 + 3/8 P1 + 3/8 P2 + 1/8 P3.
  const labelX = 0.125 * sourceX + 0.375 * c1x + 0.375 * c2x + 0.125 * targetX
  const labelY = 0.125 * sourceY + 0.375 * c1y + 0.375 * c2y + 0.125 * targetY

  return { path, labelX, labelY }
}

/** Información de "carril" (posición y tamaño de grupo) de una arista,
 *  calculada por `computeEdgeLanes`. */
export interface EdgeLane {
  laneIndex: number
  laneSize: number
}

/**
 * Agrupa las aristas derivadas por su nodo DESTINO y, dentro de cada grupo,
 * asigna a cada arista una posición estable (`laneIndex`, 0-based) y el
 * tamaño del grupo (`laneSize`).
 *
 * Criterio de agrupación (punto 3 del lienzo): dos aristas se consideran
 * "en la misma dirección" cuando comparten el mismo destino — esto cubre
 * tanto el caso de varias respuestas de UNA misma diapositiva que apuntan
 * al mismo nodo (comparten origen Y destino, un subconjunto de "mismo
 * destino") como el de varias diapositivas distintas que convergen en el
 * mismo destino (p.ej. varios caminos hacia el mismo Final). Agrupar solo
 * por destino es la intersección más simple que cubre ambos casos sin
 * necesitar geometría (posiciones de nodos) para decidir qué se considera
 * "cercano".
 *
 * El orden DENTRO de un grupo (qué arista es `laneIndex` 0, 1, 2...) se
 * decide por `source` y, si coincide, por `sourceHandle` — nunca por el
 * orden de iteración de `deriveEdges`/`project.graph.nodes` — para que el
 * resultado sea estable entre renders aunque el array de nodos del proyecto
 * cambie de orden por una edición no relacionada (crear/borrar otro nodo).
 */
export function computeEdgeLanes(edges: readonly DomainEdge[]): Map<string, EdgeLane> {
  const byTarget = new Map<string, DomainEdge[]>()
  for (const edge of edges) {
    const group = byTarget.get(edge.target)
    if (group) {
      group.push(edge)
    } else {
      byTarget.set(edge.target, [edge])
    }
  }

  const lanes = new Map<string, EdgeLane>()
  for (const group of byTarget.values()) {
    const ordered = [...group].sort((a, b) => {
      if (a.source !== b.source) return a.source < b.source ? -1 : 1
      const aHandle = a.sourceHandle ?? ''
      const bHandle = b.sourceHandle ?? ''
      if (aHandle !== bHandle) return aHandle < bHandle ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    ordered.forEach((edge, laneIndex) => {
      lanes.set(edge.id, { laneIndex, laneSize: ordered.length })
    })
  }
  return lanes
}

/**
 * Traduce la posición dentro de un grupo (`laneIndex`) a un desplazamiento
 * lateral en píxeles, en el patrón pedido: la primera arista del grupo
 * (`laneIndex` 0) sin desplazamiento, la segunda a un lado, la tercera al
 * otro lado, la cuarta más lejos hacia el primer lado, etc. — desplazamiento
 * creciente y alternando de lado a medida que crece el grupo.
 *
 * Determinista y pura: mismo `laneIndex` + `step` siempre da el mismo
 * resultado. La consumen tanto `adapter.ts` (si hiciera falta el valor en
 * píxeles fuera del componente) como el propio tipo de arista personalizado
 * (`edgeTypes.tsx`), que es quien realmente la usa para curvar la línea.
 */
export function laneOffset(laneIndex: number, step = 24): number {
  if (laneIndex === 0) return 0
  const magnitude = Math.ceil(laneIndex / 2) * step
  const sign = laneIndex % 2 === 1 ? 1 : -1
  return sign * magnitude
}
