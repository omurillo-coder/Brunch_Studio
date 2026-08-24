import { describe, expect, it } from 'vitest'
import { createNode, createProject, connect, addResponse } from '../../../../domain'
import type { ProjectDocument } from '../../../../domain'
import { computeAutoLayout } from '../autoLayout'

/** Primer nodo del tipo pedido que no sea la diapositiva de inicio. */
function otherNodeIdOf(project: ProjectDocument, type: 'slide' | 'final'): string {
  const node = project.graph.nodes.find(
    (candidate) => candidate.type === type && candidate.id !== project.graph.startNodeId,
  )
  if (!node) throw new Error(`No hay un nodo "${type}" distinto del inicio en el setup`)
  return node.id
}

function positionOf(moves: ReturnType<typeof computeAutoLayout>, nodeId: string) {
  const move = moves.find((candidate) => candidate.nodeId === nodeId)
  if (!move) throw new Error(`No hay movimiento para el nodo "${nodeId}"`)
  return move.position
}

/** Construye una cadena lineal start → slide2 → slide3 → final, conectando
 *  cada uno con el siguiente vía "Continuar" (sin respuestas). */
function buildChain(): { project: ProjectDocument; ids: string[] } {
  let project = createProject('P')
  const startId = project.graph.startNodeId

  project = createNode(project, 'slide', { x: 999, y: 999 })
  const slide2Id = otherNodeIdOf(project, 'slide')

  project = createNode(project, 'slide', { x: 999, y: 999 })
  const slide3Id = project.graph.nodes.find(
    (n) => n.type === 'slide' && n.id !== startId && n.id !== slide2Id,
  )?.id
  if (!slide3Id) throw new Error('setup inválido')

  project = createNode(project, 'final', { x: 999, y: 999 })
  const finalId = otherNodeIdOf(project, 'final')

  project = connect(project, startId, slide2Id)
  project = connect(project, slide2Id, slide3Id)
  project = connect(project, slide3Id, finalId)

  return { project, ids: [startId, slide2Id, slide3Id, finalId] }
}

describe('computeAutoLayout', () => {
  it('devuelve un movimiento por cada nodo del proyecto', () => {
    const { project, ids } = buildChain()
    const moves = computeAutoLayout(project)
    expect(moves.map((move) => move.nodeId).sort()).toEqual([...ids].sort())
  })

  it('con un proyecto vacío de nodos no lanza (defensivo; en la práctica siempre hay al menos el de inicio)', () => {
    const project = createProject('P')
    expect(() => computeAutoLayout(project)).not.toThrow()
    expect(computeAutoLayout(project)).toHaveLength(1)
  })

  it('es determinista: el mismo documento produce siempre las mismas posiciones', () => {
    const { project } = buildChain()
    const first = computeAutoLayout(project)
    const second = computeAutoLayout(project)
    expect(second).toEqual(first)
  })

  it('una cadena lineal de diapositivas queda en orden creciente en horizontal (x)', () => {
    const { project, ids } = buildChain()
    const [startId, slide2Id, slide3Id, finalId] = ids as [string, string, string, string]
    const moves = computeAutoLayout(project)

    const xs = [startId, slide2Id, slide3Id, finalId].map((id) => positionOf(moves, id).x)
    expect(xs[0]).toBeLessThan(xs[1] as number)
    expect(xs[1]).toBeLessThan(xs[2] as number)
    expect(xs[2]).toBeLessThan(xs[3] as number)
  })

  it('el startNodeId queda en el extremo de partida (la columna más a la izquierda)', () => {
    const { project, ids } = buildChain()
    const moves = computeAutoLayout(project)
    const startId = project.graph.startNodeId

    const minX = Math.min(...moves.map((move) => move.position.x))
    expect(positionOf(moves, startId).x).toBe(minX)
    // Es el único en esa columna en esta cadena lineal.
    expect(moves.filter((move) => move.position.x === minX)).toHaveLength(1)
    expect(ids).toContain(startId)
  })

  it('un ciclo que vuelve al inicio no rompe el cálculo y el inicio sigue en el extremo de partida', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId

    project = createNode(project, 'slide', { x: 0, y: 0 })
    const otherId = otherNodeIdOf(project, 'slide')

    // A (inicio) -> B -> A: ciclo que vuelve al inicio.
    project = connect(project, startId, otherId)
    project = connect(project, otherId, startId)

    expect(() => computeAutoLayout(project)).not.toThrow()
    const moves = computeAutoLayout(project)

    const minX = Math.min(...moves.map((move) => move.position.x))
    expect(positionOf(moves, startId).x).toBe(minX)
  })

  it('nodos completamente desconectados reciben posiciones propias sin solaparse con el resto', () => {
    const { project: chained } = buildChain()
    let project = chained
    project = createNode(project, 'final', { x: 0, y: 0 }) // aislado 1
    project = createNode(project, 'slide', { x: 0, y: 0 }) // aislado 2

    const moves = computeAutoLayout(project)
    expect(moves).toHaveLength(project.graph.nodes.length)

    // Ningún par de nodos comparte exactamente la misma posición (bounding
    // box completa: mismo tamaño asumido para todos, así que basta
    // comparar la esquina superior izquierda).
    const seen = new Set<string>()
    for (const move of moves) {
      const key = `${move.position.x}:${move.position.y}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('un nodo con dos respuestas hacia destinos distintos genera dos ramas sin solape', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = createNode(project, 'final', { x: 0, y: 0 })
    const finalAId = otherNodeIdOf(project, 'final')
    project = createNode(project, 'final', { x: 0, y: 0 })
    const finalBId = project.graph.nodes.find(
      (n) => n.type === 'final' && n.id !== finalAId,
    )?.id
    if (!finalBId) throw new Error('setup inválido')

    project = addResponse(project, startId)
    project = addResponse(project, startId)
    const responses = project.graph.nodes.find((n) => n.id === startId)
    const [responseA, responseB] =
      responses?.type === 'slide' ? responses.responses : []
    if (!responseA || !responseB) throw new Error('setup inválido')

    project = connect(project, startId, finalAId, responseA.id)
    project = connect(project, startId, finalBId, responseB.id)

    const moves = computeAutoLayout(project)
    const posA = positionOf(moves, finalAId)
    const posB = positionOf(moves, finalBId)
    expect(posA).not.toEqual(posB)
    // Ambas ramas están a la derecha del inicio.
    expect(posA.x).toBeGreaterThan(positionOf(moves, startId).x)
    expect(posB.x).toBeGreaterThan(positionOf(moves, startId).x)
  })
})
