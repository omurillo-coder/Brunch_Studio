import { describe, expect, it } from 'vitest'
import {
  DecisionResponseSchema,
  ProjectDocumentSchema,
  SlideNodeSchema,
  VariableConditionSchema,
  VariableDefSchema,
  VariableEffectSchema,
} from '../schemas'
import { createProject } from '../project'

const VARIABLE_ID = '11111111-1111-4111-8111-111111111111'
const NODE_ID = '22222222-2222-4222-8222-222222222222'

describe('VariableDefSchema', () => {
  it('acepta una variable numérica y una booleana válidas', () => {
    expect(
      VariableDefSchema.safeParse({
        id: VARIABLE_ID,
        name: 'puntos_empatia',
        type: 'number',
        initialValue: 0,
      }).success,
    ).toBe(true)

    expect(
      VariableDefSchema.safeParse({
        id: VARIABLE_ID,
        name: 'ha_hablado_con_cliente',
        type: 'boolean',
        initialValue: false,
      }).success,
    ).toBe(true)
  })

  it('rechaza un tipo desconocido', () => {
    expect(
      VariableDefSchema.safeParse({
        id: VARIABLE_ID,
        name: 'x',
        type: 'string',
        initialValue: 'hola',
      }).success,
    ).toBe(false)
  })

  it('rechaza un id que no es uuid', () => {
    expect(
      VariableDefSchema.safeParse({
        id: 'no-es-un-uuid',
        name: 'x',
        type: 'number',
        initialValue: 0,
      }).success,
    ).toBe(false)
  })

  it('el schema NO valida que initialValue case con type (ver comentario del schema): un number con type "boolean" parsea igual', () => {
    // Documentado deliberadamente: la coherencia tipo/valor es
    // responsabilidad del dominio (`addVariable`/`updateVariable`), no del
    // schema Zod, porque a nivel de schema ambos campos viven en el mismo
    // objeto y técnicamente SÍ se podría cruzar... pero se opta por no
    // hacerlo aquí para no acoplar el schema Zod a lógica condicional de
    // campos, manteniéndolo simétrico con `VariableCondition`/`VariableEffect`
    // (donde el cruce SÍ requeriría datos externos al objeto). Ver
    // `src/domain/__tests__/project.test.ts` para la validación real en
    // `addVariable`/`updateVariable`.
    const result = VariableDefSchema.safeParse({
      id: VARIABLE_ID,
      name: 'x',
      type: 'boolean',
      initialValue: 42,
    })
    expect(result.success).toBe(true)
  })
})

describe('VariableConditionSchema', () => {
  it('acepta los seis operadores de comparación', () => {
    for (const operator of ['==', '!=', '>', '>=', '<', '<=']) {
      expect(
        VariableConditionSchema.safeParse({ variableId: VARIABLE_ID, operator, value: 5 }).success,
      ).toBe(true)
    }
  })

  it('rechaza un operador desconocido', () => {
    expect(
      VariableConditionSchema.safeParse({
        variableId: VARIABLE_ID,
        operator: '=',
        value: 5,
      }).success,
    ).toBe(false)
  })

  it('acepta value numérico o booleano', () => {
    expect(
      VariableConditionSchema.safeParse({ variableId: VARIABLE_ID, operator: '==', value: true })
        .success,
    ).toBe(true)
  })
})

describe('VariableEffectSchema', () => {
  it('acepta "set" con value number o boolean', () => {
    expect(
      VariableEffectSchema.safeParse({ variableId: VARIABLE_ID, operation: 'set', value: 3 })
        .success,
    ).toBe(true)
    expect(
      VariableEffectSchema.safeParse({ variableId: VARIABLE_ID, operation: 'set', value: true })
        .success,
    ).toBe(true)
  })

  it('acepta "increment"/"decrement" solo con value numérico', () => {
    expect(
      VariableEffectSchema.safeParse({
        variableId: VARIABLE_ID,
        operation: 'increment',
        value: 1,
      }).success,
    ).toBe(true)
    expect(
      VariableEffectSchema.safeParse({
        variableId: VARIABLE_ID,
        operation: 'decrement',
        value: 1,
      }).success,
    ).toBe(true)
  })

  it('rechaza "increment"/"decrement" con value booleano', () => {
    expect(
      VariableEffectSchema.safeParse({
        variableId: VARIABLE_ID,
        operation: 'increment',
        value: true,
      }).success,
    ).toBe(false)
  })

  it('rechaza una operation desconocida', () => {
    expect(
      VariableEffectSchema.safeParse({ variableId: VARIABLE_ID, operation: 'multiply', value: 2 })
        .success,
    ).toBe(false)
  })
})

describe('DecisionResponseSchema — effects/condition opcionales', () => {
  const base = {
    id: '33333333-3333-4333-8333-333333333333',
    letter: 'A' as const,
    text: 'Opción',
  }

  it('acepta una respuesta sin effects/condition (compatibilidad con el modelo actual)', () => {
    expect(DecisionResponseSchema.safeParse(base).success).toBe(true)
  })

  it('acepta una respuesta con effects y condition', () => {
    const result = DecisionResponseSchema.safeParse({
      ...base,
      effects: [{ variableId: VARIABLE_ID, operation: 'set', value: 1 }],
      condition: { variableId: VARIABLE_ID, operator: '==', value: true },
    })
    expect(result.success).toBe(true)
  })

  it('rechaza un effect inválido dentro de la lista', () => {
    const result = DecisionResponseSchema.safeParse({
      ...base,
      effects: [{ variableId: VARIABLE_ID, operation: 'increment', value: true }],
    })
    expect(result.success).toBe(false)
  })
})

describe('SlideNodeSchema — condition/elseTargetNodeId opcionales', () => {
  const base = {
    id: NODE_ID,
    number: 1,
    position: { x: 0, y: 0 },
    title: '',
    body: '',
    type: 'slide' as const,
    responses: [],
    imageAssetIds: [],
    contentOrder: 'text-first' as const,
  }

  it('acepta una diapositiva sin condition/elseTargetNodeId (comportamiento actual intacto)', () => {
    expect(SlideNodeSchema.safeParse(base).success).toBe(true)
  })

  it('acepta condition + elseTargetNodeId junto a targetNodeId', () => {
    const result = SlideNodeSchema.safeParse({
      ...base,
      targetNodeId: '44444444-4444-4444-8444-444444444444',
      elseTargetNodeId: '55555555-5555-4555-8555-555555555555',
      condition: { variableId: VARIABLE_ID, operator: '>=', value: 3 },
    })
    expect(result.success).toBe(true)
  })

  it('rechaza un elseTargetNodeId que no es uuid', () => {
    const result = SlideNodeSchema.safeParse({ ...base, elseTargetNodeId: 'no-es-uuid' })
    expect(result.success).toBe(false)
  })
})

describe('ProjectDocumentSchema.variables', () => {
  it('un documento con variables válidas parsea correctamente', () => {
    const project = createProject('P')
    const withVariable = {
      ...project,
      variables: [{ id: VARIABLE_ID, name: 'contador', type: 'number', initialValue: 0 }],
    }
    const result = ProjectDocumentSchema.safeParse(withVariable)
    expect(result.success).toBe(true)
  })

  it('un documento con una variable inválida (type desconocido) no parsea', () => {
    const project = createProject('P')
    const withInvalidVariable = {
      ...project,
      variables: [{ id: VARIABLE_ID, name: 'x', type: 'text', initialValue: 'y' }],
    }
    expect(ProjectDocumentSchema.safeParse(withInvalidVariable).success).toBe(false)
  })

  it('sin el campo `variables`, el documento parsea igualmente con variables: [] por defecto', () => {
    const project = createProject('P')
    const { variables: _variables, ...withoutVariables } = project
    const result = ProjectDocumentSchema.safeParse(withoutVariables)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.variables).toEqual([])
    }
  })
})
