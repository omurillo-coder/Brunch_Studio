import type { NodePosition, ProjectDocument, Viewport } from '../domain'

/**
 * Tipos internos del store de estado. Separados de `useProjectStore.ts`
 * para que el fichero del store se pueda leer de arriba a abajo centrado en
 * las acciones, sin el ruido de las interfaces de estado.
 */

/** Selección actual de nodos en el lienzo. Transitoria: no se persiste. */
export interface SelectionState {
  selectedNodeIds: string[]
}

/**
 * Estado del menú contextual "¿Qué quieres añadir?" que se abre al soltar
 * una conexión en un punto vacío del lienzo. Solo se modela aquí si está
 * abierto, en qué posición y desde qué nodo/respuesta de origen se soltó la
 * conexión — el menú visual en sí es responsabilidad de una fase de UI
 * posterior.
 */
export interface ContextMenuState {
  open: boolean
  position: NodePosition | null
  originNodeId: string | null
  originResponseId: string | null
}

/** Estado transitorio de interfaz que no forma parte del documento. */
export interface UiState {
  contextMenu: ContextMenuState
  hoveredNodeId: string | null
  previewMode: boolean
  /**
   * Petición de "centrar el lienzo en este nodo", fijada por `focusNode`
   * (p.ej. al hacer clic en un elemento de `LeftPanel`) y consumida por el
   * componente del lienzo (fase 5), que centra la vista y la limpia con
   * `clearFocusRequest`. Existe para que `LeftPanel` pueda pedir un
   * centrado sin conocer `@xyflow/react` ni la instancia de React Flow.
   */
  focusRequestNodeId: string | null
  /**
   * Petición de "pon el foco en el campo de título del Inspector para este
   * nodo", fijada por `createConnectedNodeFromMenu` (fase 7: crear un nodo
   * arrastrando una conexión hasta el vacío) y consumida por `Inspector`,
   * que enfoca su input de título y la limpia con `clearTitleFocusRequest`.
   * Mismo patrón que `focusRequestNodeId`, pero deliberadamente un campo
   * separado: una selección "normal" (clic en la lista o en el lienzo) no
   * debe robar el foco del usuario, solo este flujo concreto debe hacerlo.
   */
  titleFocusRequestNodeId: string | null
  /**
   * Punto (en coordenadas de lienzo) del centro de la parte VISIBLE del
   * lienzo en este momento, mantenido por `Canvas` (única pieza que conoce
   * la instancia de `@xyflow/react` y el tamaño real del contenedor) y
   * consumido por `LeftPanel` al crear un nodo nuevo desde "+ Diapositiva"/
   * "+ Final" (tarea 4), para que nazca centrado en lo que el usuario tiene
   * delante en vez de en una posición fija o en cascada. `null` mientras
   * `Canvas` todavía no ha calculado ninguno (p.ej. antes de montarse, o en
   * un test que renderiza `LeftPanel` sin `Canvas`); en ese caso quien
   * consume este campo debe usar un valor de repuesto razonable.
   */
  viewportCenter: NodePosition | null
}

/**
 * Estado de guardado, consumido por `Topbar` y gestionado por el
 * autoguardado (fase 9, ver `src/editor/EditorScreen/useAutosave.ts`).
 *
 * - `idle`: estado "de fábrica" (bootstrap inicial o justo tras
 *   `loadProject`) — el contenido en memoria coincide con el disco pero
 *   todavía no ha pasado por el ciclo de autoguardado. `useAutosave` lo
 *   consume una única vez (lo pasa a `saved`) al detectar el primer cambio
 *   posterior a un montaje/carga, precisamente para no disparar un guardado
 *   redundante en ese momento — ver comentario de diseño en `useAutosave`.
 * - `saving`: hay cambios pendientes de escribir a disco (debounce en
 *   marcha o escritura en curso).
 * - `saved`: el último guardado (o la última carga) se completó con éxito.
 * - `error`: el último intento de guardado falló. Se añade en esta fase
 *   para no fingir un "Guardado" que no ocurrió — ver la decisión de diseño
 *   documentada en `useAutosave`. No es un estado terminal: el siguiente
 *   cambio del documento vuelve a intentar guardar con normalidad.
 */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Pilas de deshacer/rehacer. Cada entrada es un snapshot completo del
 * `ProjectDocument` tal y como quedó tras una acción de dominio (ver
 * comentario de diseño en `useProjectStore.ts`).
 */
export interface HistoryState {
  past: ProjectDocument[]
  future: ProjectDocument[]
}

/**
 * Un nodo participando en el arrastre en curso, con su posición de origen
 * (la que tenía justo antes de empezar a arrastrar).
 */
export interface DragItem {
  nodeId: string
  originPosition: NodePosition
}

/**
 * Estado transitorio de un arrastre de nodos en curso. Soporta uno o varios
 * nodos a la vez (arrastrar una selección múltiple): `items` lleva uno por
 * cada nodo que participa del gesto (`@xyflow/react` los reporta todos
 * juntos en el tercer argumento de `onNodeDragStart`/`onNodeDrag`/
 * `onNodeDragStop`, ver `Canvas`). `snapshot` es el `ProjectDocument`
 * completo tal y como estaba justo antes de empezar el arrastre: es la base
 * sobre la que `endNodeDrag` aplicará `moveNodes` de dominio una única vez,
 * para los nodos cuya posición final difiera de su origen.
 */
export interface DragState {
  items: DragItem[]
  snapshot: ProjectDocument
}

export interface ProjectStoreData {
  project: ProjectDocument
  selection: SelectionState
  ui: UiState
  saveStatus: SaveStatus
  /** Interno: no pensado para lectura directa desde componentes. */
  history: HistoryState
  /** Interno: no pensado para lectura directa desde componentes. */
  drag: DragState | null
}

export type { NodePosition, ProjectDocument, Viewport }
