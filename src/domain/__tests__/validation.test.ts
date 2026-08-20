import { describe, expect, it } from 'vitest'
import { createNode, createProject, deleteNode } from '../project'
import { connect } from '../graph'
import { addResponse } from '../responses'
import { validateProject } from '../validation'
import type { ProjectDocument } from '../schemas'

function nodeIdOf(project: ProjectDocument, type: 'start' | 'content' | 'decision' | 'final'): string {
  const id = project.graph.nodes.find((n) => n.type === type)?.id
  if (!id) throw new Error(`No hay nodo de tipo ${type} en el setup`)
  return id
}

/** Construye un grafo mínimo válido: start -> content -> decision -A-> final. */
function buildValidProject(): ProjectDocument {
  let project = createProject('P')
  project = createNode(project, 'content', { x: 100, y: 0 })
  project = createNode(project, 'decision', { x: 200, y: 0 })
  project = createNode(project, 'final', { x: 300, y: 0 })

  const startId = nodeIdOf(project, 'start')
  const contentId = nodeIdOf(project, 'content')
  const decisionId = nodeIdOf(project, 'decision')
  const finalId = nodeIdOf(project, 'final')

  project = connect(project, startId, contentId)
  project = connect(project, contentId, decisionId)
  project = addResponse(project, decisionId)
  const decisionNode = project.graph.nodes.find((n) => n.id === decisionId)
  const responseId = decisionNode?.type === 'decision' ? decisionNode.responses[0]?.id : undefined
  if (!responseId) throw new Error('setup inválido')
  project = connect(project, decisionId, finalId, responseId)

  return project
}

describe('validateProject', () => {
  it('un grafo válido no tiene issues', () => {
    const project = buildValidProject()
    expect(validateProject(project)).toEqual([])
  })

  it('detecta que falta el nodo start', () => {
    const project = buildValidProject()
    const startId = nodeIdOf(project, 'start')
    // deleteNode limpia referencias entrantes; el grafo queda sin start.
    const withoutStart = deleteNode(project, startId)

    const issues = validateProject(withoutStart)
    expect(issues.some((issue) => issue.code === 'MISSING_START')).toBe(true)
  })

  it('detecta más de un nodo start', () => {
    const project = createProject('P')
    const firstStart = project.graph.nodes.find((n) => n.type === 'start')
    if (!firstStart || firstStart.type !== 'start') throw new Error('setup inválido')

    // Se fuerza un segundo start directamente en el documento (createNode lo
    // impide), para poder probar la regla de validación de forma aislada.
    const secondStart = { ...firstStart, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', number: 2 }
    const withTwoStarts: ProjectDocument = {
      ...project,
      graph: { nodes: [...project.graph.nodes, secondStart] },
    }

    const issues = validateProject(withTwoStarts)
    expect(issues.some((issue) => issue.code === 'MULTIPLE_START')).toBe(true)
  })

  it('detecta una respuesta de decision sin destino', () => {
    let project = createProject('P')
    project = createNode(project, 'decision', { x: 100, y: 0 })
    const startId = nodeIdOf(project, 'start')
    const decisionId = nodeIdOf(project, 'decision')
    project = connect(project, startId, decisionId)
    project = addResponse(project, decisionId)

    const issues = validateProject(project)
    expect(issues.some((issue) => issue.code === 'DECISION_RESPONSE_WITHOUT_TARGET')).toBe(true)
  })

  it('detecta un nodo content sin destino', () => {
    let project = createProject('P')
    project = createNode(project, 'content', { x: 100, y: 0 })
    const startId = nodeIdOf(project, 'start')
    const contentId = nodeIdOf(project, 'content')
    project = connect(project, startId, contentId)
    // El content queda sin su propio destino conectado.

    const issues = validateProject(project)
    expect(issues.some((issue) => issue.code === 'CONTENT_WITHOUT_TARGET')).toBe(true)
  })

  it('detecta un nodo decision sin ninguna respuesta', () => {
    let project = createProject('P')
    project = createNode(project, 'decision', { x: 100, y: 0 })
    const startId = nodeIdOf(project, 'start')
    const decisionId = nodeIdOf(project, 'decision')
    project = connect(project, startId, decisionId)

    const issues = validateProject(project)
    expect(issues.some((issue) => issue.code === 'DECISION_WITHOUT_RESPONSES')).toBe(true)
  })

  it('detecta un nodo inalcanzable desde start', () => {
    let project = createProject('P')
    // Se crea un content nunca conectado desde start.
    project = createNode(project, 'content', { x: 300, y: 300 })
    const contentId = nodeIdOf(project, 'content')

    const issues = validateProject(project)
    expect(
      issues.some((issue) => issue.code === 'UNREACHABLE_NODE' && issue.nodeId === contentId),
    ).toBe(true)
  })

  it('detecta ausencia de un final alcanzable desde start', () => {
    let project = createProject('P')
    project = createNode(project, 'content', { x: 100, y: 0 })
    const startId = nodeIdOf(project, 'start')
    const contentId = nodeIdOf(project, 'content')
    project = connect(project, startId, contentId)
    // No hay ningún nodo final en absoluto.

    const issues = validateProject(project)
    expect(issues.some((issue) => issue.code === 'NO_REACHABLE_FINAL')).toBe(true)
  })
})
