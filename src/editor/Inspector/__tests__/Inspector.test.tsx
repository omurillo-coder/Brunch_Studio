import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Inspector } from '../Inspector'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'
import { asignaturaWorkspaceName, CICLOS } from '../../../domain'
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

/** Id del primer bloque de `content` de una diapositiva — normalmente el
 *  bloque de texto inicial que `createNode`/`createProject` siembran (ver
 *  `src/domain/project.ts`), salvo que el test ya lo haya modificado. */
function firstBlockId(nodeId: string): string {
  const id = slideNode(nodeId).content[0]?.id
  if (!id) throw new Error('La diapositiva no tiene ningún bloque de contenido')
  return id
}

/** Espera al `requestAnimationFrame` que `editor.chain().focus()` programa
 *  internamente antes de mover el foco real al DOM (ver
 *  `RichTextEditor.test.tsx` para el detalle). Compartida por los tests del
 *  editor de texto enriquecido de un bloque, tanto con un único bloque de
 *  texto como con varios a la vez. */
function waitOneFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

async function blurByMovingFocusAway() {
  const elsewhere = document.createElement('button')
  document.body.appendChild(elsewhere)
  elsewhere.focus()
  await waitOneFrame()
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
      useProjectStore.getState().updateNode(startNodeId(), { title: 'Bienvenida' })
      useProjectStore
        .getState()
        .updateTextBlockBody(startNodeId(), firstBlockId(startNodeId()), 'Hola')
      useProjectStore.getState().selectNode(startNodeId())
    })

    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Ref. oculta')).toHaveValue('Bienvenida')
    // El bloque de texto se edita con el mismo editor de texto enriquecido
    // de siempre (`RichTextEditor`, fase 4 Milestone 2): un `<div
    // contenteditable>`, no un `<textarea>` con `.value` — se comprueba el
    // texto renderizado. Con un único bloque de texto (el caso sembrado por
    // `createProject`), se etiqueta "Texto 1".
    await waitFor(() => {
      expect(screen.getByLabelText('Texto 1')).toHaveTextContent('Hola')
    })
  })

  it('el campo de título tiene el corrector nativo activado con idioma español (fase 8)', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const titleInput = screen.getByLabelText('Ref. oculta')
    expect(titleInput).toHaveAttribute('spellcheck', 'true')
    expect(titleInput).toHaveAttribute('lang', 'es')
  })

  it('editar y hacer blur produce exactamente una llamada efectiva a updateNode', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const historyBefore = useProjectStore.getState().history.past.length
    const titleInput = screen.getByLabelText('Ref. oculta')

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
    const titleInput = screen.getByLabelText('Ref. oculta')

    fireEvent.change(titleInput, { target: { value: 'Confirmado con Enter' } })
    fireEvent.keyDown(titleInput, { key: 'Enter' })

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
  })

  it('cambiar de nodo seleccionado actualiza los campos mostrados', () => {
    act(() => {
      useProjectStore.getState().updateNode(startNodeId(), { title: 'Inicio' })
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Diapositiva 2' })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Ref. oculta')).toHaveValue('Inicio')

    act(() => {
      useProjectStore.getState().selectNode(slideNodeId())
    })

    expect(screen.getByLabelText('Ref. oculta')).toHaveValue('Diapositiva 2')
  })

  it('cambiar de selección sin hacer blur confirma la edición pendiente', () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const historyBefore = useProjectStore.getState().history.past.length
    const titleInput = screen.getByLabelText('Ref. oculta')
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

    expect(screen.getByLabelText('Ref. oculta')).toHaveFocus()
    expect(useProjectStore.getState().ui.titleFocusRequestNodeId).toBeNull()
  })

  it('una selección normal (selectNode) no pide ni consume el foco de título', () => {
    act(() => {
      useProjectStore.getState().updateNode(startNodeId(), { title: 'Inicio' })
      useProjectStore.getState().selectNode(startNodeId())
    })

    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Ref. oculta')).not.toHaveFocus()
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

describe('Inspector — orden de las respuestas (petición de usuario: interruptor "Ordenar"/"Random" + botones Subir/Bajar)', () => {
  it('con 0 o 1 respuesta no aparece el interruptor', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().removeResponse(decisionId, slideNode(decisionId).responses[1]!.id)
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.queryByRole('group', { name: 'Orden de las respuestas' })).not.toBeInTheDocument()
  })

  it('con más de una respuesta, el interruptor aparece con "Ordenar" activo por defecto', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByRole('group', { name: 'Orden de las respuestas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ordenar' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Random' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('pulsar "Random" fija responseOrder; pulsar "Ordenar" lo borra (vuelve al valor por defecto)', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: 'Random' }))
    expect(slideNode(decisionId).responseOrder).toBe('random')
    expect(screen.getByRole('button', { name: 'Random' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Ordenar' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Ordenar' }))
    expect(slideNode(decisionId).responseOrder).toBeUndefined()
  })

  it('con "Ordenar" (por defecto), cada respuesta tiene botones Subir/Bajar; el primero no puede subir ni el último bajar', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().addResponse(decisionId) // C
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByRole('button', { name: 'Subir respuesta 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bajar respuesta 1' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Subir respuesta 2' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bajar respuesta 2' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Subir respuesta 3' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bajar respuesta 3' })).toBeDisabled()
  })

  it('pulsar "Bajar" en la primera respuesta la mueve a la posición 2, sin tocar id/letra', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    const [responseA, responseB] = slideNode(decisionId).responses
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: 'Bajar respuesta 1' }))

    const responses = slideNode(decisionId).responses
    expect(responses.map((r) => r.id)).toEqual([responseB!.id, responseA!.id])
    expect(responses.map((r) => r.letter).sort()).toEqual(['A', 'B'])
    // Las filas del Inspector reflejan el nuevo orden: el texto de la
    // "respuesta 1" ahora es el de B, no el de A.
    expect(screen.getByLabelText('Texto de la respuesta 1')).toBeInTheDocument()
  })

  it('con "Random", NO aparecen los botones Subir/Bajar', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: 'Random' }))

    expect(screen.queryByRole('button', { name: 'Subir respuesta 1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bajar respuesta 1' })).not.toBeInTheDocument()
  })
})

describe('Inspector — editor de bloques de contenido de una diapositiva (milestone "Bloques de contenido", fase 2)', () => {
  function setupAssetRepository() {
    const assetRepository = new MemoryAssetRepository()
    assetRepository.registerSourceFile('/tmp/foto.png', new Uint8Array([1, 2, 3]), 'image/png')
    assetRepository.registerSourceFile('/tmp/foto2.png', new Uint8Array([7, 8, 9]), 'image/png')
    assetRepository.registerSourceFile('/tmp/audio.mp3', new Uint8Array([4, 5, 6]), 'audio/mpeg')
    assetRepository.registerSourceFile('/tmp/clip.mp4', new Uint8Array([10, 11, 12]), 'video/mp4')
    return assetRepository
  }

  /** Diapositiva nueva SIN el bloque de texto inicial que siembra
   *  `createNode` (se quita justo después de crearla): simplifica las
   *  aserciones de posición de los tests centrados en imagen/audio, que así
   *  parten de una lista de bloques vacía en vez de "bloque de texto en la
   *  posición 1, imagen en la 2". El propio dominio permite `content: []`
   *  (ver comentario de `removeContentBlock` en `src/domain/content.ts`). */
  function createEmptySlide(): string {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
    })
    const id = slideNodeId()
    act(() => {
      useProjectStore.getState().removeContentBlock(id, firstBlockId(id))
    })
    return id
  }

  it('"+ Texto" añade un bloque de texto vacío al final de content', () => {
    const id = createEmptySlide()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Texto' }))

    expect(slideNode(id).content).toMatchObject([{ type: 'text', body: '' }])
    expect(screen.getByLabelText('Texto 1')).toBeInTheDocument()
  })

  it('"+ Imagen" añade un bloque de imagen a content y muestra su vista previa', async () => {
    const id = createEmptySlide()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/foto.png')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Imagen' }))

    await waitFor(() => {
      expect(slideNode(id).content).toHaveLength(1)
    })
    expect(pickImportAssetPath).toHaveBeenCalledWith('image')
    expect(slideNode(id).content[0]).toMatchObject({ type: 'image' })

    const preview = (await screen.findByAltText(
      'Vista previa de la imagen adjunta 1',
    )) as HTMLImageElement
    expect(preview.getAttribute('src')).toContain('data:image/png;base64,')
  })

  it('milestone "+1 fallo con Game Over": un bloque de imagen pendiente muestra "Adjuntar imagen"; adjuntar rellena el assetId y sustituye el aviso por la vista previa', async () => {
    const id = createEmptySlide()
    act(() => {
      useProjectStore.getState().addImageBlock(id) // sin assetId: "pendiente de subir"
      useProjectStore.getState().selectNode(id)
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/foto.png')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    expect(screen.getByText(/Imagen pendiente de subir/)).toBeInTheDocument()
    expect(screen.queryByAltText('Vista previa de la imagen adjunta 1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar imagen' }))

    await waitFor(() => {
      const block = slideNode(id).content[0]
      expect(block?.type === 'image' ? block.assetId : undefined).toBeDefined()
    })
    expect(pickImportAssetPath).toHaveBeenCalledWith('image')

    const preview = (await screen.findByAltText(
      'Vista previa de la imagen adjunta 1',
    )) as HTMLImageElement
    expect(preview.getAttribute('src')).toContain('data:image/png;base64,')
    expect(screen.queryByText(/Imagen pendiente de subir/)).not.toBeInTheDocument()
  })

  it('"+ Audio" añade un bloque de audio a content y muestra el reproductor', async () => {
    const id = createEmptySlide()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/audio.mp3')

    const { container } = renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Audio' }))

    await waitFor(() => {
      expect(slideNode(id).content).toMatchObject([{ type: 'audio' }])
    })
    expect(pickImportAssetPath).toHaveBeenCalledWith('audio')

    await waitFor(() => {
      const audioEl = container.querySelector('audio')
      expect(audioEl).toBeTruthy()
      expect(audioEl?.getAttribute('src')).toContain('data:audio/mpeg;base64,')
    })
  })

  it('"+ Vídeo" añade un bloque de vídeo a content y muestra el reproductor', async () => {
    const id = createEmptySlide()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/clip.mp4')

    const { container } = renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Vídeo' }))

    await waitFor(() => {
      expect(slideNode(id).content).toMatchObject([{ type: 'video' }])
    })
    expect(pickImportAssetPath).toHaveBeenCalledWith('video')

    await waitFor(() => {
      const videoEl = container.querySelector('video')
      expect(videoEl).toBeTruthy()
      expect(videoEl?.getAttribute('src')).toContain('data:video/mp4;base64,')
    })
  })

  it('añadir un segundo bloque de imagen lo agrega al final (orden de aparición)', async () => {
    const id = createEmptySlide()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValueOnce('/tmp/foto.png').mockResolvedValueOnce('/tmp/foto2.png')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Imagen' }))
    await waitFor(() => expect(slideNode(id).content).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: '+ Imagen' }))
    await waitFor(() => expect(slideNode(id).content).toHaveLength(2))

    expect(await screen.findByAltText('Vista previa de la imagen adjunta 1')).toBeInTheDocument()
    expect(await screen.findByAltText('Vista previa de la imagen adjunta 2')).toBeInTheDocument()
  })

  it('"Quitar" en un bloque lo elimina de content sin pedir confirmación; los botones de añadir siguen disponibles', async () => {
    const id = createEmptySlide()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/foto.png')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Imagen' }))
    await waitFor(() => expect(slideNode(id).content).toHaveLength(1))

    // Un único clic ya quita el bloque: sin confirmación, a diferencia de
    // "Eliminar diapositiva".
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar bloque 1' }))

    expect(slideNode(id).content).toEqual([])
    expect(screen.getByRole('button', { name: '+ Texto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Imagen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Audio' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Vídeo' })).toBeInTheDocument()
  })

  it('"Quitar" en un bloque de vídeo lo elimina de content sin pedir confirmación', async () => {
    const id = createEmptySlide()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/clip.mp4')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Vídeo' }))
    await waitFor(() => expect(slideNode(id).content).toHaveLength(1))

    fireEvent.click(await screen.findByRole('button', { name: 'Quitar bloque 1' }))

    expect(slideNode(id).content).toEqual([])
  })

  it('los botones ↑/↓ reordenan los bloques; en los extremos quedan deshabilitados', async () => {
    const id = createEmptySlide()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValueOnce('/tmp/foto.png').mockResolvedValueOnce('/tmp/foto2.png')

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Imagen' }))
    await waitFor(() => expect(slideNode(id).content).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '+ Imagen' }))
    await waitFor(() => expect(slideNode(id).content).toHaveLength(2))

    const [firstId, secondId] = slideNode(id).content.map((b) => b.id)

    // El primer bloque no se puede subir más (ya está arriba); el segundo
    // no se puede bajar más (ya está abajo).
    expect(screen.getByRole('button', { name: 'Subir bloque 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bajar bloque 2' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Bajar bloque 1' }))
    expect(slideNode(id).content.map((b) => b.id)).toEqual([secondId, firstId])

    fireEvent.click(screen.getByRole('button', { name: 'Subir bloque 2' }))
    expect(slideNode(id).content.map((b) => b.id)).toEqual([firstId, secondId])
  })

  it('ya no queda ningún resto de UI para el antiguo "orden del contenido" (contentOrder)', () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(slideNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.queryByLabelText('Orden del contenido')).not.toBeInTheDocument()
    expect(screen.queryByText('Texto primero')).not.toBeInTheDocument()
    expect(screen.queryByText('Imagen primero')).not.toBeInTheDocument()
  })

  it('el editor de bloques está disponible también en una diapositiva con respuestas', async () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/audio.mp3')

    const { container } = renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Audio' }))

    await waitFor(() => {
      const audioEl = container.querySelector('audio')
      expect(audioEl).toBeTruthy()
    })
  })

  it('cancelar el diálogo de importar no cambia nada ni muestra error', async () => {
    const id = createEmptySlide()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    const assetRepository = setupAssetRepository()
    const pickImportAssetPath = vi.fn().mockResolvedValue(null)

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Imagen' }))

    await waitFor(() => expect(pickImportAssetPath).toHaveBeenCalled())

    expect(slideNode(id).content).toEqual([])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Imagen' })).toBeInTheDocument()
  })

  it('un fallo de importAsset muestra un mensaje de error breve sin romper el resto del Inspector', async () => {
    const id = createEmptySlide()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    const pickImportAssetPath = vi.fn().mockResolvedValue('/tmp/foto.png')
    const assetRepository = {
      importAsset: vi.fn().mockRejectedValue(new Error('boom')),
      getAsset: vi.fn(),
      gcOrphanAssets: vi.fn(),
    }

    renderInspectorWithServices({ assetRepository, pickImportAssetPath })

    fireEvent.click(screen.getByRole('button', { name: '+ Imagen' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/error|stack|undefined|NaN|\[object/i)
    // El resto del Inspector sigue funcionando (el título se puede seguir editando).
    expect(screen.getByLabelText('Ref. oculta')).toBeInTheDocument()
    expect(slideNode(id).content).toEqual([])
  })

  it('un fallo de getAsset al cargar la vista previa muestra un mensaje de error sin romper los controles', async () => {
    const id = createEmptySlide()
    act(() => {
      useProjectStore.getState().addImageBlock(id, 'asset-ya-adjunto')
      useProjectStore.getState().selectNode(id)
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
    expect(screen.getByRole('button', { name: 'Quitar bloque 1' })).toBeInTheDocument()
  })

  /** Mismo criterio que el test de "fallo de getAsset" de arriba: la vista
   *  previa (`AssetPreview`) no importa para estos controles, así que se usa
   *  un `assetRepository` que la hace fallar a propósito — simplifica el
   *  setup sin afectar lo que se está probando (`ImageBlockOptions`). */
  function renderSlideWithAttachedImage() {
    const id = createEmptySlide()
    act(() => {
      useProjectStore.getState().addImageBlock(id, 'asset-ya-adjunto')
      useProjectStore.getState().selectNode(id)
    })
    const assetRepository = {
      importAsset: vi.fn(),
      getAsset: vi.fn().mockRejectedValue(new Error('boom')),
      gcOrphanAssets: vi.fn(),
    }
    renderInspectorWithServices({ assetRepository })
    return id
  }

  it('petición de usuario ("botón... hacer no ampliable" + "desplegable... Tamaño"): un bloque de imagen YA adjunta muestra ambos controles, con "Normal" seleccionado por defecto', async () => {
    renderSlideWithAttachedImage()

    expect(await screen.findByRole('button', { name: 'Hacer no ampliable' })).toBeInTheDocument()
    const sizeSelect = screen.getByLabelText('Tamaño') as HTMLSelectElement
    expect(sizeSelect.value).toBe('normal')
  })

  it('un bloque de imagen pendiente de subir (sin assetId) no muestra estos controles', () => {
    const id = createEmptySlide()
    act(() => {
      useProjectStore.getState().addImageBlock(id) // sin assetId: "pendiente de subir"
      useProjectStore.getState().selectNode(id)
    })
    renderInspectorWithServices({})

    expect(screen.queryByRole('button', { name: /ampliable/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tamaño')).not.toBeInTheDocument()
  })

  it('pulsar el botón alterna "Hacer no ampliable"/"Hacer ampliable" y fija `expandable` en el bloque (`null` = vuelve a ampliable por defecto)', async () => {
    const id = renderSlideWithAttachedImage()
    const blockId = firstBlockId(id)

    fireEvent.click(await screen.findByRole('button', { name: 'Hacer no ampliable' }))
    expect(slideNode(id).content[0]).toMatchObject({ id: blockId, expandable: false })

    fireEvent.click(screen.getByRole('button', { name: 'Hacer ampliable' }))
    const restored = slideNode(id).content[0]
    expect(restored?.type === 'image' ? restored.expandable : 'missing').toBeUndefined()
  })

  it('el desplegable de tamaño fija `size` en el bloque; "Normal" lo borra (`null`, vuelve al valor por defecto)', async () => {
    const id = renderSlideWithAttachedImage()

    const sizeSelect = await screen.findByLabelText('Tamaño')
    fireEvent.change(sizeSelect, { target: { value: 'large' } })
    expect(slideNode(id).content[0]).toMatchObject({ size: 'large' })

    fireEvent.change(sizeSelect, { target: { value: 'normal' } })
    const restored = slideNode(id).content[0]
    expect(restored?.type === 'image' ? restored.size : 'missing').toBeUndefined()
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
    // El adjunto de imagen de una respuesta es independiente de los bloques
    // de contenido de la diapositiva (`SlideNode.content`): no crea ningún
    // bloque de imagen.
    expect(node.content.some((block) => block.type === 'image')).toBe(false)

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

describe('Inspector — editor de texto enriquecido de un bloque de texto (fase 4 Milestone 2; generalizado en el milestone "Bloques de contenido")', () => {
  it(
    'compatibilidad hacia atrás: un bloque de texto con body en texto plano histórico (Milestone 1) se ' +
      'muestra como párrafo normal, no como JSON en crudo',
    async () => {
      act(() => {
        // Simula un proyecto creado antes de esta fase: el body del bloque
        // de texto es literalmente el texto del usuario, nunca un documento
        // Tiptap serializado.
        useProjectStore
          .getState()
          .updateTextBlockBody(startNodeId(), firstBlockId(startNodeId()), 'Texto plano histórico')
        useProjectStore.getState().selectNode(startNodeId())
      })

      render(<Inspector filePath={TEST_FILE_PATH} />)

      const contentField = await screen.findByLabelText('Texto 1')
      await waitFor(() => {
        expect(contentField).toHaveTextContent('Texto plano histórico')
      })
      // Nunca se muestra el JSON en crudo ni llaves de objeto.
      expect(contentField.textContent).not.toMatch(/[{}]/)
    },
  )

  it('escribir en el editor enriquecido y perder el foco confirma exactamente una vez en el store', async () => {
    act(() => {
      useProjectStore.getState().updateTextBlockBody(startNodeId(), firstBlockId(startNodeId()), 'Hola')
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
    const block = slideNode(startNodeId()).content.find((b) => b.id === firstBlockId(startNodeId()))
    const bodyDoc = JSON.parse(block?.type === 'text' ? block.body : '{}')
    expect(bodyDoc.content[0].type).toBe('bulletList')

    // Un segundo blur sin más cambios no debe generar otra entrada.
    await blurByMovingFocusAway()
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
  })

  it('cambiar de nodo seleccionado sin hacer blur en el editor enriquecido confirma la edición pendiente', async () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().updateTextBlockBody(startNodeId(), firstBlockId(startNodeId()), 'Hola')
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
    // `ContentBlockRow` monta `RichTextEditor` con `key={block.id}` y
    // `NodeFields` monta con `key={node.id}`, así que al cambiar de nodo
    // seleccionado se desmonta sin blur previo.
    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().selectNode(slideNodeId())
    })

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const startBlock = slideNode(startId).content.find((b) => b.id === firstBlockId(startId))
    const bodyDoc = JSON.parse(startBlock?.type === 'text' ? startBlock.body : '{}')
    expect(bodyDoc.content[0].type).toBe('bulletList')
  })

  it('con varios bloques de texto a la vez, editar uno concreto solo modifica ese bloque', async () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    const nodeId = startNodeId()
    const firstId = firstBlockId(nodeId)
    act(() => {
      useProjectStore.getState().addTextBlock(nodeId)
    })
    const secondId = slideNode(nodeId).content[1]?.id
    if (!secondId) throw new Error('setup inválido')

    render(<Inspector filePath={TEST_FILE_PATH} />)

    // Dos bloques de texto, cada uno con su propio editor y su propia barra
    // de herramientas — se distinguen por etiqueta ("Texto 1"/"Texto 2").
    expect(screen.getByLabelText('Texto 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Texto 2')).toBeInTheDocument()

    const editors = document.querySelectorAll('[contenteditable="true"]')
    expect(editors).toHaveLength(2)
    const secondEditable = editors[1] as HTMLElement
    secondEditable.focus()
    await waitOneFrame()

    // Hay una barra "Lista con viñetas" por bloque de texto: se actúa sobre
    // la SEGUNDA (la que corresponde al editor que tiene el foco).
    const bulletButtons = screen.getAllByRole('button', { name: 'Lista con viñetas' })
    expect(bulletButtons).toHaveLength(2)
    const secondBulletButton = bulletButtons[1]!
    fireEvent.mouseDown(secondBulletButton)
    fireEvent.click(secondBulletButton)

    await waitFor(() => {
      expect(secondBulletButton).toHaveAttribute('aria-pressed', 'true')
    })

    await blurByMovingFocusAway()

    const updatedNode = slideNode(nodeId)
    const updatedFirst = updatedNode.content.find((b) => b.id === firstId)
    const updatedSecond = updatedNode.content.find((b) => b.id === secondId)
    // El primer bloque no se ha tocado.
    expect(updatedFirst?.type === 'text' ? updatedFirst.body : undefined).toBe('')
    // El segundo bloque, y solo él, recibió el cambio.
    const secondBody = updatedSecond?.type === 'text' ? updatedSecond.body : undefined
    expect(JSON.parse(secondBody ?? '{}').content[0].type).toBe('bulletList')
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

    // Petición de usuario "el Final como el Inicio": `nodeOptionLabel` ya no
    // añade "— <título>" para un `final` (ya no lo edita nadie desde el
    // Inspector) — se identifican aquí por "Final <número>", no por el
    // título ("Final A"/"Final B") con el que se crearon.
    const outgoing = screen.getByText('A dónde lleva esta diapositiva').closest('div') as HTMLElement
    expect(within(outgoing).getByText(`Final ${finalA.number}`)).toBeInTheDocument()
    expect(within(outgoing).getByText(`Final ${finalB.number}`)).toBeInTheDocument()
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

  it('muestra "Sin ref. oculta" para una diapositiva conectada sin título', () => {
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
    expect(within(outgoing).getByText(/Sin ref. oculta/)).toBeInTheDocument()
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

    expect(screen.getByText('Condición de aparición')).toBeInTheDocument()
    // Al menos una: el mismo aviso también lo pinta, por su cuenta, la
    // sección de "Efecto al visitar esta diapositiva" (milestone "+1 fallo
    // con Game Over") más abajo en la misma tarjeta — ambas secciones
    // necesitan variables y ninguna hay en este test.
    expect(
      screen.getAllByText(/Todavía no hay variables en el proyecto/).length,
    ).toBeGreaterThanOrEqual(1)
    expect(
      screen.queryByRole('button', { name: '+ Activar condición de aparición' }),
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

    fireEvent.click(screen.getByRole('button', { name: '+ Activar condición de aparición' }))

    expect(slideNode(startNodeId()).condition).toEqual({
      variableId: expect.any(String),
      operator: '==',
      value: 0,
    })
    expect(screen.getByLabelText('Destino "si no"')).toBeInTheDocument()

    const elseSelect = screen.getByLabelText('Destino "si no"') as HTMLSelectElement
    fireEvent.change(elseSelect, { target: { value: finalId } })
    expect(slideNode(startNodeId()).elseTargetNodeId).toBe(finalId)

    fireEvent.click(screen.getByRole('button', { name: 'Desactivar condición de aparición' }))

    const node = slideNode(startNodeId())
    expect(node.condition).toBeUndefined()
    expect(node.elseTargetNodeId).toBeUndefined()
    // Vuelve al estado "sin activar".
    expect(screen.getByRole('button', { name: '+ Activar condición de aparición' })).toBeInTheDocument()
  })

  it('sin "Destino si no" configurado muestra el aviso; configurarlo lo hace desaparecer (Tarea 1: causa real del reporte de bug)', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 0 })
      useProjectStore.getState().createNode('final', { x: 100, y: 0 }, { title: 'Final si no' })
      useProjectStore.getState().selectNode(startNodeId())
    })
    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')

    render(<Inspector filePath={TEST_FILE_PATH} />)

    // Antes de activar la condición, el aviso no debe aparecer (todavía no
    // hay ninguna rama "si no" que pueda quedar sin configurar).
    expect(screen.queryByText(/Sin destino "si no" configurado/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ Activar condición de aparición' }))

    // Justo tras activar, elseTargetNodeId todavía no está configurado: el
    // aviso debe aparecer.
    expect(screen.getByText(/Sin destino "si no" configurado/)).toBeInTheDocument()

    const elseSelect = screen.getByLabelText('Destino "si no"') as HTMLSelectElement
    fireEvent.change(elseSelect, { target: { value: finalId } })

    // Configurado el destino "si no", el aviso desaparece.
    expect(screen.queryByText(/Sin destino "si no" configurado/)).not.toBeInTheDocument()

    // Y si se vuelve a quitar (selecciona "— Sin destino —"), reaparece.
    fireEvent.change(elseSelect, { target: { value: '__none__' } })
    expect(screen.getByText(/Sin destino "si no" configurado/)).toBeInTheDocument()
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

    expect(screen.queryByText('Condición de aparición')).not.toBeInTheDocument()
  })
})

describe('Inspector — "Actúa como botón Salir" en una respuesta (milestone "+1 fallo con Game Over")', () => {
  it('marcarla borra el destino ya elegido y deshabilita el desplegable de destino', () => {
    act(() => {
      useProjectStore.getState().createNode('final', { x: 100, y: 0 }, { title: 'Fin' })
    })
    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')
    const decisionId = createSlideWithTwoResponses()
    const responseAId = slideNode(decisionId).responses.find((r) => r.letter === 'A')?.id
    if (!responseAId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().connect(decisionId, finalId, responseAId)
      useProjectStore.getState().selectNode(decisionId)
    })
    expect(
      slideNode(decisionId).responses.find((r) => r.id === responseAId)?.targetNodeId,
    ).toBe(finalId)

    render(<Inspector filePath={TEST_FILE_PATH} />)

    // [0]: hay una casilla por respuesta (A y B); esta prueba actúa sobre A.
    fireEvent.click(
      screen.getAllByRole('checkbox', {
        name: 'Actúa como botón Salir (no navega a ningún nodo)',
      })[0]!,
    )

    const responseA = slideNode(decisionId).responses.find((r) => r.id === responseAId)
    expect(responseA?.actsAsExit).toBe(true)
    expect(responseA?.targetNodeId).toBeUndefined()
    expect(screen.getByLabelText('Destino de la respuesta 1')).toBeDisabled()
  })

  it('desmarcarla vuelve a habilitar el desplegable de destino', () => {
    const decisionId = createSlideWithTwoResponses()
    const responseAId = slideNode(decisionId).responses.find((r) => r.letter === 'A')?.id
    if (!responseAId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().updateResponse(decisionId, responseAId, { actsAsExit: true })
      useProjectStore.getState().selectNode(decisionId)
    })

    render(<Inspector filePath={TEST_FILE_PATH} />)

    // [0]: hay una casilla por respuesta (A y B); esta prueba actúa sobre A.
    const checkbox = screen.getAllByRole('checkbox', {
      name: 'Actúa como botón Salir (no navega a ningún nodo)',
    })[0]!
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)

    // `updateResponse` normaliza `actsAsExit: false` a `undefined` (ver
    // comentario de `UpdateResponsePatch.actsAsExit` en
    // `src/domain/responses.ts`) — igual de "desactivado" que no haberlo
    // fijado nunca.
    expect(
      slideNode(decisionId).responses.find((r) => r.id === responseAId)?.actsAsExit,
    ).toBeFalsy()
    expect(screen.getByLabelText('Destino de la respuesta 1')).not.toBeDisabled()
  })
})

describe('Inspector — efecto al visitar una diapositiva (milestone "+1 fallo con Game Over")', () => {
  it('sin variables en el proyecto, muestra un aviso en vez del editor de efectos', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    // Sin variables, la sección se reduce al aviso (sin la etiqueta "Efecto
    // al visitar esta diapositiva", que solo aparece con el editor real).
    expect(
      screen.getAllByText(/Todavía no hay variables en el proyecto/).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('button', { name: '+ Añadir efecto' })).not.toBeInTheDocument()
  })

  it('"+ Añadir efecto" añade un efecto "set" con la primera variable y valor por defecto; editar su valor lo actualiza en `node.visitEffects`', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Fallos', type: 'number', initialValue: 0 })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir efecto' }))

    expect(slideNode(startNodeId()).visitEffects).toEqual([
      { variableId: expect.any(String), operation: 'set', value: 0 },
    ])

    const valueField = screen.getByLabelText('Valor del efecto 1')
    fireEvent.change(valueField, { target: { value: '1' } })
    fireEvent.blur(valueField)

    expect(slideNode(startNodeId()).visitEffects?.[0]?.value).toBe(1)
  })

  it('quitar el único efecto deja `visitEffects` sin definir', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Fallos', type: 'number', initialValue: 0 })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir efecto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Quitar efecto 1' }))

    expect(slideNode(startNodeId()).visitEffects).toBeUndefined()
  })
})

describe('Inspector — variante alternativa de un Final (milestone "+1 fallo con Game Over")', () => {
  it('sin variables en el proyecto, muestra un aviso en vez del botón "+ Añadir variante alternativa"', () => {
    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    })
    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().selectNode(finalId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    // Sin variables, la sección se reduce al aviso (sin la etiqueta
    // "Variante alternativa", que solo aparece con el editor real).
    expect(screen.getByText(/Todavía no hay variables en el proyecto/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '+ Añadir variante alternativa' }),
    ).not.toBeInTheDocument()
    // Petición de usuario ("Final Perfecto... con confeti"): la casilla de
    // confeti SÍ sigue disponible aunque no haya variables — celebra
    // cualquier contenido de este Final, no depende de tener una variante
    // alternativa.
    expect(
      screen.getByRole('checkbox', { name: /Mostrar confeti al llegar a este Final/ }),
    ).toBeInTheDocument()
  })

  it('petición de usuario ("el confeti lo quiero... en los dos"): la casilla de confeti fija/limpia `celebrate`', () => {
    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    })
    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().selectNode(finalId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const checkbox = screen.getByRole('checkbox', {
      name: /Mostrar confeti al llegar a este Final/,
    })
    expect(checkbox).not.toBeChecked()

    fireEvent.click(checkbox)
    expect(
      useProjectStore
        .getState()
        .project.graph.nodes.find((n) => n.id === finalId && n.type === 'final'),
    ).toMatchObject({ celebrate: true })
    expect(checkbox).toBeChecked()

    fireEvent.click(checkbox)
    expect(
      useProjectStore
        .getState()
        .project.graph.nodes.find((n) => n.id === finalId && n.type === 'final'),
    ).toMatchObject({ celebrate: false })
  })

  it('"+ Añadir variante alternativa" fija una condición por defecto y muestra el editor de contenido alternativo', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Fallos', type: 'number', initialValue: 0 })
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    })
    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().selectNode(finalId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir variante alternativa' }))

    const nodeAfter = useProjectStore.getState().project.graph.nodes.find((n) => n.id === finalId)
    expect(nodeAfter?.type === 'final' ? nodeAfter.alternateCondition : undefined).toEqual({
      variableId: expect.any(String),
      operator: '==',
      value: 0,
    })
    expect(screen.getByText('Contenido alternativo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quitar variante alternativa' })).toBeInTheDocument()
  })

  it('quitar la variante limpia tanto la condición como el contenido alternativo', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Fallos', type: 'number', initialValue: 0 })
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    })
    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')
    const variableId = useProjectStore.getState().project.variables[0]?.id
    if (!variableId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().updateNode(finalId, {
        alternateCondition: { variableId, operator: '>', value: 0 },
        alternateBody: 'Con fallos',
      })
      useProjectStore.getState().selectNode(finalId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByRole('button', { name: 'Quitar variante alternativa' }))

    const nodeAfter = useProjectStore.getState().project.graph.nodes.find((n) => n.id === finalId)
    expect(nodeAfter?.type === 'final' ? nodeAfter.alternateCondition : undefined).toBeUndefined()
    expect(nodeAfter?.type === 'final' ? nodeAfter.alternateBody : undefined).toBeUndefined()
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

describe('Inspector — botón "Duplicar" (Tarea 1, "Duplicar diapositivas")', () => {
  it('duplica una diapositiva sin pedir confirmación y selecciona la copia', () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Diapositiva 2' })
    })
    const slideId = slideNodeId()
    act(() => {
      useProjectStore.getState().selectNode(slideId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)
    const nodesBefore = useProjectStore.getState().project.graph.nodes.length

    fireEvent.click(screen.getByRole('button', { name: 'Duplicar diapositiva' }))

    // Sin confirmación: un único clic ya duplica, a diferencia de "Eliminar".
    expect(useProjectStore.getState().project.graph.nodes.length).toBe(nodesBefore + 1)
    const selected = useProjectStore.getState().selection.selectedNodeIds
    expect(selected).toHaveLength(1)
    expect(selected[0]).not.toBe(slideId)
  })

  it('duplica un nodo Final', () => {
    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
      const finalId = useProjectStore
        .getState()
        .project.graph.nodes.find((n) => n.type === 'final')?.id
      if (!finalId) throw new Error('setup inválido')
      useProjectStore.getState().selectNode(finalId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)
    const nodesBefore = useProjectStore.getState().project.graph.nodes.length

    fireEvent.click(screen.getByRole('button', { name: 'Duplicar final' }))

    expect(useProjectStore.getState().project.graph.nodes.length).toBe(nodesBefore + 1)
  })

  it('el botón "Duplicar" SÍ aparece para la diapositiva de inicio (a diferencia de "Eliminar")', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByRole('button', { name: 'Duplicar diapositiva' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Eliminar /i })).not.toBeInTheDocument()
  })
})

describe('Inspector — etiqueta "Ref. oculta" (renombrado de UI del campo `title`)', () => {
  it('el campo de título se muestra con la etiqueta "Ref. oculta", no "Título"', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByText('Ref. oculta')).toBeInTheDocument()
    expect(screen.queryByText('Título')).not.toBeInTheDocument()
  })

  it('un nodo `slide` sin título se etiqueta "Sin ref. oculta" en el selector de destino', () => {
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    // La diapositiva recién creada, sin título, aparece como destino posible
    // de "Continuar" con la etiqueta "Sin ref. oculta" (ver `nodeOptionLabel`)
    // — al menos una: la propia diapositiva de inicio (también sin título)
    // es OTRO destino posible en la misma lista.
    expect(screen.getAllByText(/Diapositiva \d+ — Sin ref. oculta/).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/Sin título/)).not.toBeInTheDocument()
  })

  it('petición de usuario "el Final como el Inicio": un `final` (que ya no tiene título editable) aparece en el selector de destino SOLO como "Final <número>", sin "— Sin ref. oculta"', () => {
    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByText(/^Final \d+$/)).toBeInTheDocument()
    expect(screen.queryByText(/Final \d+ — /)).not.toBeInTheDocument()
  })
})

// El desplegable "Variante" (general/bueno/malo) de un Final se retiró del
// Inspector en el milestone "+1 fallo con Game Over" (petición de usuario:
// "no quiero el desplegable con final general, final bueno...") — quedó
// redundante frente a `FinalAlternateSection` (variante alternativa
// decidida por la variable "Fallos"). El campo `variant` sigue existiendo
// en el dominio (compatibilidad, ver comentario en `Inspector.tsx` donde
// vivía la sección), pero ya no tiene ningún control de UI que probar aquí.

describe('Inspector — diapositiva de Inicio (nodo `intro`, milestone "Diapositiva de Inicio", Tarea 2)', () => {
  /** Crea el nodo `intro` (el proyecto de test, vía `createProject` de bajo
   *  nivel, todavía no tiene uno por defecto), lo selecciona y devuelve su id. */
  function createAndSelectIntro(): string {
    act(() => {
      useProjectStore.getState().createNode('intro', { x: 0, y: 0 })
    })
    const intro = useProjectStore
      .getState()
      .project.graph.nodes.find((node) => node.type === 'intro')
    if (!intro) throw new Error('setup inválido: no se creó el nodo intro')
    act(() => {
      useProjectStore.getState().selectNode(intro.id)
    })
    return intro.id
  }

  it('muestra los selectores de Ciclo/Asignatura, el nombre del caso y el destino', () => {
    createAndSelectIntro()
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Ciclo')).toBeInTheDocument()
    expect(screen.getByLabelText('Asignatura')).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre del caso práctico interactivo')).toBeInTheDocument()
    expect(screen.getByLabelText('Destino tras la portada')).toBeInTheDocument()
  })

  it('milestone "Inicio siempre es D1": NO muestra el campo "Ref. oculta" para un `intro`', () => {
    createAndSelectIntro()
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.queryByLabelText('Ref. oculta')).not.toBeInTheDocument()
    expect(screen.queryByText('Ref. oculta')).not.toBeInTheDocument()
  })

  it('"Ref. oculta" sigue mostrándose para `slide`; petición de usuario "el Final como el Inicio": ya NO se muestra para `final` (mismo criterio que `intro`)', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    const { unmount } = render(<Inspector filePath={TEST_FILE_PATH} />)
    expect(screen.getByLabelText('Ref. oculta')).toBeInTheDocument()
    unmount()

    act(() => {
      useProjectStore.getState().createNode('final', { x: 100, y: 0 })
    })
    const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().selectNode(finalId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)
    expect(screen.queryByLabelText('Ref. oculta')).not.toBeInTheDocument()
    expect(screen.queryByText('Ref. oculta')).not.toBeInTheDocument()
  })

  it('la Asignatura está deshabilitada, con aviso, mientras no se elija un Ciclo', () => {
    createAndSelectIntro()
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const asignaturaSelect = screen.getByLabelText('Asignatura')
    expect(asignaturaSelect).toBeDisabled()
    expect(screen.getByText('Elige primero un ciclo.')).toBeInTheDocument()
  })

  it('elegir un Ciclo habilita la Asignatura con las opciones de ese ciclo', () => {
    const introId = createAndSelectIntro()
    const ciclo = CICLOS[0]
    if (!ciclo) throw new Error('El catálogo de ciclos está vacío')
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.change(screen.getByLabelText('Ciclo'), { target: { value: ciclo.id } })

    expect(useProjectStore.getState().project.graph.nodes.find((n) => n.id === introId)).toMatchObject({
      cicloId: ciclo.id,
    })
    const asignaturaSelect = screen.getByLabelText('Asignatura')
    expect(asignaturaSelect).not.toBeDisabled()
    const firstAsignatura = ciclo.asignaturas[0]
    if (!firstAsignatura) throw new Error('El ciclo de prueba no tiene asignaturas')
    // Espacio de trabajo: la opción muestra el nombre + su código de módulo
    // entre paréntesis (`asignaturaWorkspaceName`), no el nombre a secas.
    expect(
      within(asignaturaSelect as HTMLElement).getByText(asignaturaWorkspaceName(firstAsignatura)),
    ).toBeInTheDocument()
  })

  it('cambiar de Ciclo limpia la Asignatura elegida si ya no pertenece al ciclo nuevo (misma llamada a updateNode)', () => {
    const introId = createAndSelectIntro()
    const cicloA = CICLOS[0]
    const cicloB = CICLOS[1]
    if (!cicloA || !cicloB) throw new Error('El catálogo necesita al menos dos ciclos para este test')
    const asignaturaA = cicloA.asignaturas[0]
    if (!asignaturaA) throw new Error('El ciclo A de prueba no tiene asignaturas')
    // Confirma la premisa del test: la asignatura de A no pertenece a B.
    expect(cicloB.asignaturas.some((a) => a.id === asignaturaA.id)).toBe(false)

    act(() => {
      useProjectStore.getState().updateNode(introId, { cicloId: cicloA.id, asignaturaId: asignaturaA.id })
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const historyBefore = useProjectStore.getState().history.past.length
    fireEvent.change(screen.getByLabelText('Ciclo'), { target: { value: cicloB.id } })

    const updated = useProjectStore.getState().project.graph.nodes.find((n) => n.id === introId)
    expect(updated).toMatchObject({ cicloId: cicloB.id, asignaturaId: undefined })
    // Una única entrada de historial: ciclo nuevo + limpieza de asignatura
    // van en la MISMA llamada a `updateNode`, no en dos.
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
  })

  it('cambiar de Ciclo conserva la Asignatura si sigue perteneciendo al ciclo nuevo', () => {
    // Busca un ciclo con una asignatura cuyo id/nombre coincide en algún otro
    // ciclo sería casuística; en su lugar, el caso "conserva" más simple y
    // determinista es no cambiar de ciclo en absoluto y comprobar que la
    // asignatura sigue intacta tras volver a elegir el MISMO ciclo.
    const introId = createAndSelectIntro()
    const ciclo = CICLOS[0]
    if (!ciclo) throw new Error('El catálogo de ciclos está vacío')
    const asignatura = ciclo.asignaturas[0]
    if (!asignatura) throw new Error('El ciclo de prueba no tiene asignaturas')

    act(() => {
      useProjectStore.getState().updateNode(introId, { cicloId: ciclo.id, asignaturaId: asignatura.id })
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.change(screen.getByLabelText('Ciclo'), { target: { value: ciclo.id } })

    const updated = useProjectStore.getState().project.graph.nodes.find((n) => n.id === introId)
    expect(updated).toMatchObject({ cicloId: ciclo.id, asignaturaId: asignatura.id })
  })

  it('guarda el nombre del caso práctico interactivo (commit on blur)', () => {
    const introId = createAndSelectIntro()
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const input = screen.getByLabelText('Nombre del caso práctico interactivo')
    fireEvent.change(input, { target: { value: 'Simulación de urgencias' } })
    fireEvent.blur(input)

    expect(useProjectStore.getState().project.graph.nodes.find((n) => n.id === introId)).toMatchObject({
      caseName: 'Simulación de urgencias',
    })
  })

  it('el selector de "Destino tras la portada" conecta/desconecta igual que "Destino de continuar" de una diapositiva', () => {
    const introId = createAndSelectIntro()
    let targetId = ''
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 100, y: 0 }, { title: 'Primera diapositiva' })
      const nodes = useProjectStore.getState().project.graph.nodes
      const created = nodes.reduce((max, node) => (node.number > max.number ? node : max))
      targetId = created.id
      useProjectStore.getState().selectNode(introId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const targetSelect = screen.getByLabelText('Destino tras la portada')
    fireEvent.change(targetSelect, { target: { value: targetId } })
    expect(useProjectStore.getState().project.graph.nodes.find((n) => n.id === introId)).toMatchObject({
      targetNodeId: targetId,
    })

    fireEvent.change(targetSelect, { target: { value: '__none__' } })
    expect(useProjectStore.getState().project.graph.nodes.find((n) => n.id === introId)).toMatchObject({
      targetNodeId: undefined,
    })
  })

  it('no muestra los botones "Eliminar"/"Duplicar" para un nodo `intro`', () => {
    createAndSelectIntro()
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.queryByText(/^Eliminar/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Duplicar/)).not.toBeInTheDocument()
  })
})

describe('Inspector — color de una diapositiva (paleta cerrada)', () => {
  it('una diapositiva `slide` muestra la sección "Color" con las pastillas de la paleta más "Sin color"', () => {
    const id = startNodeId()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByText('Color')).toBeInTheDocument()
    expect(screen.getByLabelText('Sin color')).toBeInTheDocument()
    expect(screen.getByLabelText('Amarillo')).toBeInTheDocument()
    expect(screen.getByLabelText('Naranja')).toBeInTheDocument()
    expect(screen.getByLabelText('Rosa')).toBeInTheDocument()
    expect(screen.getByLabelText('Morado')).toBeInTheDocument()
    expect(screen.getByLabelText('Cian')).toBeInTheDocument()
    expect(screen.getByLabelText('Gris')).toBeInTheDocument()
    expect(screen.getByLabelText('Rojo')).toBeInTheDocument()
  })

  it('hacer clic en una pastilla llama a updateNode con ese color; "Sin color" llama con null', () => {
    const id = startNodeId()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    fireEvent.click(screen.getByLabelText('Morado'))
    expect(slideNode(id).color).toBe('purple')
    expect(screen.getByLabelText('Morado')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Sin color')).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByLabelText('Cian'))
    expect(slideNode(id).color).toBe('cyan')
    expect(screen.getByLabelText('Cian')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Morado')).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByLabelText('Sin color'))
    expect(slideNode(id).color).toBeUndefined()
    expect(screen.getByLabelText('Sin color')).toHaveAttribute('aria-pressed', 'true')
  })

  it('sin color fijado, "Sin color" empieza marcada como seleccionada', () => {
    const id = startNodeId()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Sin color')).toHaveAttribute('aria-pressed', 'true')
  })

  it('no aparece la sección "Color" para un nodo Final', () => {
    act(() => {
      useProjectStore.getState().createNode('final', { x: 100, y: 0 })
    })
    const finalId = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido: no se creó el nodo final')
    act(() => {
      useProjectStore.getState().selectNode(finalId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.queryByText('Color')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sin color')).not.toBeInTheDocument()
  })

  it('no aparece la sección "Color" para el nodo `intro`', () => {
    act(() => {
      useProjectStore.getState().createNode('intro', { x: 0, y: 0 })
    })
    const introId = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.type === 'intro')?.id
    if (!introId) throw new Error('setup inválido: no se creó el nodo intro')
    act(() => {
      useProjectStore.getState().selectNode(introId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.queryByText('Color')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sin color')).not.toBeInTheDocument()
  })
})

describe('Inspector — reorganización del Inspector (Tarea 4): Color arriba del todo, agrupado con Ref. oculta/Contenido/Nota interna', () => {
  it('para una diapositiva `slide`, "Color" aparece ANTES que "Ref. oculta" en el DOM', () => {
    const id = startNodeId()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    const { container } = render(<Inspector filePath={TEST_FILE_PATH} />)

    const colorLabel = screen.getByText('Color')
    const referenceLabel = screen.getByText('Ref. oculta')
    // DOCUMENT_POSITION_FOLLOWING (4): colorLabel precede a referenceLabel.
    // eslint-disable-next-line no-bitwise
    expect(colorLabel.compareDocumentPosition(referenceLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container).toBeTruthy()
  })

  it('Color + Ref. oculta + Contenido + Nota interna comparten el mismo contenedor agrupado (.metaGroup)', () => {
    const id = startNodeId()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const metaGroup = screen.getByText('Color').closest(`.${CSS.escape(styles.metaGroup as string)}`)
    expect(metaGroup).not.toBeNull()
    expect(within(metaGroup as HTMLElement).getByText('Ref. oculta')).toBeInTheDocument()
    expect(within(metaGroup as HTMLElement).getByText('Contenido')).toBeInTheDocument()
    expect(within(metaGroup as HTMLElement).getByText(/Nota interna/)).toBeInTheDocument()
  })

  it('el resto de la sección (destino de continuar, conexiones) queda FUERA del bloque agrupado', () => {
    const id = startNodeId()
    act(() => {
      useProjectStore.getState().selectNode(id)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const metaGroup = screen.getByText('Color').closest(`.${CSS.escape(styles.metaGroup as string)}`)
    expect(metaGroup).not.toBeNull()
    expect(within(metaGroup as HTMLElement).queryByText('Destino de continuar')).not.toBeInTheDocument()
  })

  it('petición de usuario "el Final como el Inicio": `final`/`intro` ya no muestran "Ref. oculta" en absoluto (ni dentro ni fuera del contenedor agrupado)', () => {
    act(() => {
      useProjectStore.getState().createNode('final', { x: 100, y: 0 })
    })
    const finalId = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().selectNode(finalId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.queryByText('Ref. oculta')).not.toBeInTheDocument()
  })
})

/**
 * Campos "por rellenar" en blanco (petición de usuario): un campo de texto
 * libre vacío (`trim() === ''`) lleva la clase `.fieldEmpty` (fondo
 * `--bs-color-surface`, ver `Inspector.module.css`) EN VEZ de/además del
 * `--bs-color-bg` habitual, y la pierde en cuanto tiene contenido — en vivo,
 * sin esperar al blur (el campo se actualiza en cada `fireEvent.change`,
 * antes de cualquier `fireEvent.blur`). Cubre cada campo de texto libre
 * listado en el encargo; el editor de texto enriquecido (bloques de
 * contenido / cuerpo de un Final) tiene su propia cobertura equivalente en
 * `RichTextEditor.test.tsx` (`.editorWrapperEmpty`), reutilizado tal cual
 * aquí sin duplicar sus tests.
 */
describe('Inspector — campos "por rellenar" en blanco, no en gris (petición de usuario)', () => {
  it('Ref. oculta: vacío lleva fieldEmpty; escribir lo quita EN VIVO; borrarlo lo vuelve a poner', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const input = screen.getByLabelText('Ref. oculta')
    expect(input.className).toContain(styles.fieldEmpty)

    fireEvent.change(input, { target: { value: 'B' } })
    expect(input.className).not.toContain(styles.fieldEmpty)

    fireEvent.change(input, { target: { value: '' } })
    expect(input.className).toContain(styles.fieldEmpty)

    // Solo espacios en blanco cuenta como vacío (mismo criterio `trim()` que
    // usa el propio dominio al confirmar el campo).
    fireEvent.change(input, { target: { value: '   ' } })
    expect(input.className).toContain(styles.fieldEmpty)
  })

  it('Ref. oculta: con contenido ya guardado, NO lleva fieldEmpty al cargar el Inspector', () => {
    act(() => {
      useProjectStore.getState().updateNode(startNodeId(), { title: 'Bienvenida' })
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    expect(screen.getByLabelText('Ref. oculta').className).not.toContain(styles.fieldEmpty)
  })

  it('Texto del botón de continuar: vacío lleva fieldEmpty; escribir lo quita EN VIVO', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const input = screen.getByLabelText('Texto del botón de continuar')
    expect(input.className).toContain(styles.fieldEmpty)

    fireEvent.change(input, { target: { value: 'Siguiente' } })
    expect(input.className).not.toContain(styles.fieldEmpty)

    fireEvent.change(input, { target: { value: '' } })
    expect(input.className).toContain(styles.fieldEmpty)
  })

  it('Nombre del caso práctico interactivo (Inicio): vacío lleva fieldEmpty; escribir lo quita EN VIVO', () => {
    act(() => {
      useProjectStore.getState().createNode('intro', { x: 0, y: 0 })
    })
    const introId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'intro')?.id
    if (!introId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().selectNode(introId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const input = screen.getByLabelText('Nombre del caso práctico interactivo')
    expect(input.className).toContain(styles.fieldEmpty)

    fireEvent.change(input, { target: { value: 'Simulación de urgencias' } })
    expect(input.className).not.toContain(styles.fieldEmpty)

    fireEvent.change(input, { target: { value: '' } })
    expect(input.className).toContain(styles.fieldEmpty)
  })

  it('Texto de una respuesta: vacío lleva fieldEmpty; escribir lo quita EN VIVO', () => {
    const decisionId = createSlideWithTwoResponses()
    act(() => {
      useProjectStore.getState().selectNode(decisionId)
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const textarea = screen.getByLabelText('Texto de la respuesta 1')
    expect(textarea.className).toContain(styles.fieldEmpty)

    fireEvent.change(textarea, { target: { value: 'Opción correcta' } })
    expect(textarea.className).not.toContain(styles.fieldEmpty)

    fireEvent.change(textarea, { target: { value: '' } })
    expect(textarea.className).toContain(styles.fieldEmpty)
  })

  it('Nota interna: vacía lleva fieldEmpty; escribir lo quita EN VIVO; también aplica a un Final', () => {
    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })
    render(<Inspector filePath={TEST_FILE_PATH} />)

    const textarea = screen.getByLabelText('Nota interna (no se exporta)')
    expect(textarea.className).toContain(styles.fieldEmpty)

    fireEvent.change(textarea, { target: { value: 'Pedir gráfico a diseño' } })
    expect(textarea.className).not.toContain(styles.fieldEmpty)

    fireEvent.change(textarea, { target: { value: '' } })
    expect(textarea.className).toContain(styles.fieldEmpty)
  })

  it(
    'los <select> de elección cerrada (Ciclo, Asignatura, operador de condición) ' +
      'nunca llevan fieldEmpty, estén o no elegidos',
    () => {
      // Ciclo/Asignatura de la diapositiva de Inicio.
      act(() => {
        useProjectStore.getState().createNode('intro', { x: 0, y: 0 })
      })
      const introId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'intro')?.id
      if (!introId) throw new Error('setup inválido')
      act(() => {
        useProjectStore.getState().selectNode(introId)
      })
      const { unmount } = render(<Inspector filePath={TEST_FILE_PATH} />)

      const cicloSelect = screen.getByLabelText('Ciclo')
      const asignaturaSelect = screen.getByLabelText('Asignatura')
      expect(cicloSelect.className).not.toContain(styles.fieldEmpty)
      expect(asignaturaSelect.className).not.toContain(styles.fieldEmpty)
      const ciclo = CICLOS[0]
      if (!ciclo) throw new Error('El catálogo de ciclos está vacío')
      fireEvent.change(cicloSelect, { target: { value: ciclo.id } })
      expect(screen.getByLabelText('Asignatura').className).not.toContain(styles.fieldEmpty)
      unmount()

      // Operador de una condición de visibilidad de respuesta (necesita al
      // menos una variable en el proyecto para no mostrar el aviso "Todavía
      // no hay variables...").
      act(() => {
        useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 0 })
      })
      const decisionId = createSlideWithTwoResponses()
      const responseId = slideNode(decisionId).responses[0]?.id
      if (!responseId) throw new Error('setup inválido')
      act(() => {
        useProjectStore.getState().selectNode(decisionId)
      })
      render(<Inspector filePath={TEST_FILE_PATH} />)
      // Dos respuestas -> dos botones "+ Añadir condición" (uno por
      // respuesta): se acota a la fila de la respuesta 1.
      const responseRow = screen
        .getByLabelText('Texto de la respuesta 1')
        .closest(`.${CSS.escape(styles.responseRow as string)}`)
      if (!responseRow) throw new Error('setup inválido: no se encontró la fila de la respuesta 1')
      fireEvent.click(within(responseRow as HTMLElement).getByRole('button', { name: '+ Añadir condición' }))
      expect(within(responseRow as HTMLElement).getByLabelText('Operador').className).not.toContain(
        styles.fieldEmpty,
      )
    },
  )
})
