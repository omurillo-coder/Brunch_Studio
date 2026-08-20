import { useEffect } from 'react'
import { useCanRedo, useCanUndo, useProject, useProjectStore } from '../../store'
import type { SaveStatus } from '../../store'
import styles from './Topbar.module.css'

/**
 * Texto mostrado para cada `saveStatus` del store. El autoguardado real
 * (debounce, escritura efectiva a disco) es de una fase posterior; aquí
 * solo se traduce el estado tal cual esté en el store. `idle` se muestra
 * igual que `saved` ("Guardado") porque en esta fase no hay manera de que
 * el documento esté "sin guardar" sin que exista lógica de guardado que lo
 * marque como tal — mostrar algo distinto a "Guardado" sin haber guardado
 * nunca nada sería confuso.
 */
const SAVE_STATUS_LABEL: Record<SaveStatus, string> = {
  idle: 'Guardado',
  saving: 'Guardando…',
  saved: 'Guardado',
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  )
}

/**
 * Barra superior del editor: nombre del proyecto, estado de guardado,
 * deshacer/rehacer (con atajo de teclado) y el botón "Probar".
 */
export function Topbar() {
  const project = useProject()
  const saveStatus = useProjectStore((state) => state.saveStatus)
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()
  const undo = useProjectStore((state) => state.undo)
  const redo = useProjectStore((state) => state.redo)
  const setPreviewMode = useProjectStore((state) => state.setPreviewMode)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Si el foco está en un campo de texto, se deja que el navegador
      // gestione su propio deshacer/rehacer de edición de texto en vez de
      // interceptarlo para el historial del documento.
      if (isEditableTarget(event.target)) return

      const modifier = event.metaKey || event.ctrlKey
      if (!modifier) return

      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault()
        redo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <span className={styles.projectName}>{project.metadata.name}</span>
        <span className={styles.saveStatus}>{SAVE_STATUS_LABEL[saveStatus]}</span>
      </div>
      <div className={styles.right}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={undo}
          disabled={!canUndo}
          aria-label="Deshacer"
          title="Deshacer (Cmd/Ctrl+Z)"
        >
          ↺
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={redo}
          disabled={!canRedo}
          aria-label="Rehacer"
          title="Rehacer (Cmd/Ctrl+Shift+Z)"
        >
          ↻
        </button>
        <button type="button" className={styles.playButton} onClick={() => setPreviewMode(true)}>
          ▶ Probar
        </button>
      </div>
    </header>
  )
}
