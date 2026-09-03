import { describe, expect, it } from 'vitest'
import { createNode, createProject } from '../project'
import { connect } from '../graph'
import { addResponse, moveResponse, removeResponse, updateResponse } from '../responses'
import type { DecisionResponse, ProjectDocument } from '../schemas'

/**
 * Una diapositiva nueva nace SIN respuestas (modo "de continuar"): estos
 * tests parten de 0 y las añaden explícitamente, que es justo la vía por la
 * que una diapositiva se convierte en decisión.
 */
function withSlide(): { project: ProjectDocument; slideId: string } {
  const project = createProject('P')
  return { project, slideId: project.graph.startNodeId }
}

function responsesOf(project: ProjectDocument, nodeId: string): DecisionResponse[] {
  const node = project.graph.nodes.find((candidate) => candidate.id === nodeId)
  return node?.type === 'slide' ? node.responses : []
}

describe('addResponse', () => {
  it('la primera respuesta convierte la diapositiva en decisión sin borrar su targetNodeId', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const slideId = project.graph.startNodeId
    const finalId = project.graph.nodes.find((n) => n.id !== slideId)?.id
    if (!finalId) throw new Error('setup inválido')

    // La diapositiva tenía un destino de "continuar" configurado; añadir la
    // primera respuesta lo deja dormido, no lo borra.
    project = connect(project, slideId, finalId)
    project = addResponse(project, slideId)

    const slide = project.graph.nodes.find((n) => n.id === slideId)
    expect(slide?.type === 'slide' ? slide.responses : []).toHaveLength(1)
    expect(slide?.type === 'slide' ? slide.targetNodeId : undefined).toBe(finalId)
  })

  it('asigna las letras A, B, C, D en orden de creación', () => {
    const { project: initial, slideId } = withSlide()
    let project = initial
    project = addResponse(project, slideId)
    project = addResponse(project, slideId)
    project = addResponse(project, slideId)
    project = addResponse(project, slideId)

    expect(responsesOf(project, slideId).map((r) => r.letter)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('no permite una quinta respuesta', () => {
    const { project: initial, slideId } = withSlide()
    let project = initial
    for (let i = 0; i < 4; i += 1) {
      project = addResponse(project, slideId)
    }

    expect(() => addResponse(project, slideId)).toThrow()
  })

  it('reutiliza la primera letra libre tras eliminar una respuesta intermedia', () => {
    const { project: initial, slideId } = withSlide()
    let project = initial
    project = addResponse(project, slideId) // A
    project = addResponse(project, slideId) // B
    project = addResponse(project, slideId) // C

    const responseB = responsesOf(project, slideId).find((r) => r.letter === 'B')
    if (!responseB) throw new Error('setup inválido')

    project = removeResponse(project, slideId, responseB.id)
    project = addResponse(project, slideId) // debería volver a ser B

    const letters = responsesOf(project, slideId).map((r) => r.letter)
    expect([...letters].sort()).toEqual(['A', 'B', 'C'])
  })

  it('lanza error si el nodo es un final', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')
    expect(() => addResponse(project, finalId)).toThrow()
  })
})

describe('removeResponse', () => {
  it('elimina una respuesta intermedia sin afectar el id/letra de las demás', () => {
    const { project: initial, slideId } = withSlide()
    let project = initial
    project = addResponse(project, slideId) // A
    project = addResponse(project, slideId) // B
    project = addResponse(project, slideId) // C

    const responses = responsesOf(project, slideId)
    const responseA = responses.find((r) => r.letter === 'A')
    const responseB = responses.find((r) => r.letter === 'B')
    const responseC = responses.find((r) => r.letter === 'C')
    if (!responseA || !responseB || !responseC) throw new Error('setup inválido')

    project = removeResponse(project, slideId, responseB.id)

    const remaining = responsesOf(project, slideId)
    expect(remaining).toHaveLength(2)
    expect(remaining.find((r) => r.id === responseA.id)?.letter).toBe('A')
    expect(remaining.find((r) => r.id === responseC.id)?.letter).toBe('C')
    expect(remaining.some((r) => r.id === responseB.id)).toBe(false)
  })

  it('eliminar la última respuesta devuelve la diapositiva a modo "de continuar" conservando su targetNodeId', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const slideId = project.graph.startNodeId
    const finalId = project.graph.nodes.find((n) => n.id !== slideId)?.id
    if (!finalId) throw new Error('setup inválido')

    // Destino de "continuar" configurado ANTES de añadir respuestas.
    project = connect(project, slideId, finalId)
    project = addResponse(project, slideId)

    const response = responsesOf(project, slideId)[0]
    if (!response) throw new Error('setup inválido')
    project = removeResponse(project, slideId, response.id)

    const slide = project.graph.nodes.find((n) => n.id === slideId)
    expect(slide?.type === 'slide' ? slide.responses : undefined).toEqual([])
    // El `targetNodeId` nunca se borró: la diapositiva vuelve a usarlo.
    expect(slide?.type === 'slide' ? slide.targetNodeId : undefined).toBe(finalId)
  })
})

describe('updateResponse', () => {
  it('actualiza el texto de una respuesta existente sin afectar las demás ni mutar el original', () => {
    const { project: initial, slideId } = withSlide()
    let project = addResponse(initial, slideId)
    project = addResponse(project, slideId)

    const responseA = responsesOf(project, slideId).find((r) => r.letter === 'A')
    if (!responseA) throw new Error('setup inválido')

    const updated = updateResponse(project, slideId, responseA.id, { text: 'Sí' })

    const responses = responsesOf(updated, slideId)
    expect(responses.find((r) => r.id === responseA.id)?.text).toBe('Sí')
    expect(responses.find((r) => r.letter === 'B')?.text).toBe('')
    // Inmutabilidad: el proyecto original no se muta.
    expect(responseA.text).toBe('')
  })

  it('lanza error si el nodo no existe', () => {
    const { project } = withSlide()
    expect(() => updateResponse(project, 'no-existe', 'no-existe', { text: 'x' })).toThrow()
  })

  it('lanza error si el nodo no es una diapositiva', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')

    expect(() => updateResponse(project, finalId, 'no-existe', { text: 'x' })).toThrow()
  })

  it('lanza error si la respuesta no existe', () => {
    const { project, slideId } = withSlide()
    expect(() => updateResponse(project, slideId, 'no-existe', { text: 'x' })).toThrow()
  })

  const IMAGE_ID = '11111111-1111-1111-1111-111111111111'
  const AUDIO_ID = '22222222-2222-2222-2222-222222222222'

  it('fija puntos (incluyendo negativos y cero) e imagen/audio independientemente', () => {
    const { project: initial, slideId } = withSlide()
    const project = addResponse(initial, slideId)
    const responseA = responsesOf(project, slideId)[0]
    if (!responseA) throw new Error('setup inválido')

    const updated = updateResponse(project, slideId, responseA.id, {
      points: -5,
      imageAssetId: IMAGE_ID,
      audioAssetId: AUDIO_ID,
    })
    const found = responsesOf(updated, slideId).find((r) => r.id === responseA.id)
    expect(found?.points).toBe(-5)
    expect(found?.imageAssetId).toBe(IMAGE_ID)
    expect(found?.audioAssetId).toBe(AUDIO_ID)
  })

  it('acepta puntos igual a cero', () => {
    const { project: initial, slideId } = withSlide()
    const project = addResponse(initial, slideId)
    const responseA = responsesOf(project, slideId)[0]
    if (!responseA) throw new Error('setup inválido')

    const updated = updateResponse(project, slideId, responseA.id, { points: 0 })
    expect(responsesOf(updated, slideId).find((r) => r.id === responseA.id)?.points).toBe(0)
  })

  it('borra puntos/imagen/audio con null tras haberlos fijado', () => {
    const { project: initial, slideId } = withSlide()
    let project = addResponse(initial, slideId)
    const responseA = responsesOf(project, slideId)[0]
    if (!responseA) throw new Error('setup inválido')

    project = updateResponse(project, slideId, responseA.id, {
      points: 10,
      imageAssetId: IMAGE_ID,
      audioAssetId: AUDIO_ID,
    })
    project = updateResponse(project, slideId, responseA.id, {
      points: null,
      imageAssetId: null,
      audioAssetId: null,
    })
    const found = responsesOf(project, slideId).find((r) => r.id === responseA.id)
    expect(found?.points).toBeUndefined()
    expect(found?.imageAssetId).toBeUndefined()
    expect(found?.audioAssetId).toBeUndefined()
  })

  it('no toca puntos/imagen/audio si el patch no los incluye (undefined)', () => {
    const { project: initial, slideId } = withSlide()
    let project = addResponse(initial, slideId)
    const responseA = responsesOf(project, slideId)[0]
    if (!responseA) throw new Error('setup inválido')

    project = updateResponse(project, slideId, responseA.id, { points: 3 })
    project = updateResponse(project, slideId, responseA.id, { text: 'nuevo texto' })
    const found = responsesOf(project, slideId).find((r) => r.id === responseA.id)
    expect(found?.points).toBe(3)
    expect(found?.text).toBe('nuevo texto')
  })

  const VARIABLE_ID = '33333333-3333-3333-3333-333333333333'

  it('fija effects/condition, reemplazando la lista de effects completa (no incremental)', () => {
    const { project: initial, slideId } = withSlide()
    let project = addResponse(initial, slideId)
    const responseA = responsesOf(project, slideId)[0]
    if (!responseA) throw new Error('setup inválido')

    project = updateResponse(project, slideId, responseA.id, {
      effects: [{ variableId: VARIABLE_ID, operation: 'set', value: 1 }],
      condition: { variableId: VARIABLE_ID, operator: '==', value: true },
    })
    let found = responsesOf(project, slideId).find((r) => r.id === responseA.id)
    expect(found?.effects).toEqual([{ variableId: VARIABLE_ID, operation: 'set', value: 1 }])
    expect(found?.condition).toEqual({ variableId: VARIABLE_ID, operator: '==', value: true })

    // Un segundo `updateResponse` con una lista distinta REEMPLAZA, no añade.
    project = updateResponse(project, slideId, responseA.id, {
      effects: [{ variableId: VARIABLE_ID, operation: 'increment', value: 2 }],
    })
    found = responsesOf(project, slideId).find((r) => r.id === responseA.id)
    expect(found?.effects).toEqual([{ variableId: VARIABLE_ID, operation: 'increment', value: 2 }])
  })

  it('borra effects/condition con null', () => {
    const { project: initial, slideId } = withSlide()
    let project = addResponse(initial, slideId)
    const responseA = responsesOf(project, slideId)[0]
    if (!responseA) throw new Error('setup inválido')

    project = updateResponse(project, slideId, responseA.id, {
      effects: [{ variableId: VARIABLE_ID, operation: 'set', value: 1 }],
      condition: { variableId: VARIABLE_ID, operator: '==', value: true },
    })
    project = updateResponse(project, slideId, responseA.id, { effects: null, condition: null })

    const found = responsesOf(project, slideId).find((r) => r.id === responseA.id)
    expect(found?.effects).toBeUndefined()
    expect(found?.condition).toBeUndefined()
  })
})

describe('moveResponse (petición de usuario: "que te deje cambiar el orden como quieras")', () => {
  /** Diapositiva con 3 respuestas A/B/C (en ese orden de creación). */
  function withThreeResponses(): { project: ProjectDocument; slideId: string; ids: string[] } {
    const { project: initial, slideId } = withSlide()
    let project = initial
    project = addResponse(project, slideId)
    project = addResponse(project, slideId)
    project = addResponse(project, slideId)
    const ids = responsesOf(project, slideId).map((r) => r.id)
    return { project, slideId, ids }
  }

  it('mueve una respuesta a una posición posterior, sin tocar id/letra de ninguna', () => {
    const { project: initial, slideId, ids } = withThreeResponses()
    const [a, b, c] = ids as [string, string, string]

    const project = moveResponse(initial, slideId, a, 2)

    const responses = responsesOf(project, slideId)
    expect(responses.map((r) => r.id)).toEqual([b, c, a])
    // Letras intactas: solo cambia el orden, nunca el identificador.
    expect(responses.map((r) => r.letter).sort()).toEqual(['A', 'B', 'C'])
    // Inmutabilidad: el proyecto original no se toca.
    expect(responsesOf(initial, slideId).map((r) => r.id)).toEqual([a, b, c])
  })

  it('mueve una respuesta a una posición anterior', () => {
    const { project: initial, slideId, ids } = withThreeResponses()
    const [a, b, c] = ids as [string, string, string]

    const project = moveResponse(initial, slideId, c, 0)

    expect(responsesOf(project, slideId).map((r) => r.id)).toEqual([c, a, b])
  })

  it('un índice fuera de rango se recorta al primer/último hueco válido, en vez de lanzar', () => {
    const { project: initial, slideId, ids } = withThreeResponses()
    const [a, b, c] = ids as [string, string, string]

    const movedPastEnd = moveResponse(initial, slideId, a, 999)
    expect(responsesOf(movedPastEnd, slideId).map((r) => r.id)).toEqual([b, c, a])

    const movedBeforeStart = moveResponse(initial, slideId, c, -5)
    expect(responsesOf(movedBeforeStart, slideId).map((r) => r.id)).toEqual([c, a, b])
  })

  it('lanza si la respuesta no existe, o si el nodo no es una diapositiva', () => {
    const { project, slideId } = withThreeResponses()
    let withFinal = createNode(project, 'final', { x: 200, y: 0 })
    const finalId = withFinal.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')

    expect(() => moveResponse(project, slideId, 'no-existe', 0)).toThrow()
    expect(() => moveResponse(withFinal, finalId, 'no-existe', 0)).toThrow()
  })
})
