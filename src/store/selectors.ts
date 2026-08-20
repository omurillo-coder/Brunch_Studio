import { useProjectStore } from './useProjectStore'

/**
 * Hooks de selector "de conveniencia". Cada uno se suscribe solo a la
 * porción de estado que le interesa, para que un componente que por ejemplo
 * solo necesita saber si puede deshacer no vuelva a renderizar cuando
 * cambia la posición de un nodo.
 *
 * Deliberadamente no se expone un hook "léelo todo" (`useProjectStore()`
 * sin selector) como API de conveniencia: forzaría re-render en cualquier
 * cambio de cualquier slice. Los componentes que necesiten varias porciones
 * deben llamar a varios hooks de selector, o definir uno nuevo específico
 * cuando surja la necesidad real (fase de UI).
 */

export const useProject = () => useProjectStore((state) => state.project)

export const useCanUndo = () => useProjectStore((state) => state.history.past.length > 0)

export const useCanRedo = () => useProjectStore((state) => state.history.future.length > 0)

export const useSelectedNodeIds = () =>
  useProjectStore((state) => state.selection.selectedNodeIds)

export const useSaveStatus = () => useProjectStore((state) => state.saveStatus)

export const usePreviewMode = () => useProjectStore((state) => state.ui.previewMode)

export const useHoveredNodeId = () => useProjectStore((state) => state.ui.hoveredNodeId)

export const useContextMenu = () => useProjectStore((state) => state.ui.contextMenu)

export const useFocusRequestNodeId = () => useProjectStore((state) => state.ui.focusRequestNodeId)

export const useTitleFocusRequestNodeId = () =>
  useProjectStore((state) => state.ui.titleFocusRequestNodeId)
