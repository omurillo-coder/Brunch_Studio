import { describe, expect, it } from 'vitest'
import { addResponse, connect, createNode, createProject, disconnect } from '../../../domain'
import type { ProjectDocument } from '../../../domain'
import { resolveConnection, toFlowEdges, toFlowNodes } from '../adapter'
import { BRUNCH_EDGE_TYPE } from '../edges/edgeTypes'
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

describe('toFlowNodes — hasNoOutgoing (punto 1: destacar nodos sin salida)', () => {
  it('una diapositiva "de continuar" sin destino se marca hasNoOutgoing', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId
    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === startId)?.data.hasNoOutgoing).toBe(true)
  })

  it('una diapositiva "de continuar" con destino NO se marca', () => {
    let project = createNode(createProject('P'), 'slide', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const slideId = otherNodeIdOf(project, 'slide')
    project = connect(project, startId, slideId)

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === startId)?.data.hasNoOutgoing).toBe(false)
  })

  it('una diapositiva "de decisión" sin ninguna respuesta con destino se marca hasNoOutgoing', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    project = addResponse(project, startId)

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === startId)?.data.hasNoOutgoing).toBe(true)
  })

  it('una diapositiva "de decisión" con TODAS sus respuestas sin destino se marca hasNoOutgoing', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    project = addResponse(project, startId)
    // Ninguna de las dos respuestas se conecta.

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === startId)?.data.hasNoOutgoing).toBe(true)
  })

  it('una diapositiva "de decisión" con AL MENOS una respuesta conectada no se marca', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = addResponse(project, startId)
    project = addResponse(project, startId)
    const responseId = firstResponseId(project, startId)
    project = connect(project, startId, finalId, responseId)

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === startId)?.data.hasNoOutgoing).toBe(false)
  })

  it('desconectar la única respuesta conectada vuelve a marcar hasNoOutgoing', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = addResponse(project, startId)
    const responseId = firstResponseId(project, startId)
    project = connect(project, startId, finalId, responseId)
    project = disconnect(project, startId, responseId)

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === startId)?.data.hasNoOutgoing).toBe(true)
  })

  it('un nodo `final` nunca se marca hasNoOutgoing, aunque no tenga ninguna salida', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === finalId)?.data.hasNoOutgoing).toBe(false)
  })
})

describe('toFlowNodes — resaltado por selección (punto 4)', () => {
  it('sin selección, ningún nodo se marca isHighlighted ni isDimmed', () => {
    let project = createNode(createProject('P'), 'slide', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const slideId = otherNodeIdOf(project, 'slide')
    project = connect(project, startId, slideId)

    const flowNodes = toFlowNodes(project, [])
    for (const node of flowNodes) {
      expect(node.data.isHighlighted).toBe(false)
      expect(node.data.isDimmed).toBe(false)
    }
  })

  it('al seleccionar un nodo, su destino se marca isHighlighted y el resto isDimmed', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    project = createNode(project, 'slide', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    const unrelatedSlideId = project.graph.nodes.find(
      (n) => n.type === 'slide' && n.id !== startId,
    )?.id
    if (!unrelatedSlideId) throw new Error('setup inválido')
    project = connect(project, startId, finalId)

    const flowNodes = toFlowNodes(project, [startId])

    const start = flowNodes.find((n) => n.id === startId)
    const final = flowNodes.find((n) => n.id === finalId)
    const unrelated = flowNodes.find((n) => n.id === unrelatedSlideId)

    // El propio nodo seleccionado: ni resaltado (ya lo marca `selected`) ni
    // atenuado.
    expect(start?.selected).toBe(true)
    expect(start?.data.isHighlighted).toBe(false)
    expect(start?.data.isDimmed).toBe(false)

    // Su destino: resaltado, no atenuado.
    expect(final?.data.isHighlighted).toBe(true)
    expect(final?.data.isDimmed).toBe(false)

    // Nodo no relacionado: atenuado, no resaltado.
    expect(unrelated?.data.isHighlighted).toBe(false)
    expect(unrelated?.data.isDimmed).toBe(true)
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
        type: BRUNCH_EDGE_TYPE,
        data: { laneIndex: 0, laneSize: 1, isHighlighted: false, isDimmed: false },
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
        type: BRUNCH_EDGE_TYPE,
        data: { laneIndex: 0, laneSize: 1, isHighlighted: false, isDimmed: false },
      },
    ])
  })

  it('no genera arista para una respuesta sin destino', () => {
    const base = createProject('P')
    const project = addResponse(base, base.graph.startNodeId)
    expect(toFlowEdges(project)).toEqual([])
  })
})

describe('toFlowEdges — carriles de aristas paralelas/convergentes (punto 3)', () => {
  it('una arista sola (sin nada con lo que solaparse) lleva laneIndex 0 y laneSize 1', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = connect(project, startId, finalId)

    const [edge] = toFlowEdges(project)
    expect(edge?.data).toMatchObject({ laneIndex: 0, laneSize: 1 })
  })

  it('varias respuestas de una misma diapositiva hacia el MISMO destino reciben laneIndex distintos', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = addResponse(project, startId)
    project = addResponse(project, startId)
    const [responseA, responseB] = (() => {
      const node = project.graph.nodes.find((n) => n.id === startId)
      return node?.type === 'slide' ? node.responses.map((r) => r.id) : []
    })()
    if (!responseA || !responseB) throw new Error('setup inválido')
    project = connect(project, startId, finalId, responseA)
    project = connect(project, startId, finalId, responseB)

    const edges = toFlowEdges(project)
    expect(edges).toHaveLength(2)
    const laneIndexes = edges.map((e) => e.data?.laneIndex).sort()
    expect(laneIndexes).toEqual([0, 1])
    for (const edge of edges) {
      expect(edge.data?.laneSize).toBe(2)
    }
    // Las dos aristas deben tener laneIndex DISTINTO entre sí.
    expect(edges[0]?.data?.laneIndex).not.toBe(edges[1]?.data?.laneIndex)
  })

  it('varias diapositivas distintas convergiendo en el MISMO destino reciben laneIndex distintos', () => {
    let project = createNode(createProject('P'), 'final', { x: 200, y: 0 })
    project = createNode(project, 'slide', { x: 100, y: 100 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    const otherSlideId = project.graph.nodes.find(
      (n) => n.type === 'slide' && n.id !== startId,
    )?.id
    if (!otherSlideId) throw new Error('setup inválido')

    project = connect(project, startId, finalId)
    project = connect(project, otherSlideId, finalId)

    const edges = toFlowEdges(project)
    expect(edges).toHaveLength(2)
    expect(edges.every((e) => e.data?.laneSize === 2)).toBe(true)
    expect(edges[0]?.data?.laneIndex).not.toBe(edges[1]?.data?.laneIndex)
  })

  it('aristas hacia destinos DISTINTOS no comparten carril (laneSize 1 cada una)', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    project = createNode(project, 'final', { x: 100, y: 100 })
    const startId = project.graph.startNodeId
    const finals = project.graph.nodes.filter((n) => n.type === 'final').map((n) => n.id)
    project = addResponse(project, startId)
    project = addResponse(project, startId)
    const [responseA, responseB] = (() => {
      const node = project.graph.nodes.find((n) => n.id === startId)
      return node?.type === 'slide' ? node.responses.map((r) => r.id) : []
    })()
    if (!responseA || !responseB) throw new Error('setup inválido')
    project = connect(project, startId, finals[0]!, responseA)
    project = connect(project, startId, finals[1]!, responseB)

    const edges = toFlowEdges(project)
    for (const edge of edges) {
      expect(edge.data).toMatchObject({ laneIndex: 0, laneSize: 1 })
    }
  })

  it('el carril asignado es estable entre llamadas sucesivas (mismo project → mismo resultado)', () => {
    let project = createNode(createProject('P'), 'final', { x: 200, y: 0 })
    project = createNode(project, 'slide', { x: 100, y: 100 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    const otherSlideId = project.graph.nodes.find(
      (n) => n.type === 'slide' && n.id !== startId,
    )?.id
    if (!otherSlideId) throw new Error('setup inválido')
    project = connect(project, startId, finalId)
    project = connect(project, otherSlideId, finalId)

    const first = toFlowEdges(project)
    const second = toFlowEdges(project)
    expect(first.map((e) => [e.id, e.data?.laneIndex])).toEqual(
      second.map((e) => [e.id, e.data?.laneIndex]),
    )
  })
})

describe('toFlowEdges — resaltado por selección (punto 4)', () => {
  it('sin selección, ninguna arista se marca isHighlighted ni isDimmed', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = connect(project, startId, finalId)

    const [edge] = toFlowEdges(project, [])
    expect(edge?.data).toMatchObject({ isHighlighted: false, isDimmed: false })
  })

  it('una arista saliente del nodo seleccionado se marca isHighlighted, no isDimmed', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = connect(project, startId, finalId)

    const [edge] = toFlowEdges(project, [startId])
    expect(edge?.data).toMatchObject({ isHighlighted: true, isDimmed: false })
  })

  it('una arista que NO sale del nodo seleccionado se marca isDimmed, no isHighlighted', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    project = createNode(project, 'slide', { x: 100, y: 100 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    const otherSlideId = project.graph.nodes.find(
      (n) => n.type === 'slide' && n.id !== startId,
    )?.id
    if (!otherSlideId) throw new Error('setup inválido')
    project = connect(project, otherSlideId, finalId)

    const [edge] = toFlowEdges(project, [startId])
    expect(edge?.data).toMatchObject({ isHighlighted: false, isDimmed: true })
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
