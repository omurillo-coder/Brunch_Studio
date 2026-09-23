import { useProjectStore } from '../../../store'
import { defaultAlternateCondition } from '../../../domain'
import type { FinalNode, VariableCondition, VariableDef } from '../../../domain'
import { RichTextEditor } from '../../richText/RichTextEditor'
import styles from '../Inspector.module.css'
import { ConditionEditor, defaultValueForVariable } from './variableConditions'

/**
 * Milestone "+1 fallo con Game Over", petición de usuario: el desplegable
 * de variante de un Final (general/bueno/malo, `FinalVariantSchema`) YA NO
 * se muestra aquí — quedó redundante en cuanto la variante "buena/con
 * fallos" pasó a decidirla la propia variable "Fallos" a través de
 * `FinalAlternateSection` (más abajo): normalmente hay un ÚNICO nodo Final
 * por proyecto, y su contenido alternativo (no una categoría manual
 * aparte) es lo que distingue "Final Ok" de "Final con fallos". El campo
 * `variant` sigue existiendo en el dominio (`FinalNodeSchema`, valor por
 * defecto `'general'`) — se conserva por compatibilidad con documentos
 * `.brunch` guardados antes de este cambio y con la importación de Twee
 * (`src/import/twee/tweeConverter.ts`), pero ya no tiene ningún control de
 * edición en la UI.
 */

/**
 * Variante alternativa de un Final (milestone "+1 fallo con Game Over":
 * "Final Ok"/"Final con fallos" con un ÚNICO nodo Final, ver comentario de
 * `FinalNodeSchema.alternateCondition`/`alternateBody` en `schemas.ts`).
 * Quien diseña el caso solo conecta UN destino a este nodo; esta sección es
 * la que decide CUÁNDO se activa el contenido alternativo — el contenido
 * "de siempre" (arriba, el editor de "Contenido") sigue siendo el que se ve
 * si la condición no se cumple.
 *
 * Petición de usuario ("que siempre salgan esos dos finales, con fallos y
 * sin fallos (TOP)... que no haga falta que yo le dé al botón de quitar o
 * poner variante alternativa y que siempre salga"): ya no hay ningún paso
 * de activación/desactivación. La condición se muestra SIEMPRE, y sin
 * ningún botón para quitarla: es una parte fija de cualquier Final, no una
 * opción.
 *
 * Sin condición guardada todavía, lo que se muestra por defecto tiene DOS
 * niveles, a propósito NO son lo mismo:
 * 1. Si el proyecto tiene una variable "Fallos" (`defaultAlternateCondition`,
 *    `src/domain/nodePacks.ts`), se usa "Fallos > 0" — el MISMO criterio
 *    que ya aplica el recorrido real sin que el diseñador toque nada (ver
 *    `resolveFinalContent` en `src/player/runtime.ts`): lo que se ve aquí
 *    ES lo que va a pasar.
 * 2. Si no hay ninguna variable "Fallos" pero sí OTRAS, se ofrece la
 *    primera como punto de partida EDITABLE (mismo criterio que el antiguo
 *    botón "+ Añadir variante alternativa") — pero, a diferencia del caso
 *    1, esto NO se activa solo por mostrarse: como no se escribe en el
 *    documento hasta que el diseñador interactúa con el editor, el
 *    recorrido real sigue sin variante alternativa mientras tanto.
 *    Deliberado: activar automáticamente una condición sobre una variable
 *    que no se llama "Fallos" secuestraría su significado sin que nadie lo
 *    pidiera (p.ej. una variable de enrutado condicional que no tiene nada
 *    que ver con fallos).
 * Sin ninguna variable en el proyecto, mismo aviso sobrio que el resto de
 * secciones de condición (`ResponseConditionSection`/
 * `ConditionalRoutingSection`) en vez de un editor sin nada que ofrecer.
 *
 * El confeti (antes un checkbox "Mostrar confeti…") también dejó de ser una
 * opción: petición de usuario ("quita el check del confeti que no tiene
 * sentido... ponlo siempre en el Final TOP") — siempre en el contenido por
 * defecto, nunca en el alternativo (ver `celebrate` en `runtime.ts`), sin
 * ningún control aquí.
 */
export function FinalAlternateSection({ node, variables }: { node: FinalNode; variables: VariableDef[] }) {
  const updateNode = useProjectStore((state) => state.updateNode)
  const bodyLabelId = 'inspector-final-alternate-body-label'

  if (variables.length === 0) {
    return (
      <div className={styles.conditionSection}>
        <span className={styles.label}>Variante alternativa ("con fallos")</span>
        <p className={styles.noVariablesNotice}>
          Todavía no hay variables en el proyecto. Créalas desde el panel "Variables" para poder
          condicionar cuándo se muestra el Final "con fallos" en vez del "TOP".
        </p>
      </div>
    )
  }

  // Dos niveles de "condición por defecto" cuando el nodo no tiene una
  // guardada — ver el comentario de cabecera para el porqué de la
  // distinción: `fallosDefault` SÍ está activa en el recorrido real ya
  // mismo (misma función que usa `resolveFinalContent`); el punto de
  // partida con la primera variable NO lo está todavía, solo se ofrece
  // para editar (`variables.length > 0` aquí arriba garantiza que
  // `variables[0]` existe).
  const fallosDefault = defaultAlternateCondition(variables)
  const firstVariable = variables[0]
  const editingStartingPoint: VariableCondition | undefined = firstVariable
    ? { variableId: firstVariable.id, operator: '==', value: defaultValueForVariable(firstVariable) }
    : undefined
  const effectiveCondition = node.alternateCondition ?? fallosDefault ?? editingStartingPoint
  if (!effectiveCondition) return null
  const isActiveAlready = Boolean(node.alternateCondition ?? fallosDefault)

  return (
    <div className={styles.conditionSection}>
      <span className={styles.label}>Variante alternativa ("con fallos")</span>
      <p className={styles.helperText}>
        {isActiveAlready
          ? 'El Final "TOP" (contenido de arriba, siempre con confeti) se muestra salvo que se ' +
            'cumpla esta condición — entonces se muestra el Final "con fallos" en su lugar, sin ' +
            'confeti.'
          : 'Todavía no hay ninguna variable "Fallos" en el proyecto: esta condición es solo un ' +
            'punto de partida, no se activa hasta que la edites.'}
      </p>
      <ConditionEditor
        condition={effectiveCondition}
        variables={variables}
        onChange={(next) => updateNode(node.id, { alternateCondition: next })}
        idPrefix={`inspector-final-alternate-condition-${node.id}`}
      />
      <div>
        <span id={bodyLabelId} className={styles.label}>
          Contenido alternativo (uso interno, para la revisión con IA — no se muestra en el
          recorrido real)
        </span>
        <RichTextEditor
          body={node.alternateBody ?? ''}
          onCommit={(nextBody) => updateNode(node.id, { alternateBody: nextBody })}
          ariaLabelledBy={bodyLabelId}
        />
      </div>
    </div>
  )
}
