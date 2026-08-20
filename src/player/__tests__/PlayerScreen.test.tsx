import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { PlayerScreen } from '../PlayerScreen'
import { useProjectStore } from '../../store'
import { resetProjectStore } from '../../store/testHelpers'
import { createProject } from '../../domain'
import type { ProjectDocument } from '../../domain'

function nodeIdOf(project: ProjectDocument, type: 'start' | 'content' | 'decision' | 'final'): string {
  const ids = project.graph.nodes.filter((node) => node.type === type).map((node) => node.id)
  const id = ids[ids.length - 1]
  if (!id) throw new Error(`No hay nodo de tipo ${type} en el setup`)
  return id
}

/** Construye, directamente sobre el store real, el recorrido:
 *  start -> pantalla "Bienvenida" -> decisión "¿Qué eliges?" -[A]-> final "Fin A"
 */
function buildGraphInStore() {
  const store = useProjectStore.getState()
  act(() => {
    store.createNode('content', { x: 100, y: 0 }, { title: 'Bienvenida', body: 'Hola, esto es el inicio.' })
  })
  let project = useProjectStore.getState().project
  const startId = nodeIdOf(project, 'start')
  const contentId = nodeIdOf(project, 'content')
  act(() => {
    useProjectStore.getState().connect(startId, contentId)
    useProjectStore.getState().createNode('decision', { x: 200, y: 0 }, { title: '¿Qué eliges?' })
  })
  project = useProjectStore.getState().project
  const decisionId = nodeIdOf(project, 'decision')
  act(() => {
    useProjectStore.getState().connect(contentId, decisionId)
    useProjectStore.getState().createNode('final', { x: 300, y: 0 }, { title: 'Fin A', body: 'Llegaste al final A.' })
  })
  project = useProjectStore.getState().project
  const finalId = nodeIdOf(project, 'final')
  const decisionNode = project.graph.nodes.find((node) => node.id === decisionId)
  const responses = decisionNode?.type === 'decision' ? decisionNode.responses : []
  const responseA = responses.find((response) => response.letter === 'A')
  if (!responseA) throw new Error('setup inválido')
  act(() => {
    useProjectStore.getState().updateResponse(decisionId, responseA.id, { text: 'Camino A' })
    useProjectStore.getState().connect(decisionId, finalId, responseA.id)
  })

  return { contentId, decisionId, finalId }
}

beforeEach(() => {
  resetProjectStore()
})

describe('PlayerScreen', () => {
  it('muestra la pantalla con su contenido y avanza al pulsar Continuar', () => {
    buildGraphInStore()
    render(<PlayerScreen />)

    expect(screen.getByText('Bienvenida')).toBeInTheDocument()
    expect(screen.getByText('Hola, esto es el inicio.')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Continuar'))

    expect(screen.getByText('¿Qué eliges?')).toBeInTheDocument()
  })

  it('muestra las opciones de una Decisión con su texto y avanza según la elegida', () => {
    buildGraphInStore()
    render(<PlayerScreen />)

    fireEvent.click(screen.getByText('Continuar'))
    expect(screen.getByText('Camino A')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Camino A'))

    expect(screen.getByText('Fin de la experiencia')).toBeInTheDocument()
    expect(screen.getByText('Llegaste al final A.')).toBeInTheDocument()
  })

  it('muestra el mensaje de Final', () => {
    buildGraphInStore()
    render(<PlayerScreen />)

    fireEvent.click(screen.getByText('Continuar'))
    fireEvent.click(screen.getByText('Camino A'))

    expect(screen.getByText('Fin de la experiencia')).toBeInTheDocument()
  })

  it('"Reiniciar experiencia" vuelve al principio dentro del propio Player', () => {
    buildGraphInStore()
    render(<PlayerScreen />)

    fireEvent.click(screen.getByText('Continuar'))
    expect(screen.getByText('¿Qué eliges?')).toBeInTheDocument()

    fireEvent.click(screen.getByText('↺ Reiniciar experiencia'))

    expect(screen.getByText('Bienvenida')).toBeInTheDocument()
  })

  it('"Volver al editor" llama a setPreviewMode(false)', () => {
    buildGraphInStore()
    act(() => {
      useProjectStore.getState().setPreviewMode(true)
    })
    render(<PlayerScreen />)

    fireEvent.click(screen.getByText('← Volver al editor'))

    expect(useProjectStore.getState().ui.previewMode).toBe(false)
  })

  it('muestra el aviso de "sin continuación" cuando el recorrido llega a un callejón sin salida', () => {
    act(() => {
      useProjectStore.getState().createNode('content', { x: 100, y: 0 }, { title: 'Pantalla suelta' })
    })
    const project = useProjectStore.getState().project
    const startId = nodeIdOf(project, 'start')
    const contentId = nodeIdOf(project, 'content')
    act(() => {
      useProjectStore.getState().connect(startId, contentId)
      // Deliberadamente sin conectar la pantalla a ningún destino.
    })

    render(<PlayerScreen />)

    expect(
      screen.getByText(/todavía no tiene una continuación configurada/i),
    ).toBeInTheDocument()
    // Los controles permanentes siguen visibles incluso en el callejón sin salida.
    expect(screen.getByText('↺ Reiniciar experiencia')).toBeInTheDocument()
    expect(screen.getByText('← Volver al editor')).toBeInTheDocument()
  })

  it('lee el project real del store (no una copia): refleja exactamente los nodos/textos creados', () => {
    const project = createProject('Mi proyecto de prueba')
    act(() => {
      useProjectStore.getState().loadProject(project)
      useProjectStore
        .getState()
        .createNode('content', { x: 50, y: 0 }, { title: 'Título exacto', body: 'Cuerpo exacto' })
    })
    const withContent = useProjectStore.getState().project
    const startId = nodeIdOf(withContent, 'start')
    const contentId = nodeIdOf(withContent, 'content')
    // Se conecta la pantalla a un final para que tenga destino configurado
    // (si no, el Player la trataría como callejón sin salida, un caso
    // distinto ya cubierto por otro test) y así se puede comprobar que
    // muestra exactamente el título/body reales del documento.
    act(() => {
      useProjectStore.getState().connect(startId, contentId)
      useProjectStore.getState().createNode('final', { x: 150, y: 0 })
    })
    const withFinal = useProjectStore.getState().project
    const finalId = nodeIdOf(withFinal, 'final')
    act(() => {
      useProjectStore.getState().connect(contentId, finalId)
    })

    render(<PlayerScreen />)

    expect(screen.getByText('Título exacto')).toBeInTheDocument()
    expect(screen.getByText('Cuerpo exacto')).toBeInTheDocument()
    // Y el propio documento del store sigue siendo el mismo objeto de
    // proyecto (mismo id de metadata) que el Player está leyendo.
    expect(useProjectStore.getState().project.metadata.name).toBe('Mi proyecto de prueba')
  })
})
