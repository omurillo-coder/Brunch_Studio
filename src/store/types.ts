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
}

/** Estado de guardado expuesto para una futura fase de autoguardado. */
export type SaveStatus = 'idle' | 'saving' | 'saved'

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
 * Estado transitorio de un arrastre de nodo en curso. `snapshot` es el
 * `ProjectDocument` completo tal y como estaba justo antes de empezar el
 * arrastre: es la base sobre la que `endNodeDrag` aplicará `moveNode` de
 * dominio una única vez.
 */
export interface DragState {
  nodeId: string
  originPosition: NodePosition
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
