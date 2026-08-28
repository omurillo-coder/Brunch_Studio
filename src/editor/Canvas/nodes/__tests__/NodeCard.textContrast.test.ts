import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Tarea "Contraste de texto": para las nueve tarjetas de fondo propio del
 * lienzo (Inicio, Final y los 7 colores de diapositiva — `NodeCard.module.css`),
 * en cada uno de los dos modos (claro/oscuro), el texto principal (`.title`,
 * que no fija su propio `color` y hereda el de la tarjeta — ver
 * `NodeCard.module.css`) debe usar el que dé mejor contraste WCAG entre
 * negro (`--bs-color-text` en modo claro, #1b1b1f) y blanco.
 *
 * jsdom no implementa layout/estilo computado real (ver mismo criterio ya
 * seguido en `PlayerScreen.scroll.test.ts`), así que este test combina dos
 * cosas:
 * 1) Recalcula de verdad, con la fórmula de contraste relativo de WCAG 2.x
 *    (la misma documentada en los comentarios de `tokens.css`), las 18
 *    combinaciones (9 fondos × 2 candidatos de texto) en cada modo, a partir
 *    de los valores hexadecimales reales de `tokens.css` — no se fía de los
 *    comentarios, los recalcula.
 * 2) Comprueba el CSS FUENTE (`NodeCard.module.css`/`tokens.css`) para
 *    confirmar que el color realmente aplicado a esas tarjetas coincide con
 *    el ganador de cada modo — negro (heredado de `--bs-color-text` normal)
 *    en claro, blanco explícito (`--bs-color-card-text`) en oscuro.
 */

const testFileUrl = import.meta.url
const nodeCardCss = readFileSync(
  fileURLToPath(new URL('../NodeCard.module.css', testFileUrl)),
  'utf-8',
)
const tokensCss = readFileSync(fileURLToPath(new URL('../../../../styles/tokens.css', testFileUrl)), 'utf-8')

// --- Misma fórmula de contraste relativo WCAG que documentan los
//     comentarios de `tokens.css` (luminancia relativa + ratio de
//     contraste), reimplementada aquí para no depender de los valores ya
//     escritos en esos comentarios. ---
function linearize(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA)
  const lB = relativeLuminance(hexB)
  const lighter = Math.max(lA, lB)
  const darker = Math.min(lA, lB)
  return (lighter + 0.05) / (darker + 0.05)
}

const BLACK = '#1b1b1f' // --bs-color-text en modo claro
const WHITE = '#ffffff'

// Fondos reales de las 9 tarjetas, leídos directamente de `tokens.css`
// (bloque `:root` = claro, bloque `@media (prefers-color-scheme: dark)` =
// oscuro), para no duplicar valores a mano y que este test detecte si
// alguien cambia un fondo sin volver a comprobar el contraste.
const CARD_BG_TOKENS = {
  final: '--bs-color-final-bg',
  intro: '--bs-color-intro-bg',
  yellow: '--bs-color-slide-yellow-bg',
  orange: '--bs-color-slide-orange-bg',
  pink: '--bs-color-slide-pink-bg',
  purple: '--bs-color-slide-purple-bg',
  cyan: '--bs-color-slide-cyan-bg',
  gray: '--bs-color-slide-gray-bg',
  red: '--bs-color-slide-red-bg',
} as const

/** Extrae el valor hexadecimal de un token `--bs-color-*` dentro de un
 *  bloque concreto de `tokens.css` (el `:root` base para claro, o el
 *  contenido completo del `@media (prefers-color-scheme: dark)` para
 *  oscuro) — cada token aparece dos veces en el archivo (una por modo), así
 *  que hay que acotar la búsqueda al bloque correcto. */
function tokenValueIn(block: string, token: string): string {
  const match = block.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`))
  if (!match?.[1]) throw new Error(`No se encontró ${token} en el bloque indicado`)
  return match[1].toLowerCase()
}

const darkBlockMatch = tokensCss.match(/@media \(prefers-color-scheme: dark\) \{([\s\S]*)\n\}\n?$/)
if (!darkBlockMatch?.[1]) throw new Error('No se encontró el bloque de modo oscuro en tokens.css')
const darkBlock = darkBlockMatch[1]
// El bloque claro es todo lo anterior al bloque oscuro (el `:root` base).
const lightBlock = tokensCss.slice(0, tokensCss.indexOf('@media (prefers-color-scheme: dark)'))

type Combo = { name: string; lightBg: string; darkBg: string }

const combos: Combo[] = Object.entries(CARD_BG_TOKENS).map(([name, token]) => ({
  name,
  lightBg: tokenValueIn(lightBlock, token),
  darkBg: tokenValueIn(darkBlock, token),
}))

describe('Contraste de texto — las 9 combinaciones de tarjeta, en claro y en oscuro', () => {
  it('en CLARO, negro da mejor contraste que blanco en las 9 combinaciones (por eso el texto sigue siendo negro ahí)', () => {
    for (const { name, lightBg } of combos) {
      const withBlack = contrastRatio(BLACK, lightBg)
      const withWhite = contrastRatio(WHITE, lightBg)
      expect(withBlack, `${name} (claro, ${lightBg}): negro=${withBlack.toFixed(2)} blanco=${withWhite.toFixed(2)}`).toBeGreaterThan(withWhite)
      // Mismo rigor AAA (≥7:1) que ya documentan los comentarios de
      // `tokens.css` para esta paleta.
      expect(withBlack).toBeGreaterThanOrEqual(7)
    }
  })

  it('en OSCURO, blanco da mejor contraste que negro en las 9 combinaciones (por eso el texto pasa a blanco ahí)', () => {
    for (const { name, darkBg } of combos) {
      const withBlack = contrastRatio(BLACK, darkBg)
      const withWhite = contrastRatio(WHITE, darkBg)
      expect(withWhite, `${name} (oscuro, ${darkBg}): negro=${withBlack.toFixed(2)} blanco=${withWhite.toFixed(2)}`).toBeGreaterThan(withBlack)
      expect(withWhite).toBeGreaterThanOrEqual(7)
    }
  })

  it('`tokens.css` define `--bs-color-card-text` como el negro de `--bs-color-text` en claro', () => {
    expect(lightBlock).toMatch(/--bs-color-card-text:\s*var\(--bs-color-text\)/)
  })

  it('`tokens.css` REDEFINE `--bs-color-card-text` a blanco puro en el bloque de modo oscuro', () => {
    expect(darkBlock).toMatch(/--bs-color-card-text:\s*#ffffff/)
  })

  it('`NodeCard.module.css` aplica `--bs-color-card-text` a las 9 clases de tarjeta (Inicio, Final y los 7 colores de diapositiva)', () => {
    const cardTextRuleMatch = nodeCardCss.match(
      /\.cardFinal,\s*\.cardIntro,\s*\.cardSlideYellow,\s*\.cardSlideOrange,\s*\.cardSlidePink,\s*\.cardSlidePurple,\s*\.cardSlideCyan,\s*\.cardSlideGray,\s*\.cardSlideRed\s*\{([^}]*)\}/,
    )
    expect(cardTextRuleMatch).not.toBeNull()
    expect(cardTextRuleMatch?.[1]).toMatch(/color:\s*var\(--bs-color-card-text\)/)
  })
})

/**
 * BUG REAL reportado por el usuario ("no se lee el texto sobre los colores
 * de las diapositivas"), no cubierto por el bloque de arriba: la pasada
 * anterior solo comprobó/arregló `.title` (que hereda `color` de la
 * tarjeta), pero `.bodyPreview` (vista previa de contenido) y
 * `.responseText` (texto de una respuesta) se pintan DIRECTAMENTE sobre el
 * fondo de color de la tarjeta con su propio tono muted/faint FIJO, pensado
 * solo para el fondo neutro por defecto — sin contraste garantizado sobre
 * las 9 tarjetas de fondo propio. `.startMark` (marca "Inicio") tiene el
 * mismo problema con el turquesa de acento. `.type` (badge "D{número}") NO
 * lo tiene: pinta sobre su PROPIO fondo opaco (`--bs-color-bg`), nunca sobre
 * el color de la tarjeta.
 *
 * Arreglo verificado aquí: `.card` declara `--bs-card-text-muted`/
 * `--bs-card-text-faint`/`--bs-card-text-accent` con el valor neutro de
 * siempre; la MISMA regla combinada de las 9 clases de tarjeta que ya fija
 * `color: var(--bs-color-card-text)` las REDEFINE también a
 * `var(--bs-color-card-text)`; `.bodyPreview`/`.responseText`/`.startMark`
 * consultan esas variables en vez de los tokens fijos. Además de este test
 * (que comprueba el CSS fuente), se hizo verificación VISUAL real con
 * capturas de pantalla en claro y oscuro sobre los 9 fondos — ver el informe
 * de esta tarea.
 */
describe('Contraste de texto — bug real: bodyPreview/responseText/startMark también deben adaptarse al fondo de color', () => {
  const cardRuleMatch = nodeCardCss.match(/(?:^|\n)\.card\s*\{([^}]*)\}/)
  const cardTextRuleMatch = nodeCardCss.match(
    /\.cardFinal,\s*\.cardIntro,\s*\.cardSlideYellow,\s*\.cardSlideOrange,\s*\.cardSlidePink,\s*\.cardSlidePurple,\s*\.cardSlideCyan,\s*\.cardSlideGray,\s*\.cardSlideRed\s*\{([^}]*)\}/,
  )

  it('`.card` declara las tres variables `--bs-card-text-*` con su valor neutro por defecto', () => {
    expect(cardRuleMatch).not.toBeNull()
    expect(cardRuleMatch?.[1]).toMatch(/--bs-card-text-muted:\s*var\(--bs-color-text-muted\)/)
    expect(cardRuleMatch?.[1]).toMatch(/--bs-card-text-faint:\s*var\(--bs-color-text-faint\)/)
    expect(cardRuleMatch?.[1]).toMatch(/--bs-card-text-accent:\s*var\(--bs-color-accent\)/)
  })

  it('las 9 clases de tarjeta con fondo propio REDEFINEN las tres variables a `--bs-color-card-text`', () => {
    expect(cardTextRuleMatch).not.toBeNull()
    expect(cardTextRuleMatch?.[1]).toMatch(/--bs-card-text-muted:\s*var\(--bs-color-card-text\)/)
    expect(cardTextRuleMatch?.[1]).toMatch(/--bs-card-text-faint:\s*var\(--bs-color-card-text\)/)
    expect(cardTextRuleMatch?.[1]).toMatch(/--bs-card-text-accent:\s*var\(--bs-color-card-text\)/)
  })

  it('`.bodyPreview` usa `--bs-card-text-faint` en vez del tono faint fijo', () => {
    const rule = nodeCardCss.match(/\.bodyPreview\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule?.[1]).toMatch(/color:\s*var\(--bs-card-text-faint\)/)
    expect(rule?.[1]).not.toMatch(/color:\s*var\(--bs-color-text-faint\)/)
  })

  it('`.responseText` usa `--bs-card-text-muted` en vez del tono muted fijo', () => {
    const rule = nodeCardCss.match(/\.responseText\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule?.[1]).toMatch(/color:\s*var\(--bs-card-text-muted\)/)
    expect(rule?.[1]).not.toMatch(/color:\s*var\(--bs-color-text-muted\)/)
  })

  it('`.startMark` usa `--bs-card-text-accent` en vez del turquesa de acento fijo', () => {
    const rule = nodeCardCss.match(/\.startMark\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule?.[1]).toMatch(/color:\s*var\(--bs-card-text-accent\)/)
    expect(rule?.[1]).not.toMatch(/color:\s*var\(--bs-color-accent\)/)
  })

  it('`.type` (badge "D{número}") SIGUE con su propio fondo opaco: no necesita el ajuste (no se pinta sobre el color de la tarjeta)', () => {
    const rule = nodeCardCss.match(/\.type\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule?.[1]).toMatch(/background:\s*var\(--bs-color-bg\)/)
  })
})
