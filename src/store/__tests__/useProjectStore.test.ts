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

  it('updateNode propaga imageAssetId/audioAssetId de un nodo content (fijar y borrar con null)', () => {
    useProjectStore.getState().createNode('content', { x: 0, y: 0 })
    const contentId = nodeIdOf('content')

    useProjectStore.getState().updateNode(contentId, {
      imageAssetId: 'asset-imagen-1',
      audioAssetId: 'asset-audio-1',
    })
    const withMedia = useProjectStore.getState().project.graph.nodes.find((n) => n.id === contentId)
    expect(withMedia?.type === 'content' && withMedia.imageAssetId).toBe('asset-imagen-1')
    expect(withMedia?.type === 'content' && withMedia.audioAssetId).toBe('asset-audio-1')

    useProjectStore.getState().updateNode(contentId, { imageAssetId: null })
    const afterClearImage = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === contentId)
    expect(afterClearImage?.type === 'content' && afterClearImage.imageAssetId).toBeUndefined()
    expect(afterClearImage?.type === 'content' && afterClearImage.audioAssetId).toBe('asset-audio-1')
  })

  it('updateResponse propaga points/imageAssetId/audioAssetId de una respuesta (fijar y borrar con null)', () => {
    useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
    const decisionId = nodeIdOf('decision')
    const decisionNode = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    const responseId = decisionNode.responses[0]?.id
    if (!responseId) throw new Error('responseId inesperadamente ausente')

    useProjectStore.getState().updateResponse(decisionId, responseId, {
      points: 10,
      imageAssetId: 'asset-imagen-2',
      audioAssetId: 'asset-audio-2',
    })
    const withMedia = (
      useProjectStore.getState().project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    ).responses.find((r) => r.id === responseId)
    expect(withMedia?.points).toBe(10)
    expect(withMedia?.imageAssetId).toBe('asset-imagen-2')
    expect(withMedia?.audioAssetId).toBe('asset-audio-2')

    useProjectStore.getState().updateResponse(decisionId, responseId, {
      points: null,
      audioAssetId: null,
    })
    const afterClear = (
      useProjectStore.getState().project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    ).responses.find((r) => r.id === responseId)
    expect(afterClear?.points).toBeUndefined()
    expect(afterClear?.audioAssetId).toBeUndefined()
    // imageAssetId no estaba en el segundo patch (undefined = no tocar): sigue fijado.
    expect(afterClear?.imageAssetId).toBe('asset-imagen-2')
  })

  it('addResponse y removeResponse producen una entrada cada una', () => {
    useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
    const decisionId = nodeIdOf('decision')
    const historyAfterCreate = useProjectStore.getState().history.past.length
    // `createNode` ya deja el decision con A y B (ver fix del dominio).
    const initialCount = (
      useProjectStore.getState().project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    ).responses.length

    useProjectStore.getState().addResponse(decisionId)
    expect(useProjectStore.getState().history.past.length).toBe(historyAfterCreate + 1)
    const decisionNode = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    expect(decisionNode.responses.length).toBe(initialCount + 1)
    const responseId = decisionNode.responses[decisionNode.responses.length - 1]?.id
    if (!responseId) throw new Error('responseId inesperadamente ausente')

    useProjectStore.getState().removeResponse(decisionId, responseId)
    expect(useProjectStore.getState().history.past.length).toBe(historyAfterCreate + 2)
    const afterRemove = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    expect(afterRemove.responses.length).toBe(initialCount)

    useProjectStore.getState().undo() // deshace removeResponse
    const afterUndoRemove = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    expect(afterUndoRemove.responses.length).toBe(initialCount + 1)

    useProjectStore.getState().undo() // deshace addResponse
    const afterUndoAdd = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    expect(afterUndoAdd.responses.length).toBe(initialCount)
  })

  it('updateResponse produce una entrada deshacible/rehacible', () => {
    useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
    const decisionId = nodeIdOf('decision')
    const decisionNode = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    const responseId = decisionNode.responses[0]?.id
    if (!responseId) throw new Error('responseId inesperadamente ausente')
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().updateResponse(decisionId, responseId, { text: 'Sí' })
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const updated = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    expect(updated.responses.find((r) => r.id === responseId)?.text).toBe('Sí')

    useProjectStore.getState().undo()
    const reverted = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    expect(reverted.responses.find((r) => r.id === responseId)?.text).toBe('')

    useProjectStore.getState().redo()
    const redone = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    expect(redone.responses.find((r) => r.id === responseId)?.text).toBe('Sí')
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

    useProjectStore.getState().beginNodeDrag([startId])
    useProjectStore.getState().updateNodeDragPosition([{ nodeId: startId, position: { x: 10, y: 10 } }])
    useProjectStore.getState().updateNodeDragPosition([{ nodeId: startId, position: { x: 55, y: 5 } }])
    useProjectStore.getState().updateNodeDragPosition([{ nodeId: startId, position: { x: 123, y: 456 } }])
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

    useProjectStore.getState().beginNodeDrag([startId])
    useProjectStore.getState().updateNodeDragPosition([{ nodeId: startId, position: { x: 999, y: 999 } }])
    useProjectStore.getState().updateNodeDragPosition([{ nodeId: startId, position: { x: 0, y: 0 } }]) // vuelve al origen
    useProjectStore.getState().endNodeDrag()

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)
    expect(useProjectStore.getState().drag).toBeNull()
  })

  it('begin seguido de end sin ningún update no genera ninguna entrada', () => {
    const startId = nodeIdOf('start')
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().beginNodeDrag([startId])
    useProjectStore.getState().endNodeDrag()

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)
    expect(useProjectStore.getState().drag).toBeNull()
  })

  it('arrastrar varios nodos a la vez produce UNA sola entrada y undo devuelve a TODOS a su posición previa', () => {
    useProjectStore.getState().createNode('content', { x: 100, y: 0 })
    useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    const startId = nodeIdOf('start')
    const contentId = nodeIdOf('content')
    const finalId = nodeIdOf('final')
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().beginNodeDrag([startId, contentId, finalId])
    useProjectStore.getState().updateNodeDragPosition([
      { nodeId: startId, position: { x: 10, y: 10 } },
      { nodeId: contentId, position: { x: 110, y: 10 } },
      { nodeId: finalId, position: { x: 210, y: 10 } },
    ])
    useProjectStore.getState().updateNodeDragPosition([
      { nodeId: startId, position: { x: 50, y: 50 } },
      { nodeId: contentId, position: { x: 150, y: 50 } },
      { nodeId: finalId, position: { x: 250, y: 50 } },
    ])
    useProjectStore.getState().endNodeDrag()

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const nodes = useProjectStore.getState().project.graph.nodes
    expect(nodes.find((n) => n.id === startId)?.position).toEqual({ x: 50, y: 50 })
    expect(nodes.find((n) => n.id === contentId)?.position).toEqual({ x: 150, y: 50 })
    expect(nodes.find((n) => n.id === finalId)?.position).toEqual({ x: 250, y: 50 })

    useProjectStore.getState().undo()
    const reverted = useProjectStore.getState().project.graph.nodes
    expect(reverted.find((n) => n.id === startId)?.position).toEqual({ x: 0, y: 0 })
    expect(reverted.find((n) => n.id === contentId)?.position).toEqual({ x: 100, y: 0 })
    expect(reverted.find((n) => n.id === finalId)?.position).toEqual({ x: 200, y: 0 })
  })

  it('arrastrar varios nodos donde solo alguno cambia de posición sigue produciendo una sola entrada, solo con los cambiados', () => {
    useProjectStore.getState().createNode('content', { x: 100, y: 0 })
    const startId = nodeIdOf('start')
    const contentId = nodeIdOf('content')
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().beginNodeDrag([startId, contentId])
    // Solo se mueve `contentId`; `startId` vuelve/se queda en su origen.
    useProjectStore.getState().updateNodeDragPosition([
      { nodeId: startId, position: { x: 0, y: 0 } },
      { nodeId: contentId, position: { x: 300, y: 300 } },
    ])
    useProjectStore.getState().endNodeDrag()

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const nodes = useProjectStore.getState().project.graph.nodes
    expect(nodes.find((n) => n.id === startId)?.position).toEqual({ x: 0, y: 0 })
    expect(nodes.find((n) => n.id === contentId)?.position).toEqual({ x: 300, y: 300 })
  })
})

describe('deleteNode: higiene de selección y guarda del nodo start', () => {
  it('borrar el nodo seleccionado lo quita de selection.selectedNodeIds', () => {
    useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    const finalId = nodeIdOf('final')
    useProjectStore.getState().selectNode(finalId)
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([finalId])

    useProjectStore.getState().deleteNode(finalId)

    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([])
  })

  it('borrar un nodo no seleccionado no toca la selección actual', () => {
    useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    useProjectStore.getState().createNode('content', { x: 0, y: 0 })
    const finalId = nodeIdOf('final')
    const contentId = nodeIdOf('content')
    useProjectStore.getState().selectNode(contentId)

    useProjectStore.getState().deleteNode(finalId)

    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([contentId])
  })

  it('lanza al intentar borrar el nodo start, sin mutar el proyecto ni la selección', () => {
    const startId = nodeIdOf('start')
    useProjectStore.getState().selectNode(startId)
    const projectBefore = useProjectStore.getState().project

    expect(() => useProjectStore.getState().deleteNode(startId)).toThrow()

    expect(useProjectStore.getState().project).toBe(projectBefore)
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([startId])
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

describe('focusNode / clearFocusRequest (fase 5: comunicación LeftPanel → lienzo)', () => {
  it('focusNode selecciona el nodo y fija ui.focusRequestNodeId', () => {
    useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    const finalId = nodeIdOf('final')

    useProjectStore.getState().focusNode(finalId)

    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([finalId])
    expect(useProjectStore.getState().ui.focusRequestNodeId).toBe(finalId)
  })

  it('clearFocusRequest limpia la petición sin tocar la selección', () => {
    useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    const finalId = nodeIdOf('final')
    useProjectStore.getState().focusNode(finalId)

    useProjectStore.getState().clearFocusRequest()

    expect(useProjectStore.getState().ui.focusRequestNodeId).toBeNull()
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([finalId])
  })

  it('loadProject también resetea ui.focusRequestNodeId', () => {
    useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    const finalId = nodeIdOf('final')
    useProjectStore.getState().focusNode(finalId)

    const fresh = useProjectStore.getState().project
    useProjectStore.getState().loadProject(fresh)

    expect(useProjectStore.getState().ui.focusRequestNodeId).toBeNull()
  })
})

describe('createConnectedNodeFromMenu (fase 7: menú "¿Qué quieres añadir?")', () => {
  it('crea, conecta, selecciona el nodo nuevo, pide foco de título y cierra el menú — todo en una única llamada', () => {
    const startId = nodeIdOf('start')
    useProjectStore.getState().openContextMenu({
      position: { x: 100, y: 200 },
      originNodeId: startId,
    })
    const idsBefore = new Set(useProjectStore.getState().project.graph.nodes.map((n) => n.id))
    const nodesBefore = idsBefore.size
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().createConnectedNodeFromMenu('content', { x: 300, y: 40 })

    const state = useProjectStore.getState()
    expect(state.project.graph.nodes.length).toBe(nodesBefore + 1)
    expect(state.history.past.length).toBe(historyBefore + 1)

    const created = state.project.graph.nodes.find((node) => !idsBefore.has(node.id))
    if (!created) throw new Error('no se encontró el nodo creado')

    expect(created.type).toBe('content')
    expect(created.position).toEqual({ x: 300, y: 40 })

    const start = state.project.graph.nodes.find((n) => n.id === startId)
    expect(start?.type === 'start' ? start.targetNodeId : undefined).toBe(created.id)

    expect(state.selection.selectedNodeIds).toEqual([created.id])
    expect(state.ui.titleFocusRequestNodeId).toBe(created.id)
    expect(state.ui.contextMenu.open).toBe(false)
  })

  it('produce exactamente una entrada de historial deshacible/rehacible', () => {
    const startId = nodeIdOf('start')
    useProjectStore.getState().openContextMenu({ position: { x: 0, y: 0 }, originNodeId: startId })

    const historyBefore = useProjectStore.getState().history.past.length
    useProjectStore.getState().createConnectedNodeFromMenu('final', { x: 0, y: 0 })
    const nodesAfterCreate = useProjectStore.getState().project.graph.nodes.length

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project.graph.nodes.length).toBe(nodesAfterCreate - 1)

    useProjectStore.getState().redo()
    expect(useProjectStore.getState().project.graph.nodes.length).toBe(nodesAfterCreate)
  })

  it('deriva el responseId de origen desde ui.contextMenu.originResponseId (nodo decision)', () => {
    useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
    const decisionId = nodeIdOf('decision')
    const decision = useProjectStore.getState().project.graph.nodes.find(
      (n) => n.id === decisionId,
    ) as DecisionNode
    const responseId = decision.responses[0]?.id
    if (!responseId) throw new Error('setup inválido')

    useProjectStore.getState().openContextMenu({
      position: { x: 0, y: 0 },
      originNodeId: decisionId,
      originResponseId: responseId,
    })

    useProjectStore.getState().createConnectedNodeFromMenu('final', { x: 0, y: 0 })

    const decisionAfter = useProjectStore.getState().project.graph.nodes.find(
      (n) => n.id === decisionId,
    ) as DecisionNode
    const response = decisionAfter.responses.find((r) => r.id === responseId)
    expect(response?.targetNodeId).toBeDefined()
  })

  it('no hace nada si el menú no está abierto', () => {
    const before = useProjectStore.getState().project

    useProjectStore.getState().createConnectedNodeFromMenu('final', { x: 0, y: 0 })

    expect(useProjectStore.getState().project).toBe(before)
    expect(useProjectStore.getState().history.past.length).toBe(0)
  })
})

describe('clearTitleFocusRequest', () => {
  it('limpia ui.titleFocusRequestNodeId sin tocar la selección', () => {
    const startId = nodeIdOf('start')
    useProjectStore.getState().openContextMenu({ position: { x: 0, y: 0 }, originNodeId: startId })
    useProjectStore.getState().createConnectedNodeFromMenu('final', { x: 0, y: 0 })
    expect(useProjectStore.getState().ui.titleFocusRequestNodeId).not.toBeNull()
    const selectedBefore = useProjectStore.getState().selection.selectedNodeIds

    useProjectStore.getState().clearTitleFocusRequest()

    expect(useProjectStore.getState().ui.titleFocusRequestNodeId).toBeNull()
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual(selectedBefore)
  })

  it('loadProject también resetea ui.titleFocusRequestNodeId', () => {
    const startId = nodeIdOf('start')
    useProjectStore.getState().openContextMenu({ position: { x: 0, y: 0 }, originNodeId: startId })
    useProjectStore.getState().createConnectedNodeFromMenu('final', { x: 0, y: 0 })

    const fresh = useProjectStore.getState().project
    useProjectStore.getState().loadProject(fresh)

    expect(useProjectStore.getState().ui.titleFocusRequestNodeId).toBeNull()
  })
})
