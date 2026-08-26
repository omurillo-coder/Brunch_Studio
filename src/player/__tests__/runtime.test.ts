import { describe, expect, it } from 'vitest'
import {
  addResponse,
  addVariable,
  connect,
  createNode,
  createProject,
  updateNode,
  updateResponse,
  updateVariable,
} from '../../domain'
import type { DecisionResponse, ProjectDocument, VariableDef } from '../../domain'
import { advance, choose, getInitialState, getView, restart } from '../runtime'

/** Ids de los nodos del tipo pedido, en orden de aparición en el documento. */
function idsOf(project: ProjectDocument, type: 'slide' | 'final'): string[] {
  return project.graph.nodes.filter((node) => node.type === type).map((node) => node.id)
}

function responsesOf(project: ProjectDocument, nodeId: string): DecisionResponse[] {
  const node = project.graph.nodes.find((candidate) => candidate.id === nodeId)
  return node?.type === 'slide' ? node.responses : []
}

/**
 * Construye: inicio (continuar) -> diapositiva con respuestas -[A]-> final A
 *                                                            -[B]-> final B
 */
function buildFullGraph() {
  let project = createProject('P')
  project = createNode(project, 'slide', { x: 200, y: 0 }, { title: '¿Qué eliges?' })
  project = createNode(project, 'final', { x: 300, y: -50 }, { title: 'Final A', body: 'Llegaste a A' })
  project = createNode(project, 'final', { x: 300, y: 50 }, { title: 'Final B', body: 'Llegaste a B' })

  const startId = project.graph.startNodeId
  const decisionId = idsOf(project, 'slide').filter((id) => id !== startId)[0] as string
  const [finalAId, finalBId] = idsOf(project, 'final') as [string, string]

  project = connect(project, startId, decisionId)
  project = addResponse(project, decisionId) // A
  project = addResponse(project, decisionId) // B

  const responses = responsesOf(project, decisionId)
  const responseA = responses.find((r) => r.letter === 'A')
  const responseB = responses.find((r) => r.letter === 'B')
  if (!responseA || !responseB) throw new Error('setup inválido')

  project = connect(project, decisionId, finalAId, responseA.id)
  project = connect(project, decisionId, finalBId, responseB.id)

  return { project, startId, decisionId, finalAId, finalBId, responseA, responseB }
}

describe('runtime del Player', () => {
  it('el recorrido empieza en la diapositiva de inicio (ya no hay salto automático)', () => {
    const { project, startId } = buildFullGraph()

    const state = getInitialState(project)
    expect(state.currentNodeId).toBe(startId)

    const view = getView(project, state)
    expect(view.kind).toBe('continue')
  })

  it('recorrido completo: inicio -> diapositiva con respuestas -> (elige A) -> Final', () => {
    const { project, decisionId, finalAId, responseA } = buildFullGraph()

    let state = getInitialState(project)
    expect(getView(project, state).kind).toBe('continue')

    state = advance(project, state)
    expect(state.currentNodeId).toBe(decisionId)
    expect(getView(project, state).kind).toBe('decision')

    state = choose(project, state, responseA.id)
    expect(state.currentNodeId).toBe(finalAId)
    const finalView = getView(project, state)
    expect(finalView.kind).toBe('final')
    if (finalView.kind === 'final') {
      expect(finalView.node.id).toBe(finalAId)
    }
  })

  it('reiniciar y elegir la otra respuesta lleva a otro Final', () => {
    const { project, startId, finalBId, responseB } = buildFullGraph()

    let state = getInitialState(project)
    state = advance(project, state)
    state = choose(project, state, responseB.id)

    expect(state.currentNodeId).toBe(finalBId)

    const restarted = restart(project)
    expect(restarted).toEqual(getInitialState(project))
    expect(restarted.currentNodeId).toBe(startId)
    expect(getView(project, restarted).kind).toBe('continue')
  })

  it('dead-end: una diapositiva sin respuestas y sin destino', () => {
    const project = createProject('P') // inicio recién creado, sin target

    const state = getInitialState(project)
    expect(state.currentNodeId).toBe(project.graph.startNodeId)
    const view = getView(project, state)
    expect(view.kind).toBe('dead-end')
    expect(view.node?.id).toBe(project.graph.startNodeId)
  })

  it('dead-end: una diapositiva con respuestas pero ninguna con destino', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = addResponse(project, startId) // A, sin destino
    project = addResponse(project, startId) // B, sin destino

    const view = getView(project, getInitialState(project))
    expect(view.kind).toBe('dead-end')
  })

  it('dead-end: startNodeId que no apunta a ningún nodo', () => {
    const base = createProject('P')
    const project: ProjectDocument = {
      ...base,
      graph: { ...base.graph, startNodeId: '00000000-0000-4000-8000-000000000000' },
    }

    const state = getInitialState(project)
    expect(state.currentNodeId).toBeNull()
    expect(getView(project, state)).toEqual({ kind: 'dead-end', node: null })
  })

  it('una diapositiva con respuestas ignora su targetNodeId dormido', () => {
    let project = createNode(createProject('P'), 'final', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = idsOf(project, 'final')[0] as string
    project = connect(project, startId, finalId) // destino de "continuar"
    project = addResponse(project, startId) // pasa a modo decisión, sin destinos

    // Con respuestas, el destino de continuar no se usa: es un dead-end.
    expect(getView(project, getInitialState(project)).kind).toBe('dead-end')
    // Y `advance` tampoco lo sigue.
    const state = getInitialState(project)
    expect(advance(project, state)).toEqual(state)
  })

  it('elegir una respuesta sin destino no avanza (no-op)', () => {
    let project = createNode(createProject('P'), 'final', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = idsOf(project, 'final')[0] as string
    project = addResponse(project, startId) // A, sin destino
    project = addResponse(project, startId) // B

    const responses = responsesOf(project, startId)
    const responseA = responses.find((r) => r.letter === 'A')
    const responseB = responses.find((r) => r.letter === 'B')
    if (!responseA || !responseB) throw new Error('setup inválido')
    project = connect(project, startId, finalId, responseB.id)

    const state = getInitialState(project)
    expect(choose(project, state, responseA.id)).toEqual(state)
  })

  it('advance es un no-op si el nodo actual tiene respuestas', () => {
    const { project, decisionId } = buildFullGraph()
    let state = getInitialState(project)
    state = advance(project, state) // ahora en decisionId
    expect(advance(project, state)).toEqual({
      currentNodeId: decisionId,
      totalPoints: null,
      variables: {},
    })
  })

  it('advance es un no-op sobre un nodo final', () => {
    const { project, finalAId, responseA } = buildFullGraph()
    let state = getInitialState(project)
    state = advance(project, state)
    state = choose(project, state, responseA.id)
    expect(state.currentNodeId).toBe(finalAId)
    expect(advance(project, state)).toEqual(state)
  })
})

/**
 * Construye: inicio -[A, points=5]-> diapositiva 2 -[A, points=-2]-> final
 *                   -[B, sin points]               -[B, sin points]
 * Dos diapositivas con respuestas consecutivas para comprobar que `choose`
 * acumula a través de varias elecciones seguidas, no solo una.
 */
function buildTwoDecisionsGraph() {
  let project = createProject('P')
  project = createNode(project, 'slide', { x: 200, y: 0 })
  project = createNode(project, 'final', { x: 300, y: 0 })

  const decision1Id = project.graph.startNodeId
  const decision2Id = idsOf(project, 'slide').filter((id) => id !== decision1Id)[0] as string
  const finalId = idsOf(project, 'final')[0] as string

  project = addResponse(project, decision1Id) // A
  project = addResponse(project, decision1Id) // B
  project = addResponse(project, decision2Id) // A
  project = addResponse(project, decision2Id) // B

  const responses1 = responsesOf(project, decision1Id)
  const response1A = responses1.find((r) => r.letter === 'A')
  const response1B = responses1.find((r) => r.letter === 'B')
  if (!response1A || !response1B) throw new Error('setup inválido')

  // A1 tiene puntuación (5), B1 no define puntuación en absoluto.
  project = updateResponse(project, decision1Id, response1A.id, { points: 5 })
  project = connect(project, decision1Id, decision2Id, response1A.id)
  project = connect(project, decision1Id, decision2Id, response1B.id)

  const responses2 = responsesOf(project, decision2Id)
  const response2A = responses2.find((r) => r.letter === 'A')
  const response2B = responses2.find((r) => r.letter === 'B')
  if (!response2A || !response2B) throw new Error('setup inválido')

  // A2 tiene puntuación negativa (-2), B2 no define puntuación.
  project = updateResponse(project, decision2Id, response2A.id, { points: -2 })
  project = connect(project, decision2Id, finalId, response2A.id)
  project = connect(project, decision2Id, finalId, response2B.id)

  return { project, decision1Id, decision2Id, finalId, response1A, response1B, response2A, response2B }
}

describe('runtime del Player: puntuación acumulada (totalPoints)', () => {
  it('getInitialState/restart arrancan con totalPoints en null', () => {
    const { project } = buildTwoDecisionsGraph()
    expect(getInitialState(project).totalPoints).toBeNull()
    expect(restart(project).totalPoints).toBeNull()
  })

  it('choose acumula puntos a través de varias decisiones consecutivas', () => {
    const { project, response1A, response2A } = buildTwoDecisionsGraph()

    let state = getInitialState(project)
    expect(state.totalPoints).toBeNull()

    state = choose(project, state, response1A.id)
    expect(state.totalPoints).toBe(5)

    state = choose(project, state, response2A.id)
    expect(state.totalPoints).toBe(3) // 5 + (-2)
  })

  it('una respuesta sin "points" definido no altera el total acumulado', () => {
    const { project, response1A, response2B } = buildTwoDecisionsGraph()

    let state = getInitialState(project)
    state = choose(project, state, response1A.id) // +5
    expect(state.totalPoints).toBe(5)

    state = choose(project, state, response2B.id) // sin points: no cambia
    expect(state.totalPoints).toBe(5)
  })

  it('totalPoints permanece en null si ninguna respuesta elegida en el camino define "points"', () => {
    const { project, response1B, response2B } = buildTwoDecisionsGraph()

    let state = getInitialState(project)
    state = choose(project, state, response1B.id)
    expect(state.totalPoints).toBeNull()

    state = choose(project, state, response2B.id)
    expect(state.totalPoints).toBeNull()
  })

  it('restart reinicia totalPoints a null tras haber acumulado puntuación', () => {
    const { project, response1A } = buildTwoDecisionsGraph()

    let state = getInitialState(project)
    state = choose(project, state, response1A.id)
    expect(state.totalPoints).toBe(5)

    expect(restart(project).totalPoints).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Variables/condiciones (FASE 3 del milestone "Variables/condiciones")
// ---------------------------------------------------------------------------

/** Añade dos variables (una numérica, una booleana) a un proyecto recién
 *  creado y devuelve sus `VariableDef` para que los tests puedan construir
 *  efectos/condiciones que las referencien por id. */
function withTwoVariables(): {
  project: ProjectDocument
  counter: VariableDef
  flag: VariableDef
} {
  let project = createProject('P')
  project = addVariable(project, { name: 'contador', type: 'number', initialValue: 3 })
  project = addVariable(project, { name: 'activo', type: 'boolean', initialValue: false })
  const [counter, flag] = project.variables as [VariableDef, VariableDef]
  return { project, counter, flag }
}

describe('runtime del Player: siembra y reinicio de variables', () => {
  it('getInitialState siembra state.variables a partir de project.variables (initialValue)', () => {
    const { project, counter, flag } = withTwoVariables()

    const state = getInitialState(project)
    expect(state.variables).toEqual({ [counter.id]: 3, [flag.id]: false })
  })

  it('un proyecto sin variables arranca con state.variables = {}', () => {
    const project = createProject('P')
    expect(getInitialState(project).variables).toEqual({})
  })

  it('restart reinicia las variables a su initialValue tras haberlas modificado', () => {
    let { project, counter } = withTwoVariables()
    project = createNode(project, 'final', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = project.graph.nodes.find((node) => node.type === 'final')!.id
    project = addResponse(project, startId)
    const responseA = responsesOf(project, startId).find((r) => r.letter === 'A')
    if (!responseA) throw new Error('setup inválido')
    project = connect(project, startId, finalId, responseA.id)
    project = updateResponse(project, startId, responseA.id, {
      effects: [{ variableId: counter.id, operation: 'set', value: 99 }],
    })

    let state = getInitialState(project)
    state = choose(project, state, responseA.id)
    expect(state.variables[counter.id]).toBe(99)

    const restarted = restart(project)
    expect(restarted.variables[counter.id]).toBe(3)
    expect(restarted).toEqual(getInitialState(project))
  })
})

describe('runtime del Player: choose aplica efectos sobre variables', () => {
  /** inicio -[A]-> final, con la respuesta A cargada de efectos numéricos y
   *  booleanos sobre las dos variables de `withTwoVariables()`. */
  function buildEffectsGraph() {
    const { project: base, counter, flag } = withTwoVariables()
    let project = createNode(base, 'final', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = project.graph.nodes.find((node) => node.type === 'final')!.id
    project = addResponse(project, startId)
    const responseA = responsesOf(project, startId).find((r) => r.letter === 'A')
    if (!responseA) throw new Error('setup inválido')
    project = connect(project, startId, finalId, responseA.id)
    return { project, startId, finalId, responseA, counter, flag }
  }

  it('"set" numérico fija el valor exacto en state.variables', () => {
    let { project, startId, responseA, counter } = buildEffectsGraph()
    project = updateResponse(project, startId, responseA.id, {
      effects: [{ variableId: counter.id, operation: 'set', value: 42 }],
    })

    const next = choose(project, getInitialState(project), responseA.id)
    expect(next.variables[counter.id]).toBe(42)
  })

  it('"increment"/"decrement" suman/restan sobre el valor numérico actual', () => {
    let { project, startId, responseA, counter } = buildEffectsGraph()
    project = updateResponse(project, startId, responseA.id, {
      effects: [{ variableId: counter.id, operation: 'increment', value: 4 }],
    })
    let next = choose(project, getInitialState(project), responseA.id)
    expect(next.variables[counter.id]).toBe(7) // 3 + 4

    project = updateResponse(project, startId, responseA.id, {
      effects: [{ variableId: counter.id, operation: 'decrement', value: 5 }],
    })
    next = choose(project, getInitialState(project), responseA.id)
    expect(next.variables[counter.id]).toBe(-2) // 3 - 5
  })

  it('"set" booleano fija el flag', () => {
    let { project, startId, responseA, flag } = buildEffectsGraph()
    project = updateResponse(project, startId, responseA.id, {
      effects: [{ variableId: flag.id, operation: 'set', value: true }],
    })

    const next = choose(project, getInitialState(project), responseA.id)
    expect(next.variables[flag.id]).toBe(true)
  })

  it('una respuesta sin "effects" deja state.variables intacto', () => {
    const { project, responseA, counter, flag } = buildEffectsGraph()
    const state = getInitialState(project)

    const next = choose(project, state, responseA.id)
    expect(next.variables).toEqual({ [counter.id]: 3, [flag.id]: false })
  })

  it('totalPoints (puntuación) y variables no se mezclan: choose actualiza ambos de forma independiente', () => {
    let { project, startId, responseA, counter } = buildEffectsGraph()
    project = updateResponse(project, startId, responseA.id, {
      points: 10,
      effects: [{ variableId: counter.id, operation: 'increment', value: 1 }],
    })

    const next = choose(project, getInitialState(project), responseA.id)
    expect(next.totalPoints).toBe(10)
    expect(next.variables[counter.id]).toBe(4)
  })
})

describe('runtime del Player: filtrado de respuestas por condición', () => {
  /** inicio con dos respuestas (A -[final A], B -[final B]); A lleva una
   *  `condition` sobre `flag`, B no lleva ninguna. */
  function buildConditionalDecisionGraph() {
    const { project: base, flag } = withTwoVariables()
    let project = createNode(base, 'final', { x: 200, y: -50 })
    project = createNode(project, 'final', { x: 200, y: 50 })
    const startId = project.graph.startNodeId
    const finals = project.graph.nodes.filter((node) => node.type === 'final')
    const finalAId = finals[0]!.id
    const finalBId = finals[1]!.id

    project = addResponse(project, startId) // A
    project = addResponse(project, startId) // B
    const startNode = project.graph.nodes.find((node) => node.id === startId)
    const responseA = startNode?.type === 'slide' ? startNode.responses.find((r) => r.letter === 'A') : undefined
    const responseB = startNode?.type === 'slide' ? startNode.responses.find((r) => r.letter === 'B') : undefined
    if (!responseA || !responseB) throw new Error('setup inválido')

    project = connect(project, startId, finalAId, responseA.id)
    project = connect(project, startId, finalBId, responseB.id)
    project = updateResponse(project, startId, responseA.id, {
      condition: { variableId: flag.id, operator: '==', value: true },
    })

    return { project, startId, responseA, responseB, flag }
  }

  it('una respuesta con condición no cumplida no aparece en visibleResponses', () => {
    const { project, responseB } = buildConditionalDecisionGraph()

    const view = getView(project, getInitialState(project)) // flag = false por defecto
    expect(view.kind).toBe('decision')
    if (view.kind === 'decision') {
      expect(view.visibleResponses.map((response) => response.id)).toEqual([responseB.id])
    }
  })

  it('cuando la condición se cumple, la respuesta sí aparece en visibleResponses', () => {
    let { project, responseA, responseB, flag } = buildConditionalDecisionGraph()
    // Fuerza flag=true cambiando su initialValue (no hay otro nodo de origen
    // desde el que aplicar un efecto en este grafo mínimo).
    project = updateVariable(project, flag.id, { initialValue: true })

    const view = getView(project, getInitialState(project))
    expect(view.kind).toBe('decision')
    if (view.kind === 'decision') {
      expect(view.visibleResponses.map((response) => response.id).sort()).toEqual(
        [responseA.id, responseB.id].sort(),
      )
    }
  })

  it('una respuesta sin "condition" siempre se muestra (comportamiento actual, sin cambios)', () => {
    const { project, responseB } = buildConditionalDecisionGraph()
    const view = getView(project, getInitialState(project))
    expect(view.kind).toBe('decision')
    if (view.kind === 'decision') {
      expect(view.visibleResponses.some((response) => response.id === responseB.id)).toBe(true)
    }
  })

  it('si TODAS las respuestas quedan filtradas por condición, la vista es dead-end', () => {
    const { project: base, flag } = withTwoVariables()
    let project = createNode(base, 'final', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = project.graph.nodes.find((node) => node.type === 'final')!.id
    project = addResponse(project, startId)
    const responseA = responsesOf(project, startId).find((r) => r.letter === 'A')
    if (!responseA) throw new Error('setup inválido')
    project = connect(project, startId, finalId, responseA.id)
    project = updateResponse(project, startId, responseA.id, {
      condition: { variableId: flag.id, operator: '==', value: true }, // flag=false: nunca se cumple
    })

    const view = getView(project, getInitialState(project))
    expect(view.kind).toBe('dead-end')
  })

  it('elegir la respuesta visible (B) sigue navegando y aplicando sus efectos con normalidad', () => {
    const { project, responseB } = buildConditionalDecisionGraph()
    const next = choose(project, getInitialState(project), responseB.id)
    expect(next.currentNodeId).not.toBeNull()
  })
})

describe('runtime del Player: enrutado condicional de una diapositiva "de continuar"', () => {
  /** inicio ("de continuar", condición sobre `flag`) -> Final VERDADERO
   *                                                   -> Final FALSO (elseTargetNodeId) */
  function buildConditionalContinueGraph() {
    const { project: base, flag } = withTwoVariables()
    let project = createNode(base, 'final', { x: 200, y: -50 })
    project = createNode(project, 'final', { x: 200, y: 50 })
    const startId = project.graph.startNodeId
    const finals = project.graph.nodes.filter((node) => node.type === 'final')
    const finalTrueId = finals[0]!.id
    const finalFalseId = finals[1]!.id

    project = connect(project, startId, finalTrueId) // targetNodeId = rama VERDADERA
    project = updateNode(project, startId, {
      condition: { variableId: flag.id, operator: '==', value: true },
      elseTargetNodeId: finalFalseId,
    })

    return { project, startId, finalTrueId, finalFalseId, flag }
  }

  it('condición VERDADERA: getView es "continue" y advance/choose llevan a targetNodeId', () => {
    let { project, startId, finalTrueId, flag } = buildConditionalContinueGraph()
    project = updateVariable(project, flag.id, { initialValue: true })

    const state = getInitialState(project)
    expect(getView(project, state).kind).toBe('continue')

    const next = advance(project, state)
    expect(next.currentNodeId).toBe(finalTrueId)
    expect(next.currentNodeId).not.toBe(startId)
  })

  it('condición FALSA: getView es "continue" y advance lleva a elseTargetNodeId', () => {
    const { project, startId, finalFalseId } = buildConditionalContinueGraph()

    // flag = false (initialValue por defecto de withTwoVariables): condición falsa.
    const state = getInitialState(project)
    expect(getView(project, state).kind).toBe('continue')

    const next = advance(project, state)
    expect(next.currentNodeId).toBe(finalFalseId)
    expect(next.currentNodeId).not.toBe(startId)
  })

  it('sin "condition", el comportamiento es exactamente el de siempre (regresión)', () => {
    const { project } = buildFullGraph()
    // buildFullGraph ya cubre el caso "de continuar" sin condición: el
    // destino es siempre targetNodeId, sin evaluar nada. Repetido aquí de
    // forma explícita para dejar constancia de la regresión cubierta.
    const state = getInitialState(project)
    const view = getView(project, state)
    expect(view.kind).toBe('continue')
    const next = advance(project, state)
    expect(next.currentNodeId).not.toBeNull()
  })

  it('sin "elseTargetNodeId" y condición FALSA: dead-end (destino ausente, mismo criterio que cualquier otro)', () => {
    let { project, startId } = buildConditionalContinueGraph()
    project = updateNode(project, startId, { elseTargetNodeId: null })

    // flag = false (initialValue por defecto): condición falsa, y ahora sin
    // elseTargetNodeId al que ir.
    const state = getInitialState(project)
    expect(getView(project, state).kind).toBe('dead-end')
    expect(advance(project, state)).toEqual(state)
  })
})
