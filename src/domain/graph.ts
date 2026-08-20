import { produce } from 'immer'
import type { ProjectDocument } from './schemas'

/**
 * Arista derivada del grafo, propia del dominio y sin dependencia de
 * `@xyflow/react`. La capa de edición (fase posterior) la traducirá al tipo
 * `Edge` de React Flow.
 */
export interface Edge {
  id: string
  source: string
  target: string
  /** Para aristas de decision: id de la respuesta que origina la arista. */
  sourceHandle?: string
  /** Para aristas de decision: letra (A/B/C/D) de la respuesta. */
  label?: string
}

/**
 * Deriva las aristas visuales del grafo a partir del estado actual del
 * proyecto. Pura, no depende del store ni de bibliotecas de UI.
 */
export function deriveEdges(project: ProjectDocument): Edge[] {
  const edges: Edge[] = []

  for (const node of project.graph.nodes) {
    if (node.type === 'start' || node.type === 'content') {
      if (node.targetNodeId) {
        edges.push({
          id: `${node.id}->${node.targetNodeId}`,
          source: node.id,
          target: node.targetNodeId,
        })
      }
    } else if (node.type === 'decision') {
      for (const response of node.responses) {
        if (response.targetNodeId) {
          edges.push({
            id: `${node.id}:${response.id}->${response.targetNodeId}`,
            source: node.id,
            target: response.targetNodeId,
            sourceHandle: response.id,
            label: response.letter,
          })
        }
      }
    }
    // Los nodos 'final' no tienen salida: no generan aristas.
  }

  return edges
}

function assertNodeExists(project: ProjectDocument, nodeId: string): void {
  if (!project.graph.nodes.some((node) => node.id === nodeId)) {
    throw new Error(`No existe un nodo con id "${nodeId}".`)
  }
}

/**
 * Conecta la salida de un nodo a un destino.
 *
 * - Para nodos `start`/`content`: conecta su única salida; `responseId` debe
 *   omitirse.
 * - Para nodos `decision`: `responseId` es obligatorio e identifica la
 *   respuesta cuya salida se conecta.
 * - Los nodos `final` no tienen salida y no se pueden usar como origen.
 */
export function connect(
  project: ProjectDocument,
  sourceNodeId: string,
  targetNodeId: string,
  responseId?: string,
): ProjectDocument {
  assertNodeExists(project, targetNodeId)
  const source = project.graph.nodes.find((node) => node.id === sourceNodeId)
  if (!source) {
    throw new Error(`No existe un nodo con id "${sourceNodeId}".`)
  }

  if (source.type === 'final') {
    throw new Error('Un nodo "final" no tiene salida; no se puede conectar.')
  }

  if (source.type === 'decision') {
    if (!responseId) {
      throw new Error('Conectar un nodo "decision" requiere indicar "responseId".')
    }
    if (!source.responses.some((response) => response.id === responseId)) {
      throw new Error(`El nodo "${sourceNodeId}" no tiene una respuesta con id "${responseId}".`)
    }
  } else if (responseId) {
    throw new Error(`El nodo "${sourceNodeId}" no admite "responseId" (solo tiene una salida).`)
  }

  return produce(project, (draft) => {
    const draftSource = draft.graph.nodes.find((node) => node.id === sourceNodeId)
    if (!draftSource) return

    if (draftSource.type === 'start' || draftSource.type === 'content') {
      draftSource.targetNodeId = targetNodeId
    } else if (draftSource.type === 'decision' && responseId) {
      const response = draftSource.responses.find((candidate) => candidate.id === responseId)
      if (response) {
        response.targetNodeId = targetNodeId
      }
    }

    draft.metadata.updatedAt = new Date().toISOString()
  })
}

/**
 * Desconecta la salida de un nodo (o de una respuesta concreta de un nodo
 * decision), dejando el/los `targetNodeId` correspondientes en `undefined`.
 */
export function disconnect(
  project: ProjectDocument,
  sourceNodeId: string,
  responseId?: string,
): ProjectDocument {
  const source = project.graph.nodes.find((node) => node.id === sourceNodeId)
  if (!source) {
    throw new Error(`No existe un nodo con id "${sourceNodeId}".`)
  }

  if (source.type === 'final') {
    throw new Error('Un nodo "final" no tiene salida; no hay nada que desconectar.')
  }

  if (source.type === 'decision') {
    if (!responseId) {
      throw new Error('Desconectar un nodo "decision" requiere indicar "responseId".')
    }
    if (!source.responses.some((response) => response.id === responseId)) {
      throw new Error(`El nodo "${sourceNodeId}" no tiene una respuesta con id "${responseId}".`)
    }
  } else if (responseId) {
    throw new Error(`El nodo "${sourceNodeId}" no admite "responseId" (solo tiene una salida).`)
  }

  return produce(project, (draft) => {
    const draftSource = draft.graph.nodes.find((node) => node.id === sourceNodeId)
    if (!draftSource) return

    if (draftSource.type === 'start' || draftSource.type === 'content') {
      draftSource.targetNodeId = undefined
    } else if (draftSource.type === 'decision' && responseId) {
      const response = draftSource.responses.find((candidate) => candidate.id === responseId)
      if (response) {
        response.targetNodeId = undefined
      }
    }

    draft.metadata.updatedAt = new Date().toISOString()
  })
}
