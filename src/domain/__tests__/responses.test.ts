import { describe, expect, it } from 'vitest'
import { createNode, createProject } from '../project'
import { addResponse, removeResponse, updateResponse } from '../responses'
import type { ProjectDocument } from '../schemas'

/**
 * `createNode(project, 'decision', ...)` ya deja el nodo con las respuestas
 * A y B (ver fix de `createNode` en `project.ts`), así que estos tests
 * parten de 2 respuestas, no de 0.
 */
function withDecisionNode(): { project: ProjectDocument; decisionId: string } {
  const project = createNode(createProject('P'), 'decision', { x: 0, y: 0 })
  const decisionId = project.graph.nodes.find((n) => n.type === 'decision')?.id
  if (!decisionId) throw new Error('setup inválido')
  return { project, decisionId }
}

describe('addResponse', () => {
  it('asigna las letras A, B, C, D en orden de creación (A y B ya existen al nacer el nodo)', () => {
    const { project: initialProject, decisionId } = withDecisionNode()
    let project = initialProject
    project = addResponse(project, decisionId) // C
    project = addResponse(project, decisionId) // D

    const decision = project.graph.nodes.find((n) => n.id === decisionId)
    const letters = decision?.type === 'decision' ? decision.responses.map((r) => r.letter) : []
    expect(letters).toEqual(['A', 'B', 'C', 'D'])
  })

  it('no permite una quinta respuesta', () => {
    const { project: initialProject, decisionId } = withDecisionNode()
    let project = initialProject
    project = addResponse(project, decisionId) // C
    project = addResponse(project, decisionId) // D

    expect(() => addResponse(project, decisionId)).toThrow()
  })

  it('reutiliza la primera letra libre tras eliminar una respuesta intermedia', () => {
    const { project: initialProject, decisionId } = withDecisionNode()
    let project = initialProject
    project = addResponse(project, decisionId) // C (A, B ya existían)

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
    project = addResponse(project, decisionId) // C (A, B ya existían)

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

describe('updateResponse', () => {
  it('actualiza el texto de una respuesta existente sin afectar las demás ni mutar el original', () => {
    const { project: initialProject, decisionId } = withDecisionNode()
    const decisionBefore = initialProject.graph.nodes.find((n) => n.id === decisionId)
    const responseA =
      decisionBefore?.type === 'decision'
        ? decisionBefore.responses.find((r) => r.letter === 'A')
        : undefined
    if (!responseA) throw new Error('setup inválido')

    const updated = updateResponse(initialProject, decisionId, responseA.id, { text: 'Sí' })

    const decisionAfter = updated.graph.nodes.find((n) => n.id === decisionId)
    const responses = decisionAfter?.type === 'decision' ? decisionAfter.responses : []
    expect(responses.find((r) => r.id === responseA.id)?.text).toBe('Sí')
    expect(responses.find((r) => r.letter === 'B')?.text).toBe('')
    // Inmutabilidad: el proyecto original no se muta.
    expect(responseA.text).toBe('')
  })

  it('lanza error si el nodo no existe', () => {
    const { project } = withDecisionNode()
    expect(() => updateResponse(project, 'no-existe', 'no-existe', { text: 'x' })).toThrow()
  })

  it('lanza error si el nodo no es de tipo decision', () => {
    const { project } = withDecisionNode()
    const startId = project.graph.nodes.find((n) => n.type === 'start')?.id
    if (!startId) throw new Error('setup inválido')

    expect(() => updateResponse(project, startId, 'no-existe', { text: 'x' })).toThrow()
  })

  it('lanza error si la respuesta no existe', () => {
    const { project, decisionId } = withDecisionNode()
    expect(() => updateResponse(project, decisionId, 'no-existe', { text: 'x' })).toThrow()
  })

  const IMAGE_ID = '11111111-1111-1111-1111-111111111111'
  const AUDIO_ID = '22222222-2222-2222-2222-222222222222'

  it('fija puntos (incluyendo negativos y cero) e imagen/audio independientemente', () => {
    const { project, decisionId } = withDecisionNode()
    const decision = project.graph.nodes.find((n) => n.id === decisionId)
    const responseA = decision?.type === 'decision' ? decision.responses[0] : undefined
    if (!responseA) throw new Error('setup inválido')

    const updated = updateResponse(project, decisionId, responseA.id, {
      points: -5,
      imageAssetId: IMAGE_ID,
      audioAssetId: AUDIO_ID,
    })
    const decisionAfter = updated.graph.nodes.find((n) => n.id === decisionId)
    const found =
      decisionAfter?.type === 'decision'
        ? decisionAfter.responses.find((r) => r.id === responseA.id)
        : undefined
    expect(found?.points).toBe(-5)
    expect(found?.imageAssetId).toBe(IMAGE_ID)
    expect(found?.audioAssetId).toBe(AUDIO_ID)
  })

  it('acepta puntos igual a cero', () => {
    const { project, decisionId } = withDecisionNode()
    const decision = project.graph.nodes.find((n) => n.id === decisionId)
    const responseA = decision?.type === 'decision' ? decision.responses[0] : undefined
    if (!responseA) throw new Error('setup inválido')

    const updated = updateResponse(project, decisionId, responseA.id, { points: 0 })
    const decisionAfter = updated.graph.nodes.find((n) => n.id === decisionId)
    const found =
      decisionAfter?.type === 'decision'
        ? decisionAfter.responses.find((r) => r.id === responseA.id)
        : undefined
    expect(found?.points).toBe(0)
  })

  it('borra puntos/imagen/audio con null tras haberlos fijado', () => {
    const { project: initialProject, decisionId } = withDecisionNode()
    const decision = initialProject.graph.nodes.find((n) => n.id === decisionId)
    const responseA = decision?.type === 'decision' ? decision.responses[0] : undefined
    if (!responseA) throw new Error('setup inválido')

    let project = updateResponse(initialProject, decisionId, responseA.id, {
      points: 10,
      imageAssetId: IMAGE_ID,
      audioAssetId: AUDIO_ID,
    })
    project = updateResponse(project, decisionId, responseA.id, {
      points: null,
      imageAssetId: null,
      audioAssetId: null,
    })
    const decisionAfter = project.graph.nodes.find((n) => n.id === decisionId)
    const found =
      decisionAfter?.type === 'decision'
        ? decisionAfter.responses.find((r) => r.id === responseA.id)
        : undefined
    expect(found?.points).toBeUndefined()
    expect(found?.imageAssetId).toBeUndefined()
    expect(found?.audioAssetId).toBeUndefined()
  })

  it('no toca puntos/imagen/audio si el patch no los incluye (undefined)', () => {
    const { project: initialProject, decisionId } = withDecisionNode()
    const decision = initialProject.graph.nodes.find((n) => n.id === decisionId)
    const responseA = decision?.type === 'decision' ? decision.responses[0] : undefined
    if (!responseA) throw new Error('setup inválido')

    let project = updateResponse(initialProject, decisionId, responseA.id, { points: 3 })
    project = updateResponse(project, decisionId, responseA.id, { text: 'nuevo texto' })
    const decisionAfter = project.graph.nodes.find((n) => n.id === decisionId)
    const found =
      decisionAfter?.type === 'decision'
        ? decisionAfter.responses.find((r) => r.id === responseA.id)
        : undefined
    expect(found?.points).toBe(3)
    expect(found?.text).toBe('nuevo texto')
  })
})
