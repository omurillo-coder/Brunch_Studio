import { describe, expect, it } from 'vitest'
import { extractPlainText, parseRichBody, serializeRichBody } from '../richTextContent'

describe('parseRichBody / serializeRichBody', () => {
  it('hace roundtrip de un documento con negrita y lista sin perder información', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hola ', marks: undefined },
            { type: 'text', text: 'mundo', marks: [{ type: 'bold' }] },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Ítem 1' }] },
              ],
            },
          ],
        },
      ],
    }

    const raw = serializeRichBody(doc)
    const parsed = parseRichBody(raw)

    expect(parsed).toEqual(doc)
  })

  it('un raw vacío produce un documento válido con un único párrafo vacío, sin lanzar', () => {
    const parsed = parseRichBody('')

    expect(parsed).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [] }],
    })
  })

  it('texto plano histórico (Milestone 1, antes de esta fase) se envuelve en un párrafo', () => {
    const parsed = parseRichBody('Texto plano histórico')

    expect(parsed).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Texto plano histórico' }],
        },
      ],
    })
  })

  it('JSON válido pero sin forma de documento Tiptap se trata como texto plano (caso límite documentado)', () => {
    // "42" es JSON.parse-able (número 42), pero no tiene la forma
    // `{ type: 'doc', content: [...] }` de un documento Tiptap: a ojos de
    // `parseRichBody` es indistinguible de texto plano "raro", así que el
    // propio raw ("42") se usa literalmente como el texto del párrafo.
    const parsed = parseRichBody('42')

    expect(parsed).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '42' }] }],
    })
  })

  it('JSON corrupto (no parseable) se trata como texto plano', () => {
    const corrupted = '{ "type": "doc", "content": [ invalid json'
    const parsed = parseRichBody(corrupted)

    expect(parsed).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: corrupted }] }],
    })
  })

  it('JSON con forma de objeto pero sin type "doc" se trata como texto plano', () => {
    const raw = JSON.stringify({ foo: 'bar' })
    const parsed = parseRichBody(raw)

    expect(parsed).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: raw }] }],
    })
  })

  it('un array JSON (no un objeto de documento) se trata como texto plano', () => {
    const raw = JSON.stringify([1, 2, 3])
    const parsed = parseRichBody(raw)

    expect(parsed).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: raw }] }],
    })
  })

  it('serializeRichBody produce JSON.stringify del documento', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [] }] }
    expect(serializeRichBody(doc)).toBe(JSON.stringify(doc))
  })

  it('hace roundtrip de un documento con la marca highlight (destacado, fase 8) sin perder información', () => {
    const doc = {
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
    }

    const raw = serializeRichBody(doc)
    const parsed = parseRichBody(raw)

    expect(parsed).toEqual(doc)
  })
})

describe('extractPlainText', () => {
  it('extrae el texto de un párrafo simple', () => {
    expect(extractPlainText(parseRichBody('Texto plano histórico'))).toBe(
      'Texto plano histórico',
    )
  })

  it('un documento vacío produce una cadena vacía', () => {
    expect(extractPlainText(parseRichBody(''))).toBe('')
  })

  it('concatena varios tramos con marcas (negrita) del mismo párrafo sin insertar espacios de más', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bienvenido al escenario. Presta atención al ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'protocolo' },
            { type: 'text', text: '.' },
          ],
        },
      ],
    }
    expect(extractPlainText(doc)).toBe('Bienvenido al escenario. Presta atención al protocolo.')
  })

  it('separa con un espacio el texto de párrafos distintos', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Primer párrafo' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Segundo párrafo' }] },
      ],
    }
    expect(extractPlainText(doc)).toBe('Primer párrafo Segundo párrafo')
  })

  it('extrae el texto de listas (con y sin viñetas), un item por bloque, sin palabras pegadas', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Importante' },
            { type: 'text', text: ': lee esto con atención.' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Primer punto' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Segundo punto' }] }],
            },
          ],
        },
      ],
    }
    const text = extractPlainText(doc)
    expect(text).toBe('Importante: lee esto con atención. Primer punto Segundo punto')
    expect(text).not.toContain('puntoSegundo')
  })

  it('no incluye claves ni sintaxis JSON: es texto real, no el body serializado', () => {
    const text = extractPlainText(parseRichBody('Hola mundo'))
    expect(text).not.toContain('"type"')
    expect(text).not.toContain('"doc"')
  })
})
