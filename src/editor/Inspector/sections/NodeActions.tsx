import { useEffect, useRef, useState } from 'react'
import { useProjectStore } from '../../../store'
import type { Node } from '../../../domain'
import { NODE_TYPE_LABEL } from '../../Canvas/nodes/nodeTypes'
import styles from '../Inspector.module.css'
import { fieldClassName } from '../Inspector'

/**
 * Nota interna del diseñador instruccional (p.ej. "pedir gráfico a diseño"):
 * campo de texto libre, puramente de uso del equipo — nunca aparece en el
 * HTML/SCORM exportado (ver `stripEditorOnlyFields` en
 * `src/export/htmlBundle.ts`) ni en `PlayerScreen` (a diferencia del título,
 * que sí se ve en gris ahí). Mismo criterio "commit on blur" que el resto de
 * campos de texto de este panel. Disponible para cualquier tipo de nodo.
 */
export function InternalNoteField({ node }: { node: Node }) {
  const updateNode = useProjectStore((state) => state.updateNode)

  const [value, setValue] = useState(node.internalNote ?? '')
  const committedRef = useRef(node.internalNote ?? '')
  const latestRef = useRef(value)
  latestRef.current = value

  useEffect(() => {
    return () => {
      commitPending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commitPending() {
    const pending = latestRef.current
    if (pending === committedRef.current) return
    updateNode(node.id, { internalNote: pending.trim() === '' ? null : pending })
    committedRef.current = pending
  }

  const fieldId = 'inspector-internal-note'

  return (
    <div>
      <label className={styles.label} htmlFor={fieldId}>
        Nota interna (no se exporta)
      </label>
      <textarea
        id={fieldId}
        className={fieldClassName(styles.textarea, value)}
        rows={3}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commitPending}
      />
    </div>
  )
}

/**
 * Botón de eliminar el nodo seleccionado, con confirmación INLINE (nunca
 * `window.confirm()` del navegador ni un modal propio — mismo criterio "sin
 * diálogos/overlays propios" que el resto de la app, ver comentario de
 * diseño en `HomeScreen`). El primer clic NO borra nada todavía: sustituye
 * el propio botón por un aviso con dos acciones, "Sí, eliminar" (la única
 * que de verdad llama a `deleteNode`) y "Cancelar" (vuelve al botón normal
 * sin tocar el documento).
 *
 * Nunca se monta para la diapositiva de inicio: `NodeFields` ya filtra ese
 * caso antes de renderizar este componente (ver `node.id !== startNodeId`
 * más abajo) — el dominio (`store.deleteNode`) lanzaría si se intentara
 * borrar de todos modos.
 *
 * Estado de confirmación puramente local (`useState`, no en el store): al
 * montarse con `key={node.id}` a través de `NodeFields` (ver su comentario
 * de diseño), cambiar de nodo seleccionado destruye y vuelve a crear esta
 * instancia, así que la confirmación nunca queda "colgada" de un nodo
 * distinto al que se está mirando.
 */
export function DeleteNodeButton({ node }: { node: Node }) {
  const deleteNode = useProjectStore((state) => state.deleteNode)
  const [confirming, setConfirming] = useState(false)
  const typeLabel = NODE_TYPE_LABEL[node.type].toLowerCase()

  if (confirming) {
    return (
      <div className={styles.deleteNodeConfirm}>
        <span className={styles.deleteNodeConfirmText}>¿Eliminar {typeLabel}?</span>
        <div className={styles.deleteNodeConfirmActions}>
          <button
            type="button"
            className={styles.deleteNodeConfirmButton}
            onClick={() => deleteNode(node.id)}
          >
            Sí, eliminar
          </button>
          <button
            type="button"
            className={styles.cancelDeleteButton}
            onClick={() => setConfirming(false)}
          >
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      className={styles.deleteNodeButton}
      onClick={() => setConfirming(true)}
    >
      Eliminar {typeLabel}
    </button>
  )
}

/**
 * Botón "Duplicar" del nodo seleccionado (Tarea 1, "Duplicar diapositivas").
 * A diferencia de `DeleteNodeButton`, no lleva confirmación: duplicar no es
 * una acción destructiva (crea un nodo nuevo, nunca toca ni sobrescribe el
 * original) y ya cuenta con deshacer si el usuario se arrepiente, mismo
 * criterio que el resto de acciones directas de esta app (p.ej. "Ordenar
 * automáticamente" en `Canvas`).
 *
 * Disponible también para la diapositiva de inicio (a diferencia de
 * `DeleteNodeButton`, que `NodeFields` nunca monta para ella): duplicarla es
 * perfectamente seguro porque la copia NO hereda esa condición especial —
 * ver el comentario de diseño de `duplicateNode` en `src/domain/project.ts`.
 */
export function DuplicateNodeButton({ node }: { node: Node }) {
  const duplicateNode = useProjectStore((state) => state.duplicateNode)
  const typeLabel = NODE_TYPE_LABEL[node.type].toLowerCase()

  return (
    <button
      type="button"
      className={styles.duplicateNodeButton}
      onClick={() => duplicateNode(node.id)}
    >
      Duplicar {typeLabel}
    </button>
  )
}
