import { useEffect, useRef } from 'react'
import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { parseRichBody, serializeRichBody } from './richTextContent'
import styles from './RichTextEditor.module.css'

export interface RichTextEditorProps {
  /** `body` (string) actual del nodo seleccionado. Solo se lee al montar —
   *  ver nota de `useEditor` más abajo. */
  body: string
  /**
   * Confirma el `body` serializado en el store. Se llama exactamente una vez
   * por edición al perder el foco ("commit on blur"), nunca por tecla —
   * mismo criterio que título/body de texto plano y las respuestas de
   * Decisión (`Inspector.tsx`).
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

/**
 * Editor de texto enriquecido para el campo `body` de un nodo (fase 4,
 * Milestone 2). Barra de herramientas minimalista: negrita, cursiva, lista
 * con viñetas, lista numerada — nada más (sin color, fuente, tamaño...).
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

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialDoc,
    editorProps: {
      attributes: ariaLabelledBy ? { 'aria-labelledby': ariaLabelledBy } : {},
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

  const toolbarState = useEditorState({
    editor,
    selector: (ctx) => {
      if (!ctx.editor) {
        return { bold: false, italic: false, bulletList: false, orderedList: false }
      }
      return {
        bold: ctx.editor.isActive('bold'),
        italic: ctx.editor.isActive('italic'),
        bulletList: ctx.editor.isActive('bulletList'),
        orderedList: ctx.editor.isActive('orderedList'),
      }
    },
  })

  if (!editor) {
    return null
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
  ]

  return (
    <div className={styles.editorWrapper}>
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
      </div>
      <EditorContent editor={editor} className={styles.editorContent} />
    </div>
  )
}
