import { produce } from 'immer'
import { createId, nextNodeNumber } from './id'
import { addResponse } from './responses'
import { connect } from './graph'
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

  const withNode = produce(project, (draft) => {
    draft.graph.nodes.push(newNode)
    touchUpdatedAt(draft)
  })

  // Spec de producto: "Una decisión nueva debe empezar de forma intuitiva,
  // preferiblemente con respuestas A y B [...]. Nunca debe existir E." Por
  // eso un nodo decision nunca nace con `responses: []`: se le añaden A y B
  // de inmediato reutilizando `addResponse` (mismo criterio de
  // generación de id/letra que usa el resto del dominio, sin duplicarlo).
  if (type === 'decision') {
    return addResponse(addResponse(withNode, newNode.id), newNode.id)
  }

  return withNode
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

/** Resultado de `createConnectedNode`: el documento resultante más el id del
 *  nodo recién creado (para poder seleccionarlo de inmediato sin recurrir a
 *  heurísticas como "el de mayor `number`"). */
export interface CreateConnectedNodeResult {
  project: ProjectDocument
  nodeId: string
}

/**
 * Crea un nodo nuevo y lo conecta a un nodo/respuesta de origen en una sola
 * operación de dominio.
 *
 * Pensada para el flujo "arrastrar una conexión hasta el vacío del lienzo y
 * elegir qué crear" (fase 7): sin esta función, el store tendría que
 * encadenar `createNode` + `connect` como dos llamadas independientes, lo
 * que en el diseño actual del store (cada acción de dominio empuja una
 * entrada a `history.past`) generaría dos entradas de historial deshacibles
 * por separado en vez de una única acción percibida por el usuario.
 *
 * Internamente llama a `createNode` y después a `connect` sobre su
 * resultado. El `nodeId` devuelto se obtiene comparando los ids de nodo
 * antes/después de `createNode` (el único nodo nuevo es el que no estaba en
 * el conjunto anterior) — deliberadamente no "el nodo de mayor `number`"
 * (atajo que sí usa hoy `LeftPanel`): esa heurística deja de ser correcta en
 * cuanto haya habido borrados o, en el futuro, reordenaciones, mientras que
 * comparar por id es correcto sea cual sea el estado previo del proyecto.
 *
 * Si `sourceNodeId`/`sourceResponseId` no describen una combinación válida
 * (nodo inexistente, `sourceResponseId` obligatorio y ausente para un
 * `decision`, etc.), `connect` lanza y esta función propaga el error sin
 * capturarlo — igual que el resto de funciones de dominio (`createNode`,
 * `deleteNode`...) ya hacen para sus propias combinaciones inválidas. En la
 * práctica no debería ocurrir cuando el origen se deriva de un handle real
 * de un nodo existente (ver `resolveEmptyPaneDrop` en la capa de edición),
 * pero no se enmascara el fallo por si esa invariante se rompiera.
 */
export function createConnectedNode(
  project: ProjectDocument,
  type: NodeType,
  position: NodePosition,
  sourceNodeId: string,
  sourceResponseId?: string,
): CreateConnectedNodeResult {
  const existingIds = new Set(project.graph.nodes.map((node) => node.id))
  const withNewNode = createNode(project, type, position)
  const newNode = withNewNode.graph.nodes.find((node) => !existingIds.has(node.id))
  if (!newNode) {
    // No debería ocurrir nunca: `createNode` siempre añade exactamente un
    // nodo con un id nuevo salvo que lance. Se cubre de todos modos para no
    // dejar pasar un `undefined` silencioso hacia `connect`.
    throw new Error('createConnectedNode: no se pudo identificar el nodo recién creado.')
  }

  const connected = connect(withNewNode, sourceNodeId, newNode.id, sourceResponseId)
  return { project: connected, nodeId: newNode.id }
}
