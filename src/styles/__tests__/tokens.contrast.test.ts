import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Hallazgo de auditoría: "un token de texto no cumple contraste AA" —
 * `--bs-color-text-faint` se usaba (antes de este fix) tanto para elementos
 * puramente decorativos (un punto divisor, un icono deshabilitado) como para
 * texto real que se lee de verdad (la etiqueta "Diapositiva N" en
 * `LeftPanel`, el estado de guardado en `Topbar`, el resumen de contenido en
 * `NodeCard`...) — y en ~2.9:1 (claro) / ~3.2:1 (oscuro) no llegaba al
 * mínimo AA de 4.5:1 para texto normal.
 *
 * Mismo criterio que `NodeCard.textContrast.test.ts`: recalcula el
 * contraste con la fórmula WCAG 2.x a partir de los valores hexadecimales
 * reales de `tokens.css` (no se fía de lo que digan los comentarios), contra
 * los DOS fondos reales sobre los que puede aparecer texto en la app
 * (`--bs-color-surface` y `--bs-color-bg`), en ambos modos.
 *
 * También comprueba `src/export/exportedStyles.ts` (mirror manual de
 * `tokens.css` para el HTML exportado, ver su comentario de cabecera): un
 * cambio de este token en uno sin el otro es exactamente el tipo de
 * desincronización que el resto de este proyecto ya tiene tests de paridad
 * para evitar (`runtimeParity.test.ts`).
 */

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

/** Mínimo AA (WCAG 2.x) para texto normal (no "large text"). */
const AA_NORMAL_TEXT_MINIMUM = 4.5

function tokenValueIn(block: string, token: string): string {
  const match = block.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`))
  if (!match?.[1]) throw new Error(`No se encontró ${token} en el bloque indicado`)
  return match[1].toLowerCase()
}

/**
 * Extrae el bloque `@media (prefers-color-scheme: dark) { :root { ... } }`
 * completo (para poder buscar tokens dentro con `tokenValueIn`) y el "bloque
 * claro" (todo lo anterior, el `:root` base).
 *
 * A diferencia de `NodeCard.textContrast.test.ts` (que puede anclar al final
 * literal del ARCHIVO porque en `tokens.css` el bloque oscuro es lo último),
 * aquí también se procesa `exportedStyles.ts`, donde el bloque oscuro va
 * seguido de más CSS (`* { box-sizing: ... }` y el resto de la hoja
 * exportada) — así que en vez de anclar a `$` se busca el primer `\n}\n`
 * (una línea que es SOLO `}`, sin indentar) tras la apertura del `@media`:
 * el cierre de `:root` va indentado (`  }`), así que nunca coincide con ese
 * patrón — el primer `\n}\n` real es siempre el cierre del propio `@media`.
 */
function splitLightDarkBlocks(css: string): { light: string; dark: string } {
  const darkStart = css.indexOf('@media (prefers-color-scheme: dark)')
  if (darkStart === -1) throw new Error('No se encontró el bloque de modo oscuro')

  const fromDarkStart = css.slice(darkStart)
  const closeMatch = fromDarkStart.match(/\n\}\n/)
  if (!closeMatch || closeMatch.index === undefined) {
    throw new Error('No se pudo determinar el cierre del bloque de modo oscuro')
  }

  return {
    light: css.slice(0, darkStart),
    dark: fromDarkStart.slice(0, closeMatch.index + closeMatch[0].length),
  }
}

// Basado en `process.cwd()` en vez de `import.meta.url` (mismo criterio que
// `src/domain/__tests__/diagnostics.test.ts`, ver su comentario): bajo
// Vitest, `import.meta.url` de un fichero de test no siempre es un `file://`
// real, y `new URL(ruta_relativa, esa url)` puede fallar con "The URL must
// be of scheme file". `vitest run` siempre se invoca desde la raíz del
// repo, así que `process.cwd()` es un ancla estable aquí.
const tokensCss = readFileSync(path.join(process.cwd(), 'src/styles/tokens.css'), 'utf-8')
const { light: tokensLight, dark: tokensDark } = splitLightDarkBlocks(tokensCss)

const exportedStylesSource = readFileSync(
  path.join(process.cwd(), 'src/export/exportedStyles.ts'),
  'utf-8',
)
const { light: exportedLight, dark: exportedDark } = splitLightDarkBlocks(exportedStylesSource)

describe('--bs-color-text-faint cumple AA (4.5:1) contra los dos fondos reales de la app', () => {
  it.each([
    ['tokens.css — claro', tokensLight, '--bs-color-text-faint', '--bs-color-surface', '--bs-color-bg'],
    ['tokens.css — oscuro', tokensDark, '--bs-color-text-faint', '--bs-color-surface', '--bs-color-bg'],
    [
      'exportedStyles.ts — claro',
      exportedLight,
      '--bs-color-text-faint',
      '--bs-color-surface',
      '--bs-color-bg',
    ],
    [
      'exportedStyles.ts — oscuro',
      exportedDark,
      '--bs-color-text-faint',
      '--bs-color-surface',
      '--bs-color-bg',
    ],
  ])('%s: %s vs %s y %s ≥ 4.5:1', (_label, block, textToken, surfaceToken, bgToken) => {
    const text = tokenValueIn(block, textToken)
    const surface = tokenValueIn(block, surfaceToken)
    const bg = tokenValueIn(block, bgToken)

    const vsSurface = contrastRatio(text, surface)
    const vsBg = contrastRatio(text, bg)

    expect(vsSurface, `${text} vs superficie ${surface}: ${vsSurface.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT_MINIMUM,
    )
    expect(vsBg, `${text} vs fondo ${bg}: ${vsBg.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MINIMUM)
  })

  it('tokens.css y exportedStyles.ts usan EXACTAMENTE el mismo valor en cada modo (dual-runtime, sin desincronizar)', () => {
    expect(tokenValueIn(exportedLight, '--bs-color-text-faint')).toBe(
      tokenValueIn(tokensLight, '--bs-color-text-faint'),
    )
    expect(tokenValueIn(exportedDark, '--bs-color-text-faint')).toBe(
      tokenValueIn(tokensDark, '--bs-color-text-faint'),
    )
  })
})
