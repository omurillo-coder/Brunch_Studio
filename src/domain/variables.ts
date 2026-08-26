import type { ComparisonOperator, SlideNode, VariableCondition, VariableEffect } from './schemas'

/**
 * ---------------------------------------------------------------------------
 * Motor puro de variables/condiciones
 * ---------------------------------------------------------------------------
 *
 * Funciones puras que operan sobre el ESTADO de variables de un recorrido en
 * curso, no sobre la DEFINICIÓN de variables del proyecto (`VariableDef`,
 * `src/domain/schemas.ts`) ni sobre el documento (`src/domain/project.ts`).
 * Separadas de `project.ts` a propósito: este archivo no toca nunca un
 * `ProjectDocument` ni pasa por `immer`/`produce` — son funciones de cálculo,
 * no de edición del documento — y es el módulo que en la fase futura de
 * reproductor/export importará `src/player/runtime.ts` para avanzar el
 * recorrido (`applyVariableEffects` al elegir una respuesta,
 * `resolveSlideTarget`/`evaluateCondition` al mostrar una diapositiva).
 *
 * `VariableState` (no un tipo del schema: es forma de RUNTIME, no de
 * documento) es deliberadamente un `Record<string, ...>` plano por
 * `variableId`, no un array de `{ variableId, value }`: así evaluar/aplicar
 * es una lectura/escritura de clave en vez de un `.find` sobre un array cada
 * vez, y el futuro `PlayerState` (`src/player/runtime.ts`) puede sembrarlo
 * directamente a partir de `VariableDef.initialValue` con un único `reduce`
 * sobre `ProjectDocument.variables`.
 */

/** Valor posible de una variable en tiempo de recorrido: mismo par de tipos
 *  que `VariableDef.type` (`number | boolean`), pero sin el envoltorio del
 *  documento (id/nombre/tipo) — es solo el valor actual. */
export type VariableValue = number | boolean

/** Estado de variables de un recorrido: valor actual por `variableId`. Una
 *  variable ausente de este mapa (id desconocido, o recorrido que arrancó
 *  sin sembrarla) se trata en todas las funciones de este módulo como "sin
 *  valor", nunca como un error — ver `evaluateCondition`/
 *  `applyVariableEffects`. */
export type VariableState = Record<string, VariableValue>

/**
 * Aplica una lista de efectos sobre un estado de variables y devuelve el
 * estado RESULTANTE, nuevo (no muta `variables`). Los efectos se aplican en
 * orden de array: si dos efectos de la lista tocan la misma variable (caso
 * de borde improbable desde la UI, pero el tipo no lo impide), el último
 * gana — igual que asignar dos veces la misma clave de un objeto.
 *
 * Pensada para el motor del Player (fase futura): se llama una vez por cada
 * respuesta de decisión elegida, con `response.effects ?? []`.
 *
 * Casos límite deliberadamente sin lanzar nunca (esta función es el punto
 * donde puede llegar una combinación de datos guardada por una versión
 * anterior de la UI, o construida a mano en un test; debe ser tan tolerante
 * como el resto del dominio de "estado de documento posiblemente
 * incompleto", ver comentario de cabecera de `src/player/runtime.ts`):
 * - `set` sobre una variable que no existía todavía en `variables`: la crea
 *   sin más (misma semántica que asignar una clave nueva a un objeto). No
 *   comprueba que `effect.value` case con el `type` declarado de la
 *   variable — esa comprobación es responsabilidad de quien construye el
 *   efecto (UI/dominio en la fase de edición), no de este motor de
 *   aplicación en tiempo de recorrido.
 * - `increment`/`decrement` sobre una variable cuyo valor actual NO es
 *   `number` (booleana, o ausente de `variables`): decisión de diseño
 *   EXPLÍCITA — es un no-op silencioso, se ignora ese efecto concreto y el
 *   resto de la lista se sigue aplicando con normalidad. Alternativas
 *   descartadas: lanzar (rompería un recorrido entero del Player por un dato
 *   mal configurado, inaceptable en modo lectura) o coaccionar el booleano a
 *   0/1 (inventaría una semántica de "incrementar un flag" que nadie pidió y
 *   que además no es reversible de forma intuitible por quien diseña el
 *   escenario). Silencioso-e-ignorado dentro de la única función especializada
 *   en aplicar efectos.
 */
export function applyVariableEffects(
  variables: VariableState,
  effects: readonly VariableEffect[],
): VariableState {
  return effects.reduce<VariableState>((state, effect) => {
    if (effect.operation === 'set') {
      return { ...state, [effect.variableId]: effect.value }
    }

    // increment / decrement: solo tienen sentido sobre un valor `number` ya
    // presente en el estado. Cualquier otra situación es no-op, ver
    // comentario de la función.
    const current = state[effect.variableId]
    if (typeof current !== 'number') {
      return state
    }

    const delta = effect.operation === 'increment' ? effect.value : -effect.value
    return { ...state, [effect.variableId]: current + delta }
  }, variables)
}

/**
 * Compara `current` contra `condition.value` con `condition.operator`.
 *
 * `==`/`!=` son siempre significativos (comparación de igualdad estricta,
 * válida para `number` y `boolean` por igual, y también cuando `current` es
 * `undefined` porque la variable no está sembrada en el estado — en ese
 * caso `==` siempre da `false` y `!=` siempre da `true`, exactamente el
 * comportamiento natural de `===`/`!==` de JavaScript sin necesitar ningún
 * caso especial aquí).
 *
 * `>`/`>=`/`<`/`<=` solo son significativos entre dos `number`: si `current`
 * no está definido, o si `current`/`condition.value` no son ambos `number`
 * (p.ej. una condición de orden guardada por error sobre una variable
 * booleana — el schema lo permite deliberadamente, ver
 * `ComparisonOperatorSchema` en `src/domain/schemas.ts`), la comparación
 * evalúa a `false` en vez de lanzar o de coaccionar tipos. Es la misma
 * filosofía "tolerante, nunca lanza" que el resto de este módulo y que
 * `src/player/runtime.ts`.
 */
export function evaluateCondition(variables: VariableState, condition: VariableCondition): boolean {
  const current = variables[condition.variableId]

  if (condition.operator === '==') return current === condition.value
  if (condition.operator === '!=') return current !== condition.value

  // A partir de aquí, operadores de orden: solo comparables si ambos lados
  // son `number`.
  if (typeof current !== 'number' || typeof condition.value !== 'number') {
    return false
  }

  const target = condition.value
  switch (condition.operator satisfies ComparisonOperator) {
    case '>':
      return current > target
    case '>=':
      return current >= target
    case '<':
      return current < target
    case '<=':
      return current <= target
    default:
      // Inalcanzable: los seis operadores de `COMPARISON_OPERATORS` están
      // cubiertos arriba (`==`/`!=` antes del `switch`, los otros cuatro
      // aquí). Se cubre solo para que un operador añadido en el futuro sin
      // actualizar esta función falle de forma explícita en vez de colarse
      // como `false` silencioso.
      throw new Error(`evaluateCondition: operador de comparación desconocido "${condition.operator}".`)
  }
}

/**
 * Resuelve el destino real de una diapositiva "de continuar" (`responses`
 * vacío) teniendo en cuenta su `condition`/`elseTargetNodeId` opcionales.
 *
 * - Diapositiva de DECISIÓN (`responses.length > 0`): esta función no aplica
 *   — el destino no es único, depende de qué respuesta elija el usuario (ver
 *   `choose` en `src/player/runtime.ts`). Devuelve `undefined` en vez de
 *   lanzar, para que el motor del Player pueda llamarla sin comprobar antes
 *   el tipo de diapositiva; `condition`/`elseTargetNodeId` quedan "dormidos"
 *   en este caso, mismo criterio que `targetNodeId`/`continueLabel`.
 * - Sin `condition`: comportamiento actual, intacto — siempre
 *   `node.targetNodeId`.
 * - Con `condition`: `evaluateCondition` decide entre `node.targetNodeId`
 *   (verdadera) y `node.elseTargetNodeId` (falsa). Puede devolver
 *   `undefined` en ambas ramas si el destino correspondiente no está
 *   conectado — se trata igual que cualquier otro destino ausente
 *   (dead-end en el Player, ver `src/player/runtime.ts`).
 */
export function resolveSlideTarget(node: SlideNode, variables: VariableState): string | undefined {
  if (node.responses.length > 0) return undefined
  if (!node.condition) return node.targetNodeId
  return evaluateCondition(variables, node.condition) ? node.targetNodeId : node.elseTargetNodeId
}
