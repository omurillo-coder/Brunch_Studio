import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import {
  addResponse as domainAddResponse,
  connect as domainConnect,
  createNode as domainCreateNode,
  createProject,
  deleteNode as domainDeleteNode,
  disconnect as domainDisconnect,
  moveNode as domainMoveNode,
  removeResponse as domainRemoveResponse,
  updateNode as domainUpdateNode,
} from '../domain'
import type {
  CreateNodeExtra,
  NodeType,
  UpdateNodePatch,
} from '../domain'
import type {
  ContextMenuState,
  NodePosition,
  ProjectDocument,
  ProjectStoreData,
  Viewport,
} from './types'

/**
 * ---------------------------------------------------------------------------
 * Diseño del store
 * ---------------------------------------------------------------------------
 *
 * Nombre: `useProjectStore`. Es el único store de la app en esta fase; el
 * prefijo `useProject` (en vez de algo genérico como `useAppStore`) deja
 * claro que su contenido gira alrededor de un `ProjectDocument`, que es con
 * diferencia el dato más importante que gestiona.
 *
 * Zustand + Immer: se usa el middleware `zustand/middleware/immer` (en vez
 * de llamar a `produce` a mano dentro de cada `set`). Motivo: la mayoría de
 * acciones de este store no son "reemplazar `project` por un documento
 * nuevo" (eso ya lo hacen las funciones puras de `src/domain`, que devuelven
 * un `ProjectDocument` inmutable listo para usar) sino mutaciones de slices
 * más pequeños — empujar a `history.past`, vaciar `history.future`, hacer
 * push/filter en `selection.selectedNodeIds`, cambiar un campo de `ui`—. El
 * middleware permite escribir esas mutaciones como mutaciones directas del
 * draft (`state.history.past.push(...)`, `state.ui.hoveredNodeId = id`) sin
 * repetir spreads anidados en cada acción, y asignar un `ProjectDocument`
 * completo a `state.project` sigue funcionando igual de bien (Immer no
 * envuelve en proxy un valor que se asigna tal cual, solo lo guarda).
 *
 * Historial: snapshots completos del documento, no patches de Immer.
 * - Cada entrada de `history.past`/`history.future` es un `ProjectDocument`
 *   completo (el estado *anterior* a la acción que se deshace/rehace).
 * - Alternativa descartada: usar `produceWithPatches` y guardar
 *   patches/patches-inversos. Con el tamaño esperado de un proyecto de este
 *   editor (decenas/cientos de nodos, no miles) el coste de memoria de un
 *   snapshot completo es insignificante, y los snapshots son mucho más
 *   fáciles de razonar correctamente: no hay que preocuparse por componer
 *   patches a través de acciones distintas, por cómo interactúan con
 *   `loadProject` (que debe poder resetear las pilas sin más), ni por cómo
 *   convive el patch-based undo con la fusión de múltiples eventos de un
 *   drag en una sola entrada. Simplicidad y corrección priman sobre
 *   micro-optimizar memoria en esta fase.
 * - No hay límite de tamaño de las pilas todavía (ver "Pendientes").
 *
 * Viewport fuera del historial:
 * `editor.viewport` vive dentro de `ProjectDocument` (así lo exige el
 * esquema de dominio), pero sus cambios (`setViewport`) no tocan las pilas
 * de historial en absoluto. Para que además el viewport actual sobreviva a
 * un `undo()`/`redo()` de una acción de dominio anterior (los snapshots del
 * historial llevan "congelado" el viewport de cuando se guardaron), al
 * restaurar un snapshot en `undo`/`redo` se le sustituye su `editor.viewport`
 * por el viewport *actual* antes de aplicarlo como nuevo estado. Es el único
 * punto donde se hace esta sustitución, así que basta con acertar ahí.
 *
 * Selección/UI fuera del documento y fuera del historial:
 * `selection` y `ui` son slices propios del store, nunca parte de
 * `project`, y ninguna acción de undo/redo los toca. Así se cumple a la vez
 * "la selección no se persiste en el `.branch`" (no está en `project`) y
 * "la selección no pasa por el historial de undo/redo" (no está en
 * `history`).
 *
 * Drag de nodos en una sola entrada de historial:
 * `beginNodeDrag(nodeId)` guarda un snapshot del documento tal y como
 * estaba justo antes de arrastrar, más la posición de origen del nodo.
 * `updateNodeDragPosition(nodeId, position)` solo actualiza la posición en
 * caliente (mutación directa de `project`, fuera del historial) para
 * feedback visual continuo durante el arrastre. `endNodeDrag()` compara la
 * posición final (la que quedó tras el último `updateNodeDragPosition`)
 * contra la posición de origen guardada en `beginNodeDrag`:
 *   - Si son iguales (mismo `x` e `y`) — incluye el caso de que nunca se
 *     llamara a `updateNodeDragPosition`, p.ej. un click sin arrastre real,
 *     o el usuario "cancela" volviendo el nodo a su sitio — NO se genera
 *     ninguna entrada de historial ni se llama a `moveNode` de dominio.
 *     Criterio elegido: comparar la posición contra el origen, no contar
 *     cuántas veces se llamó a `updateNodeDragPosition`, porque un usuario
 *     puede mover el ratón de un lado a otro y devolver el nodo exactamente
 *     a su sitio — eso tampoco debería generar una entrada vacía.
 *   - Si son distintas, se aplica `moveNode` de dominio sobre el snapshot
 *     guardado en `beginNodeDrag` (no sobre el estado "en caliente"), se
 *     empuja ese snapshot a `history.past` y se vacía `history.future` — una
 *     única entrada, igual que cualquier otra acción de dominio.
 *
 * Reset entre tests:
 * Zustand no ofrece un "reset" de fábrica. El patrón elegido (ver
 * `testHelpers.ts`) es exportar una función `createInitialState()` y, en
 * los tests, llamar a `useProjectStore.setState(createInitialState())` en
 * un `beforeEach`. Se usa `setState` en modo *merge* (el que aplica por
 * defecto, `shouldReplace` a `false`) en vez de modo *replace*: como las
 * acciones viven en el mismo objeto de estado que los datos, un replace
 * completo también borraría las acciones. Con merge se sustituyen solo las
 * claves de datos (`project`, `selection`, `ui`, `saveStatus`, `history`,
 * `drag`) y las acciones quedan intactas.
 */

export interface ProjectStoreActions {
  // -- Acciones de dominio (delegan en src/domain; el store solo orquesta
  // -- el historial) --
  createNode: (type: NodeType, position: NodePosition, extra?: CreateNodeExtra) => void
  deleteNode: (nodeId: string) => void
  moveNode: (nodeId: string, position: NodePosition) => void
  updateNode: (nodeId: string, patch: UpdateNodePatch) => void
  addResponse: (decisionNodeId: string) => void
  removeResponse: (decisionNodeId: string, responseId: string) => void
  connect: (sourceNodeId: string, targetNodeId: string, responseId?: string) => void
  disconnect: (sourceNodeId: string, responseId?: string) => void

  // -- Drag de nodos (una única entrada de historial al finalizar) --
  beginNodeDrag: (nodeId: string) => void
  updateNodeDragPosition: (nodeId: string, position: NodePosition) => void
  endNodeDrag: () => void

  // -- Historial --
  undo: () => void
  redo: () => void

  // -- Carga de documento completo (futura fase de persistencia) --
  loadProject: (document: ProjectDocument) => void

  // -- Viewport (fuera del historial) --
  setViewport: (viewport: Viewport) => void

  // -- Selección (transitoria, slice propio) --
  setSelection: (nodeIds: string[]) => void
  selectNode: (nodeId: string, options?: { additive?: boolean }) => void
  clearSelection: () => void

  // -- UI transitoria --
  openContextMenu: (payload: {
    position: NodePosition
    originNodeId?: string
    originResponseId?: string
  }) => void
  closeContextMenu: () => void
  setHover: (nodeId: string | null) => void
  setPreviewMode: (enabled: boolean) => void
}

export type ProjectStoreState = ProjectStoreData & ProjectStoreActions

const emptyContextMenu: ContextMenuState = {
  open: false,
  position: null,
  originNodeId: null,
  originResponseId: null,
}

/** Estado inicial "de fábrica": un proyecto nuevo y todo lo transitorio vacío. */
export function createInitialState(): ProjectStoreData {
  return {
    project: createProject('Untitled'),
    selection: { selectedNodeIds: [] },
    ui: {
      contextMenu: emptyContextMenu,
      hoveredNodeId: null,
      previewMode: false,
    },
    saveStatus: 'idle',
    history: { past: [], future: [] },
    drag: null,
  }
}

function samePosition(a: NodePosition, b: NodePosition): boolean {
  return a.x === b.x && a.y === b.y
}

export const useProjectStore = create<ProjectStoreState>()(
  immer((set, get) => ({
    ...createInitialState(),

    createNode: (type, position, extra) => {
      const next = domainCreateNode(get().project, type, position, extra)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    deleteNode: (nodeId) => {
      const next = domainDeleteNode(get().project, nodeId)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    moveNode: (nodeId, position) => {
      const next = domainMoveNode(get().project, nodeId, position)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    updateNode: (nodeId, patch) => {
      const next = domainUpdateNode(get().project, nodeId, patch)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    addResponse: (decisionNodeId) => {
      const next = domainAddResponse(get().project, decisionNodeId)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    removeResponse: (decisionNodeId, responseId) => {
      const next = domainRemoveResponse(get().project, decisionNodeId, responseId)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    connect: (sourceNodeId, targetNodeId, responseId) => {
      const next = domainConnect(get().project, sourceNodeId, targetNodeId, responseId)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    disconnect: (sourceNodeId, responseId) => {
      const next = domainDisconnect(get().project, sourceNodeId, responseId)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    beginNodeDrag: (nodeId) => {
      const snapshot = get().project
      const node = snapshot.graph.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      set((state) => {
        state.drag = {
          nodeId,
          originPosition: { x: node.position.x, y: node.position.y },
          snapshot: snapshot as ProjectDocument,
        }
      })
    },

    updateNodeDragPosition: (nodeId, position) => {
      const drag = get().drag
      if (!drag || drag.nodeId !== nodeId) return
      set((state) => {
        const node = state.project.graph.nodes.find((candidate) => candidate.id === nodeId)
        if (node) {
          node.position.x = position.x
          node.position.y = position.y
        }
      })
    },

    endNodeDrag: () => {
      const drag = get().drag
      if (!drag) return

      const currentNode = get().project.graph.nodes.find(
        (candidate) => candidate.id === drag.nodeId,
      )
      const finalPosition = currentNode?.position ?? drag.originPosition

      if (samePosition(finalPosition, drag.originPosition)) {
        set((state) => {
          state.drag = null
        })
        return
      }

      const next = domainMoveNode(drag.snapshot, drag.nodeId, finalPosition)
      set((state) => {
        state.history.past.push(drag.snapshot)
        state.history.future = []
        state.project = next
        state.drag = null
      })
    },

    undo: () => {
      const { history, project } = get()
      if (history.past.length === 0) return
      set((state) => {
        const restored = state.history.past.pop() as ProjectDocument
        state.history.future.push(project)
        state.project = {
          ...restored,
          editor: { ...restored.editor, viewport: project.editor.viewport },
        }
      })
    },

    redo: () => {
      const { history, project } = get()
      if (history.future.length === 0) return
      set((state) => {
        const restored = state.history.future.pop() as ProjectDocument
        state.history.past.push(project)
        state.project = {
          ...restored,
          editor: { ...restored.editor, viewport: project.editor.viewport },
        }
      })
    },

    loadProject: (document) => {
      set((state) => {
        state.project = document
        state.history = { past: [], future: [] }
        state.selection = { selectedNodeIds: [] }
        state.ui = {
          contextMenu: emptyContextMenu,
          hoveredNodeId: null,
          previewMode: false,
        }
        state.saveStatus = 'idle'
        state.drag = null
      })
    },

    setViewport: (viewport) => {
      set((state) => {
        state.project.editor.viewport = viewport
      })
    },

    setSelection: (nodeIds) => {
      set((state) => {
        state.selection.selectedNodeIds = [...nodeIds]
      })
    },

    selectNode: (nodeId, options) => {
      set((state) => {
        const additive = options?.additive ?? false
        if (!additive) {
          state.selection.selectedNodeIds = [nodeId]
          return
        }
        const current = state.selection.selectedNodeIds
        if (current.includes(nodeId)) {
          state.selection.selectedNodeIds = current.filter((id) => id !== nodeId)
        } else {
          current.push(nodeId)
        }
      })
    },

    clearSelection: () => {
      set((state) => {
        state.selection.selectedNodeIds = []
      })
    },

    openContextMenu: (payload) => {
      set((state) => {
        state.ui.contextMenu = {
          open: true,
          position: payload.position,
          originNodeId: payload.originNodeId ?? null,
          originResponseId: payload.originResponseId ?? null,
        }
      })
    },

    closeContextMenu: () => {
      set((state) => {
        state.ui.contextMenu = emptyContextMenu
      })
    },

    setHover: (nodeId) => {
      set((state) => {
        state.ui.hoveredNodeId = nodeId
      })
    },

    setPreviewMode: (enabled) => {
      set((state) => {
        state.ui.previewMode = enabled
      })
    },
  })),
)
