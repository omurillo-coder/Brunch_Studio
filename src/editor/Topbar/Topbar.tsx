import { useEffect, useRef, useState } from 'react'
import {
  useCanRedo,
  useCanUndo,
  useProject,
  useProjectStore,
  useSelectedNodeIds,
} from '../../store'
import type { SaveStatus } from '../../store'
import {
  useAiReviewExport,
  useHtmlExport,
  useScormExport,
  useTeacherReviewExport,
} from '../../export'
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

/**
 * Aviso flotante del resultado de una exportación (éxito o error), anclado
 * bajo el botón "Exportar" (ver `.exportMessages` en `Topbar.module.css`) en
 * vez de metido en la fila de botones de la barra superior — donde antes
 * empujaba el resto de la barra y se quedaba fijo ahí para siempre.
 *
 * Se autodesaparece a los 5 segundos de montarse. El llamador solo lo monta
 * mientras `message` no es `null` (ver el `&&` en `Topbar`) y cada hook de
 * exportación pasa por `message: null` al empezar una exportación nueva
 * (`setMessage(null)` justo antes de `setStatus('exporting')`), así que una
 * exportación nueva siempre desmonta el aviso anterior y monta uno fresco
 * —con su propio temporizador desde cero— aunque el texto sea idéntico.
 */
function ExportToast({ status, message }: { status: string; message: string }) {
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), 5000)
    return () => clearTimeout(timer)
  }, [])

  if (expired) return null

  return (
    <div
      role={status === 'error' ? 'alert' : 'status'}
      className={status === 'error' ? styles.exportError : styles.exportStatus}
    >
      {message}
    </div>
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
 * deshacer/rehacer (con atajo de teclado), el menú "Exportar" y los botones
 * "Probar desde aquí"/"Probar".
 *
 * El menú "Exportar" (y no botones sueltos de "Exportar HTML"/"Exportar
 * SCORM"/etc.) vive aquí (y no en el panel izquierdo ni en el Inspector)
 * porque son acciones de proyecto, no de nodo: al lado del nombre del
 * proyecto, del estado de guardado y de "Probar" — las otras cosas de la
 * interfaz que hablan del documento entero y no de la selección actual.
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
  const selectedNodeIds = useSelectedNodeIds()
  const htmlExport = useHtmlExport(filePath)
  const scormExport = useScormExport(filePath)
  const teacherReviewExport = useTeacherReviewExport(filePath)
  const aiReviewExport = useAiReviewExport()
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  // "Probar desde aquí" (tarea "Probar desde aquí"): solo tiene sentido con
  // exactamente UN nodo seleccionado en el lienzo — con ninguno no hay nodo
  // por el que arrancar, y con varios no hay forma de elegir cuál. Ver
  // `selection.selectedNodeIds` (`useProjectStore.ts`).
  const canPlayFromSelection = selectedNodeIds.length === 1

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

  // Cierre del menú "Exportar": clic/mousedown fuera del menú (incluido el
  // propio botón "Exportar", ya cubierto porque forma parte de
  // `exportMenuRef`), o `Escape` — mismo patrón ya establecido en
  // `ConnectionMenu` (`src/editor/Canvas/ConnectionMenu.tsx`) para el menú
  // "¿Qué quieres añadir?": sin librería externa, un `<div>` posicionado en
  // CSS (`position: absolute`, ver `Topbar.module.css`) que se cierra solo.
  // Los listeners solo se registran mientras el menú está abierto.
  useEffect(() => {
    if (!exportMenuOpen) return

    function handlePointerDown(event: MouseEvent) {
      if (!exportMenuRef.current) return
      if (event.target instanceof Node && exportMenuRef.current.contains(event.target)) return
      setExportMenuOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setExportMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [exportMenuOpen])

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
            Tarea 1): botón toggle, mismo criterio visual que el botón
            "Exportar" (borde + fondo neutro), con `aria-pressed` reflejando
            si el panel está abierto — ver `VariablesPanel` en
            `EditorScreen`. */}
        <button
          type="button"
          className={styles.exportButton}
          onClick={onToggleVariablesPanel}
          aria-pressed={variablesPanelVisible}
        >
          Variables
        </button>
        {/* Menú "Exportar" (sustituye a los antiguos botones sueltos
            "Exportar HTML"/"Exportar SCORM"): un único botón que despliega
            un `<div>` posicionado en CSS con las cuatro opciones. */}
        <div className={styles.exportMenuWrapper} ref={exportMenuRef}>
          <button
            type="button"
            className={styles.exportButton}
            onClick={() => setExportMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={exportMenuOpen}
          >
            Exportar
          </button>
          {exportMenuOpen && (
            <div className={styles.exportMenu} role="menu" aria-label="Exportar">
              {/* "Exportar revisión profes": HTML autónomo pensado para que
                  un profesor sin el programa revise TODA la experiencia
                  ramificada — mismo cableado (estado + mensaje bajo el botón
                  "Exportar") que "Exportar HTML"/"Exportar SCORM" de abajo,
                  vía `useTeacherReviewExport(filePath)`. */}
              <button
                type="button"
                role="menuitem"
                className={styles.exportMenuItem}
                onClick={() => {
                  setExportMenuOpen(false)
                  void teacherReviewExport.exportTeacherReview()
                }}
                disabled={teacherReviewExport.status === 'exporting'}
              >
                {teacherReviewExport.status === 'exporting'
                  ? 'Exportando…'
                  : 'Exportar revisión profes'}
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.exportMenuItem}
                onClick={() => {
                  setExportMenuOpen(false)
                  void htmlExport.exportHtml()
                }}
                disabled={htmlExport.status === 'exporting'}
              >
                {htmlExport.status === 'exporting' ? 'Exportando…' : 'Exportar HTML'}
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.exportMenuItem}
                onClick={() => {
                  setExportMenuOpen(false)
                  void scormExport.exportScorm()
                }}
                disabled={scormExport.status === 'exporting'}
              >
                {scormExport.status === 'exporting' ? 'Exportando…' : 'Exportar SCORM'}
              </button>
              {/* "Exportar para revisión con IA" (petición de usuario: "que
                  este archivo lo pudiese ver ChatGPT o alguna otra IA"):
                  documento de texto/Markdown con TODA la estructura
                  narrativa, pensado para subirlo a cualquier IA de chat
                  externa y pedirle opinión — no un HTML/SCORM jugable, ver
                  comentario de `aiReviewExport.ts`. Mismo cableado que el
                  resto de opciones de este menú, vía
                  `useAiReviewExport()`. */}
              <button
                type="button"
                role="menuitem"
                className={styles.exportMenuItem}
                onClick={() => {
                  setExportMenuOpen(false)
                  void aiReviewExport.exportAiReview()
                }}
                disabled={aiReviewExport.status === 'exporting'}
              >
                {aiReviewExport.status === 'exporting'
                  ? 'Exportando…'
                  : 'Exportar para revisión con IA'}
              </button>
            </div>
          )}
          {/* Resultado de la última exportación, flotando bajo el botón
              "Exportar" (el menú ya se ha cerrado al elegir la opción, ver
              arriba) — mismo criterio de mensajes honestos y sin jerga que
              `HomeScreen`. `role="alert"` solo para el fallo (interrumpe al
              lector de pantalla porque hay algo que corregir); el éxito va
              como `role="status"`, que se anuncia sin interrumpir. Cada uno
              se autodesaparece a los 5s (ver `ExportToast`). */}
          <div className={styles.exportMessages}>
            {htmlExport.message && (
              <ExportToast status={htmlExport.status} message={htmlExport.message} />
            )}
            {scormExport.message && (
              <ExportToast status={scormExport.status} message={scormExport.message} />
            )}
            {teacherReviewExport.message && (
              <ExportToast status={teacherReviewExport.status} message={teacherReviewExport.message} />
            )}
            {aiReviewExport.message && (
              <ExportToast status={aiReviewExport.status} message={aiReviewExport.message} />
            )}
          </div>
        </div>
        {/* "Probar desde aquí": mismo estilo visual que "▶ Probar", pero
            deshabilitado salvo con exactamente un nodo seleccionado en el
            lienzo (`canPlayFromSelection`). Pasa ese único id como segundo
            argumento de `setPreviewMode` — el override de "por dónde
            arranca esta sesión de Probar" (ver `UiState.previewStartNodeId`
            en `store/types.ts`), consumido por `PlayerScreen`. */}
        <button
          type="button"
          className={styles.playButton}
          onClick={() => setPreviewMode(true, selectedNodeIds[0])}
          disabled={!canPlayFromSelection}
          title={
            canPlayFromSelection
              ? undefined
              : 'Selecciona exactamente una diapositiva en el lienzo para probar desde ahí'
          }
        >
          ▶ Probar desde aquí
        </button>
        <button type="button" className={styles.playButton} onClick={() => setPreviewMode(true)}>
          ▶ Probar
        </button>
      </div>
    </header>
  )
}
