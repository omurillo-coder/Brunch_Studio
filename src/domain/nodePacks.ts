import { addResponse, updateResponse } from './responses'
import { addImageBlock, updateTextBlockBody } from './content'
import { addVariable, createNode, updateNode } from './project'
import { connect } from './graph'
import { serializeRichBody } from '../editor/richText/richTextContent'
import type { NodePosition, ProjectDocument } from './schemas'

/**
 * ---------------------------------------------------------------------------
 * "+1 fallo con Game Over" (paquete de 2 diapositivas)
 * ---------------------------------------------------------------------------
 *
 * Botón de creación rápida del panel izquierdo (`LeftPanel.tsx`, junto a "+
 * Diapositiva"/"+ Final") que añade DE UNA VEZ, ya cableadas entre sí, dos
 * diapositivas con contenido predefinido — mismo criterio de composición que
 * las plantillas de `src/domain/templates.ts` (encadenar funciones de
 * dominio reales: `createNode`, `addResponse`, `updateResponse`, `connect`,
 * `updateTextBlockBody`), pero invocable sobre un proyecto YA EN MARCHA (las
 * plantillas solo se usan al crear un proyecto nuevo desde `HomeScreen`).
 *
 * Contenido exacto (texto acordado con Content Factory, no un placeholder):
 *
 * 1. Diapositiva "de decisión" en blanco (para que el diseñador la rellene):
 *    un bloque de texto vacío + 2 respuestas de texto vacío —
 *    - Respuesta 1: sin destino (el diseñador la conecta donde quiera).
 *    - Respuesta 2: conectada a la diapositiva 2 (Game Over).
 *
 * 2. Diapositiva "Game Over", con contenido fijo:
 *    - Texto: "Lástima, parece que este caso se quedará sin resolver." +
 *      "¿De verdad quieres rendirte ahora?" (dos párrafos separados).
 *    - Un bloque de imagen "pendiente de subir" (sin `assetId` todavía, ver
 *      `ContentBlockSchema` — el "[imagen pendiente]" del encargo).
 *    - `visitEffects`: +1 a la variable "Fallos" al entrar en ella, sea cual
 *      sea el camino (milestone "+1 fallo con Game Over" en `runtime.ts`).
 *    - Respuesta "Vale, voy a intentarlo.": sin destino (el diseñador la
 *      conecta donde quiera).
 *    - Respuesta "No, me rindo.": `actsAsExit: true` (termina el recorrido
 *      ahí mismo, sin navegar a ningún nodo).
 *
 * La variable "Fallos" se crea automáticamente (número, valor inicial 0) si
 * el proyecto todavía no tiene ninguna con ese nombre exacto; si ya existe,
 * se reutiliza tal cual (nunca se duplica ni se resetea su valor inicial).
 */

/** Cuerpo Tiptap de dos párrafos, serializado — mismo formato que
 *  `updateTextBlockBody` espera (`serializeRichBody`,
 *  `src/editor/richText/richTextContent.ts`). Un simple string plano se
 *  interpretaría como UN ÚNICO párrafo (`wrapPlainText`, en ese mismo
 *  archivo), perdiendo el salto de línea entre las dos frases. */
function twoParagraphBody(first: string, second: string): string {
  return serializeRichBody({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: first }] },
      { type: 'paragraph', content: [{ type: 'text', text: second }] },
    ],
  })
}

const FALLOS_VARIABLE_NAME = 'Fallos'

/** Devuelve el id de la variable "Fallos" del proyecto, creándola primero
 *  (número, valor inicial 0) si todavía no existe una con ese nombre exacto
 *  — nunca la duplica ni la reinicia si ya estaba creada. */
function ensureFallosVariable(project: ProjectDocument): { project: ProjectDocument; variableId: string } {
  const existing = project.variables.find((variable) => variable.name === FALLOS_VARIABLE_NAME)
  if (existing) {
    return { project, variableId: existing.id }
  }
  const withVariable = addVariable(project, {
    name: FALLOS_VARIABLE_NAME,
    type: 'number',
    initialValue: 0,
  })
  const created = withVariable.variables.find((variable) => variable.name === FALLOS_VARIABLE_NAME)
  if (!created) {
    // No debería ocurrir nunca: `addVariable` siempre añade exactamente una
    // variable con ese nombre salvo que lance. Se cubre de todos modos para
    // no dejar pasar un `undefined` silencioso hacia `connect`.
    throw new Error('addGameOverPack: no se pudo crear la variable "Fallos".')
  }
  return { project: withVariable, variableId: created.id }
}

/** Localiza el único bloque de texto de una diapositiva recién creada (nace
 *  con exactamente uno, ver `newSlideNode` en `project.ts`) — mismo patrón
 *  que `firstTextBlockId` en `templates.ts`, no compartido a propósito
 *  (archivos de dominio distintos, cada uno gestiona sus propias búsquedas
 *  locales). */
function firstTextBlockId(project: ProjectDocument, slideNodeId: string): string {
  const node = project.graph.nodes.find((candidate) => candidate.id === slideNodeId)
  if (!node || node.type !== 'slide') {
    throw new Error(`addGameOverPack: "${slideNodeId}" no es una diapositiva.`)
  }
  const block = node.content.find((candidate) => candidate.type === 'text')
  if (!block) {
    throw new Error(`addGameOverPack: la diapositiva "${slideNodeId}" no tiene ningún bloque de texto.`)
  }
  return block.id
}

/**
 * Añade el paquete "+1 fallo con Game Over" a `project`: dos diapositivas
 * nuevas, ya conectadas entre sí y con el contenido predefinido descrito en
 * el comentario de cabecera de este archivo. `position` es la posición de la
 * PRIMERA diapositiva (la "en blanco"); la de Game Over nace a su derecha,
 * con un offset fijo — no pretende ser una disposición final perfecta, el
 * diseñador puede mover cualquiera de las dos desde el lienzo, mismo
 * criterio que `seedIntroNode` en `templates.ts`.
 */
export function addGameOverPack(project: ProjectDocument, position: NodePosition): ProjectDocument {
  const { project: withVariable, variableId: fallosVariableId } = ensureFallosVariable(project)

  // Diapositiva 1: "de decisión" en blanco, para que el diseñador la rellene.
  let next = createNode(withVariable, 'slide', position)
  const slide1Id = next.graph.nodes.find(
    (node) => !withVariable.graph.nodes.some((existing) => existing.id === node.id),
  )?.id
  if (!slide1Id) {
    throw new Error('addGameOverPack: no se pudo identificar la primera diapositiva recién creada.')
  }
  next = addResponse(next, slide1Id)
  next = addResponse(next, slide1Id)
  const slide1AfterResponses = next.graph.nodes.find((node) => node.id === slide1Id)
  if (!slide1AfterResponses || slide1AfterResponses.type !== 'slide') {
    throw new Error('addGameOverPack: setup inválido de la primera diapositiva.')
  }
  // Solo hace falta el id de la SEGUNDA respuesta (la que se conecta a
  // "Game Over" más abajo, `connect`) — la primera se deja deliberadamente
  // sin destino, para que el diseñador la conecte donde quiera, así que no
  // hace falta su id para nada.
  const response2Id = slide1AfterResponses.responses[1]?.id
  if (!response2Id) {
    throw new Error('addGameOverPack: no se pudieron crear las dos respuestas de la primera diapositiva.')
  }

  // Diapositiva 2: "Game Over", con el contenido predefinido.
  const gameOverPosition = { x: position.x + 320, y: position.y }
  const beforeGameOver = next
  next = createNode(next, 'slide', gameOverPosition)
  const gameOverId = next.graph.nodes.find(
    (node) => !beforeGameOver.graph.nodes.some((existing) => existing.id === node.id),
  )?.id
  if (!gameOverId) {
    throw new Error('addGameOverPack: no se pudo identificar la diapositiva "Game Over" recién creada.')
  }
  next = updateTextBlockBody(
    next,
    gameOverId,
    firstTextBlockId(next, gameOverId),
    twoParagraphBody(
      'Lástima, parece que este caso se quedará sin resolver.',
      '¿De verdad quieres rendirte ahora?',
    ),
  )
  next = addImageBlock(next, gameOverId)
  next = updateNode(next, gameOverId, {
    visitEffects: [{ variableId: fallosVariableId, operation: 'increment', value: 1 }],
  })
  next = addResponse(next, gameOverId)
  next = addResponse(next, gameOverId)
  const gameOverAfterResponses = next.graph.nodes.find((node) => node.id === gameOverId)
  if (!gameOverAfterResponses || gameOverAfterResponses.type !== 'slide') {
    throw new Error('addGameOverPack: setup inválido de la diapositiva "Game Over".')
  }
  const [tryAgainResponseId, giveUpResponseId] = gameOverAfterResponses.responses.map(
    (response) => response.id,
  )
  if (!tryAgainResponseId || !giveUpResponseId) {
    throw new Error('addGameOverPack: no se pudieron crear las dos respuestas de "Game Over".')
  }
  next = updateResponse(next, gameOverId, tryAgainResponseId, { text: 'Vale, voy a intentarlo.' })
  next = updateResponse(next, gameOverId, giveUpResponseId, {
    text: 'No, me rindo.',
    actsAsExit: true,
  })

  // Cablea la primera diapositiva a "Game Over" a través de su segunda
  // respuesta (`response1Id`, la primera, se deja deliberadamente sin
  // destino: el diseñador la conecta donde quiera).
  next = connect(next, slide1Id, gameOverId, response2Id)

  return next
}
