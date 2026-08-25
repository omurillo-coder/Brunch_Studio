import { act, fireEvent, render, screen } from '@testing-library/react'
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

/** La diapositiva de inicio del proyecto actual del store. */
function startSlide() {
  const { project } = useProjectStore.getState()
  const node = project.graph.nodes.find((n) => n.id === project.graph.startNodeId)
  if (!node) throw new Error('No hay diapositiva de inicio')
  return node
}

/** Primer nodo del tipo pedido que no sea la diapositiva de inicio. */
function otherNodeOfType(type: 'slide' | 'final') {
  const { project } = useProjectStore.getState()
  const node = project.graph.nodes.find(
    (n) => n.type === type && n.id !== project.graph.startNodeId,
  )
  if (!node) throw new Error(`No hay nodo "${type}" distinto del inicio`)
  return node
}

/** Añade una respuesta a un nodo y devuelve su id. */
function addResponseTo(nodeId: string): string {
  act(() => {
    useProjectStore.getState().addResponse(nodeId)
  })
  const node = useProjectStore.getState().project.graph.nodes.find((n) => n.id === nodeId)
  const responses = node?.type === 'slide' ? node.responses : []
  const id = responses[responses.length - 1]?.id
  if (!id) throw new Error('responseId inesperadamente ausente')
  return id
}

describe('Canvas — cableado con @xyflow/react (ReactFlow stub)', () => {
  it('onConnect con sourceHandle response:<id> llama a connect con el responseId correcto', () => {
    render(<Canvas />)
    act(() => {
      useProjectStore.getState().createNode('final', { x: 100, y: 0 })
    })
    const slide = startSlide()
    const final = otherNodeOfType('final')
    const responseId = addResponseTo(slide.id)

    act(() => {
      capturedProps?.onConnect?.({
        source: slide.id,
        target: final.id,
        sourceHandle: responseHandleId(responseId),
        targetHandle: 'in',
      })
    })

    const updated = useProjectStore.getState().project.graph.nodes.find((n) => n.id === slide.id)
    const updatedResponse = updated?.type === 'slide' ? updated.responses[0] : undefined
    expect(updatedResponse?.targetNodeId).toBe(final.id)
  })

  it('onConnect desde el handle de "continuar" de una diapositiva llama a connect sin responseId', () => {
    render(<Canvas />)
    const start = startSlide()
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 50, y: 0 })
    })
    const other = otherNodeOfType('slide')

    act(() => {
      capturedProps?.onConnect?.({
        source: start.id,
        target: other.id,
        sourceHandle: 'out',
        targetHandle: 'in',
      })
    })

    const updatedStart = useProjectStore.getState().project.graph.nodes.find((n) => n.id === start.id)
    expect(updatedStart?.type === 'slide' ? updatedStart.targetNodeId : undefined).toBe(other.id)
  })

  it('una conexión que el dominio rechaza (nodo final como origen) se ignora sin romper la UI', () => {
    render(<Canvas />)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    })
    const final = otherNodeOfType('final')
    const start = startSlide()
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
    const start = startSlide()

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
    const start = startSlide()
    const historyBefore = useProjectStore.getState().history.past.length

    act(() => {
      capturedProps?.onNodeDragStart?.(undefined as never, undefined as never, [
        { id: start.id, position: { x: 0, y: 0 } } as never,
      ])
      capturedProps?.onNodeDrag?.(undefined as never, undefined as never, [
        { id: start.id, position: { x: 40, y: 10 } } as never,
      ])
      capturedProps?.onNodeDrag?.(undefined as never, undefined as never, [
        { id: start.id, position: { x: 123, y: 456 } } as never,
      ])
      capturedProps?.onNodeDragStop?.(undefined as never, undefined as never, [
        { id: start.id, position: { x: 123, y: 456 } } as never,
      ])
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
    const start = startSlide()
    const historyBefore = useProjectStore.getState().history.past.length

    act(() => {
      capturedProps?.onNodeDragStart?.(undefined as never, undefined as never, [
        { id: start.id, position: { x: 0, y: 0 } } as never,
      ])
      capturedProps?.onNodeDrag?.(undefined as never, undefined as never, [
        { id: start.id, position: { x: 40, y: 10 } } as never,
      ])
      capturedProps?.onNodeDrag?.(undefined as never, undefined as never, [
        { id: start.id, position: { x: 0, y: 0 } } as never,
      ])
      capturedProps?.onNodeDragStop?.(undefined as never, undefined as never, [
        { id: start.id, position: { x: 0, y: 0 } } as never,
      ])
    })

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)
  })

  it('arrastrar varios nodos seleccionados a la vez conserva la posición final de TODOS (no solo el "principal")', () => {
    render(<Canvas />)
    const start = startSlide()
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 100, y: 0 })
    })
    const content = otherNodeOfType('slide')
    const historyBefore = useProjectStore.getState().history.past.length

    act(() => {
      capturedProps?.onNodeDragStart?.(undefined as never, undefined as never, [
        { id: start.id, position: { x: 0, y: 0 } } as never,
        { id: content.id, position: { x: 100, y: 0 } } as never,
      ])
      capturedProps?.onNodeDrag?.(undefined as never, undefined as never, [
        { id: start.id, position: { x: 50, y: 50 } } as never,
        { id: content.id, position: { x: 150, y: 50 } } as never,
      ])
      capturedProps?.onNodeDragStop?.(undefined as never, undefined as never, [
        { id: start.id, position: { x: 50, y: 50 } } as never,
        { id: content.id, position: { x: 150, y: 50 } } as never,
      ])
    })

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const flowNodes = toFlowNodes(
      useProjectStore.getState().project,
      useProjectStore.getState().selection.selectedNodeIds,
    )
    expect(flowNodes.find((n) => n.id === start.id)?.position).toEqual({ x: 50, y: 50 })
    expect(flowNodes.find((n) => n.id === content.id)?.position).toEqual({ x: 150, y: 50 })

    useProjectStore.getState().undo()
    const reverted = toFlowNodes(
      useProjectStore.getState().project,
      useProjectStore.getState().selection.selectedNodeIds,
    )
    expect(reverted.find((n) => n.id === start.id)?.position).toEqual({ x: 0, y: 0 })
    expect(reverted.find((n) => n.id === content.id)?.position).toEqual({ x: 100, y: 0 })
  })

  it('focusNode centra la vista (setCenter) y limpia focusRequestNodeId tras procesarse', () => {
    render(<Canvas />)
    const start = startSlide()

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
    const start = startSlide()

    expect(() => {
      act(() => {
        useProjectStore.getState().focusNode(start.id)
      })
    }).not.toThrow()

    expect(useProjectStore.getState().ui.focusRequestNodeId).toBeNull()
  })
})

/**
 * Tests de `onConnectEnd` (fase 7: crear un nodo arrastrando una conexión
 * hasta el vacío). La decisión "¿es justo el gesto que abre el menú?" ya
 * está cubierta de forma pura en `handles.test.ts` (`resolveEmptyPaneDrop`)
 * — aquí se comprueba que `Canvas` invoca `openContextMenu` con los datos
 * correctos cuando `onConnectEnd` se dispara con cada combinación relevante,
 * invocando el callback directamente (mismo criterio pragmático que el
 * resto de este fichero: simular el gesto de arrastre real con el ratón
 * contra `@xyflow/react` es frágil en jsdom).
 */
describe('Canvas — onConnectEnd abre el menú "¿Qué quieres añadir?" (fase 7)', () => {
  function panePoint(clientX: number, clientY: number) {
    const pane = document.createElement('div')
    pane.className = 'react-flow__pane'
    return { target: pane, clientX, clientY } as unknown as MouseEvent
  }

  it('conexión inválida que termina en el pane vacío desde el handle de continuar abre el menú sin responseId', () => {
    render(<Canvas />)
    const start = startSlide()

    act(() => {
      capturedProps?.onConnectEnd?.(panePoint(120, 240), {
        isValid: false,
        fromHandle: { nodeId: start.id, id: 'out' },
      } as never)
    })

    const menu = useProjectStore.getState().ui.contextMenu
    expect(menu.open).toBe(true)
    expect(menu.position).toEqual({ x: 120, y: 240 })
    expect(menu.originNodeId).toBe(start.id)
    expect(menu.originResponseId).toBeNull()
  })

  it('conexión inválida que termina en el pane vacío desde una respuesta abre el menú con el responseId', () => {
    render(<Canvas />)
    const slide = startSlide()
    const responseId = addResponseTo(slide.id)

    act(() => {
      capturedProps?.onConnectEnd?.(panePoint(10, 20), {
        isValid: false,
        fromHandle: { nodeId: slide.id, id: responseHandleId(responseId) },
      } as never)
    })

    const menu = useProjectStore.getState().ui.contextMenu
    expect(menu.open).toBe(true)
    expect(menu.originNodeId).toBe(slide.id)
    expect(menu.originResponseId).toBe(responseId)
  })

  it('conexión válida (soltada sobre un handle real) no abre el menú', () => {
    render(<Canvas />)
    const start = startSlide()

    act(() => {
      capturedProps?.onConnectEnd?.(panePoint(0, 0), {
        isValid: true,
        fromHandle: { nodeId: start.id, id: 'out' },
      } as never)
    })

    expect(useProjectStore.getState().ui.contextMenu.open).toBe(false)
  })

  it('conexión inválida soltada dentro de un nodo existente (no el pane vacío) no abre el menú', () => {
    render(<Canvas />)
    const start = startSlide()
    const nodeEl = document.createElement('div')
    nodeEl.className = 'react-flow__node'

    act(() => {
      capturedProps?.onConnectEnd?.(
        { target: nodeEl, clientX: 0, clientY: 0 } as unknown as MouseEvent,
        {
          isValid: false,
          fromHandle: { nodeId: start.id, id: 'out' },
        } as never,
      )
    })

    expect(useProjectStore.getState().ui.contextMenu.open).toBe(false)
  })

  it('conexión inválida sin fromHandle (sin arrastre real desde un handle) no abre el menú', () => {
    render(<Canvas />)

    act(() => {
      capturedProps?.onConnectEnd?.(panePoint(0, 0), {
        isValid: false,
        fromHandle: null,
      } as never)
    })

    expect(useProjectStore.getState().ui.contextMenu.open).toBe(false)
  })
})

describe('Canvas — elegir una opción del menú crea, conecta, selecciona y cierra el menú (fase 7)', () => {
  function panePoint(clientX: number, clientY: number) {
    const pane = document.createElement('div')
    pane.className = 'react-flow__pane'
    return { target: pane, clientX, clientY } as unknown as MouseEvent
  }

  it('convierte la posición de pantalla a lienzo con screenToFlowPosition y crea+conecta el nodo elegido', () => {
    render(<Canvas />)
    const start = startSlide()

    const screenToFlowPosition = vi.fn(({ x, y }: { x: number; y: number }) => ({
      x: x + 1000,
      y: y + 2000,
    }))
    act(() => {
      capturedProps?.onInit?.({ screenToFlowPosition } as never)
    })

    act(() => {
      capturedProps?.onConnectEnd?.(panePoint(5, 7), {
        isValid: false,
        fromHandle: { nodeId: start.id, id: 'out' },
      } as never)
    })

    const idsBefore = new Set(useProjectStore.getState().project.graph.nodes.map((n) => n.id))

    // El menú ofrece solo Diapositiva y Final (ya no Pantalla/Decisión).
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Diapositiva',
      'Final',
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Diapositiva' }))

    expect(screenToFlowPosition).toHaveBeenCalledWith({ x: 5, y: 7 })

    const state = useProjectStore.getState()
    const created = state.project.graph.nodes.find((n) => !idsBefore.has(n.id))
    if (!created) throw new Error('no se creó ningún nodo')

    expect(created.type).toBe('slide')
    expect(created.position).toEqual({ x: 1005, y: 2007 })

    const updatedStart = state.project.graph.nodes.find((n) => n.id === start.id)
    expect(updatedStart?.type === 'slide' ? updatedStart.targetNodeId : undefined).toBe(created.id)

    expect(state.selection.selectedNodeIds).toEqual([created.id])
    expect(state.ui.titleFocusRequestNodeId).toBe(created.id)
    expect(state.ui.contextMenu.open).toBe(false)
  })

  it('Escape cierra el menú sin crear ni conectar nada', () => {
    render(<Canvas />)
    const start = startSlide()

    act(() => {
      capturedProps?.onConnectEnd?.(panePoint(0, 0), {
        isValid: false,
        fromHandle: { nodeId: start.id, id: 'out' },
      } as never)
    })
    expect(useProjectStore.getState().ui.contextMenu.open).toBe(true)

    const nodesBefore = useProjectStore.getState().project.graph.nodes.length
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(useProjectStore.getState().ui.contextMenu.open).toBe(false)
    expect(useProjectStore.getState().project.graph.nodes.length).toBe(nodesBefore)
  })
})

/**
 * Tests de borrado con Supr/Backspace: `onBeforeDelete` veta la diapositiva
 * de inicio (`graph.startNodeId`) entre los candidatos, exige una SEGUNDA
 * pulsación sobre el mismo conjunto de nodos dentro de
 * `DELETE_CONFIRM_WINDOW_MS` para confirmar de verdad (ver comentario de
 * diseño en `Canvas.tsx`), y `onNodesDelete` llama a `store.deleteNode` por
 * cada nodo que quedó permitido.
 */
describe('Canvas — borrado de nodos (onBeforeDelete / onNodesDelete)', () => {
  it('onBeforeDelete veta la diapositiva de inicio y, tras una segunda pulsación sobre el mismo conjunto, deja pasar los demás candidatos', async () => {
    render(<Canvas />)
    const start = startSlide()
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
    })
    const other = otherNodeOfType('slide')

    const candidates = {
      nodes: [
        { id: start.id, type: 'slide' } as never,
        { id: other.id, type: 'slide' } as never,
      ],
      edges: [],
    }

    // Primera pulsación: se veta (solo arma la confirmación), nada se borra
    // todavía.
    const firstResult = await capturedProps?.onBeforeDelete?.(candidates)
    expect(firstResult).toBe(false)

    // Segunda pulsación sobre el mismo conjunto: se confirma de verdad, y la
    // diapositiva de inicio sigue excluida de los candidatos permitidos.
    const secondResult = await capturedProps?.onBeforeDelete?.(candidates)
    expect(secondResult).toEqual({ nodes: [{ id: other.id, type: 'slide' }], edges: [] })
  })

  it('una primera pulsación muestra un aviso inline con "Cancelar"; cancelar exige una nueva primera confirmación', async () => {
    render(<Canvas />)
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
    })
    const other = otherNodeOfType('slide')
    const candidates = { nodes: [{ id: other.id, type: 'slide' } as never], edges: [] }

    await act(async () => {
      await capturedProps?.onBeforeDelete?.(candidates)
    })

    expect(
      screen.getByText('Pulsa Supr/Backspace otra vez para eliminar este nodo.'),
    ).toBeInTheDocument()
    const cancelButton = screen.getByRole('button', { name: 'Cancelar' })
    fireEvent.click(cancelButton)

    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()

    // Sin confirmación pendiente ya: la siguiente pulsación vuelve a vetar
    // (primera pulsación de una confirmación nueva), no borra directamente.
    const result = await capturedProps?.onBeforeDelete?.(candidates)
    expect(result).toBe(false)
  })

  it('pasada la ventana de confirmación sin una segunda pulsación, caduca sola y hay que empezar de nuevo', async () => {
    vi.useFakeTimers()
    try {
      render(<Canvas />)
      act(() => {
        useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      })
      const other = otherNodeOfType('slide')
      const candidates = { nodes: [{ id: other.id, type: 'slide' } as never], edges: [] }

      await act(async () => {
        await capturedProps?.onBeforeDelete?.(candidates)
      })
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()

      const result = await capturedProps?.onBeforeDelete?.(candidates)
      expect(result).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cambiar el conjunto de nodos seleccionados entre pulsaciones exige una nueva primera confirmación (no confirma el conjunto anterior)', async () => {
    render(<Canvas />)
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().createNode('slide', { x: 50, y: 0 })
    })
    const { project } = useProjectStore.getState()
    const others = project.graph.nodes.filter((n) => n.id !== project.graph.startNodeId)
    const [nodeA, nodeB] = others
    if (!nodeA || !nodeB) throw new Error('setup inválido')

    const firstResult = await capturedProps?.onBeforeDelete?.({
      nodes: [{ id: nodeA.id, type: 'slide' } as never],
      edges: [],
    })
    expect(firstResult).toBe(false)

    const secondResult = await capturedProps?.onBeforeDelete?.({
      nodes: [{ id: nodeB.id, type: 'slide' } as never],
      edges: [],
    })
    expect(secondResult).toBe(false)
  })

  it('onBeforeDelete veta el borrado por completo si el único candidato es la diapositiva de inicio', async () => {
    render(<Canvas />)
    const start = startSlide()

    const result = await capturedProps?.onBeforeDelete?.({
      nodes: [{ id: start.id, type: 'slide' } as never],
      edges: [],
    })

    expect(result).toBe(false)
  })

  it('onNodesDelete llama a store.deleteNode con los ids de los nodos borrados', () => {
    render(<Canvas />)
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().createNode('final', { x: 100, y: 0 })
    })
    const content = otherNodeOfType('slide')
    const final = otherNodeOfType('final')

    act(() => {
      capturedProps?.onNodesDelete?.([
        { id: content.id } as never,
        { id: final.id } as never,
      ])
    })

    const nodes = useProjectStore.getState().project.graph.nodes
    expect(nodes.some((n) => n.id === content.id)).toBe(false)
    expect(nodes.some((n) => n.id === final.id)).toBe(false)
  })

  it('onNodesDelete de un nodo que ya no existe se ignora sin lanzar', () => {
    render(<Canvas />)
    expect(() => {
      act(() => {
        capturedProps?.onNodesDelete?.([{ id: 'no-existe' } as never])
      })
    }).not.toThrow()
  })
})
