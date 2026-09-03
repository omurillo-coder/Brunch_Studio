import { applyVariableEffects, evaluateCondition, resolveSlideTarget } from '../domain'
import type {
  DecisionResponse,
  FinalNode,
  IntroNode,
  Node,
  ProjectDocument,
  SlideNode,
  VariableState,
} from '../domain'

/**
 * ---------------------------------------------------------------------------
 * Runtime del Player
 * ---------------------------------------------------------------------------
 *
 * Lógica de recorrido pura, sin ningún import de React ni de
 * `@xyflow/react`, para que sea reutilizable tal cual desde otros
 * "reproductores" futuros (exportación HTML, SCORM) que consuman el mismo
 * `ProjectDocument`. Todo el estado que necesita el Player para saber "dónde
 * está" el recorrido cabe en `PlayerState`; todo lo que necesita saber "qué
 * mostrar ahora" se calcula con `getView`, un tipo discriminado
 * (`PlayerView`) a partir del documento + ese estado.
 *
 * Estas funciones nunca lanzan ante un grafo incompleto (diapositiva sin
 * destino, diapositiva con respuestas pero ninguna conectada, o incluso un
 * `graph.startNodeId` que no apunta a ningún nodo): en cualquiera de esos
 * casos `getView` resuelve a `dead-end` en vez de romperse, para que el
 * Player pueda mostrar un mensaje en vez de quedarse en blanco o lanzar una
 * excepción durante la edición (momento en el que el grafo está incompleto la
 * mayor parte del tiempo).
 */

/**
 * Qué debe verse ahora en el Player. `node` es siempre el nodo real del
 * documento (nunca una copia): el Player es una vista de lectura sobre el
 * mismo `ProjectDocument` que edita el usuario.
 *
 * Las dos formas de una diapositiva se distinguen aquí, no en el dominio:
 * - `continue`: diapositiva SIN respuestas y con destino de continuar.
 * - `decision`: diapositiva con al menos una respuesta con destino.
 *
 * `dead-end` cubre el resto de situaciones, todas con el mismo tratamiento
 * (mensaje de "sin continuación configurada", sin romper):
 * - Una diapositiva sin respuestas y sin destino resuelto (`targetNodeId`, o
 *   `resolveSlideTarget` según su `condition`, ver más abajo).
 * - Una diapositiva con respuestas pero ninguna VISIBLE con `targetNodeId`
 *   (visible = sin `condition`, o con `condition` que evalúa a verdadera
 *   contra `PlayerState.variables`; ver `visibleResponses` más abajo). Si
 *   TODAS las respuestas quedan filtradas por su `condition`, o ninguna de
 *   las visibles tiene destino, es un `dead-end` igual que hoy.
 * - `graph.startNodeId` sin nodo correspondiente (`node: null`).
 * - Un nodo `intro` SIN `targetNodeId` (milestone "Diapositiva de Inicio",
 *   ver más abajo): mismo criterio que una diapositiva "de continuar" sin
 *   destino — no tiene sentido mostrar un botón de continuar que no lleva a
 *   ningún sitio, así que se resuelve a `dead-end` en vez de a `intro`.
 *
 * `intro` (milestone "Diapositiva de Inicio"): el nodo `intro` completo, sin
 * más estado — quien pinte la vista resuelve `cicloId`/`asignaturaId` a
 * nombres legibles vía `CICLOS` (`src/domain/catalog.ts`) y muestra
 * `caseName`. Desde este milestone `graph.startNodeId` apunta casi siempre a
 * un nodo `intro` (ver comentario de `IntroNodeSchema` en
 * `src/domain/schemas.ts`), así que esta suele ser la primera vista que ve
 * quien juega el recorrido; avanzar a la primera diapositiva narrativa real
 * es `advance` (mismo verbo que ya usa una diapositiva "de continuar", ver
 * más abajo), no un verbo aparte. A diferencia de `cicloId`/`asignaturaId`/
 * `caseName` (que pueden estar vacíos sin que la vista se resuelva a
 * `dead-end`: quien pinta la vista los muestra o los omite, ver
 * `PlayerScreen.tsx`), la AUSENCIA de `targetNodeId` sí cambia el `kind` de
 * la vista — ver el bullet de `dead-end` de arriba.
 */
export type PlayerView =
  | { kind: 'intro'; node: IntroNode }
  | { kind: 'continue'; node: SlideNode }
  | {
      kind: 'decision'
      node: SlideNode
      /**
       * Subconjunto de `node.responses` que debe OFRECERSE ahora mismo:
       * las respuestas sin `condition`, más las que la tienen y evalúa a
       * verdadera contra el estado de variables actual (ver
       * `evaluateCondition`, `src/domain/variables.ts`). `node` sigue siendo
       * el nodo real del documento (nunca una copia, ver comentario de
       * cabecera); este campo aparte es lo que debe pintar quien consuma la
       * vista en vez de `node.responses` directamente, para respetar el
       * filtrado por condición.
       */
      visibleResponses: DecisionResponse[]
    }
  | {
      kind: 'final'
      node: FinalNode
      /**
       * Milestone "+1 fallo con Game Over" ("Final Ok"/"Final con fallos"
       * con un único nodo Final, ver `FinalNodeSchema.alternateCondition`/
       * `alternateBody`): el cuerpo que debe pintarse, ya resuelto —
       * `node.alternateBody` si `node.alternateCondition` evalúa a
       * verdadera contra `PlayerState.variables` Y `alternateBody` tiene
       * contenido; `node.body` en cualquier otro caso (sin condición, con
       * condición falsa, o alternativo vacío — nunca deja la vista en
       * blanco). Quien pinta la vista (`PlayerScreen.tsx`/
       * `exportedPlayerScript.ts`) usa SIEMPRE este campo, nunca
       * `node.body` directamente — mismo criterio que `visibleResponses`
       * para `kind: 'decision'`.
       */
      resolvedBody: string
      /**
       * Milestone "+1 fallo con Game Over", petición de usuario ("Final
       * Perfecto con confeti", ampliada después: "el confeti lo quiero si
       * llegas al final sin fallos y con fallos, en los dos"): `true`
       * cuando debe celebrarse con confeti esta vista — directamente
       * `node.celebrate`, sea cual sea el contenido resuelto (por defecto
       * o alternativo). Se sigue calculando aquí (no en quien pinta la
       * vista) por consistencia con el resto de este tipo, aunque ya no
       * dependa de `usedAlternate`.
       */
      celebrate: boolean
    }
  | { kind: 'dead-end'; node: Node | null }

/**
 * Estado mínimo del recorrido: el id del nodo en el que se encuentra ahora
 * mismo, más la puntuación acumulada durante ese recorrido. Deliberadamente
 * no vive en `useProjectStore` ni pasa por su historial de undo/redo — no es
 * parte del documento, es una simulación efímera de lectura sobre él (ver
 * `PlayerScreen`).
 */
export interface PlayerState {
  /** `null` únicamente cuando `graph.startNodeId` no apunta a ningún nodo. */
  currentNodeId: string | null
  /**
   * Puntuación acumulada a lo largo del recorrido. `null` mientras ninguna
   * respuesta elegida haya definido `points` — deliberadamente distinto de
   * `0`: un escenario que no usa puntuación en absoluto no debe mostrar
   * "0 puntos" en su Final, sería confuso. Pasa a ser un número en cuanto se
   * elige la primera respuesta con `points` definido, y a partir de ahí solo
   * puede crecer o decrecer (nunca vuelve a `null` salvo por
   * `restart`/`getInitialState`).
   */
  totalPoints: number | null
  /**
   * Estado de las variables del proyecto (`ProjectDocument.variables`) a lo
   * largo de este recorrido. Sistema COMPLETAMENTE INDEPENDIENTE de
   * `totalPoints`: no se mezclan en ningún punto de este módulo — uno es la
   * puntuación acumulada de las respuestas elegidas (fase de puntuación,
   * anterior a esta), el otro son los contadores/flags que el diseñador
   * define explícitamente en `project.variables` (fase "Variables/
   * condiciones"). Sembrado por `getInitialState`/`restart` a partir de
   * `VariableDef.initialValue`, modificado únicamente por `choose` vía
   * `applyVariableEffects` (`src/domain/variables.ts`).
   */
  variables: VariableState
  /**
   * Petición de usuario (interruptor "Ordenar"/"Random" del Inspector, ver
   * `SlideNodeSchema.responseOrder`): orden barajado de los `id` de
   * `node.responses` del nodo ACTUAL, sembrado UNA VEZ al entrar en él
   * (mismo criterio "al entrar" que `applyVisitEffects`, ver más abajo) —
   * nunca recalculado en cada render de `getView`, que se llama en cada
   * pintado sin que eso deba barajar de nuevo. `null` cuando el nodo actual
   * no es una diapositiva con `responseOrder: 'random'` y más de una
   * respuesta (no hay nada que barajar), o mientras no haya ninguna
   * respuesta que ofrecer. Solo lo lee `getView` (`orderResponses`, más
   * abajo); el resto del runtime lo trata como parte opaca del estado, se
   * copia sin más de una transición a la siguiente cuando el nodo no
   * cambia.
   */
  shuffledResponseIds: string[] | null
}

/** Estado inicial de `variables`: un valor por cada `VariableDef` del
 *  proyecto, sembrado a `initialValue`. Usada por `getInitialState` y,
 *  transitivamente, por `restart` (delega en `getInitialState`). */
function initialVariableState(project: ProjectDocument): VariableState {
  return project.variables.reduce<VariableState>((state, def) => {
    state[def.id] = def.initialValue
    return state
  }, {})
}

function findNode(project: ProjectDocument, nodeId: string): Node | null {
  return project.graph.nodes.find((node) => node.id === nodeId) ?? null
}

/**
 * Milestone "+1 fallo con Game Over": aplica `visitEffects` (si los hay,
 * ver `SlideNodeSchema.visitEffects`) sobre `variables` al ENTRAR en
 * `nodeId` — se llama desde `getInitialState`/`advance`/`choose`, los tres
 * únicos sitios de este módulo donde cambia `currentNodeId`, para que se
 * apliquen sea cual sea el camino por el que se llegó (elegir una
 * respuesta, el "Continuar" de otra diapositiva, o el propio arranque del
 * recorrido). Solo tiene efecto sobre un `slide` con `visitEffects`; sobre
 * cualquier otro nodo (o sin `nodeId`, `currentNodeId` a `null`) devuelve
 * `variables` intacto. No hay ninguna guarda de "solo la primera vez": no
 * hace falta, no existe ninguna forma de "volver atrás" a un nodo ya
 * visitado sin pasar por `restart` (que resiembra `variables` desde cero).
 */
function applyVisitEffects(
  project: ProjectDocument,
  variables: VariableState,
  nodeId: string | null,
): VariableState {
  if (!nodeId) return variables
  const node = findNode(project, nodeId)
  if (!node || node.type !== 'slide' || !node.visitEffects || node.visitEffects.length === 0) {
    return variables
  }
  return applyVariableEffects(variables, node.visitEffects)
}

/** Fisher-Yates in-place sobre una COPIA de `ids` — nunca muta el array que
 *  recibe. Usada únicamente por `computeShuffledResponseIds`, más abajo. */
function shuffleIds(ids: string[]): string[] {
  const shuffled = [...ids]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = shuffled[i] as string
    shuffled[i] = shuffled[j] as string
    shuffled[j] = swap
  }
  return shuffled
}

/**
 * Petición de usuario ("Random"): calcula el `shuffledResponseIds` que debe
 * sembrar `PlayerState` al ENTRAR en `nodeId` — mismos tres puntos de
 * llamada que `applyVisitEffects` (`getInitialState`/`advance`/`choose`),
 * por el mismo motivo: da igual el camino por el que se llega, el barajado
 * debe repetirse en cada visita nueva. `null` si `nodeId` no es una
 * diapositiva, no tiene `responseOrder: 'random'`, o tiene 0-1 respuestas
 * (nada que barajar) — ver comentario de `PlayerState.shuffledResponseIds`.
 */
function computeShuffledResponseIds(
  project: ProjectDocument,
  nodeId: string | null,
): string[] | null {
  if (!nodeId) return null
  const node = findNode(project, nodeId)
  if (!node || node.type !== 'slide' || node.responseOrder !== 'random' || node.responses.length <= 1) {
    return null
  }
  return shuffleIds(node.responses.map((response) => response.id))
}

/**
 * Ordena `responses` (ya filtradas por `condition`, ver `getView`) para
 * presentación: si `shuffledResponseIds` está sembrado (`responseOrder:
 * 'random'`), por su posición ahí dentro; si no (`'ordered'`/ausente, el
 * caso por defecto), TAL CUAL vienen — el propio orden del array
 * `node.responses`, que es justo lo que `moveResponse`
 * (`src/domain/responses.ts`) deja reordenar a mano. Ya NO se ordena por
 * `letter`: desde esta petición de usuario, la letra es solo el
 * identificador estable de una respuesta, no su posición visual (ver
 * comentario de `SlideNodeSchema.responseOrder`).
 */
function orderResponses(
  responses: DecisionResponse[],
  shuffledResponseIds: string[] | null,
): DecisionResponse[] {
  if (!shuffledResponseIds) return responses
  const position = new Map(shuffledResponseIds.map((id, index) => [id, index]))
  return [...responses].sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0))
}

/**
 * Milestone "+1 fallo con Game Over": resuelve qué `body` debe pintarse
 * para un nodo `final` (ver el comentario de `PlayerView`, rama `'final'`,
 * campo `resolvedBody`). Ya NO distingue si resolvió al contenido por
 * defecto o al alternativo en su valor de retorno (`usedAlternate`,
 * quitado): con la petición de usuario de celebrar en los dos casos,
 * `celebrate` es directamente `node.celebrate`, sin necesitar saber cuál de
 * los dos se está mostrando.
 */
function resolveFinalContent(node: FinalNode, variables: VariableState): { body: string } {
  if (
    node.alternateCondition &&
    node.alternateBody?.trim() &&
    evaluateCondition(variables, node.alternateCondition)
  ) {
    return { body: node.alternateBody }
  }
  return { body: node.body }
}

/**
 * Calcula el estado inicial del recorrido a partir del documento: el
 * recorrido empieza directamente en `graph.startNodeId`, la diapositiva de
 * inicio del proyecto. Ya no hay ningún nodo "Inicio" invisible del que
 * saltar automáticamente: la diapositiva de inicio es una diapositiva
 * normal y se muestra tal cual.
 *
 * `startNodeId` (opcional, botón "Probar desde aquí" de `Topbar`): si se
 * pasa y corresponde a un nodo real del documento, el recorrido arranca ahí
 * en vez de en `graph.startNodeId` — únicamente el nodo de arranque cambia;
 * `variables` se sigue sembrando igual que siempre a partir de
 * `VariableDef.initialValue` (`initialVariableState`), SIN reconstruir qué
 * decisiones se habrían tomado antes de llegar a `startNodeId`. Si no se
 * pasa, o si no corresponde a ningún nodo del documento (p.ej. se borró
 * entre seleccionarlo y pulsar el botón), se usa `graph.startNodeId` como
 * hasta ahora — mismo criterio tolerante que el resto de este módulo (ver
 * comentario de cabecera): nunca lanza, como mucho cae en el mismo `null`
 * de un `graph.startNodeId` incoherente.
 *
 * Si el nodo de arranque resultante (`startNodeId` o `graph.startNodeId`)
 * no corresponde a ningún nodo del documento, `currentNodeId` queda en
 * `null` y `getView` resuelve a `dead-end`.
 */
export function getInitialState(project: ProjectDocument, startNodeId?: string): PlayerState {
  const requested = startNodeId ? findNode(project, startNodeId) : null
  const start = requested ?? findNode(project, project.graph.startNodeId)
  const startId = start ? start.id : null
  return {
    currentNodeId: startId,
    totalPoints: null,
    variables: applyVisitEffects(project, initialVariableState(project), startId),
    shuffledResponseIds: computeShuffledResponseIds(project, startId),
  }
}

/**
 * Reinicia el recorrido: recalcula el estado inicial desde cero (mismo
 * resultado que `getInitialState`, mismo `startNodeId` opcional — ver su
 * comentario). Nombre propio para que quien la llama (`PlayerScreen`)
 * exprese la intención "reiniciar" sin tener que saber que internamente es
 * la misma función que el cálculo inicial.
 */
export function restart(project: ProjectDocument, startNodeId?: string): PlayerState {
  return getInitialState(project, startNodeId)
}

/**
 * Calcula qué debe verse ahora a partir del documento y el estado actual
 * del recorrido. Pura: no muta ni el documento ni el estado recibido.
 */
export function getView(project: ProjectDocument, state: PlayerState): PlayerView {
  if (state.currentNodeId === null) {
    return { kind: 'dead-end', node: null }
  }

  const node = findNode(project, state.currentNodeId)
  if (!node) {
    // Invariante: en uso normal `currentNodeId` siempre proviene de esta
    // misma capa de runtime. Si aun así no se encuentra (p.ej. el nodo se
    // borró desde el editor mientras el Player seguía abierto sobre él), se
    // trata igual que cualquier otro callejón sin salida en vez de lanzar.
    return { kind: 'dead-end', node: null }
  }

  if (node.type === 'intro') {
    // Mismo criterio que una diapositiva "de continuar" sin destino (ver
    // más abajo, `resolveSlideTarget`): sin `targetNodeId` no hay a dónde
    // avanzar, así que es un dead-end en vez de una portada con un botón que
    // no lleva a ningún sitio.
    return node.targetNodeId ? { kind: 'intro', node } : { kind: 'dead-end', node }
  }

  if (node.type === 'final') {
    const { body } = resolveFinalContent(node, state.variables)
    return {
      kind: 'final',
      node,
      resolvedBody: body,
      celebrate: node.celebrate === true,
    }
  }

  if (node.responses.length > 0) {
    // Solo las respuestas VISIBLES (sin `condition`, o con `condition` que
    // evalúa a verdadera contra `state.variables`) cuentan para decidir si
    // esto es una vista de decisión o un dead-end, y son las únicas que debe
    // ofrecer quien pinte la vista (`visibleResponses`). Si el filtrado deja
    // la lista vacía, o ninguna visible tiene destino, es un dead-end —
    // mismo mecanismo que ya existía para "ninguna respuesta con destino".
    const filteredResponses = node.responses.filter(
      (response) => !response.condition || evaluateCondition(state.variables, response.condition),
    )
    const visibleResponses = orderResponses(filteredResponses, state.shuffledResponseIds)
    // Milestone "+1 fallo con Game Over": una respuesta `actsAsExit` cuenta
    // igual que una con `targetNodeId` a la hora de decidir si esto es una
    // decisión "ofrecible" — no navega a ningún nodo, pero SÍ es una opción
    // pulsable de verdad (termina el recorrido ahí mismo, ver
    // `ResponseOption`/`handleExitAttempt` en `PlayerScreen.tsx`).
    return visibleResponses.some((response) => response.targetNodeId || response.actsAsExit)
      ? { kind: 'decision', node, visibleResponses }
      : { kind: 'dead-end', node }
  }

  const target = resolveSlideTarget(node, state.variables)
  return target ? { kind: 'continue', node } : { kind: 'dead-end', node }
}

/**
 * Avanza desde una diapositiva "de continuar" siguiendo su destino real
 * (`resolveSlideTarget`, que devuelve `node.targetNodeId` sin condición, o
 * decide entre `targetNodeId`/`elseTargetNodeId` según `node.condition` y
 * `state.variables` — ver `src/domain/variables.ts`), o desde un nodo
 * `intro` siguiendo directamente su `targetNodeId` (sin condición: un `intro`
 * no tiene `condition`, ver `IntroNodeSchema`) — MISMO verbo generalizado a
 * los dos orígenes posibles de "un único destino, sin decisión", en vez de un
 * verbo aparte para la portada: la API pública de este módulo queda igual de
 * estable para quien ya la usaba (`PlayerScreen`/`exportedPlayerScript.ts`).
 * Si el nodo actual no es ninguno de los dos, o no tiene destino resuelto, no
 * hace nada y devuelve el mismo estado — la UI solo debería llamarla cuando
 * `getView` haya devuelto `kind: 'continue'` o `kind: 'intro'`.
 */
export function advance(project: ProjectDocument, state: PlayerState): PlayerState {
  if (state.currentNodeId === null) return state
  const node = findNode(project, state.currentNodeId)
  if (!node) return state

  if (node.type === 'intro') {
    if (!node.targetNodeId) return state
    return {
      ...state,
      currentNodeId: node.targetNodeId,
      variables: applyVisitEffects(project, state.variables, node.targetNodeId),
      shuffledResponseIds: computeShuffledResponseIds(project, node.targetNodeId),
    }
  }

  if (node.type !== 'slide') return state
  if (node.responses.length > 0) return state
  const target = resolveSlideTarget(node, state.variables)
  if (!target) return state
  return {
    ...state,
    currentNodeId: target,
    variables: applyVisitEffects(project, state.variables, target),
    shuffledResponseIds: computeShuffledResponseIds(project, target),
  }
}

/**
 * Elige una respuesta de una diapositiva y avanza a su `targetNodeId`,
 * acumulando su `points` (si los define) en `state.totalPoints`. Si la
 * respuesta no existe, no pertenece al nodo actual, o no tiene destino
 * configurado, no hace nada y devuelve el mismo estado — la UI solo debería
 * ofrecer como pulsables las respuestas que sí tienen destino.
 *
 * Semántica de puntuación: `response.points === undefined` (respuesta sin
 * puntuación configurada) deja `totalPoints` intacto, tal cual estaba antes
 * de elegir esta respuesta. `response.points` definido se suma al total
 * actual, arrancando en `0` si `totalPoints` era todavía `null` (primera
 * respuesta con puntuación de todo el recorrido).
 *
 * Además, aplica `response.effects ?? []` sobre `state.variables` con
 * `applyVariableEffects` (`src/domain/variables.ts`) y guarda el resultado en
 * el estado devuelto — sistema independiente de `totalPoints`, ver
 * comentario de `PlayerState`. No comprueba si la respuesta elegida sigue
 * siendo VISIBLE según su `condition`: la UI solo debe ofrecer como
 * pulsables las respuestas de `PlayerView.visibleResponses`
 * (`kind: 'decision'`), así que si esta función se llama con el `responseId`
 * de una respuesta oculta es porque quien llama no siguió ese contrato — no
 * es responsabilidad de `choose` volver a filtrar.
 */
export function choose(
  project: ProjectDocument,
  state: PlayerState,
  responseId: string,
): PlayerState {
  if (state.currentNodeId === null) return state
  const node = findNode(project, state.currentNodeId)
  if (!node || node.type !== 'slide') return state
  const response = node.responses.find((candidate) => candidate.id === responseId)
  if (!response || !response.targetNodeId) return state
  const totalPoints =
    response.points === undefined ? state.totalPoints : (state.totalPoints ?? 0) + response.points
  const afterResponseEffects = applyVariableEffects(state.variables, response.effects ?? [])
  const variables = applyVisitEffects(project, afterResponseEffects, response.targetNodeId)
  return {
    currentNodeId: response.targetNodeId,
    totalPoints,
    variables,
    shuffledResponseIds: computeShuffledResponseIds(project, response.targetNodeId),
  }
}
