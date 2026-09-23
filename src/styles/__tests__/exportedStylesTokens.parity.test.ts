import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Hallazgo de auditoría: `src/export/exportedStyles.ts` es un mirror manual
 * de un SUBCONJUNTO de `src/styles/tokens.css` (comentario de cabecera de
 * `exportedStyles.ts`) — nada obliga a que los valores de un token
 * compartido coincidan entre ambos archivos cuando se cambia uno sin el
 * otro. Ya ha pasado de verdad: `--bs-font-size-md`/`-lg`, el `max-width`
 * de `.card` y varios `transition` se desincronizaron silenciosamente
 * (ningún test lo detectaba). Este archivo compara, token por token, TODOS
 * los `--bs-*` que aparecen en el bloque `:root` (claro) y en el bloque
 * `@media (prefers-color-scheme: dark) { :root {...} }` (oscuro) de
 * `exportedStyles.ts` contra el valor del MISMO token en `tokens.css` — no
 * exige que `exportedStyles.ts` incluya todos los tokens de `tokens.css`
 * (es un subconjunto deliberado), solo que los que sí incluye no diverjan.
 */

const TOKENS_CSS_PATH = path.resolve(__dirname, '../tokens.css')
const EXPORTED_STYLES_PATH = path.resolve(__dirname, '../../export/exportedStyles.ts')

/** Extrae el contenido de un bloque `selector { ... }` localizando las
 *  llaves que se corresponden entre sí (sin asumir que no hay nada anidado
 *  antes, solo que el propio bloque no anida más llaves). */
function blockAfter(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker)
  if (markerIndex === -1) throw new Error(`No se ha encontrado "${marker}".`)
  const openIndex = source.indexOf('{', markerIndex)
  let depth = 0
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(openIndex + 1, i)
    }
  }
  throw new Error(`Bloque sin cerrar tras "${marker}".`)
}

/** Todos los pares `--bs-nombre: valor;` de un bloque, como mapa nombre ->
 *  valor (recortado, sin el `;` final). */
function customPropertiesIn(block: string): Map<string, string> {
  const map = new Map<string, string>()
  const pattern = /(--bs-[a-z0-9-]+)\s*:\s*([^;]+);/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(block))) {
    map.set(match[1]!, match[2]!.trim())
  }
  return map
}

function loadLightAndDarkTokens(source: string): { light: Map<string, string>; dark: Map<string, string> } {
  const light = customPropertiesIn(blockAfter(source, ':root {'))
  const darkSection = source.slice(source.indexOf('@media (prefers-color-scheme: dark)'))
  const dark = customPropertiesIn(blockAfter(darkSection, ':root {'))
  return { light, dark }
}

describe('paridad de tokens --bs-* entre tokens.css y exportedStyles.ts', () => {
  const tokensCss = readFileSync(TOKENS_CSS_PATH, 'utf-8')
  const exportedStyles = readFileSync(EXPORTED_STYLES_PATH, 'utf-8')

  const source = loadLightAndDarkTokens(tokensCss)
  const exported = loadLightAndDarkTokens(exportedStyles)

  it('exportedStyles.ts no está vacío de tokens (protege el test contra un cambio de formato que rompa el parseo)', () => {
    expect(exported.light.size).toBeGreaterThan(5)
    expect(exported.dark.size).toBeGreaterThan(5)
  })

  it('cada token --bs-* del bloque claro de exportedStyles.ts coincide con tokens.css', () => {
    for (const [name, value] of exported.light) {
      expect(source.light.get(name), `${name} (claro) no existe en tokens.css`).toBeDefined()
      expect(value, `${name} (claro) difiere entre tokens.css y exportedStyles.ts`).toBe(
        source.light.get(name),
      )
    }
  })

  it('cada token --bs-* del bloque oscuro de exportedStyles.ts coincide con tokens.css', () => {
    for (const [name, value] of exported.dark) {
      expect(source.dark.get(name), `${name} (oscuro) no existe en tokens.css`).toBeDefined()
      expect(value, `${name} (oscuro) difiere entre tokens.css y exportedStyles.ts`).toBe(
        source.dark.get(name),
      )
    }
  })
})
