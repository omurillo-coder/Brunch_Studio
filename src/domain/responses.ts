import { produce } from 'immer'
import { createId } from './id'
import { RESPONSE_LETTERS } from './schemas'
import type {
  DecisionResponse,
  ProjectDocument,
  SlideNode,
  VariableCondition,
  VariableEffect,
} from './schemas'

/**
 * Localiza la diapositiva sobre la que operan las funciones de respuesta.
 * Lanza `Error` si el nodo no existe o no es una diapositiva (un `final` no
 * puede tener respuestas).
 */
function findSlideNode(project: ProjectDocument, nodeId: string): SlideNode {
  const node = project.graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    throw new Error(`No existe un nodo con id "${nodeId}".`)
  }
  if (node.type !== 'slide') {
    throw new Error(`El nodo "${nodeId}" no es de tipo "slide".`)
  }
  return node
}

/**
 * Añade una respuesta nueva a una diapositiva, usando la siguiente letra
 * libre en orden A → B → C → D (si se borró una letra intermedia, se
 * reutiliza antes de continuar con letras posteriores). Lanza `Error` si la
 * diapositiva ya tiene 4 respuestas.
 *
 * Añadir la primera respuesta es lo que convierte una diapositiva "de
 * continuar" en una de decisión. Deliberadamente NO se borra su
 * `targetNodeId`/`continueLabel`: quedan dormidos y vuelven a tener efecto
 * si más tarde se eliminan todas las respuestas.
 */
export function addResponse(project: ProjectDocument, slideNodeId: string): ProjectDocument {
  const node = findSlideNode(project, slideNodeId)

  const usedLetters = new Set(node.responses.map((response) => response.letter))
  const freeLetter = RESPONSE_LETTERS.find((letter) => !usedLetters.has(letter))
  if (!freeLetter) {
    throw new Error('Una diapositiva no puede tener más de 4 respuestas.')
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
    const draftNode = draft.graph.nodes.find((candidate) => candidate.id === slideNodeId)
    if (draftNode && draftNode.type === 'slide') {
      draftNode.responses.push(newResponse)
    }
    draft.metadata.updatedAt = new Date().toISOString()
  })
}

/**
 * Campos editables de una respuesta ya creada mediante `updateResponse`. El
 * destino (`targetNodeId`) tiene su propio mecanismo dedicado vía
 * `connect`/`disconnect` y no se toca aquí.
 *
 * Semántica de "patch" para `points`/`imageAssetId`/`audioAssetId`:
 * `undefined` no toca el campo, `null` lo borra (lo deja `undefined` en la
 * respuesta) y un valor lo fija a ese valor/id. `points` acepta cualquier
 * `number` (positivo, negativo o cero); no hay restricción de rango.
 *
 * `effects`/`condition` (variables/condiciones, ver `src/domain/schemas.ts`)
 * siguen el mismo patrón de patch que el resto: `undefined` no toca,
 * `null` borra, un valor fija. `effects`, igual que `imageAssetIds` en
 * `UpdateNodePatch`, REEMPLAZA la lista completa (no es incremental) —
 * quien llama construye el array final (añadir/quitar un efecto concreto se
 * hace leyendo `response.effects` actual y llamando con la lista ya
 * modificada). Ninguno de los dos campos se valida aquí contra el `type` de
 * la variable referenciada (esa variable vive en `project.variables`, fuera
 * de la respuesta que se está editando) — responsabilidad de la UI en la
 * fase de editor, mismo criterio documentado en `VariableConditionSchema`/
 * `VariableEffectSchema`.
 */
export interface UpdateResponsePatch {
  text?: string
  points?: number | null
  imageAssetId?: string | null
  audioAssetId?: string | null
  effects?: VariableEffect[] | null
  condition?: VariableCondition | null
}

/**
 * Actualiza campos editables básicos de una respuesta ya existente de una
 * diapositiva (texto, puntuación, imagen/audio adjuntos). Análoga a
 * `updateNode` pero a nivel de respuesta. Lanza `Error` si el nodo no
 * existe, no es `slide`, o la respuesta no existe.
 */
export function updateResponse(
  project: ProjectDocument,
  slideNodeId: string,
  responseId: string,
  patch: UpdateResponsePatch,
): ProjectDocument {
  const node = findSlideNode(project, slideNodeId)
  if (!node.responses.some((response) => response.id === responseId)) {
    throw new Error(`El nodo "${slideNodeId}" no tiene una respuesta con id "${responseId}".`)
  }

  return produce(project, (draft) => {
    const draftNode = draft.graph.nodes.find((candidate) => candidate.id === slideNodeId)
    if (draftNode && draftNode.type === 'slide') {
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
        if (patch.effects !== undefined) {
          response.effects = patch.effects === null ? undefined : patch.effects
        }
        if (patch.condition !== undefined) {
          response.condition = patch.condition === null ? undefined : patch.condition
        }
      }
    }
    draft.metadata.updatedAt = new Date().toISOString()
  })
}

/**
 * Elimina una respuesta de una diapositiva. Las respuestas restantes
 * conservan su id/letra/orden relativo — no se reindexan letras. Si era la
 * última, la diapositiva vuelve a comportarse como "de continuar" usando el
 * `targetNodeId` que ya tuviera (ver `addResponse`).
 */
export function removeResponse(
  project: ProjectDocument,
  slideNodeId: string,
  responseId: string,
): ProjectDocument {
  const node = findSlideNode(project, slideNodeId)
  if (!node.responses.some((response) => response.id === responseId)) {
    throw new Error(`El nodo "${slideNodeId}" no tiene una respuesta con id "${responseId}".`)
  }

  return produce(project, (draft) => {
    const draftNode = draft.graph.nodes.find((candidate) => candidate.id === slideNodeId)
    if (draftNode && draftNode.type === 'slide') {
      draftNode.responses = draftNode.responses.filter((response) => response.id !== responseId)
    }
    draft.metadata.updatedAt = new Date().toISOString()
  })
}
