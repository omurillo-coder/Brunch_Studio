import { BaseEdge } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import type { CanvasEdgeData, CanvasFlowEdge } from '../adapter'
import { buildOffsetEdgePath, laneOffset } from './edgeGeometry'
import styles from './Edge.module.css'

/**
 * Tipo de arista personalizado del lienzo (puntos 2, 3 y 4):
 *
 * - Punto 2 (aristas siempre por delante de los nodos): esto NO se resuelve
 *   aquí sino por CSS (ver `Canvas.module.css`, capa `.react-flow__edges`
 *   por encima de `.react-flow__nodes`) — cualquier tipo de arista, incluso
 *   el `default` de la librería, se beneficia de ese ajuste. Tener un tipo
 *   propio de todas formas es necesario para los puntos 3 y 4.
 * - Punto 3 (paralelismo/convergencia): la curva se desplaza en lateral
 *   según `data.laneIndex`/`data.laneSize`, calculados en `adapter.ts`
 *   (`computeEdgeLanes`) y traducidos a píxeles por `laneOffset` — ver
 *   `edgeGeometry.ts` para la geometría pura.
 * - Punto 4 (resaltado de selección): `data.isHighlighted`/`data.isDimmed`,
 *   calculados en `adapter.ts` a partir de `selectedNodeIds`, deciden la
 *   clase CSS aplicada al trazo.
 */
export const BRUNCH_EDGE_TYPE = 'brunchEdge'

export function BrunchEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerStart,
  markerEnd,
}: EdgeProps<CanvasFlowEdge>) {
  const edgeData = data as CanvasEdgeData | undefined
  const offset = laneOffset(edgeData?.laneIndex ?? 0)
  const { path } = buildOffsetEdgePath({ sourceX, sourceY, targetX, targetY, offset })

  const className = [
    styles.path,
    edgeData?.isHighlighted && styles.highlighted,
    edgeData?.isDimmed && styles.dimmed,
  ]
    .filter(Boolean)
    .join(' ')

  return <BaseEdge path={path} markerStart={markerStart} markerEnd={markerEnd} className={className} />
}

/**
 * Mapa `edgeTypes` de `@xyflow/react`. Definido una sola vez a nivel de
 * módulo (no dentro del componente `Canvas`), por el mismo motivo que
 * `nodeTypes` en `nodes/nodeTypes.tsx`: una referencia inestable entre
 * renders dispara el aviso `error002` de la librería.
 */
export const edgeTypes = {
  [BRUNCH_EDGE_TYPE]: BrunchEdge,
}
