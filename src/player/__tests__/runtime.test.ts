import { describe, expect, it } from 'vitest'
import { addResponse, connect, createNode, createProject } from '../../domain'
import type { ProjectDocument } from '../../domain'
import { advance, choose, getInitialState, getView, restart } from '../runtime'

function nodeIdOf(project: ProjectDocument, type: 'start' | 'content' | 'decision' | 'final'): string {
  const ids = project.graph.nodes.filter((node) => node.type === type).map((node) => node.id)
  const id = ids[ids.length - 1]
  if (!id) throw new Error(`No hay nodo de tipo ${type} en el setup`)
  return id
}

/**
 * Construye: start -> pantalla -> decisión -[A]-> final A
 *                                          -[B]-> final B
 */
function buildFullGraph() {
  let project = createProject('P')
  project = createNode(project, 'content', { x: 100, y: 0 }, { title: 'Bienvenida', body: 'Hola' })
  project = createNode(project, 'decision', { x: 200, y: 0 }, { title: '¿Qué eliges?' })
  project = createNode(project, 'final', { x: 300, y: -50 }, { title: 'Final A', body: 'Llegaste a A' })
  project = createNode(project, 'final', { x: 300, y: 50 }, { title: 'Final B', body: 'Llegaste a B' })

  const startId = nodeIdOf(project, 'start')
  const contentId = nodeIdOf(project, 'content')
  const decisionId = nodeIdOf(project, 'decision')
  const finalIds = project.graph.nodes.filter((node) => node.type === 'final').map((n) => n.id)
  const [finalAId, finalBId] = finalIds as [string, string]

  project = connect(project, startId, contentId)
  project = connect(project, contentId, decisionId)
  project = addResponse(project, decisionId) // A
  project = addResponse(project, decisionId) // B

  const decisionNode = project.graph.nodes.find((n) => n.id === decisionId)
  const responses = decisionNode?.type === 'decision' ? decisionNode.responses : []
  const responseA = responses.find((r) => r.letter === 'A')
  const responseB = responses.find((r) => r.letter === 'B')
  if (!responseA || !responseB) throw new Error('setup inválido')

  project = connect(project, decisionId, finalAId, responseA.id)
  project = connect(project, decisionId, finalBId, responseB.id)

  return { project, startId, contentId, decisionId, finalAId, finalBId, responseA, responseB }
}

describe('runtime del Player', () => {
  it('salta automáticamente desde start sin mostrarlo nunca', () => {
    const { project, contentId } = buildFullGraph()

    const state = getInitialState(project)
    expect(state.currentNodeId).toBe(contentId)

    const view = getView(project, state)
    expect(view.kind).toBe('content')
  })

  it('recorrido completo: Inicio -> Pantalla -> Decisión -> (elige A) -> Final', () => {
    const { project, decisionId, finalAId, responseA } = buildFullGraph()

    let state = getInitialState(project)
    expect(getView(project, state).kind).toBe('content')

    state = advance(project, state)
    expect(state.currentNodeId).toBe(decisionId)
    expect(getView(project, state).kind).toBe('decision')

    state = choose(project, state, responseA.id)
    expect(state.currentNodeId).toBe(finalAId)
    const finalView = getView(project, state)
    expect(finalView.kind).toBe('final')
    if (finalView.kind === 'final') {
      expect(finalView.node.id).toBe(finalAId)
    }
  })

  it('reiniciar y elegir la otra respuesta lleva a otro Final', () => {
    const { project, finalBId, responseB } = buildFullGraph()

    let state = getInitialState(project)
    state = advance(project, state)
    state = choose(project, state, responseB.id)

    expect(state.currentNodeId).toBe(finalBId)

    // Reiniciar vuelve exactamente al punto de partida, incluyendo el salto
    // automático inicial desde start.
    const restarted = restart(project)
    expect(restarted).toEqual(getInitialState(project))
    expect(getView(project, restarted).kind).toBe('content')
  })

  it('dead-end: una Pantalla sin destino configurado', () => {
    let project = createProject('P')
    project = createNode(project, 'content', { x: 100, y: 0 })
    const startId = nodeIdOf(project, 'start')
    const contentId = nodeIdOf(project, 'content')
    project = connect(project, startId, contentId)
    // El contenido no se conecta a ningún destino: queda sin salida.

    const state = getInitialState(project)
    expect(state.currentNodeId).toBe(contentId)
    const view = getView(project, state)
    expect(view.kind).toBe('dead-end')
  })

  it('dead-end: una Decisión sin ninguna respuesta con destino', () => {
    let project = createProject('P')
    project = createNode(project, 'decision', { x: 100, y: 0 })
    const startId = nodeIdOf(project, 'start')
    const decisionId = nodeIdOf(project, 'decision')
    project = connect(project, startId, decisionId)
    project = addResponse(project, decisionId) // A, sin destino
    project = addResponse(project, decisionId) // B, sin destino

    const state = getInitialState(project)
    const view = getView(project, state)
    expect(view.kind).toBe('dead-end')
  })

  it('dead-end: el propio start sin destino no se muestra como "Inicio"', () => {
    const project = createProject('P') // start recién creado, sin target

    const state = getInitialState(project)
    const view = getView(project, state)
    expect(view.kind).toBe('dead-end')
    // El nodo referenciado es el start (para que la UI no necesite lógica
    // extra), pero `getView` nunca devuelve `kind: 'start'`.
    expect(view.node?.type).toBe('start')
  })

  it('dead-end: ausencia total de un nodo start', () => {
    let project = createProject('P')
    const startId = nodeIdOf(project, 'start')
    project = {
      ...project,
      graph: { nodes: project.graph.nodes.filter((node) => node.id !== startId) },
    }

    const state = getInitialState(project)
    expect(state.currentNodeId).toBeNull()
    const view = getView(project, state)
    expect(view).toEqual({ kind: 'dead-end', node: null })
  })

  it('elegir una respuesta sin destino no avanza (no-op)', () => {
    let project = createProject('P')
    project = createNode(project, 'decision', { x: 100, y: 0 })
    project = createNode(project, 'final', { x: 200, y: 0 })
    const startId = nodeIdOf(project, 'start')
    const decisionId = nodeIdOf(project, 'decision')
    const finalId = nodeIdOf(project, 'final')
    project = connect(project, startId, decisionId)
    project = addResponse(project, decisionId) // A, sin destino
    project = addResponse(project, decisionId) // B
    const decisionNode = project.graph.nodes.find((n) => n.id === decisionId)
    const responses = decisionNode?.type === 'decision' ? decisionNode.responses : []
    const responseA = responses.find((r) => r.letter === 'A')
    const responseB = responses.find((r) => r.letter === 'B')
    if (!responseA || !responseB) throw new Error('setup inválido')
    project = connect(project, decisionId, finalId, responseB.id)

    const state = getInitialState(project)
    const afterChoosingA = choose(project, state, responseA.id)
    expect(afterChoosingA).toEqual(state)
  })

  it('advance es un no-op si el nodo actual no es una Pantalla', () => {
    const { project, decisionId } = buildFullGraph()
    let state = getInitialState(project)
    state = advance(project, state) // ahora en decisionId
    const advancedAgain = advance(project, state)
    expect(advancedAgain).toEqual({ currentNodeId: decisionId })
  })
})
