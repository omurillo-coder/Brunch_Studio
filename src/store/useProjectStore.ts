import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import {
  addAudioBlock as domainAddAudioBlock,
  addImageBlock as domainAddImageBlock,
  addResponse as domainAddResponse,
  addTextBlock as domainAddTextBlock,
  addVariable as domainAddVariable,
  addVideoBlock as domainAddVideoBlock,
  connect as domainConnect,
  createConnectedNode as domainCreateConnectedNode,
  createNode as domainCreateNode,
  createProject,
  deleteNode as domainDeleteNode,
  deleteVariable as domainDeleteVariable,
  disconnect as domainDisconnect,
  duplicateNode as domainDuplicateNode,
  moveContentBlock as domainMoveContentBlock,
  moveNode as domainMoveNode,
  moveNodes as domainMoveNodes,
  reorderNode as domainReorderNode,
  removeContentBlock as domainRemoveContentBlock,
  removeResponse as domainRemoveResponse,
  updateNode as domainUpdateNode,
  updateResponse as domainUpdateResponse,
  updateTextBlockBody as domainUpdateTextBlockBody,
  updateVariable as domainUpdateVariable,
} from '../domain'
import type {
  AddVariableInput,
  CreateNodeExtra,
  NodeMove,
  NodeType,
  UpdateNodePatch,
  UpdateResponsePatch,
  UpdateVariablePatch,
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
 * "la selección no se persiste en el `.brunch`" (no está en `project`) y
 * "la selección no pasa por el historial de undo/redo" (no está en
 * `history`).
 *
 * Drag de nodos en una sola entrada de historial (uno o varios nodos):
 * `@xyflow/react` reporta, en el tercer argumento de `onNodeDragStart`/
 * `onNodeDrag`/`onNodeDragStop`, el array de TODOS los nodos que participan
 * del gesto (una selección múltiple arrastrada junta incluye a todos los
 * seleccionados, no solo al que está bajo el puntero). `beginNodeDrag
 * (nodeIds)` guarda un snapshot del documento tal y como estaba justo antes
 * de arrastrar, más la posición de origen de CADA nodo de `nodeIds`.
 * `updateNodeDragPosition(positions)` solo actualiza la posición en caliente
 * de cada nodo indicado (mutación directa de `project`, fuera del
 * historial) para feedback visual continuo durante el arrastre. Ambas
 * acciones ignoran cualquier nodo que no forme parte del arrastre en curso
 * (`drag.items`), por si `@xyflow/react` reportara un id inesperado.
 *
 * `endNodeDrag()` compara, para cada nodo arrastrado, su posición final (la
 * que quedó tras el último `updateNodeDragPosition`) contra su posición de
 * origen guardada en `beginNodeDrag`:
 *   - Si NINGUNO cambió (mismo `x` e `y` en todos) — incluye el caso de que
 *     nunca se llamara a `updateNodeDragPosition`, p.ej. un click sin
 *     arrastre real, o el usuario "cancela" devolviendo los nodos a su
 *     sitio — NO se genera ninguna entrada de historial ni se llama a
 *     `moveNodes` de dominio. Criterio elegido: comparar la posición contra
 *     el origen, no contar cuántas veces se llamó a
 *     `updateNodeDragPosition`, porque un usuario puede mover el ratón de
 *     un lado a otro y devolver los nodos exactamente a su sitio — eso
 *     tampoco debería generar una entrada vacía.
 *   - Si alguno cambió, se aplica `moveNodes` de dominio (una única llamada,
 *     con las posiciones finales de TODOS los nodos que cambiaron) sobre el
 *     snapshot guardado en `beginNodeDrag` (no sobre el estado "en
 *     caliente"), se empuja ese snapshot a `history.past` y se vacía
 *     `history.future` — una única entrada, igual que cualquier otra acción
 *     de dominio, y que deshace/rehace el movimiento de todos los nodos a
 *     la vez, no solo el del nodo "principal" bajo el puntero.
 *
 * Auto-layout del lienzo (`applyLayout`), botón "Ordenar automáticamente":
 * `Canvas` calcula el layout con la función pura `computeAutoLayout`
 * (`src/editor/Canvas/layout/autoLayout.ts`, basada en `@dagrejs/dagre`) a
 * partir del `project` actual y pasa el resultado tal cual a esta acción,
 * que solo delega en `moveNodes` de dominio (mismo patrón que
 * `endNodeDrag`: una única llamada, una única entrada de historial
 * deshacible con un solo `Ctrl/Cmd+Z`). A diferencia del arrastre, no hay
 * fase "en caliente" (`beginNodeDrag`/`updateNodeDragPosition`): es una
 * acción directa, sin snapshot intermedio, porque no hay ningún gesto de
 * puntero que seguir en pantalla. Si `moves` llega vacío (proyecto sin
 * nodos, caso que no debería darse en la práctica) no hace nada, para no
 * generar una entrada de historial vacía.
 *
 * Foco de lienzo (`ui.focusRequestNodeId`), fase 5:
 * `LeftPanel` no debe conocer `@xyflow/react` ni la instancia de React Flow,
 * así que la comunicación "centra la vista en este nodo" pasa por este
 * estado transitorio: `focusNode(id)` selecciona el nodo (igual que
 * `selectNode`) y además fija `focusRequestNodeId`. El componente del
 * lienzo se suscribe a ese campo; cuando cambia a un id no nulo, centra la
 * vista y llama a `clearFocusRequest()` para no repetir el centrado en
 * renders posteriores (p.ej. si el usuario mueve la cámara a mano después).
 *
 * Crear+conectar desde el menú contextual del lienzo, fase 7:
 * `createConnectedNodeFromMenu(type, position)` es la acción que dispara el
 * botón elegido en el menú "¿Qué quieres añadir?" (`ConnectionMenu`), que se
 * abre al soltar una conexión arrastrada desde un handle real sobre una zona
 * vacía del lienzo (ver `Canvas.handleConnectEnd` y
 * `handles.resolveEmptyPaneDrop`). Lee el origen (`ui.contextMenu.
 * originNodeId`/`originResponseId`) fijado por `openContextMenu`, llama UNA
 * vez a `createConnectedNode` de dominio (crear + conectar es una única
 * entrada de historial, no dos) y en el mismo `set` selecciona el nodo
 * nuevo, pide el foco de su título (`ui.titleFocusRequestNodeId`, ver más
 * abajo) y cierra el menú. `position` llega ya en coordenadas de lienzo: la
 * conversión desde la posición de pantalla guardada en `ui.contextMenu.
 * position` la hace quien llama (`Canvas`, con `screenToFlowPosition` de la
 * instancia de React Flow) justo en el momento de confirmar la creación —
 * este store nunca importa `@xyflow/react`, así que no puede hacer esa
 * conversión él mismo.
 *
 * Foco de título del Inspector (`ui.titleFocusRequestNodeId`), fase 7:
 * mismo patrón que `focusRequestNodeId`, pero deliberadamente un campo
 * separado: seleccionar un nodo desde `LeftPanel` o desde el propio lienzo
 * NO debe robarle el foco al usuario, solo el flujo "crear nodo desde el
 * menú contextual" debe hacerlo (es la única vía que fija este campo).
 * `Inspector` se suscribe a él; cuando coincide con el nodo seleccionado,
 * enfoca su input de título y llama a `clearTitleFocusRequest()`.
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
  // -- Orden de aparición en el panel izquierdo (puramente organizativo,
  // -- ver `src/domain/nodeOrder.ts`: no afecta al recorrido/export/
  // -- auto-layout) --
  reorderNode: (nodeId: string, toIndex: number) => void
  updateNode: (nodeId: string, patch: UpdateNodePatch) => void
  addResponse: (slideNodeId: string) => void
  removeResponse: (slideNodeId: string, responseId: string) => void
  updateResponse: (slideNodeId: string, responseId: string, patch: UpdateResponsePatch) => void
  connect: (sourceNodeId: string, targetNodeId: string, responseId?: string) => void
  disconnect: (sourceNodeId: string, responseId?: string) => void

  // -- Bloques de contenido de una diapositiva (milestone "Bloques de
  // -- contenido", fase 2 - editor): envuelven las funciones puras de
  // -- `src/domain/content.ts`, mismo patrón de historial (una entrada por
  // -- acción) que el resto de acciones de dominio de arriba --
  addTextBlock: (slideNodeId: string, index?: number) => void
  addImageBlock: (slideNodeId: string, assetId: string, index?: number) => void
  addAudioBlock: (slideNodeId: string, assetId: string, index?: number) => void
  addVideoBlock: (slideNodeId: string, assetId: string, index?: number) => void
  updateTextBlockBody: (slideNodeId: string, blockId: string, body: string) => void
  removeContentBlock: (slideNodeId: string, blockId: string) => void
  moveContentBlock: (slideNodeId: string, blockId: string, toIndex: number) => void

  // -- Duplicar una diapositiva/final (Tarea 1 de "Duplicar diapositivas"):
  // -- una única entrada de historial, misma familia que el resto de
  // -- acciones de dominio de arriba. Calcula un offset pequeño respecto al
  // -- original (ver comentario de la implementación) y selecciona la copia
  // -- recién creada, mismo criterio que `createConnectedNodeFromMenu`.
  duplicateNode: (nodeId: string) => void

  // -- Variables del proyecto (fase 1 de "Variables/condiciones"): mismo
  // -- patrón que el resto de acciones de dominio, una entrada de historial
  // -- por acción --
  addVariable: (input: AddVariableInput) => void
  updateVariable: (variableId: string, patch: UpdateVariablePatch) => void
  deleteVariable: (variableId: string) => void

  // -- Crear + conectar en una sola operación desde el menú contextual del
  // -- lienzo ("¿Qué quieres añadir?", fase 7) --
  createConnectedNodeFromMenu: (type: NodeType, position: NodePosition) => void

  // -- Drag de nodos (una única entrada de historial al finalizar; soporta
  // -- uno o varios nodos a la vez, ver `DragState`) --
  beginNodeDrag: (nodeIds: string[]) => void
  updateNodeDragPosition: (positions: { nodeId: string; position: NodePosition }[]) => void
  endNodeDrag: () => void

  // -- Auto-layout del lienzo: aplica un layout calculado externamente
  // -- (`computeAutoLayout`) en una única entrada de historial. Sin fase de
  // -- arrastre en caliente, ver comentario de diseño más arriba.
  applyLayout: (moves: NodeMove[]) => void

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

  // -- Portapapeles interno de duplicar con Ctrl/Cmd+C/V (transitorio; ver
  // -- `UiState.clipboardNodeIds` y `useCanvasClipboard` en
  // -- `src/editor/Canvas/`) --
  setClipboardNodeIds: (nodeIds: string[]) => void

  // -- Foco de lienzo (transitorio; ver `UiState.focusRequestNodeId`) --
  focusNode: (nodeId: string) => void
  clearFocusRequest: () => void

  // -- Foco de título del Inspector (transitorio; ver
  // -- `UiState.titleFocusRequestNodeId`) --
  clearTitleFocusRequest: () => void

  // -- Centro visible del lienzo (transitorio; ver
  // -- `UiState.viewportCenter`), tarea 4 --
  setViewportCenter: (position: NodePosition | null) => void
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
      focusRequestNodeId: null,
      titleFocusRequestNodeId: null,
      viewportCenter: null,
      clipboardNodeIds: [],
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
        // Higiene de selección: si el nodo borrado estaba seleccionado, se
        // quita para no dejar `selection.selectedNodeIds` apuntando a un id
        // que ya no existe en el documento.
        state.selection.selectedNodeIds = state.selection.selectedNodeIds.filter(
          (id) => id !== nodeId,
        )
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

    reorderNode: (nodeId, toIndex) => {
      const next = domainReorderNode(get().project, nodeId, toIndex)
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

    addResponse: (slideNodeId) => {
      const next = domainAddResponse(get().project, slideNodeId)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    removeResponse: (slideNodeId, responseId) => {
      const next = domainRemoveResponse(get().project, slideNodeId, responseId)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    updateResponse: (slideNodeId, responseId, patch) => {
      const next = domainUpdateResponse(get().project, slideNodeId, responseId, patch)
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

    addTextBlock: (slideNodeId, index) => {
      const next = domainAddTextBlock(get().project, slideNodeId, index)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    addImageBlock: (slideNodeId, assetId, index) => {
      const next = domainAddImageBlock(get().project, slideNodeId, assetId, index)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    addAudioBlock: (slideNodeId, assetId, index) => {
      const next = domainAddAudioBlock(get().project, slideNodeId, assetId, index)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    addVideoBlock: (slideNodeId, assetId, index) => {
      const next = domainAddVideoBlock(get().project, slideNodeId, assetId, index)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    updateTextBlockBody: (slideNodeId, blockId, body) => {
      const next = domainUpdateTextBlockBody(get().project, slideNodeId, blockId, body)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    removeContentBlock: (slideNodeId, blockId) => {
      const next = domainRemoveContentBlock(get().project, slideNodeId, blockId)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    moveContentBlock: (slideNodeId, blockId, toIndex) => {
      const next = domainMoveContentBlock(get().project, slideNodeId, blockId, toIndex)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    duplicateNode: (nodeId) => {
      const current = get().project
      const source = current.graph.nodes.find((node) => node.id === nodeId)
      // Guarda defensiva: el nodo podría haber desaparecido entre pintar el
      // botón/atajo y disparar la acción (p.ej. borrado desde otra parte de
      // la UI en el mismo tick). `duplicateNode` de dominio lanzaría en ese
      // caso; se ignora en silencio en vez de romper la UI, mismo criterio
      // que `handleConnect`/`handleNodesDelete` en `Canvas`.
      if (!source) return

      // Offset pequeño respecto al original para que la copia no quede
      // exactamente encima (mismo problema que resolvía `nextCascadePosition`
      // en `LeftPanel`, pero aquí basta un offset fijo: ya sabemos de dónde
      // parte la copia, a diferencia de una creación "desde cero").
      const position = { x: source.position.x + 40, y: source.position.y + 40 }
      const { project: next, nodeId: newNodeId } = domainDuplicateNode(current, nodeId, position)

      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
        state.selection.selectedNodeIds = [newNodeId]
      })
    },

    addVariable: (input) => {
      const next = domainAddVariable(get().project, input)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    updateVariable: (variableId, patch) => {
      const next = domainUpdateVariable(get().project, variableId, patch)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    deleteVariable: (variableId) => {
      const next = domainDeleteVariable(get().project, variableId)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
      })
    },

    createConnectedNodeFromMenu: (type, position) => {
      const { contextMenu } = get().ui
      // Guarda defensiva: sin menú abierto o sin nodo de origen no hay nada
      // que crear ni conectar. No debería ocurrir a través de la UI (solo
      // `ConnectionMenu` llama a esta acción, y solo se monta con el menú
      // abierto), pero evita dejar el proyecto en un estado inconsistente si
      // se invocara fuera de ese flujo.
      if (!contextMenu.open || !contextMenu.originNodeId) return

      const { project: next, nodeId } = domainCreateConnectedNode(
        get().project,
        type,
        position,
        contextMenu.originNodeId,
        contextMenu.originResponseId ?? undefined,
      )

      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
        state.selection.selectedNodeIds = [nodeId]
        state.ui.titleFocusRequestNodeId = nodeId
        state.ui.contextMenu = emptyContextMenu
      })
    },

    beginNodeDrag: (nodeIds) => {
      const snapshot = get().project
      const items = nodeIds.flatMap((nodeId) => {
        const node = snapshot.graph.nodes.find((candidate) => candidate.id === nodeId)
        return node ? [{ nodeId, originPosition: { x: node.position.x, y: node.position.y } }] : []
      })
      if (items.length === 0) return
      set((state) => {
        state.drag = { items, snapshot: snapshot as ProjectDocument }
      })
    },

    updateNodeDragPosition: (positions) => {
      const drag = get().drag
      if (!drag) return
      const draggedIds = new Set(drag.items.map((item) => item.nodeId))
      set((state) => {
        for (const { nodeId, position } of positions) {
          if (!draggedIds.has(nodeId)) continue
          const node = state.project.graph.nodes.find((candidate) => candidate.id === nodeId)
          if (node) {
            node.position.x = position.x
            node.position.y = position.y
          }
        }
      })
    },

    endNodeDrag: () => {
      const drag = get().drag
      if (!drag) return

      const currentNodes = get().project.graph.nodes
      const moves = drag.items
        .map((item) => {
          const currentNode = currentNodes.find((candidate) => candidate.id === item.nodeId)
          const finalPosition = currentNode?.position ?? item.originPosition
          return { nodeId: item.nodeId, position: finalPosition, changed: !samePosition(finalPosition, item.originPosition) }
        })
        .filter((move) => move.changed)
        .map(({ nodeId, position }) => ({ nodeId, position }))

      if (moves.length === 0) {
        set((state) => {
          state.drag = null
        })
        return
      }

      const next = domainMoveNodes(drag.snapshot, moves)
      set((state) => {
        state.history.past.push(drag.snapshot)
        state.history.future = []
        state.project = next
        state.drag = null
      })
    },

    applyLayout: (moves) => {
      if (moves.length === 0) return
      const next = domainMoveNodes(get().project, moves)
      set((state) => {
        state.history.past.push(state.project as ProjectDocument)
        state.history.future = []
        state.project = next
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
          focusRequestNodeId: null,
          titleFocusRequestNodeId: null,
          viewportCenter: null,
          clipboardNodeIds: [],
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

    setClipboardNodeIds: (nodeIds) => {
      set((state) => {
        state.ui.clipboardNodeIds = [...nodeIds]
      })
    },

    focusNode: (nodeId) => {
      set((state) => {
        state.selection.selectedNodeIds = [nodeId]
        state.ui.focusRequestNodeId = nodeId
      })
    },

    clearFocusRequest: () => {
      set((state) => {
        state.ui.focusRequestNodeId = null
      })
    },

    clearTitleFocusRequest: () => {
      set((state) => {
        state.ui.titleFocusRequestNodeId = null
      })
    },

    setViewportCenter: (position) => {
      set((state) => {
        state.ui.viewportCenter = position
      })
    },
  })),
)
