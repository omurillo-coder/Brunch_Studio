import { describe, expect, it } from 'vitest'
import { createNode, createProject, deleteNode, moveNode, updateNode } from '../project'
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

  it('crea nodos decision sin respuestas por defecto', () => {
    const project = createProject('P')
    const updated = createNode(project, 'decision', { x: 0, y: 0 })
    const decision = updated.graph.nodes.find((node) => node.type === 'decision')
    expect(decision?.type).toBe('decision')
    if (decision?.type === 'decision') {
      expect(decision.responses).toEqual([])
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
})
