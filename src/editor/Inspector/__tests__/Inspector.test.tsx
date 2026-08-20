import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Inspector } from '../Inspector'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'

beforeEach(() => {
  resetProjectStore()
})

function startNodeId(): string {
  const node = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'start')
  if (!node) throw new Error('No hay nodo start')
  return node.id
}

describe('Inspector', () => {
  it('sin selección muestra información del proyecto', () => {
    render(<Inspector />)

    expect(screen.getByText('Untitled')).toBeInTheDocument()
    // Un proyecto recién creado tiene exactamente 1 nodo (el Inicio) y el
    // desglose por tipo lo confirma.
    const totalRow = screen.getByText('Nodos totales').closest('div')
    expect(totalRow).toHaveTextContent('1')
    const startRow = screen.getByText('Inicio').closest('div')
    expect(startRow).toHaveTextContent('1')
  })

  it('con un nodo seleccionado muestra su título y contenido actuales', () => {
    act(() => {
      useProjectStore.getState().updateNode(startNodeId(), { title: 'Bienvenida', body: 'Hola' })
      useProjectStore.getState().selectNode(startNodeId())
    })

    render(<Inspector />)

    expect(screen.getByLabelText('Título')).toHaveValue('Bienvenida')
    expect(screen.getByLabelText('Contenido')).toHaveValue('Hola')
  })

  it('editar y hacer blur produce exactamente una llamada efectiva a updateNode', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector />)

    const historyBefore = useProjectStore.getState().history.past.length
    const titleInput = screen.getByLabelText('Título')

    fireEvent.change(titleInput, { target: { value: 'T' } })
    fireEvent.change(titleInput, { target: { value: 'Ti' } })
    fireEvent.change(titleInput, { target: { value: 'Tit' } })
    fireEvent.change(titleInput, { target: { value: 'Título final' } })
    // Ninguna pulsación debe haber tocado el store todavía.
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)

    fireEvent.blur(titleInput)

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const node = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startNodeId())
    expect(node?.title).toBe('Título final')

    // Un segundo blur sin más cambios no debe generar otra entrada.
    fireEvent.blur(titleInput)
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
  })

  it('Enter en el campo de título confirma el cambio', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector />)

    const historyBefore = useProjectStore.getState().history.past.length
    const titleInput = screen.getByLabelText('Título')

    fireEvent.change(titleInput, { target: { value: 'Confirmado con Enter' } })
    fireEvent.keyDown(titleInput, { key: 'Enter' })

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
  })

  it('cambiar de nodo seleccionado actualiza los campos mostrados', () => {
    act(() => {
      useProjectStore.getState().updateNode(startNodeId(), { title: 'Inicio', body: 'Cuerpo inicio' })
      useProjectStore.getState().createNode('content', { x: 0, y: 0 }, { title: 'Pantalla 2' })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector />)

    expect(screen.getByLabelText('Título')).toHaveValue('Inicio')

    const contentNode = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.type === 'content')
    if (!contentNode) throw new Error('No hay nodo content')

    act(() => {
      useProjectStore.getState().selectNode(contentNode.id)
    })

    expect(screen.getByLabelText('Título')).toHaveValue('Pantalla 2')
  })

  it('cambiar de selección sin hacer blur confirma la edición pendiente', () => {
    act(() => {
      useProjectStore.getState().createNode('content', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector />)

    const historyBefore = useProjectStore.getState().history.past.length
    const titleInput = screen.getByLabelText('Título')
    fireEvent.change(titleInput, { target: { value: 'Editado sin blur' } })

    const otherNode = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.type === 'content')
    if (!otherNode) throw new Error('No hay nodo content')

    act(() => {
      useProjectStore.getState().selectNode(otherNode.id)
    })

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const startNode = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startNodeId())
    expect(startNode?.title).toBe('Editado sin blur')
  })
})
