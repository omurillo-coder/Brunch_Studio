import { describe, expect, it } from 'vitest'
import {
  createConnectedNode,
  createNode,
  createProject,
  deleteNode,
  moveNode,
  moveNodes,
  updateNode,
} from '../project'
import { connect } from '../graph'
import { addResponse } from '../responses'
import type { ProjectDocument } from '../schemas'

/** Devuelve el id del primer nodo que NO es la diapositiva de inicio y es
 *  del tipo pedido — atajo cómodo ahora que "slide" es el tipo por defecto y
 *  hay siempre una diapositiva de inicio en el documento. */
function otherNodeIdOf(project: ProjectDocument, type: 'slide' | 'final'): string {
  const node = project.graph.nodes.find(
    (candidate) => candidate.type === type && candidate.id !== project.graph.startNodeId,
  )
  if (!node) throw new Error(`No hay un nodo "${type}" distinto del inicio en el setup`)
  return node.id
}

describe('createProject', () => {
  it('crea un documento con schemaVersion 1, metadata coherente y una única diapositiva que es el inicio', () => {
    const project = createProject('Mi escenario')

    expect(project.schemaVersion).toBe(1)
    expect(project.metadata.name).toBe('Mi escenario')
    expect(project.metadata.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(project.metadata.createdAt).toBe(project.metadata.updatedAt)
    expect(project.settings).toEqual({})
    expect(project.editor.viewport).toEqual({ x: 0, y: 0, zoom: 1 })

    expect(project.graph.nodes).toHaveLength(1)
    const first = project.graph.nodes[0]
    expect(first?.type).toBe('slide')
    expect(first?.number).toBe(1)
    // El inicio ya no es un nodo aparte: es una referencia a la primera
    // diapositiva del proyecto.
    expect(project.graph.startNodeId).toBe(first?.id)
  })

  it('la diapositiva de inicio nace sin respuestas y sin destino', () => {
    const project = createProject('P')
    const start = project.graph.nodes[0]
    expect(start?.type === 'slide' ? start.responses : undefined).toEqual([])
    expect(start?.type === 'slide' ? start.targetNodeId : 'missing').toBeUndefined()
    expect(start?.type === 'slide' ? start.continueLabel : 'missing').toBeUndefined()
  })

  it('la diapositiva de inicio nace sin imágenes y con contentOrder "text-first"', () => {
    const project = createProject('P')
    const start = project.graph.nodes[0]
    expect(start?.type === 'slide' ? start.imageAssetIds : undefined).toEqual([])
    expect(start?.type === 'slide' ? start.contentOrder : undefined).toBe('text-first')
    expect(start?.internalNote).toBeUndefined()
  })
})

describe('createNode', () => {
  it('añade un nodo nuevo con número visible incremental', () => {
    const project = createProject('P')
    const updated = createNode(project, 'slide', { x: 100, y: 100 }, { title: 'Diapositiva 1' })

    expect(updated.graph.nodes).toHaveLength(2)
    const slideId = otherNodeIdOf(updated, 'slide')
    const slide = updated.graph.nodes.find((node) => node.id === slideId)
    expect(slide?.number).toBe(2)
    expect(slide?.title).toBe('Diapositiva 1')
    // Inmutabilidad: el proyecto original no se muta.
    expect(project.graph.nodes).toHaveLength(1)
  })

  it('una diapositiva nueva nace sin respuestas (modo "de continuar")', () => {
    const project = createProject('P')
    const updated = createNode(project, 'slide', { x: 0, y: 0 })
    const slideId = otherNodeIdOf(updated, 'slide')
    const slide = updated.graph.nodes.find((node) => node.id === slideId)
    expect(slide?.type === 'slide' ? slide.responses : undefined).toEqual([])
  })

  it('crea nodos final sin respuestas ni salida', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    const final = project.graph.nodes.find((node) => node.id === finalId)
    expect(final?.type).toBe('final')
  })
})

describe('deleteNode', () => {
  it('elimina el nodo y limpia el targetNodeId de las diapositivas que apuntaban a él', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = createNode(project, 'slide', { x: 100, y: 0 }, { title: 'C1' })
    const slideId = otherNodeIdOf(project, 'slide')

    project = connect(project, startId, slideId)
    project = createNode(project, 'final', { x: 200, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    project = connect(project, slideId, finalId)

    project = deleteNode(project, finalId)

    expect(project.graph.nodes.some((n) => n.id === finalId)).toBe(false)
    const slide = project.graph.nodes.find((n) => n.id === slideId)
    expect(slide?.type === 'slide' ? slide.targetNodeId : 'missing').toBeUndefined()
  })

  it('elimina el nodo y limpia el targetNodeId de las respuestas que apuntaban a él', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 100, y: 0 })
    const slideId = otherNodeIdOf(project, 'slide')
    project = createNode(project, 'final', { x: 200, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')

    project = addResponse(project, slideId)
    const slideNode = project.graph.nodes.find((n) => n.id === slideId)
    const respId = slideNode?.type === 'slide' ? slideNode.responses[0]?.id : undefined
    if (!respId) throw new Error('setup inválido')

    project = connect(project, slideId, finalId, respId)
    project = deleteNode(project, finalId)

    const slideAfter = project.graph.nodes.find((n) => n.id === slideId)
    expect(
      slideAfter?.type === 'slide' ? slideAfter.responses[0]?.targetNodeId : 'missing',
    ).toBeUndefined()
  })

  it('lanza error si el nodo no existe', () => {
    const project = createProject('P')
    expect(() => deleteNode(project, 'no-existe')).toThrow()
  })

  it('no permite eliminar la diapositiva de inicio', () => {
    const project = createProject('P')
    expect(() => deleteNode(project, project.graph.startNodeId)).toThrow()
    // No debe haber mutado nada aunque haya lanzado.
    expect(project.graph.nodes).toHaveLength(1)
  })
})

describe('moveNode', () => {
  it('actualiza la posición del nodo indicado', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId

    const updated = moveNode(project, startId, { x: 42, y: 7 })
    expect(updated.graph.nodes[0]?.position).toEqual({ x: 42, y: 7 })
    expect(project.graph.nodes[0]?.position).toEqual({ x: 0, y: 0 })
  })
})

describe('moveNodes', () => {
  it('mueve varios nodos a la vez en una sola operación', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const slideId = otherNodeIdOf(project, 'slide')

    const updated = moveNodes(project, [
      { nodeId: startId, position: { x: 10, y: 20 } },
      { nodeId: slideId, position: { x: 30, y: 40 } },
    ])

    expect(updated.graph.nodes.find((n) => n.id === startId)?.position).toEqual({ x: 10, y: 20 })
    expect(updated.graph.nodes.find((n) => n.id === slideId)?.position).toEqual({ x: 30, y: 40 })
    // Inmutabilidad: el proyecto original no se toca.
    expect(project.graph.nodes.find((n) => n.id === startId)?.position).toEqual({ x: 0, y: 0 })
    expect(project.graph.nodes.find((n) => n.id === slideId)?.position).toEqual({ x: 100, y: 0 })
  })

  it('lanza error y no muta nada si alguno de los ids no existe', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId

    expect(() =>
      moveNodes(project, [
        { nodeId: startId, position: { x: 1, y: 1 } },
        { nodeId: 'no-existe', position: { x: 2, y: 2 } },
      ]),
    ).toThrow()
    expect(project.graph.nodes.find((n) => n.id === startId)?.position).toEqual({ x: 0, y: 0 })
  })
})

describe('updateNode', () => {
  it('actualiza título y body sin afectar otros campos', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId

    const updated = updateNode(project, startId, { title: 'Inicio del escenario', body: 'texto' })
    const node = updated.graph.nodes[0]
    expect(node?.title).toBe('Inicio del escenario')
    expect(node?.body).toBe('texto')
    expect(node?.id).toBe(startId)
  })

  const IMAGE_ID = '11111111-1111-1111-1111-111111111111'
  const AUDIO_ID = '22222222-2222-2222-2222-222222222222'

  it('fija imágenes y audio en una diapositiva', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId

    const updated = updateNode(project, startId, {
      imageAssetIds: [IMAGE_ID],
      audioAssetId: AUDIO_ID,
    })
    const node = updated.graph.nodes.find((n) => n.id === startId)
    expect(node?.type === 'slide' ? node.imageAssetIds : undefined).toEqual([IMAGE_ID])
    expect(node?.type === 'slide' ? node.audioAssetId : undefined).toBe(AUDIO_ID)
  })

  it('imageAssetIds reemplaza la lista completa (no es un patch incremental)', () => {
    const OTHER_IMAGE_ID = '33333333-3333-3333-3333-333333333333'
    let project = createProject('P')
    const startId = project.graph.startNodeId

    project = updateNode(project, startId, { imageAssetIds: [IMAGE_ID, OTHER_IMAGE_ID] })
    let node = project.graph.nodes.find((n) => n.id === startId)
    expect(node?.type === 'slide' ? node.imageAssetIds : undefined).toEqual([IMAGE_ID, OTHER_IMAGE_ID])

    // Reordenar/quitar se hace pasando la lista ya modificada completa.
    project = updateNode(project, startId, { imageAssetIds: [OTHER_IMAGE_ID] })
    node = project.graph.nodes.find((n) => n.id === startId)
    expect(node?.type === 'slide' ? node.imageAssetIds : undefined).toEqual([OTHER_IMAGE_ID])

    // Vaciar la lista es un `imageAssetIds: []` explícito.
    project = updateNode(project, startId, { imageAssetIds: [] })
    node = project.graph.nodes.find((n) => n.id === startId)
    expect(node?.type === 'slide' ? node.imageAssetIds : undefined).toEqual([])
  })

  it('borra audio con null tras haberlo fijado', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId

    project = updateNode(project, startId, { imageAssetIds: [IMAGE_ID], audioAssetId: AUDIO_ID })
    const updated = updateNode(project, startId, { audioAssetId: null })
    const node = updated.graph.nodes.find((n) => n.id === startId)
    expect(node?.type === 'slide' ? node.imageAssetIds : 'missing').toEqual([IMAGE_ID])
    expect(node?.type === 'slide' ? node.audioAssetId : 'missing').toBeUndefined()
  })

  it('no toca imágenes/audio si el patch no los incluye (undefined)', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId

    project = updateNode(project, startId, { imageAssetIds: [IMAGE_ID] })
    const updated = updateNode(project, startId, { title: 'otro título' })
    const node = updated.graph.nodes.find((n) => n.id === startId)
    expect(node?.type === 'slide' ? node.imageAssetIds : undefined).toEqual([IMAGE_ID])
  })

  it('fija y borra la nota interna (internalNote), disponible también en un nodo final', () => {
    let project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')

    project = updateNode(project, finalId, { internalNote: 'Pedir gráfico a diseño' })
    let node = project.graph.nodes.find((n) => n.id === finalId)
    expect(node?.internalNote).toBe('Pedir gráfico a diseño')

    project = updateNode(project, finalId, { internalNote: null })
    node = project.graph.nodes.find((n) => n.id === finalId)
    expect(node?.internalNote).toBeUndefined()
  })

  it('fija el orden de contenido (contentOrder) de una diapositiva', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId

    project = updateNode(project, startId, { contentOrder: 'image-first' })
    const node = project.graph.nodes.find((n) => n.id === startId)
    expect(node?.type === 'slide' ? node.contentOrder : undefined).toBe('image-first')
  })

  it('fija, cambia y borra el texto del botón de continuar', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId

    project = updateNode(project, startId, { continueLabel: 'Siguiente' })
    let node = project.graph.nodes.find((n) => n.id === startId)
    expect(node?.type === 'slide' ? node.continueLabel : undefined).toBe('Siguiente')

    // `undefined` no toca el campo.
    project = updateNode(project, startId, { title: 'X' })
    node = project.graph.nodes.find((n) => n.id === startId)
    expect(node?.type === 'slide' ? node.continueLabel : undefined).toBe('Siguiente')

    // `null` lo borra (vuelve al texto por defecto).
    project = updateNode(project, startId, { continueLabel: null })
    node = project.graph.nodes.find((n) => n.id === startId)
    expect(node?.type === 'slide' ? node.continueLabel : 'missing').toBeUndefined()
  })

  it('lanza error al fijar imagen/audio/texto de continuar/orden de contenido en un nodo final', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')

    expect(() => updateNode(project, finalId, { imageAssetIds: [IMAGE_ID] })).toThrow()
    expect(() => updateNode(project, finalId, { audioAssetId: null })).toThrow()
    expect(() => updateNode(project, finalId, { continueLabel: 'Otra cosa' })).toThrow()
    expect(() => updateNode(project, finalId, { contentOrder: 'image-first' })).toThrow()
  })

  it('no lanza al fijar internalNote en un nodo final (es válido en cualquier tipo)', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')

    expect(() => updateNode(project, finalId, { internalNote: 'nota' })).not.toThrow()
  })
})

describe('createConnectedNode', () => {
  it('crea y conecta en una sola llamada desde una diapositiva sin respuestas (sin sourceResponseId)', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId

    const { project: updated, nodeId } = createConnectedNode(
      project,
      'slide',
      { x: 200, y: 50 },
      startId,
    )

    expect(updated.graph.nodes).toHaveLength(2)
    const created = updated.graph.nodes.find((node) => node.id === nodeId)
    expect(created?.type).toBe('slide')
    expect(created?.position).toEqual({ x: 200, y: 50 })

    const start = updated.graph.nodes.find((node) => node.id === startId)
    expect(start?.type === 'slide' ? start.targetNodeId : undefined).toBe(nodeId)

    // Inmutabilidad: el proyecto original no se toca.
    expect(project.graph.nodes).toHaveLength(1)
  })

  it('crea y conecta en una sola llamada desde una respuesta concreta', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    const start = project.graph.nodes.find((node) => node.id === startId)
    const responseId = start?.type === 'slide' ? start.responses[0]?.id : undefined
    if (!responseId) throw new Error('setup inválido')

    const { project: updated, nodeId } = createConnectedNode(
      project,
      'final',
      { x: 300, y: 0 },
      startId,
      responseId,
    )

    const created = updated.graph.nodes.find((node) => node.id === nodeId)
    expect(created?.type).toBe('final')

    const startAfter = updated.graph.nodes.find((node) => node.id === startId)
    const response =
      startAfter?.type === 'slide'
        ? startAfter.responses.find((r) => r.id === responseId)
        : undefined
    expect(response?.targetNodeId).toBe(nodeId)
  })

  it('propaga el error de `connect` si la respuesta de origen no existe', () => {
    const project = createProject('P')
    expect(() =>
      createConnectedNode(project, 'final', { x: 0, y: 0 }, project.graph.startNodeId, 'no-existe'),
    ).toThrow()
  })

  it('propaga el error de `connect` si el nodo de origen es un final', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    expect(() => createConnectedNode(project, 'slide', { x: 0, y: 0 }, finalId)).toThrow()
  })
})
