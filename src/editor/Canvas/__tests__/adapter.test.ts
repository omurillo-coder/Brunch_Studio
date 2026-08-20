import { describe, expect, it } from 'vitest'
import { addResponse, connect, createNode, createProject } from '../../../domain'
import type { ProjectDocument } from '../../../domain'
import { resolveConnection, toFlowEdges, toFlowNodes } from '../adapter'
import { IN_HANDLE_ID, OUT_HANDLE_ID, responseHandleId } from '../handles'

function nodeIdOf(project: ProjectDocument, type: 'start' | 'content' | 'decision' | 'final'): string {
  const id = project.graph.nodes.find((n) => n.type === type)?.id
  if (!id) throw new Error(`No hay nodo de tipo ${type} en el setup`)
  return id
}

describe('toFlowNodes', () => {
  it('mapea tipo, número y título de cada nodo de dominio', () => {
    let project = createProject('P')
    project = createNode(project, 'content', { x: 10, y: 20 }, { title: 'Pantalla 1' })
    const startId = nodeIdOf(project, 'start')
    const contentId = nodeIdOf(project, 'content')

    const flowNodes = toFlowNodes(project, [])

    const start = flowNodes.find((n) => n.id === startId)
    const content = flowNodes.find((n) => n.id === contentId)

    expect(start).toMatchObject({
      id: startId,
      type: 'start',
      position: { x: 0, y: 0 },
      selected: false,
      data: { nodeType: 'start', number: 1, title: '' },
    })
    expect(content).toMatchObject({
      id: contentId,
      type: 'content',
      position: { x: 10, y: 20 },
      selected: false,
      data: { nodeType: 'content', number: 2, title: 'Pantalla 1' },
    })
  })

  it('marca `selected: true` solo para los ids indicados', () => {
    let project = createProject('P')
    project = createNode(project, 'content', { x: 0, y: 0 })
    const startId = nodeIdOf(project, 'start')
    const contentId = nodeIdOf(project, 'content')

    const flowNodes = toFlowNodes(project, [contentId])

    expect(flowNodes.find((n) => n.id === startId)?.selected).toBe(false)
    expect(flowNodes.find((n) => n.id === contentId)?.selected).toBe(true)
  })

  it('incluye el resumen de respuestas de un nodo decision, hasta 4', () => {
    let project = createProject('P')
    project = createNode(project, 'decision', { x: 0, y: 0 })
    const decisionId = nodeIdOf(project, 'decision')
    project = addResponse(project, decisionId)
    project = addResponse(project, decisionId)

    const flowNodes = toFlowNodes(project, [])
    const decision = flowNodes.find((n) => n.id === decisionId)

    expect(decision?.data.responses).toHaveLength(2)
    expect(decision?.data.responses?.map((r) => r.letter)).toEqual(['A', 'B'])
  })

  it('un nodo start/content/final no lleva campo `responses`', () => {
    let project = createProject('P')
    project = createNode(project, 'final', { x: 0, y: 0 })
    const flowNodes = toFlowNodes(project, [])

    for (const node of flowNodes) {
      expect(node.data.responses).toBeUndefined()
    }
  })
})

describe('toFlowEdges', () => {
  it('arista start/content usa el handle de salida único (OUT_HANDLE_ID) y de entrada (IN_HANDLE_ID)', () => {
    let project = createProject('P')
    project = createNode(project, 'content', { x: 100, y: 0 })
    const startId = nodeIdOf(project, 'start')
    const contentId = nodeIdOf(project, 'content')
    project = connect(project, startId, contentId)

    const edges = toFlowEdges(project)

    expect(edges).toEqual([
      {
        id: `${startId}->${contentId}`,
        source: startId,
        target: contentId,
        sourceHandle: OUT_HANDLE_ID,
        targetHandle: IN_HANDLE_ID,
        label: undefined,
      },
    ])
  })

  it('arista de decision lleva la letra como label y el handle response:<id> como sourceHandle', () => {
    let project = createProject('P')
    project = createNode(project, 'decision', { x: 100, y: 0 })
    project = createNode(project, 'final', { x: 200, y: 0 })
    const decisionId = nodeIdOf(project, 'decision')
    const finalId = nodeIdOf(project, 'final')
    project = addResponse(project, decisionId) // A
    const decision = project.graph.nodes.find((n) => n.id === decisionId)
    const responseId = decision?.type === 'decision' ? decision.responses[0]?.id : undefined
    if (!responseId) throw new Error('setup inválido')

    project = connect(project, decisionId, finalId, responseId)
    const edges = toFlowEdges(project)

    expect(edges).toEqual([
      {
        id: `${decisionId}:${responseId}->${finalId}`,
        source: decisionId,
        target: finalId,
        sourceHandle: responseHandleId(responseId),
        targetHandle: IN_HANDLE_ID,
        label: 'A',
      },
    ])
  })

  it('no genera arista para una respuesta sin destino', () => {
    let project = createProject('P')
    project = createNode(project, 'decision', { x: 100, y: 0 })
    const decisionId = nodeIdOf(project, 'decision')
    project = addResponse(project, decisionId)

    expect(toFlowEdges(project)).toEqual([])
  })
})

describe('resolveConnection', () => {
  it('deriva responseId cuando sourceHandle tiene el prefijo response:', () => {
    const resolved = resolveConnection({
      source: 'node-a',
      target: 'node-b',
      sourceHandle: responseHandleId('resp-1'),
    })

    expect(resolved).toEqual({
      sourceNodeId: 'node-a',
      targetNodeId: 'node-b',
      responseId: 'resp-1',
    })
  })

  it('no lleva responseId cuando sourceHandle es el handle de salida único', () => {
    const resolved = resolveConnection({
      source: 'node-a',
      target: 'node-b',
      sourceHandle: OUT_HANDLE_ID,
    })

    expect(resolved).toEqual({
      sourceNodeId: 'node-a',
      targetNodeId: 'node-b',
      responseId: undefined,
    })
  })

  it('devuelve null si falta source o target', () => {
    expect(resolveConnection({ source: null, target: 'node-b', sourceHandle: null })).toBeNull()
    expect(resolveConnection({ source: 'node-a', target: null, sourceHandle: null })).toBeNull()
  })
})
