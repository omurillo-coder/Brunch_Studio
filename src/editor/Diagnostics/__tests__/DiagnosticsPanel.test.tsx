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
