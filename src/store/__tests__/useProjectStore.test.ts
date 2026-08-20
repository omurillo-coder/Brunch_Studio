import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCanRedo, useCanUndo, useSelectedNodeIds } from '../selectors'
import { resetProjectStore } from '../testHelpers'
import { useProjectStore } from '../useProjectStore'
import type { DecisionNode } from '../../domain'

function nodeIdOf(type: 'start' | 'content' | 'decision' | 'final'): string {
  const id = useProjectStore.getState().project.graph.nodes.find((n) => n.type === type)?.id
  if (!id) throw new Error(`No hay nodo de tipo ${type} en el store`)
  return id
}

beforeEach(() => {
  resetProjectStore()
})

describe('acciones de dominio: una entrada de historial por acción', () => {
  it('createNode produce una entrada deshacible/rehacible', () => {
    const before = useProjectStore.getState().project.graph.nodes.length

    useProjectStore.getState().createNode('content', { x: 10, y: 20 })

    expect(useProjectStore.getState().project.graph.nodes.length).toBe(before + 1)
    expect(useProjectStore.getState().history.past.length).toBe(1)
    expect(useProjectStore.getState().history.future.length).toBe(0)

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project.graph.nodes.length).toBe(before)
    expect(useProjectStore.getState().history.past.length).toBe(0)
    expect(useProjectStore.getState().history.future.length).toBe(1)

    useProjectStore.getState().redo()
    expect(useProjectStore.getState().project.graph.nodes.length).toBe(before + 1)
    expect(useProjectStore.getState().history.past.length).toBe(1)
    expect(useProjectStore.getState().history.future.length).toBe(0)
  })

  it('deleteNode produce una entrada deshacible/rehacible', () => {
    useProjectStore.getState().createNode('final', { x: 50, y: 50 })
    const finalId = nodeIdOf('final')
    const afterCreateCount = useProjectStore.getState().project.graph.nodes.length

    useProjectStore.getState().deleteNode(finalId)
    expect(useProjectStore.getState().project.graph.nodes.length).toBe(afterCreateCount - 1)
    expect(useProjectStore.getState().history.past.length).toBe(2)

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project.graph.nodes.some((n) => n.id === finalId)).toBe(
      true,
    )

    useProjectStore.getState().redo()
    expect(useProjectStore.getState().project.graph.nodes.some((n) => n.id === finalId)).toBe(
      false,
    )
  })

  it('updateNode produce una entrada deshacible/rehacible', () => {
    const startId = nodeIdOf('start')

    useProjectStore.getState().updateNode(startId, { title: 'Inicio' })
    expect(useProjectStore.getState().history.past.length).toBe(1)
    const updated = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startId)
    expect(updated?.title).toBe('Inicio')

    useProjectStore.getState().undo()
    const reverted = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startId)
    expect(reverted?.title).toBe('')

    useProjectStore.getState().redo()
    const redone = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startId)
    expect(redone?.title).toBe('Inicio')
  })

  it('addResponse y removeResponse producen una entrada cada una', () => {
    useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
    const decisionId = nodeIdOf('decision')
    const historyAfterCreate = useProjectStore.getState().history.past.length

    useProjectStore.getState().addResponse(decisionId)
    expect(useProjectStore.getState().history.past.length).toBe(historyAfterCreate + 1)
    const decisionNode = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    expect(decisionNode.responses.length).toBe(1)
    const responseId = decisionNode.responses[0]?.id
    if (!responseId) throw new Error('responseId inesperadamente ausente')

    useProjectStore.getState().removeResponse(decisionId, responseId)
    expect(useProjectStore.getState().history.past.length).toBe(historyAfterCreate + 2)
    const afterRemove = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    expect(afterRemove.responses.length).toBe(0)

    useProjectStore.getState().undo() // deshace removeResponse
    const afterUndoRemove = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    expect(afterUndoRemove.responses.length).toBe(1)

    useProjectStore.getState().undo() // deshace addResponse
    const afterUndoAdd = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    expect(afterUndoAdd.responses.length).toBe(0)
  })

  it('connect y disconnect producen una entrada cada una', () => {
    useProjectStore.getState().createNode('content', { x: 100, y: 0 })
    const startId = nodeIdOf('start')
    const contentId = nodeIdOf('content')
    const historyAfterCreate = useProjectStore.getState().history.past.length

    useProjectStore.getState().connect(startId, contentId)
    expect(useProjectStore.getState().history.past.length).toBe(historyAfterCreate + 1)
    let start = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startId)
    expect(start?.type === 'start' ? start.targetNodeId : undefined).toBe(contentId)

    useProjectStore.getState().disconnect(startId)
    expect(useProjectStore.getState().history.past.length).toBe(historyAfterCreate + 2)
    start = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startId)
    expect(start?.type === 'start' ? start.targetNodeId : 'missing').toBeUndefined()

    useProjectStore.getState().undo() // deshace disconnect
    start = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startId)
    expect(start?.type === 'start' ? start.targetNodeId : undefined).toBe(contentId)

    useProjectStore.getState().undo() // deshace connect
    start = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startId)
    expect(start?.type === 'start' ? start.targetNodeId : 'missing').toBeUndefined()
  })
})

describe('drag de nodos', () => {
  it('begin -> varios update -> end produce UNA sola entrada de historial y undo vuelve al origen', () => {
    const startId = nodeIdOf('start')
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().beginNodeDrag(startId)
    useProjectStore.getState().updateNodeDragPosition(startId, { x: 10, y: 10 })
    useProjectStore.getState().updateNodeDragPosition(startId, { x: 55, y: 5 })
    useProjectStore.getState().updateNodeDragPosition(startId, { x: 123, y: 456 })
    useProjectStore.getState().endNodeDrag()

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const node = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startId)
    expect(node?.position).toEqual({ x: 123, y: 456 })

    useProjectStore.getState().undo()
    const reverted = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startId)
    expect(reverted?.position).toEqual({ x: 0, y: 0 })
  })

  it('un drag que termina en la posición de origen no genera ninguna entrada', () => {
    const startId = nodeIdOf('start')
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().beginNodeDrag(startId)
    useProjectStore.getState().updateNodeDragPosition(startId, { x: 999, y: 999 })
    useProjectStore.getState().updateNodeDragPosition(startId, { x: 0, y: 0 }) // vuelve al origen
    useProjectStore.getState().endNodeDrag()

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)
    expect(useProjectStore.getState().drag).toBeNull()
  })

  it('begin seguido de end sin ningún update no genera ninguna entrada', () => {
    const startId = nodeIdOf('start')
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().beginNodeDrag(startId)
    useProjectStore.getState().endNodeDrag()

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)
    expect(useProjectStore.getState().drag).toBeNull()
  })
})

describe('eliminar nodo con referencias entrantes', () => {
  it('undo tras deleteNode restaura el nodo y las referencias que apuntaban a él en una sola operación', () => {
    useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
    const decisionId = nodeIdOf('decision')
    useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    const finalId = nodeIdOf('final')

    useProjectStore.getState().addResponse(decisionId)
    const responseId = (
      useProjectStore.getState().project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    ).responses[0]?.id
    if (!responseId) throw new Error('responseId inesperadamente ausente')

    useProjectStore.getState().connect(decisionId, finalId, responseId)

    const historyBeforeDelete = useProjectStore.getState().history.past.length
    useProjectStore.getState().deleteNode(finalId)

    expect(useProjectStore.getState().history.past.length).toBe(historyBeforeDelete + 1)
    expect(useProjectStore.getState().project.graph.nodes.some((n) => n.id === finalId)).toBe(
      false,
    )
    const decisionAfterDelete = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    expect(decisionAfterDelete.responses[0]?.targetNodeId).toBeUndefined()

    useProjectStore.getState().undo()

    expect(useProjectStore.getState().project.graph.nodes.some((n) => n.id === finalId)).toBe(
      true,
    )
    const decisionAfterUndo = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    expect(decisionAfterUndo.responses[0]?.targetNodeId).toBe(finalId)
  })
})

describe('setViewport', () => {
  it('no crea entrada de historial', () => {
    const historyBefore = useProjectStore.getState().history.past.length
    useProjectStore.getState().setViewport({ x: 5, y: 5, zoom: 2 })
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)
    expect(useProjectStore.getState().project.editor.viewport).toEqual({ x: 5, y: 5, zoom: 2 })
  })

  it('no se ve afectado por undo/redo de una acción de dominio anterior', () => {
    useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    useProjectStore.getState().setViewport({ x: 42, y: 7, zoom: 1.5 })

    useProjectStore.getState().undo() // deshace createNode
    expect(useProjectStore.getState().project.editor.viewport).toEqual({
      x: 42,
      y: 7,
      zoom: 1.5,
    })

    useProjectStore.getState().redo() // rehace createNode
    expect(useProjectStore.getState().project.editor.viewport).toEqual({
      x: 42,
      y: 7,
      zoom: 1.5,
    })
  })
})

describe('loadProject', () => {
  it('resetea las pilas de historial y el estado transitorio', () => {
    useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    const finalId = nodeIdOf('final')
    useProjectStore.getState().selectNode(finalId)
    useProjectStore.getState().setHover(finalId)
    useProjectStore.getState().openContextMenu({ position: { x: 1, y: 1 }, originNodeId: finalId })
    useProjectStore.getState().undo()
    expect(useProjectStore.getState().history.future.length).toBe(1)

    const fresh = useProjectStore.getState().project
    useProjectStore.getState().loadProject(fresh)

    expect(useProjectStore.getState().history.past.length).toBe(0)
    expect(useProjectStore.getState().history.future.length).toBe(0)
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([])
    expect(useProjectStore.getState().ui.hoveredNodeId).toBeNull()
    expect(useProjectStore.getState().ui.contextMenu.open).toBe(false)
    expect(useProjectStore.getState().project).toBe(fresh)
  })
})

describe('la selección vive en un slice separado del documento', () => {
  it('undo/redo de acciones de documento no altera la selección', () => {
    useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    const finalId = nodeIdOf('final')
    useProjectStore.getState().selectNode(finalId)

    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([finalId])

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([finalId])

    useProjectStore.getState().redo()
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([finalId])
  })
})

describe('undo/redo en los límites', () => {
  it('con las pilas vacías, canUndo/canRedo son false y undo()/redo() no lanzan', () => {
    expect(useProjectStore.getState().history.past.length).toBe(0)
    expect(useProjectStore.getState().history.future.length).toBe(0)

    expect(() => useProjectStore.getState().undo()).not.toThrow()
    expect(() => useProjectStore.getState().redo()).not.toThrow()

    expect(useProjectStore.getState().history.past.length).toBe(0)
    expect(useProjectStore.getState().history.future.length).toBe(0)
  })
})

describe('selectores/hooks de conveniencia', () => {
  it('useCanUndo/useCanRedo reflejan las pilas de historial en tiempo real', () => {
    const canUndo = renderHook(() => useCanUndo())
    const canRedo = renderHook(() => useCanRedo())

    expect(canUndo.result.current).toBe(false)
    expect(canRedo.result.current).toBe(false)

    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    })
    expect(canUndo.result.current).toBe(true)
    expect(canRedo.result.current).toBe(false)

    act(() => {
      useProjectStore.getState().undo()
    })
    expect(canUndo.result.current).toBe(false)
    expect(canRedo.result.current).toBe(true)
  })

  it('useSelectedNodeIds refleja el slice de selección, separado del documento', () => {
    const selected = renderHook(() => useSelectedNodeIds())
    expect(selected.result.current).toEqual([])

    let finalId = ''
    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
      finalId = nodeIdOf('final')
      useProjectStore.getState().selectNode(finalId)
    })

    expect(selected.result.current).toEqual([finalId])

    act(() => {
      useProjectStore.getState().undo()
    })
    expect(selected.result.current).toEqual([finalId])
  })
})
