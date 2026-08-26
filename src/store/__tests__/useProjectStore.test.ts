import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCanRedo, useCanUndo, useSelectedNodeIds } from '../selectors'
import { resetProjectStore } from '../testHelpers'
import { useProjectStore } from '../useProjectStore'
import type { SlideNode } from '../../domain'

/** Id de la diapositiva de inicio del proyecto actual del store. */
function startNodeId(): string {
  return useProjectStore.getState().project.graph.startNodeId
}

/** Primer nodo del tipo pedido que NO sea la diapositiva de inicio. */
function nodeIdOf(type: 'slide' | 'final'): string {
  const { project } = useProjectStore.getState()
  const id = project.graph.nodes.find(
    (n) => n.type === type && n.id !== project.graph.startNodeId,
  )?.id
  if (!id) throw new Error(`No hay nodo "${type}" distinto del inicio en el store`)
  return id
}

/** Lee un nodo del store asumiendo que es una diapositiva (lanza si no). */
function slideNode(nodeId: string): SlideNode {
  const node = useProjectStore.getState().project.graph.nodes.find((n) => n.id === nodeId)
  if (!node || node.type !== 'slide') throw new Error(`El nodo "${nodeId}" no es una diapositiva`)
  return node
}

/** Añade una respuesta a una diapositiva y devuelve su id. */
function addResponseTo(nodeId: string): string {
  useProjectStore.getState().addResponse(nodeId)
  const responses = slideNode(nodeId).responses
  const id = responses[responses.length - 1]?.id
  if (!id) throw new Error('responseId inesperadamente ausente')
  return id
}

beforeEach(() => {
  resetProjectStore()
})

describe('acciones de dominio: una entrada de historial por acción', () => {
  it('createNode produce una entrada deshacible/rehacible', () => {
    const before = useProjectStore.getState().project.graph.nodes.length

    useProjectStore.getState().createNode('slide', { x: 10, y: 20 })

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
    const startId = startNodeId()

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

  it('updateNode propaga continueLabel (fijar y borrar con null)', () => {
    const startId = startNodeId()

    useProjectStore.getState().updateNode(startId, { continueLabel: 'Siguiente' })
    expect(slideNode(startId).continueLabel).toBe('Siguiente')

    useProjectStore.getState().updateNode(startId, { continueLabel: null })
    expect(slideNode(startId).continueLabel).toBeUndefined()
  })

  it('updateResponse propaga points/imageAssetId/audioAssetId de una respuesta (fijar y borrar con null)', () => {
    const startId = startNodeId()
    const responseId = addResponseTo(startId)

    useProjectStore.getState().updateResponse(startId, responseId, {
      points: 10,
      imageAssetId: 'asset-imagen-2',
      audioAssetId: 'asset-audio-2',
    })
    const withMedia = slideNode(startId).responses.find((r) => r.id === responseId)
    expect(withMedia?.points).toBe(10)
    expect(withMedia?.imageAssetId).toBe('asset-imagen-2')
    expect(withMedia?.audioAssetId).toBe('asset-audio-2')

    useProjectStore.getState().updateResponse(startId, responseId, {
      points: null,
      audioAssetId: null,
    })
    const afterClear = slideNode(startId).responses.find((r) => r.id === responseId)
    expect(afterClear?.points).toBeUndefined()
    expect(afterClear?.audioAssetId).toBeUndefined()
    // imageAssetId no estaba en el segundo patch (undefined = no tocar): sigue fijado.
    expect(afterClear?.imageAssetId).toBe('asset-imagen-2')
  })

  it('addResponse y removeResponse producen una entrada cada una', () => {
    const startId = startNodeId()
    const historyBefore = useProjectStore.getState().history.past.length

    const responseId = addResponseTo(startId)
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    expect(slideNode(startId).responses.length).toBe(1)

    useProjectStore.getState().removeResponse(startId, responseId)
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 2)
    expect(slideNode(startId).responses.length).toBe(0)

    useProjectStore.getState().undo() // deshace removeResponse
    expect(slideNode(startId).responses.length).toBe(1)

    useProjectStore.getState().undo() // deshace addResponse
    expect(slideNode(startId).responses.length).toBe(0)
  })

  it('updateResponse produce una entrada deshacible/rehacible', () => {
    const startId = startNodeId()
    const responseId = addResponseTo(startId)
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().updateResponse(startId, responseId, { text: 'Sí' })
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    expect(slideNode(startId).responses.find((r) => r.id === responseId)?.text).toBe('Sí')

    useProjectStore.getState().undo()
    expect(slideNode(startId).responses.find((r) => r.id === responseId)?.text).toBe('')

    useProjectStore.getState().redo()
    expect(slideNode(startId).responses.find((r) => r.id === responseId)?.text).toBe('Sí')
  })

  it('connect y disconnect producen una entrada cada una', () => {
    useProjectStore.getState().createNode('slide', { x: 100, y: 0 })
    const startId = startNodeId()
    const slideId = nodeIdOf('slide')
    const historyAfterCreate = useProjectStore.getState().history.past.length

    useProjectStore.getState().connect(startId, slideId)
    expect(useProjectStore.getState().history.past.length).toBe(historyAfterCreate + 1)
    expect(slideNode(startId).targetNodeId).toBe(slideId)

    useProjectStore.getState().disconnect(startId)
    expect(useProjectStore.getState().history.past.length).toBe(historyAfterCreate + 2)
    expect(slideNode(startId).targetNodeId).toBeUndefined()

    useProjectStore.getState().undo() // deshace disconnect
    expect(slideNode(startId).targetNodeId).toBe(slideId)

    useProjectStore.getState().undo() // deshace connect
    expect(slideNode(startId).targetNodeId).toBeUndefined()
  })

  it('addVariable produce una entrada deshacible/rehacible', () => {
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().addVariable({ name: 'puntos', type: 'number', initialValue: 0 })
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    expect(useProjectStore.getState().project.variables).toHaveLength(1)

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project.variables).toHaveLength(0)

    useProjectStore.getState().redo()
    expect(useProjectStore.getState().project.variables).toHaveLength(1)
  })

  it('updateVariable produce una entrada deshacible/rehacible', () => {
    useProjectStore.getState().addVariable({ name: 'puntos', type: 'number', initialValue: 0 })
    const variableId = useProjectStore.getState().project.variables[0]?.id
    if (!variableId) throw new Error('setup inválido')
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().updateVariable(variableId, { initialValue: 42 })
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    expect(useProjectStore.getState().project.variables[0]?.initialValue).toBe(42)

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project.variables[0]?.initialValue).toBe(0)

    useProjectStore.getState().redo()
    expect(useProjectStore.getState().project.variables[0]?.initialValue).toBe(42)
  })

  it('deleteVariable produce una entrada deshacible/rehacible', () => {
    useProjectStore.getState().addVariable({ name: 'puntos', type: 'number', initialValue: 0 })
    const variableId = useProjectStore.getState().project.variables[0]?.id
    if (!variableId) throw new Error('setup inválido')
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().deleteVariable(variableId)
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    expect(useProjectStore.getState().project.variables).toHaveLength(0)

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project.variables).toHaveLength(1)

    useProjectStore.getState().redo()
    expect(useProjectStore.getState().project.variables).toHaveLength(0)
  })

  it('duplicateNode produce una entrada deshacible/rehacible y selecciona la copia', () => {
    const startId = startNodeId()
    const before = useProjectStore.getState().project.graph.nodes.length
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().duplicateNode(startId)

    expect(useProjectStore.getState().project.graph.nodes.length).toBe(before + 1)
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    expect(useProjectStore.getState().history.future.length).toBe(0)

    const selected = useProjectStore.getState().selection.selectedNodeIds
    expect(selected).toHaveLength(1)
    expect(selected[0]).not.toBe(startId)
    const copyId = selected[0]
    if (!copyId) throw new Error('setup inválido')
    const copy = useProjectStore.getState().project.graph.nodes.find((n) => n.id === copyId)
    expect(copy).toBeDefined()
    // Offset pequeño respecto al original, no exactamente encima.
    expect(copy?.position).not.toEqual({ x: 0, y: 0 })

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project.graph.nodes.length).toBe(before)
    expect(useProjectStore.getState().project.graph.nodes.some((n) => n.id === copyId)).toBe(false)

    useProjectStore.getState().redo()
    expect(useProjectStore.getState().project.graph.nodes.length).toBe(before + 1)
    expect(useProjectStore.getState().project.graph.nodes.some((n) => n.id === copyId)).toBe(true)
  })
})

describe('bloques de contenido de una diapositiva (milestone "Bloques de contenido", fase 2)', () => {
  it('addTextBlock produce una entrada deshacible/rehacible', () => {
    const startId = startNodeId()
    const before = slideNode(startId).content.length
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().addTextBlock(startId)

    expect(slideNode(startId).content).toHaveLength(before + 1)
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)

    useProjectStore.getState().undo()
    expect(slideNode(startId).content).toHaveLength(before)

    useProjectStore.getState().redo()
    expect(slideNode(startId).content).toHaveLength(before + 1)
  })

  it('addImageBlock/addAudioBlock producen una entrada deshacible/rehacible cada una', () => {
    const startId = startNodeId()
    const before = slideNode(startId).content.length
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().addImageBlock(startId, 'asset-imagen-1')
    expect(slideNode(startId).content).toHaveLength(before + 1)
    expect(slideNode(startId).content.at(-1)).toMatchObject({ type: 'image', assetId: 'asset-imagen-1' })
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)

    useProjectStore.getState().addAudioBlock(startId, 'asset-audio-1')
    expect(slideNode(startId).content).toHaveLength(before + 2)
    expect(slideNode(startId).content.at(-1)).toMatchObject({ type: 'audio', assetId: 'asset-audio-1' })
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 2)

    useProjectStore.getState().undo() // deshace addAudioBlock
    expect(slideNode(startId).content).toHaveLength(before + 1)

    useProjectStore.getState().undo() // deshace addImageBlock
    expect(slideNode(startId).content).toHaveLength(before)
  })

  it('updateTextBlockBody produce una entrada deshacible/rehacible', () => {
    const startId = startNodeId()
    const blockId = slideNode(startId).content[0]?.id
    if (!blockId) throw new Error('setup inválido')
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().updateTextBlockBody(startId, blockId, 'Hola')
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const block = slideNode(startId).content.find((b) => b.id === blockId)
    expect(block?.type === 'text' ? block.body : undefined).toBe('Hola')

    useProjectStore.getState().undo()
    const reverted = slideNode(startId).content.find((b) => b.id === blockId)
    expect(reverted?.type === 'text' ? reverted.body : undefined).toBe('')

    useProjectStore.getState().redo()
    const redone = slideNode(startId).content.find((b) => b.id === blockId)
    expect(redone?.type === 'text' ? redone.body : undefined).toBe('Hola')
  })

  it('removeContentBlock produce una entrada deshacible/rehacible', () => {
    const startId = startNodeId()
    useProjectStore.getState().addTextBlock(startId)
    const blockId = slideNode(startId).content[1]?.id
    if (!blockId) throw new Error('setup inválido')
    const before = slideNode(startId).content.length
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().removeContentBlock(startId, blockId)
    expect(slideNode(startId).content).toHaveLength(before - 1)
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)

    useProjectStore.getState().undo()
    expect(slideNode(startId).content).toHaveLength(before)
    expect(slideNode(startId).content.some((b) => b.id === blockId)).toBe(true)

    useProjectStore.getState().redo()
    expect(slideNode(startId).content).toHaveLength(before - 1)
  })

  it('moveContentBlock produce una entrada deshacible/rehacible', () => {
    const startId = startNodeId()
    useProjectStore.getState().addTextBlock(startId)
    const [firstId, secondId] = slideNode(startId).content.map((b) => b.id)
    if (!firstId || !secondId) throw new Error('setup inválido')
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().moveContentBlock(startId, secondId, 0)
    expect(slideNode(startId).content.map((b) => b.id)).toEqual([secondId, firstId])
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)

    useProjectStore.getState().undo()
    expect(slideNode(startId).content.map((b) => b.id)).toEqual([firstId, secondId])

    useProjectStore.getState().redo()
    expect(slideNode(startId).content.map((b) => b.id)).toEqual([secondId, firstId])
  })

  it('reorderNode produce una entrada deshacible/rehacible', () => {
    useProjectStore.getState().createNode('final', { x: 50, y: 50 })
    const finalId = nodeIdOf('final')
    const idsBefore = useProjectStore.getState().project.graph.nodes.map((n) => n.id)
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().reorderNode(finalId, 0)
    const idsAfter = useProjectStore.getState().project.graph.nodes.map((n) => n.id)
    expect(idsAfter[0]).toBe(finalId)
    expect(idsAfter).not.toEqual(idsBefore)
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project.graph.nodes.map((n) => n.id)).toEqual(idsBefore)

    useProjectStore.getState().redo()
    expect(useProjectStore.getState().project.graph.nodes.map((n) => n.id)).toEqual(idsAfter)
  })
})

describe('drag de nodos', () => {
  it('begin -> varios update -> end produce UNA sola entrada de historial y undo vuelve al origen', () => {
    const startId = startNodeId()
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
    const startId = startNodeId()
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().beginNodeDrag([startId])
    useProjectStore.getState().updateNodeDragPosition([{ nodeId: startId, position: { x: 999, y: 999 } }])
    useProjectStore.getState().updateNodeDragPosition([{ nodeId: startId, position: { x: 0, y: 0 } }]) // vuelve al origen
    useProjectStore.getState().endNodeDrag()

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)
    expect(useProjectStore.getState().drag).toBeNull()
  })

  it('begin seguido de end sin ningún update no genera ninguna entrada', () => {
    const startId = startNodeId()
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().beginNodeDrag([startId])
    useProjectStore.getState().endNodeDrag()

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)
    expect(useProjectStore.getState().drag).toBeNull()
  })

  it('arrastrar varios nodos a la vez produce UNA sola entrada y undo devuelve a TODOS a su posición previa', () => {
    useProjectStore.getState().createNode('slide', { x: 100, y: 0 })
    useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    const startId = startNodeId()
    const slideId = nodeIdOf('slide')
    const finalId = nodeIdOf('final')
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().beginNodeDrag([startId, slideId, finalId])
    useProjectStore.getState().updateNodeDragPosition([
      { nodeId: startId, position: { x: 10, y: 10 } },
      { nodeId: slideId, position: { x: 110, y: 10 } },
      { nodeId: finalId, position: { x: 210, y: 10 } },
    ])
    useProjectStore.getState().updateNodeDragPosition([
      { nodeId: startId, position: { x: 50, y: 50 } },
      { nodeId: slideId, position: { x: 150, y: 50 } },
      { nodeId: finalId, position: { x: 250, y: 50 } },
    ])
    useProjectStore.getState().endNodeDrag()

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const nodes = useProjectStore.getState().project.graph.nodes
    expect(nodes.find((n) => n.id === startId)?.position).toEqual({ x: 50, y: 50 })
    expect(nodes.find((n) => n.id === slideId)?.position).toEqual({ x: 150, y: 50 })
    expect(nodes.find((n) => n.id === finalId)?.position).toEqual({ x: 250, y: 50 })

    useProjectStore.getState().undo()
    const reverted = useProjectStore.getState().project.graph.nodes
    expect(reverted.find((n) => n.id === startId)?.position).toEqual({ x: 0, y: 0 })
    expect(reverted.find((n) => n.id === slideId)?.position).toEqual({ x: 100, y: 0 })
    expect(reverted.find((n) => n.id === finalId)?.position).toEqual({ x: 200, y: 0 })
  })

  it('arrastrar varios nodos donde solo alguno cambia de posición sigue produciendo una sola entrada, solo con los cambiados', () => {
    useProjectStore.getState().createNode('slide', { x: 100, y: 0 })
    const startId = startNodeId()
    const slideId = nodeIdOf('slide')
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().beginNodeDrag([startId, slideId])
    // Solo se mueve `slideId`; `startId` vuelve/se queda en su origen.
    useProjectStore.getState().updateNodeDragPosition([
      { nodeId: startId, position: { x: 0, y: 0 } },
      { nodeId: slideId, position: { x: 300, y: 300 } },
    ])
    useProjectStore.getState().endNodeDrag()

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const nodes = useProjectStore.getState().project.graph.nodes
    expect(nodes.find((n) => n.id === startId)?.position).toEqual({ x: 0, y: 0 })
    expect(nodes.find((n) => n.id === slideId)?.position).toEqual({ x: 300, y: 300 })
  })
})

describe('applyLayout (auto-layout del lienzo)', () => {
  it('produce exactamente una entrada de historial, sin fase de arrastre en caliente', () => {
    useProjectStore.getState().createNode('slide', { x: 100, y: 0 })
    useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    const startId = startNodeId()
    const slideId = nodeIdOf('slide')
    const finalId = nodeIdOf('final')
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().applyLayout([
      { nodeId: startId, position: { x: 0, y: 0 } },
      { nodeId: slideId, position: { x: 300, y: 0 } },
      { nodeId: finalId, position: { x: 600, y: 0 } },
    ])

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const nodes = useProjectStore.getState().project.graph.nodes
    expect(nodes.find((n) => n.id === startId)?.position).toEqual({ x: 0, y: 0 })
    expect(nodes.find((n) => n.id === slideId)?.position).toEqual({ x: 300, y: 0 })
    expect(nodes.find((n) => n.id === finalId)?.position).toEqual({ x: 600, y: 0 })
  })

  it('undo() devuelve todas las posiciones exactamente a como estaban antes, en un solo paso', () => {
    useProjectStore.getState().createNode('slide', { x: 100, y: 0 })
    useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    const startId = startNodeId()
    const slideId = nodeIdOf('slide')
    const finalId = nodeIdOf('final')

    const before = useProjectStore.getState().project.graph.nodes.map((n) => ({
      id: n.id,
      position: { ...n.position },
    }))

    useProjectStore.getState().applyLayout([
      { nodeId: startId, position: { x: 10, y: 20 } },
      { nodeId: slideId, position: { x: 310, y: 20 } },
      { nodeId: finalId, position: { x: 610, y: 20 } },
    ])

    useProjectStore.getState().undo()

    const after = useProjectStore.getState().project.graph.nodes
    for (const previous of before) {
      expect(after.find((n) => n.id === previous.id)?.position).toEqual(previous.position)
    }
  })

  it('con un array de movimientos vacío no genera ninguna entrada de historial', () => {
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().applyLayout([])

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)
  })
})

describe('deleteNode: higiene de selección y guarda de la diapositiva de inicio', () => {
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
    useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
    const finalId = nodeIdOf('final')
    const slideId = nodeIdOf('slide')
    useProjectStore.getState().selectNode(slideId)

    useProjectStore.getState().deleteNode(finalId)

    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([slideId])
  })

  it('lanza al intentar borrar la diapositiva de inicio, sin mutar el proyecto ni la selección', () => {
    const startId = startNodeId()
    useProjectStore.getState().selectNode(startId)
    const projectBefore = useProjectStore.getState().project

    expect(() => useProjectStore.getState().deleteNode(startId)).toThrow()

    expect(useProjectStore.getState().project).toBe(projectBefore)
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([startId])
  })
})

describe('eliminar nodo con referencias entrantes', () => {
  it('undo tras deleteNode restaura el nodo y las referencias que apuntaban a él en una sola operación', () => {
    const startId = startNodeId()
    useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    const finalId = nodeIdOf('final')

    const responseId = addResponseTo(startId)
    useProjectStore.getState().connect(startId, finalId, responseId)

    const historyBeforeDelete = useProjectStore.getState().history.past.length
    useProjectStore.getState().deleteNode(finalId)

    expect(useProjectStore.getState().history.past.length).toBe(historyBeforeDelete + 1)
    expect(useProjectStore.getState().project.graph.nodes.some((n) => n.id === finalId)).toBe(
      false,
    )
    expect(slideNode(startId).responses[0]?.targetNodeId).toBeUndefined()

    useProjectStore.getState().undo()

    expect(useProjectStore.getState().project.graph.nodes.some((n) => n.id === finalId)).toBe(
      true,
    )
    expect(slideNode(startId).responses[0]?.targetNodeId).toBe(finalId)
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

describe('focusNode / clearFocusRequest (comunicación LeftPanel → lienzo)', () => {
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

describe('createConnectedNodeFromMenu (menú "¿Qué quieres añadir?")', () => {
  it('crea, conecta, selecciona el nodo nuevo, pide foco de título y cierra el menú — todo en una única llamada', () => {
    const startId = startNodeId()
    useProjectStore.getState().openContextMenu({
      position: { x: 100, y: 200 },
      originNodeId: startId,
    })
    const idsBefore = new Set(useProjectStore.getState().project.graph.nodes.map((n) => n.id))
    const nodesBefore = idsBefore.size
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().createConnectedNodeFromMenu('slide', { x: 300, y: 40 })

    const state = useProjectStore.getState()
    expect(state.project.graph.nodes.length).toBe(nodesBefore + 1)
    expect(state.history.past.length).toBe(historyBefore + 1)

    const created = state.project.graph.nodes.find((node) => !idsBefore.has(node.id))
    if (!created) throw new Error('no se encontró el nodo creado')

    expect(created.type).toBe('slide')
    expect(created.position).toEqual({ x: 300, y: 40 })
    expect(slideNode(startId).targetNodeId).toBe(created.id)

    expect(state.selection.selectedNodeIds).toEqual([created.id])
    expect(state.ui.titleFocusRequestNodeId).toBe(created.id)
    expect(state.ui.contextMenu.open).toBe(false)
  })

  it('produce exactamente una entrada de historial deshacible/rehacible', () => {
    const startId = startNodeId()
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

  it('deriva el responseId de origen desde ui.contextMenu.originResponseId', () => {
    const startId = startNodeId()
    const responseId = addResponseTo(startId)

    useProjectStore.getState().openContextMenu({
      position: { x: 0, y: 0 },
      originNodeId: startId,
      originResponseId: responseId,
    })

    useProjectStore.getState().createConnectedNodeFromMenu('final', { x: 0, y: 0 })

    const response = slideNode(startId).responses.find((r) => r.id === responseId)
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
    const startId = startNodeId()
    useProjectStore.getState().openContextMenu({ position: { x: 0, y: 0 }, originNodeId: startId })
    useProjectStore.getState().createConnectedNodeFromMenu('final', { x: 0, y: 0 })
    expect(useProjectStore.getState().ui.titleFocusRequestNodeId).not.toBeNull()
    const selectedBefore = useProjectStore.getState().selection.selectedNodeIds

    useProjectStore.getState().clearTitleFocusRequest()

    expect(useProjectStore.getState().ui.titleFocusRequestNodeId).toBeNull()
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual(selectedBefore)
  })

  it('loadProject también resetea ui.titleFocusRequestNodeId', () => {
    const startId = startNodeId()
    useProjectStore.getState().openContextMenu({ position: { x: 0, y: 0 }, originNodeId: startId })
    useProjectStore.getState().createConnectedNodeFromMenu('final', { x: 0, y: 0 })

    const fresh = useProjectStore.getState().project
    useProjectStore.getState().loadProject(fresh)

    expect(useProjectStore.getState().ui.titleFocusRequestNodeId).toBeNull()
  })
})

describe('setClipboardNodeIds (portapapeles interno de Ctrl/Cmd+C/V, ver useCanvasClipboard)', () => {
  it('fija ui.clipboardNodeIds sin generar entrada de historial ni tocar la selección', () => {
    const startId = startNodeId()
    const historyBefore = useProjectStore.getState().history.past.length

    useProjectStore.getState().setClipboardNodeIds([startId])

    expect(useProjectStore.getState().ui.clipboardNodeIds).toEqual([startId])
    expect(useProjectStore.getState().history.past.length).toBe(historyBefore)
  })

  it('loadProject resetea ui.clipboardNodeIds', () => {
    const startId = startNodeId()
    useProjectStore.getState().setClipboardNodeIds([startId])

    const fresh = useProjectStore.getState().project
    useProjectStore.getState().loadProject(fresh)

    expect(useProjectStore.getState().ui.clipboardNodeIds).toEqual([])
  })
})
