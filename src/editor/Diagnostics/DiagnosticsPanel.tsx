import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  checkSpelling,
  cycleIssueId,
  detectCycles,
  detectUnlinkedResponses,
  spellingIssueId,
  unlinkedResponseIssueId,
  validateProject,
  validationIssueId,
} from '../../domain'
import type {
  CycleIssue,
  Node,
  SpellingIssue,
  UnlinkedResponseIssue,
  ValidationIssue,
} from '../../domain'
import { useDismissedDiagnosticIds, useProject, useProjectStore } from '../../store'
import styles from './DiagnosticsPanel.module.css'

/**
 * "Rinconcito de avisos" del lienzo: insignia flotante discreta con el
 * recuento total de avisos (ortografía + bucles + opciones sin vincular +
 * estructura del recorrido, ver `src/domain/diagnostics.ts`/
 * `src/domain/validation.ts`), que se expande a una lista agrupada por tipo
 * al hacer clic. Completamente oculta cuando no hay ningún aviso — no
 * genera ruido visual en el caso normal (proyecto sin problemas).
 *
 * Montado desde `EditorScreen.tsx`, superpuesto al lienzo (ver su CSS: el
 * wrapper de `Canvas` ahí gana `position: relative` para que esta insignia,
 * `position: absolute`, se ancle a su esquina superior derecha —
 * deliberadamente lejos de los controles de abajo a la izquierda del
 * lienzo, `Controls`/auto-layout, ver `Canvas.module.css`).
 *
 * Grupo "Estructura del recorrido" (petición de usuario — fricción de UX
 * detectada: `validateProject` existía en el dominio desde hacía tiempo,
 * pero ningún consumidor lo llamaba; un nodo inalcanzable, un recorrido sin
 * ningún Final alcanzable, o una diapositiva "de continuar" sin destino,
 * pasaban desapercibidos hasta que un alumno se topaba con ellos en la
 * experiencia ya exportada): usa `validateProject` (`src/domain/
 * validation.ts`), EXCLUYENDO `RESPONSE_WITHOUT_TARGET` — ese código
 * concreto ya se muestra, con mejor detalle (el texto de la respuesta) y
 * mismo criterio de exclusión de `actsAsExit`, en el grupo "Opciones sin
 * vincular" de aquí abajo (`detectUnlinkedResponses`); mostrarlo también
 * aquí sería el mismo aviso duplicado dos veces. Mismo criterio síncrono y
 * barato que bucles/opciones sin vincular (no como ortografía).
 *
 * Coste de cada comprobación — deliberadamente asimétrico:
 * - Bucles/opciones sin vincular/estructura del recorrido: cálculo síncrono
 *   barato sobre el grafo (`detectCycles`/`detectUnlinkedResponses`/
 *   `validateProject`), recalculado con `useMemo` en cada cambio de
 *   `project` sin ningún problema de rendimiento.
 * - Ortografía (`checkSpelling`): async y costosa (carga de diccionario +
 *   recorrido de todo el texto del proyecto, ver `src/domain/
 *   spellingDictionary.ts`). Un efecto de montaje (`useEffect`, deps `[]`)
 *   la dispara UNA vez, en segundo plano, nada más montarse este panel —
 *   así el contador de la insignia puede reflejar las tres categorías desde
 *   el principio sin bloquear el primer render (mientras carga, esa
 *   categoría simplemente no aporta al contador todavía). Es una
 *   generalización deliberada de "dispárala al abrir el panel por primera
 *   vez": el disparo automático UNA sola vez al montar evita el caso
 *   degenerado en que la insignia esté oculta (cero bucles/respuestas
 *   sueltas) y por tanto no haya ningún botón que pulsar para arrancar
 *   manualmente el escaneo. El botón "Revisar ortografía" de la lista
 *   expandida permite volver a lanzarlo bajo demanda (p.ej. tras editar
 *   texto), sin disparar nada más por sí solo un cambio de `project`.
 *
 * Descartar avisos (tarea "Descartar avisos en el rincón de avisos"): cada
 * fila individual gana un botón "×" ("Descartar") que la oculta de la
 * lista. El descarte es SOLO DE SESIÓN — vive en `ui.dismissedDiagnosticIds`
 * de `useProjectStore` (transitorio: no se persiste en el `.brunch`, no
 * pasa por el historial de undo/redo, se reinicia con `loadProject`, ver su
 * comentario en `src/store/types.ts`), identificado por un id ESTABLE por
 * tipo de aviso (`cycleIssueId`/`unlinkedResponseIssueId`/`spellingIssueId`
 * de `src/domain/diagnostics.ts`, `validationIssueId` de `src/domain/
 * validation.ts` para "Estructura del recorrido"): si el problema real se
 * soluciona y luego
 * se reintroduce EXACTAMENTE igual más tarde, sigue apareciendo descartado
 * (mismo id) — comportamiento aceptado, sin lógica de expiración. El
 * contador de la insignia flotante (`total`) refleja solo los avisos NO
 * descartados; los descartados de esta sesión se cuentan aparte
 * (`dismissedCount`) y se recuperan TODOS a la vez con el enlace
 * "Recuperar" al final de la lista — no hay recuperación individual por
 * aviso en esta fase, ver comentario de `DismissedDiagnosticsFooter` más
 * abajo.
 */

type SpellingState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; issues: SpellingIssue[] }
  | { status: 'error'; message: string }

/** Mismo criterio de formato que `LeftPanel` para el nombre visible de un
 *  nodo: número + "Ref. oculta" (o el aviso de que no tiene). */
function nodeLabel(node: Node | undefined): string {
  if (!node) return 'diapositiva eliminada'
  const title = node.title.trim() || 'Sin ref. oculta'
  return `${node.number}. ${title}`
}

export function DiagnosticsPanel() {
  const project = useProject()
  const focusNode = useProjectStore((state) => state.focusNode)
  const dismissedIds = useDismissedDiagnosticIds()
  const [open, setOpen] = useState(false)
  const [spelling, setSpelling] = useState<SpellingState>({ status: 'idle' })

  const nodeById = useMemo(() => {
    const map = new Map<string, Node>()
    for (const node of project.graph.nodes) {
      map.set(node.id, node)
    }
    return map
  }, [project])

  const dismissedSet = useMemo(() => new Set(dismissedIds), [dismissedIds])

  const allCycles = useMemo(() => detectCycles(project), [project])
  const allUnlinkedResponses = useMemo(() => detectUnlinkedResponses(project), [project])
  // `RESPONSE_WITHOUT_TARGET` se excluye aquí: ya se muestra, con mejor
  // detalle, en "Opciones sin vincular" (`allUnlinkedResponses` arriba) —
  // ver el comentario de cabecera de este componente.
  const allStructureIssues = useMemo(
    () => validateProject(project).filter((issue) => issue.code !== 'RESPONSE_WITHOUT_TARGET'),
    [project],
  )
  // Los avisos DESCARTADOS se filtran de la lista/contador aquí, en un único
  // punto (en vez de repetir el filtro en cada grupo) — `cycles`/
  // `unlinkedResponses`/`structureIssues`/`spellingIssues` (más abajo) ya
  // son "los avisos que de verdad se muestran".
  const cycles = useMemo(
    () => allCycles.filter((cycle) => !dismissedSet.has(cycleIssueId(cycle))),
    [allCycles, dismissedSet],
  )
  const unlinkedResponses = useMemo(
    () => allUnlinkedResponses.filter((issue) => !dismissedSet.has(unlinkedResponseIssueId(issue))),
    [allUnlinkedResponses, dismissedSet],
  )
  const structureIssues = useMemo(
    () => allStructureIssues.filter((issue) => !dismissedSet.has(validationIssueId(issue))),
    [allStructureIssues, dismissedSet],
  )

  // Depende de `project`: así el botón "Revisar ortografía" de la lista
  // expandida siempre relee el texto ACTUAL (no una copia obsoleta cerrada
  // sobre el `project` del primer montaje) cuando el usuario lo pulsa tras
  // editar. El efecto de montaje de abajo, en cambio, solo llama a la
  // versión de esta función que existía en el primer render — es
  // deliberado, ver su comentario.
  const runSpellCheck = useCallback(() => {
    setSpelling({ status: 'loading' })
    checkSpelling(project)
      .then((issues) => setSpelling({ status: 'done', issues }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setSpelling({ status: 'error', message })
      })
  }, [project])

  // Escaneo de ortografía en segundo plano, disparado UNA sola vez al
  // montar este panel (deps `[]` a propósito: no debe repetirse en cada
  // cambio de `project`, ver comentario de cabecera del componente). Llama
  // a la función tal cual existe en el primer render; ediciones
  // posteriores del proyecto requieren el botón manual "Revisar ortografía"
  // para reflejarse (ese sí usa siempre el `project` más reciente, ver
  // arriba).
  useEffect(() => {
    runSpellCheck()
    // Deliberadamente sin `runSpellCheck` en las deps: solo debe correr una
    // vez, no cada vez que `project` cambia y por tanto recrea la función.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sin `useMemo`: `spelling.issues` ya es estable entre renders mientras el
  // estado de ortografía no cambie (mismo array de referencia, fijado una
  // vez por `setSpelling`), así que memoizar aquí encima no aporta nada —
  // solo generaría un warning de "dependencia inestable" porque la propia
  // expresión ternaria de la que depende (`allSpellingIssues`) sí cambia de
  // referencia en cada render.
  const allSpellingIssues = spelling.status === 'done' ? spelling.issues : []
  const spellingIssues = allSpellingIssues.filter(
    (issue) => !dismissedSet.has(spellingIssueId(issue)),
  )
  const total =
    cycles.length + unlinkedResponses.length + structureIssues.length + spellingIssues.length
  const dismissedCount = dismissedIds.length

  function goToNode(nodeId: string): void {
    focusNode(nodeId)
  }

  // Oculto solo cuando NO hay nada que mostrar en absoluto: ni avisos
  // activos ni avisos descartados de esta sesión. Si se descartó TODO
  // (`total === 0` con `dismissedCount > 0`), el panel se mantiene visible
  // para no dejar el "Recuperar" inalcanzable — ver comentario de cabecera.
  if (total === 0 && dismissedCount === 0) {
    return null
  }

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={total > 0 ? styles.badge : styles.badgeResolved}
        aria-expanded={open}
        aria-label={
          dismissedCount > 0
            ? `${total} avisos del proyecto, ${dismissedCount} descartados en esta sesión`
            : `${total} avisos del proyecto`
        }
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.badgeIcon} aria-hidden="true">
          {total > 0 ? '⚠' : '✓'}
        </span>
        <span className={styles.badgeCount}>{total}</span>
      </button>

      {open && (
        <div className={styles.list} role="region" aria-label="Avisos del proyecto">
          <DiagnosticsGroup title="Bucles" empty="Sin bucles detectados" items={cycles.length}>
            {cycles.map((cycle) => (
              <CycleRow key={cycleIssueId(cycle)} cycle={cycle} nodeById={nodeById} onSelect={goToNode} />
            ))}
          </DiagnosticsGroup>

          <DiagnosticsGroup
            title="Opciones sin vincular"
            empty="Todas las respuestas tienen destino"
            items={unlinkedResponses.length}
          >
            {unlinkedResponses.map((issue) => (
              <UnlinkedResponseRow
                key={unlinkedResponseIssueId(issue)}
                issue={issue}
                nodeById={nodeById}
                onSelect={goToNode}
              />
            ))}
          </DiagnosticsGroup>

          <DiagnosticsGroup
            title="Estructura del recorrido"
            empty="Sin problemas de estructura"
            items={structureIssues.length}
          >
            {structureIssues.map((issue) => (
              <StructureIssueRow
                key={validationIssueId(issue)}
                issue={issue}
                nodeById={nodeById}
                onSelect={goToNode}
              />
            ))}
          </DiagnosticsGroup>

          <div className={styles.group}>
            <div className={styles.groupHeader}>
              <span className={styles.groupTitle}>Ortografía</span>
              <button
                type="button"
                className={styles.rescanButton}
                onClick={runSpellCheck}
                disabled={spelling.status === 'loading'}
              >
                Revisar ortografía
              </button>
            </div>
            <SpellingList spelling={spelling} dismissedSet={dismissedSet} nodeById={nodeById} onSelect={goToNode} />
          </div>

          <DismissedDiagnosticsFooter count={dismissedCount} />
        </div>
      )}
    </div>
  )
}

/**
 * Pie de la lista: solo visible si hay algo descartado en esta sesión. Un
 * único "Recuperar" que restaura TODOS los avisos descartados a la vez
 * (`restoreDismissedDiagnostics`) — sin recuperación individual por aviso en
 * esta fase: con el volumen esperado de avisos (decenas, no cientos) no
 * aporta suficiente frente a la simplicidad de "recuperar todo" y da rastro
 * visible + forma de revertir el descarte, que es lo que pide la tarea.
 */
function DismissedDiagnosticsFooter({ count }: { count: number }) {
  const restoreDismissedDiagnostics = useProjectStore((state) => state.restoreDismissedDiagnostics)

  if (count === 0) return null

  return (
    <div className={styles.dismissedFooter}>
      <span>
        {count} {count === 1 ? 'aviso descartado' : 'avisos descartados'} en esta sesión
      </span>
      <button type="button" className={styles.rescanButton} onClick={restoreDismissedDiagnostics}>
        Recuperar
      </button>
    </div>
  )
}

/**
 * Botón "×" de descartar un aviso individual, compartido por las tres
 * categorías. `diagnosticId` es el id ESTABLE del aviso (ver
 * `cycleIssueId`/`unlinkedResponseIssueId`/`spellingIssueId`); `label`
 * describe el aviso concreto para el nombre accesible del botón (distinto
 * por fila, no un "Descartar" genérico repetido).
 */
function DismissButton({ diagnosticId, label }: { diagnosticId: string; label: string }) {
  const dismissDiagnostic = useProjectStore((state) => state.dismissDiagnostic)
  return (
    <button
      type="button"
      className={styles.dismissButton}
      aria-label={`Descartar aviso: ${label}`}
      onClick={() => dismissDiagnostic(diagnosticId)}
    >
      <span aria-hidden="true">×</span>
    </button>
  )
}

function DiagnosticsGroup({
  title,
  empty,
  items,
  children,
}: {
  title: string
  empty: string
  /** Número de avisos del grupo (independiente de `children`, que son los
   *  elementos ya renderizados) — decide si se muestra la lista o el
   *  mensaje `empty`. */
  items: number
  children: ReactNode
}) {
  return (
    <div className={styles.group}>
      <div className={styles.groupHeader}>
        <span className={styles.groupTitle}>{title}</span>
      </div>
      {items > 0 ? children : <p className={styles.emptyGroup}>{empty}</p>}
    </div>
  )
}

function CycleRow({
  cycle,
  nodeById,
  onSelect,
}: {
  cycle: CycleIssue
  nodeById: Map<string, Node>
  onSelect: (nodeId: string) => void
}) {
  const path = cycle.nodeIds.map((id) => nodeLabel(nodeById.get(id))).join(' → ')
  const firstNodeId = cycle.nodeIds[0]
  const text = `Bucle detectado entre ${cycle.nodeIds.length} diapositivas (${path}) — revisa si es intencional`
  return (
    <div className={styles.issueRowWrapper}>
      <button
        type="button"
        className={styles.issueRow}
        onClick={() => firstNodeId && onSelect(firstNodeId)}
      >
        {text}
      </button>
      <DismissButton diagnosticId={cycleIssueId(cycle)} label={text} />
    </div>
  )
}

function UnlinkedResponseRow({
  issue,
  nodeById,
  onSelect,
}: {
  issue: UnlinkedResponseIssue
  nodeById: Map<string, Node>
  onSelect: (nodeId: string) => void
}) {
  const label = nodeLabel(nodeById.get(issue.nodeId))
  const responseText = issue.responseText.trim() || '(sin texto)'
  const text = `${label}: la respuesta "${responseText}" no tiene destino conectado`
  return (
    <div className={styles.issueRowWrapper}>
      <button type="button" className={styles.issueRow} onClick={() => onSelect(issue.nodeId)}>
        {text}
      </button>
      <DismissButton diagnosticId={unlinkedResponseIssueId(issue)} label={text} />
    </div>
  )
}

/**
 * Texto legible por `ValidationIssue.code` (grupo "Estructura del
 * recorrido") — NUNCA `issue.message` (`src/domain/validation.ts`), que usa
 * el `id` interno del nodo (UUID): aquí, igual que `CycleRow`/
 * `UnlinkedResponseRow`, se usa `nodeLabel` (número + Ref. oculta) para que
 * la persona que diseña el caso pueda identificar la diapositiva sin
 * conocimientos técnicos. `MISSING_START`/`NO_REACHABLE_FINAL` no tienen
 * ningún `nodeId` concreto que señalar (son propiedades del PROYECTO
 * entero, no de una diapositiva) — `label` queda `null` en ese caso.
 */
function structureIssueText(issue: ValidationIssue, nodeById: Map<string, Node>): string {
  const label = issue.nodeId ? nodeLabel(nodeById.get(issue.nodeId)) : null
  switch (issue.code) {
    case 'MISSING_START':
      return 'El proyecto no tiene una diapositiva de inicio válida'
    case 'SLIDE_WITHOUT_TARGET':
      return `${label}: no tiene destino de continuar conectado`
    case 'RESPONSE_WITHOUT_TARGET':
      // No debería llegar aquí (se excluye antes de listar, ver
      // `allStructureIssues`) — mensaje de repuesto solo por si acaso.
      return `${label}: una respuesta no tiene destino conectado`
    case 'UNREACHABLE_NODE':
      return `${label}: no es alcanzable desde el inicio`
    case 'NO_REACHABLE_FINAL':
      return 'Ningún Final es alcanzable desde el inicio: el recorrido no puede terminar'
  }
}

/**
 * Fila de un aviso de "Estructura del recorrido" (`validateProject`,
 * `src/domain/validation.ts`). A diferencia de `CycleRow`/
 * `UnlinkedResponseRow`, no todos estos avisos tienen un nodo concreto al
 * que llevar (`MISSING_START`/`NO_REACHABLE_FINAL` son del proyecto
 * entero) — sin `nodeId`, la fila se pinta como texto no interactivo (sigue
 * pudiendo descartarse, pero no hay ningún sitio al que "ir").
 */
function StructureIssueRow({
  issue,
  nodeById,
  onSelect,
}: {
  issue: ValidationIssue
  nodeById: Map<string, Node>
  onSelect: (nodeId: string) => void
}) {
  const text = structureIssueText(issue, nodeById)
  const nodeId = issue.nodeId
  return (
    <div className={styles.issueRowWrapper}>
      {nodeId ? (
        <button type="button" className={styles.issueRow} onClick={() => onSelect(nodeId)}>
          {text}
        </button>
      ) : (
        <p className={styles.issueRow}>{text}</p>
      )}
      <DismissButton diagnosticId={validationIssueId(issue)} label={text} />
    </div>
  )
}

function SpellingList({
  spelling,
  dismissedSet,
  nodeById,
  onSelect,
}: {
  spelling: SpellingState
  dismissedSet: Set<string>
  nodeById: Map<string, Node>
  onSelect: (nodeId: string) => void
}) {
  if (spelling.status === 'idle' || spelling.status === 'loading') {
    return <p className={styles.emptyGroup}>Revisando ortografía…</p>
  }
  if (spelling.status === 'error') {
    return <p className={styles.emptyGroup}>No se pudo revisar la ortografía: {spelling.message}</p>
  }
  const issues = spelling.issues.filter((issue) => !dismissedSet.has(spellingIssueId(issue)))
  if (issues.length === 0) {
    return <p className={styles.emptyGroup}>Sin errores ortográficos detectados</p>
  }
  return (
    <>
      {issues.map((issue) => {
        const text = `${nodeLabel(nodeById.get(issue.nodeId))}: posible error ortográfico en "${issue.word}"`
        return (
          <div key={spellingIssueId(issue)} className={styles.issueRowWrapper}>
            <button type="button" className={styles.issueRow} onClick={() => onSelect(issue.nodeId)}>
              {text}
            </button>
            <DismissButton diagnosticId={spellingIssueId(issue)} label={text} />
          </div>
        )
      })}
    </>
  )
}
