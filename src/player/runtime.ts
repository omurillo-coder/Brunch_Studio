import type { ContentNode, DecisionNode, FinalNode, Node, ProjectDocument, StartNode } from '../domain'

/**
 * ---------------------------------------------------------------------------
 * Runtime del Player (fase 8)
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
 * Estas funciones nunca lanzan ante un grafo incompleto (nodo sin destino,
 * decision sin respuestas con destino, o incluso ausencia total de un nodo
 * `start`): en cualquiera de esos casos `getView` resuelve a `dead-end` en
 * vez de romperse, para que el Player pueda mostrar un mensaje en vez de
 * quedarse en blanco o lanzar una excepción durante la edición (momento en
 * el que el grafo está incompleto la mayor parte del tiempo).
 */

/**
 * Qué debe verse ahora en el Player. `node` es siempre el nodo real del
 * documento (nunca una copia): el Player es una vista de lectura sobre el
 * mismo `ProjectDocument` que edita el usuario.
 *
 * `dead-end` cubre tres situaciones distintas, todas con el mismo
 * tratamiento (mensaje de "sin continuación configurada", sin romper):
 * - Un nodo `start`/`content` sin `targetNodeId`.
 * - Un nodo `decision` sin ninguna respuesta con `targetNodeId`.
 * - Ausencia total de un nodo `start` en el documento (`node: null`): no hay
 *   ningún nodo "actual" al que apuntar, así que no hay nodo que mostrar.
 *
 * Nunca existe un `kind: 'start'`: Inicio no es una pantalla visible (ver
 * `getInitialState`), así que si el recorrido queda "atascado" en el propio
 * `start` (porque no tiene destino) se resuelve igualmente como `dead-end`,
 * sin revelar que se trata del nodo Inicio.
 */
export type PlayerView =
  | { kind: 'content'; node: ContentNode }
  | { kind: 'decision'; node: DecisionNode }
  | { kind: 'final'; node: FinalNode }
  | { kind: 'dead-end'; node: Node | null }

/**
 * Estado mínimo del recorrido: el id del nodo en el que se encuentra ahora
 * mismo, más la puntuación acumulada durante ese recorrido. Deliberadamente
 * no vive en `useProjectStore` ni pasa por su historial de undo/redo — no es
 * parte del documento, es una simulación efímera de lectura sobre él (ver
 * `PlayerScreen`).
 */
export interface PlayerState {
  /** `null` únicamente cuando el documento no tiene ningún nodo `start`. */
  currentNodeId: string | null
  /**
   * Puntuación acumulada a lo largo del recorrido (fase 5, Milestone 2).
   * `null` mientras ninguna respuesta elegida haya definido `points` —
   * deliberadamente distinto de `0`: un escenario que no usa puntuación en
   * absoluto no debe mostrar "0 puntos" en su Final, sería confuso. Pasa a
   * ser un número en cuanto se elige la primera respuesta con `points`
   * definido, y a partir de ahí solo puede crecer o decrecer (nunca vuelve a
   * `null` salvo por `restart`/`getInitialState`).
   */
  totalPoints: number | null
}

function findStartNode(project: ProjectDocument): StartNode | null {
  return project.graph.nodes.find((node): node is StartNode => node.type === 'start') ?? null
}

function findNode(project: ProjectDocument, nodeId: string): Node | null {
  return project.graph.nodes.find((node) => node.id === nodeId) ?? null
}

/**
 * Calcula el estado inicial del recorrido a partir del documento: salta
 * automáticamente desde el nodo `start` a su `targetNodeId`, tal y como pide
 * el spec ("Inicio no es una pantalla visible... al empezar el Player debe
 * saltar automáticamente"). Si `start` no tiene destino configurado, el
 * estado queda apuntando al propio `start` — `getView` lo resolverá como
 * `dead-end` sin mostrar nunca "Inicio". Si no existe ningún nodo `start`,
 * `currentNodeId` es `null`.
 */
export function getInitialState(project: ProjectDocument): PlayerState {
  const start = findStartNode(project)
  if (!start) return { currentNodeId: null, totalPoints: null }
  return { currentNodeId: start.targetNodeId ?? start.id, totalPoints: null }
}

/**
 * Reinicia el recorrido: recalcula el estado inicial desde cero (mismo
 * resultado que `getInitialState`, incluyendo el salto automático desde
 * `start`). Nombre propio para que quien la llama (`PlayerScreen`) exprese
 * la intención "reiniciar" sin tener que saber que internamente es la misma
 * función que el cálculo inicial.
 */
export function restart(project: ProjectDocument): PlayerState {
  return getInitialState(project)
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

  switch (node.type) {
    case 'start':
      // Solo se llega aquí si `start` no tenía destino configurado (ver
      // `getInitialState`): un callejón sin salida, nunca una pantalla
      // "Inicio" visible.
      return { kind: 'dead-end', node }
    case 'content':
      return node.targetNodeId ? { kind: 'content', node } : { kind: 'dead-end', node }
    case 'decision':
      return node.responses.some((response) => response.targetNodeId)
        ? { kind: 'decision', node }
        : { kind: 'dead-end', node }
    case 'final':
      return { kind: 'final', node }
  }
}

/**
 * Avanza desde una Pantalla (nodo `content`) siguiendo su `targetNodeId`.
 * Si el nodo actual no es `content` o no tiene destino configurado, no hace
 * nada y devuelve el mismo estado — la UI solo debería llamarla cuando
 * `getView` haya devuelto `kind: 'content'`.
 */
export function advance(project: ProjectDocument, state: PlayerState): PlayerState {
  if (state.currentNodeId === null) return state
  const node = findNode(project, state.currentNodeId)
  if (!node || node.type !== 'content' || !node.targetNodeId) return state
  return { ...state, currentNodeId: node.targetNodeId }
}

/**
 * Elige una respuesta desde una Decisión y avanza a su `targetNodeId`,
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
 */
export function choose(
  project: ProjectDocument,
  state: PlayerState,
  responseId: string,
): PlayerState {
  if (state.currentNodeId === null) return state
  const node = findNode(project, state.currentNodeId)
  if (!node || node.type !== 'decision') return state
  const response = node.responses.find((candidate) => candidate.id === responseId)
  if (!response || !response.targetNodeId) return state
  const totalPoints =
    response.points === undefined ? state.totalPoints : (state.totalPoints ?? 0) + response.points
  return { currentNodeId: response.targetNodeId, totalPoints }
}
