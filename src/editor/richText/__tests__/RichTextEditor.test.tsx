import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RichTextEditor } from '../RichTextEditor'
import { parseRichBody } from '../richTextContent'

/**
 * Espera al `requestAnimationFrame` que `editor.chain().focus()` programa
 * internamente (ver `commands/focus.ts` de `@tiptap/core`) antes de mover el
 * foco de verdad al DOM. Sin esta espera, comprobar `document.activeElement`
 * justo después de un click en la barra de herramientas es una carrera.
 */
function waitOneFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

/**
 * Mueve el foco real del navegador (jsdom) a otro elemento del documento,
 * disparando un evento `blur` nativo sobre el elemento que lo tuviera antes
 * — el mismo mecanismo que "hacer clic en otra parte de la pantalla".
 * `fireEvent.blur` a secas no mueve `document.activeElement`; esto sí, y es
 * lo que dispara el `onBlur` de Tiptap en las condiciones más parecidas a
 * uso real.
 */
async function blurByMovingFocusAway() {
  const elsewhere = document.createElement('button')
  document.body.appendChild(elsewhere)
  elsewhere.focus()
  await waitOneFrame()
}

describe('RichTextEditor', () => {
  it('muestra el texto plano histórico como contenido normal del editor', async () => {
    render(<RichTextEditor body="Texto plano histórico" onCommit={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Texto plano histórico')).toBeInTheDocument()
    })
  })

  it('la barra de herramientas muestra los cuatro controles esperados', async () => {
    render(<RichTextEditor body="" onCommit={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('toolbar')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Negrita' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cursiva' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lista con viñetas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lista numerada' })).toBeInTheDocument()
  })

  it('perder el foco sin haber cambiado nada no llama a onCommit', async () => {
    const onCommit = vi.fn()
    render(<RichTextEditor body="Sin cambios" onCommit={onCommit} />)

    await waitFor(() => {
      expect(screen.getByText('Sin cambios')).toBeInTheDocument()
    })

    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement
    editable.focus()
    await waitOneFrame()

    await blurByMovingFocusAway()

    expect(onCommit).not.toHaveBeenCalled()
  })

  /**
   * `toggleBold`/`toggleItalic` solo mutan el documento si hay una selección
   * de texto real, y simular una selección de texto de verdad (arrastrar el
   * ratón, Mayús+flechas moviendo el cursor por el contenido) depende de un
   * motor de layout/contentEditable real que jsdom no implementa — el mismo
   * tipo de límite ya documentado para `@xyflow/react` en
   * `src/test/setup.ts`. `toggleBulletList` no tiene ese problema: envuelve
   * el bloque actual aunque el cursor esté simplemente colocado dentro de
   * él, sin selección extendida, así que es la vía fiable en jsdom para
   * probar de punta a punta "click en la barra -> documento mutado -> commit
   * on blur". La cobertura de negrita/cursiva como comandos de Tiptap queda
   * a nivel de revisión manual (ver informe final).
   */
  it('alternar lista con viñetas y perder el foco confirma exactamente una vez, con el documento mutado', async () => {
    const onCommit = vi.fn()
    render(<RichTextEditor body="Hola" onCommit={onCommit} />)

    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeInTheDocument()
    })

    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement
    editable.focus()
    await waitOneFrame()

    const listButton = screen.getByRole('button', { name: 'Lista con viñetas' })
    expect(listButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.mouseDown(listButton)
    fireEvent.click(listButton)

    await waitFor(() => {
      expect(listButton).toHaveAttribute('aria-pressed', 'true')
    })

    await blurByMovingFocusAway()

    expect(onCommit).toHaveBeenCalledTimes(1)
    const committedRaw = onCommit.mock.calls[0]?.[0] as string
    const committedDoc = JSON.parse(committedRaw)
    expect(committedDoc.content[0]).toEqual({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hola' }] }],
        },
      ],
    })

    // Un segundo cambio de foco sin más ediciones no debe volver a confirmar.
    editable.focus()
    await waitOneFrame()
    await blurByMovingFocusAway()
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('desmontar sin blur previo (cambio de nodo seleccionado) confirma la edición pendiente', async () => {
    const onCommit = vi.fn()
    const { unmount } = render(<RichTextEditor body="Hola" onCommit={onCommit} />)

    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeInTheDocument()
    })

    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement
    editable.focus()
    await waitOneFrame()

    const listButton = screen.getByRole('button', { name: 'Lista con viñetas' })
    fireEvent.mouseDown(listButton)
    fireEvent.click(listButton)

    await waitFor(() => {
      expect(listButton).toHaveAttribute('aria-pressed', 'true')
    })

    // Se desmonta directamente (equivalente a que `NodeFields` cambie de
    // `key` al seleccionar otro nodo) sin que el editor haya perdido el
    // foco antes.
    expect(onCommit).not.toHaveBeenCalled()
    unmount()

    expect(onCommit).toHaveBeenCalledTimes(1)
    const committedDoc = JSON.parse(onCommit.mock.calls[0]?.[0] as string)
    expect(committedDoc.content[0].type).toBe('bulletList')
  })

  it('body vacío no lanza y renderiza un editor vacío', () => {
    expect(() => render(<RichTextEditor body="" onCommit={vi.fn()} />)).not.toThrow()
    expect(parseRichBody('')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [] }],
    })
  })
})
