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
