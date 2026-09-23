import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useProjectStore } from '../../../store'
import { MAX_RESPONSES, RESPONSE_ORDERS } from '../../../domain'
import type {
  DecisionResponse,
  Node,
  ResponseOrder,
  SlideNode,
  VariableDef,
  VariableEffect,
} from '../../../domain'
import styles from '../Inspector.module.css'
import { fieldClassName, NO_TARGET_VALUE, nodeOptionLabel } from '../Inspector'
import { MediaAttachment } from './mediaAttachment'
import {
  ConditionEditor,
  defaultValueForVariable,
  EffectRow,
  makeEffect,
} from './variableConditions'

/**
 * Condición de visibilidad de una respuesta (Tarea 2): "esta respuesta solo
 * aparece si...". Sin variables en el proyecto, muestra un aviso sobrio en
 * vez de un desplegable vacío confuso (ver comentario de cabecera de esta
 * sección). Sin condición todavía, un botón "+ Añadir condición" la crea con
 * un valor de partida razonable (primera variable del proyecto, `==`, valor
 * por defecto de su tipo).
 */
function ResponseConditionSection({
  slideNodeId,
  response,
  variables,
}: {
  slideNodeId: string
  response: DecisionResponse
  variables: VariableDef[]
}) {
  const updateResponse = useProjectStore((state) => state.updateResponse)

  function handleEnable() {
    const firstVariable = variables[0]
    if (!firstVariable) return
    updateResponse(slideNodeId, response.id, {
      condition: {
        variableId: firstVariable.id,
        operator: '==',
        value: defaultValueForVariable(firstVariable),
      },
    })
  }

  return (
    <div className={styles.conditionSection}>
      <span className={styles.label}>Condición de visibilidad</span>
      {!response.condition && (
        <button type="button" className={styles.addResponseButton} onClick={handleEnable}>
          + Añadir condición
        </button>
      )}
      {response.condition && (
        <ConditionEditor
          condition={response.condition}
          variables={variables}
          onChange={(next) => updateResponse(slideNodeId, response.id, { condition: next })}
          onRemove={() => updateResponse(slideNodeId, response.id, { condition: null })}
          idPrefix={`inspector-response-condition-${response.id}`}
          removeLabel="Quitar condición"
        />
      )}
    </div>
  )
}

/**
 * Efectos sobre variables aplicados al elegir una respuesta (Tarea 2):
 * "al elegir esta respuesta...". Mismo patrón visual que "+ Añadir
 * respuesta" (botón al final de la lista, debajo del último efecto).
 */
function ResponseEffectsSection({
  slideNodeId,
  response,
  variables,
}: {
  slideNodeId: string
  response: DecisionResponse
  variables: VariableDef[]
}) {
  const updateResponse = useProjectStore((state) => state.updateResponse)
  const effects = response.effects ?? []

  function handleChange(index: number, next: VariableEffect) {
    const nextEffects = effects.map((item, i) => (i === index ? next : item))
    updateResponse(slideNodeId, response.id, { effects: nextEffects })
  }

  function handleRemove(index: number) {
    const remaining = effects.filter((_, i) => i !== index)
    updateResponse(slideNodeId, response.id, { effects: remaining.length > 0 ? remaining : null })
  }

  function handleAdd() {
    const firstVariable = variables[0]
    if (!firstVariable) return
    const newEffect = makeEffect(firstVariable.id, 'set', defaultValueForVariable(firstVariable))
    updateResponse(slideNodeId, response.id, { effects: [...effects, newEffect] })
  }

  return (
    <div className={styles.effectsSection}>
      <span className={styles.label}>Efectos al elegir esta respuesta</span>
      {effects.map((effect, index) => (
        <EffectRow
          key={index}
          effect={effect}
          index={index}
          variables={variables}
          onChange={handleChange}
          onRemove={handleRemove}
          idPrefix={`inspector-response-effect-${response.id}-${index}`}
        />
      ))}
      <button type="button" className={styles.addResponseButton} onClick={handleAdd}>
        + Añadir efecto
      </button>
    </div>
  )
}

/**
 * Efectos sobre variables aplicados al VISITAR esta diapositiva (milestone
 * "+1 fallo con Game Over", `SlideNodeSchema.visitEffects`) — se disparan
 * sea cual sea el camino por el que se llega (una respuesta elegida, el
 * "Continuar" de otra diapositiva, o el propio arranque del recorrido), a
 * diferencia de `ResponseEffectsSection` (solo al elegir esa respuesta
 * concreta). Mismo widget (`EffectRow`) y mismo criterio de "reemplaza el
 * array completo" que esa sección; solo cambia la acción de dominio
 * (`updateNode` en vez de `updateResponse`) y dónde vive la lista
 * (`node.visitEffects`, no `response.effects`).
 */
export function SlideVisitEffectsSection({ node, variables }: { node: SlideNode; variables: VariableDef[] }) {
  const updateNode = useProjectStore((state) => state.updateNode)
  const effects = node.visitEffects ?? []

  function handleChange(index: number, next: VariableEffect) {
    const nextEffects = effects.map((item, i) => (i === index ? next : item))
    updateNode(node.id, { visitEffects: nextEffects })
  }

  function handleRemove(index: number) {
    const remaining = effects.filter((_, i) => i !== index)
    updateNode(node.id, { visitEffects: remaining.length > 0 ? remaining : null })
  }

  function handleAdd() {
    const firstVariable = variables[0]
    if (!firstVariable) return
    const newEffect = makeEffect(firstVariable.id, 'set', defaultValueForVariable(firstVariable))
    updateNode(node.id, { visitEffects: [...effects, newEffect] })
  }

  if (variables.length === 0) {
    return (
      <p className={styles.noVariablesNotice}>
        Todavía no hay variables en el proyecto. Créalas desde el panel "Variables" para poder
        modificarlas al visitar esta diapositiva.
      </p>
    )
  }

  return (
    <div className={styles.effectsSection}>
      <span className={styles.label}>Efecto al visitar esta diapositiva</span>
      {effects.map((effect, index) => (
        <EffectRow
          key={index}
          effect={effect}
          index={index}
          variables={variables}
          onChange={handleChange}
          onRemove={handleRemove}
          idPrefix={`inspector-slide-visit-effect-${node.id}-${index}`}
        />
      ))}
      <button type="button" className={styles.addResponseButton} onClick={handleAdd}>
        + Añadir efecto
      </button>
    </div>
  )
}

/**
 * Bloque combinado de condición + efectos de variables de una respuesta.
 * Sin ninguna variable definida en el proyecto todavía, sustituye ambas
 * secciones por un único aviso sobrio invitando a crearlas desde el panel
 * "Variables" (Tarea 1) — nunca un desplegable vacío. Es seguro asumir que
 * sin variables no puede haber ninguna condición/efecto ya guardado
 * referenciando una: `deleteVariable` (dominio) limpia esas referencias en
 * el momento de borrar la variable, así que si `variables` está vacío, todas
 * las respuestas ya están limpias.
 */
function ResponseVariablesSection({
  slideNodeId,
  response,
  variables,
}: {
  slideNodeId: string
  response: DecisionResponse
  variables: VariableDef[]
}) {
  if (variables.length === 0) {
    return (
      <p className={styles.noVariablesNotice}>
        Todavía no hay variables en el proyecto. Créalas desde el panel "Variables" para poder
        condicionar esta respuesta o modificarlas al elegirla.
      </p>
    )
  }

  return (
    <>
      <ResponseConditionSection slideNodeId={slideNodeId} response={response} variables={variables} />
      <ResponseEffectsSection slideNodeId={slideNodeId} response={response} variables={variables} />
    </>
  )
}

/**
 * Una fila de respuesta dentro del inspector de una diapositiva: texto
 * editable ("commit on blur", mismo criterio que título/body), `<select>` de
 * destino, puntuación e imagen/audio.
 *
 * `index` es la posición 1-based de la respuesta en el orden mostrado, y se
 * usa solo para desambiguar las etiquetas visibles y los nombres accesibles
 * ("Destino de la respuesta 2", "Eliminar respuesta 2"...). Deliberadamente
 * NO se usa la letra (A/B/C/D): sigue existiendo en el dominio como criterio
 * de orden, pero no se muestra nunca al usuario.
 *
 * Petición de usuario ("pon solo Respuesta N y algo más grande, para
 * diferenciarlo de las otras respuestas"): la etiqueta del propio texto de
 * la respuesta (`.responseTextLabel`, antes "Texto de la respuesta N" con
 * el mismo tamaño diminuto que cualquier otra `<label>` del panel) hace
 * ahora de titular corto de toda la tarjeta de esa respuesta — más grande
 * que `.label`, para que se note de un vistazo dónde empieza cada
 * respuesta al desplazarse por una diapositiva con varias.
 *
 * Se monta con `key={response.id}` desde `ResponsesSection` por el mismo
 * motivo que `NodeFields` se monta con `key={node.id}`: el estado local de
 * texto debe arrancar limpio para cada respuesta y no reutilizarse entre
 * respuestas distintas si la lista se reordena.
 */
function ResponseRow({
  slideNodeId,
  response,
  index,
  arrayIndex,
  allNodes,
  filePath,
  variables,
  canReorder,
  isFirst,
  isLast,
}: {
  slideNodeId: string
  response: DecisionResponse
  /** Posición 1-based para mostrar ("Respuesta {index}", aria-labels) —
   *  NO el índice real del array, ver `arrayIndex`. */
  index: number
  /** Índice 0-based real dentro de `node.responses`, el que espera
   *  `moveResponse` (`src/domain/responses.ts`) — aparte de `index` (que
   *  ya viene desplazado +1 para mostrar) para no repetir la aritmética
   *  "±1" en cada sitio que lo usa. */
  arrayIndex: number
  allNodes: Node[]
  filePath: string
  variables: VariableDef[]
  /** Petición de usuario ("si está en ordenar te deje poner una arriba o
   *  una abajo"): `true` solo con `responseOrder: 'ordered'` (o ausente,
   *  su valor por defecto) Y más de una respuesta — en `'random'` el orden
   *  manual no tiene efecto en el Player (ver `orderResponses` en
   *  `src/player/runtime.ts`), así que los botones "Subir"/"Bajar" no
   *  tendrían ningún sentido ahí. */
  canReorder: boolean
  isFirst: boolean
  isLast: boolean
}) {
  const updateResponse = useProjectStore((state) => state.updateResponse)
  const removeResponse = useProjectStore((state) => state.removeResponse)
  const moveResponse = useProjectStore((state) => state.moveResponse)
  const connect = useProjectStore((state) => state.connect)
  const disconnect = useProjectStore((state) => state.disconnect)

  const [text, setText] = useState(response.text)
  const committedRef = useRef(response.text)
  const latestRef = useRef(text)
  latestRef.current = text

  // Puntuación: mismo criterio "commit on blur" que el texto, pero como
  // campo de texto local independiente (una cadena, no un número) para
  // poder representar "vacío" sin forzar un `0` cuando el usuario no ha
  // tocado el campo. `response.points` ausente -> cadena vacía.
  const [pointsText, setPointsText] = useState(
    response.points !== undefined ? String(response.points) : '',
  )
  const pointsCommittedRef = useRef(pointsText)
  const pointsLatestRef = useRef(pointsText)
  pointsLatestRef.current = pointsText

  useEffect(() => {
    return () => {
      commitPending()
      commitPendingPoints()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commitPending() {
    if (latestRef.current !== committedRef.current) {
      updateResponse(slideNodeId, response.id, { text: latestRef.current })
      committedRef.current = latestRef.current
    }
  }

  function commitPendingPoints() {
    const pending = pointsLatestRef.current
    if (pending === pointsCommittedRef.current) {
      return
    }
    const trimmed = pending.trim()
    if (trimmed === '') {
      updateResponse(slideNodeId, response.id, { points: null })
      pointsCommittedRef.current = pending
      return
    }
    const parsed = Number(trimmed)
    if (Number.isNaN(parsed)) {
      // Entrada no numérica: no se confirma nada (queda pendiente hasta un
      // valor válido o un vaciado explícito).
      return
    }
    updateResponse(slideNodeId, response.id, { points: parsed })
    pointsCommittedRef.current = pending
  }

  function handlePointsKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      commitPendingPoints()
    }
  }

  function handleTargetChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    if (value === NO_TARGET_VALUE) {
      if (response.targetNodeId) {
        disconnect(slideNodeId, response.id)
      }
    } else {
      connect(slideNodeId, value, response.id)
    }
  }

  const textFieldId = `inspector-response-text-${response.id}`
  const targetFieldId = `inspector-response-target-${response.id}`
  const actsAsExitFieldId = `inspector-response-acts-as-exit-${response.id}`
  const pointsFieldId = `inspector-response-points-${response.id}`
  const responseContextLabel = `de la respuesta ${index}`

  return (
    <div className={styles.responseRow}>
      <div className={styles.responseRowHeader}>
        <div className={styles.responseRowHeaderStart}>
          <span className={styles.responseBullet} aria-hidden="true" />
          {/* Subir/Bajar (petición de usuario): mismo mecanismo/estilo que
              "Subir bloque"/"Bajar bloque" de `ContentBlockRow` — solo
              visibles con `responseOrder: 'ordered'` (ver `canReorder`),
              porque en `'random'` el orden manual no afecta a nada. */}
          {canReorder && (
            <>
              <button
                type="button"
                className={styles.contentBlockMoveButton}
                onClick={() => moveResponse(slideNodeId, response.id, arrayIndex - 1)}
                disabled={isFirst}
                aria-label={`Subir respuesta ${index}`}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.contentBlockMoveButton}
                onClick={() => moveResponse(slideNodeId, response.id, arrayIndex + 1)}
                disabled={isLast}
                aria-label={`Bajar respuesta ${index}`}
              >
                ↓
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          className={styles.removeResponseButton}
          onClick={() => removeResponse(slideNodeId, response.id)}
          aria-label={`Eliminar respuesta ${index}`}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div>
        <label className={styles.responseTextLabel} htmlFor={textFieldId}>
          Respuesta {index}
        </label>
        <textarea
          id={textFieldId}
          className={fieldClassName(styles.textarea, text)}
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commitPending}
        />
      </div>
      <div>
        <label className={styles.label} htmlFor={targetFieldId}>
          Destino de la respuesta {index}
        </label>
        <select
          id={targetFieldId}
          className={styles.select}
          value={response.targetNodeId ?? NO_TARGET_VALUE}
          onChange={handleTargetChange}
          disabled={response.actsAsExit}
        >
          <option value={NO_TARGET_VALUE}>— Sin destino —</option>
          {allNodes.map((node) => (
            <option key={node.id} value={node.id}>
              {nodeOptionLabel(node)}
            </option>
          ))}
        </select>
      </div>
      {/* Milestone "+1 fallo con Game Over": mutuamente excluyente con el
          destino de arriba (ver comentario de
          `UpdateResponsePatch.actsAsExit` en `src/domain/responses.ts`) —
          marcarla borra el destino elegido en la MISMA llamada a
          `updateResponse`, así que el `<select>` de arriba queda
          deshabilitado mientras esté activa. */}
      <div className={styles.actsAsExitField}>
        <label htmlFor={actsAsExitFieldId}>
          <input
            id={actsAsExitFieldId}
            type="checkbox"
            checked={response.actsAsExit ?? false}
            onChange={(event) =>
              updateResponse(slideNodeId, response.id, { actsAsExit: event.target.checked })
            }
          />
          Actúa como botón Salir (no navega a ningún nodo)
        </label>
      </div>
      <div>
        <label className={styles.label} htmlFor={pointsFieldId}>
          Puntuación de la respuesta {index}
        </label>
        <input
          id={pointsFieldId}
          className={styles.input}
          type="number"
          value={pointsText}
          onChange={(event) => setPointsText(event.target.value)}
          onBlur={commitPendingPoints}
          onKeyDown={handlePointsKeyDown}
        />
      </div>
      {/* Petición de usuario ("quitar lo de poder poner una imagen como
          respuesta... queda raro"): ya no hay `MediaAttachment` de imagen
          aquí, solo audio. `response.imageAssetId` sigue existiendo en el
          esquema de dominio (`DecisionResponseSchema`) por compatibilidad —
          un proyecto antiguo que ya tuviera una imagen en una respuesta no
          pierde ese dato, simplemente deja de poder añadirse/editarse desde
          aquí y deja de pintarse tanto en "Probar" (`PlayerScreen.tsx`) como
          en la exportación (`exportedPlayerScript.ts`), ver sus
          comentarios. */}
      <div className={styles.responseMediaRow}>
        <span className={styles.label}>Audio</span>
        <MediaAttachment
          kind="audio"
          assetId={response.audioAssetId}
          filePath={filePath}
          onAttach={(assetId) =>
            updateResponse(slideNodeId, response.id, { audioAssetId: assetId })
          }
          onRemove={() => updateResponse(slideNodeId, response.id, { audioAssetId: null })}
          contextLabel={responseContextLabel}
        />
      </div>
      <ResponseVariablesSection slideNodeId={slideNodeId} response={response} variables={variables} />
    </div>
  )
}

/**
 * Sección de respuestas de una diapositiva. Se muestra SIEMPRE (para
 * cualquier diapositiva), porque "+ Añadir respuesta" es justo la vía por la
 * que una diapositiva "de continuar" se convierte en decisión — ya no hay un
 * tipo de nodo "Decisión" que crear desde el panel izquierdo. Con 0
 * respuestas solo se ve la cabecera con ese botón.
 */
/**
 * Sección de respuestas de una diapositiva. Se muestra SIEMPRE (para
 * cualquier diapositiva), porque "+ Añadir respuesta" es justo la vía por la
 * que una diapositiva "de continuar" se convierte en decisión — ya no hay un
 * tipo de nodo "Decisión" que crear desde el panel izquierdo. Con 0
 * respuestas solo se ve la cabecera con ese botón.
 *
 * El botón "+ Añadir respuesta" vive DENTRO de `.responsesList` (el mismo
 * flujo vertical que las filas de respuesta), como último elemento — no en
 * una cabecera aparte — para que aparezca justo debajo de la última
 * respuesta añadida: el flujo natural es "añades una, el botón para la
 * siguiente aparece justo debajo". Desaparece al llegar a `MAX_RESPONSES`.
 */
/**
 * Interruptor "Ordenar"/"Random" (petición de usuario) junto al título
 * "Respuestas": dos posiciones excluyentes, mismo criterio de paleta
 * cerrada que `RESPONSE_ORDERS` (`src/domain/schemas.ts`). "Ordenar" es el
 * valor por defecto (`null` al guardarlo — vuelve a `undefined` en el
 * documento, mismo patrón "por defecto = no escribir nada" que el resto de
 * opciones puramente visuales de la app), así que solo se guarda un valor
 * explícito al elegir "Random".
 */
function ResponseOrderToggle({
  slideNodeId,
  responseOrder,
}: {
  slideNodeId: string
  responseOrder: ResponseOrder
}) {
  const updateNode = useProjectStore((state) => state.updateNode)
  const labels: Record<ResponseOrder, string> = { ordered: 'Ordenar', random: 'Random' }

  return (
    <div className={styles.responseOrderToggle} role="group" aria-label="Orden de las respuestas">
      {RESPONSE_ORDERS.map((order) => (
        <button
          key={order}
          type="button"
          className={
            responseOrder === order ? styles.responseOrderButtonActive : styles.responseOrderButton
          }
          aria-pressed={responseOrder === order}
          onClick={() =>
            updateNode(slideNodeId, { responseOrder: order === 'ordered' ? null : order })
          }
        >
          {labels[order]}
        </button>
      ))}
    </div>
  )
}

export function ResponsesSection({
  node,
  allNodes,
  filePath,
  variables,
}: {
  node: SlideNode
  allNodes: Node[]
  filePath: string
  variables: VariableDef[]
}) {
  const addResponse = useProjectStore((state) => state.addResponse)
  const canAddResponse = node.responses.length < MAX_RESPONSES
  // Petición de usuario ("Ordenar"/"Random"): ya NO se ordena por letra —
  // se pinta el propio orden del array `node.responses` (el mismo que
  // `moveResponse` reordena a mano), que además es justo lo que el Player
  // presenta cuando `responseOrder` es `'ordered'`/ausente (ver
  // `orderResponses` en `src/player/runtime.ts`).
  const responses = node.responses
  const responseOrder: ResponseOrder = node.responseOrder ?? 'ordered'
  const canReorder = responseOrder === 'ordered' && responses.length > 1
  const lastIndex = responses.length - 1

  return (
    <div className={styles.responsesSection}>
      <div className={styles.responsesHeader}>
        <h3 className={styles.responsesTitle}>Respuestas</h3>
        {/* Interruptor "Ordenar"/"Random" (petición de usuario): solo con
            más de una respuesta — con 0 o 1 no hay nada que ordenar ni
            barajar. */}
        {responses.length > 1 && (
          <ResponseOrderToggle slideNodeId={node.id} responseOrder={responseOrder} />
        )}
      </div>
      <div className={styles.responsesList}>
        {responses.map((response, index) => (
          <ResponseRow
            key={response.id}
            slideNodeId={node.id}
            response={response}
            index={index + 1}
            arrayIndex={index}
            allNodes={allNodes}
            filePath={filePath}
            variables={variables}
            canReorder={canReorder}
            isFirst={index === 0}
            isLast={index === lastIndex}
          />
        ))}
        {canAddResponse && (
          <button
            type="button"
            className={styles.addResponseButton}
            onClick={() => addResponse(node.id)}
          >
            + Añadir respuesta
          </button>
        )}
      </div>
    </div>
  )
}
