import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useProject, useProjectStore, useSelectedNodeIds } from '../../store'
import type { Node, NodeType, ProjectDocument } from '../../domain'
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

/**
 * Campos de edición de un nodo (título/body), comunes a cualquier tipo —
 * incluida Decisión: la edición de respuestas A/B/C/D es explícitamente de
 * una fase posterior ("inspector completo").
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
function NodeFields({ node }: { node: Node }) {
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
        <NodeFields key={selectedNode.id} node={selectedNode} />
      ) : (
        <ProjectSummary project={project} />
      )}
    </aside>
  )
}
