import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { parseRichBody } from './richTextContent'
import styles from './RichTextView.module.css'

export interface RichTextViewProps {
  /** `body` (string) del nodo (Diapositiva o Final) a mostrar. */
  body: string
  /** Clase adicional del contenedor, para que el llamador ajuste espaciado
   *  sin necesitar envolver este componente en un `<div>` de más. */
  className?: string
}

/**
 * Renderiza el `body` de un nodo en modo estrictamente solo lectura
 * (`PlayerScreen`, fase 5 del Milestone 2): mismo motor (Tiptap +
 * `StarterKit`) que `RichTextEditor` del Inspector, para garantizar que el
 * resultado visual es idéntico al que se editó allí — sin reimplementar un
 * renderizador de JSON a mano ni recurrir a `dangerouslySetInnerHTML`.
 *
 * `editable: false` y sin ningún callback de escritura (`onUpdate`/`onBlur`,
 * que ni siquiera se pasan a `useEditor`): no existe ninguna vía por la que
 * este componente pueda confirmar un cambio en el documento. Con
 * `editable: false`, ProseMirror además no muestra cursor ni acepta foco de
 * teclado en el área de contenido, así que tampoco hay ninguna superficie de
 * edición accidental para quien juega.
 *
 * Igual que `RichTextEditor`, el contenido inicial (`parseRichBody(body)`)
 * solo se lee al montar — `useEditor` no vuelve a sincronizarse si `body`
 * cambia en un re-render posterior. Esto es seguro porque `PlayerScreen`
 * monta este componente con una `key` distinta por nodo (el propio id del
 * nodo actual del recorrido): al avanzar a otro nodo, React destruye esta
 * instancia y crea una nueva desde cero con el `body` correcto, en vez de
 * reutilizar una vieja con contenido obsoleto.
 */
export function RichTextView({ body, className }: RichTextViewProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: parseRichBody(body),
    editable: false,
  })

  if (!editor) {
    return null
  }

  const contentClassName = className ? `${styles.content} ${className}` : styles.content

  return <EditorContent editor={editor} className={contentClassName} />
}
