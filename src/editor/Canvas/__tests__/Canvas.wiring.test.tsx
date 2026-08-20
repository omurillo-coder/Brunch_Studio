import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactFlowProps } from '@xyflow/react'
import { resetProjectStore } from '../../../store/testHelpers'
import { useProjectStore } from '../../../store'
import { toFlowNodes } from '../adapter'
import { responseHandleId } from '../handles'
import { Canvas } from '../Canvas'

/**
 * Tests de "cableado" de `Canvas`: en vez de simular gestos de puntero
 * reales contra `@xyflow/react` (frágil en jsdom, ver comentario en
 * `Canvas.test.tsx`), se sustituye el componente `ReactFlow` por un stub que
 * captura las props que `Canvas` le pasa, y se invocan directamente los
 * callbacks relevantes (`onConnect`, `onSelectionChange`, `onMoveEnd`,
 * `onNodeDragStart`/`onNodeDrag`/`onNodeDragStop`, `onInit`) tal y como
 * `@xyflow/react` los invocaría de verdad. `Background`/`Controls` también
 * se sustituyen por no-ops: no aportan nada a estos tests y evitan montar
 * el motor de medición interno de la librería.
 */

let capturedProps: ReactFlowProps | undefined

// `vi.mock` se "hoistea" por encima de los imports de este fichero (igual
// que en Jest), así que el `import { Canvas } from '../Canvas'` de arriba
// ya recibe esta versión mockeada de `@xyflow/react`.
vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react')
  return {
    ...actual,
    ReactFlow: (props: ReactFlowProps) => {
      capturedProps = props
      return null
    },
    Background: () => null,
    Controls: () => null,
  }
})

beforeEach(() => {
  resetProjectStore()
  capturedProps = undefined
})

function firstNodeOfType(type: 'start' | 'content' | 'decision' | 'final') {
  const node = useProjectStore.getState().project.graph.nodes.find((n) => n.type === type)
  if (!node) throw new Error(`No hay nodo de tipo ${type}`)
  return node
}

describe('Canvas — cableado con @xyflow/react (ReactFlow stub)', () => {
  it('onConnect con sourceHandle response:<id> llama a connect con el responseId correcto', () => {
    render(<Canvas />)
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      useProjectStore.getState().createNode('final', { x: 100, y: 0 })
    })
    const decision = firstNodeOfType('decision')
    const final = firstNodeOfType('final')
    act(() => {
      useProjectStore.getState().addResponse(decision.id)
    })
    const responseId = firstNodeOfType('decision')
    const responses = responseId.type === 'decision' ? responseId.responses : []
    const response = responses[0]
    if (!response) throw new Error('setup inválido')

    act(() => {
      capturedProps?.onConnect?.({
        source: decision.id,
        target: final.id,
        sourceHandle: responseHandleId(response.id),
        targetHandle: 'in',
      })
    })

    const updated = useProjectStore.getState().project.graph.nodes.find((n) => n.id === decision.id)
    const updatedResponse = updated?.type === 'decision' ? updated.responses[0] : undefined
    expect(updatedResponse?.targetNodeId).toBe(final.id)
  })

  it('onConnect con un nodo start/content como origen llama a connect sin responseId', () => {
    render(<Canvas />)
    const start = firstNodeOfType('start')
    act(() => {
      useProjectStore.getState().createNode('content', { x: 50, y: 0 })
    })
    const content = firstNodeOfType('content')

    act(() => {
      capturedProps?.onConnect?.({
        source: start.id,
        target: content.id,
        sourceHandle: 'out',
        targetHandle: 'in',
      })
    })

    const updatedStart = useProjectStore.getState().project.graph.nodes.find((n) => n.id === start.id)
    expect(updatedStart?.type === 'start' ? updatedStart.targetNodeId : undefined).toBe(content.id)
  })

  it('una conexión que el dominio rechaza (nodo final como origen) se ignora sin romper la UI', () => {
    render(<Canvas />)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    })
    const final = firstNodeOfType('final')
    const start = firstNodeOfType('start')
    const projectBefore = useProjectStore.getState().project

    expect(() => {
      act(() => {
        capturedProps?.onConnect?.({
          source: final.id,
          target: start.id,
          sourceHandle: 'out',
          targetHandle: 'in',
        })
      })
    }).not.toThrow()

    expect(useProjectStore.getState().project).toBe(projectBefore)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('onSelectionChange sincroniza `selection.selectedNodeIds` en el store', () => {
    render(<Canvas />)
    const start = firstNodeOfType('start')

    act(() => {
      capturedProps?.onSelectionChange?.({
        nodes: [{ id: start.id } as never],
        edges: [],
      })
    })

    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([start.id])
  })

  it('onMoveEnd persiste el viewport y no toca el historial de undo/redo', () => {
    render(<Canvas />)
    const historyBefore = useProjectStore.getState().history.past.length

    act(() => {
      capturedProps?.onMoveEnd?.(undefined as never, { x: 10, y: 20, zoom: 1.5 })
    })

    expect(useProjectStore.getState().project.editor.viewport).toEqual({ x: 10, y: 20, zoom: 1.5 })
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)
  })

  it('dragStart→drag×N→dragStop deja una única entrada de historial y la posición final es la leída por el adaptador', () => {
    render(<Canvas />)
    const start = firstNodeOfType('start')
    const historyBefore = useProjectStore.getState().history.past.length

    act(() => {
      capturedProps?.onNodeDragStart?.(undefined as never, { id: start.id, position: { x: 0, y: 0 } } as never, [])
      capturedProps?.onNodeDrag?.(undefined as never, { id: start.id, position: { x: 40, y: 10 } } as never, [])
      capturedProps?.onNodeDrag?.(undefined as never, { id: start.id, position: { x: 123, y: 456 } } as never, [])
      capturedProps?.onNodeDragStop?.(undefined as never, { id: start.id, position: { x: 123, y: 456 } } as never, [])
    })

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const flowNodes = toFlowNodes(
      useProjectStore.getState().project,
      useProjectStore.getState().selection.selectedNodeIds,
    )
    expect(flowNodes.find((n) => n.id === start.id)?.position).toEqual({ x: 123, y: 456 })
  })

  it('un arrastre que vuelve a la posición de origen no genera entrada de historial', () => {
    render(<Canvas />)
    const start = firstNodeOfType('start')
    const historyBefore = useProjectStore.getState().history.past.length

    act(() => {
      capturedProps?.onNodeDragStart?.(undefined as never, { id: start.id, position: { x: 0, y: 0 } } as never, [])
      capturedProps?.onNodeDrag?.(undefined as never, { id: start.id, position: { x: 40, y: 10 } } as never, [])
      capturedProps?.onNodeDrag?.(undefined as never, { id: start.id, position: { x: 0, y: 0 } } as never, [])
      capturedProps?.onNodeDragStop?.(undefined as never, { id: start.id, position: { x: 0, y: 0 } } as never, [])
    })

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)
  })

  it('focusNode centra la vista (setCenter) y limpia focusRequestNodeId tras procesarse', () => {
    render(<Canvas />)
    const start = firstNodeOfType('start')

    const setCenter = vi.fn()
    const getZoom = vi.fn(() => 1)
    const getNode = vi.fn(() => ({
      id: start.id,
      position: start.position,
      measured: { width: 180, height: 60 },
    }))

    act(() => {
      capturedProps?.onInit?.({ getNode, getZoom, setCenter } as never)
    })

    act(() => {
      useProjectStore.getState().focusNode(start.id)
    })

    expect(setCenter).toHaveBeenCalledWith(
      start.position.x + 90,
      start.position.y + 30,
      expect.objectContaining({ zoom: 1 }),
    )
    expect(useProjectStore.getState().ui.focusRequestNodeId).toBeNull()
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([start.id])
  })

  it('focusNode sin instancia de React Flow todavía disponible limpia la petición sin lanzar', () => {
    render(<Canvas />)
    const start = firstNodeOfType('start')

    expect(() => {
      act(() => {
        useProjectStore.getState().focusNode(start.id)
      })
    }).not.toThrow()

    expect(useProjectStore.getState().ui.focusRequestNodeId).toBeNull()
  })
})
