import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagnosticsPanel, scheduleIdleSpellCheck } from '../DiagnosticsPanel'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'
import { addResponse, updateNode } from '../../../domain'

/** Hallazgo de auditoría ("el corrector se dispara al abrir cualquier
 *  proyecto"): mismo mock de diccionario que `src/domain/__tests__/
 *  diagnostics.test.ts` (ver su comentario) — evita depender del mecanismo
 *  `?url`/`fetch` de Vite o cargar el diccionario español real en cada
 *  test. Solo se usa en el describe de más abajo que sí necesita un
 *  resultado real de `checkSpelling`; el resto de tests de este archivo no
 *  lo tocan (proyecto sin texto revisable, ver comentario original). */
const CORRECT_WORDS = new Set(['hola', 'mundo', 'ancla', 'continuar'])
vi.mock('../../../domain/spellingDictionary', () => ({
  loadSpanishSpellChecker: vi.fn(async () => ({
    correct: (word: string) => CORRECT_WORDS.has(word.toLowerCase()),
  })),
}))

/**
 * Desde que "Estructura del recorrido" (`validateProject`) se une al
 * recuento de avisos, el proyecto "de fábrica" (una única diapositiva de
 * inicio sin destino, sin ningún Final) ya dispararía por sí solo
 * `SLIDE_WITHOUT_TARGET`/`NO_REACHABLE_FINAL` — ruido que taparía el
 * recuento exacto ("1 aviso") que estos tests dan por hecho para aislar el
 * aviso concreto que sí seedan (una respuesta sin destino, más abajo en
 * cada test). Se conecta aquí un Final alcanzable a través de una
 * respuesta "ancla" YA conectada — deliberadamente NO por el
 * `targetNodeId` general de "continuar" (como el `seedReachableFinal` de
 * `src/store/testHelpers.ts`, pensado para un grafo que no se vuelve a
 * tocar): en cuanto cada test añade su propia respuesta a la diapositiva
 * de inicio (`addResponse`, convirtiéndola en "de decisión"), sus aristas
 * dejan de derivarse de `targetNodeId` — que queda dormido — y pasan a
 * derivarse SOLO de las respuestas (`deriveEdges`, `src/domain/graph.ts`);
 * conectar el Final por `targetNodeId` antes de eso lo habría dejado
 * inalcanzable en cuanto la respuesta bajo prueba se añadiera. La respuesta
 * ancla sí tiene destino Y texto, así que nunca genera ningún aviso propio
 * — ni "sin destino" ni "texto vacío" (`detectUnlinkedResponses`, `reason:
 * 'empty-text'`, hallazgo de auditoría sobre respuestas conectadas sin
 * texto).
 */
function seedAnchoredFinal(): void {
  const store = useProjectStore.getState()
  const startId = store.project.graph.startNodeId

  store.createNode('final', { x: 400, y: 0 })
  const finalId = useProjectStore
    .getState()
    .project.graph.nodes.find((node) => node.type === 'final')?.id
  if (!finalId) throw new Error('seedAnchoredFinal: no se creó ningún nodo "final"')

  store.addResponse(startId)
  const startNode = useProjectStore.getState().project.graph.nodes.find((node) => node.id === startId)
  const anchorResponseId = startNode?.type === 'slide' ? startNode.responses.at(-1)?.id : undefined
  if (!anchorResponseId) throw new Error('seedAnchoredFinal: no se creó ninguna respuesta ancla')
  store.updateResponse(startId, anchorResponseId, { text: 'Continuar (ancla)' })
  store.connect(startId, finalId, anchorResponseId)
}

beforeEach(() => {
  resetProjectStore()
  seedAnchoredFinal()
})

/**
 * Un proyecto recién creado (`resetProjectStore`) no tiene NINGÚN texto
 * revisable (título vacío, único bloque de texto vacío) -- el escaneo de
 * ortografía que `DiagnosticsPanel` dispara al montar resuelve a `[]` sin
 * llegar a cargar el diccionario real (ver `checkSpelling`, que corta en
 * cuanto no hay texto), así que estos tests no necesitan mockear
 * `../../domain`/`../../store/spellingDictionary` para nada.
 */

describe('DiagnosticsPanel', () => {
  it('no se muestra ninguna insignia cuando no hay avisos', async () => {
    render(<DiagnosticsPanel />)

    // Deja que se asiente el efecto de montaje (escaneo de ortografía,
    // async incluso sobre un proyecto sin texto).
    await act(async () => {})

    expect(screen.queryByRole('button', { name: /avisos del proyecto/ })).not.toBeInTheDocument()
  })

  it('muestra la insignia con el contador correcto cuando hay avisos', async () => {
    let project = useProjectStore.getState().project
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    useProjectStore.setState({ project })

    render(<DiagnosticsPanel />)
    await act(async () => {})

    const badge = screen.getByRole('button', { name: '1 avisos del proyecto' })
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('1')
  })

  it('clic en un aviso llama a focusNode con el id correcto y centra el lienzo', async () => {
    let project = useProjectStore.getState().project
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    useProjectStore.setState({ project })

    const focusNodeSpy = vi.spyOn(useProjectStore.getState(), 'focusNode')

    render(<DiagnosticsPanel />)
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: '1 avisos del proyecto' }))
    const issueRow = screen.getByText(/no tiene destino conectado/)
    fireEvent.click(issueRow)

    expect(focusNodeSpy).toHaveBeenCalledWith(startId)
    expect(useProjectStore.getState().ui.focusRequestNodeId).toBe(startId)
  })

  it('expande la lista agrupada por tipo al pulsar la insignia', async () => {
    let project = useProjectStore.getState().project
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    useProjectStore.setState({ project })

    render(<DiagnosticsPanel />)
    await act(async () => {})

    expect(screen.queryByText('Bucles')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '1 avisos del proyecto' }))

    expect(screen.getByText('Bucles')).toBeInTheDocument()
    expect(screen.getByText('Opciones sin vincular')).toBeInTheDocument()
    expect(screen.getByText('Estructura del recorrido')).toBeInTheDocument()
    expect(screen.getByText('Ortografía')).toBeInTheDocument()
  })
})

describe('DiagnosticsPanel — Estructura del recorrido (validateProject)', () => {
  it('un nodo inalcanzable aparece en el grupo, y pulsarlo centra el lienzo en él', async () => {
    // Conectado (a un Final) pero sin NINGUNA arista entrante desde el
    // inicio: así el ÚNICO aviso que dispara es `UNREACHABLE_NODE` — un
    // nodo huérfano recién creado (sin destino propio) dispararía ADEMÁS
    // `SLIDE_WITHOUT_TARGET`, que no es lo que este test quiere aislar.
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 300, y: 300 })
    })
    const orphanId = useProjectStore.getState().project.graph.nodes.at(-1)?.id
    if (!orphanId) throw new Error('setup inválido')
    const finalId = useProjectStore
      .getState()
      .project.graph.nodes.find((node) => node.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().connect(orphanId, finalId)
    })
    const focusNodeSpy = vi.spyOn(useProjectStore.getState(), 'focusNode')

    render(<DiagnosticsPanel />)
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: '1 avisos del proyecto' }))
    const issueRow = screen.getByText(/no es alcanzable desde el inicio/)
    fireEvent.click(issueRow)

    expect(focusNodeSpy).toHaveBeenCalledWith(orphanId)
  })

  it('petición de usuario ("quitar RESPONSE_WITHOUT_TARGET de aquí, ya se ve en Opciones sin vincular"): una respuesta sin destino NO aparece duplicada en Estructura del recorrido', async () => {
    let project = useProjectStore.getState().project
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    useProjectStore.setState({ project })

    render(<DiagnosticsPanel />)
    await act(async () => {})

    // Un único aviso activo en total (el de "Opciones sin vincular" — ver
    // el resto de este fichero), no dos.
    expect(screen.getByRole('button', { name: '1 avisos del proyecto' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '1 avisos del proyecto' }))
    expect(screen.getByText('Sin problemas de estructura')).toBeInTheDocument()
  })

  it('un aviso SIN nodo concreto (ningún Final alcanzable) se pinta como texto, no como botón, pero sigue pudiendo descartarse', async () => {
    // El proyecto "de fábrica" del `beforeEach` (`seedAnchoredFinal`) ya
    // tiene un Final alcanzable — se desconecta la respuesta ancla para
    // volver a dejar el recorrido sin ningún Final alcanzable.
    act(() => {
      const startId = useProjectStore.getState().project.graph.startNodeId
      const startNode = useProjectStore
        .getState()
        .project.graph.nodes.find((node) => node.id === startId)
      const responseId = startNode?.type === 'slide' ? startNode.responses[0]?.id : undefined
      if (!responseId) throw new Error('setup inválido')
      useProjectStore.getState().disconnect(startId, responseId)
    })

    render(<DiagnosticsPanel />)
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: /avisos del proyecto/ }))
    const issueText = screen.getByText('Ningún Final es alcanzable desde el inicio: el recorrido no puede terminar')
    // No es un botón: nada al que "ir" (es un problema del proyecto
    // entero, no de una diapositiva concreta) — ver `StructureIssueRow`.
    expect(issueText.tagName).toBe('P')

    // Pero SÍ puede descartarse, como cualquier otro aviso: es el único
    // `<button>` en su misma fila (`.issueRowWrapper`), ya que el propio
    // aviso es un `<p>`, no un botón.
    const dismissButton = issueText.parentElement?.querySelector('button')
    expect(dismissButton).not.toBeNull()
    fireEvent.click(dismissButton as HTMLButtonElement)
    expect(screen.queryByText(/Ningún Final es alcanzable/)).not.toBeInTheDocument()
  })
})

describe('DiagnosticsPanel — descartar avisos (tarea "Descartar avisos en el rincón de avisos")', () => {
  it('descartar un aviso lo oculta de la lista y reduce el contador de la insignia', async () => {
    let project = useProjectStore.getState().project
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    useProjectStore.setState({ project })

    render(<DiagnosticsPanel />)
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: '1 avisos del proyecto' }))
    expect(screen.getByText(/no tiene destino conectado/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Descartar aviso:/ }))

    // El aviso desaparece de la lista, y el panel entero desaparece (sin
    // avisos activos ni nada más que mostrar salvo el propio descarte, que sí
    // se mantiene contabilizado en el store aunque el badge ya no lo cuente
    // como "activo").
    expect(screen.queryByText(/no tiene destino conectado/)).not.toBeInTheDocument()
    expect(useProjectStore.getState().ui.dismissedDiagnosticIds).toHaveLength(1)
  })

  it('recalcular el proyecto con el MISMO problema no hace reaparecer un aviso descartado', async () => {
    let project = useProjectStore.getState().project
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    useProjectStore.setState({ project })

    render(<DiagnosticsPanel />)
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: '1 avisos del proyecto' }))
    fireEvent.click(screen.getByRole('button', { name: /^Descartar aviso:/ }))

    // Recalcular el proyecto (p.ej. tocar el título, dispara un nuevo
    // render/useMemo) sin resolver el problema real: la respuesta sigue sin
    // destino, mismo id de aviso — debe seguir descartado.
    act(() => {
      useProjectStore.getState().updateNode(startId, { title: 'Otro título' })
    })

    expect(screen.queryByText(/no tiene destino conectado/)).not.toBeInTheDocument()
  })

  it('"Recuperar" restaura los avisos descartados de esta sesión', async () => {
    let project = useProjectStore.getState().project
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    useProjectStore.setState({ project })

    render(<DiagnosticsPanel />)
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: '1 avisos del proyecto' }))
    fireEvent.click(screen.getByRole('button', { name: /^Descartar aviso:/ }))

    expect(screen.getByText(/aviso descartado/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Recuperar' }))

    expect(useProjectStore.getState().ui.dismissedDiagnosticIds).toEqual([])
    expect(screen.getByText(/no tiene destino conectado/)).toBeInTheDocument()
  })

  it('si se descarta el único aviso activo, el panel se mantiene visible para poder recuperarlo', async () => {
    let project = useProjectStore.getState().project
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    useProjectStore.setState({ project })

    render(<DiagnosticsPanel />)
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: '1 avisos del proyecto' }))
    fireEvent.click(screen.getByRole('button', { name: /^Descartar aviso:/ }))

    // El badge sigue existiendo (con contador en 0) y sigue siendo posible
    // reabrir la lista para pulsar "Recuperar".
    const badge = screen.getByRole('button', { name: /avisos del proyecto/ })
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('0')
    expect(screen.getByRole('button', { name: 'Recuperar' })).toBeInTheDocument()
  })
})

describe('scheduleIdleSpellCheck (hallazgo de auditoría: diferir el corrector a un momento ocioso del navegador)', () => {
  afterEach(() => {
    delete (window as { requestIdleCallback?: unknown }).requestIdleCallback
    delete (window as { cancelIdleCallback?: unknown }).cancelIdleCallback
  })

  it('con requestIdleCallback disponible, lo usa y NO llama al callback síncronamente — solo cuando el navegador llega a un momento ocioso', () => {
    const callback = vi.fn()
    let idleCallback: (() => void) | undefined
    const requestIdleCallback = vi.fn((cb: () => void) => {
      idleCallback = cb
      return 42
    })
    ;(window as unknown as { requestIdleCallback: typeof requestIdleCallback }).requestIdleCallback =
      requestIdleCallback
    ;(window as unknown as { cancelIdleCallback: (id: number) => void }).cancelIdleCallback = vi.fn()

    scheduleIdleSpellCheck(callback)

    expect(requestIdleCallback).toHaveBeenCalledTimes(1)
    expect(callback).not.toHaveBeenCalled()

    idleCallback?.()
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('la función de cancelación devuelta llama a cancelIdleCallback con el handle que devolvió requestIdleCallback', () => {
    const cancelIdleCallback = vi.fn()
    ;(window as unknown as { requestIdleCallback: () => number }).requestIdleCallback = vi.fn(() => 99)
    ;(window as unknown as { cancelIdleCallback: typeof cancelIdleCallback }).cancelIdleCallback =
      cancelIdleCallback

    const cancel = scheduleIdleSpellCheck(vi.fn())
    cancel()

    expect(cancelIdleCallback).toHaveBeenCalledWith(99)
  })

  it('sin requestIdleCallback (el caso real de este entorno de test, jsdom): usa un setTimeout de reserva, no llama síncronamente', async () => {
    vi.useFakeTimers()
    try {
      const callback = vi.fn()
      scheduleIdleSpellCheck(callback)
      expect(callback).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(callback).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('la cancelación de la reserva evita que el setTimeout llegue a llamar al callback', async () => {
    vi.useFakeTimers()
    try {
      const callback = vi.fn()
      const cancel = scheduleIdleSpellCheck(callback)
      cancel()

      await vi.advanceTimersByTimeAsync(10)
      expect(callback).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('DiagnosticsPanel — el corrector diferido llega a completarse (hallazgo de auditoría)', () => {
  it('tras esperar lo suficiente, una errata real aparece en el grupo "Ortografía" al abrir el panel', async () => {
    let project = useProjectStore.getState().project
    project = updateNode(project, project.graph.startNodeId, { title: 'Hola Titulboo' })
    useProjectStore.setState({ project })

    render(<DiagnosticsPanel />)

    const badge = await waitFor(() => screen.getByRole('button', { name: /avisos del proyecto/ }))
    fireEvent.click(badge)

    await waitFor(() => {
      expect(screen.getByText(/Titulboo/)).toBeInTheDocument()
    })
  })
})
