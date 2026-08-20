import { describe, expect, it } from 'vitest'
import { createNode, createProject } from '../project'
import { connect, disconnect, deriveEdges } from '../graph'
import { addResponse } from '../responses'
import type { ProjectDocument } from '../schemas'

function nodeIdOf(project: ProjectDocument, type: 'start' | 'content' | 'decision' | 'final'): string {
  const id = project.graph.nodes.find((n) => n.type === type)?.id
  if (!id) throw new Error(`No hay nodo de tipo ${type} en el setup`)
  return id
}

describe('connect / disconnect', () => {
  it('conecta la salida única de un nodo start/content', () => {
    let project = createProject('P')
    project = createNode(project, 'content', { x: 100, y: 0 })
    const startId = nodeIdOf(project, 'start')
    const contentId = nodeIdOf(project, 'content')

    project = connect(project, startId, contentId)
    const start = project.graph.nodes.find((n) => n.id === startId)
    expect(start?.type === 'start' ? start.targetNodeId : undefined).toBe(contentId)
  })

  it('desconecta la salida de un nodo start/content', () => {
    let project = createProject('P')
    project = createNode(project, 'content', { x: 100, y: 0 })
    const startId = nodeIdOf(project, 'start')
    const contentId = nodeIdOf(project, 'content')

    project = connect(project, startId, contentId)
    project = disconnect(project, startId)
    const start = project.graph.nodes.find((n) => n.id === startId)
    expect(start?.type === 'start' ? start.targetNodeId : 'missing').toBeUndefined()
  })

  it('conecta y desconecta la salida de una respuesta concreta de un nodo decision', () => {
    let project = createProject('P')
    project = createNode(project, 'decision', { x: 100, y: 0 })
    project = createNode(project, 'final', { x: 200, y: 0 })
    const decisionId = nodeIdOf(project, 'decision')
    const finalId = nodeIdOf(project, 'final')
    project = addResponse(project, decisionId)

    const decisionNode = project.graph.nodes.find((n) => n.id === decisionId)
    const responseId = decisionNode?.type === 'decision' ? decisionNode.responses[0]?.id : undefined
    if (!responseId) throw new Error('setup inválido')

    project = connect(project, decisionId, finalId, responseId)
    let decision = project.graph.nodes.find((n) => n.id === decisionId)
    expect(decision?.type === 'decision' ? decision.responses[0]?.targetNodeId : undefined).toBe(
      finalId,
    )

    project = disconnect(project, decisionId, responseId)
    decision = project.graph.nodes.find((n) => n.id === decisionId)
    expect(decision?.type === 'decision' ? decision.responses[0]?.targetNodeId : 'missing').toBeUndefined()
  })

  it('connect en un nodo decision sin responseId lanza error', () => {
    let project = createProject('P')
    project = createNode(project, 'decision', { x: 100, y: 0 })
    project = createNode(project, 'final', { x: 200, y: 0 })
    const decisionId = nodeIdOf(project, 'decision')
    const finalId = nodeIdOf(project, 'final')

    expect(() => connect(project, decisionId, finalId)).toThrow()
  })

  it('connect sobre un nodo final lanza error (no tiene salida)', () => {
    let project = createProject('P')
    project = createNode(project, 'final', { x: 100, y: 0 })
    project = createNode(project, 'content', { x: 200, y: 0 })
    const finalId = nodeIdOf(project, 'final')
    const contentId = nodeIdOf(project, 'content')

    expect(() => connect(project, finalId, contentId)).toThrow()
  })
})

describe('deriveEdges', () => {
  it('deriva una arista simple para start/content con target', () => {
    let project = createProject('P')
    project = createNode(project, 'content', { x: 100, y: 0 })
    const startId = nodeIdOf(project, 'start')
    const contentId = nodeIdOf(project, 'content')
    project = connect(project, startId, contentId)

    const edges = deriveEdges(project)
    expect(edges).toEqual([{ id: `${startId}->${contentId}`, source: startId, target: contentId }])
  })

  it('no genera arista cuando no hay target', () => {
    const project = createProject('P')
    expect(deriveEdges(project)).toEqual([])
  })

  it('deriva una arista por respuesta de decision, etiquetada con su letra', () => {
    let project = createProject('P')
    project = createNode(project, 'decision', { x: 100, y: 0 })
    project = createNode(project, 'final', { x: 200, y: 0 })
    const decisionId = nodeIdOf(project, 'decision')
    const finalId = nodeIdOf(project, 'final')

    project = addResponse(project, decisionId) // A
    project = addResponse(project, decisionId) // B

    const decisionNode = project.graph.nodes.find((n) => n.id === decisionId)
    const responses = decisionNode?.type === 'decision' ? decisionNode.responses : []
    const responseA = responses.find((r) => r.letter === 'A')
    if (!responseA) throw new Error('setup inválido')

    project = connect(project, decisionId, finalId, responseA.id)

    const edges = deriveEdges(project)
    expect(edges).toEqual([
      {
        id: `${decisionId}:${responseA.id}->${finalId}`,
        source: decisionId,
        target: finalId,
        sourceHandle: responseA.id,
        label: 'A',
      },
    ])
  })
})
