import { useEffect, useRef } from 'react'
import type { NodePosition, NodeType } from '../../domain'
import { NODE_TYPE_LABEL } from './nodes/nodeTypes'
import styles from './ConnectionMenu.module.css'

/**
 * Tipos ofrecidos por el menú "¿Qué quieres añadir?" (fase 7). No incluye
 * `start`: solo puede existir un nodo de Inicio por proyecto, igual que en
 * `LeftPanel`.
 */
const MENU_TYPES: NodeType[] = ['content', 'decision', 'final']

export interface ConnectionMenuProps {
  /** Posición de pantalla (viewport) donde pintar el menú — normalmente
   *  `ui.contextMenu.position`. Se usa tal cual con `position: fixed`. */
  position: NodePosition
  /** Elegida una opción. Quien la reciba es responsable de convertir la
   *  posición a coordenadas de lienzo y de crear+conectar el nodo. */
  onSelect: (type: NodeType) => void
  /** Cancelar sin crear nada: clic fuera del menú o `Escape`. */
  onClose: () => void
}

/**
 * Menú contextual pequeño y discreto que aparece al soltar una conexión
 * arrastrada desde un handle real sobre una zona vacía del lienzo (ver
 * `Canvas.handleConnectEnd` / `handles.resolveEmptyPaneDrop`).
 *
 * Puramente de presentación: no conoce `@xyflow/react`, el store, ni cómo
 * convertir coordenadas — solo pinta las 3 opciones en la posición indicada
 * y delega en `onSelect`/`onClose`. Las etiquetas se reutilizan del
 * diccionario ya usado por los nodos del lienzo (`NODE_TYPE_LABEL`).
 */
export function ConnectionMenu({ position, onSelect, onClose }: ConnectionMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  // Cerrar sin crear nada: clic/mousedown fuera del menú, o `Escape`. Se
  // registran en `document` (no en el propio nodo) para detectar cualquier
  // clic fuera, incluido uno sobre el pane del lienzo o sobre otro nodo.
  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current) return
      if (event.target instanceof Node && rootRef.current.contains(event.target)) return
      onClose()
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={rootRef}
      className={styles.menu}
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label="¿Qué quieres añadir?"
    >
      <div className={styles.title}>¿Qué quieres añadir?</div>
      {MENU_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          role="menuitem"
          className={styles.option}
          onClick={() => onSelect(type)}
        >
          {NODE_TYPE_LABEL[type]}
        </button>
      ))}
    </div>
  )
}
