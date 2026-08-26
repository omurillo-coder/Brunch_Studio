import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { checkSpelling, detectCycles, detectUnlinkedResponses } from '../../domain'
import type { CycleIssue, Node, SpellingIssue, UnlinkedResponseIssue } from '../../domain'
import { useProject, useProjectStore } from '../../store'
import styles from './DiagnosticsPanel.module.css'

/**
 * "Rinconcito de avisos" del lienzo: insignia flotante discreta con el
 * recuento total de avisos (ortografía + bucles + opciones sin vincular,
 * ver `src/domain/diagnostics.ts`), que se expande a una lista agrupada por
 * tipo al hacer clic. Completamente oculta cuando no hay ningún aviso — no
 * genera ruido visual en el caso normal (proyecto sin problemas).
 *
 * Montado desde `EditorScreen.tsx`, superpuesto al lienzo (ver su CSS: el
 * wrapper de `Canvas` ahí gana `position: relative` para que esta insignia,
 * `position: absolute`, se ancle a su esquina superior derecha —
 * deliberadamente lejos de los controles de abajo a la izquierda del
 * lienzo, `Controls`/auto-layout, ver `Canvas.module.css`).
 *
 * Coste de cada comprobación — deliberadamente asimétrico:
 * - Bucles/opciones sin vincular: cálculo síncrono barato sobre el grafo
 *   (`detectCycles`/`detectUnlinkedResponses`), recalculado con `useMemo`
 *   en cada cambio de `project` sin ningún problema de rendimiento.
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
 */

type SpellingState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; issues: SpellingIssue[] }
  | { status: 'error'; message: string }

/** Mismo criterio de formato que `LeftPanel` para el nombre visible de un
 *  nodo: número + "Referencia" (o el aviso de que no tiene). */
function nodeLabel(node: Node | undefined): string {
  if (!node) return 'diapositiva eliminada'
  const title = node.title.trim() || 'Sin referencia'
  return `${node.number}. ${title}`
}

export function DiagnosticsPanel() {
  const project = useProject()
  const focusNode = useProjectStore((state) => state.focusNode)
  const [open, setOpen] = useState(false)
  const [spelling, setSpelling] = useState<SpellingState>({ status: 'idle' })

  const nodeById = useMemo(() => {
    const map = new Map<string, Node>()
    for (const node of project.graph.nodes) {
      map.set(node.id, node)
    }
    return map
  }, [project])

  const cycles = useMemo(() => detectCycles(project), [project])
  const unlinkedResponses = useMemo(() => detectUnlinkedResponses(project), [project])

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

  const spellingIssues = spelling.status === 'done' ? spelling.issues : []
  const total = cycles.length + unlinkedResponses.length + spellingIssues.length

  function goToNode(nodeId: string): void {
    focusNode(nodeId)
  }

  if (total === 0) {
    return null
  }

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.badge}
        aria-expanded={open}
        aria-label={`${total} avisos del proyecto`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.badgeIcon} aria-hidden="true">
          ⚠
        </span>
        <span className={styles.badgeCount}>{total}</span>
      </button>

      {open && (
        <div className={styles.list} role="region" aria-label="Avisos del proyecto">
          <DiagnosticsGroup title="Bucles" empty="Sin bucles detectados" items={cycles.length}>
            {cycles.map((cycle, index) => (
              <CycleRow key={index} cycle={cycle} nodeById={nodeById} onSelect={goToNode} />
            ))}
          </DiagnosticsGroup>

          <DiagnosticsGroup
            title="Opciones sin vincular"
            empty="Todas las respuestas tienen destino"
            items={unlinkedResponses.length}
          >
            {unlinkedResponses.map((issue) => (
              <UnlinkedResponseRow
                key={`${issue.nodeId}:${issue.responseId}`}
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
            <SpellingList spelling={spelling} nodeById={nodeById} onSelect={goToNode} />
          </div>
        </div>
      )}
    </div>
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
  return (
    <button
      type="button"
      className={styles.issueRow}
      onClick={() => firstNodeId && onSelect(firstNodeId)}
    >
      Bucle detectado entre {cycle.nodeIds.length} diapositivas ({path}) — revisa si es intencional
    </button>
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
  return (
    <button type="button" className={styles.issueRow} onClick={() => onSelect(issue.nodeId)}>
      {label}: la respuesta "{responseText}" no tiene destino conectado
    </button>
  )
}

function SpellingList({
  spelling,
  nodeById,
  onSelect,
}: {
  spelling: SpellingState
  nodeById: Map<string, Node>
  onSelect: (nodeId: string) => void
}) {
  if (spelling.status === 'idle' || spelling.status === 'loading') {
    return <p className={styles.emptyGroup}>Revisando ortografía…</p>
  }
  if (spelling.status === 'error') {
    return <p className={styles.emptyGroup}>No se pudo revisar la ortografía: {spelling.message}</p>
  }
  if (spelling.issues.length === 0) {
    return <p className={styles.emptyGroup}>Sin errores ortográficos detectados</p>
  }
  return (
    <>
      {spelling.issues.map((issue, index) => (
        <button
          key={`${issue.nodeId}:${issue.word}:${index}`}
          type="button"
          className={styles.issueRow}
          onClick={() => onSelect(issue.nodeId)}
        >
          {nodeLabel(nodeById.get(issue.nodeId))}: posible error ortográfico en "{issue.word}"
        </button>
      ))}
    </>
  )
}
