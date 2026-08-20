import { describe, expect, it } from 'vitest'
import { createNode, createProject } from '../project'
import { addResponse, removeResponse } from '../responses'
import type { ProjectDocument } from '../schemas'

function withDecisionNode(): { project: ProjectDocument; decisionId: string } {
  const project = createNode(createProject('P'), 'decision', { x: 0, y: 0 })
  const decisionId = project.graph.nodes.find((n) => n.type === 'decision')?.id
  if (!decisionId) throw new Error('setup inválido')
  return { project, decisionId }
}

describe('addResponse', () => {
  it('asigna las letras A, B, C, D en orden de creación', () => {
    const { project: initialProject, decisionId } = withDecisionNode()
    let project = initialProject
    project = addResponse(project, decisionId)
    project = addResponse(project, decisionId)
    project = addResponse(project, decisionId)
    project = addResponse(project, decisionId)

    const decision = project.graph.nodes.find((n) => n.id === decisionId)
    const letters = decision?.type === 'decision' ? decision.responses.map((r) => r.letter) : []
    expect(letters).toEqual(['A', 'B', 'C', 'D'])
  })

  it('no permite una quinta respuesta', () => {
    const { project: initialProject, decisionId } = withDecisionNode()
    let project = initialProject
    project = addResponse(project, decisionId)
    project = addResponse(project, decisionId)
    project = addResponse(project, decisionId)
    project = addResponse(project, decisionId)

    expect(() => addResponse(project, decisionId)).toThrow()
  })

  it('reutiliza la primera letra libre tras eliminar una respuesta intermedia', () => {
    const { project: initialProject, decisionId } = withDecisionNode()
    let project = initialProject
    project = addResponse(project, decisionId) // A
    project = addResponse(project, decisionId) // B
    project = addResponse(project, decisionId) // C

    const decisionBefore = project.graph.nodes.find((n) => n.id === decisionId)
    const responseB =
      decisionBefore?.type === 'decision'
        ? decisionBefore.responses.find((r) => r.letter === 'B')
        : undefined
    if (!responseB) throw new Error('setup inválido')

    project = removeResponse(project, decisionId, responseB.id)
    project = addResponse(project, decisionId) // debería volver a ser B

    const decisionAfter = project.graph.nodes.find((n) => n.id === decisionId)
    const letters =
      decisionAfter?.type === 'decision' ? decisionAfter.responses.map((r) => r.letter) : []
    expect(letters.sort()).toEqual(['A', 'B', 'C'])
  })
})

describe('removeResponse', () => {
  it('elimina una respuesta intermedia sin afectar el id/letra de las demás', () => {
    const { project: initialProject, decisionId } = withDecisionNode()
    let project = initialProject
    project = addResponse(project, decisionId) // A
    project = addResponse(project, decisionId) // B
    project = addResponse(project, decisionId) // C

    const decisionBefore = project.graph.nodes.find((n) => n.id === decisionId)
    const responses = decisionBefore?.type === 'decision' ? decisionBefore.responses : []
    const responseA = responses.find((r) => r.letter === 'A')
    const responseB = responses.find((r) => r.letter === 'B')
    const responseC = responses.find((r) => r.letter === 'C')
    if (!responseA || !responseB || !responseC) throw new Error('setup inválido')

    project = removeResponse(project, decisionId, responseB.id)

    const decisionAfter = project.graph.nodes.find((n) => n.id === decisionId)
    const remaining = decisionAfter?.type === 'decision' ? decisionAfter.responses : []
    expect(remaining).toHaveLength(2)
    expect(remaining.find((r) => r.id === responseA.id)?.letter).toBe('A')
    expect(remaining.find((r) => r.id === responseC.id)?.letter).toBe('C')
    expect(remaining.some((r) => r.id === responseB.id)).toBe(false)
  })
})
