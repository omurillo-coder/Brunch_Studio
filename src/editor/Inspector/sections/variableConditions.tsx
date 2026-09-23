import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { COMPARISON_OPERATORS } from '../../../domain'
import type {
  ComparisonOperator,
  VariableCondition,
  VariableDef,
  VariableEffect,
} from '../../../domain'
import styles from '../Inspector.module.css'

/**
 * ---------------------------------------------------------------------------
 * Variables/condiciones (fase 2 del milestone): controles compartidos por la
 * condición de visibilidad de una respuesta (Tarea 2), los efectos de una
 * respuesta (Tarea 2) y el enrutado condicional de una diapositiva "de
 * continuar" (Tarea 3).
 * ---------------------------------------------------------------------------
 *
 * `ConditionEditor` y `EffectRow` (definidos más abajo) llaman a
 * `onChange`/`onChange(index, ...)` con el objeto COMPLETO ya construido en
 * cada cambio de `<select>` (variable/operador/operación) — no hay "commit on
 * blur" para esos controles porque un `<select>` no tiene un estado
 * intermedio que proteger de spam de historial (a diferencia de un campo de
 * texto). Solo el campo de VALOR numérico usa el patrón "commit on blur"
 * habitual del resto del Inspector (estado local + confirmación en
 * blur/Enter), para no generar una entrada de historial por cada dígito
 * tecleado.
 */

/** Valor de partida razonable al crear una condición/efecto nuevo sobre una
 *  variable: `0` para una numérica, `false` para una booleana. */
export function defaultValueForVariable(variable: VariableDef): number | boolean {
  return variable.type === 'boolean' ? false : 0
}

/** Operadores de comparación con sentido sobre una variable booleana: solo
 *  igualdad/desigualdad (ver comentario de `ComparisonOperatorSchema` en
 *  `src/domain/schemas.ts` — el dominio no lo prohíbe a nivel de schema,
 *  pero la UI no tiene motivo para ofrecer `>`/`>=`/`<`/`<=` ahí). */
const BOOLEAN_OPERATORS: ComparisonOperator[] = ['==', '!=']

export function operatorsForVariable(variable: VariableDef): readonly ComparisonOperator[] {
  return variable.type === 'boolean' ? BOOLEAN_OPERATORS : COMPARISON_OPERATORS
}

const OPERATOR_LABEL: Record<ComparisonOperator, string> = {
  '==': 'es igual a',
  '!=': 'es distinto de',
  '>': 'es mayor que',
  '>=': 'es mayor o igual que',
  '<': 'es menor que',
  '<=': 'es menor o igual que',
}

const EFFECT_OPERATION_LABEL: Record<VariableEffect['operation'], string> = {
  set: 'fijar a',
  increment: 'sumar',
  decrement: 'restar',
}

/** Construye un `VariableEffect` bien tipado para la unión discriminada por
 *  `operation`: `increment`/`decrement` exigen un `value` `number` (si se
 *  pasa uno no numérico —no debería ocurrir desde esta UI— se sustituye por
 *  `0` en vez de dejar pasar un valor incoherente con el schema). */
export function makeEffect(
  variableId: string,
  operation: VariableEffect['operation'],
  value: number | boolean,
): VariableEffect {
  if (operation === 'set') return { variableId, operation: 'set', value }
  return { variableId, operation, value: typeof value === 'number' ? value : 0 }
}

/**
 * Editor de una `VariableCondition`: selector de variable, selector de
 * operador (acotado a `==`/`!=` si la variable es booleana) y campo de
 * valor (número con "commit on blur", o `<select>` Sí/No si la variable es
 * booleana). `idPrefix` desambigua los `id`/`htmlFor` cuando hay varias
 * condiciones en pantalla a la vez (una por respuesta, más la del enrutado
 * condicional de la diapositiva).
 *
 * Cambiar de variable recalcula operador/valor si dejan de tener sentido
 * para el nuevo tipo (p.ej. pasar de una numérica en modo `>` a una
 * booleana resetea el operador a `==`), en vez de dejar guardada una
 * combinación sin sentido — aunque el dominio la tolere (evalúa a `false`,
 * nunca lanza, ver `evaluateCondition`), la UI evita ofrecerla activamente.
 */
export function ConditionEditor({
  condition,
  variables,
  onChange,
  onRemove,
  idPrefix,
  removeLabel = 'Quitar condición',
}: {
  condition: VariableCondition
  variables: VariableDef[]
  onChange: (next: VariableCondition) => void
  /** Opcional (petición de usuario, `FinalAlternateSection`: "que no haga
   *  falta darle a ningún botón... que siempre salga"): sin `onRemove`, el
   *  botón de quitar la condición no se pinta — esta condición no se puede
   *  desactivar desde aquí. */
  onRemove?: () => void
  idPrefix: string
  removeLabel?: string
}) {
  const variable = variables.find((candidate) => candidate.id === condition.variableId) ?? variables[0]

  const [valueText, setValueText] = useState(
    typeof condition.value === 'number' ? String(condition.value) : '',
  )
  // Resincroniza el texto local con `condition.value` cuando cambia por una
  // vía DISTINTA de teclear en este propio campo (el `<select>` de variable
  // fija un valor por defecto nuevo, o el store cambia desde fuera, p.ej.
  // undo/redo) — mientras el usuario teclea, `condition.value` no cambia
  // hasta el blur/Enter que confirma, así que este efecto no interfiere con
  // la edición en curso. No hay evento de UI al que "colgar" este
  // re-sincronizado (no lo dispara ningún campo de este propio componente),
  // así que un efecto es la herramienta correcta pese al aviso de la regla
  // — mismo criterio que `initialError` en `HomeScreen.tsx`.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (typeof condition.value === 'number') setValueText(String(condition.value))
  }, [condition.value])

  if (!variable) {
    // La variable referenciada ya no existe: no debería ocurrir en la
    // práctica (`deleteVariable` limpia la condición al borrar la variable
    // que referencia), pero se cubre para no romper el resto del panel —
    // solo se ofrece quitar la condición huérfana, si `onRemove` existe
    // (ver su comentario: la de `FinalAlternateSection` no lo pasa, pero
    // tampoco puede llegar aquí — `defaultAlternateCondition` solo elige
    // variables que SÍ existen).
    return (
      <div className={styles.conditionEditor}>
        {onRemove && (
          <button type="button" className={styles.removeResponseButton} onClick={onRemove}>
            {removeLabel}
          </button>
        )}
      </div>
    )
  }

  function commitValueText() {
    const parsed = Number(valueText.trim())
    if (Number.isNaN(parsed)) return
    onChange({ ...condition, value: parsed })
  }

  function handleVariableChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextVariable = variables.find((candidate) => candidate.id === event.target.value)
    if (!nextVariable) return
    const validOperators = operatorsForVariable(nextVariable)
    const nextOperator = validOperators.includes(condition.operator) ? condition.operator : '=='
    const nextValue =
      nextVariable.type === 'boolean'
        ? typeof condition.value === 'boolean'
          ? condition.value
          : false
        : typeof condition.value === 'number'
          ? condition.value
          : 0
    onChange({ variableId: nextVariable.id, operator: nextOperator, value: nextValue })
  }

  function handleOperatorChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange({ ...condition, operator: event.target.value as ComparisonOperator })
  }

  function handleBooleanValueChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange({ ...condition, value: event.target.value === 'true' })
  }

  return (
    <div className={styles.conditionEditor}>
      <div>
        <label className={styles.label} htmlFor={`${idPrefix}-variable`}>
          Variable
        </label>
        <select
          id={`${idPrefix}-variable`}
          className={styles.select}
          value={variable.id}
          onChange={handleVariableChange}
        >
          {variables.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={styles.label} htmlFor={`${idPrefix}-operator`}>
          Operador
        </label>
        <select
          id={`${idPrefix}-operator`}
          className={styles.select}
          value={condition.operator}
          onChange={handleOperatorChange}
        >
          {operatorsForVariable(variable).map((operator) => (
            <option key={operator} value={operator}>
              {OPERATOR_LABEL[operator]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={styles.label} htmlFor={`${idPrefix}-value`}>
          Valor
        </label>
        {variable.type === 'boolean' ? (
          <select
            id={`${idPrefix}-value`}
            className={styles.select}
            value={String(condition.value === true)}
            onChange={handleBooleanValueChange}
          >
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        ) : (
          <input
            id={`${idPrefix}-value`}
            className={styles.input}
            type="number"
            value={valueText}
            onChange={(event) => setValueText(event.target.value)}
            onBlur={commitValueText}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitValueText()
            }}
          />
        )}
      </div>
      {onRemove && (
        <button type="button" className={styles.removeResponseButton} onClick={onRemove}>
          {removeLabel}
        </button>
      )}
    </div>
  )
}

/**
 * Fila de un efecto de variable dentro de la lista de efectos de una
 * respuesta. A diferencia de una respuesta o de una variable, un
 * `VariableEffect` no lleva `id` propio en el schema (ver
 * `VariableEffectSchema`): la lista se manipula por posición (`index`), que
 * `ResponseEffectsSection` traduce a `updateResponse` reemplazando el array
 * completo (ver `UpdateResponsePatch.effects` en `src/domain/responses.ts`).
 *
 * Igual que `ConditionEditor`: la operación se acota a `set` cuando la
 * variable es booleana (ocultando `increment`/`decrement`, que el dominio
 * trata como no-op silencioso sobre una booleana — mejor no ofrecerlos
 * donde no tienen ningún efecto real).
 */
export function EffectRow({
  effect,
  index,
  variables,
  onChange,
  onRemove,
  idPrefix,
}: {
  effect: VariableEffect
  index: number
  variables: VariableDef[]
  onChange: (index: number, next: VariableEffect) => void
  onRemove: (index: number) => void
  /** Desambigua los `id`/`htmlFor` cuando hay listas de efectos de varias
   *  respuestas distintas en pantalla — no ocurre en el modo actual de
   *  edición (solo la respuesta seleccionada se ve a la vez), pero evita
   *  ids duplicados si eso cambiara. */
  idPrefix: string
}) {
  const variable = variables.find((candidate) => candidate.id === effect.variableId) ?? variables[0]

  const [valueText, setValueText] = useState(
    typeof effect.value === 'number' ? String(effect.value) : '',
  )
  // Mismo motivo que el `useEffect` análogo de `ConditionEditor`: resincroniza
  // con `effect.value` cuando cambia por una vía distinta de teclear aquí
  // (cambiar de variable/operación fija un valor por defecto nuevo).
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (typeof effect.value === 'number') setValueText(String(effect.value))
  }, [effect.value])

  if (!variable) {
    return (
      <div className={styles.effectRow}>
        <button
          type="button"
          className={styles.removeResponseButton}
          onClick={() => onRemove(index)}
        >
          Quitar efecto {index + 1}
        </button>
      </div>
    )
  }

  function commitValueText() {
    const parsed = Number(valueText.trim())
    if (Number.isNaN(parsed)) return
    onChange(index, makeEffect(effect.variableId, effect.operation, parsed))
  }

  function handleVariableChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextVariable = variables.find((candidate) => candidate.id === event.target.value)
    if (!nextVariable) return
    const nextOperation: VariableEffect['operation'] =
      nextVariable.type === 'boolean' ? 'set' : effect.operation
    const nextValue: number | boolean =
      nextVariable.type === 'boolean'
        ? typeof effect.value === 'boolean'
          ? effect.value
          : false
        : typeof effect.value === 'number'
          ? effect.value
          : 0
    onChange(index, makeEffect(nextVariable.id, nextOperation, nextValue))
  }

  function handleOperationChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange(
      index,
      makeEffect(effect.variableId, event.target.value as VariableEffect['operation'], effect.value),
    )
  }

  function handleBooleanValueChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange(index, makeEffect(effect.variableId, 'set', event.target.value === 'true'))
  }

  const operations: VariableEffect['operation'][] =
    variable.type === 'boolean' ? ['set'] : ['set', 'increment', 'decrement']

  return (
    <div className={styles.effectRow}>
      <div>
        <label className={styles.label} htmlFor={`${idPrefix}-variable`}>
          Variable del efecto {index + 1}
        </label>
        <select
          id={`${idPrefix}-variable`}
          className={styles.select}
          value={variable.id}
          onChange={handleVariableChange}
        >
          {variables.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={styles.label} htmlFor={`${idPrefix}-operation`}>
          Operación del efecto {index + 1}
        </label>
        <select
          id={`${idPrefix}-operation`}
          className={styles.select}
          value={effect.operation}
          onChange={handleOperationChange}
        >
          {operations.map((operation) => (
            <option key={operation} value={operation}>
              {EFFECT_OPERATION_LABEL[operation]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={styles.label} htmlFor={`${idPrefix}-value`}>
          Valor del efecto {index + 1}
        </label>
        {variable.type === 'boolean' ? (
          <select
            id={`${idPrefix}-value`}
            className={styles.select}
            value={String(effect.value === true)}
            onChange={handleBooleanValueChange}
          >
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        ) : (
          <input
            id={`${idPrefix}-value`}
            className={styles.input}
            type="number"
            value={valueText}
            onChange={(event) => setValueText(event.target.value)}
            onBlur={commitValueText}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitValueText()
            }}
          />
        )}
      </div>
      <button type="button" className={styles.removeResponseButton} onClick={() => onRemove(index)}>
        Quitar efecto {index + 1}
      </button>
    </div>
  )
}
