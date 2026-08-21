import { describe, expect, it } from 'vitest'
import { createNode, createProject } from '../project'
import { connect, disconnect, deriveEdges } from '../graph'
import { addResponse } from '../responses'
import type { ProjectDocument } from '../schemas'

/** Primer nodo del tipo pedido que no sea la diapositiva de inicio. */
function otherNodeIdOf(project: ProjectDocument, type: 'slide' | 'final'): string {
  const node = project.graph.nodes.find(
    (candidate) => candidate.type === type && candidate.id !== project.graph.startNodeId,
  )
  if (!node) throw new Error(`No hay un nodo "${type}" distinto del inicio en el setup`)
  return node.id
}

function responseIdsOf(project: ProjectDocument, nodeId: string): string[] {
  const node = project.graph.nodes.find((candidate) => candidate.id === nodeId)
  return node?.type === 'slide' ? node.responses.map((response) => response.id) : []
}

describe('connect / disconnect', () => {
  it('conecta y desconecta la salida de "continuar" de una diapositiva sin respuestas', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const slideId = otherNodeIdOf(project, 'slide')

    project = connect(project, startId, slideId)
    let start = project.graph.nodes.find((n) => n.id === startId)
    expect(start?.type === 'slide' ? start.targetNodeId : undefined).toBe(slideId)

    project = disconnect(project, startId)
    start = project.graph.nodes.find((n) => n.id === startId)
    expect(start?.type === 'slide' ? start.targetNodeId : 'missing').toBeUndefined()
  })

  it('conecta y desconecta la salida de una respuesta concreta', () => {
    let project = createProject('P')
    project = createNode(project, 'final', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = addResponse(project, startId)

    const responseId = responseIdsOf(project, startId)[0]
    if (!responseId) throw new Error('setup inválido')

    project = connect(project, startId, finalId, responseId)
    let start = project.graph.nodes.find((n) => n.id === startId)
    expect(start?.type === 'slide' ? start.responses[0]?.targetNodeId : undefined).toBe(finalId)

    project = disconnect(project, startId, responseId)
    start = project.graph.nodes.find((n) => n.id === startId)
    expect(
      start?.type === 'slide' ? start.responses[0]?.targetNodeId : 'missing',
    ).toBeUndefined()
  })

  it('conectar sin responseId una diapositiva CON respuestas fija su targetNodeId dormido', () => {
    // El `targetNodeId` general sigue siendo un campo válido aunque la
    // diapositiva tenga respuestas: queda dormido (no genera arista ni lo usa
    // el Player) hasta que se eliminen todas las respuestas.
    let project = createProject('P')
    project = createNode(project, 'final', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = addResponse(project, startId)

    project = connect(project, startId, finalId)
    const start = project.graph.nodes.find((n) => n.id === startId)
    expect(start?.type === 'slide' ? start.targetNodeId : undefined).toBe(finalId)
    expect(deriveEdges(project)).toEqual([])
  })

  it('connect con un responseId que no existe lanza error', () => {
    const project = createNode(createProject('P'), 'final', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')

    expect(() => connect(project, startId, finalId, 'no-existe')).toThrow()
  })

  it('connect sobre un nodo final lanza error (no tiene salida)', () => {
    const project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')

    expect(() => connect(project, finalId, startId)).toThrow()
    expect(() => disconnect(project, finalId)).toThrow()
  })

  it('connect hacia un destino inexistente lanza error', () => {
    const project = createProject('P')
    expect(() => connect(project, project.graph.startNodeId, 'no-existe')).toThrow()
  })
})

describe('deriveEdges', () => {
  it('deriva una arista simple para una diapositiva sin respuestas con destino', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const slideId = otherNodeIdOf(project, 'slide')
    project = connect(project, startId, slideId)

    const edges = deriveEdges(project)
    expect(edges).toEqual([{ id: `${startId}->${slideId}`, source: startId, target: slideId }])
  })

  it('no genera arista cuando no hay destino', () => {
    const project = createProject('P')
    expect(deriveEdges(project)).toEqual([])
  })

  it('deriva una arista por respuesta con destino, sin etiqueta de letra', () => {
    let project = createProject('P')
    project = createNode(project, 'final', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')

    project = addResponse(project, startId) // A
    project = addResponse(project, startId) // B

    const [responseA] = responseIdsOf(project, startId)
    if (!responseA) throw new Error('setup inválido')

    project = connect(project, startId, finalId, responseA)

    const edges = deriveEdges(project)
    expect(edges).toEqual([
      {
        id: `${startId}:${responseA}->${finalId}`,
        source: startId,
        target: finalId,
        sourceHandle: responseA,
      },
    ])
  })

  it('los nodos final no generan aristas', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    expect(deriveEdges(project)).toEqual([])
  })
})
