import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Inspector } from '../Inspector'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'
import type { SlideNode } from '../../../domain'
import { AppServicesProvider } from '../../../app/AppServicesContext'
import type { AppServices } from '../../../app/AppServices'
import { MemoryAssetRepository } from '../../../persistence'

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

  it('el botón de eliminar borra una diapositiva y el Inspector vuelve a "sin selección"', () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Diapositiva 2' })
    })
    const slideId = slideNodeId()
    act(() => {
      useProjectStore.getState().selectNode(slideId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar diapositiva' }))

    expect(useProjectStore.getState().project.graph.nodes.some((n) => n.id === slideId)).toBe(false)
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
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar final' }))

    expect(
      useProjectStore.getState().project.graph.nodes.some((n) => n.type === 'final'),
    ).toBe(false)
  })

  it('el botón de eliminar borra una diapositiva con respuestas (antes "Decisión")', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar diapositiva' }))

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

describe('Inspector — adjuntos de imagen/audio a nivel de nodo (fase 3, Milestone 2)', () => {
  function setupAssetRepository() {
    const assetRepository = new MemoryAssetRepository()
    assetRepository.registerSourceFile('/tmp/foto.png', new Uint8Array([1, 2, 3]), 'image/png')
    assetRepository.registerSourceFile('/tmp/audio.mp3', new Uint8Array([4, 5, 6]), 'audio/mpeg')
    return assetRepository
  }

  it('adjuntar una imagen a una diapositiva actualiza imageAssetId y muestra la vista previa', async () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(slideNodeId())
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/foto.png')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar imagen' }))

    await waitFor(() => {
      expect(slideNode(slideNodeId()).imageAssetId).toBeDefined()
    })
    expect(pickImportAssetPath).toHaveBeenCalledWith('image')

    const preview = (await screen.findByAltText(
      'Vista previa de la imagen adjunta',
    )) as HTMLImageElement
    expect(preview.getAttribute('src')).toContain('data:image/png;base64,')
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

  it('quitar la imagen limpia imageAssetId y vuelve a mostrarse "Adjuntar imagen"', async () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(slideNodeId())
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/foto.png')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar imagen' }))
    await waitFor(() => expect(slideNode(slideNodeId()).imageAssetId).toBeDefined())

    fireEvent.click(await screen.findByRole('button', { name: 'Quitar imagen' }))

    expect(slideNode(slideNodeId()).imageAssetId).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Adjuntar imagen' })).toBeInTheDocument()
  })

  it('cancelar el diálogo de importar no cambia nada ni muestra error', async () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(slideNodeId())
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue(null)

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar imagen' }))

    await waitFor(() => expect(pickImportAssetPath).toHaveBeenCalled())

    expect(slideNode(slideNodeId()).imageAssetId).toBeUndefined()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adjuntar imagen' })).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar imagen' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/error|stack|undefined|NaN|\[object/i)
    // El resto del Inspector sigue funcionando (el título se puede seguir editando).
    expect(screen.getByLabelText('Título')).toBeInTheDocument()
    expect(slideNode(slideNodeId()).imageAssetId).toBeUndefined()
  })

  it('un fallo de getAsset al cargar la vista previa muestra un mensaje de error sin romper los controles', async () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().updateNode(slideNodeId(), { imageAssetId: 'asset-ya-adjunto' })
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
    // Los controles de reemplazar/quitar siguen disponibles a pesar del fallo de vista previa.
    expect(screen.getByRole('button', { name: 'Quitar imagen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reemplazar imagen' })).toBeInTheDocument()
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
    expect(node.imageAssetId).toBeUndefined()

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
