import { describe, expect, it } from 'vitest'
import { sanitizeRichHtml } from '../sanitizeRichHtml'

/**
 * Hallazgo de auditoría ("sin sanitización propia del HTML enriquecido
 * antes de insertarlo"): `sanitizeRichHtml` es una lista blanca — cualquier
 * etiqueta/atributo que `RICH_TEXT_EXTENSIONS` no produce hoy debe
 * desaparecer, sin excepción, sea cual sea su origen.
 */
describe('sanitizeRichHtml', () => {
  it('deja pasar intacto el HTML real que produce RICH_TEXT_EXTENSIONS (párrafos, títulos, marcas, listas, tabla)', () => {
    const html =
      '<h1>Título</h1>' +
      '<p style="text-align: center;"><strong>bold</strong><em>italic</em><s>strike</s><code>code</code><mark>highlight</mark></p>' +
      '<ul><li><p>item</p></li></ul>' +
      '<ol><li><p>item</p></li></ol>' +
      '<blockquote><p>quote</p></blockquote>' +
      '<pre><code>code block</code></pre>' +
      '<hr><p>hard<br>break</p>' +
      '<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"></colgroup>' +
      '<tbody><tr><th colspan="1" rowspan="1"><p>H</p></th><td colspan="1" rowspan="1"><p>C</p></td></tr></tbody></table>'

    expect(sanitizeRichHtml(html)).toBe(html)
  })

  it('desenvuelve una etiqueta fuera de la lista blanca, conservando su texto', () => {
    // `<span>` (no `<div>`): un elemento de bloque anidado dentro de un
    // `<p>` fuerza al propio parser HTML a cerrar el `<p>` antes de
    // abrirlo — ruido de parsing ajeno a lo que se quiere probar aquí
    // (que una etiqueta fuera de la lista blanca pierde la etiqueta pero
    // no el texto). `<span>` es contenido de frase válido dentro de un
    // párrafo, así que no reestructura nada por su cuenta.
    expect(sanitizeRichHtml('<p>antes <span>en medio</span> después</p>')).toBe(
      '<p>antes en medio después</p>',
    )
  })

  it('elimina por completo un <script>, incluido su contenido (no es texto legítimo que conservar)', () => {
    const out = sanitizeRichHtml('<p>seguro</p><script>alert(document.cookie)</script>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('alert')
    expect(out).toBe('<p>seguro</p>')
  })

  it('elimina un atributo de evento inline (onerror/onclick) de una etiqueta permitida', () => {
    const out = sanitizeRichHtml('<p onclick="alert(1)">texto</p>')
    expect(out).toBe('<p>texto</p>')
  })

  it('un <img onerror=...> (vector clásico de XSS) desaparece entero: <img> no está en la lista blanca', () => {
    const out = sanitizeRichHtml('<p>antes</p><img src=x onerror="alert(1)"><p>después</p>')
    expect(out).not.toContain('img')
    expect(out).not.toContain('onerror')
    expect(out).toBe('<p>antes</p><p>después</p>')
  })

  it('un <a href="javascript:..."> desaparece entero: <a> no está en la lista blanca (RICH_TEXT_EXTENSIONS no incluye Link)', () => {
    const out = sanitizeRichHtml('<p><a href="javascript:alert(1)">enlace</a></p>')
    expect(out).toBe('<p>enlace</p>')
  })

  it('conserva un `style` seguro (text-align permitido) tal cual', () => {
    expect(sanitizeRichHtml('<p style="text-align: right;">texto</p>')).toBe(
      '<p style="text-align: right;">texto</p>',
    )
  })

  it('conserva un `style` seguro con varias declaraciones separadas por `;`', () => {
    const out = sanitizeRichHtml('<table style="min-width: 50px; min-width: 10px;">x</table>')
    expect(out).toContain('style="min-width: 50px; min-width: 10px;"')
  })

  it('elimina un `style` con una propiedad no permitida, aunque venga junto a una permitida', () => {
    const out = sanitizeRichHtml('<p style="text-align: center; background: url(javascript:alert(1))">x</p>')
    expect(out).toBe('<p>x</p>')
  })

  it('elimina un `style` con un valor peligroso disfrazado de propiedad permitida', () => {
    const out = sanitizeRichHtml('<p style="text-align: expression(alert(1))">x</p>')
    expect(out).toBe('<p>x</p>')
  })

  it('un atributo `style` no permitido en una etiqueta que no lo admite (p.ej. `li`) se elimina', () => {
    const out = sanitizeRichHtml('<ul><li style="text-align: center;">item</li></ul>')
    expect(out).toBe('<ul><li>item</li></ul>')
  })

  it('conserva colspan/rowspan en th/td, pero los elimina de una etiqueta que no los admite', () => {
    expect(sanitizeRichHtml('<p colspan="2">x</p>')).toBe('<p>x</p>')
  })

  it('un elemento anidado dentro de una etiqueta ya descartada también se sanea antes de reinsertarse', () => {
    // El <div> se desenvuelve, pero el <script> que contenía debe
    // desaparecer igual (recorrido recursivo, no solo el nivel superior).
    const out = sanitizeRichHtml('<div><p>ok</p><script>alert(1)</script></div>')
    expect(out).toBe('<p>ok</p>')
  })

  it('cadena vacía o solo texto plano se conserva tal cual', () => {
    expect(sanitizeRichHtml('')).toBe('')
    expect(sanitizeRichHtml('texto suelto sin etiquetas')).toBe('texto suelto sin etiquetas')
  })
})
