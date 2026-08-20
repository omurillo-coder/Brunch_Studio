import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Inspector } from '../Inspector'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'
import type { DecisionNode } from '../../../domain'

beforeEach(() => {
  resetProjectStore()
})

function startNodeId(): string {
  const node = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'start')
  if (!node) throw new Error('No hay nodo start')
  return node.id
}

function decisionNodeId(): string {
  const node = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'decision')
  if (!node) throw new Error('No hay nodo decision')
  return node.id
}

function decisionNode(id: string): DecisionNode {
  const node = useProjectStore.getState().project.graph.nodes.find((n) => n.id === id)
  if (!node || node.type !== 'decision') throw new Error('No es un nodo decision')
  return node
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

describe('Inspector — foco de título tras crear desde el menú contextual (fase 7)', () => {
  it('titleFocusRequestNodeId fijado por createConnectedNodeFromMenu enfoca el input de título y se limpia', () => {
    act(() => {
      useProjectStore.getState().openContextMenu({
        position: { x: 0, y: 0 },
        originNodeId: startNodeId(),
      })
      useProjectStore.getState().createConnectedNodeFromMenu('content', { x: 10, y: 10 })
    })

    const createdId = useProjectStore.getState().selection.selectedNodeIds[0]
    if (!createdId) throw new Error('setup inválido')
    expect(useProjectStore.getState().ui.titleFocusRequestNodeId).toBe(createdId)

    render(<Inspector />)

    expect(screen.getByLabelText('Título')).toHaveFocus()
    expect(useProjectStore.getState().ui.titleFocusRequestNodeId).toBeNull()
  })

  it('una selección normal (selectNode) no pide ni consume el foco de título', () => {
    act(() => {
      useProjectStore.getState().updateNode(startNodeId(), { title: 'Inicio' })
      useProjectStore.getState().selectNode(startNodeId())
    })

    render(<Inspector />)

    expect(screen.getByLabelText('Título')).not.toHaveFocus()
    expect(useProjectStore.getState().ui.titleFocusRequestNodeId).toBeNull()
  })
})

describe('Inspector — sección de Decisión (fase 6)', () => {
  it('seleccionar un nodo decision muestra sus respuestas existentes (A y B) con sus textos', () => {
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(decisionNodeId())
    })
    render(<Inspector />)

    expect(screen.getByLabelText('Texto de la respuesta A')).toHaveValue('')
    expect(screen.getByLabelText('Texto de la respuesta B')).toHaveValue('')
    expect(screen.queryByLabelText('Texto de la respuesta C')).not.toBeInTheDocument()
  })

  it('editar el texto de una respuesta y hacer blur produce exactamente una llamada efectiva', () => {
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(decisionNodeId())
    })
    render(<Inspector />)

    const historyBefore = useProjectStore.getState().history.past.length
    const responseInput = screen.getByLabelText('Texto de la respuesta A')

    fireEvent.change(responseInput, { target: { value: 'S' } })
    fireEvent.change(responseInput, { target: { value: 'Sí' } })
    // Ninguna pulsación debe haber tocado el store todavía.
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)

    fireEvent.blur(responseInput)

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    expect(decisionNode(decisionNodeId()).responses.find((r) => r.letter === 'A')?.text).toBe('Sí')

    // Un segundo blur sin más cambios no debe generar otra entrada.
    fireEvent.blur(responseInput)
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
  })

  it('añadir respuesta hasta el límite de 4 oculta el control de añadir; no se puede crear una quinta', () => {
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(decisionNodeId())
    })
    render(<Inspector />)

    // Recién creado: A, B -> el botón de añadir sigue visible (quedan 2 libres).
    expect(screen.getByRole('button', { name: '+ Añadir respuesta' })).toBeInTheDocument()

    act(() => {
      useProjectStore.getState().addResponse(decisionNodeId()) // C
    })
    expect(screen.getByRole('button', { name: '+ Añadir respuesta' })).toBeInTheDocument()

    act(() => {
      useProjectStore.getState().addResponse(decisionNodeId()) // D
    })
    expect(screen.queryByRole('button', { name: '+ Añadir respuesta' })).not.toBeInTheDocument()

    expect(decisionNode(decisionNodeId()).responses).toHaveLength(4)
    expect(() => useProjectStore.getState().addResponse(decisionNodeId())).toThrow()
  })

  it('eliminar una respuesta la quita de la lista mostrada', () => {
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(decisionNodeId())
    })
    render(<Inspector />)

    expect(screen.getByLabelText('Texto de la respuesta B')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar respuesta B' }))

    expect(screen.queryByLabelText('Texto de la respuesta B')).not.toBeInTheDocument()
    expect(decisionNode(decisionNodeId()).responses.some((r) => r.letter === 'B')).toBe(false)
  })

  it('cambiar el select de destino llama a connect y volver a "— Sin destino —" llama a disconnect', () => {
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      useProjectStore.getState().createNode('final', { x: 100, y: 0 })
      useProjectStore.getState().selectNode(decisionNodeId())
    })
    render(<Inspector />)

    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')

    const select = screen.getByLabelText('Destino de la respuesta A') as HTMLSelectElement
    fireEvent.change(select, { target: { value: finalId } })

    expect(decisionNode(decisionNodeId()).responses.find((r) => r.letter === 'A')?.targetNodeId).toBe(
      finalId,
    )

    fireEvent.change(select, { target: { value: '__none__' } })

    expect(
      decisionNode(decisionNodeId()).responses.find((r) => r.letter === 'A')?.targetNodeId,
    ).toBeUndefined()
  })

  it('el select de destino no muestra ningún UUID como texto', () => {
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      useProjectStore.getState().createNode('content', { x: 100, y: 0 }, { title: 'Bienvenida' })
      useProjectStore.getState().selectNode(decisionNodeId())
    })
    render(<Inspector />)

    const select = screen.getByLabelText('Destino de la respuesta A') as HTMLSelectElement
    const optionTexts = Array.from(select.options).map((option) => option.textContent ?? '')

    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    for (const text of optionTexts) {
      expect(text).not.toMatch(uuidPattern)
    }
    expect(optionTexts).toContain('— Sin destino —')
    expect(optionTexts.some((text) => text.includes('Bienvenida'))).toBe(true)
  })

  it('cambiar de nodo seleccionado actualiza la sección de respuestas mostrada', () => {
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      useProjectStore.getState().createNode('content', { x: 100, y: 0 })
      useProjectStore.getState().selectNode(decisionNodeId())
    })
    render(<Inspector />)

    expect(screen.getByText('Respuestas')).toBeInTheDocument()

    const contentId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'content')?.id
    if (!contentId) throw new Error('setup inválido')

    act(() => {
      useProjectStore.getState().selectNode(contentId)
    })
    expect(screen.queryByText('Respuestas')).not.toBeInTheDocument()

    act(() => {
      useProjectStore.getState().selectNode(decisionNodeId())
    })
    expect(screen.getByText('Respuestas')).toBeInTheDocument()
  })

  it('el botón de eliminar no aparece para el nodo Inicio', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector />)

    expect(screen.queryByRole('button', { name: /^Eliminar /i })).not.toBeInTheDocument()
  })

  it('el botón de eliminar borra el nodo Pantalla y el Inspector vuelve a "sin selección"', () => {
    act(() => {
      useProjectStore.getState().createNode('content', { x: 0, y: 0 }, { title: 'Pantalla 2' })
      const contentId = useProjectStore
        .getState()
        .project.graph.nodes.find((n) => n.type === 'content')?.id
      if (!contentId) throw new Error('setup inválido')
      useProjectStore.getState().selectNode(contentId)
    })
    render(<Inspector />)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar pantalla' }))

    expect(
      useProjectStore.getState().project.graph.nodes.some((n) => n.type === 'content'),
    ).toBe(false)
    // Vuelve a la vista "sin selección" (resumen del proyecto).
    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })

  it('el botón de eliminar borra un nodo Final', () => {
    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
      const finalId = useProjectStore
        .getState()
        .project.graph.nodes.find((n) => n.type === 'final')?.id
      if (!finalId) throw new Error('setup inválido')
      useProjectStore.getState().selectNode(finalId)
    })
    render(<Inspector />)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar final' }))

    expect(
      useProjectStore.getState().project.graph.nodes.some((n) => n.type === 'final'),
    ).toBe(false)
  })

  it('el botón de eliminar borra un nodo Decisión', () => {
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(decisionNodeId())
    })
    render(<Inspector />)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar decisión' }))

    expect(
      useProjectStore.getState().project.graph.nodes.some((n) => n.type === 'decision'),
    ).toBe(false)
  })

  it('conectar vía store.connect directamente se refleja en el select de destino sin trabajo adicional', () => {
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      useProjectStore.getState().createNode('final', { x: 100, y: 0 })
      useProjectStore.getState().selectNode(decisionNodeId())
    })
    render(<Inspector />)

    const responseA = decisionNode(decisionNodeId()).responses.find((r) => r.letter === 'A')
    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!responseA || !finalId) throw new Error('setup inválido')

    act(() => {
      useProjectStore.getState().connect(decisionNodeId(), finalId, responseA.id)
    })

    const select = screen.getByLabelText('Destino de la respuesta A') as HTMLSelectElement
    expect(select.value).toBe(finalId)
  })
})
