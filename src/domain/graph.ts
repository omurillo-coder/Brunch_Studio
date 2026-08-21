import { produce } from 'immer'
import type { ProjectDocument } from './schemas'

/**
 * Arista derivada del grafo, propia del dominio y sin dependencia de
 * `@xyflow/react`. La capa de edición la traduce al tipo `Edge` de React
 * Flow (ver `src/editor/Canvas/adapter.ts`).
 *
 * Nota: deliberadamente no lleva ninguna etiqueta de texto. Las aristas de
 * respuesta mostraban antes la letra (A/B/C/D) sobre la línea de conexión;
 * las letras ya no se muestran nunca al usuario (son un detalle interno de
 * ordenación, ver `RESPONSE_LETTERS`), así que la arista tampoco las
 * transporta.
 */
export interface Edge {
  id: string
  source: string
  target: string
  /** Para aristas de respuesta: id de la respuesta que origina la arista. */
  sourceHandle?: string
}

/**
 * Deriva las aristas visuales del grafo a partir del estado actual del
 * proyecto. Pura, no depende del store ni de bibliotecas de UI.
 *
 * Para una diapositiva:
 * - Con respuestas (`responses.length > 0`): una arista por cada respuesta
 *   que tenga destino.
 * - Sin respuestas: una única arista desde su `targetNodeId`, si lo tiene.
 *
 * Los nodos `final` no tienen salida: no generan aristas.
 */
export function deriveEdges(project: ProjectDocument): Edge[] {
  const edges: Edge[] = []

  for (const node of project.graph.nodes) {
    if (node.type !== 'slide') continue

    if (node.responses.length > 0) {
      for (const response of node.responses) {
        if (response.targetNodeId) {
          edges.push({
            id: `${node.id}:${response.id}->${response.targetNodeId}`,
            source: node.id,
            target: response.targetNodeId,
            sourceHandle: response.id,
          })
        }
      }
    } else if (node.targetNodeId) {
      edges.push({
        id: `${node.id}->${node.targetNodeId}`,
        source: node.id,
        target: node.targetNodeId,
      })
    }
  }

  return edges
}

function assertNodeExists(project: ProjectDocument, nodeId: string): void {
  if (!project.graph.nodes.some((node) => node.id === nodeId)) {
    throw new Error(`No existe un nodo con id "${nodeId}".`)
  }
}

/**
 * Localiza la diapositiva de origen de un `connect`/`disconnect` y valida
 * que la combinación nodo/respuesta sea coherente. Lanza `Error` con un
 * mensaje explícito en cualquier caso inválido, igual que el resto del
 * dominio.
 */
function assertConnectableSource(
  project: ProjectDocument,
  sourceNodeId: string,
  responseId: string | undefined,
): void {
  const source = project.graph.nodes.find((node) => node.id === sourceNodeId)
  if (!source) {
    throw new Error(`No existe un nodo con id "${sourceNodeId}".`)
  }
  if (source.type !== 'slide') {
    throw new Error('Un nodo "final" no tiene salida; no se puede conectar.')
  }
  if (responseId && !source.responses.some((response) => response.id === responseId)) {
    throw new Error(`El nodo "${sourceNodeId}" no tiene una respuesta con id "${responseId}".`)
  }
}

/**
 * Conecta una salida de una diapositiva a un destino.
 *
 * - Con `responseId`: conecta el destino de esa respuesta concreta.
 * - Sin `responseId`: conecta el destino general de la diapositiva
 *   (`targetNodeId`, el de "Continuar").
 * - Los nodos `final` no tienen salida y no se pueden usar como origen.
 */
export function connect(
  project: ProjectDocument,
  sourceNodeId: string,
  targetNodeId: string,
  responseId?: string,
): ProjectDocument {
  assertNodeExists(project, targetNodeId)
  assertConnectableSource(project, sourceNodeId, responseId)

  return produce(project, (draft) => {
    const draftSource = draft.graph.nodes.find((node) => node.id === sourceNodeId)
    if (!draftSource || draftSource.type !== 'slide') return

    if (responseId) {
      const response = draftSource.responses.find((candidate) => candidate.id === responseId)
      if (response) {
        response.targetNodeId = targetNodeId
      }
    } else {
      draftSource.targetNodeId = targetNodeId
    }

    draft.metadata.updatedAt = new Date().toISOString()
  })
}

/**
 * Desconecta una salida de una diapositiva (la de una respuesta concreta si
 * se indica `responseId`, o la general de "Continuar" si no), dejando el
 * `targetNodeId` correspondiente en `undefined`.
 */
export function disconnect(
  project: ProjectDocument,
  sourceNodeId: string,
  responseId?: string,
): ProjectDocument {
  assertConnectableSource(project, sourceNodeId, responseId)

  return produce(project, (draft) => {
    const draftSource = draft.graph.nodes.find((node) => node.id === sourceNodeId)
    if (!draftSource || draftSource.type !== 'slide') return

    if (responseId) {
      const response = draftSource.responses.find((candidate) => candidate.id === responseId)
      if (response) {
        response.targetNodeId = undefined
      }
    } else {
      draftSource.targetNodeId = undefined
    }

    draft.metadata.updatedAt = new Date().toISOString()
  })
}
