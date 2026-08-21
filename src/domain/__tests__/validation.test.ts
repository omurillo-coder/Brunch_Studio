import { describe, expect, it } from 'vitest'
import { createNode, createProject } from '../project'
import { connect } from '../graph'
import { addResponse } from '../responses'
import { validateProject } from '../validation'
import type { ProjectDocument } from '../schemas'

function otherNodeIdOf(project: ProjectDocument, type: 'slide' | 'final'): string {
  const node = project.graph.nodes.find(
    (candidate) => candidate.type === type && candidate.id !== project.graph.startNodeId,
  )
  if (!node) throw new Error(`No hay un nodo "${type}" distinto del inicio en el setup`)
  return node.id
}

function responseIdsOf(project: ProjectDocument, nodeId: string): string[] {
  const node = project.graph.nodes.find((candidate) => candidate.id === nodeId)
  return node?.type === 'slide' ? node.responses.map((response) => response.id) : []
}

/**
 * Construye un grafo mínimo válido:
 * inicio (continuar) -> diapositiva con 2 respuestas -> final.
 */
function buildValidProject(): ProjectDocument {
  let project = createProject('P')
  project = createNode(project, 'slide', { x: 200, y: 0 })
  project = createNode(project, 'final', { x: 300, y: 0 })

  const startId = project.graph.startNodeId
  const slideId = otherNodeIdOf(project, 'slide')
  const finalId = otherNodeIdOf(project, 'final')

  project = connect(project, startId, slideId)
  project = addResponse(project, slideId)
  project = addResponse(project, slideId)
  for (const responseId of responseIdsOf(project, slideId)) {
    project = connect(project, slideId, finalId, responseId)
  }

  return project
}

describe('validateProject', () => {
  it('un grafo válido no tiene issues', () => {
    expect(validateProject(buildValidProject())).toEqual([])
  })

  it('detecta que la diapositiva de inicio no existe', () => {
    const project = buildValidProject()
    // `deleteNode` de dominio no permite borrar la diapositiva de inicio, así
    // que para probar esta regla de forma aislada se construye el documento
    // con un `startNodeId` colgado directamente.
    const broken: ProjectDocument = {
      ...project,
      graph: { ...project.graph, startNodeId: '00000000-0000-4000-8000-000000000000' },
    }

    const issues = validateProject(broken)
    expect(issues.some((issue) => issue.code === 'MISSING_START')).toBe(true)
  })

  it('detecta una respuesta sin destino', () => {
    let project = createProject('P')
    project = addResponse(project, project.graph.startNodeId)

    const issues = validateProject(project)
    expect(issues.some((issue) => issue.code === 'RESPONSE_WITHOUT_TARGET')).toBe(true)
  })

  it('detecta una diapositiva sin respuestas y sin destino de continuar', () => {
    const project = createProject('P')

    const issues = validateProject(project)
    expect(
      issues.some(
        (issue) =>
          issue.code === 'SLIDE_WITHOUT_TARGET' && issue.nodeId === project.graph.startNodeId,
      ),
    ).toBe(true)
  })

  it('una diapositiva sin respuestas pero con destino NO es un problema', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    project = connect(project, project.graph.startNodeId, finalId)

    const issues = validateProject(project)
    expect(issues.some((issue) => issue.code === 'SLIDE_WITHOUT_TARGET')).toBe(false)
    expect(issues).toEqual([])
  })

  it('detecta un nodo inalcanzable desde el inicio', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    project = connect(project, project.graph.startNodeId, finalId)
    // Una diapositiva nueva nunca conectada desde el inicio.
    project = createNode(project, 'slide', { x: 300, y: 300 })
    const orphanId = project.graph.nodes[project.graph.nodes.length - 1]?.id

    const issues = validateProject(project)
    expect(
      issues.some((issue) => issue.code === 'UNREACHABLE_NODE' && issue.nodeId === orphanId),
    ).toBe(true)
  })

  it('detecta ausencia de un final alcanzable desde el inicio', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 100, y: 0 })
    const slideId = otherNodeIdOf(project, 'slide')
    project = connect(project, project.graph.startNodeId, slideId)
    // No hay ningún nodo final en absoluto.

    const issues = validateProject(project)
    expect(issues.some((issue) => issue.code === 'NO_REACHABLE_FINAL')).toBe(true)
  })
})
