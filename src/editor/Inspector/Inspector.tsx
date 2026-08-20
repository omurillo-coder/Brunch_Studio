import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useProject, useProjectStore, useSelectedNodeIds } from '../../store'
import { RESPONSE_LETTERS } from '../../domain'
import type { DecisionNode, DecisionResponse, Node, NodeType, ProjectDocument } from '../../domain'
import styles from './Inspector.module.css'

const NODE_TYPE_LABEL: Record<NodeType, string> = {
  start: 'Inicio',
  content: 'Pantalla',
  decision: 'Decisión',
  final: 'Final',
}

/** Vista sin selección: información básica de solo lectura del proyecto. */
function ProjectSummary({ project }: { project: ProjectDocument }) {
  const counts: Record<NodeType, number> = { start: 0, content: 0, decision: 0, final: 0 }
  for (const node of project.graph.nodes) {
    counts[node.type] += 1
  }

  return (
    <div>
      <h2 className={styles.summaryTitle}>{project.metadata.name}</h2>
      <dl className={styles.summaryList}>
        <div className={styles.summaryRow}>
          <dt>Nodos totales</dt>
          <dd>{project.graph.nodes.length}</dd>
        </div>
        <div className={styles.summaryRow}>
          <dt>{NODE_TYPE_LABEL.start}</dt>
          <dd>{counts.start}</dd>
        </div>
        <div className={styles.summaryRow}>
          <dt>{NODE_TYPE_LABEL.content}</dt>
          <dd>{counts.content}</dd>
        </div>
        <div className={styles.summaryRow}>
          <dt>{NODE_TYPE_LABEL.decision}</dt>
          <dd>{counts.decision}</dd>
        </div>
        <div className={styles.summaryRow}>
          <dt>{NODE_TYPE_LABEL.final}</dt>
          <dd>{counts.final}</dd>
        </div>
      </dl>
    </div>
  )
}

/** Valor de la opción "— Sin destino —" del `<select>` de destino de una
 *  respuesta. Nunca puede coincidir con un id real (los ids son UUIDs). */
const NO_TARGET_VALUE = '__none__'

/**
 * Etiqueta legible de un nodo para mostrarlo como destino posible en el
 * `<select>` de una respuesta — nunca el `id` interno (UUID) como texto
 * visible. Formato: "<Tipo> <número> — <título o 'Sin título'>", p.ej.
 * "Pantalla 3 — Bienvenida" o "Pantalla 3 — Sin título".
 */
function nodeOptionLabel(node: Node): string {
  const title = node.title.trim() || 'Sin título'
  return `${NODE_TYPE_LABEL[node.type]} ${node.number} — ${title}`
}

/** Respuestas de un nodo decision, siempre en el orden fijo A→B→C→D — el
 *  array interno conserva el orden de creación, que puede no coincidir con
 *  el orden de letra tras eliminar y reañadir una intermedia. */
function sortByLetter(responses: DecisionResponse[]): DecisionResponse[] {
  return [...responses].sort(
    (a, b) => RESPONSE_LETTERS.indexOf(a.letter) - RESPONSE_LETTERS.indexOf(b.letter),
  )
}

/**
 * Una fila de respuesta dentro del inspector de un nodo decision: texto
 * editable ("commit on blur", mismo criterio que título/body) y `<select>`
 * de destino.
 *
 * Se monta con `key={response.id}` desde `DecisionResponsesSection` por el
 * mismo motivo que `NodeFields` se monta con `key={node.id}`: el estado
 * local de texto debe arrancar limpio para cada respuesta y no reutilizarse
 * entre respuestas distintas si la lista se reordena.
 */
function ResponseRow({
  decisionNodeId,
  response,
  allNodes,
}: {
  decisionNodeId: string
  response: DecisionResponse
  allNodes: Node[]
}) {
  const updateResponse = useProjectStore((state) => state.updateResponse)
  const removeResponse = useProjectStore((state) => state.removeResponse)
  const connect = useProjectStore((state) => state.connect)
  const disconnect = useProjectStore((state) => state.disconnect)

  const [text, setText] = useState(response.text)
  const committedRef = useRef(response.text)
  const latestRef = useRef(text)
  latestRef.current = text

  useEffect(() => {
    return () => {
      commitPending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commitPending() {
    if (latestRef.current !== committedRef.current) {
      updateResponse(decisionNodeId, response.id, { text: latestRef.current })
      committedRef.current = latestRef.current
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      commitPending()
    }
  }

  function handleTargetChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    if (value === NO_TARGET_VALUE) {
      if (response.targetNodeId) {
        disconnect(decisionNodeId, response.id)
      }
    } else {
      connect(decisionNodeId, value, response.id)
    }
  }

  const textFieldId = `inspector-response-text-${response.id}`
  const targetFieldId = `inspector-response-target-${response.id}`

  return (
    <div className={styles.responseRow}>
      <div className={styles.responseRowHeader}>
        <span className={styles.responseLetter}>{response.letter}</span>
        <button
          type="button"
          className={styles.removeResponseButton}
          onClick={() => removeResponse(decisionNodeId, response.id)}
          aria-label={`Eliminar respuesta ${response.letter}`}
        >
          Eliminar
        </button>
      </div>
      <div>
        <label className={styles.label} htmlFor={textFieldId}>
          Texto de la respuesta {response.letter}
        </label>
        <input
          id={textFieldId}
          className={styles.input}
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commitPending}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div>
        <label className={styles.label} htmlFor={targetFieldId}>
          Destino de la respuesta {response.letter}
        </label>
        <select
          id={targetFieldId}
          className={styles.select}
          value={response.targetNodeId ?? NO_TARGET_VALUE}
          onChange={handleTargetChange}
        >
          <option value={NO_TARGET_VALUE}>— Sin destino —</option>
          {allNodes.map((node) => (
            <option key={node.id} value={node.id}>
              {nodeOptionLabel(node)}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

/**
 * Sección de respuestas de un nodo decision (fase 6, "inspector completo").
 * Explícitamente fuera de alcance en este milestone: imagen/audio/puntos
 * por respuesta (existen como campos opcionales del dominio pero no se
 * editan aquí) y el menú "¿qué quieres añadir?" al soltar una conexión en
 * el vacío (fase siguiente).
 */
function DecisionResponsesSection({
  node,
  allNodes,
}: {
  node: DecisionNode
  allNodes: Node[]
}) {
  const addResponse = useProjectStore((state) => state.addResponse)
  const canAddResponse = node.responses.length < 4
  const responses = sortByLetter(node.responses)

  return (
    <div className={styles.responsesSection}>
      <div className={styles.responsesSectionHeader}>
        <h3 className={styles.responsesTitle}>Respuestas</h3>
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
      <div className={styles.responsesList}>
        {responses.map((response) => (
          <ResponseRow
            key={response.id}
            decisionNodeId={node.id}
            response={response}
            allNodes={allNodes}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Campos de edición de un nodo (título/body), comunes a cualquier tipo, más
 * — para Decisión — la sección de respuestas (`DecisionResponsesSection`).
 *
 * Se monta con `key={node.id}` desde `Inspector` para que cambiar de nodo
 * seleccionado destruya y vuelva a crear esta instancia en vez de
 * reutilizarla. Eso da dos cosas gratis:
 * - Los campos locales (`title`/`body`) siempre arrancan con el valor del
 *   nodo recién seleccionado, sin lógica de sincronización manual.
 * - El efecto de limpieza (`useEffect` con `return () => ...`) se ejecuta
 *   exactamente cuando se abandona ese nodo (cambio de selección o
 *   deselección total), y ahí se confirma cualquier edición pendiente que
 *   no hubiera pasado por `onBlur` — el criterio elegido para "¿qué pasa
 *   si cambias de nodo sin hacer blur?".
 */
function NodeFields({ node, allNodes }: { node: Node; allNodes: Node[] }) {
  const updateNode = useProjectStore((state) => state.updateNode)

  const [title, setTitle] = useState(node.title)
  const [body, setBody] = useState(node.body)

  // Snapshot de lo último confirmado contra el store, para no repetir un
  // `updateNode` si el valor local coincide con lo ya guardado (evita una
  // entrada de historial vacía, p.ej. blur sin haber tecleado nada, o un
  // segundo blur tras un commit ya hecho con Enter).
  const committedRef = useRef({ title: node.title, body: node.body })
  // Siempre el valor local más reciente, para poder leerlo desde el
  // cleanup del efecto de desmontaje sin depender de closures obsoletas.
  const latestRef = useRef({ title, body })
  latestRef.current = { title, body }

  useEffect(() => {
    return () => {
      commitPending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commitPending() {
    const pending = latestRef.current
    const committed = committedRef.current
    if (pending.title !== committed.title || pending.body !== committed.body) {
      updateNode(node.id, { title: pending.title, body: pending.body })
      committedRef.current = { title: pending.title, body: pending.body }
    }
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      commitPending()
    }
  }

  return (
    <div className={styles.fields}>
      <div>
        <label className={styles.label} htmlFor="inspector-node-title">
          Título
        </label>
        <input
          id="inspector-node-title"
          className={styles.input}
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitPending}
          onKeyDown={handleTitleKeyDown}
        />
      </div>
      <div>
        <label className={styles.label} htmlFor="inspector-node-body">
          Contenido
        </label>
        <textarea
          id="inspector-node-body"
          className={styles.textarea}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onBlur={commitPending}
          rows={8}
        />
      </div>
      {node.type === 'decision' && <DecisionResponsesSection node={node} allNodes={allNodes} />}
    </div>
  )
}

/**
 * Inspector derecho: información del proyecto sin selección, o
 * título/contenido del nodo seleccionado. Con selección múltiple, muestra
 * los campos del primer nodo seleccionado (no hay edición multi-nodo en
 * esta fase).
 */
export function Inspector() {
  const project = useProject()
  const selectedNodeIds = useSelectedNodeIds()
  const selectedNodeId = selectedNodeIds[0] ?? null
  const selectedNode = selectedNodeId
    ? project.graph.nodes.find((node) => node.id === selectedNodeId) ?? null
    : null

  return (
    <aside className={styles.inspector}>
      {selectedNode ? (
        <NodeFields key={selectedNode.id} node={selectedNode} allNodes={project.graph.nodes} />
      ) : (
        <ProjectSummary project={project} />
      )}
    </aside>
  )
}
