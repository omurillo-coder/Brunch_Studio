import { describe, expect, it } from 'vitest'
import type { Edge as DomainEdge } from '../../../../domain'
import { buildOffsetEdgePath, computeEdgeLanes, laneOffset } from '../edgeGeometry'

describe('laneOffset', () => {
  it('el primer carril (índice 0) no lleva desplazamiento', () => {
    expect(laneOffset(0)).toBe(0)
  })

  it('el segundo y el tercer carril se desplazan a lados opuestos', () => {
    const second = laneOffset(1)
    const third = laneOffset(2)
    expect(second).not.toBe(0)
    expect(third).not.toBe(0)
    expect(Math.sign(second)).not.toBe(Math.sign(third))
    expect(Math.abs(second)).toBe(Math.abs(third))
  })

  it('el cuarto y el quinto carril se alejan más que el segundo y el tercero, alternando de lado', () => {
    const second = laneOffset(1)
    const third = laneOffset(2)
    const fourth = laneOffset(3)
    const fifth = laneOffset(4)
    expect(Math.sign(fourth)).toBe(Math.sign(second))
    expect(Math.sign(fifth)).toBe(Math.sign(third))
    expect(Math.abs(fourth)).toBeGreaterThan(Math.abs(second))
    expect(Math.abs(fifth)).toBeGreaterThan(Math.abs(third))
  })

  it('es determinista: mismo índice y `step` siempre da el mismo resultado', () => {
    expect(laneOffset(3, 24)).toBe(laneOffset(3, 24))
  })

  it('un `step` mayor amplía el desplazamiento proporcionalmente', () => {
    expect(laneOffset(1, 48)).toBe(2 * laneOffset(1, 24))
  })
})

describe('buildOffsetEdgePath', () => {
  it('con offset 0 el punto medio de la curva cae sobre la línea recta origen→destino', () => {
    const { labelX, labelY } = buildOffsetEdgePath({
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 0,
      offset: 0,
    })
    // Línea horizontal: el punto medio debe seguir en y=0.
    expect(labelY).toBeCloseTo(0)
    expect(labelX).toBeGreaterThan(0)
    expect(labelX).toBeLessThan(100)
  })

  it('un offset distinto de 0 desplaza el punto medio perpendicularmente a la línea', () => {
    const base = buildOffsetEdgePath({ sourceX: 0, sourceY: 0, targetX: 100, targetY: 0, offset: 0 })
    const shifted = buildOffsetEdgePath({ sourceX: 0, sourceY: 0, targetX: 100, targetY: 0, offset: 24 })
    // Línea horizontal → el desplazamiento perpendicular es vertical.
    expect(shifted.labelY).not.toBeCloseTo(base.labelY, 1)
  })

  it('offsets opuestos desplazan el punto medio a lados opuestos', () => {
    const positive = buildOffsetEdgePath({ sourceX: 0, sourceY: 0, targetX: 100, targetY: 0, offset: 24 })
    const negative = buildOffsetEdgePath({ sourceX: 0, sourceY: 0, targetX: 100, targetY: 0, offset: -24 })
    expect(Math.sign(positive.labelY)).not.toBe(Math.sign(negative.labelY))
  })

  it('el trazado siempre empieza y termina exactamente en los puntos origen/destino', () => {
    const { path } = buildOffsetEdgePath({ sourceX: 12, sourceY: 34, targetX: 200, targetY: 80, offset: 40 })
    expect(path.startsWith('M12,34')).toBe(true)
    expect(path.endsWith('200,80')).toBe(true)
  })
})

describe('computeEdgeLanes', () => {
  function edge(id: string, source: string, target: string, sourceHandle?: string): DomainEdge {
    return { id, source, target, sourceHandle }
  }

  it('una arista sin ninguna otra hacia el mismo destino va sola en su carril (laneSize 1)', () => {
    const lanes = computeEdgeLanes([edge('e1', 'a', 'b')])
    expect(lanes.get('e1')).toEqual({ laneIndex: 0, laneSize: 1 })
  })

  it('agrupa por DESTINO: mismo destino desde orígenes distintos comparten grupo', () => {
    const edges = [edge('e1', 'a', 'z'), edge('e2', 'b', 'z'), edge('e3', 'c', 'z')]
    const lanes = computeEdgeLanes(edges)
    const laneIndexes = edges.map((e) => lanes.get(e.id)?.laneIndex).sort()
    expect(laneIndexes).toEqual([0, 1, 2])
    for (const e of edges) {
      expect(lanes.get(e.id)?.laneSize).toBe(3)
    }
  })

  it('mismo origen y destino (varias respuestas hacia el mismo nodo) también comparten grupo', () => {
    const edges = [edge('e1', 'a', 'z', 'resp-1'), edge('e2', 'a', 'z', 'resp-2')]
    const lanes = computeEdgeLanes(edges)
    expect(lanes.get('e1')?.laneSize).toBe(2)
    expect(lanes.get('e2')?.laneSize).toBe(2)
    expect(lanes.get('e1')?.laneIndex).not.toBe(lanes.get('e2')?.laneIndex)
  })

  it('destinos distintos NUNCA comparten grupo, aunque el origen sea el mismo', () => {
    const edges = [edge('e1', 'a', 'z1'), edge('e2', 'a', 'z2')]
    const lanes = computeEdgeLanes(edges)
    expect(lanes.get('e1')).toEqual({ laneIndex: 0, laneSize: 1 })
    expect(lanes.get('e2')).toEqual({ laneIndex: 0, laneSize: 1 })
  })

  it('el orden dentro de un grupo es determinista y no depende del orden de entrada', () => {
    const edgesInOrderA = [edge('e1', 'b', 'z'), edge('e2', 'a', 'z')]
    const edgesInOrderB = [edge('e2', 'a', 'z'), edge('e1', 'b', 'z')]

    const lanesA = computeEdgeLanes(edgesInOrderA)
    const lanesB = computeEdgeLanes(edgesInOrderB)

    expect(lanesA.get('e1')).toEqual(lanesB.get('e1'))
    expect(lanesA.get('e2')).toEqual(lanesB.get('e2'))
    // 'a' < 'b': el origen "a" debe ir siempre antes que "b".
    expect(lanesA.get('e2')?.laneIndex).toBe(0)
    expect(lanesA.get('e1')?.laneIndex).toBe(1)
  })
})
