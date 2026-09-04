import { addResponse, updateResponse } from './responses'
import { addVariable, createNode, updateNode } from './project'
import { connect } from './graph'
import type { NodePosition, ProjectDocument } from './schemas'

/**
 * ---------------------------------------------------------------------------
 * "+1 fallo con Game Over" (paquete de 2 nodos)
 * ---------------------------------------------------------------------------
 *
 * Botón de creación rápida del panel izquierdo (`LeftPanel.tsx`, junto a "+
 * Diapositiva"/"+ Final") que añade DE UNA VEZ, ya cableadas entre sí, dos
 * diapositivas con contenido predefinido — mismo criterio de composición
 * que las plantillas de `src/domain/templates.ts` (encadenar funciones de
 * dominio reales: `createNode`, `addResponse`, `updateResponse`, `connect`,
 * `updateNode`), pero invocable sobre un proyecto YA EN MARCHA (las
 * plantillas solo se usan al crear un proyecto nuevo desde `HomeScreen`).
 *
 * Petición de usuario: este pack SOLO crea las dos diapositivas — el Final
 * "Perfecto"/"con fallos" que creaba en una versión anterior se eliminó
 * (si el diseñador quiere un Final ahí, lo añade aparte con el botón
 * "+ Final" genérico del panel).
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
 * 2. Diapositiva "Game Over": pantalla de marca "a medida" (bespoke,
 *    `brandedGameOverScreen: true` en `SlideNodeSchema`), IDÉNTICA en diseño
 *    a la portada iLERNA (`IntroCard`/`GameOverCard` en
 *    `src/player/PlayerScreen.tsx`) — no el layout genérico de diapositiva
 *    de decisión. Contenido FIJO de esta pantalla (no editable desde el
 *    Inspector, ver comentario de `brandedGameOverScreen`):
 *    - Logo iLERNA + título fijo "¿Seguro que no quieres volver a
 *      intentarlo?" + ilustración de fondo a pantalla completa
 *      (`src/assets/playerIntro/game-over.jpg`).
 *    - Dos botones con el texto visible fijo "Reintentar" (primario,
 *      relleno) / "Salir" (secundario, contorno) — el bloque de texto/
 *      imagen que el nodo sigue teniendo en su `content` (heredado de
 *      `createNode`, vacío por defecto) ya NO se muestra en esta pantalla.
 *    - Respuesta "Reintentar": sin destino (el diseñador la conecta donde
 *      quiera — normalmente, de vuelta a "+1 Fallo").
 *    - Respuesta "Salir": `actsAsExit: true` (termina el recorrido ahí
 *      mismo, sin navegar a ningún nodo).
 *
 * La variable "Fallos" se crea automáticamente (número, valor inicial 0) si
 * el proyecto todavía no tiene ninguna con ese nombre exacto; si ya existe,
 * se reutiliza tal cual (nunca se duplica ni se resetea su valor inicial).
 */

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

/**
 * Añade el paquete "+1 fallo con Game Over" a `project`: dos diapositivas,
 * ya conectadas entre sí (ver comentario de cabecera del archivo) y con el
 * contenido predefinido. `position` es la posición de la PRIMERA diapositiva
 * (la "en blanco"); "Game Over" nace a su derecha, con un offset fijo — no
 * pretende ser una disposición final perfecta, el diseñador puede mover
 * cualquiera de las dos desde el lienzo, mismo criterio que `seedIntroNode`
 * en `templates.ts`. Petición de usuario: este pack ya NO crea ningún Final
 * — si el diseñador quiere uno, lo añade aparte con el botón "+ Final"
 * genérico del panel.
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
  // Sin bloque de texto ni de imagen: esta pantalla es "a medida" (bespoke,
  // `brandedGameOverScreen`) e ignora `node.content` por completo — nace con
  // el bloque de texto vacío por defecto de `createNode`/`newSlideNode`, sin
  // tocarlo. Petición de usuario: insignia fija "GAME OVER" + marco rojo en
  // el lienzo (ver comentario de `SlideNodeSchema.canvasBadge`) Y la pantalla
  // de marca bespoke (ver comentario de `SlideNodeSchema.brandedGameOverScreen`).
  // Sin `visitEffects` aquí — el efecto de sumar Fallos vive en "+1 Fallo"
  // (más arriba), no en esta diapositiva. Un único `updateNode`: los tres
  // campos son exclusivos de `slide`.
  next = updateNode(next, gameOverId, { canvasBadge: 'game-over', brandedGameOverScreen: true })
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
  // Textos fijos de la pantalla bespoke (ver `GameOverCard` en
  // `src/player/PlayerScreen.tsx`) — el comportamiento real (navegación de
  // "Reintentar", `actsAsExit` de "Salir") sigue siendo el de estas dos
  // respuestas tal cual.
  next = updateResponse(next, gameOverId, tryAgainResponseId, { text: 'Reintentar' })
  next = updateResponse(next, gameOverId, giveUpResponseId, {
    text: 'Salir',
    actsAsExit: true,
  })

  // Cablea la primera diapositiva a "Game Over" a través de su segunda
  // respuesta (`response1Id`, la primera, se deja deliberadamente sin
  // destino: el diseñador la conecta donde quiera).
  next = connect(next, slide1Id, gameOverId, response2Id)

  return next
}
