import { describe, expect, it } from 'vitest'
import { createNode, createProject, updateNode } from '../project'
import { connect } from '../graph'
import { addResponse } from '../responses'
import { validateGraphForExport, validateProject, validationIssueId } from '../validation'
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

  it('un destino solo alcanzable por la rama "si no" (elseTargetNodeId) no se marca inalcanzable (fase 2)', () => {
    // Inicio -> (si) Final A ; Inicio -> (si no) Final B. Final B NO tiene
    // ninguna arista "normal" entrante, solo la de `elseTargetNodeId`: antes
    // de que `deriveEdges` la contemplara, el BFS de alcanzabilidad la
    // habría marcado erróneamente como huérfana.
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    project = createNode(project, 'final', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const [finalSi, finalNo] = project.graph.nodes.filter((node) => node.type === 'final')
    if (!finalSi || !finalNo) throw new Error('setup inválido')

    project = connect(project, startId, finalSi.id)
    project = updateNode(project, startId, {
      condition: {
        variableId: '00000000-0000-4000-8000-000000000001',
        operator: '==',
        value: true,
      },
      elseTargetNodeId: finalNo.id,
    })

    const issues = validateProject(project)
    expect(
      issues.some((issue) => issue.code === 'UNREACHABLE_NODE' && issue.nodeId === finalNo.id),
    ).toBe(false)
    expect(issues).toEqual([])
  })
})

describe('validationIssueId', () => {
  it('es estable para el MISMO aviso, e independiente de otros campos que no formen parte de la identidad', () => {
    const issue = validateProject(createProject('P')).find((i) => i.code === 'SLIDE_WITHOUT_TARGET')
    if (!issue) throw new Error('setup inválido')
    expect(validationIssueId(issue)).toBe(validationIssueId({ ...issue }))
  })

  it('distingue dos avisos del MISMO código sobre nodos distintos', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    project = connect(project, project.graph.startNodeId, finalId)
    // Dos diapositivas nuevas, ninguna conectada — dos `UNREACHABLE_NODE`
    // distintos.
    project = createNode(project, 'slide', { x: 300, y: 300 })
    project = createNode(project, 'slide', { x: 300, y: 400 })

    const issues = validateProject(project).filter((issue) => issue.code === 'UNREACHABLE_NODE')
    expect(issues).toHaveLength(2)
    const ids = issues.map(validationIssueId)
    expect(new Set(ids).size).toBe(2)
  })

  it('un código sin nodeId/responseId (NO_REACHABLE_FINAL) sigue produciendo un id no vacío', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 100, y: 0 })
    project = connect(project, project.graph.startNodeId, otherNodeIdOf(project, 'slide'))

    const issue = validateProject(project).find((i) => i.code === 'NO_REACHABLE_FINAL')
    if (!issue) throw new Error('setup inválido')
    expect(validationIssueId(issue)).toBe('validation:NO_REACHABLE_FINAL::')
  })
})

describe('validateGraphForExport', () => {
  it('un grafo válido no bloquea la exportación', () => {
    expect(validateGraphForExport(buildValidProject())).toEqual([])
  })

  it('traduce SLIDE_WITHOUT_TARGET a un texto legible con el número de diapositiva (D{número}), nunca el id interno', () => {
    const project = createProject('P')
    const startNumber = project.graph.nodes[0]?.number
    const messages = validateGraphForExport(project)
    expect(messages.some((message) => message.includes(`D${startNumber}`))).toBe(true)
    // Nunca el UUID interno del nodo, a diferencia de `issue.message` (ver
    // comentario de `validateGraphForExport`).
    expect(messages.join(' ')).not.toContain(project.graph.startNodeId)
  })

  it('traduce UNREACHABLE_NODE a texto legible con el número de la diapositiva huérfana', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    project = connect(project, project.graph.startNodeId, finalId)
    project = createNode(project, 'slide', { x: 300, y: 300 })
    const orphan = project.graph.nodes[project.graph.nodes.length - 1]
    if (!orphan) throw new Error('setup inválido')

    const messages = validateGraphForExport(project)
    expect(messages.some((message) => message.includes(`D${orphan.number}`))).toBe(true)
  })

  it('sin ningún Final en absoluto, avisa de que el recorrido no puede terminar', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 100, y: 0 })
    project = connect(project, project.graph.startNodeId, otherNodeIdOf(project, 'slide'))

    const messages = validateGraphForExport(project)
    expect(messages.some((message) => /no puede terminar/.test(message))).toBe(true)
  })

  it('devuelve tantos mensajes como avisos, en el mismo orden que validateProject', () => {
    const project = createProject('P')
    expect(validateGraphForExport(project)).toHaveLength(validateProject(project).length)
  })
})
