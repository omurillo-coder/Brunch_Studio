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

describe('createProject', () => {
  it('crea un documento con schemaVersion 1, metadata coherente y un único nodo start', () => {
    const project = createProject('Mi escenario')

    expect(project.schemaVersion).toBe(1)
    expect(project.metadata.name).toBe('Mi escenario')
    expect(project.metadata.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(project.metadata.createdAt).toBe(project.metadata.updatedAt)
    expect(project.settings).toEqual({})
    expect(project.editor.viewport).toEqual({ x: 0, y: 0, zoom: 1 })

    expect(project.graph.nodes).toHaveLength(1)
    expect(project.graph.nodes[0]?.type).toBe('start')
    expect(project.graph.nodes[0]?.number).toBe(1)
  })
})

describe('createNode', () => {
  it('añade un nodo nuevo con número visible incremental', () => {
    const project = createProject('P')
    const updated = createNode(project, 'content', { x: 100, y: 100 }, { title: 'Pantalla 1' })

    expect(updated.graph.nodes).toHaveLength(2)
    const content = updated.graph.nodes.find((node) => node.type === 'content')
    expect(content?.number).toBe(2)
    expect(content?.title).toBe('Pantalla 1')
    // Inmutabilidad: el proyecto original no se muta.
    expect(project.graph.nodes).toHaveLength(1)
  })

  it('no permite crear un segundo nodo start', () => {
    const project = createProject('P')
    expect(() => createNode(project, 'start', { x: 0, y: 0 })).toThrow()
  })

  it('crea nodos decision con respuestas iniciales A y B (nunca vacío, nunca con más de 2 al nacer)', () => {
    const project = createProject('P')
    const updated = createNode(project, 'decision', { x: 0, y: 0 })
    const decision = updated.graph.nodes.find((node) => node.type === 'decision')
    expect(decision?.type).toBe('decision')
    if (decision?.type === 'decision') {
      expect(decision.responses).toHaveLength(2)
      expect(decision.responses.map((r) => r.letter)).toEqual(['A', 'B'])
      expect(decision.responses.every((r) => r.text === '')).toBe(true)
      expect(decision.responses.every((r) => r.targetNodeId === undefined)).toBe(true)
    }
  })
})

describe('deleteNode', () => {
  it('elimina el nodo y limpia targetNodeId de nodos start/content que apuntaban a él', () => {
    let project = createProject('P')
    const startId = project.graph.nodes[0]?.id
    project = createNode(project, 'content', { x: 100, y: 0 }, { title: 'C1' })
    const contentId = project.graph.nodes.find((n) => n.type === 'content')?.id
    if (!startId || !contentId) throw new Error('setup inválido')

    project = connect(project, startId, contentId)
    project = createNode(project, 'final', { x: 200, y: 0 })
    const finalId = project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')
    project = connect(project, contentId, finalId)

    project = deleteNode(project, finalId)

    expect(project.graph.nodes.some((n) => n.id === finalId)).toBe(false)
    const content = project.graph.nodes.find((n) => n.id === contentId)
    expect(content && content.type === 'content' ? content.targetNodeId : 'missing').toBeUndefined()
  })

  it('elimina el nodo y limpia targetNodeId de respuestas de decision que apuntaban a él', () => {
    let project = createProject('P')
    project = createNode(project, 'decision', { x: 100, y: 0 })
    const decisionId = project.graph.nodes.find((n) => n.type === 'decision')?.id
    project = createNode(project, 'final', { x: 200, y: 0 })
    const finalId = project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!decisionId || !finalId) throw new Error('setup inválido')

    project = addResponse(project, decisionId)
    const decisionNode = project.graph.nodes.find((n) => n.id === decisionId)
    const respId =
      decisionNode?.type === 'decision' ? decisionNode.responses[0]?.id : undefined
    if (!respId) throw new Error('setup inválido')

    project = connect(project, decisionId, finalId, respId)
    project = deleteNode(project, finalId)

    const decisionAfter = project.graph.nodes.find((n) => n.id === decisionId)
    expect(decisionAfter?.type === 'decision' ? decisionAfter.responses[0]?.targetNodeId : 'missing').toBeUndefined()
  })

  it('lanza error si el nodo no existe', () => {
    const project = createProject('P')
    expect(() => deleteNode(project, 'no-existe')).toThrow()
  })

  it('no permite eliminar el nodo start', () => {
    const project = createProject('P')
    const startId = project.graph.nodes[0]?.id
    if (!startId) throw new Error('setup inválido')

    expect(() => deleteNode(project, startId)).toThrow()
    // No debe haber mutado nada aunque haya lanzado.
    expect(project.graph.nodes).toHaveLength(1)
  })
})

describe('moveNode', () => {
  it('actualiza la posición del nodo indicado', () => {
    const project = createProject('P')
    const startId = project.graph.nodes[0]?.id
    if (!startId) throw new Error('setup inválido')

    const updated = moveNode(project, startId, { x: 42, y: 7 })
    expect(updated.graph.nodes[0]?.position).toEqual({ x: 42, y: 7 })
    expect(project.graph.nodes[0]?.position).toEqual({ x: 0, y: 0 })
  })
})

describe('moveNodes', () => {
  it('mueve varios nodos a la vez en una sola operación', () => {
    let project = createProject('P')
    project = createNode(project, 'content', { x: 100, y: 0 })
    const startId = project.graph.nodes.find((n) => n.type === 'start')?.id
    const contentId = project.graph.nodes.find((n) => n.type === 'content')?.id
    if (!startId || !contentId) throw new Error('setup inválido')

    const updated = moveNodes(project, [
      { nodeId: startId, position: { x: 10, y: 20 } },
      { nodeId: contentId, position: { x: 30, y: 40 } },
    ])

    expect(updated.graph.nodes.find((n) => n.id === startId)?.position).toEqual({ x: 10, y: 20 })
    expect(updated.graph.nodes.find((n) => n.id === contentId)?.position).toEqual({ x: 30, y: 40 })
    // Inmutabilidad: el proyecto original no se toca.
    expect(project.graph.nodes.find((n) => n.id === startId)?.position).toEqual({ x: 0, y: 0 })
    expect(project.graph.nodes.find((n) => n.id === contentId)?.position).toEqual({ x: 100, y: 0 })
  })

  it('lanza error y no muta nada si alguno de los ids no existe', () => {
    let project = createProject('P')
    const startId = project.graph.nodes[0]?.id
    if (!startId) throw new Error('setup inválido')

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
    const startId = project.graph.nodes[0]?.id
    if (!startId) throw new Error('setup inválido')

    const updated = updateNode(project, startId, { title: 'Inicio del escenario', body: 'texto' })
    const node = updated.graph.nodes[0]
    expect(node?.title).toBe('Inicio del escenario')
    expect(node?.body).toBe('texto')
    expect(node?.id).toBe(startId)
  })

  const IMAGE_ID = '11111111-1111-1111-1111-111111111111'
  const AUDIO_ID = '22222222-2222-2222-2222-222222222222'

  it('fija imagen y audio en un nodo content', () => {
    let project = createProject('P')
    project = createNode(project, 'content', { x: 0, y: 0 })
    const contentId = project.graph.nodes.find((n) => n.type === 'content')?.id
    if (!contentId) throw new Error('setup inválido')

    const updated = updateNode(project, contentId, {
      imageAssetId: IMAGE_ID,
      audioAssetId: AUDIO_ID,
    })
    const node = updated.graph.nodes.find((n) => n.id === contentId)
    expect(node?.type === 'content' ? node.imageAssetId : undefined).toBe(IMAGE_ID)
    expect(node?.type === 'content' ? node.audioAssetId : undefined).toBe(AUDIO_ID)
  })

  it('fija imagen y audio en un nodo decision', () => {
    let project = createProject('P')
    project = createNode(project, 'decision', { x: 0, y: 0 })
    const decisionId = project.graph.nodes.find((n) => n.type === 'decision')?.id
    if (!decisionId) throw new Error('setup inválido')

    const updated = updateNode(project, decisionId, {
      imageAssetId: IMAGE_ID,
      audioAssetId: AUDIO_ID,
    })
    const node = updated.graph.nodes.find((n) => n.id === decisionId)
    expect(node?.type === 'decision' ? node.imageAssetId : undefined).toBe(IMAGE_ID)
    expect(node?.type === 'decision' ? node.audioAssetId : undefined).toBe(AUDIO_ID)
  })

  it('borra imagen y audio con null tras haberlos fijado', () => {
    let project = createProject('P')
    project = createNode(project, 'content', { x: 0, y: 0 })
    const contentId = project.graph.nodes.find((n) => n.type === 'content')?.id
    if (!contentId) throw new Error('setup inválido')

    project = updateNode(project, contentId, { imageAssetId: IMAGE_ID, audioAssetId: AUDIO_ID })
    const updated = updateNode(project, contentId, { imageAssetId: null, audioAssetId: null })
    const node = updated.graph.nodes.find((n) => n.id === contentId)
    expect(node?.type === 'content' ? node.imageAssetId : 'missing').toBeUndefined()
    expect(node?.type === 'content' ? node.audioAssetId : 'missing').toBeUndefined()
  })

  it('no toca imagen/audio si el patch no los incluye (undefined)', () => {
    let project = createProject('P')
    project = createNode(project, 'content', { x: 0, y: 0 })
    const contentId = project.graph.nodes.find((n) => n.type === 'content')?.id
    if (!contentId) throw new Error('setup inválido')

    project = updateNode(project, contentId, { imageAssetId: IMAGE_ID })
    const updated = updateNode(project, contentId, { title: 'otro título' })
    const node = updated.graph.nodes.find((n) => n.id === contentId)
    expect(node?.type === 'content' ? node.imageAssetId : undefined).toBe(IMAGE_ID)
  })

  it('lanza error al fijar imagen/audio en un nodo start', () => {
    const project = createProject('P')
    const startId = project.graph.nodes[0]?.id
    if (!startId) throw new Error('setup inválido')

    expect(() => updateNode(project, startId, { imageAssetId: IMAGE_ID })).toThrow()
    expect(() => updateNode(project, startId, { audioAssetId: AUDIO_ID })).toThrow()
  })

  it('lanza error al fijar imagen/audio en un nodo final', () => {
    let project = createProject('P')
    project = createNode(project, 'final', { x: 0, y: 0 })
    const finalId = project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')

    expect(() => updateNode(project, finalId, { imageAssetId: IMAGE_ID })).toThrow()
    expect(() => updateNode(project, finalId, { audioAssetId: null })).toThrow()
  })
})

describe('createConnectedNode', () => {
  it('crea y conecta en una sola llamada desde un nodo start/content (sin sourceResponseId)', () => {
    const project = createProject('P')
    const startId = project.graph.nodes[0]?.id
    if (!startId) throw new Error('setup inválido')

    const { project: updated, nodeId } = createConnectedNode(
      project,
      'content',
      { x: 200, y: 50 },
      startId,
    )

    expect(updated.graph.nodes).toHaveLength(2)
    const created = updated.graph.nodes.find((node) => node.id === nodeId)
    expect(created?.type).toBe('content')
    expect(created?.position).toEqual({ x: 200, y: 50 })

    const start = updated.graph.nodes.find((node) => node.id === startId)
    expect(start?.type === 'start' ? start.targetNodeId : undefined).toBe(nodeId)

    // Inmutabilidad: el proyecto original no se toca.
    expect(project.graph.nodes).toHaveLength(1)
  })

  it('crea y conecta en una sola llamada desde una respuesta de un nodo decision', () => {
    let project = createProject('P')
    project = createNode(project, 'decision', { x: 0, y: 0 })
    const decision = project.graph.nodes.find((node) => node.type === 'decision')
    const responseId = decision?.type === 'decision' ? decision.responses[0]?.id : undefined
    if (!decision || !responseId) throw new Error('setup inválido')

    const { project: updated, nodeId } = createConnectedNode(
      project,
      'final',
      { x: 300, y: 0 },
      decision.id,
      responseId,
    )

    const created = updated.graph.nodes.find((node) => node.id === nodeId)
    expect(created?.type).toBe('final')

    const decisionAfter = updated.graph.nodes.find((node) => node.id === decision.id)
    const response =
      decisionAfter?.type === 'decision'
        ? decisionAfter.responses.find((r) => r.id === responseId)
        : undefined
    expect(response?.targetNodeId).toBe(nodeId)
  })

  it('el nodo nuevo creado es un nodo decision con respuestas A y B iniciales', () => {
    const project = createProject('P')
    const startId = project.graph.nodes[0]?.id
    if (!startId) throw new Error('setup inválido')

    const { project: updated, nodeId } = createConnectedNode(
      project,
      'decision',
      { x: 0, y: 0 },
      startId,
    )

    const created = updated.graph.nodes.find((node) => node.id === nodeId)
    expect(created?.type === 'decision' ? created.responses.map((r) => r.letter) : []).toEqual([
      'A',
      'B',
    ])
  })

  it('propaga el error de `connect` si la combinación origen/respuesta es inválida', () => {
    let project = createProject('P')
    project = createNode(project, 'decision', { x: 0, y: 0 })
    const decisionId = project.graph.nodes.find((node) => node.type === 'decision')?.id
    if (!decisionId) throw new Error('setup inválido')

    // Un nodo decision requiere `sourceResponseId`; omitirlo debe propagar
    // el error que ya lanza `connect` de dominio, sin dejar el proyecto en
    // un estado intermedio (nodo creado pero no conectado).
    expect(() => createConnectedNode(project, 'final', { x: 0, y: 0 }, decisionId)).toThrow()
  })
})
