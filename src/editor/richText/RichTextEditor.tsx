import { useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import {
  RICH_TEXT_EXTENSIONS,
  extractPlainText,
  parseRichBody,
  serializeRichBody,
} from './richTextContent'
import styles from './RichTextEditor.module.css'

export interface RichTextEditorProps {
  /** `body` (string) actual del nodo seleccionado. Solo se lee al montar —
   *  ver nota de `useEditor` más abajo. */
  body: string
  /**
   * Confirma el `body` serializado en el store. Se llama exactamente una vez
   * por edición al perder el foco ("commit on blur"), nunca por tecla —
   * mismo criterio que título/body de texto plano y las respuestas de una
   * diapositiva (`Inspector.tsx`).
   */
  onCommit: (nextBody: string) => void
  /**
   * Id del elemento que hace de etiqueta visible del campo (p.ej. el
   * `<span>` "Contenido" del Inspector). Se conecta al área editable vía
   * `aria-labelledby` — el editor real es un `<div contenteditable>`, no un
   * `<textarea>`, así que no puede asociarse con un `<label htmlFor>`
   * tradicional.
   */
  ariaLabelledBy?: string
}

interface ToolbarButtonConfig {
  key: string
  label: string
  /** Etiqueta accesible corta (aria-label), sin abreviar. */
  ariaLabel: string
  isActive: boolean
  onToggle: () => void
}

/** Botón de la barra contextual de tabla (sin estado activo/inactivo — son
 *  acciones puntuales, no formatos que se alternan): solo etiqueta, acción y
 *  si está disponible en el estado actual del documento. */
interface TableActionConfig {
  key: string
  label: string
  ariaLabel: string
  enabled: boolean
  onAction: () => void
}

type TextAlignValue = 'left' | 'center' | 'right' | 'justify'

/** Las 4 alineaciones del desplegable de justificación, en el orden en que
 *  se listan — "Izquierda" primero porque es el valor por defecto. */
const ALIGN_OPTIONS: { align: TextAlignValue; label: string }[] = [
  { align: 'left', label: 'Izquierda' },
  { align: 'center', label: 'Centro' },
  { align: 'right', label: 'Derecha' },
  { align: 'justify', label: 'Justificado' },
]

/**
 * Icono de justificación (petición de usuario: "un desplegable con un
 * icono de justificación"): 4 líneas horizontales tipo "párrafo de texto",
 * de ancho variable salvo en `justify` (las 4 a ancho completo, como un
 * párrafo justificado de verdad) y posicionadas según `align` — mismo
 * criterio "SVG inline sin depender de ningún set de iconos externo" que el
 * resto de iconos propios de la app (ver `SidebarToggleIcon` en
 * `src/editor/Topbar/Topbar.tsx`). Se reutiliza tanto en el botón que abre
 * el desplegable (refleja la alineación ACTUAL del párrafo/encabezado en el
 * cursor) como en cada opción del propio menú (con la alineación fija de
 * esa opción, para que se reconozca de un vistazo sin leer la etiqueta).
 */
function TextAlignIcon({ align }: { align: TextAlignValue }) {
  const widths = align === 'justify' ? [12, 12, 12, 12] : [12, 8, 12, 6]
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {widths.map((width, index) => {
        const x = align === 'right' ? 14 - width : align === 'center' ? (16 - width) / 2 : 2
        return <rect key={index} x={x} y={2 + index * 4} width={width} height="1.6" rx="0.8" fill="currentColor" />
      })}
    </svg>
  )
}

/**
 * Editor de texto enriquecido para el campo `body` de un nodo (fase 4,
 * Milestone 2). Barra de herramientas minimalista: negrita, cursiva, lista
 * con viñetas, lista numerada, destacado (fase 8), justificación de texto
 * (petición de usuario) — nada más (sin color, fuente, tamaño...).
 *
 * Inicialización única al montar: `useEditor` recibe `parseRichBody(body)`
 * como `content` inicial y nunca se resincroniza con la prop `body` en
 * renders posteriores. Esto es seguro porque `Inspector`/`NodeFields` montan
 * este componente con `key={node.id}` — al cambiar de nodo seleccionado, React
 * destruye esta instancia y crea una nueva desde cero, así que el contenido
 * inicial siempre corresponde al nodo recién seleccionado sin necesitar
 * lógica de sincronización manual (mismo patrón que el resto del Inspector).
 *
 * Commit on blur: se usa el evento `blur` de `EditorOptions` (`onBlur` de
 * `useEditor`, disparado por ProseMirror cuando el editor pierde el foco),
 * NO `onUpdate` (que se dispara en cada pulsación/cambio y generaría una
 * entrada de historial por tecla). El estado visual de los botones de la
 * barra (activo/inactivo) sí se refresca en cada cambio de selección o
 * transacción, vía `useEditorState` — eso es puramente de lectura
 * (`editor.isActive(...)`), no dispara ningún `onCommit`.
 *
 * Cambiar de nodo seleccionado sin blur previo: `NodeFields` monta este
 * componente con `key={node.id}`, así que cambiar de selección desmonta esta
 * instancia sin que el `blur` del editor llegue a dispararse necesariamente.
 * Para no perder esa edición pendiente, el efecto de limpieza de abajo
 * confirma el último contenido conocido (rastreado vía `onUpdate` en
 * `latestDocRef`, sin guardar nada en el store en cada pulsación) — mismo
 * criterio que el `useEffect` de limpieza de `NodeFields`/`ResponseRow`.
 */
export function RichTextEditor({ body, onCommit, ariaLabelledBy }: RichTextEditorProps) {
  // Snapshot de lo último confirmado, en la misma representación
  // serializada que se compara en cada blur — evita una entrada de
  // historial vacía cuando el usuario entra y sale del editor sin cambiar
  // nada (mismo criterio que `committedRef` en `NodeFields`/`ResponseRow`).
  // Se inicializa con la normalización del `body` de entrada (no con el
  // `body` crudo) para que un nodo con texto plano histórico, si se deja el
  // editor sin tocar, no reescriba su `body` a formato JSON solo por haber
  // pasado por el editor.
  const initialDoc = parseRichBody(body)
  const committedRef = useRef(serializeRichBody(initialDoc))
  // Último documento conocido, actualizado en cada transacción (`onUpdate`)
  // sin confirmar nada — solo para poder confirmarlo desde el cleanup de
  // desmontaje si el usuario cambia de nodo sin pasar por blur.
  const latestDocRef = useRef<JSONContent>(initialDoc)

  function commitIfChanged(doc: JSONContent) {
    const next = serializeRichBody(doc)
    if (next === committedRef.current) {
      return
    }
    committedRef.current = next
    onCommit(next)
  }

  // Corrector ortotipográfico nativo del sistema/navegador (fase 8): sin
  // ninguna librería propia de diccionario, apoyado enteramente en los
  // atributos HTML `spellcheck`/`lang` del elemento editable raíz, que el
  // propio navegador/SO interpreta. Petición de usuario: siempre activado,
  // sin botón para desactivarlo (antes alternable vía un botón "ABC" en la
  // barra — quitado).
  const editorAttributes: Record<string, string> = {
    ...(ariaLabelledBy ? { 'aria-labelledby': ariaLabelledBy } : {}),
    spellcheck: 'true',
    lang: 'es',
  }

  const editor = useEditor({
    extensions: RICH_TEXT_EXTENSIONS,
    content: initialDoc,
    editorProps: {
      attributes: editorAttributes,
    },
    onUpdate: ({ editor: updatedEditor }) => {
      latestDocRef.current = updatedEditor.getJSON()
    },
    onBlur: ({ editor: blurredEditor }) => {
      commitIfChanged(blurredEditor.getJSON())
    },
  })

  useEffect(() => {
    return () => {
      commitIfChanged(latestDocRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Desplegable de justificación (petición de usuario): abierto/cerrado +
  // cierre al hacer clic fuera o pulsar Escape — mismo patrón ya
  // establecido en el menú "Exportar" de `Topbar.tsx`/`ConnectionMenu.tsx`,
  // sin ninguna librería externa.
  const [alignMenuOpen, setAlignMenuOpen] = useState(false)
  const alignMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!alignMenuOpen) return

    function handlePointerDown(event: MouseEvent) {
      if (!alignMenuRef.current) return
      if (event.target instanceof Node && alignMenuRef.current.contains(event.target)) return
      setAlignMenuOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setAlignMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [alignMenuOpen])

  const toolbarState = useEditorState({
    editor,
    selector: (ctx) => {
      if (!ctx.editor) {
        return {
          bold: false,
          italic: false,
          bulletList: false,
          orderedList: false,
          highlight: false,
          alignLeft: false,
          alignCenter: false,
          alignRight: false,
          alignJustify: false,
          isInTable: false,
          canAddRow: false,
          canDeleteRow: false,
          canAddColumn: false,
          canDeleteColumn: false,
          canDeleteTable: false,
          canMergeCells: false,
          canSplitCell: false,
          isEmpty: true,
        }
      }
      return {
        bold: ctx.editor.isActive('bold'),
        italic: ctx.editor.isActive('italic'),
        bulletList: ctx.editor.isActive('bulletList'),
        orderedList: ctx.editor.isActive('orderedList'),
        highlight: ctx.editor.isActive('highlight'),
        // Petición de usuario ("poder escoger la justificación del texto"):
        // un booleano por alineación (mismo patrón que bold/italic/etc. de
        // arriba) en vez de un único campo `textAlign: string` — un párrafo
        // sin alineación explícita (el caso por defecto, ver comentario de
        // `TextAlign.configure` en `richTextContent.ts`) no está "activo" en
        // ninguna de las cuatro, así que ningún botón queda pulsado, que es
        // justo lo que se quiere para "izquierda" cuando es el valor
        // implícito, no uno guardado.
        alignLeft: ctx.editor.isActive({ textAlign: 'left' }),
        alignCenter: ctx.editor.isActive({ textAlign: 'center' }),
        alignRight: ctx.editor.isActive({ textAlign: 'right' }),
        alignJustify: ctx.editor.isActive({ textAlign: 'justify' }),
        // "Vacío" = sin ningún carácter de texto real, aunque haya un
        // párrafo vacío por defecto (el documento inicial que siembra
        // `createNode`/`duplicateNode`) — mismo criterio que ya usa el
        // resto de la app para un cuerpo Tiptap (`LeftPanel`, `adapter.ts`,
        // `diagnostics.ts`): reutiliza `extractPlainText`, no uno nuevo.
        // `useEditorState` re-evalúa este selector en cada transacción
        // (cada pulsación), así que el fondo "por rellenar" del
        // `.editorWrapper` (ver más abajo y `RichTextEditor.module.css`)
        // se actualiza EN VIVO mientras se escribe o se borra todo el
        // contenido — sin esperar a un blur.
        isEmpty: extractPlainText(ctx.editor.getJSON()).trim() === '',
        // Estado de la tabla en la posición actual del cursor (fase 9,
        // tablas editables): controla tanto si el botón "Insertar tabla" se
        // deshabilita (no tiene sentido anidar tablas) como si aparece la
        // barra contextual de abajo con sus acciones habilitadas/deshabilitadas
        // una por una (p.ej. "Eliminar fila" no tiene sentido con una sola
        // fila — `can()` ya lo resuelve, mismo mecanismo que Tiptap usa
        // internamente para decidir si un comando es aplicable).
        isInTable: ctx.editor.isActive('table'),
        canAddRow: ctx.editor.can().addRowAfter(),
        canDeleteRow: ctx.editor.can().deleteRow(),
        canAddColumn: ctx.editor.can().addColumnAfter(),
        canDeleteColumn: ctx.editor.can().deleteColumn(),
        canDeleteTable: ctx.editor.can().deleteTable(),
        canMergeCells: ctx.editor.can().mergeCells(),
        canSplitCell: ctx.editor.can().splitCell(),
      }
    },
  })

  if (!editor) {
    return null
  }

  /** Alterna una alineación (petición de usuario: "poder escoger la
   *  justificación del texto"): si el párrafo/encabezado actual YA tiene
   *  esa alineación, la quita (`unsetTextAlign`, vuelve al valor por
   *  defecto — normalmente "izquierda" sin guardar nada) en vez de
   *  dejarla fija; si no, la fija. Mismo criterio "toggle" que
   *  `toggleBold`/`toggleItalic`/etc. de arriba, que Tiptap no ofrece de
   *  fábrica para `setTextAlign` (siempre fija el valor, nunca alterna). */
  function toggleAlign(align: TextAlignValue) {
    if (editor.isActive({ textAlign: align })) {
      editor.chain().focus().unsetTextAlign().run()
    } else {
      editor.chain().focus().setTextAlign(align).run()
    }
  }

  const buttons: ToolbarButtonConfig[] = [
    {
      key: 'bold',
      label: 'N',
      ariaLabel: 'Negrita',
      isActive: toolbarState?.bold ?? false,
      onToggle: () => editor.chain().focus().toggleBold().run(),
    },
    {
      key: 'italic',
      label: 'I',
      ariaLabel: 'Cursiva',
      isActive: toolbarState?.italic ?? false,
      onToggle: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      key: 'bulletList',
      label: '•',
      ariaLabel: 'Lista con viñetas',
      isActive: toolbarState?.bulletList ?? false,
      onToggle: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      key: 'orderedList',
      label: '1.',
      ariaLabel: 'Lista numerada',
      isActive: toolbarState?.orderedList ?? false,
      onToggle: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      key: 'highlight',
      label: 'H',
      ariaLabel: 'Destacado',
      isActive: toolbarState?.highlight ?? false,
      onToggle: () => editor.chain().focus().toggleHighlight().run(),
    },
  ]

  // Petición de usuario ("un desplegable con un icono de justificación...
  // que se despliegue y tengas esas 3 opciones" — cuatro en total contando
  // "Izquierda", el valor por defecto): alineación ACTUAL del párrafo/
  // encabezado en el cursor, para el icono del botón que abre el menú.
  // "Izquierda" es el valor por defecto (ningún atributo `textAlign`
  // guardado, ver comentario de `TextAlign.configure` en
  // `richTextContent.ts`), así que se usa como último recurso cuando
  // ninguna de las otras tres está activa.
  const currentAlign: TextAlignValue = toolbarState?.alignCenter
    ? 'center'
    : toolbarState?.alignRight
      ? 'right'
      : toolbarState?.alignJustify
        ? 'justify'
        : 'left'

  const isInTable = toolbarState?.isInTable ?? false
  const isEmpty = toolbarState?.isEmpty ?? true

  /**
   * Acciones de la barra contextual de tabla (fase 9): solo visible cuando
   * el cursor/selección está dentro de una tabla — el resto del tiempo no
   * ocupa espacio ni distrae, mismo criterio "sobrio, poco intrusivo" que el
   * resto de la barra principal. Cada acción se deshabilita individualmente
   * (en vez de ocultarse) según `can()` para que la disposición de botones
   * no salte al usar la tabla (p.ej. fusionar celdas sin una selección de
   * varias celdas queda visible pero inerte).
   */
  const tableActions: TableActionConfig[] = [
    {
      key: 'addRowAfter',
      label: '+ Fila',
      ariaLabel: 'Añadir fila',
      enabled: toolbarState?.canAddRow ?? false,
      onAction: () => editor.chain().focus().addRowAfter().run(),
    },
    {
      key: 'deleteRow',
      label: '− Fila',
      ariaLabel: 'Eliminar fila',
      enabled: toolbarState?.canDeleteRow ?? false,
      onAction: () => editor.chain().focus().deleteRow().run(),
    },
    {
      key: 'addColumnAfter',
      label: '+ Columna',
      ariaLabel: 'Añadir columna',
      enabled: toolbarState?.canAddColumn ?? false,
      onAction: () => editor.chain().focus().addColumnAfter().run(),
    },
    {
      key: 'deleteColumn',
      label: '− Columna',
      ariaLabel: 'Eliminar columna',
      enabled: toolbarState?.canDeleteColumn ?? false,
      onAction: () => editor.chain().focus().deleteColumn().run(),
    },
    {
      key: 'mergeCells',
      label: 'Fusionar',
      ariaLabel: 'Fusionar celdas',
      enabled: toolbarState?.canMergeCells ?? false,
      onAction: () => editor.chain().focus().mergeCells().run(),
    },
    {
      key: 'splitCell',
      label: 'Dividir',
      ariaLabel: 'Dividir celda',
      enabled: toolbarState?.canSplitCell ?? false,
      onAction: () => editor.chain().focus().splitCell().run(),
    },
    {
      key: 'deleteTable',
      label: 'Eliminar tabla',
      ariaLabel: 'Eliminar tabla',
      enabled: toolbarState?.canDeleteTable ?? false,
      onAction: () => editor.chain().focus().deleteTable().run(),
    },
  ]

  return (
    <div className={isEmpty ? `${styles.editorWrapper} ${styles.editorWrapperEmpty}` : styles.editorWrapper}>
      <div className={styles.toolbar} role="toolbar" aria-label="Formato de texto">
        {buttons.map((button) => (
          <button
            key={button.key}
            type="button"
            className={button.isActive ? styles.toolbarButtonActive : styles.toolbarButton}
            aria-label={button.ariaLabel}
            aria-pressed={button.isActive}
            // El mousedown por defecto le quita el foco al editor antes de
            // que el click llegue a ejecutarse; sin `preventDefault` aquí,
            // alternar un formato con el editor vacío no aplicaría nada
            // porque la selección ya se habría perdido.
            onMouseDown={(event) => event.preventDefault()}
            onClick={button.onToggle}
          >
            {button.label}
          </button>
        ))}
        {/* Justificación de texto (petición de usuario: "un desplegable con
            un icono de justificación... que se despliegue y tengas esas
            [cuatro] opciones"): un único botón con el icono de la
            alineación ACTUAL, que despliega un menú con las 4 opciones —
            en vez de 4 botones sueltos como el resto de la barra, mismo
            criterio de menú flotante que "Exportar" en `Topbar.tsx`. */}
        <div className={styles.alignMenuWrapper} ref={alignMenuRef}>
          <button
            type="button"
            className={styles.toolbarButton}
            aria-label="Justificación de texto"
            aria-haspopup="menu"
            aria-expanded={alignMenuOpen}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setAlignMenuOpen((open) => !open)}
          >
            <TextAlignIcon align={currentAlign} />
          </button>
          {alignMenuOpen && (
            <div className={styles.alignMenu} role="menu" aria-label="Justificación de texto">
              {ALIGN_OPTIONS.map((option) => (
                <button
                  key={option.align}
                  type="button"
                  role="menuitem"
                  className={
                    currentAlign === option.align ? styles.alignMenuItemActive : styles.alignMenuItem
                  }
                  aria-pressed={currentAlign === option.align}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    toggleAlign(option.align)
                    setAlignMenuOpen(false)
                  }}
                >
                  <TextAlignIcon align={option.align} />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Insertar tabla (fase 9): inserta una tabla 3×3 por defecto con
            fila de cabecera, en la posición del cursor. Deshabilitado dentro
            de una tabla existente — anidar tablas no aporta nada aquí y
            complica la edición; para eso está la barra contextual de abajo. */}
        <button
          type="button"
          className={styles.toolbarButton}
          aria-label="Insertar tabla"
          disabled={isInTable}
          title={isInTable ? 'Ya hay una tabla en el cursor' : 'Insertar tabla'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          ⊞ Tabla
        </button>
      </div>
      {/* Barra contextual de tabla (fase 9): solo se monta cuando el cursor
          está dentro de una tabla, justo debajo de la barra principal —
          nunca ocupa espacio ni distrae fuera de ese contexto. */}
      {isInTable && (
        <div className={styles.tableToolbar} role="toolbar" aria-label="Edición de tabla">
          {tableActions.map((action) => (
            <button
              key={action.key}
              type="button"
              className={styles.toolbarButton}
              aria-label={action.ariaLabel}
              disabled={!action.enabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={action.onAction}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      <EditorContent editor={editor} className={styles.editorContent} />
    </div>
  )
}
