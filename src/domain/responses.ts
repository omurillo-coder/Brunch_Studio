import { produce } from 'immer'
import { createId } from './id'
import { RESPONSE_LETTERS } from './schemas'
import type { DecisionResponse, ProjectDocument } from './schemas'

function findDecisionNode(project: ProjectDocument, nodeId: string) {
  const node = project.graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    throw new Error(`No existe un nodo con id "${nodeId}".`)
  }
  if (node.type !== 'decision') {
    throw new Error(`El nodo "${nodeId}" no es de tipo "decision".`)
  }
  return node
}

/**
 * Añade una respuesta nueva a un nodo decision, usando la siguiente letra
 * libre en orden A → B → C → D (si se borró una letra intermedia, se
 * reutiliza antes de continuar con letras posteriores). Lanza `Error` si el
 * nodo ya tiene 4 respuestas.
 */
export function addResponse(project: ProjectDocument, decisionNodeId: string): ProjectDocument {
  const node = findDecisionNode(project, decisionNodeId)

  const usedLetters = new Set(node.responses.map((response) => response.letter))
  const freeLetter = RESPONSE_LETTERS.find((letter) => !usedLetters.has(letter))
  if (!freeLetter) {
    throw new Error('Un nodo decision no puede tener más de 4 respuestas.')
  }

  const newResponse: DecisionResponse = {
    id: createId(),
    letter: freeLetter,
    text: '',
    imageAssetId: undefined,
    audioAssetId: undefined,
    points: undefined,
    targetNodeId: undefined,
  }

  return produce(project, (draft) => {
    const draftNode = draft.graph.nodes.find((candidate) => candidate.id === decisionNodeId)
    if (draftNode && draftNode.type === 'decision') {
      draftNode.responses.push(newResponse)
    }
    draft.metadata.updatedAt = new Date().toISOString()
  })
}

/**
 * Elimina una respuesta de un nodo decision. Las respuestas restantes
 * conservan su id/letra/orden relativo — no se reindexan letras.
 */
/**
 * Campos editables de una respuesta ya creada mediante `updateResponse`. El
 * destino (`targetNodeId`) tiene su propio mecanismo dedicado vía
 * `connect`/`disconnect` y no se toca aquí.
 *
 * Semántica de "patch" para `points`/`imageAssetId`/`audioAssetId`:
 * `undefined` no toca el campo, `null` lo borra (lo deja `undefined` en la
 * respuesta) y un valor lo fija a ese valor/id. `points` acepta cualquier
 * `number` (positivo, negativo o cero); no hay restricción de rango.
 */
export interface UpdateResponsePatch {
  text?: string
  points?: number | null
  imageAssetId?: string | null
  audioAssetId?: string | null
}

/**
 * Actualiza campos editables básicos de una respuesta ya existente de un
 * nodo decision (texto, puntuación, imagen/audio adjuntos). Análoga a
 * `updateNode` pero a nivel de respuesta. Lanza `Error` si el nodo no
 * existe, no es `decision`, o la respuesta no existe.
 */
export function updateResponse(
  project: ProjectDocument,
  decisionNodeId: string,
  responseId: string,
  patch: UpdateResponsePatch,
): ProjectDocument {
  const node = findDecisionNode(project, decisionNodeId)
  if (!node.responses.some((response) => response.id === responseId)) {
    throw new Error(`El nodo "${decisionNodeId}" no tiene una respuesta con id "${responseId}".`)
  }

  return produce(project, (draft) => {
    const draftNode = draft.graph.nodes.find((candidate) => candidate.id === decisionNodeId)
    if (draftNode && draftNode.type === 'decision') {
      const response = draftNode.responses.find((candidate) => candidate.id === responseId)
      if (response) {
        if (patch.text !== undefined) {
          response.text = patch.text
        }
        if (patch.points !== undefined) {
          response.points = patch.points === null ? undefined : patch.points
        }
        if (patch.imageAssetId !== undefined) {
          response.imageAssetId = patch.imageAssetId === null ? undefined : patch.imageAssetId
        }
        if (patch.audioAssetId !== undefined) {
          response.audioAssetId = patch.audioAssetId === null ? undefined : patch.audioAssetId
        }
      }
    }
    draft.metadata.updatedAt = new Date().toISOString()
  })
}

export function removeResponse(
  project: ProjectDocument,
  decisionNodeId: string,
  responseId: string,
): ProjectDocument {
  const node = findDecisionNode(project, decisionNodeId)
  if (!node.responses.some((response) => response.id === responseId)) {
    throw new Error(`El nodo "${decisionNodeId}" no tiene una respuesta con id "${responseId}".`)
  }

  return produce(project, (draft) => {
    const draftNode = draft.graph.nodes.find((candidate) => candidate.id === decisionNodeId)
    if (draftNode && draftNode.type === 'decision') {
      draftNode.responses = draftNode.responses.filter((response) => response.id !== responseId)
    }
    draft.metadata.updatedAt = new Date().toISOString()
  })
}
