import { produce } from 'immer'
import { createId, nextNodeNumber } from './id'
import { connect } from './graph'
import { DEFAULT_CONTENT_ORDER } from './schemas'
import type {
  ContentOrder,
  FinalNode,
  Node,
  NodePosition,
  NodeType,
  ProjectDocument,
  SlideNode,
} from './schemas'

/** Campos editables al crear un nodo (aparte de tipo y posición). */
export interface CreateNodeExtra {
  title?: string
  body?: string
}

/**
 * Campos editables mediante `updateNode` (título/body y afines básicos).
 *
 * Semántica de "patch" para `audioAssetId`/`continueLabel`/`internalNote`:
 * `undefined` no toca el campo, `null` lo borra (lo deja `undefined` en el
 * nodo — para `continueLabel` eso significa "vuelve al texto por defecto",
 * ver `DEFAULT_CONTINUE_LABEL`) y un string lo fija a ese valor.
 *
 * `imageAssetIds`, si se indica, REEMPLAZA la lista completa (no es un patch
 * incremental): quien llama es responsable de construir el array final
 * (añadir/quitar/reordenar una imagen concreta se hace leyendo la lista
 * actual del nodo y llamando con la lista ya modificada).
 *
 * `imageAssetIds`/`audioAssetId`/`continueLabel`/`contentOrder` solo aplican
 * a nodos `slide`: un `final` con alguno de estos campos presente en el
 * patch (aunque sea `null`) hace que `updateNode` lance, ver más abajo.
 * `internalNote` es válido en cualquier tipo de nodo (incluidos los
 * `final`), así que no participa de esa guarda.
 */
export interface UpdateNodePatch {
  title?: string
  body?: string
  imageAssetIds?: string[]
  audioAssetId?: string | null
  continueLabel?: string | null
  contentOrder?: ContentOrder
  internalNote?: string | null
}

function newSlideNode(
  common: { id: string; number: number; position: NodePosition; title: string; body: string },
): SlideNode {
  return {
    ...common,
    type: 'slide',
    targetNodeId: undefined,
    continueLabel: undefined,
    responses: [],
    imageAssetIds: [],
    audioAssetId: undefined,
    contentOrder: DEFAULT_CONTENT_ORDER,
  }
}

/**
 * Crea un `ProjectDocument` nuevo con metadata coherente y una única
 * diapositiva automática (número visible 1, posición de origen), que además
 * es el punto de partida del recorrido (`graph.startNodeId`).
 *
 * Ya no existe un nodo "Inicio" separado e invisible: la primera
 * diapositiva del proyecto ES el inicio.
 */
export function createProject(name: string): ProjectDocument {
  const now = new Date().toISOString()
  const startSlide = newSlideNode({
    id: createId(),
    number: 1,
    position: { x: 0, y: 0 },
    title: '',
    body: '',
  })

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
      nodes: [startSlide],
      startNodeId: startSlide.id,
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
 * Una diapositiva nueva nace SIN respuestas: se comporta como "de
 * continuar" (un único destino, `targetNodeId`) hasta que se le añade la
 * primera respuesta desde el Inspector (ver `addResponse`), momento en el
 * que pasa a comportarse como decisión. Ya no hay ninguna guarda de
 * "segundo nodo start" porque el tipo `start` no existe; lo que sí sigue
 * siendo imposible es crear un tipo inexistente (lo impide el tipado de
 * `NodeType`, y el `switch` es exhaustivo).
 */
export function createNode(
  project: ProjectDocument,
  type: NodeType,
  position: NodePosition,
  extra: CreateNodeExtra = {},
): ProjectDocument {
  const number = nextNodeNumber(project.graph.nodes.map((node) => node.number))
  const title = extra.title ?? ''
  const body = extra.body ?? ''
  const common = { id: createId(), number, position, title, body }

  let newNode: Node
  switch (type) {
    case 'slide': {
      newNode = newSlideNode(common)
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
 * `targetNodeId` de cualquier diapositiva, y el `targetNodeId` de cualquier
 * respuesta, que apuntaran al nodo borrado quedan en `undefined`. Lanza
 * `Error` si el nodo no existe.
 *
 * Guarda de dominio: nunca se puede eliminar la diapositiva de inicio
 * (`graph.startNodeId`). No hay forma de reasignar el punto de partida a
 * otra diapositiva, así que permitirlo dejaría el proyecto sin inicio y en
 * un estado del que no se puede salir por la vía interactiva normal. Lanza
 * `Error` en vez de ignorar la petición en silencio, mismo criterio que el
 * resto de guardas de esta función.
 */
export function deleteNode(project: ProjectDocument, nodeId: string): ProjectDocument {
  const index = findNodeIndex(project, nodeId)
  if (index === -1) {
    throw new Error(`No existe un nodo con id "${nodeId}".`)
  }
  if (nodeId === project.graph.startNodeId) {
    throw new Error('No se puede eliminar la diapositiva de inicio del proyecto.')
  }

  return produce(project, (draft) => {
    draft.graph.nodes = draft.graph.nodes.filter((node) => node.id !== nodeId)

    for (const node of draft.graph.nodes) {
      if (node.type !== 'slide') continue
      if (node.targetNodeId === nodeId) {
        node.targetNodeId = undefined
      }
      for (const response of node.responses) {
        if (response.targetNodeId === nodeId) {
          response.targetNodeId = undefined
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

/** Un movimiento individual dentro de un `moveNodes`. */
export interface NodeMove {
  nodeId: string
  position: NodePosition
}

/**
 * Mueve varios nodos a la vez en una única operación de dominio (un único
 * `produce` de immer). Pensada para el arrastre de una selección múltiple en
 * el lienzo: llamar a `moveNode` una vez por nodo generaría una entrada de
 * historial por nodo en el store, deshaciendo el gesto "arrastrar N nodos
 * seleccionados" en N pasos de `undo` en vez de uno.
 *
 * Valida que todos los ids existan ANTES de mutar nada (así, si alguno no
 * existe, no se aplica ningún movimiento parcial) y lanza `Error` si falta
 * alguno — mismo criterio que `moveNode`.
 */
export function moveNodes(project: ProjectDocument, moves: NodeMove[]): ProjectDocument {
  for (const move of moves) {
    if (findNodeIndex(project, move.nodeId) === -1) {
      throw new Error(`No existe un nodo con id "${move.nodeId}".`)
    }
  }

  return produce(project, (draft) => {
    for (const move of moves) {
      const node = draft.graph.nodes.find((candidate) => candidate.id === move.nodeId)
      if (node) {
        node.position = move.position
      }
    }
    touchUpdatedAt(draft)
  })
}

/**
 * Actualiza campos editables básicos de un nodo (título/body/adjuntos de
 * media/texto del botón de continuar). No permite cambiar `type`, `id`,
 * `number` ni campos estructurales (responses, targetNodeId) — para eso
 * existen funciones dedicadas.
 *
 * `imageAssetIds`/`audioAssetId`/`continueLabel`/`contentOrder` solo son
 * válidos en nodos `slide`: si el patch los incluye (aunque sea con valor
 * `null` para los que admiten borrado) y el nodo es `final`, lanza `Error`
 * — un Final no admite media adjunta, botón de continuar ni orden de
 * contenido. `internalNote` es válido en cualquier tipo de nodo y no
 * participa de esta guarda.
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

  const node = project.graph.nodes[index]
  const setsSlideOnlyField =
    patch.imageAssetIds !== undefined ||
    patch.audioAssetId !== undefined ||
    patch.continueLabel !== undefined ||
    patch.contentOrder !== undefined
  if (setsSlideOnlyField && node && node.type !== 'slide') {
    throw new Error(
      `El nodo "${nodeId}" es de tipo "${node.type}" y no admite imagen/audio adjuntos, texto de continuar ni orden de contenido.`,
    )
  }

  return produce(project, (draft) => {
    const draftNode = draft.graph.nodes[index]
    if (!draftNode) return
    if (patch.title !== undefined) draftNode.title = patch.title
    if (patch.body !== undefined) draftNode.body = patch.body
    if (patch.internalNote !== undefined) {
      draftNode.internalNote = patch.internalNote === null ? undefined : patch.internalNote
    }
    if (draftNode.type === 'slide') {
      if (patch.imageAssetIds !== undefined) {
        draftNode.imageAssetIds = patch.imageAssetIds
      }
      if (patch.audioAssetId !== undefined) {
        draftNode.audioAssetId = patch.audioAssetId === null ? undefined : patch.audioAssetId
      }
      if (patch.continueLabel !== undefined) {
        draftNode.continueLabel = patch.continueLabel === null ? undefined : patch.continueLabel
      }
      if (patch.contentOrder !== undefined) {
        draftNode.contentOrder = patch.contentOrder
      }
    }
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
 * elegir qué crear": sin esta función, el store tendría que encadenar
 * `createNode` + `connect` como dos llamadas independientes, lo que en el
 * diseño actual del store (cada acción de dominio empuja una entrada a
 * `history.past`) generaría dos entradas de historial deshacibles por
 * separado en vez de una única acción percibida por el usuario.
 *
 * Internamente llama a `createNode` y después a `connect` sobre su
 * resultado. El `nodeId` devuelto se obtiene comparando los ids de nodo
 * antes/después de `createNode` (el único nodo nuevo es el que no estaba en
 * el conjunto anterior) — deliberadamente no "el nodo de mayor `number`":
 * esa heurística deja de ser correcta en cuanto haya habido borrados o, en
 * el futuro, reordenaciones, mientras que comparar por id es correcto sea
 * cual sea el estado previo del proyecto.
 *
 * Si `sourceNodeId`/`sourceResponseId` no describen una combinación válida
 * (nodo inexistente, `sourceResponseId` que no pertenece al nodo de origen,
 * origen de tipo `final`...), `connect` lanza y esta función propaga el
 * error sin capturarlo — igual que el resto de funciones de dominio.
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
