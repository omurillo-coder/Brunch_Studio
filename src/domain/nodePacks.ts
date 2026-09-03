import { addResponse, updateResponse } from './responses'
import { addImageBlock, updateTextBlockBody } from './content'
import { addVariable, createNode, updateNode } from './project'
import { connect } from './graph'
import { serializeRichBody } from '../editor/richText/richTextContent'
import type { NodePosition, ProjectDocument } from './schemas'

/**
 * ---------------------------------------------------------------------------
 * "+1 fallo con Game Over" (paquete de 3 nodos)
 * ---------------------------------------------------------------------------
 *
 * Botón de creación rápida del panel izquierdo (`LeftPanel.tsx`, junto a "+
 * Diapositiva"/"+ Final") que añade DE UNA VEZ, ya cableadas entre sí, dos
 * diapositivas y un Final con contenido predefinido — mismo criterio de
 * composición que las plantillas de `src/domain/templates.ts` (encadenar
 * funciones de dominio reales: `createNode`, `addResponse`,
 * `updateResponse`, `connect`, `updateTextBlockBody`), pero invocable sobre
 * un proyecto YA EN MARCHA (las plantillas solo se usan al crear un
 * proyecto nuevo desde `HomeScreen`).
 *
 * Contenido exacto (texto acordado con Content Factory, no un placeholder):
 *
 * 1. Diapositiva "+1 Fallo" — la "de decisión" en blanco (para que el
 *    diseñador la rellene): un bloque de texto vacío + 2 respuestas de
 *    texto vacío —
 *    - Respuesta 1: sin destino (el diseñador la conecta donde quiera).
 *    - Respuesta 2: conectada a la diapositiva 2 (Game Over).
 *    - `visitEffects`: +1 a la variable "Fallos" al entrar en ELLA (no en
 *      "Game Over", ver más abajo), sea cual sea el camino — corrección
 *      de petición de usuario: al ser la diapositiva que se REVISITA en
 *      cada vuelta del bucle de reintento ("Vale, voy a intentarlo" de
 *      "Game Over" vuelve aquí), el contador de Fallos crece con cada
 *      intento, no solo con el primer fallo (milestone "+1 fallo con Game
 *      Over" en `runtime.ts`).
 *
 * 2. Diapositiva "Game Over", con contenido fijo:
 *    - Texto: "Lástima, parece que este caso se quedará sin resolver." +
 *      "¿De verdad quieres rendirte ahora?" (dos párrafos separados).
 *    - Un bloque de imagen "pendiente de subir" (sin `assetId` todavía, ver
 *      `ContentBlockSchema` — el "[imagen pendiente]" del encargo).
 *    - Respuesta "Vale, voy a intentarlo.": sin destino (el diseñador la
 *      conecta donde quiera — normalmente, de vuelta a "+1 Fallo").
 *    - Respuesta "No, me rindo.": `actsAsExit: true` (termina el recorrido
 *      ahí mismo, sin navegar a ningún nodo).
 *
 * 3. Final "Perfecto"/"con fallos" — un ÚNICO nodo `final`, sin conectar a
 *    propósito (el diseñador lo cablea donde termine su propia narrativa):
 *    - Contenido por defecto ("Perfecto", cuando Fallos = 0): "¡Impresionante!"
 *      + "Lo has resuelto en un momento." + "¿Quieres explorar otros
 *      caminos?".
 *    - Contenido alternativo ("con fallos", cuando Fallos > 0):
 *      "¡Buen trabajo!" + "Has conseguido resolver el caso, aunque has
 *      tenido algunos contratiempos." + "¿Qué decisiones cambiarías?", vía
 *      `alternateCondition`/`alternateBody` (milestone "+1 fallo con Game
 *      Over", `FinalNodeSchema`).
 *    - `celebrate: true` (petición de usuario: "el confeti lo quiero si
 *      llegas al final sin fallos y con fallos, en los dos" — ver
 *      `PlayerView.celebrate` en `src/player/runtime.ts`): confeti sobre
 *      AMBOS contenidos, el por defecto y el alternativo.
 *    - Los botones "Reintentar"/"Salir" de esta pantalla son los genéricos
 *      de cualquier Final (`PlayerScreen.tsx`/`exportedPlayerScript.ts`),
 *      no algo que fije este pack.
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

/** Cuerpo Tiptap de un titular (encabezado nivel 2) + dos párrafos,
 *  serializado — mismo criterio que `twoParagraphBody`, con un nodo
 *  `heading` como primera línea: el titular "¡Impresionante!"/"¡Buen
 *  trabajo!" de cada variante del Final de este pack (ver comentario de
 *  cabecera del archivo), más prominente que un párrafo normal — mismo
 *  nodo `heading` que ya produce el botón "H" del editor de texto
 *  enriquecido (`RICH_TEXT_EXTENSIONS`, que incluye `StarterKit`). */
function headingBody(heading: string, first: string, second: string): string {
  return serializeRichBody({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: heading }] },
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
 * Añade el paquete "+1 fallo con Game Over" a `project`: dos diapositivas y
 * un Final, ya conectados entre sí donde corresponde (ver comentario de
 * cabecera del archivo) y con el contenido predefinido. `position` es la
 * posición de la PRIMERA diapositiva (la "en blanco"); "Game Over" nace a su
 * derecha y el Final debajo de ella, ambos con un offset fijo — no
 * pretende ser una disposición final perfecta, el diseñador puede mover
 * cualquiera de los tres desde el lienzo, mismo criterio que `seedIntroNode`
 * en `templates.ts`. El Final nace SIN conectar (ninguna respuesta de este
 * pack apunta a él): a diferencia de "Game Over" (destino fijo de la
 * segunda respuesta de "+1 Fallo"), dónde termina la narrativa del
 * diseñador es algo que este pack no puede decidir por él.
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
  // Petición de usuario: insignia fija "+1 FALLO" en el lienzo (ver
  // comentario de `SlideNodeSchema.canvasBadge`) — identifica esta
  // diapositiva como la "de decisión" del pack de un vistazo, sin abrir el
  // Inspector — Y el efecto de sumar Fallos al visitarla (movido aquí desde
  // "Game Over", ver comentario de cabecera del archivo). Un único
  // `updateNode`: ambos campos son exclusivos de `slide`.
  next = updateNode(next, slide1Id, {
    canvasBadge: 'plus-one-fallo',
    visitEffects: [{ variableId: fallosVariableId, operation: 'increment', value: 1 }],
  })
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
  // Petición de usuario: insignia fija "GAME OVER" + marco rojo en el
  // lienzo (ver comentario de `SlideNodeSchema.canvasBadge`). Sin
  // `visitEffects` aquí — el efecto de sumar Fallos vive en "+1 Fallo"
  // (más arriba), no en esta diapositiva.
  next = updateNode(next, gameOverId, { canvasBadge: 'game-over' })
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

  // Final "Perfecto"/"con fallos": un único nodo, sin conectar (ver
  // comentario de esta función). Nace con `body`/`variant` vacíos por
  // defecto (`createNode`); el `updateNode` de después fija TODO su
  // contenido de una vez — `body` (por defecto), `alternateCondition`/
  // `alternateBody` (Fallos > 0) y `celebrate` (confeti sobre los dos
  // contenidos, petición de usuario).
  const finalPosition = { x: position.x, y: position.y + 240 }
  const beforeFinal = next
  next = createNode(next, 'final', finalPosition)
  const finalId = next.graph.nodes.find(
    (node) => !beforeFinal.graph.nodes.some((existing) => existing.id === node.id),
  )?.id
  if (!finalId) {
    throw new Error('addGameOverPack: no se pudo identificar el Final recién creado.')
  }
  next = updateNode(next, finalId, {
    body: headingBody(
      '¡Impresionante!',
      'Lo has resuelto en un momento.',
      '¿Quieres explorar otros caminos?',
    ),
    alternateCondition: { variableId: fallosVariableId, operator: '>', value: 0 },
    alternateBody: headingBody(
      '¡Buen trabajo!',
      'Has conseguido resolver el caso, aunque has tenido algunos contratiempos.',
      '¿Qué decisiones cambiarías?',
    ),
    celebrate: true,
  })

  return next
}
