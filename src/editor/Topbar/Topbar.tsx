import { useEffect } from 'react'
import { useCanRedo, useCanUndo, useProject, useProjectStore } from '../../store'
import type { SaveStatus } from '../../store'
import { useHtmlExport, useScormExport, useScriptExport } from '../../export'
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

/**
 * Icono sobrio de "panel lateral" para el botón de mostrar/ocultar el panel
 * izquierdo (tarea 1): un rectángulo con una franja vertical, evocando un
 * panel lateral dentro de una ventana — mismo criterio que el resto de
 * iconos propios de esta app (p.ej. `AutoLayoutIcon` en `Canvas.tsx`): SVG
 * inline sin depender de ningún set de iconos externo.
 */
function SidebarToggleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="2.5" y="4" width="19" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1="9.5" y1="4" x2="9.5" y2="20" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
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
  /** Estado actual de visibilidad del panel izquierdo (tarea 1); vive en
   *  `EditorScreen`, no aquí — este componente solo pinta el botón y avisa. */
  leftPanelVisible: boolean
  /** Alterna la visibilidad del panel izquierdo. */
  onToggleLeftPanel: () => void
  /** Estado actual de visibilidad del panel de variables (fase 2 del
   *  milestone "Variables/condiciones", Tarea 1); vive en `EditorScreen`,
   *  mismo criterio que `leftPanelVisible`. */
  variablesPanelVisible: boolean
  /** Alterna la visibilidad del panel de variables. */
  onToggleVariablesPanel: () => void
}

/**
 * Barra superior del editor: nombre del proyecto, estado de guardado,
 * deshacer/rehacer (con atajo de teclado), "Exportar HTML", "Exportar
 * SCORM", "Exportar guión" y el botón "Probar".
 *
 * "Exportar HTML"/"Exportar SCORM"/"Exportar guión" viven aquí (y no en el
 * panel izquierdo ni en el Inspector) porque son acciones de proyecto, no de
 * nodo: al lado del nombre del proyecto, del estado de guardado y de
 * "Probar" — las otras cosas de la interfaz que hablan del documento entero y
 * no de la selección actual. "Exportar guión" (`src/export/scriptExport.ts`)
 * es un documento de solo lectura para revisar contenido, distinto del
 * export interactivo de los otros dos botones.
 */
export function Topbar({
  filePath,
  leftPanelVisible,
  onToggleLeftPanel,
  variablesPanelVisible,
  onToggleVariablesPanel,
}: TopbarProps) {
  const project = useProject()
  const saveStatus = useProjectStore((state) => state.saveStatus)
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()
  const undo = useProjectStore((state) => state.undo)
  const redo = useProjectStore((state) => state.redo)
  const setPreviewMode = useProjectStore((state) => state.setPreviewMode)
  const htmlExport = useHtmlExport(filePath)
  const scormExport = useScormExport(filePath)
  const scriptExport = useScriptExport()

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
        <button
          type="button"
          className={styles.iconButton}
          onClick={onToggleLeftPanel}
          aria-pressed={leftPanelVisible}
          aria-label={leftPanelVisible ? 'Ocultar panel izquierdo' : 'Mostrar panel izquierdo'}
          title={leftPanelVisible ? 'Ocultar panel izquierdo' : 'Mostrar panel izquierdo'}
        >
          <SidebarToggleIcon />
        </button>
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
        {/* Panel de variables del proyecto (fase 2 "Variables/condiciones",
            Tarea 1): botón toggle, mismo criterio visual que
            "Exportar HTML"/"Exportar SCORM" (borde + fondo neutro), con
            `aria-pressed` reflejando si el panel está abierto — ver
            `VariablesPanel` en `EditorScreen`. */}
        <button
          type="button"
          className={styles.exportButton}
          onClick={onToggleVariablesPanel}
          aria-pressed={variablesPanelVisible}
        >
          Variables
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
        {/* "Exportar guión": vista de solo lectura en texto claro de todo el
            escenario, para revisar contenido sin el programa (documento
            distinto del export interactivo de arriba, ver
            `src/export/scriptExport.ts`). Mismo criterio de mensaje honesto
            y sin jerga que los dos anteriores. */}
        {scriptExport.message && (
          <span
            role={scriptExport.status === 'error' ? 'alert' : 'status'}
            className={
              scriptExport.status === 'error' ? styles.exportError : styles.exportStatus
            }
          >
            {scriptExport.message}
          </span>
        )}
        <button
          type="button"
          className={styles.exportButton}
          onClick={scriptExport.exportScript}
          disabled={scriptExport.status === 'exporting'}
        >
          {scriptExport.status === 'exporting' ? 'Exportando…' : 'Exportar guión'}
        </button>
        <button type="button" className={styles.playButton} onClick={() => setPreviewMode(true)}>
          ▶ Probar
        </button>
      </div>
    </header>
  )
}
