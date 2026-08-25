import { useEffect } from 'react'
import { useCanRedo, useCanUndo, useProject, useProjectStore } from '../../store'
import type { SaveStatus } from '../../store'
import { useHtmlExport, useScormExport } from '../../export'
import { openNewProjectWindow } from '../../app/openNewProjectWindow'
import styles from './Topbar.module.css'

/**
 * Texto mostrado para cada `saveStatus` del store. El autoguardado real
 * (debounce, escritura efectiva a disco) vive en
 * `src/editor/EditorScreen/useAutosave.ts` (fase 9); aquí solo se traduce
 * el estado tal cual esté en el store. `idle` se muestra igual que `saved`
 * ("Guardado") porque representa un documento recién creado/abierto que ya
 * coincide con el disco (ver comentario de diseño de `SaveStatus` en
 * `store/types.ts`) — mostrar algo distinto a "Guardado" ahí sería confuso.
 * `error` se traduce a un texto honesto: el último guardado falló de
 * verdad, no debe fingirse "Guardado".
 */
const SAVE_STATUS_LABEL: Record<SaveStatus, string> = {
  idle: 'Guardado',
  saving: 'Guardando…',
  saved: 'Guardado',
  error: 'Error al guardar',
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  )
}

export interface TopbarProps {
  /**
   * Ruta absoluta del `.brunch` abierto. La necesita "Exportar HTML" para
   * leer los bytes de los assets adjuntos que hay que embeber en el archivo
   * exportado (`resolveExportAssets`) — mismo prop-drilling de `filePath` ya
   * establecido en `Inspector`/`PlayerScreen`/`useAutosave`: es un detalle de
   * la sesión de edición, no del documento, así que no vive en
   * `useProjectStore`.
   */
  filePath: string
  /**
   * Vuelve a `HomeScreen` en la misma ventana. Lo llama `EditorScreen`
   * (`handleCloseProject`), que primero fuerza cualquier guardado pendiente
   * y solo entonces invoca esto: aquí no hay ninguna lógica de guardado,
   * solo el botón que dispara el callback.
   */
  onCloseProject: () => void
}

/**
 * Barra superior del editor: nombre del proyecto, estado de guardado,
 * deshacer/rehacer (con atajo de teclado), "Exportar HTML", "Exportar
 * SCORM" y el botón "Probar".
 *
 * "Exportar HTML"/"Exportar SCORM" viven aquí (y no en el panel izquierdo ni
 * en el Inspector) porque son acciones de proyecto, no de nodo: al lado del
 * nombre del proyecto, del estado de guardado y de "Probar" — las otras
 * cosas de la interfaz que hablan del documento entero y no de la selección
 * actual.
 */
export function Topbar({ filePath, onCloseProject }: TopbarProps) {
  const project = useProject()
  const saveStatus = useProjectStore((state) => state.saveStatus)
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()
  const undo = useProjectStore((state) => state.undo)
  const redo = useProjectStore((state) => state.redo)
  const setPreviewMode = useProjectStore((state) => state.setPreviewMode)
  const htmlExport = useHtmlExport(filePath)
  const scormExport = useScormExport(filePath)

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
        {/* Resultado de la última exportación. `role="alert"` solo para el
            fallo (interrumpe al lector de pantalla porque hay algo que
            corregir); el éxito va como `role="status"`, que se anuncia sin
            interrumpir. Mismo criterio de mensajes honestos y sin jerga que
            `HomeScreen`. */}
        {htmlExport.message && (
          <span
            role={htmlExport.status === 'error' ? 'alert' : 'status'}
            className={
              htmlExport.status === 'error' ? styles.exportError : styles.exportStatus
            }
          >
            {htmlExport.message}
          </span>
        )}
        <button
          type="button"
          className={styles.exportButton}
          onClick={htmlExport.exportHtml}
          disabled={htmlExport.status === 'exporting'}
        >
          {htmlExport.status === 'exporting' ? 'Exportando…' : 'Exportar HTML'}
        </button>
        {/* Mismo criterio de mensaje honesto y sin jerga que "Exportar
            HTML" de arriba. */}
        {scormExport.message && (
          <span
            role={scormExport.status === 'error' ? 'alert' : 'status'}
            className={
              scormExport.status === 'error' ? styles.exportError : styles.exportStatus
            }
          >
            {scormExport.message}
          </span>
        )}
        <button
          type="button"
          className={styles.exportButton}
          onClick={scormExport.exportScorm}
          disabled={scormExport.status === 'exporting'}
        >
          {scormExport.status === 'exporting' ? 'Exportando…' : 'Exportar SCORM'}
        </button>
        <button type="button" className={styles.playButton} onClick={() => setPreviewMode(true)}>
          ▶ Probar
        </button>
        {/* Acciones de sesión (no de documento): trabajar con varios
            proyectos. Van al final, después de "Probar", para no competir
            visualmente con las acciones de proyecto (exportar) ni con la
            única acción de acento de la barra. Estilo neutro (mismo que
            "Exportar HTML/SCORM"): son acciones secundarias, sobrias, sin
            modal ni diálogo de confirmación — el autoguardado ya deja el
            `.brunch` al día antes de cerrar (ver `EditorScreen.handleCloseProject`). */}
        <button
          type="button"
          className={styles.exportButton}
          onClick={() => openNewProjectWindow()}
        >
          Nueva ventana
        </button>
        <button type="button" className={styles.exportButton} onClick={onCloseProject}>
          Cerrar proyecto
        </button>
      </div>
    </header>
  )
}
