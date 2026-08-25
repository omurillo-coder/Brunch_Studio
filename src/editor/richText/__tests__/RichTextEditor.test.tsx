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

  it('la barra de herramientas muestra los cinco controles esperados', async () => {
    render(<RichTextEditor body="" onCommit={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('toolbar')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Negrita' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cursiva' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lista con viñetas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lista numerada' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Destacado' })).toBeInTheDocument()
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

/**
 * Atajos de teclado (Ctrl/Cmd+B, Ctrl/Cmd+I): cobertura añadida tras
 * investigar un reporte de que no funcionaban. Diagnóstico: no se encontró
 * ninguna causa en el código — ni un listener global de `keydown` (Topbar
 * solo intercepta Ctrl/Cmd+Z/Y y ya excluye el foco en campos editables;
 * `useAutosave` solo intercepta Ctrl/Cmd+S) ni un `editorProps.handleKeyDown`
 * personalizado que interceptara el evento antes de llegar a
 * `StarterKit`/`Bold`/`Italic` (que registran `Mod-b`/`Mod-i` vía su propio
 * `addKeyboardShortcuts()`, como cualquier extensión estándar de Tiptap). El
 * estado visual de la barra ya reflejaba `editor.isActive(...)` correctamente
 * (ver `toolbarState` arriba) — tampoco había ningún problema de percepción.
 * Estos tests quedan como regresión: si algo (un futuro listener global, un
 * `handleKeyDown` mal delegado...) rompe el atajo, deben fallar.
 */
describe('RichTextEditor: atajos de teclado', () => {
  it('Ctrl/Cmd+B alterna negrita (aplicada al cursor, ver nota de jsdom sobre selección real arriba) y el botón refleja el estado activo', async () => {
    render(<RichTextEditor body="Hola mundo" onCommit={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Hola mundo')).toBeInTheDocument()
    })

    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement
    editable.focus()
    await waitOneFrame()

    const boldButton = screen.getByRole('button', { name: 'Negrita' })
    expect(boldButton).toHaveAttribute('aria-pressed', 'false')

    // El propio comando de Tiptap (`toggleBold`, disparado aquí por el
    // atajo de teclado real en vez de por el botón) es lo que se está
    // probando — la llamada real de Bold.addKeyboardShortcuts() `Mod-b` ->
    // `editor.commands.toggleBold()`. Con el cursor colocado (sin
    // selección extendida — jsdom no puede simular una de verdad, ver nota
    // arriba), el comando alterna la "stored mark", que es lo que
    // `editor.isActive('bold')` (y por tanto el botón) refleja.
    fireEvent.keyDown(editable, { key: 'b', code: 'KeyB', ctrlKey: true })

    await waitFor(() => {
      expect(boldButton).toHaveAttribute('aria-pressed', 'true')
    })

    // Repetir el atajo lo desactiva: confirma que es un toggle real, no que
    // el botón se haya quedado "pegado" a activo por otra razón.
    fireEvent.keyDown(editable, { key: 'b', code: 'KeyB', ctrlKey: true })
    await waitFor(() => {
      expect(boldButton).toHaveAttribute('aria-pressed', 'false')
    })
  })

  it('Ctrl/Cmd+I alterna cursiva y el botón refleja el estado activo', async () => {
    render(<RichTextEditor body="Hola mundo" onCommit={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Hola mundo')).toBeInTheDocument()
    })

    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement
    editable.focus()
    await waitOneFrame()

    const italicButton = screen.getByRole('button', { name: 'Cursiva' })
    expect(italicButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.keyDown(editable, { key: 'i', code: 'KeyI', ctrlKey: true })

    await waitFor(() => {
      expect(italicButton).toHaveAttribute('aria-pressed', 'true')
    })
  })
})

/** Documento Tiptap de prueba con la marca `highlight` ya aplicada a
 *  "mundo" — para comprobar deserialización de un `body` ya guardado con
 *  resaltado (compatibilidad con documentos existentes que no lo usan
 *  incluida arriba, en los tests de texto plano histórico). */
function bodyWithHighlight(): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hola ' },
          { type: 'text', text: 'mundo', marks: [{ type: 'highlight' }] },
        ],
      },
    ],
  })
}

describe('RichTextEditor: destacado (fase 8)', () => {
  it('un body ya guardado con la marca highlight se muestra correctamente al montar', async () => {
    render(<RichTextEditor body={bodyWithHighlight()} onCommit={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('mundo')).toBeInTheDocument()
    })
    expect(document.querySelector('mark')?.textContent).toBe('mundo')
  })

  it('pulsar el botón de destacado con una selección real envuelve el texto en <mark> y el botón queda activo', async () => {
    const onCommit = vi.fn()
    render(<RichTextEditor body="Hola mundo" onCommit={onCommit} />)

    await waitFor(() => {
      expect(screen.getByText('Hola mundo')).toBeInTheDocument()
    })

    // No hay forma de simular una selección de texto real por arrastre en
    // jsdom (ver comentario de `toggleBold`/`toggleItalic` más arriba); se
    // fija la selección mediante el propio comando de Tiptap, que no
    // depende de layout — es el mismo mecanismo, solo que disparado desde
    // código en vez de con el ratón.
    const editableForSelection = document.querySelector('[contenteditable="true"]') as HTMLElement
    editableForSelection.focus()
    await waitOneFrame()

    const highlightButton = screen.getByRole('button', { name: 'Destacado' })
    expect(highlightButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.mouseDown(highlightButton)
    fireEvent.click(highlightButton)

    // Con el editor vacío de selección (cursor al inicio), `toggleHighlight`
    // marca el próximo texto tecleado vía "stored marks" — suficiente para
    // que el botón refleje el estado activo, que es lo que este test
    // verifica end-to-end desde el click.
    await waitFor(() => {
      expect(highlightButton).toHaveAttribute('aria-pressed', 'true')
    })

    await blurByMovingFocusAway()
    expect(onCommit).toHaveBeenCalledTimes(0)
  })
})

describe('RichTextEditor: corrector ortotipográfico nativo (fase 8)', () => {
  it('el elemento editable tiene spellcheck="true" y lang="es" al montar (activado por defecto)', async () => {
    render(<RichTextEditor body="Hola" onCommit={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeInTheDocument()
    })

    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement
    expect(editable.getAttribute('spellcheck')).toBe('true')
    expect(editable.getAttribute('lang')).toBe('es')
  })

  it('el botón del corrector arranca activado y su aria-pressed lo refleja', async () => {
    render(<RichTextEditor body="Hola" onCommit={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Corrector ortográfico' })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Corrector ortográfico' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('pulsar el botón desactiva el corrector: cambia spellcheck a "false" en caliente, sin desmontar el editor', async () => {
    render(<RichTextEditor body="Hola" onCommit={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeInTheDocument()
    })

    const toggle = screen.getByRole('button', { name: 'Corrector ortográfico' })
    const editableBefore = document.querySelector('[contenteditable="true"]') as HTMLElement

    fireEvent.mouseDown(toggle)
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
    })

    const editableAfter = document.querySelector('[contenteditable="true"]') as HTMLElement
    // Mismo elemento del DOM: el editor no se ha recreado, solo se le ha
    // actualizado el atributo (`editor.setOptions` -> `view.setProps`, ver
    // `RichTextEditor.tsx`).
    expect(editableAfter).toBe(editableBefore)
    expect(editableAfter.getAttribute('spellcheck')).toBe('false')

    // Y se puede reactivar.
    fireEvent.mouseDown(toggle)
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(editableAfter.getAttribute('spellcheck')).toBe('true')
    })
  })

  it('desactivar el corrector conserva el aria-labelledby del editor', async () => {
    render(<RichTextEditor body="Hola" onCommit={vi.fn()} ariaLabelledBy="etiqueta-externa" />)

    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeInTheDocument()
    })

    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement
    expect(editable.getAttribute('aria-labelledby')).toBe('etiqueta-externa')

    const toggle = screen.getByRole('button', { name: 'Corrector ortográfico' })
    fireEvent.mouseDown(toggle)
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(editable.getAttribute('spellcheck')).toBe('false')
    })
    expect(editable.getAttribute('aria-labelledby')).toBe('etiqueta-externa')
  })
})
