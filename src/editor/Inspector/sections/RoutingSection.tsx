import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useProjectStore } from '../../../store'
import { DEFAULT_CONTINUE_LABEL } from '../../../domain'
import type { Node, SlideNode, VariableDef } from '../../../domain'
import styles from '../Inspector.module.css'
import { fieldClassName, NO_TARGET_VALUE, nodeOptionLabel } from '../Inspector'
import { ConditionEditor, defaultValueForVariable } from './variableConditions'

/**
 * Enrutado condicional de una diapositiva "de continuar" (Tarea 3):
 * `condition`+`elseTargetNodeId` de `SlideNode`. Reutiliza `ConditionEditor`
 * (mismo control que la condición de visibilidad de una respuesta) y un
 * `<select>` de destino "si no" idéntico en UX al "Destino de continuar" de
 * `ContinueSection` — mismo `NO_TARGET_VALUE`/`nodeOptionLabel`.
 *
 * Activar/desactivar es una única acción sobre `condition` (crear/borrar);
 * desactivar limpia AMBOS campos (`condition` y `elseTargetNodeId`) en la
 * MISMA llamada a `updateNode` (una sola entrada de historial), como pide el
 * enunciado — no dos llamadas separadas.
 */
function ConditionalRoutingSection({
  node,
  allNodes,
  variables,
}: {
  node: SlideNode
  allNodes: Node[]
  variables: VariableDef[]
}) {
  const updateNode = useProjectStore((state) => state.updateNode)

  function handleEnable() {
    const firstVariable = variables[0]
    if (!firstVariable) return
    updateNode(node.id, {
      condition: {
        variableId: firstVariable.id,
        operator: '==',
        value: defaultValueForVariable(firstVariable),
      },
    })
  }

  function handleDisable() {
    updateNode(node.id, { condition: null, elseTargetNodeId: null })
  }

  function handleElseTargetChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    updateNode(node.id, { elseTargetNodeId: value === NO_TARGET_VALUE ? null : value })
  }

  const elseTargetFieldId = 'inspector-continue-else-target'

  return (
    <div className={styles.conditionalRoutingSection}>
      <h3 className={styles.responsesTitle}>Condición de aparición</h3>
      {!node.condition && variables.length === 0 && (
        <p className={styles.noVariablesNotice}>
          Todavía no hay variables en el proyecto. Créalas desde el panel "Variables" para poder
          condicionar el destino de esta diapositiva.
        </p>
      )}
      {!node.condition && variables.length > 0 && (
        <button type="button" className={styles.addResponseButton} onClick={handleEnable}>
          + Activar condición de aparición
        </button>
      )}
      {node.condition && (
        <>
          <ConditionEditor
            condition={node.condition}
            variables={variables}
            onChange={(next) => updateNode(node.id, { condition: next })}
            onRemove={handleDisable}
            idPrefix="inspector-continue-condition"
            removeLabel="Desactivar condición de aparición"
          />
          <div>
            <label className={styles.label} htmlFor={elseTargetFieldId}>
              Destino "si no"
            </label>
            <select
              id={elseTargetFieldId}
              className={styles.select}
              value={node.elseTargetNodeId ?? NO_TARGET_VALUE}
              onChange={handleElseTargetChange}
            >
              <option value={NO_TARGET_VALUE}>— Sin destino —</option>
              {allNodes.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {nodeOptionLabel(candidate)}
                </option>
              ))}
            </select>
            <p className={styles.helperText}>
              El destino normal (arriba, "Destino de continuar") se usa si la condición es
              verdadera o no hay condición. Este destino "si no" solo se usa cuando la condición
              es falsa.
            </p>
            {!node.elseTargetNodeId && (
              <p className={styles.elseTargetWarning} role="alert">
                ⚠ Sin destino "si no" configurado: cuando la condición no se cumpla, el recorrido
                llegará a un punto sin continuación.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Modo "de continuar" de una diapositiva: destino único de "Continuar" más
 * el texto personalizable de ese botón, y — Tarea 3 — su enrutado
 * condicional opcional. Solo se muestra mientras la diapositiva NO tiene
 * respuestas — en cuanto tiene una, esos campos dejan de tener efecto en el
 * Player (quedan dormidos en el documento, sin borrarse) y se ocultan; si se
 * eliminan todas las respuestas, vuelven a aparecer con el valor que ya
 * tuvieran.
 *
 * Se monta con `key={node.id}` (a través de `NodeFields`) por el mismo
 * motivo que el resto de campos con estado local: el texto en edición debe
 * arrancar limpio al cambiar de nodo.
 */
export function ContinueSection({
  node,
  allNodes,
  variables,
}: {
  node: SlideNode
  allNodes: Node[]
  variables: VariableDef[]
}) {
  const updateNode = useProjectStore((state) => state.updateNode)
  const connect = useProjectStore((state) => state.connect)
  const disconnect = useProjectStore((state) => state.disconnect)

  // Mismo criterio "commit on blur" que el título del nodo: estado local +
  // confirmación en blur/Enter/desmontaje, comparando contra lo último
  // confirmado para no generar entradas de historial vacías.
  const [label, setLabel] = useState(node.continueLabel ?? '')
  const committedRef = useRef(node.continueLabel ?? '')
  const latestRef = useRef(label)
  latestRef.current = label

  useEffect(() => {
    return () => {
      commitPending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commitPending() {
    const pending = latestRef.current
    if (pending === committedRef.current) return
    // Vacío significa "vuelve al texto por defecto" (`null` borra el campo).
    updateNode(node.id, { continueLabel: pending.trim() === '' ? null : pending })
    committedRef.current = pending
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      commitPending()
    }
  }

  function handleTargetChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    if (value === NO_TARGET_VALUE) {
      if (node.targetNodeId) {
        disconnect(node.id)
      }
    } else {
      connect(node.id, value)
    }
  }

  const targetFieldId = 'inspector-continue-target'
  const labelFieldId = 'inspector-continue-label'

  return (
    <div className={styles.continueSection}>
      <div>
        <label className={styles.label} htmlFor={targetFieldId}>
          Destino de continuar
        </label>
        <select
          id={targetFieldId}
          className={styles.select}
          value={node.targetNodeId ?? NO_TARGET_VALUE}
          onChange={handleTargetChange}
        >
          <option value={NO_TARGET_VALUE}>— Sin destino —</option>
          {allNodes.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {nodeOptionLabel(candidate)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={styles.label} htmlFor={labelFieldId}>
          Texto del botón de continuar
        </label>
        <input
          id={labelFieldId}
          className={fieldClassName(styles.input, label)}
          type="text"
          value={label}
          placeholder={DEFAULT_CONTINUE_LABEL}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={commitPending}
          onKeyDown={handleKeyDown}
        />
      </div>
      <ConditionalRoutingSection node={node} allNodes={allNodes} variables={variables} />
    </div>
  )
}
