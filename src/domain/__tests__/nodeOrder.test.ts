import { describe, expect, it } from 'vitest'
import { createProject, createNode } from '../project'
import { reorderNode } from '../nodeOrder'

/** Proyecto con tres nodos (la diapositiva de inicio + dos más), para tener
 *  margen de sobra para reordenar. Devuelve los tres ids en el orden en el
 *  que nacen (inicio, slide, final). */
function threeNodeProject() {
  const base = createProject('P')
  const startId = base.graph.startNodeId
  const withSlide = createNode(base, 'slide', { x: 0, y: 0 })
  const slideId = withSlide.graph.nodes.find((n) => n.id !== startId)?.id
  if (!slideId) throw new Error('setup inválido')
  const withFinal = createNode(withSlide, 'final', { x: 0, y: 0 })
  const finalId = withFinal.graph.nodes.find((n) => n.id !== startId && n.id !== slideId)?.id
  if (!finalId) throw new Error('setup inválido')
  return { project: withFinal, startId, slideId, finalId }
}

describe('reorderNode', () => {
  it('mueve un nodo a una posición válida', () => {
    const { project, startId, slideId, finalId } = threeNodeProject()
    expect(project.graph.nodes.map((n) => n.id)).toEqual([startId, slideId, finalId])

    const updated = reorderNode(project, finalId, 0)

    expect(updated.graph.nodes.map((n) => n.id)).toEqual([finalId, startId, slideId])
    // Inmutabilidad: el proyecto original no se toca.
    expect(project.graph.nodes.map((n) => n.id)).toEqual([startId, slideId, finalId])
  })

  it('recorta toIndex fuera de rango sin lanzar', () => {
    const { project, startId, slideId, finalId } = threeNodeProject()

    const movedPastEnd = reorderNode(project, startId, 999)
    expect(movedPastEnd.graph.nodes.map((n) => n.id)).toEqual([slideId, finalId, startId])

    const movedBeforeStart = reorderNode(project, finalId, -50)
    expect(movedBeforeStart.graph.nodes.map((n) => n.id)).toEqual([finalId, startId, slideId])
  })

  it('lanza si el id no existe', () => {
    const { project } = threeNodeProject()
    expect(() => reorderNode(project, 'no-existe', 0)).toThrow()
  })

  it('no toca number ni ningún otro campo de ningún nodo', () => {
    const { project, startId, slideId, finalId } = threeNodeProject()
    const numbersBefore = new Map(project.graph.nodes.map((n) => [n.id, n.number]))

    const updated = reorderNode(project, finalId, 0)

    for (const node of updated.graph.nodes) {
      expect(node.number).toBe(numbersBefore.get(node.id))
    }
    // El resto de campos de cada nodo permanece intacto (comparación
    // profunda, ignorando el orden del array).
    const byId = (doc: typeof project) => new Map(doc.graph.nodes.map((n) => [n.id, n]))
    const before = byId(project)
    const after = byId(updated)
    for (const id of [startId, slideId, finalId]) {
      expect(after.get(id)).toEqual(before.get(id))
    }
  })

  it('mover un nodo a su propio índice actual es un no-op de orden', () => {
    const { project, startId, slideId, finalId } = threeNodeProject()
    const updated = reorderNode(project, slideId, 1)
    expect(updated.graph.nodes.map((n) => n.id)).toEqual([startId, slideId, finalId])
  })
})
