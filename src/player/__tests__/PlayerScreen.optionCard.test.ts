import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Mismo patrón que `PlayerScreen.scroll.test.ts` (ver su comentario sobre
// `node:fs`/`node:url` y por qué `new URL('...', import.meta.url)` se
// escribe así): se comprueba el CSS FUENTE en vez del DOM montado, porque
// jsdom no aplica layout real y por tanto no puede confirmar visualmente
// "la imagen queda dentro de la tarjeta de la opción" ni "hay más espacio
// entre el contenido y las opciones" — eso se confirma con la verificación
// visual documentada en el informe de la tarea.
const testFileUrl = import.meta.url
const resolved = new URL('../PlayerScreen.module.css', testFileUrl)
const css = readFileSync(fileURLToPath(resolved), 'utf-8')

function ruleFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) {
    throw new Error(`No se encontró la regla ${selector} en PlayerScreen.module.css`)
  }
  return match[1]!
}

/**
 * Tarea 1 — la imagen/audio de una respuesta debe quedar visualmente DENTRO
 * de la tarjeta de esa opción, no como un elemento suelto después de ella
 * (bug reportado). En el DOM la imagen ya era descendiente de `.option`
 * antes de este arreglo (ver test de estructura en `PlayerScreen.test.tsx`
 * y en `htmlBundle.test.ts`), pero el borde/fondo de "tarjeta" vivía en
 * `.optionButton`, dejando la imagen fuera de ese límite visual. El arreglo
 * traslada ese borde/fondo a `.option` (el contenedor que envuelve texto +
 * imagen/audio de la respuesta) y despoja a `.optionButton` de su propio
 * borde, para que ambos se perciban como una única superficie.
 */
describe('PlayerScreen.module.css — la tarjeta visual de una opción envuelve texto + imagen/audio', () => {
  it('.option (no .optionButton) lleva el borde/fondo de "tarjeta"', () => {
    expect(ruleFor(css, '.option')).toMatch(/border:\s*1px solid/)
    expect(ruleFor(css, '.option')).toMatch(/background:/)
  })

  it('.optionButton ya NO lleva borde/fondo propios (para no "cortar" antes de la imagen/audio)', () => {
    const rule = ruleFor(css, '.optionButton')
    expect(rule).toMatch(/border:\s*none/)
    expect(rule).not.toMatch(/border:\s*1px solid/)
  })

  it('el hover de la opción (cambio de color de borde) se aplica a la tarjeta entera vía :has()', () => {
    expect(css).toMatch(/\.option:has\(\.optionButton:hover:not\(:disabled\)\)\s*\{/)
  })
})

/**
 * Tarea 2 — separación extra entre el bloque de CONTENIDO de la diapositiva
 * y el bloque de OPCIONES, para que se perciban como dos secciones
 * distintas de la tarjeta (antes usaban el mismo `gap` que cualquier otro
 * salto de línea de `.card`).
 */
describe('PlayerScreen.module.css — separación extra entre el contenido y las opciones', () => {
  it('.options añade un margin-top además del gap heredado de .card', () => {
    expect(ruleFor(css, '.options')).toMatch(/margin-top:\s*var\(--bs-space-\d\)/)
  })
})
