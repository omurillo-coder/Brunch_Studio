import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Inspector } from '../Inspector'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'
import type { ContentNode, DecisionNode } from '../../../domain'
import { AppServicesProvider } from '../../../app/AppServicesContext'
import type { AppServices } from '../../../app/AppServices'
import { MemoryAssetRepository } from '../../../persistence'

const TEST_FILE_PATH = '/tmp/inspector-test.brunch'

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

function contentNodeId(): string {
  const node = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'content')
  if (!node) throw new Error('No hay nodo content')
  return node.id
}

function contentNode(id: string): ContentNode {
  const node = useProjectStore.getState().project.graph.nodes.find((n) => n.id === id)
  if (!node || node.type !== 'content') throw new Error('No es un nodo content')
  return node
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
    // Un proyecto recién creado tiene exactamente 1 nodo (el Inicio) y el
    // desglose por tipo lo confirma.
    const totalRow = screen.getByText('Nodos totales').closest('div')
    expect(totalRow).toHaveTextContent('1')
    const startRow = screen.getByText('Inicio').closest('div')
    expect(startRow).toHaveTextContent('1')
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
      useProjectStore.getState().createNode('content', { x: 0, y: 0 }, { title: 'Pantalla 2' })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

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
    render(<Inspector filePath={TEST_FILE_PATH} />)

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

describe('Inspector — sección de Decisión (fase 6)', () => {
  it('seleccionar un nodo decision muestra sus respuestas existentes (A y B) con sus textos', () => {
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(decisionNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Texto de la respuesta A')).toHaveValue('')
    expect(screen.getByLabelText('Texto de la respuesta B')).toHaveValue('')
    expect(screen.queryByLabelText('Texto de la respuesta C')).not.toBeInTheDocument()
  })

  it('editar el texto de una respuesta y hacer blur produce exactamente una llamada efectiva', () => {
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(decisionNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

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
    render(<Inspector filePath={TEST_FILE_PATH} />)

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
    render(<Inspector filePath={TEST_FILE_PATH} />)

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
    render(<Inspector filePath={TEST_FILE_PATH} />)

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
    render(<Inspector filePath={TEST_FILE_PATH} />)

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
    render(<Inspector filePath={TEST_FILE_PATH} />)

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
    render(<Inspector filePath={TEST_FILE_PATH} />)

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
    render(<Inspector filePath={TEST_FILE_PATH} />)

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
    render(<Inspector filePath={TEST_FILE_PATH} />)

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
    render(<Inspector filePath={TEST_FILE_PATH} />)

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
    render(<Inspector filePath={TEST_FILE_PATH} />)

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

describe('Inspector — adjuntos de imagen/audio a nivel de nodo (fase 3, Milestone 2)', () => {
  function setupAssetRepository() {
    const assetRepository = new MemoryAssetRepository()
    assetRepository.registerSourceFile('/tmp/foto.png', new Uint8Array([1, 2, 3]), 'image/png')
    assetRepository.registerSourceFile('/tmp/audio.mp3', new Uint8Array([4, 5, 6]), 'audio/mpeg')
    return assetRepository
  }

  it('adjuntar una imagen a un nodo Pantalla actualiza imageAssetId y muestra la vista previa', async () => {
    act(() => {
      useProjectStore.getState().createNode('content', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(contentNodeId())
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/foto.png')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar imagen' }))

    await waitFor(() => {
      expect(contentNode(contentNodeId()).imageAssetId).toBeDefined()
    })
    expect(pickImportAssetPath).toHaveBeenCalledWith('image')

    const preview = (await screen.findByAltText(
      'Vista previa de la imagen adjunta',
    )) as HTMLImageElement
    expect(preview.getAttribute('src')).toContain('data:image/png;base64,')
  })

  it('adjuntar un audio a un nodo Decisión actualiza audioAssetId y muestra el reproductor', async () => {
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(decisionNodeId())
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/audio.mp3')

    const { container } = renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar audio' }))

    await waitFor(() => {
      expect(decisionNode(decisionNodeId()).audioAssetId).toBeDefined()
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
      useProjectStore.getState().createNode('content', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(contentNodeId())
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/foto.png')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar imagen' }))
    await waitFor(() => expect(contentNode(contentNodeId()).imageAssetId).toBeDefined())

    fireEvent.click(await screen.findByRole('button', { name: 'Quitar imagen' }))

    expect(contentNode(contentNodeId()).imageAssetId).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Adjuntar imagen' })).toBeInTheDocument()
  })

  it('cancelar el diálogo de importar no cambia nada ni muestra error', async () => {
    act(() => {
      useProjectStore.getState().createNode('content', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(contentNodeId())
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue(null)

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar imagen' }))

    await waitFor(() => expect(pickImportAssetPath).toHaveBeenCalled())

    expect(contentNode(contentNodeId()).imageAssetId).toBeUndefined()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adjuntar imagen' })).toBeInTheDocument()
  })

  it('un fallo de importAsset muestra un mensaje de error breve sin romper el resto del Inspector', async () => {
    act(() => {
      useProjectStore.getState().createNode('content', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(contentNodeId())
    })
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/foto.png')
    const assetRepository = {
      importAsset: vi.fn().mockRejectedValue(new Error('boom')),
      getAsset: vi.fn(),
    }

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar imagen' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/error|stack|undefined|NaN|\[object/i)
    // El resto del Inspector sigue funcionando (el título se puede seguir editando).
    expect(screen.getByLabelText('Título')).toBeInTheDocument()
    expect(contentNode(contentNodeId()).imageAssetId).toBeUndefined()
  })

  it('un fallo de getAsset al cargar la vista previa muestra un mensaje de error sin romper los controles', async () => {
    act(() => {
      useProjectStore.getState().createNode('content', { x: 0, y: 0 })
      useProjectStore.getState().updateNode(contentNodeId(), { imageAssetId: 'asset-ya-adjunto' })
      useProjectStore.getState().selectNode(contentNodeId())
    })
    const assetRepository = {
      importAsset: vi.fn(),
      getAsset: vi.fn().mockRejectedValue(new Error('boom')),
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
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(decisionNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const historyBefore = useProjectStore.getState().history.past.length
    const pointsInput = screen.getByLabelText('Puntuación de la respuesta A')

    fireEvent.change(pointsInput, { target: { value: '1' } })
    fireEvent.change(pointsInput, { target: { value: '10' } })
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)

    fireEvent.blur(pointsInput)

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    expect(decisionNode(decisionNodeId()).responses.find((r) => r.letter === 'A')?.points).toBe(10)

    // Un segundo blur sin más cambios no genera otra entrada.
    fireEvent.blur(pointsInput)
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
  })

  it('vaciar explícitamente la puntuación y hacer blur la borra (null -> undefined en el documento)', () => {
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      const decisionId = decisionNodeId()
      const responseId = decisionNode(decisionId).responses[0]?.id
      if (!responseId) throw new Error('setup inválido')
      useProjectStore.getState().updateResponse(decisionId, responseId, { points: 5 })
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const pointsInput = screen.getByLabelText('Puntuación de la respuesta A')
    expect(pointsInput).toHaveValue(5)

    fireEvent.change(pointsInput, { target: { value: '' } })
    fireEvent.blur(pointsInput)

    expect(
      decisionNode(decisionNodeId()).responses.find((r) => r.letter === 'A')?.points,
    ).toBeUndefined()
  })
})

describe('Inspector — adjuntos de imagen/audio por respuesta (fase 3, Milestone 2)', () => {
  it('adjuntar/quitar imagen y audio en la respuesta A no afecta a la respuesta B ni al nodo', async () => {
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(decisionNodeId())
    })
    const assetRepository = new MemoryAssetRepository()
    assetRepository.registerSourceFile('/tmp/foto.png', new Uint8Array([1, 2, 3]), 'image/png')
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/foto.png')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar imagen de la respuesta A' }))

    await waitFor(() => {
      const responseA = decisionNode(decisionNodeId()).responses.find((r) => r.letter === 'A')
      expect(responseA?.imageAssetId).toBeDefined()
    })

    const node = decisionNode(decisionNodeId())
    const responseB = node.responses.find((r) => r.letter === 'B')
    expect(responseB?.imageAssetId).toBeUndefined()
    expect(node.imageAssetId).toBeUndefined()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Quitar imagen de la respuesta A' }),
    )

    expect(
      decisionNode(decisionNodeId()).responses.find((r) => r.letter === 'A')?.imageAssetId,
    ).toBeUndefined()
    expect(
      screen.getByRole('button', { name: 'Adjuntar imagen de la respuesta A' }),
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
      useProjectStore.getState().createNode('content', { x: 0, y: 0 })
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

    const otherNode = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.type === 'content')
    if (!otherNode) throw new Error('No hay nodo content')

    // Cambia de selección sin haber perdido el foco del editor antes —
    // `NodeFields` remonta con `key={node.id}`, así que `RichTextEditor` se
    // desmonta sin blur previo.
    act(() => {
      useProjectStore.getState().selectNode(otherNode.id)
    })

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const startNode = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startNodeId())
    const bodyDoc = JSON.parse(startNode?.body ?? '{}')
    expect(bodyDoc.content[0].type).toBe('bulletList')
  })
})
