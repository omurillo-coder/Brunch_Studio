import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RichTextView } from '../RichTextView'
import { serializeRichBody } from '../richTextContent'

/**
 * `RichTextView` es la vista de solo lectura del `body` de un nodo, usada
 * por `PlayerScreen` (modo "Probar" del editor). Comparte
 * `RICH_TEXT_EXTENSIONS` con `RichTextEditor` (`richTextContent.ts`), así
 * que cualquier marca aplicable en el editor (incluida `highlight`, fase 8)
 * debe verse igual aquí, sin necesitar ningún cambio adicional en
 * `PlayerScreen`.
 */
describe('RichTextView', () => {
  it('renderiza texto plano histórico como párrafo normal', async () => {
    const { getByText } = render(<RichTextView body="Texto plano histórico" />)

    await waitFor(() => {
      expect(getByText('Texto plano histórico')).toBeInTheDocument()
    })
  })

  it('renderiza un body con la marca highlight como un <mark>, igual que el editor', async () => {
    const raw = serializeRichBody({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Texto normal y ' },
            { type: 'text', text: 'texto destacado', marks: [{ type: 'highlight' }] },
          ],
        },
      ],
    })

    const { container } = render(<RichTextView body={raw} />)

    await waitFor(() => {
      expect(container.querySelector('mark')).toBeInTheDocument()
    })
    expect(container.querySelector('mark')?.textContent).toBe('texto destacado')
  })

  it('no acepta foco ni edición: es estrictamente de solo lectura', async () => {
    const { container } = render(<RichTextView body="Hola" />)

    await waitFor(() => {
      expect(container.querySelector('.tiptap')).toBeInTheDocument()
    })
    const editable = container.querySelector('.tiptap') as HTMLElement
    expect(editable.getAttribute('contenteditable')).toBe('false')
  })
})
