import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagnosticsPanel } from '../DiagnosticsPanel'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'
import { addResponse } from '../../../domain'

beforeEach(() => {
  resetProjectStore()
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
    expect(screen.getByText('Ortografía')).toBeInTheDocument()
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
