import { produce } from 'immer'
import { createId, nextNodeNumber } from './id'
import type {
  ContentNode,
  DecisionNode,
  FinalNode,
  Node,
  NodePosition,
  NodeType,
  ProjectDocument,
  StartNode,
} from './schemas'

/** Campos editables al crear un nodo (aparte de tipo y posición). */
export interface CreateNodeExtra {
  title?: string
  body?: string
}

/** Campos editables mediante `updateNode` (título/body y afines básicos). */
export interface UpdateNodePatch {
  title?: string
  body?: string
}

/**
 * Crea un `ProjectDocument` nuevo con metadata coherente y un único nodo
 * `start` automático (número visible 1, posición de origen).
 */
export function createProject(name: string): ProjectDocument {
  const now = new Date().toISOString()
  const startNode: StartNode = {
    id: createId(),
    number: 1,
    type: 'start',
    position: { x: 0, y: 0 },
    title: '',
    body: '',
    targetNodeId: undefined,
  }

  return {
    schemaVersion: 1,
    metadata: {
      id: createId(),
      name,
      createdAt: now,
      updatedAt: now,
    },
    settings: {},
    graph: {
      nodes: [startNode],
    },
    editor: {
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  }
}

function touchUpdatedAt(project: ProjectDocument): void {
  project.metadata.updatedAt = new Date().toISOString()
}

function findNodeIndex(project: ProjectDocument, nodeId: string): number {
  return project.graph.nodes.findIndex((node) => node.id === nodeId)
}

/**
 * Crea y añade un nodo nuevo al proyecto.
 *
 * Decisión de diseño: solo puede existir un nodo `start` por proyecto. Si ya
 * existe uno y se solicita crear otro, esta función lanza un `Error` en vez
 * de ignorar la petición silenciosamente o degradar el tipo — así la capa
 * que la invoque (futuro store) puede capturarlo y mostrar un mensaje claro
 * en vez de que el grafo quede en un estado inconsistente sin que nadie se
 * entere.
 */
export function createNode(
  project: ProjectDocument,
  type: NodeType,
  position: NodePosition,
  extra: CreateNodeExtra = {},
): ProjectDocument {
  if (type === 'start' && project.graph.nodes.some((node) => node.type === 'start')) {
    throw new Error('Ya existe un nodo de tipo "start" en este proyecto; no se puede crear otro.')
  }

  const number = nextNodeNumber(project.graph.nodes.map((node) => node.number))
  const title = extra.title ?? ''
  const body = extra.body ?? ''
  const common = { id: createId(), number, position, title, body }

  let newNode: Node
  switch (type) {
    case 'start': {
      const node: StartNode = { ...common, type: 'start', targetNodeId: undefined }
      newNode = node
      break
    }
    case 'content': {
      const node: ContentNode = { ...common, type: 'content', targetNodeId: undefined }
      newNode = node
      break
    }
    case 'decision': {
      const node: DecisionNode = { ...common, type: 'decision', responses: [] }
      newNode = node
      break
    }
    case 'final': {
      const node: FinalNode = { ...common, type: 'final' }
      newNode = node
      break
    }
  }

  return produce(project, (draft) => {
    draft.graph.nodes.push(newNode)
    touchUpdatedAt(draft)
  })
}

/**
 * Elimina un nodo y limpia cualquier referencia entrante hacia él: el
 * `targetNodeId` de nodos start/content, y el `targetNodeId` de cualquier
 * respuesta de nodos decision que apuntara al nodo borrado, quedan en
 * `undefined`. Lanza `Error` si el nodo no existe.
 */
export function deleteNode(project: ProjectDocument, nodeId: string): ProjectDocument {
  if (findNodeIndex(project, nodeId) === -1) {
    throw new Error(`No existe un nodo con id "${nodeId}".`)
  }

  return produce(project, (draft) => {
    draft.graph.nodes = draft.graph.nodes.filter((node) => node.id !== nodeId)

    for (const node of draft.graph.nodes) {
      if (node.type === 'start' || node.type === 'content') {
        if (node.targetNodeId === nodeId) {
          node.targetNodeId = undefined
        }
      } else if (node.type === 'decision') {
        for (const response of node.responses) {
          if (response.targetNodeId === nodeId) {
            response.targetNodeId = undefined
          }
        }
      }
    }

    touchUpdatedAt(draft)
  })
}

/** Mueve un nodo a una nueva posición del lienzo. */
export function moveNode(
  project: ProjectDocument,
  nodeId: string,
  position: NodePosition,
): ProjectDocument {
  const index = findNodeIndex(project, nodeId)
  if (index === -1) {
    throw new Error(`No existe un nodo con id "${nodeId}".`)
  }

  return produce(project, (draft) => {
    const node = draft.graph.nodes[index]
    if (node) {
      node.position = position
    }
    touchUpdatedAt(draft)
  })
}

/**
 * Actualiza campos editables básicos de un nodo (título/body). No permite
 * cambiar `type`, `id`, `number` ni campos estructurales (responses,
 * targetNodeId) — para eso existen funciones dedicadas.
 */
export function updateNode(
  project: ProjectDocument,
  nodeId: string,
  patch: UpdateNodePatch,
): ProjectDocument {
  const index = findNodeIndex(project, nodeId)
  if (index === -1) {
    throw new Error(`No existe un nodo con id "${nodeId}".`)
  }

  return produce(project, (draft) => {
    const node = draft.graph.nodes[index]
    if (!node) return
    if (patch.title !== undefined) node.title = patch.title
    if (patch.body !== undefined) node.body = patch.body
    touchUpdatedAt(draft)
  })
}
