import type { Edge as XyEdge, Node as XyNode } from '@xyflow/react'
import { deriveEdges } from '../../domain'
import type { Node as DomainNode, NodeType, ProjectDocument } from '../../domain'
import { IN_HANDLE_ID, OUT_HANDLE_ID, parseResponseHandleId, responseHandleId } from './handles'

/**
 * Adaptador dominio → `@xyflow/react`.
 *
 * Funciones puras y testeables sin montar el lienzo. `@xyflow/react` nunca
 * es una segunda fuente de verdad: estas funciones se llaman en cada render
 * del componente `Canvas` a partir de `project` (posiciones, tipos,
 * respuestas) y `deriveEdges` de dominio (aristas) + la selección actual del
 * store (transitoria, no forma parte del documento). El resultado se pasa
 * tal cual a las props `nodes`/`edges` de `<ReactFlow>`.
 */

/** Resumen de una respuesta de un nodo decision, para pintar en el nodo. */
export interface CanvasResponseSummary {
  id: string
  letter: string
  text: string
}

/** Datos que lleva cada nodo de `@xyflow/react` en su campo `data`. */
export interface CanvasNodeData extends Record<string, unknown> {
  nodeType: NodeType
  number: number
  title: string
  /** Solo presente en nodos `decision`. */
  responses?: CanvasResponseSummary[]
}

export type CanvasFlowNode = XyNode<CanvasNodeData>
export type CanvasFlowEdge = XyEdge

function toNodeData(node: DomainNode): CanvasNodeData {
  const base: CanvasNodeData = {
    nodeType: node.type,
    number: node.number,
    title: node.title,
  }
  if (node.type === 'decision') {
    base.responses = node.responses.map((response) => ({
      id: response.id,
      letter: response.letter,
      text: response.text,
    }))
  }
  return base
}

/**
 * Mapea los nodos de dominio a nodos de `@xyflow/react`.
 *
 * `selectedNodeIds` alimenta el campo `selected` de cada nodo. Esto no crea
 * una segunda fuente de verdad (sigue derivándose de `store.selection` en
 * cada render) y es necesario para que la selección se vea reflejada
 * visualmente en el lienzo cuando cambia por una vía distinta al propio
 * gesto de selección de `@xyflow/react` (p.ej. `focusNode` desde
 * `LeftPanel`) — como el lienzo es "controlado" (no usa `onNodesChange`),
 * sin este campo el resaltado de selección no sobreviviría a un re-render
 * no relacionado.
 */
export function toFlowNodes(
  project: ProjectDocument,
  selectedNodeIds: readonly string[],
): CanvasFlowNode[] {
  const selected = new Set(selectedNodeIds)
  return project.graph.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    selected: selected.has(node.id),
    data: toNodeData(node),
  }))
}

/**
 * Mapea las aristas derivadas de dominio (`deriveEdges`) a aristas de
 * `@xyflow/react`. El `sourceHandle` de dominio es el `responseId` "pelado"
 * (o `undefined` para start/content); aquí se traduce al id de handle real
 * usado por los nodos personalizados (`response:<id>` u `OUT_HANDLE_ID`).
 */
export function toFlowEdges(project: ProjectDocument): CanvasFlowEdge[] {
  return deriveEdges(project).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ? responseHandleId(edge.sourceHandle) : OUT_HANDLE_ID,
    targetHandle: IN_HANDLE_ID,
    label: edge.label,
  }))
}

/** Argumentos resueltos para `store.connect` a partir de un `onConnect`. */
export interface ResolvedConnection {
  sourceNodeId: string
  targetNodeId: string
  responseId?: string
}

/**
 * Resuelve los parámetros de `onConnect` de `@xyflow/react` (que pueden
 * llevar `source`/`target` nulos según su propio tipado) a los argumentos
 * que espera `store.connect`, derivando `responseId` del `sourceHandle`
 * cuando tiene el prefijo `response:`. Devuelve `null` si faltan `source` o
 * `target` (conexión incompleta; no debería ocurrir en la práctica, pero el
 * tipo de `@xyflow/react` los declara opcionales).
 */
export function resolveConnection(params: {
  source?: string | null
  target?: string | null
  sourceHandle?: string | null
}): ResolvedConnection | null {
  if (!params.source || !params.target) return null
  return {
    sourceNodeId: params.source,
    targetNodeId: params.target,
    responseId: parseResponseHandleId(params.sourceHandle),
  }
}
