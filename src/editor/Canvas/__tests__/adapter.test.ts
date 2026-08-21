import { describe, expect, it } from 'vitest'
import { addResponse, connect, createNode, createProject } from '../../../domain'
import type { ProjectDocument } from '../../../domain'
import { resolveConnection, toFlowEdges, toFlowNodes } from '../adapter'
import { IN_HANDLE_ID, OUT_HANDLE_ID, responseHandleId } from '../handles'

function otherNodeIdOf(project: ProjectDocument, type: 'slide' | 'final'): string {
  const id = project.graph.nodes.find(
    (n) => n.type === type && n.id !== project.graph.startNodeId,
  )?.id
  if (!id) throw new Error(`No hay nodo "${type}" distinto del inicio en el setup`)
  return id
}

function firstResponseId(project: ProjectDocument, nodeId: string): string {
  const node = project.graph.nodes.find((n) => n.id === nodeId)
  const id = node?.type === 'slide' ? node.responses[0]?.id : undefined
  if (!id) throw new Error('setup inválido')
  return id
}

describe('toFlowNodes', () => {
  it('mapea tipo, número y título de cada nodo de dominio', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 10, y: 20 }, { title: 'Diapositiva 1' })
    const startId = project.graph.startNodeId
    const slideId = otherNodeIdOf(project, 'slide')

    const flowNodes = toFlowNodes(project, [])

    expect(flowNodes.find((n) => n.id === startId)).toMatchObject({
      id: startId,
      type: 'slide',
      position: { x: 0, y: 0 },
      selected: false,
      data: { nodeType: 'slide', number: 1, title: '', isStart: true },
    })
    expect(flowNodes.find((n) => n.id === slideId)).toMatchObject({
      id: slideId,
      type: 'slide',
      position: { x: 10, y: 20 },
      selected: false,
      data: { nodeType: 'slide', number: 2, title: 'Diapositiva 1', isStart: false },
    })
  })

  it('marca `isStart: true` solo para la diapositiva de graph.startNodeId', () => {
    const project = createNode(createProject('P'), 'slide', { x: 0, y: 0 })
    const flowNodes = toFlowNodes(project, [])

    const starts = flowNodes.filter((n) => n.data.isStart)
    expect(starts).toHaveLength(1)
    expect(starts[0]?.id).toBe(project.graph.startNodeId)
  })

  it('marca `selected: true` solo para los ids indicados', () => {
    const project = createNode(createProject('P'), 'slide', { x: 0, y: 0 })
    const startId = project.graph.startNodeId
    const slideId = otherNodeIdOf(project, 'slide')

    const flowNodes = toFlowNodes(project, [slideId])

    expect(flowNodes.find((n) => n.id === startId)?.selected).toBe(false)
    expect(flowNodes.find((n) => n.id === slideId)?.selected).toBe(true)
  })

  it('una diapositiva sin respuestas lleva `responses` vacío', () => {
    const project = createProject('P')
    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes[0]?.data.responses).toEqual([])
  })

  it('incluye el resumen de respuestas (id y texto, sin letra) en orden de letra', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = addResponse(project, startId) // A
    project = addResponse(project, startId) // B

    const flowNodes = toFlowNodes(project, [])
    const summaries = flowNodes.find((n) => n.id === startId)?.data.responses

    expect(summaries).toHaveLength(2)
    // El resumen no transporta la letra: el lienzo pinta un punto, no letras.
    for (const summary of summaries ?? []) {
      expect(Object.keys(summary).sort()).toEqual(['id', 'text'])
    }
  })

  it('un nodo final no lleva campo `responses`', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === finalId)?.data.responses).toBeUndefined()
  })
})

describe('toFlowEdges', () => {
  it('la arista de "continuar" usa el handle de salida único (OUT_HANDLE_ID) y de entrada (IN_HANDLE_ID)', () => {
    let project = createNode(createProject('P'), 'slide', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const slideId = otherNodeIdOf(project, 'slide')
    project = connect(project, startId, slideId)

    expect(toFlowEdges(project)).toEqual([
      {
        id: `${startId}->${slideId}`,
        source: startId,
        target: slideId,
        sourceHandle: OUT_HANDLE_ID,
        targetHandle: IN_HANDLE_ID,
      },
    ])
  })

  it('la arista de una respuesta usa response:<id> como sourceHandle y NO lleva label', () => {
    let project = createNode(createProject('P'), 'final', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = addResponse(project, startId)
    const responseId = firstResponseId(project, startId)

    project = connect(project, startId, finalId, responseId)

    expect(toFlowEdges(project)).toEqual([
      {
        id: `${startId}:${responseId}->${finalId}`,
        source: startId,
        target: finalId,
        sourceHandle: responseHandleId(responseId),
        targetHandle: IN_HANDLE_ID,
      },
    ])
  })

  it('no genera arista para una respuesta sin destino', () => {
    const base = createProject('P')
    const project = addResponse(base, base.graph.startNodeId)
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
