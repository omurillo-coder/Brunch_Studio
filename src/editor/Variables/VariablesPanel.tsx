import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react'
import { useProject, useProjectStore } from '../../store'
import type { VariableDef, VariableType } from '../../domain'
import styles from './VariablesPanel.module.css'

/**
 * Panel de variables del proyecto (Tarea 1 del milestone
 * "Variables/condiciones", fase 2).
 *
 * Sigue la convención "sin modales" del resto de la app: no es un diálogo
 * flotante, sino un panel propio que `EditorScreen` monta EN VEZ del
 * `Inspector` mientras está abierto (ver el comentario de diseño ahí) —
 * mismo criterio de "sustituir temporalmente un panel" que ya usa el modo
 * "Probar" a nivel de pantalla entera. Se abre/cierra con el botón
 * "Variables" de `Topbar`; el botón "✕" de la cabecera de este panel hace
 * exactamente lo mismo (`onClose`), como una segunda vía de cierre
 * descubrible sin depender de volver a la barra superior.
 *
 * Usa directamente las acciones de store ya expuestas por la fase 1
 * (`addVariable`/`updateVariable`/`deleteVariable`, que delegan en
 * `src/domain/project.ts`) — este componente no añade ninguna regla de
 * dominio nueva, solo la forma de UI para invocarlas.
 *
 * Decisión de diseño — tipo no editable tras crear la variable: una vez
 * creada, `VariableRow` (más abajo) NO ofrece ningún control para cambiar
 * `type`, solo nombre y valor inicial. Aunque `updateVariable` (dominio) lo
 * permitiría, cambiar el tipo de una variable ya referenciada por
 * condiciones/efectos en otras diapositivas dejaría esas referencias en un
 * estado ambiguo (p.ej. una condición `> 5` guardada sobre lo que ahora es
 * una booleana) sin que el dominio limpie nada automáticamente en ese caso
 * (a diferencia de `deleteVariable`, que sí limpia referencias colgantes).
 * Si el diseñador se equivoca de tipo, el flujo previsto es borrar la
 * variable y crearla de nuevo — el propio borrado ya avisa de qué se
 * limpia, ver `VariableRow`.
 */
export interface VariablesPanelProps {
  /** Cierra el panel (mismo callback que el botón "Variables" de `Topbar`,
   *  ver comentario de cabecera). */
  onClose: () => void
}

const VARIABLE_TYPE_LABEL: Record<VariableType, string> = {
  number: 'Número',
  boolean: 'Sí/no',
}

/**
 * Formulario de alta de una variable nueva: nombre, tipo (número/sí-no) y
 * valor inicial — el control de valor cambia de tipo (número/checkbox) según
 * el tipo elegido, tal y como pide el enunciado. Error de dominio (nombre
 * vacío o duplicado, ver `addVariable`/`assertUsableVariableName` en
 * `src/domain/project.ts`) capturado y mostrado inline, mismo patrón de
 * mensaje honesto que el resto de la app (ver `HomeScreen`) — nunca
 * `alert()`.
 */
function AddVariableForm() {
  const addVariable = useProjectStore((state) => state.addVariable)

  const [name, setName] = useState('')
  const [type, setType] = useState<VariableType>('number')
  const [numberValueText, setNumberValueText] = useState('0')
  const [booleanValue, setBooleanValue] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleTypeChange(event: ChangeEvent<HTMLSelectElement>) {
    setType(event.target.value as VariableType)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (type === 'number') {
      const trimmed = numberValueText.trim()
      const parsed = Number(trimmed === '' ? '0' : trimmed)
      if (Number.isNaN(parsed)) {
        setError('El valor inicial debe ser un número válido.')
        return
      }
      createVariable(parsed)
      return
    }
    createVariable(booleanValue)
  }

  function createVariable(initialValue: number | boolean) {
    try {
      addVariable({ name, type, initialValue })
      setName('')
      setNumberValueText('0')
      setBooleanValue(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se ha podido crear la variable.')
    }
  }

  return (
    <form className={styles.addForm} onSubmit={handleSubmit}>
      <div>
        <label className={styles.label} htmlFor="variables-new-name">
          Nombre
        </label>
        <input
          id="variables-new-name"
          className={styles.input}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div>
        <label className={styles.label} htmlFor="variables-new-type">
          Tipo
        </label>
        <select
          id="variables-new-type"
          className={styles.select}
          value={type}
          onChange={handleTypeChange}
        >
          <option value="number">Número</option>
          <option value="boolean">Sí/no</option>
        </select>
      </div>
      <div>
        <label className={styles.label} htmlFor="variables-new-value">
          Valor inicial
        </label>
        {type === 'boolean' ? (
          <label className={styles.checkboxLabel}>
            <input
              id="variables-new-value"
              type="checkbox"
              checked={booleanValue}
              onChange={(event) => setBooleanValue(event.target.checked)}
            />
            {booleanValue ? 'Sí' : 'No'}
          </label>
        ) : (
          <input
            id="variables-new-value"
            className={styles.input}
            type="number"
            value={numberValueText}
            onChange={(event) => setNumberValueText(event.target.value)}
          />
        )}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button type="submit" className={styles.addButton}>
        + Añadir variable
      </button>
    </form>
  )
}

/**
 * Fila de una variable ya existente: nombre y valor inicial editables
 * (commit on blur/Enter, mismo criterio que el resto del editor), tipo
 * mostrado como texto de solo lectura (ver decisión de diseño en el
 * comentario de cabecera del módulo), y borrado con confirmación inline de
 * dos pasos — mismo patrón exacto que `DeleteNodeButton` en
 * `Inspector.tsx`: el primer clic no borra nada, solo arma un aviso con "Sí,
 * eliminar"/"Cancelar", y el aviso deja explícito que también se limpiarán
 * las condiciones/efectos de otras diapositivas que referencien esta
 * variable (el dominio ya lo hace, ver `deleteVariable` en
 * `src/domain/project.ts`; aquí solo se avisa de qué va a ocurrir).
 *
 * `index` es la posición 1-based en la lista, usada solo para desambiguar
 * las etiquetas accesibles ("Nombre de la variable 2") — mismo criterio que
 * `ResponseRow` en `Inspector.tsx`.
 */
function VariableRow({ variable, index }: { variable: VariableDef; index: number }) {
  const updateVariable = useProjectStore((state) => state.updateVariable)
  const deleteVariable = useProjectStore((state) => state.deleteVariable)

  const [name, setName] = useState(variable.name)
  const committedNameRef = useRef(variable.name)
  const latestNameRef = useRef(name)
  latestNameRef.current = name

  const [valueText, setValueText] = useState(
    typeof variable.initialValue === 'number' ? String(variable.initialValue) : '0',
  )
  const committedValueRef = useRef(valueText)
  const latestValueRef = useRef(valueText)
  latestValueRef.current = valueText

  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    return () => {
      commitName()
      commitValue()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commitName() {
    const pending = latestNameRef.current
    if (pending === committedNameRef.current) return
    try {
      updateVariable(variable.id, { name: pending })
      committedNameRef.current = pending
      setError(null)
    } catch (err) {
      // Nombre vacío o duplicado (ver `assertUsableVariableName` en
      // dominio): se muestra el error inline y se revierte el campo al
      // último nombre confirmado, para no dejar el documento y el campo
      // visible desincronizados.
      setError(err instanceof Error ? err.message : 'No se ha podido renombrar la variable.')
      setName(committedNameRef.current)
    }
  }

  function handleNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') commitName()
  }

  function commitValue() {
    if (variable.type !== 'number') return
    const pending = latestValueRef.current
    if (pending === committedValueRef.current) return
    const parsed = Number(pending.trim())
    if (Number.isNaN(parsed)) {
      // Entrada no numérica: no se confirma nada, mismo criterio que la
      // puntuación de una respuesta en `Inspector.tsx`.
      setValueText(committedValueRef.current)
      return
    }
    updateVariable(variable.id, { initialValue: parsed })
    committedValueRef.current = pending
  }

  function handleValueKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') commitValue()
  }

  function handleBooleanValueChange(event: ChangeEvent<HTMLInputElement>) {
    updateVariable(variable.id, { initialValue: event.target.checked })
  }

  const nameFieldId = `variables-row-name-${variable.id}`
  const valueFieldId = `variables-row-value-${variable.id}`

  return (
    <li className={styles.variableRow}>
      <div className={styles.variableRowHeader}>
        <span className={styles.typeBadge}>{VARIABLE_TYPE_LABEL[variable.type]}</span>
      </div>
      <div>
        <label className={styles.label} htmlFor={nameFieldId}>
          Nombre de la variable {index}
        </label>
        <input
          id={nameFieldId}
          className={styles.input}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={handleNameKeyDown}
        />
      </div>
      <div>
        <label className={styles.label} htmlFor={valueFieldId}>
          Valor inicial de la variable {index}
        </label>
        {variable.type === 'boolean' ? (
          <label className={styles.checkboxLabel}>
            <input
              id={valueFieldId}
              type="checkbox"
              checked={variable.initialValue === true}
              onChange={handleBooleanValueChange}
            />
            {variable.initialValue === true ? 'Sí' : 'No'}
          </label>
        ) : (
          <input
            id={valueFieldId}
            className={styles.input}
            type="number"
            value={valueText}
            onChange={(event) => setValueText(event.target.value)}
            onBlur={commitValue}
            onKeyDown={handleValueKeyDown}
          />
        )}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {confirmingDelete ? (
        <div className={styles.deleteConfirm}>
          <span className={styles.deleteConfirmText}>
            ¿Eliminar la variable "{variable.name}"? Se quitarán también las condiciones y efectos
            que la usen en otras diapositivas.
          </span>
          <div className={styles.deleteConfirmActions}>
            <button
              type="button"
              className={styles.deleteConfirmButton}
              onClick={() => deleteVariable(variable.id)}
            >
              Sí, eliminar
            </button>
            <button
              type="button"
              className={styles.cancelDeleteButton}
              onClick={() => setConfirmingDelete(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.deleteButton}
          onClick={() => setConfirmingDelete(true)}
        >
          Eliminar variable {index}
        </button>
      )}
    </li>
  )
}

export function VariablesPanel({ onClose }: VariablesPanelProps) {
  const project = useProject()

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Variables del proyecto</h2>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Cerrar panel de variables"
          title="Cerrar panel de variables"
        >
          ✕
        </button>
      </div>
      <p className={styles.intro}>
        Números o valores sí/no que un recorrido puede leer y modificar: contadores, puntuaciones,
        flags de progreso. El tipo de una variable no se puede cambiar una vez creada — si te
        equivocas de tipo, bórrala y créala de nuevo.
      </p>
      <AddVariableForm />
      {project.variables.length > 0 ? (
        <ul className={styles.variableList}>
          {project.variables.map((variable, index) => (
            <VariableRow key={variable.id} variable={variable} index={index + 1} />
          ))}
        </ul>
      ) : (
        <p className={styles.emptyState}>Todavía no hay variables. Créala con el formulario de arriba.</p>
      )}
    </aside>
  )
}
