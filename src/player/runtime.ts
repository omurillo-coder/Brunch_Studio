import type { FinalNode, Node, ProjectDocument, SlideNode } from '../domain'

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
 * - Una diapositiva sin respuestas y sin `targetNodeId`.
 * - Una diapositiva con respuestas pero ninguna con `targetNodeId`.
 * - `graph.startNodeId` sin nodo correspondiente (`node: null`).
 */
export type PlayerView =
  | { kind: 'continue'; node: SlideNode }
  | { kind: 'decision'; node: SlideNode }
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
}

function findNode(project: ProjectDocument, nodeId: string): Node | null {
  return project.graph.nodes.find((node) => node.id === nodeId) ?? null
}

/**
 * Calcula el estado inicial del recorrido a partir del documento: el
 * recorrido empieza directamente en `graph.startNodeId`, la diapositiva de
 * inicio del proyecto. Ya no hay ningún nodo "Inicio" invisible del que
 * saltar automáticamente: la diapositiva de inicio es una diapositiva
 * normal y se muestra tal cual.
 *
 * Si `startNodeId` no corresponde a ningún nodo del documento (documento
 * incoherente), `currentNodeId` queda en `null` y `getView` resuelve a
 * `dead-end`.
 */
export function getInitialState(project: ProjectDocument): PlayerState {
  const start = findNode(project, project.graph.startNodeId)
  return { currentNodeId: start ? start.id : null, totalPoints: null }
}

/**
 * Reinicia el recorrido: recalcula el estado inicial desde cero (mismo
 * resultado que `getInitialState`). Nombre propio para que quien la llama
 * (`PlayerScreen`) exprese la intención "reiniciar" sin tener que saber que
 * internamente es la misma función que el cálculo inicial.
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

  if (node.type === 'final') {
    return { kind: 'final', node }
  }

  if (node.responses.length > 0) {
    return node.responses.some((response) => response.targetNodeId)
      ? { kind: 'decision', node }
      : { kind: 'dead-end', node }
  }

  return node.targetNodeId ? { kind: 'continue', node } : { kind: 'dead-end', node }
}

/**
 * Avanza desde una diapositiva "de continuar" siguiendo su `targetNodeId`.
 * Si el nodo actual no es una diapositiva sin respuestas, o no tiene destino
 * configurado, no hace nada y devuelve el mismo estado — la UI solo debería
 * llamarla cuando `getView` haya devuelto `kind: 'continue'`.
 */
export function advance(project: ProjectDocument, state: PlayerState): PlayerState {
  if (state.currentNodeId === null) return state
  const node = findNode(project, state.currentNodeId)
  if (!node || node.type !== 'slide') return state
  if (node.responses.length > 0 || !node.targetNodeId) return state
  return { ...state, currentNodeId: node.targetNodeId }
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
  return { currentNodeId: response.targetNodeId, totalPoints }
}
