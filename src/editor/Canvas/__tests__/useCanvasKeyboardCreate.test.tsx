import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Canvas } from '../Canvas'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'

/**
 * Hallazgo de auditoría ("crear un nodo nuevo depende del ratón"): montaje
 * real de `@xyflow/react` (mismo criterio que `NodeCard.finalColor.test.tsx`
 * — necesita el elemento DOM real del nodo, con su `data-id`, para que
 * `useCanvasKeyboardCreate` pueda calcular dónde pintar el menú), en vez del
 * stub de `Canvas.wiring.test.tsx`.
 */

beforeEach(() => {
  resetProjectStore()
})

describe('useCanvasKeyboardCreate (Enter abre "¿Qué quieres añadir?" con un nodo seleccionado)', () => {
  it('con un nodo seleccionado y el foco fuera de un campo editable, Enter abre el menú', async () => {
    const startId = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      useProjectStore.getState().selectNode(startId)
    })

    render(<Canvas />)
    await screen.findByText('Sin ref. oculta')

    expect(screen.queryByRole('menu', { name: '¿Qué quieres añadir?' })).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(await screen.findByRole('menu', { name: '¿Qué quieres añadir?' })).toBeInTheDocument()
  })

  it('elegir "Diapositiva" en el menú abierto con Enter crea y conecta un nodo nuevo al origen seleccionado', async () => {
    const startId = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      useProjectStore.getState().selectNode(startId)
    })

    render(<Canvas />)
    await screen.findByText('Sin ref. oculta')
    const nodesBefore = useProjectStore.getState().project.graph.nodes.length

    fireEvent.keyDown(window, { key: 'Enter' })
    await screen.findByRole('menu', { name: '¿Qué quieres añadir?' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Diapositiva' }))

    const project = useProjectStore.getState().project
    expect(project.graph.nodes.length).toBe(nodesBefore + 1)
    const startNode = project.graph.nodes.find((node) => node.id === startId)
    expect(startNode?.type === 'slide' ? startNode.targetNodeId : undefined).toBeDefined()
  })

  it('sin ningún nodo seleccionado, Enter no hace nada', async () => {
    render(<Canvas />)
    await screen.findByText('Sin ref. oculta')

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(screen.queryByRole('menu', { name: '¿Qué quieres añadir?' })).not.toBeInTheDocument()
  })

  it('con dos nodos seleccionados a la vez, Enter no hace nada (mismo criterio que "Probar desde aquí": sin ambigüedad posible)', async () => {
    act(() => {
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    const ids = useProjectStore.getState().project.graph.nodes.map((node) => node.id)
    act(() => {
      useProjectStore.getState().setSelection(ids)
    })

    render(<Canvas />)
    await screen.findByText('Sin ref. oculta')

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(screen.queryByRole('menu', { name: '¿Qué quieres añadir?' })).not.toBeInTheDocument()
  })

  it('con el foco dentro de un campo de texto editable, Enter no abre el menú (no interfiere con escribir)', async () => {
    const startId = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      useProjectStore.getState().selectNode(startId)
    })

    render(
      <>
        <Canvas />
        <input aria-label="campo de prueba" />
      </>,
    )
    await screen.findByText('Sin ref. oculta')

    screen.getByLabelText('campo de prueba').focus()
    fireEvent.keyDown(screen.getByLabelText('campo de prueba'), { key: 'Enter' })

    expect(screen.queryByRole('menu', { name: '¿Qué quieres añadir?' })).not.toBeInTheDocument()
  })
})
