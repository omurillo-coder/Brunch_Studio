import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useProjectStore } from '../useProjectStore'
import { resetProjectStore } from '../testHelpers'
import {
  useCanRedo,
  useCanUndo,
  useClipboardNodeIds,
  useContextMenu,
  useDismissedDiagnosticIds,
  useFocusRequestNodeId,
  useHoveredNodeId,
  usePreviewMode,
  usePreviewStartNodeId,
  useProject,
  useSaveStatus,
  useSelectedNodeIds,
  useTitleFocusRequestNodeId,
  useViewportCenter,
} from '../selectors'

/**
 * Hallazgo de auditoría ("los 14 selectores de conveniencia del store no
 * tienen test propio"): riesgo bajo por trivialidad (cada uno es un
 * one-liner), pero un cambio de forma del estado podría no detectarse hasta
 * que fallara un componente consumidor — este archivo cierra ese hueco,
 * comprobando que cada hook lee de verdad la porción de estado que dice
 * leer (mismo criterio de nombre que su comentario de cabecera).
 */

beforeEach(() => {
  resetProjectStore()
})

describe('useProject', () => {
  it('devuelve project.metadata.name actual', () => {
    const { result } = renderHook(() => useProject())
    expect(result.current.metadata.name).toBe(useProjectStore.getState().project.metadata.name)
  })
})

describe('useCanUndo / useCanRedo', () => {
  it('ambos false con el historial vacío (proyecto recién creado)', () => {
    const canUndo = renderHook(() => useCanUndo())
    const canRedo = renderHook(() => useCanRedo())
    expect(canUndo.result.current).toBe(false)
    expect(canRedo.result.current).toBe(false)
  })

  it('useCanUndo pasa a true tras una acción que empuja historial; useCanRedo tras deshacerla', () => {
    const canUndo = renderHook(() => useCanUndo())
    const canRedo = renderHook(() => useCanRedo())

    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    })
    expect(canUndo.result.current).toBe(true)
    expect(canRedo.result.current).toBe(false)

    act(() => {
      useProjectStore.getState().undo()
    })
    expect(canUndo.result.current).toBe(false)
    expect(canRedo.result.current).toBe(true)
  })
})

describe('useSelectedNodeIds', () => {
  it('refleja selection.selectedNodeIds', () => {
    const { result } = renderHook(() => useSelectedNodeIds())
    expect(result.current).toEqual([])

    const startId = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      useProjectStore.getState().selectNode(startId)
    })
    expect(result.current).toEqual([startId])
  })
})

describe('useSaveStatus', () => {
  it('refleja saveStatus', () => {
    const { result } = renderHook(() => useSaveStatus())
    expect(result.current).toBe('idle')

    act(() => {
      useProjectStore.setState({ saveStatus: 'error' })
    })
    expect(result.current).toBe('error')
  })
})

describe('usePreviewMode / usePreviewStartNodeId', () => {
  it('ambos reflejan ui.previewMode/ui.previewStartNodeId, fijados por setPreviewMode', () => {
    const previewMode = renderHook(() => usePreviewMode())
    const previewStartNodeId = renderHook(() => usePreviewStartNodeId())
    expect(previewMode.result.current).toBe(false)
    expect(previewStartNodeId.result.current).toBeNull()

    const startId = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      useProjectStore.getState().setPreviewMode(true, startId)
    })
    expect(previewMode.result.current).toBe(true)
    expect(previewStartNodeId.result.current).toBe(startId)
  })
})

describe('useHoveredNodeId', () => {
  it('refleja ui.hoveredNodeId, fijado por setHover', () => {
    const { result } = renderHook(() => useHoveredNodeId())
    expect(result.current).toBeNull()

    const startId = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      useProjectStore.getState().setHover(startId)
    })
    expect(result.current).toBe(startId)
  })
})

describe('useContextMenu', () => {
  it('refleja ui.contextMenu, fijado por openContextMenu/closeContextMenu', () => {
    const { result } = renderHook(() => useContextMenu())
    expect(result.current.open).toBe(false)

    act(() => {
      useProjectStore.getState().openContextMenu({ position: { x: 10, y: 20 } })
    })
    expect(result.current).toMatchObject({ open: true, position: { x: 10, y: 20 } })

    act(() => {
      useProjectStore.getState().closeContextMenu()
    })
    expect(result.current.open).toBe(false)
  })
})

describe('useFocusRequestNodeId', () => {
  it('refleja ui.focusRequestNodeId, fijado por focusNode y limpiado por clearFocusRequest', () => {
    const { result } = renderHook(() => useFocusRequestNodeId())
    expect(result.current).toBeNull()

    const startId = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      useProjectStore.getState().focusNode(startId)
    })
    expect(result.current).toBe(startId)

    act(() => {
      useProjectStore.getState().clearFocusRequest()
    })
    expect(result.current).toBeNull()
  })
})

describe('useTitleFocusRequestNodeId', () => {
  it('refleja ui.titleFocusRequestNodeId, fijado al crear un nodo desde el menú "¿Qué quieres añadir?"', () => {
    const { result } = renderHook(() => useTitleFocusRequestNodeId())
    expect(result.current).toBeNull()

    const startId = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      useProjectStore.getState().openContextMenu({ position: { x: 0, y: 0 }, originNodeId: startId })
      useProjectStore.getState().createConnectedNodeFromMenu('final', { x: 100, y: 0 })
    })
    expect(result.current).not.toBeNull()

    act(() => {
      useProjectStore.getState().clearTitleFocusRequest()
    })
    expect(result.current).toBeNull()
  })
})

describe('useViewportCenter', () => {
  it('refleja ui.viewportCenter, fijado por setViewportCenter', () => {
    const { result } = renderHook(() => useViewportCenter())
    expect(result.current).toBeNull()

    act(() => {
      useProjectStore.getState().setViewportCenter({ x: 100, y: 200 })
    })
    expect(result.current).toEqual({ x: 100, y: 200 })
  })
})

describe('useClipboardNodeIds', () => {
  it('refleja ui.clipboardNodeIds, fijado por setClipboardNodeIds', () => {
    const { result } = renderHook(() => useClipboardNodeIds())
    expect(result.current).toEqual([])

    const startId = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      useProjectStore.getState().setClipboardNodeIds([startId])
    })
    expect(result.current).toEqual([startId])
  })
})

describe('useDismissedDiagnosticIds', () => {
  it('refleja ui.dismissedDiagnosticIds, fijado por dismissDiagnostic y limpiado por restoreDismissedDiagnostics', () => {
    const { result } = renderHook(() => useDismissedDiagnosticIds())
    expect(result.current).toEqual([])

    act(() => {
      useProjectStore.getState().dismissDiagnostic('cycle:a,b')
    })
    expect(result.current).toEqual(['cycle:a,b'])

    act(() => {
      useProjectStore.getState().restoreDismissedDiagnostics()
    })
    expect(result.current).toEqual([])
  })
})

describe('aislamiento de re-render (el motivo de ser de estos selectores, ver comentario de cabecera de selectors.ts)', () => {
  it('useCanUndo no cambia de valor (ni de referencia primitiva) cuando cambia una porción de estado no relacionada (selection)', () => {
    const { result } = renderHook(() => useCanUndo())
    expect(result.current).toBe(false)

    const startId = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      useProjectStore.getState().selectNode(startId)
    })

    // `selectNode` no toca `history`, así que useCanUndo sigue en `false` —
    // no es una prueba de recuento de renders (Zustand ya se encarga de la
    // suscripción selectiva), sino de que el propio VALOR leído es el
    // correcto y no se contamina entre slices.
    expect(result.current).toBe(false)
  })
})
