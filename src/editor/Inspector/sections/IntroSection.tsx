import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useProjectStore } from '../../../store'
import { asignaturaBelongsToCiclo, asignaturaWorkspaceName, CICLOS } from '../../../domain'
import type { IntroNode, Node } from '../../../domain'
import styles from '../Inspector.module.css'
import { fieldClassName, NO_TARGET_VALUE, nodeOptionLabel } from '../Inspector'

/**
 * Sentinela del `<select>` de ciclo/asignatura de la diapositiva de Inicio
 * cuando no hay ninguno elegido. A diferencia de `NO_TARGET_VALUE` (que debe
 * ser un valor que NUNCA coincida con un id real, siempre UUID), `cicloId`/
 * `asignaturaId` son slugs/códigos del catálogo (`src/domain/catalog.ts`),
 * nunca vacíos — así que la cadena vacía nativa del `<select>` sin opción
 * elegida es un sentinela perfectamente seguro aquí, sin necesitar un valor
 * "mágico" como `NO_TARGET_VALUE`.
 */
const NO_CATALOG_VALUE = ''

/**
 * Edición de la diapositiva de Inicio (nodo `intro`, milestone "Diapositiva
 * de Inicio", Tarea 2): ciclo → asignatura en cascada, nombre del caso
 * práctico y destino tras la portada. Sustituye por completo a
 * `ContentBlocksSection`/`ContinueSection`/`ResponsesSection` para este tipo
 * de nodo — un `intro` no tiene bloques de contenido ni respuestas.
 *
 * Cascada ciclo → asignatura: cambiar de ciclo limpia `asignaturaId` en la
 * MISMA llamada a `updateNode` (una sola entrada de historial) cuando la
 * asignatura ya elegida no pertenece al ciclo nuevo (`asignaturaBelongsToCiclo`,
 * `src/domain/introValidation.ts`) — nunca se deja guardada una combinación
 * incoherente, ni siquiera momentáneamente entre dos acciones separadas. El
 * `<select>` de asignatura se deshabilita mientras no haya ciclo elegido, con
 * un aviso explícito en vez de un desplegable vacío confuso.
 *
 * "Destino tras la portada" (`targetNodeId`) reutiliza exactamente el mismo
 * patrón que "Destino de continuar" de `ContinueSection`: mismo sentinela
 * `NO_TARGET_VALUE`, mismo `connect`/`disconnect` genéricos (ya aceptan un
 * `intro` como origen, ver `src/domain/graph.ts`), mismo `nodeOptionLabel`.
 * Sin aviso textual propio aquí si falta destino — el aviso visual de "sin
 * salida" ya lo cubre el lienzo (ver `adapter.ts`/`nodeTypes.tsx`, que
 * detectan un `intro` sin `targetNodeId` con el mismo criterio que una
 * diapositiva "de continuar" sin destino), exactamente igual que
 * `ContinueSection` tampoco duplica ese aviso en el Inspector.
 */
export function IntroSection({ node, allNodes }: { node: IntroNode; allNodes: Node[] }) {
  const updateNode = useProjectStore((state) => state.updateNode)
  const connect = useProjectStore((state) => state.connect)
  const disconnect = useProjectStore((state) => state.disconnect)

  // Mismo criterio "commit on blur" que el resto de campos de texto libre
  // del Inspector (título, nota interna...): estado local + confirmación en
  // blur/Enter/desmontaje.
  const [caseName, setCaseName] = useState(node.caseName)
  const committedRef = useRef(node.caseName)
  const latestRef = useRef(caseName)
  latestRef.current = caseName

  useEffect(() => {
    return () => {
      commitCaseName()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commitCaseName() {
    const pending = latestRef.current
    if (pending === committedRef.current) return
    updateNode(node.id, { caseName: pending })
    committedRef.current = pending
  }

  function handleCaseNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') commitCaseName()
  }

  function handleCicloChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextCicloId = event.target.value
    if (nextCicloId === NO_CATALOG_VALUE) {
      updateNode(node.id, { cicloId: null, asignaturaId: null })
      return
    }
    const asignaturaStillValid = node.asignaturaId
      ? asignaturaBelongsToCiclo(nextCicloId, node.asignaturaId)
      : false
    updateNode(node.id, {
      cicloId: nextCicloId,
      // `undefined` (no tocar) si la asignatura ya elegida sigue
      // perteneciendo al ciclo nuevo; `null` (borrar) si no.
      asignaturaId: asignaturaStillValid ? undefined : null,
    })
  }

  function handleAsignaturaChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    updateNode(node.id, { asignaturaId: value === NO_CATALOG_VALUE ? null : value })
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

  const selectedCiclo = node.cicloId
    ? CICLOS.find((candidate) => candidate.id === node.cicloId)
    : undefined
  const asignaturaOptions = selectedCiclo?.asignaturas ?? []

  const cicloFieldId = 'inspector-intro-ciclo'
  const asignaturaFieldId = 'inspector-intro-asignatura'
  const caseNameFieldId = 'inspector-intro-case-name'
  const targetFieldId = 'inspector-intro-target'

  return (
    <div className={styles.introSection}>
      <div>
        <label className={styles.label} htmlFor={cicloFieldId}>
          Ciclo
        </label>
        <select
          id={cicloFieldId}
          className={styles.select}
          value={node.cicloId ?? NO_CATALOG_VALUE}
          onChange={handleCicloChange}
        >
          <option value={NO_CATALOG_VALUE}>— Elige un ciclo —</option>
          {CICLOS.map((ciclo) => (
            <option key={ciclo.id} value={ciclo.id}>
              {ciclo.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={styles.label} htmlFor={asignaturaFieldId}>
          Asignatura
        </label>
        <select
          id={asignaturaFieldId}
          className={styles.select}
          value={node.asignaturaId ?? NO_CATALOG_VALUE}
          onChange={handleAsignaturaChange}
          disabled={!node.cicloId}
        >
          <option value={NO_CATALOG_VALUE}>— Elige una asignatura —</option>
          {asignaturaOptions.map((asignatura) => (
            <option key={asignatura.id} value={asignatura.id}>
              {asignaturaWorkspaceName(asignatura)}
            </option>
          ))}
        </select>
        {!node.cicloId && <p className={styles.helperText}>Elige primero un ciclo.</p>}
      </div>
      <div>
        <label className={styles.label} htmlFor={caseNameFieldId}>
          Nombre del caso práctico interactivo
        </label>
        <input
          id={caseNameFieldId}
          className={fieldClassName(styles.input, caseName)}
          type="text"
          value={caseName}
          onChange={(event) => setCaseName(event.target.value)}
          onBlur={commitCaseName}
          onKeyDown={handleCaseNameKeyDown}
        />
      </div>
      <div>
        <label className={styles.label} htmlFor={targetFieldId}>
          Destino tras la portada
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
    </div>
  )
}
