import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Inspector } from '../Inspector'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'
import type { SlideNode } from '../../../domain'
import { AppServicesProvider } from '../../../app/AppServicesContext'
import type { AppServices } from '../../../app/AppServices'
import { MemoryAssetRepository } from '../../../persistence'
import styles from '../Inspector.module.css'

const TEST_FILE_PATH = '/tmp/inspector-test.brunch'

beforeEach(() => {
  resetProjectStore()
})

/** Id de la diapositiva de inicio (`graph.startNodeId`). */
function startNodeId(): string {
  return useProjectStore.getState().project.graph.startNodeId
}

/** Id de la primera diapositiva que NO es la de inicio. */
function slideNodeId(): string {
  const { project } = useProjectStore.getState()
  const id = project.graph.nodes.find(
    (n) => n.type === 'slide' && n.id !== project.graph.startNodeId,
  )?.id
  if (!id) throw new Error('No hay diapositiva distinta de la de inicio')
  return id
}

function slideNode(id: string): SlideNode {
  const node = useProjectStore.getState().project.graph.nodes.find((n) => n.id === id)
  if (!node || node.type !== 'slide') throw new Error('No es una diapositiva')
  return node
}

/**
 * Crea una diapositiva nueva y le añade 2 respuestas (el equivalente al
 * antiguo nodo "Decisión", que nacía con A y B). Ya no existe un tipo de nodo
 * "decision": una diapositiva pasa a comportarse como decisión en cuanto
 * tiene respuestas, y se le añaden desde el propio Inspector.
 */
function createSlideWithTwoResponses(): string {
  act(() => {
    useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
  })
  const id = slideNodeId()
  act(() => {
    useProjectStore.getState().addResponse(id)
    useProjectStore.getState().addResponse(id)
  })
  return id
}

/** Servicios de test con un `pickImportAssetPath` fijo y un `MemoryAssetRepository`
 *  real (mismo criterio que los tests de `HomeScreen`: nada de Tauri real). */
function renderInspectorWithServices(services: Partial<AppServices>) {
  return render(
    <AppServicesProvider services={services}>
      <Inspector filePath={TEST_FILE_PATH} />
    </AppServicesProvider>,
  )
}

describe('Inspector', () => {
  it('sin selección muestra información del proyecto', () => {
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByText('Untitled')).toBeInTheDocument()
    // Un proyecto recién creado tiene exactamente 1 nodo (su diapositiva de
    // inicio) y el desglose por tipo lo confirma.
    const totalRow = screen.getByText('Nodos totales').closest('div')
    expect(totalRow).toHaveTextContent('1')
    const slideRow = screen.getByText('Diapositiva').closest('div')
    expect(slideRow).toHaveTextContent('1')
    const finalRow = screen.getByText('Final').closest('div')
    expect(finalRow).toHaveTextContent('0')
  })

  it('con un nodo seleccionado muestra su título y contenido actuales', async () => {
    act(() => {
      useProjectStore.getState().updateNode(startNodeId(), { title: 'Bienvenida', body: 'Hola' })
      useProjectStore.getState().selectNode(startNodeId())
    })

    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Título')).toHaveValue('Bienvenida')
    // El campo "Contenido" es ahora el editor de texto enriquecido
    // (`RichTextEditor`, fase 4 Milestone 2): un `<div contenteditable>`, no
    // un `<textarea>` con `.value` — se comprueba el texto renderizado.
    await waitFor(() => {
      expect(screen.getByLabelText('Contenido')).toHaveTextContent('Hola')
    })
  })

  it('el campo de título tiene el corrector nativo activado con idioma español (fase 8)', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const titleInput = screen.getByLabelText('Título')
    expect(titleInput).toHaveAttribute('spellcheck', 'true')
    expect(titleInput).toHaveAttribute('lang', 'es')
  })

  it('editar y hacer blur produce exactamente una llamada efectiva a updateNode', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

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
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const historyBefore = useProjectStore.getState().history.past.length
    const titleInput = screen.getByLabelText('Título')

    fireEvent.change(titleInput, { target: { value: 'Confirmado con Enter' } })
    fireEvent.keyDown(titleInput, { key: 'Enter' })

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
  })

  it('cambiar de nodo seleccionado actualiza los campos mostrados', () => {
    act(() => {
      useProjectStore.getState().updateNode(startNodeId(), { title: 'Inicio', body: 'Cuerpo inicio' })
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Diapositiva 2' })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Título')).toHaveValue('Inicio')

    act(() => {
      useProjectStore.getState().selectNode(slideNodeId())
    })

    expect(screen.getByLabelText('Título')).toHaveValue('Diapositiva 2')
  })

  it('cambiar de selección sin hacer blur confirma la edición pendiente', () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const historyBefore = useProjectStore.getState().history.past.length
    const titleInput = screen.getByLabelText('Título')
    fireEvent.change(titleInput, { target: { value: 'Editado sin blur' } })

    act(() => {
      useProjectStore.getState().selectNode(slideNodeId())
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
      useProjectStore.getState().createConnectedNodeFromMenu('slide', { x: 10, y: 10 })
    })

    const createdId = useProjectStore.getState().selection.selectedNodeIds[0]
    if (!createdId) throw new Error('setup inválido')
    expect(useProjectStore.getState().ui.titleFocusRequestNodeId).toBe(createdId)

    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Título')).toHaveFocus()
    expect(useProjectStore.getState().ui.titleFocusRequestNodeId).toBeNull()
  })

  it('una selección normal (selectNode) no pide ni consume el foco de título', () => {
    act(() => {
      useProjectStore.getState().updateNode(startNodeId(), { title: 'Inicio' })
      useProjectStore.getState().selectNode(startNodeId())
    })

    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Título')).not.toHaveFocus()
    expect(useProjectStore.getState().ui.titleFocusRequestNodeId).toBeNull()
  })
})

describe('Inspector — modo "de continuar" de una diapositiva', () => {
  it('una diapositiva sin respuestas ofrece destino de continuar y texto del botón', () => {
    act(() => {
      useProjectStore.getState().createNode('final', { x: 100, y: 0 })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Destino de continuar')).toBeInTheDocument()
    const labelInput = screen.getByLabelText('Texto del botón de continuar')
    expect(labelInput).toHaveValue('')
    // El placeholder muestra el valor por defecto que usará el Player.
    expect(labelInput).toHaveAttribute('placeholder', 'Continuar')
  })

  it('elegir un destino de continuar llama a connect, y "— Sin destino —" a disconnect', () => {
    act(() => {
      useProjectStore.getState().createNode('final', { x: 100, y: 0 })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')

    const select = screen.getByLabelText('Destino de continuar') as HTMLSelectElement
    fireEvent.change(select, { target: { value: finalId } })
    expect(slideNode(startNodeId()).targetNodeId).toBe(finalId)

    fireEvent.change(select, { target: { value: '__none__' } })
    expect(slideNode(startNodeId()).targetNodeId).toBeUndefined()
  })

  it('escribir el texto del botón y hacer blur lo confirma una sola vez; vaciarlo vuelve al valor por defecto', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const historyBefore = useProjectStore.getState().history.past.length
    const input = screen.getByLabelText('Texto del botón de continuar')

    fireEvent.change(input, { target: { value: 'Siguiente' } })
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)

    fireEvent.blur(input)
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    expect(slideNode(startNodeId()).continueLabel).toBe('Siguiente')

    // Un segundo blur sin cambios no genera otra entrada.
    fireEvent.blur(input)
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)

    // Vaciarlo borra el campo (vuelve a "Continuar" por defecto).
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(slideNode(startNodeId()).continueLabel).toBeUndefined()
  })

  it('añadir la primera respuesta oculta el modo "de continuar" sin borrar su destino, y eliminarla lo devuelve', () => {
    act(() => {
      useProjectStore.getState().createNode('final', { x: 100, y: 0 })
      useProjectStore.getState().selectNode(startNodeId())
    })
    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().connect(startNodeId(), finalId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Destino de continuar')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir respuesta' }))

    // Modo decisión: los campos de continuar se ocultan...
    expect(screen.queryByLabelText('Destino de continuar')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Texto del botón de continuar')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Texto de la respuesta 1')).toBeInTheDocument()
    // ...pero el destino de continuar sigue guardado (dormido) en el documento.
    expect(slideNode(startNodeId()).targetNodeId).toBe(finalId)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar respuesta 1' }))

    // Sin respuestas otra vez: vuelve el modo "de continuar" con su destino.
    const select = screen.getByLabelText('Destino de continuar') as HTMLSelectElement
    expect(select.value).toBe(finalId)
  })
})

describe('Inspector — respuestas de una diapositiva', () => {
  it('nunca muestra la letra de una respuesta como texto visible', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    // La letra interna sigue existiendo en el documento...
    expect(slideNode(decisionId).responses.map((r) => r.letter)).toEqual(['A', 'B'])
    // ...pero no aparece por ninguna parte en la interfaz.
    expect(screen.queryByText('A')).not.toBeInTheDocument()
    expect(screen.queryByText('B')).not.toBeInTheDocument()
  })

  it('seleccionar una diapositiva con respuestas muestra sus filas numeradas, sin letras', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Texto de la respuesta 1')).toHaveValue('')
    expect(screen.getByLabelText('Texto de la respuesta 2')).toHaveValue('')
    expect(screen.queryByLabelText('Texto de la respuesta 3')).not.toBeInTheDocument()
  })

  it('editar el texto de una respuesta y hacer blur produce exactamente una llamada efectiva', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const historyBefore = useProjectStore.getState().history.past.length
    const responseInput = screen.getByLabelText('Texto de la respuesta 1')

    fireEvent.change(responseInput, { target: { value: 'S' } })
    fireEvent.change(responseInput, { target: { value: 'Sí' } })
    // Ninguna pulsación debe haber tocado el store todavía.
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)

    fireEvent.blur(responseInput)

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    expect(slideNode(decisionId).responses.find((r) => r.letter === 'A')?.text).toBe('Sí')

    // Un segundo blur sin más cambios no debe generar otra entrada.
    fireEvent.blur(responseInput)
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
  })

  it('añadir respuesta hasta el límite de 4 oculta el control de añadir; no se puede crear una quinta', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    // Recién creado: A, B -> el botón de añadir sigue visible (quedan 2 libres).
    expect(screen.getByRole('button', { name: '+ Añadir respuesta' })).toBeInTheDocument()

    act(() => {
      useProjectStore.getState().addResponse(decisionId) // C
    })
    expect(screen.getByRole('button', { name: '+ Añadir respuesta' })).toBeInTheDocument()

    act(() => {
      useProjectStore.getState().addResponse(decisionId) // D
    })
    expect(screen.queryByRole('button', { name: '+ Añadir respuesta' })).not.toBeInTheDocument()

    expect(slideNode(decisionId).responses).toHaveLength(4)
    expect(() => useProjectStore.getState().addResponse(decisionId)).toThrow()
  })

  it('eliminar una respuesta la quita de la lista mostrada', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Texto de la respuesta 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar respuesta 2' }))

    expect(screen.queryByLabelText('Texto de la respuesta 2')).not.toBeInTheDocument()
    expect(slideNode(decisionId).responses.some((r) => r.letter === 'B')).toBe(false)
  })

  it('cambiar el select de destino llama a connect y volver a "— Sin destino —" llama a disconnect', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().createNode('final', { x: 100, y: 0 })
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')

    const select = screen.getByLabelText('Destino de la respuesta 1') as HTMLSelectElement
    fireEvent.change(select, { target: { value: finalId } })

    expect(slideNode(decisionId).responses.find((r) => r.letter === 'A')?.targetNodeId).toBe(
      finalId,
    )

    fireEvent.change(select, { target: { value: '__none__' } })

    expect(
      slideNode(decisionId).responses.find((r) => r.letter === 'A')?.targetNodeId,
    ).toBeUndefined()
  })

  it('el select de destino no muestra ningún UUID como texto', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().updateNode(startNodeId(), { title: 'Bienvenida' })
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const select = screen.getByLabelText('Destino de la respuesta 1') as HTMLSelectElement
    const optionTexts = Array.from(select.options).map((option) => option.textContent ?? '')

    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    for (const text of optionTexts) {
      expect(text).not.toMatch(uuidPattern)
    }
    expect(optionTexts).toContain('— Sin destino —')
    expect(optionTexts.some((text) => text.includes('Bienvenida'))).toBe(true)
  })

  it('la sección de respuestas está en cualquier diapositiva, pero no en un Final', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().createNode('final', { x: 100, y: 0 })
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByText('Respuestas')).toBeInTheDocument()

    // La diapositiva de inicio, sin respuestas, también ofrece la sección
    // (con su botón de añadir): es la vía por la que pasa a ser decisión.
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    expect(screen.getByText('Respuestas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Añadir respuesta' })).toBeInTheDocument()

    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().selectNode(finalId)
    })
    expect(screen.queryByText('Respuestas')).not.toBeInTheDocument()
  })

  it('el botón de eliminar no aparece para la diapositiva de inicio', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.queryByRole('button', { name: /^Eliminar /i })).not.toBeInTheDocument()
  })

  it('el primer clic en "Eliminar" NO borra todavía: solo muestra la confirmación inline', () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Diapositiva 2' })
    })
    const slideId = slideNodeId()
    act(() => {
      useProjectStore.getState().selectNode(slideId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar diapositiva' }))

    // Sigue existiendo: el primer clic solo arma la confirmación.
    expect(useProjectStore.getState().project.graph.nodes.some((n) => n.id === slideId)).toBe(true)
    expect(screen.getByText('¿Eliminar diapositiva?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sí, eliminar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    // El botón original desaparece mientras se confirma.
    expect(screen.queryByRole('button', { name: 'Eliminar diapositiva' })).not.toBeInTheDocument()
  })

  it('confirmar con "Sí, eliminar" borra la diapositiva y el Inspector vuelve a "sin selección"', () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Diapositiva 2' })
    })
    const slideId = slideNodeId()
    act(() => {
      useProjectStore.getState().selectNode(slideId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar diapositiva' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }))

    expect(useProjectStore.getState().project.graph.nodes.some((n) => n.id === slideId)).toBe(false)
    // Vuelve a la vista "sin selección" (resumen del proyecto).
    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })

  it('cancelar la confirmación no borra nada y vuelve al botón normal', () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Diapositiva 2' })
    })
    const slideId = slideNodeId()
    act(() => {
      useProjectStore.getState().selectNode(slideId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar diapositiva' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(useProjectStore.getState().project.graph.nodes.some((n) => n.id === slideId)).toBe(true)
    expect(screen.getByRole('button', { name: 'Eliminar diapositiva' })).toBeInTheDocument()
    expect(screen.queryByText('¿Eliminar diapositiva?')).not.toBeInTheDocument()
  })

  it('el botón de eliminar borra un nodo Final tras confirmar', () => {
    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
      const finalId = useProjectStore
        .getState()
        .project.graph.nodes.find((n) => n.type === 'final')?.id
      if (!finalId) throw new Error('setup inválido')
      useProjectStore.getState().selectNode(finalId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar final' }))
    expect(
      useProjectStore.getState().project.graph.nodes.some((n) => n.type === 'final'),
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }))

    expect(
      useProjectStore.getState().project.graph.nodes.some((n) => n.type === 'final'),
    ).toBe(false)
  })

  it('el botón de eliminar borra una diapositiva con respuestas (antes "Decisión") tras confirmar', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar diapositiva' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }))

    expect(useProjectStore.getState().project.graph.nodes.some((n) => n.id === decisionId)).toBe(
      false,
    )
  })

  it('conectar vía store.connect directamente se refleja en el select de destino sin trabajo adicional', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().createNode('final', { x: 100, y: 0 })
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const responseA = slideNode(decisionId).responses.find((r) => r.letter === 'A')
    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!responseA || !finalId) throw new Error('setup inválido')

    act(() => {
      useProjectStore.getState().connect(decisionId, finalId, responseA.id)
    })

    const select = screen.getByLabelText('Destino de la respuesta 1') as HTMLSelectElement
    expect(select.value).toBe(finalId)
  })
})

describe('Inspector — lista de imágenes y audio a nivel de nodo (tarea 5: varias imágenes ordenables)', () => {
  function setupAssetRepository() {
    const assetRepository = new MemoryAssetRepository()
    assetRepository.registerSourceFile('/tmp/foto.png', new Uint8Array([1, 2, 3]), 'image/png')
    assetRepository.registerSourceFile('/tmp/foto2.png', new Uint8Array([7, 8, 9]), 'image/png')
    assetRepository.registerSourceFile('/tmp/audio.mp3', new Uint8Array([4, 5, 6]), 'audio/mpeg')
    return assetRepository
  }

  it('añadir una imagen actualiza imageAssetIds y muestra la vista previa', async () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(slideNodeId())
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/foto.png')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir imagen' }))

    await waitFor(() => {
      expect(slideNode(slideNodeId()).imageAssetIds).toHaveLength(1)
    })
    expect(pickImportAssetPath).toHaveBeenCalledWith('image')

    const preview = (await screen.findByAltText(
      'Vista previa de la imagen adjunta 1',
    )) as HTMLImageElement
    expect(preview.getAttribute('src')).toContain('data:image/png;base64,')
  })

  it('añadir una segunda imagen la agrega al final de la lista (orden de aparición)', async () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(slideNodeId())
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValueOnce('/tmp/foto.png').mockResolvedValueOnce('/tmp/foto2.png')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir imagen' }))
    await waitFor(() => expect(slideNode(slideNodeId()).imageAssetIds).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir imagen' }))
    await waitFor(() => expect(slideNode(slideNodeId()).imageAssetIds).toHaveLength(2))

    expect(await screen.findByAltText('Vista previa de la imagen adjunta 1')).toBeInTheDocument()
    expect(await screen.findByAltText('Vista previa de la imagen adjunta 2')).toBeInTheDocument()
  })

  it('quitar una imagen la elimina de imageAssetIds; el botón de añadir sigue disponible', async () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(slideNodeId())
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/foto.png')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir imagen' }))
    await waitFor(() => expect(slideNode(slideNodeId()).imageAssetIds).toHaveLength(1))

    fireEvent.click(await screen.findByRole('button', { name: 'Quitar imagen 1' }))

    expect(slideNode(slideNodeId()).imageAssetIds).toEqual([])
    expect(screen.getByRole('button', { name: '+ Añadir imagen' })).toBeInTheDocument()
  })

  it('los botones ↑/↓ reordenan las imágenes; en los extremos quedan deshabilitados', async () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(slideNodeId())
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValueOnce('/tmp/foto.png').mockResolvedValueOnce('/tmp/foto2.png')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir imagen' }))
    await waitFor(() => expect(slideNode(slideNodeId()).imageAssetIds).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '+ Añadir imagen' }))
    await waitFor(() => expect(slideNode(slideNodeId()).imageAssetIds).toHaveLength(2))

    const [firstId, secondId] = slideNode(slideNodeId()).imageAssetIds

    // La primera imagen no se puede subir más (ya está arriba); la segunda
    // no se puede bajar más (ya está abajo).
    expect(screen.getByRole('button', { name: 'Subir imagen 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bajar imagen 2' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Bajar imagen 1' }))
    expect(slideNode(slideNodeId()).imageAssetIds).toEqual([secondId, firstId])

    fireEvent.click(screen.getByRole('button', { name: 'Subir imagen 2' }))
    expect(slideNode(slideNodeId()).imageAssetIds).toEqual([firstId, secondId])
  })

  it('el control de orden de contenido cambia contentOrder, por defecto "text-first"', () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(slideNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const select = screen.getByLabelText('Orden del contenido') as HTMLSelectElement
    expect(select.value).toBe('text-first')

    fireEvent.change(select, { target: { value: 'image-first' } })
    expect(slideNode(slideNodeId()).contentOrder).toBe('image-first')
  })

  it('adjuntar un audio a una diapositiva con respuestas actualiza audioAssetId y muestra el reproductor', async () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/audio.mp3')

    const { container } = renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar audio' }))

    await waitFor(() => {
      expect(slideNode(decisionId).audioAssetId).toBeDefined()
    })
    expect(pickImportAssetPath).toHaveBeenCalledWith('audio')

    await waitFor(() => {
      const audioEl = container.querySelector('audio')
      expect(audioEl).toBeTruthy()
      expect(audioEl?.getAttribute('src')).toContain('data:audio/mpeg;base64,')
    })
  })

  it('cancelar el diálogo de importar no cambia nada ni muestra error', async () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(slideNodeId())
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue(null)

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir imagen' }))

    await waitFor(() => expect(pickImportAssetPath).toHaveBeenCalled())

    expect(slideNode(slideNodeId()).imageAssetIds).toEqual([])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Añadir imagen' })).toBeInTheDocument()
  })

  it('un fallo de importAsset muestra un mensaje de error breve sin romper el resto del Inspector', async () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(slideNodeId())
    })
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/foto.png')
    const assetRepository = {
      importAsset: vi.fn().mockRejectedValue(new Error('boom')),
      getAsset: vi.fn(),
      gcOrphanAssets: vi.fn(),
    }

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir imagen' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/error|stack|undefined|NaN|\[object/i)
    // El resto del Inspector sigue funcionando (el título se puede seguir editando).
    expect(screen.getByLabelText('Título')).toBeInTheDocument()
    expect(slideNode(slideNodeId()).imageAssetIds).toEqual([])
  })

  it('un fallo de getAsset al cargar la vista previa muestra un mensaje de error sin romper los controles', async () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().updateNode(slideNodeId(), { imageAssetIds: ['asset-ya-adjunto'] })
      useProjectStore.getState().selectNode(slideNodeId())
    })
    const assetRepository = {
      importAsset: vi.fn(),
      getAsset: vi.fn().mockRejectedValue(new Error('boom')),
      gcOrphanAssets: vi.fn(),
    }

    renderInspectorWithServices({ assetRepository })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/error|stack|undefined|NaN|\[object/i)
    // El control de quitar sigue disponible a pesar del fallo de vista previa.
    expect(screen.getByRole('button', { name: 'Quitar imagen 1' })).toBeInTheDocument()
  })
})

describe('Inspector — puntuación por respuesta (fase 3, Milestone 2)', () => {
  it('escribir una puntuación y hacer blur produce exactamente una llamada efectiva', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const historyBefore = useProjectStore.getState().history.past.length
    const pointsInput = screen.getByLabelText('Puntuación de la respuesta 1')

    fireEvent.change(pointsInput, { target: { value: '1' } })
    fireEvent.change(pointsInput, { target: { value: '10' } })
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)

    fireEvent.blur(pointsInput)

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    expect(slideNode(decisionId).responses.find((r) => r.letter === 'A')?.points).toBe(10)

    // Un segundo blur sin más cambios no genera otra entrada.
    fireEvent.blur(pointsInput)
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
  })

  it('vaciar explícitamente la puntuación y hacer blur la borra (null -> undefined en el documento)', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      const responseId = slideNode(decisionId).responses[0]?.id
      if (!responseId) throw new Error('setup inválido')
      useProjectStore.getState().updateResponse(decisionId, responseId, { points: 5 })
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const pointsInput = screen.getByLabelText('Puntuación de la respuesta 1')
    expect(pointsInput).toHaveValue(5)

    fireEvent.change(pointsInput, { target: { value: '' } })
    fireEvent.blur(pointsInput)

    expect(
      slideNode(decisionId).responses.find((r) => r.letter === 'A')?.points,
    ).toBeUndefined()
  })
})

describe('Inspector — adjuntos de imagen/audio por respuesta (fase 3, Milestone 2)', () => {
  it('adjuntar/quitar imagen y audio en la respuesta A no afecta a la respuesta B ni al nodo', async () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    const assetRepository = new MemoryAssetRepository()
    assetRepository.registerSourceFile('/tmp/foto.png', new Uint8Array([1, 2, 3]), 'image/png')
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/foto.png')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar imagen de la respuesta 1' }))

    await waitFor(() => {
      const responseA = slideNode(decisionId).responses.find((r) => r.letter === 'A')
      expect(responseA?.imageAssetId).toBeDefined()
    })

    const node = slideNode(decisionId)
    const responseB = node.responses.find((r) => r.letter === 'B')
    expect(responseB?.imageAssetId).toBeUndefined()
    expect(node.imageAssetIds).toEqual([])

    fireEvent.click(
      await screen.findByRole('button', { name: 'Quitar imagen de la respuesta 1' }),
    )

    expect(
      slideNode(decisionId).responses.find((r) => r.letter === 'A')?.imageAssetId,
    ).toBeUndefined()
    expect(
      screen.getByRole('button', { name: 'Adjuntar imagen de la respuesta 1' }),
    ).toBeInTheDocument()
  })
})

describe('Inspector — editor de texto enriquecido del campo "Contenido" (fase 4, Milestone 2)', () => {
  /** Espera al `requestAnimationFrame` que `editor.chain().focus()` programa
   *  internamente antes de mover el foco real al DOM (ver
   *  `RichTextEditor.test.tsx` para el detalle). */
  function waitOneFrame() {
    return new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
  }

  async function blurByMovingFocusAway() {
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    elsewhere.focus()
    await waitOneFrame()
  }

  it(
    'compatibilidad hacia atrás: un nodo con body en texto plano histórico (Milestone 1) se ' +
      'muestra como párrafo normal, no como JSON en crudo',
    async () => {
      act(() => {
        // Simula un proyecto creado antes de esta fase: `body` es
        // literalmente el texto del usuario, nunca un documento Tiptap
        // serializado.
        useProjectStore.getState().updateNode(startNodeId(), { body: 'Texto plano histórico' })
        useProjectStore.getState().selectNode(startNodeId())
      })

      render(<Inspector filePath={TEST_FILE_PATH} />)

      const contentField = await screen.findByLabelText('Contenido')
      await waitFor(() => {
        expect(contentField).toHaveTextContent('Texto plano histórico')
      })
      // Nunca se muestra el JSON en crudo ni llaves de objeto.
      expect(contentField.textContent).not.toMatch(/[{}]/)
    },
  )

  it('escribir en el editor enriquecido y perder el foco confirma exactamente una vez en el store', async () => {
    act(() => {
      useProjectStore.getState().updateNode(startNodeId(), { body: 'Hola' })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const historyBefore = useProjectStore.getState().history.past.length
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement
    editable.focus()
    await waitOneFrame()

    // `toggleBulletList` es el comando fiable en jsdom para mutar el
    // documento sin depender de una selección de texto real (ver nota en
    // `RichTextEditor.test.tsx`); prueba el mismo circuito de commit on
    // blur que negrita/cursiva usarían con una selección real.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Lista con viñetas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lista con viñetas' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Lista con viñetas' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })
    // Ninguna pulsación debe haber tocado el store todavía.
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)

    await blurByMovingFocusAway()

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const node = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startNodeId())
    const bodyDoc = JSON.parse(node?.body ?? '{}')
    expect(bodyDoc.content[0].type).toBe('bulletList')

    // Un segundo blur sin más cambios no debe generar otra entrada.
    await blurByMovingFocusAway()
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
  })

  it('cambiar de nodo seleccionado sin hacer blur en el editor enriquecido confirma la edición pendiente', async () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().updateNode(startNodeId(), { body: 'Hola' })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const historyBefore = useProjectStore.getState().history.past.length
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement
    editable.focus()
    await waitOneFrame()

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Lista con viñetas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lista con viñetas' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Lista con viñetas' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })

    // Cambia de selección sin haber perdido el foco del editor antes —
    // `NodeFields` remonta con `key={node.id}`, así que `RichTextEditor` se
    // desmonta sin blur previo.
    act(() => {
      useProjectStore.getState().selectNode(slideNodeId())
    })

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const startNode = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startNodeId())
    const bodyDoc = JSON.parse(startNode?.body ?? '{}')
    expect(bodyDoc.content[0].type).toBe('bulletList')
  })
})

describe('Inspector — panel redimensionable (tarea 2)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('arrastrar el asa hacia la izquierda ensancha el panel y lo persiste', () => {
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const handle = screen.getByLabelText('Redimensionar panel derecho')
    const aside = handle.closest('aside') as HTMLElement
    const widthBefore = aside.style.width

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 400, pointerId: 1 })

    // Arrastrar 100px hacia la izquierda ensancha el panel en 100px.
    const before = Number.parseInt(widthBefore, 10)
    const after = Number.parseInt(aside.style.width, 10)
    expect(after).toBe(before + 100)
    expect(window.localStorage.getItem('brunch-studio:inspector-width')).toBe(String(after))
  })

  it('el ancho nunca baja del mínimo (280px) aunque se arrastre mucho hacia la derecha', () => {
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const handle = screen.getByLabelText('Redimensionar panel derecho')
    const aside = handle.closest('aside') as HTMLElement

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 5000, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 5000, pointerId: 1 })

    expect(Number.parseInt(aside.style.width, 10)).toBe(280)
  })
})

describe('Inspector — nota interna (tarea 6: puramente interna, no se exporta)', () => {
  it('edita y confirma la nota interna de una diapositiva al perder el foco', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const field = screen.getByLabelText('Nota interna (no se exporta)')
    expect(field).toHaveValue('')

    fireEvent.change(field, { target: { value: 'Pedir gráfico a diseño' } })
    fireEvent.blur(field)

    expect(slideNode(startNodeId()).internalNote).toBe('Pedir gráfico a diseño')
  })

  it('vaciar la nota interna y perder el foco la borra (null -> undefined en el documento)', () => {
    act(() => {
      useProjectStore.getState().updateNode(startNodeId(), { internalNote: 'Nota previa' })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const field = screen.getByLabelText('Nota interna (no se exporta)')
    expect(field).toHaveValue('Nota previa')

    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)

    const node = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startNodeId())
    expect(node?.internalNote).toBeUndefined()
  })

  it('también está disponible en un nodo Final', () => {
    act(() => {
      useProjectStore.getState().createNode('final', { x: 100, y: 0 })
      const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
      if (!finalId) throw new Error('setup inválido')
      useProjectStore.getState().selectNode(finalId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Nota interna (no se exporta)')).toBeInTheDocument()
  })
})

describe('Inspector — navegación rápida entre diapositivas conectadas (tarea 7)', () => {
  it('sin ninguna conexión, no muestra ninguna de las dos secciones', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.queryByText('Diapositivas que llevan aquí')).not.toBeInTheDocument()
    expect(screen.queryByText('A dónde lleva esta diapositiva')).not.toBeInTheDocument()
  })

  it('muestra las entrantes (quién apunta aquí) y las salientes (a dónde lleva), con varias respuestas', () => {
    act(() => {
      useProjectStore.getState().updateNode(startNodeId(), { title: 'Inicio' })
      useProjectStore.getState().createNode('slide', { x: 100, y: 0 }, { title: 'Intermedia' })
    })
    const middleId = slideNodeId()
    act(() => {
      useProjectStore.getState().connect(startNodeId(), middleId)
      useProjectStore.getState().createNode('final', { x: 200, y: 0 }, { title: 'Final A' })
      useProjectStore.getState().createNode('final', { x: 200, y: 100 }, { title: 'Final B' })
    })
    const finals = useProjectStore.getState().project.graph.nodes.filter((n) => n.type === 'final')
    const [finalA, finalB] = finals
    if (!finalA || !finalB) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().addResponse(middleId)
      useProjectStore.getState().addResponse(middleId)
    })
    const middleResponses = slideNode(middleId).responses
    act(() => {
      useProjectStore.getState().connect(middleId, finalA.id, middleResponses[0]?.id)
      useProjectStore.getState().connect(middleId, finalB.id, middleResponses[1]?.id)
      useProjectStore.getState().selectNode(middleId)
    })

    render(<Inspector filePath={TEST_FILE_PATH} />)

    const incoming = screen.getByText('Diapositivas que llevan aquí').closest('div') as HTMLElement
    expect(within(incoming).getByText(/Inicio/)).toBeInTheDocument()

    const outgoing = screen.getByText('A dónde lleva esta diapositiva').closest('div') as HTMLElement
    expect(within(outgoing).getByText(/Final A/)).toBeInTheDocument()
    expect(within(outgoing).getByText(/Final B/)).toBeInTheDocument()
  })

  it('un nodo Final solo puede tener entrantes, nunca salientes', () => {
    act(() => {
      useProjectStore.getState().createNode('final', { x: 100, y: 0 }, { title: 'Fin' })
    })
    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().connect(startNodeId(), finalId)
      useProjectStore.getState().selectNode(finalId)
    })

    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByText('Diapositivas que llevan aquí')).toBeInTheDocument()
    expect(screen.queryByText('A dónde lleva esta diapositiva')).not.toBeInTheDocument()
  })

  it('hacer clic en una diapositiva conectada la selecciona y pide centrar el lienzo (focusNode)', () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 100, y: 0 }, { title: 'Destino' })
    })
    const targetId = slideNodeId()
    act(() => {
      useProjectStore.getState().connect(startNodeId(), targetId)
      useProjectStore.getState().selectNode(startNodeId())
    })

    render(<Inspector filePath={TEST_FILE_PATH} />)

    const outgoing = screen.getByText('A dónde lleva esta diapositiva').closest('div') as HTMLElement
    fireEvent.click(within(outgoing).getByText(/Destino/))

    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([targetId])
    expect(useProjectStore.getState().ui.focusRequestNodeId).toBe(targetId)
  })

  it('muestra "Sin título" para una diapositiva conectada sin título', () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 100, y: 0 })
    })
    const targetId = slideNodeId()
    act(() => {
      useProjectStore.getState().connect(startNodeId(), targetId)
      useProjectStore.getState().selectNode(startNodeId())
    })

    render(<Inspector filePath={TEST_FILE_PATH} />)

    const outgoing = screen.getByText('A dónde lleva esta diapositiva').closest('div') as HTMLElement
    expect(within(outgoing).getByText(/Sin título/)).toBeInTheDocument()
  })
})

describe('Inspector — condición y efectos de variables de una respuesta (fase 2 "Variables/condiciones", Tarea 2)', () => {
  it('sin variables en el proyecto, muestra un aviso en vez de un desplegable vacío', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(
      screen.getAllByText(/Todavía no hay variables en el proyecto/)[0],
    ).toBeInTheDocument()
    expect(screen.queryByText('Condición de visibilidad')).not.toBeInTheDocument()
    expect(screen.queryByText('Efectos al elegir esta respuesta')).not.toBeInTheDocument()
  })

  it('añadir y quitar una condición de visibilidad numérica', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 0 })
    })
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getAllByRole('button', { name: '+ Añadir condición' })[0]!)

    const responseA = slideNode(decisionId).responses.find((r) => r.letter === 'A')
    expect(responseA?.condition).toEqual({ variableId: expect.any(String), operator: '==', value: 0 })

    fireEvent.click(screen.getByRole('button', { name: 'Quitar condición' }))
    expect(
      slideNode(decisionId).responses.find((r) => r.letter === 'A')?.condition,
    ).toBeUndefined()
  })

  it('el operador de una condición se acota a ==/!= cuando la variable es booleana', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Aprobado', type: 'boolean', initialValue: false })
    })
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getAllByRole('button', { name: '+ Añadir condición' })[0]!)

    const operatorSelect = document.getElementById(
      `inspector-response-condition-${slideNode(decisionId).responses[0]?.id}-operator`,
    ) as HTMLSelectElement
    const optionValues = Array.from(operatorSelect.options).map((option) => option.value)
    expect(optionValues).toEqual(['==', '!='])

    // El valor se muestra como Sí/No, no como campo numérico.
    const valueSelect = document.getElementById(
      `inspector-response-condition-${slideNode(decisionId).responses[0]?.id}-value`,
    ) as HTMLSelectElement
    expect(valueSelect.tagName).toBe('SELECT')
  })

  it('añadir un efecto "set" numérico y editar su valor', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 0 })
    })
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getAllByRole('button', { name: '+ Añadir efecto' })[0]!)

    const responseA = slideNode(decisionId).responses.find((r) => r.letter === 'A')
    expect(responseA?.effects).toEqual([{ variableId: expect.any(String), operation: 'set', value: 0 }])

    const valueField = screen.getByLabelText('Valor del efecto 1')
    fireEvent.change(valueField, { target: { value: '7' } })
    fireEvent.blur(valueField)

    expect(
      slideNode(decisionId).responses.find((r) => r.letter === 'A')?.effects?.[0]?.value,
    ).toBe(7)
  })

  it('la operación de un efecto se acota a "set" cuando la variable es booleana (sin sumar/restar)', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Aprobado', type: 'boolean', initialValue: false })
    })
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getAllByRole('button', { name: '+ Añadir efecto' })[0]!)

    const operationSelect = screen.getByLabelText('Operación del efecto 1') as HTMLSelectElement
    const optionValues = Array.from(operationSelect.options).map((option) => option.value)
    expect(optionValues).toEqual(['set'])
  })

  it('quitar un efecto lo elimina de la lista; sin efectos restantes, el campo queda sin definir', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 0 })
    })
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getAllByRole('button', { name: '+ Añadir efecto' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Quitar efecto 1' }))

    expect(
      slideNode(decisionId).responses.find((r) => r.letter === 'A')?.effects,
    ).toBeUndefined()
  })
})

describe('Inspector — enrutado condicional de una diapositiva "de continuar" (fase 2, Tarea 3)', () => {
  it('sin variables en el proyecto, muestra un aviso en vez del control de activar', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByText('Enrutado condicional')).toBeInTheDocument()
    expect(
      screen.getByText(/Todavía no hay variables en el proyecto/),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '+ Activar enrutado condicional' }),
    ).not.toBeInTheDocument()
  })

  it('activar fija una condición por defecto; fijar el destino "si no"; desactivar limpia ambos campos', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 0 })
      useProjectStore.getState().createNode('final', { x: 100, y: 0 }, { title: 'Final si no' })
      useProjectStore.getState().selectNode(startNodeId())
    })
    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')

    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Activar enrutado condicional' }))

    expect(slideNode(startNodeId()).condition).toEqual({
      variableId: expect.any(String),
      operator: '==',
      value: 0,
    })
    expect(screen.getByLabelText('Destino "si no"')).toBeInTheDocument()

    const elseSelect = screen.getByLabelText('Destino "si no"') as HTMLSelectElement
    fireEvent.change(elseSelect, { target: { value: finalId } })
    expect(slideNode(startNodeId()).elseTargetNodeId).toBe(finalId)

    fireEvent.click(screen.getByRole('button', { name: 'Desactivar enrutado condicional' }))

    const node = slideNode(startNodeId())
    expect(node.condition).toBeUndefined()
    expect(node.elseTargetNodeId).toBeUndefined()
    // Vuelve al estado "sin activar".
    expect(screen.getByRole('button', { name: '+ Activar enrutado condicional' })).toBeInTheDocument()
  })

  it('el enrutado condicional no aparece cuando la diapositiva tiene respuestas (modo decisión)', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 0 })
    })
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.queryByText('Enrutado condicional')).not.toBeInTheDocument()
  })
})

describe('Inspector — botón "+ Añadir respuesta" en el flujo del listado (tarea 9)', () => {
  it('el botón aparece justo después de la última respuesta en el DOM', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const responsesList = document.querySelector(`.${styles.responsesList}`) as HTMLElement
    const children = [...responsesList.children]

    // Los dos últimos elementos del listado son la última fila de respuesta
    // y, justo después, el botón de añadir — nunca antes.
    const lastTwo = children.slice(-2)
    expect(lastTwo[0]?.className).toBe(styles.responseRow)
    expect(lastTwo[1]?.tagName).toBe('BUTTON')
    expect(lastTwo[1]?.textContent).toBe('+ Añadir respuesta')
  })

  it('tras añadir una respuesta más, el botón sigue apareciendo después de la nueva última fila', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir respuesta' }))

    expect(screen.getByLabelText('Texto de la respuesta 3')).toBeInTheDocument()
    const responsesList = document.querySelector(`.${styles.responsesList}`) as HTMLElement
    const children = [...responsesList.children]
    const lastTwo = children.slice(-2)
    expect(lastTwo[0]?.className).toBe(styles.responseRow)
    expect(lastTwo[1]?.textContent).toBe('+ Añadir respuesta')
  })

  it('al llegar al máximo de respuestas, el botón desaparece (ya cubierto arriba; se confirma aquí también)', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().addResponse(decisionId)
      useProjectStore.getState().addResponse(decisionId)
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.queryByRole('button', { name: '+ Añadir respuesta' })).not.toBeInTheDocument()
  })
})
