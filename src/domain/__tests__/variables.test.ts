import { describe, expect, it } from 'vitest'
import { applyVariableEffects, evaluateCondition, resolveSlideTarget } from '../variables'
import type { VariableState } from '../variables'
import type { SlideNode, VariableCondition, VariableEffect } from '../schemas'

const VAR_NUM = 'var-numero'
const VAR_BOOL = 'var-booleana'

describe('applyVariableEffects', () => {
  it('"set" fija el valor, numérico o booleano, sustituyendo el anterior', () => {
    const state: VariableState = { [VAR_NUM]: 1, [VAR_BOOL]: false }
    const effects: VariableEffect[] = [
      { variableId: VAR_NUM, operation: 'set', value: 99 },
      { variableId: VAR_BOOL, operation: 'set', value: true },
    ]
    expect(applyVariableEffects(state, effects)).toEqual({ [VAR_NUM]: 99, [VAR_BOOL]: true })
  })

  it('"set" sobre una variable ausente del estado la crea', () => {
    const result = applyVariableEffects({}, [{ variableId: VAR_NUM, operation: 'set', value: 5 }])
    expect(result).toEqual({ [VAR_NUM]: 5 })
  })

  it('"increment"/"decrement" suman/restan sobre una variable numérica', () => {
    const state: VariableState = { [VAR_NUM]: 10 }
    expect(
      applyVariableEffects(state, [{ variableId: VAR_NUM, operation: 'increment', value: 3 }]),
    ).toEqual({ [VAR_NUM]: 13 })
    expect(
      applyVariableEffects(state, [{ variableId: VAR_NUM, operation: 'decrement', value: 4 }]),
    ).toEqual({ [VAR_NUM]: 6 })
  })

  it('"increment"/"decrement" sobre una variable booleana es un no-op silencioso', () => {
    const state: VariableState = { [VAR_BOOL]: true }
    const result = applyVariableEffects(state, [
      { variableId: VAR_BOOL, operation: 'increment', value: 1 },
    ])
    expect(result).toEqual({ [VAR_BOOL]: true })
  })

  it('"increment"/"decrement" sobre una variable ausente del estado es un no-op silencioso', () => {
    const result = applyVariableEffects({}, [
      { variableId: VAR_NUM, operation: 'increment', value: 1 },
    ])
    expect(result).toEqual({})
  })

  it('aplica varios efectos en orden; si dos tocan la misma variable, gana el último', () => {
    const result = applyVariableEffects(
      { [VAR_NUM]: 0 },
      [
        { variableId: VAR_NUM, operation: 'set', value: 10 },
        { variableId: VAR_NUM, operation: 'increment', value: 5 },
        { variableId: VAR_NUM, operation: 'set', value: 1 },
      ],
    )
    expect(result).toEqual({ [VAR_NUM]: 1 })
  })

  it('no muta el estado recibido (pura)', () => {
    const state: VariableState = { [VAR_NUM]: 1 }
    applyVariableEffects(state, [{ variableId: VAR_NUM, operation: 'set', value: 2 }])
    expect(state).toEqual({ [VAR_NUM]: 1 })
  })

  it('sin efectos, devuelve un estado equivalente', () => {
    const state: VariableState = { [VAR_NUM]: 7 }
    expect(applyVariableEffects(state, [])).toEqual(state)
  })
})

describe('evaluateCondition', () => {
  function cond(operator: VariableCondition['operator'], value: number | boolean): VariableCondition {
    return { variableId: VAR_NUM, operator, value }
  }

  it('los seis operadores sobre variables numéricas', () => {
    const state: VariableState = { [VAR_NUM]: 5 }
    expect(evaluateCondition(state, cond('==', 5))).toBe(true)
    expect(evaluateCondition(state, cond('==', 4))).toBe(false)
    expect(evaluateCondition(state, cond('!=', 4))).toBe(true)
    expect(evaluateCondition(state, cond('!=', 5))).toBe(false)
    expect(evaluateCondition(state, cond('>', 4))).toBe(true)
    expect(evaluateCondition(state, cond('>', 5))).toBe(false)
    expect(evaluateCondition(state, cond('>=', 5))).toBe(true)
    expect(evaluateCondition(state, cond('>=', 6))).toBe(false)
    expect(evaluateCondition(state, cond('<', 6))).toBe(true)
    expect(evaluateCondition(state, cond('<', 5))).toBe(false)
    expect(evaluateCondition(state, cond('<=', 5))).toBe(true)
    expect(evaluateCondition(state, cond('<=', 4))).toBe(false)
  })

  it('==/!= sobre variables booleanas', () => {
    const state: VariableState = { [VAR_BOOL]: true }
    expect(
      evaluateCondition(state, { variableId: VAR_BOOL, operator: '==', value: true }),
    ).toBe(true)
    expect(
      evaluateCondition(state, { variableId: VAR_BOOL, operator: '==', value: false }),
    ).toBe(false)
    expect(
      evaluateCondition(state, { variableId: VAR_BOOL, operator: '!=', value: false }),
    ).toBe(true)
  })

  it('operadores de orden sobre una variable booleana evalúan a false (nunca lanzan)', () => {
    const state: VariableState = { [VAR_BOOL]: true }
    expect(evaluateCondition(state, { variableId: VAR_BOOL, operator: '>', value: 0 })).toBe(false)
    expect(evaluateCondition(state, { variableId: VAR_BOOL, operator: '<=', value: 1 })).toBe(false)
  })

  it('variable ausente del estado: == siempre false, != siempre true, orden siempre false', () => {
    expect(evaluateCondition({}, cond('==', 5))).toBe(false)
    expect(evaluateCondition({}, cond('!=', 5))).toBe(true)
    expect(evaluateCondition({}, cond('>', 0))).toBe(false)
  })
})

describe('resolveSlideTarget', () => {
  const baseSlide: SlideNode = {
    id: 'slide-1',
    number: 1,
    position: { x: 0, y: 0 },
    title: '',
    body: '',
    type: 'slide',
    responses: [],
    imageAssetIds: [],
    contentOrder: 'text-first',
    targetNodeId: 'target-si',
    elseTargetNodeId: 'target-no',
  }

  it('sin condition, devuelve siempre targetNodeId (comportamiento actual intacto)', () => {
    const slide: SlideNode = { ...baseSlide, condition: undefined }
    expect(resolveSlideTarget(slide, {})).toBe('target-si')
  })

  it('con condition verdadera, devuelve targetNodeId', () => {
    const slide: SlideNode = {
      ...baseSlide,
      condition: { variableId: VAR_NUM, operator: '>=', value: 5 },
    }
    expect(resolveSlideTarget(slide, { [VAR_NUM]: 10 })).toBe('target-si')
  })

  it('con condition falsa, devuelve elseTargetNodeId', () => {
    const slide: SlideNode = {
      ...baseSlide,
      condition: { variableId: VAR_NUM, operator: '>=', value: 5 },
    }
    expect(resolveSlideTarget(slide, { [VAR_NUM]: 1 })).toBe('target-no')
  })

  it('con condition falsa y sin elseTargetNodeId, devuelve undefined', () => {
    const slide: SlideNode = {
      ...baseSlide,
      elseTargetNodeId: undefined,
      condition: { variableId: VAR_NUM, operator: '>=', value: 5 },
    }
    expect(resolveSlideTarget(slide, { [VAR_NUM]: 1 })).toBeUndefined()
  })

  it('una diapositiva de decisión (con respuestas) devuelve undefined: no aplica', () => {
    const decisionSlide: SlideNode = {
      ...baseSlide,
      responses: [{ id: 'r1', letter: 'A', text: 'Opción' }],
    }
    expect(resolveSlideTarget(decisionSlide, {})).toBeUndefined()
  })
})
