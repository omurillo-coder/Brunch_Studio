/**
 * Parser de archivos en formato Twee3 (el formato de texto de Twine 2 /
 * Tweego): separa el archivo en sus pasajes, cada uno con su nombre,
 * etiquetas, metadata opcional y cuerpo.
 *
 * Deliberadamente NO interpreta el contenido de cada pasaje (enlaces
 * `[[...]]`, macros de story format...): eso es responsabilidad de
 * `tweeConverter.ts`. Este módulo solo reconoce dónde empieza y termina cada
 * pasaje.
 */

export interface TweePassage {
  name: string
  /** Etiquetas del pasaje, p.ej. `:: Nombre [tag1 tag2]`. Vacío si no tiene. */
  tags: string[]
  /** Metadata JSON de la cabecera (`{"...":...}`), si la hay y es JSON válido. */
  metadata?: unknown
  /** Cuerpo del pasaje tal cual (sin interpretar), recortado de espacios sobrantes al principio/final. */
  body: string
}

/**
 * Busca el bloque `{...}` final de una línea de cabecera (la metadata JSON),
 * balanceando llaves desde el final de la línea hacia atrás. Devuelve el
 * resto de la línea sin ese bloque.
 */
function splitTrailingBraces(header: string): { rest: string; json?: string } {
  const trimmed = header.trimEnd()
  if (!trimmed.endsWith('}')) return { rest: header }

  let depth = 0
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const char = trimmed[i]
    if (char === '}') {
      depth++
    } else if (char === '{') {
      depth--
      if (depth === 0) {
        return { rest: trimmed.slice(0, i), json: trimmed.slice(i) }
      }
    }
  }
  // Llaves desequilibradas: no es un bloque de metadata reconocible.
  return { rest: header }
}

/**
 * Busca el bloque `[...]` final de una línea de cabecera (las etiquetas). No
 * balancea corchetes anidados: las etiquetas de Twee no los usan.
 */
function splitTrailingBrackets(header: string): { rest: string; tagsRaw?: string } {
  const trimmed = header.trimEnd()
  if (!trimmed.endsWith(']')) return { rest: header }
  const openIndex = trimmed.lastIndexOf('[')
  if (openIndex === -1) return { rest: header }
  return {
    rest: trimmed.slice(0, openIndex),
    tagsRaw: trimmed.slice(openIndex + 1, trimmed.length - 1),
  }
}

/** Desescapa los `\:` de un nombre de pasaje a `:` literal. */
function unescapeColon(name: string): string {
  return name.replace(/\\:/g, ':')
}

function parseHeaderLine(headerContent: string): Omit<TweePassage, 'body'> {
  const { rest: afterBraces, json } = splitTrailingBraces(headerContent)
  const { rest: afterBrackets, tagsRaw } = splitTrailingBrackets(afterBraces)

  const name = unescapeColon(afterBrackets.trim())
  const tags = tagsRaw ? tagsRaw.split(/\s+/).filter((tag) => tag.length > 0) : []

  let metadata: unknown
  if (json) {
    try {
      metadata = JSON.parse(json)
    } catch {
      // Metadata inválida: se ignora en vez de romper el parseo de todo el
      // archivo por un detalle no esencial (el nombre/enlaces sí importan).
      metadata = undefined
    }
  }

  return { name, tags, metadata }
}

interface PassageInProgress extends Omit<TweePassage, 'body'> {
  bodyLines: string[]
}

function finishPassage(passage: PassageInProgress): TweePassage {
  const { bodyLines, ...header } = passage
  return { ...header, body: bodyLines.join('\n').trim() }
}

/**
 * Parsea el contenido de un archivo `.twee`/`.tw` en su lista de pasajes, en
 * el orden en que aparecen en el archivo.
 *
 * Reconoce cabeceras `:: Nombre [tag1 tag2] {"metadata":true}` al inicio de
 * línea. Una línea que empiece literalmente con `\::` se trata como texto de
 * cuerpo (con la barra de escape retirada), no como una cabecera nueva —
 * mismo criterio que Twine 2/Tweego para poder incluir `::` literal al
 * principio de una línea de contenido. El texto anterior a la primera
 * cabecera (si lo hay) se descarta, igual que hacen esas herramientas.
 */
export function parseTweeSource(source: string): TweePassage[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const passages: TweePassage[] = []
  let current: PassageInProgress | null = null

  for (const line of lines) {
    if (line.startsWith('\\::')) {
      current?.bodyLines.push(line.slice(1))
      continue
    }

    if (line.startsWith('::')) {
      if (current) {
        passages.push(finishPassage(current))
      }
      const header = parseHeaderLine(line.slice(2))
      current = { ...header, bodyLines: [] }
      continue
    }

    current?.bodyLines.push(line)
  }

  if (current) {
    passages.push(finishPassage(current))
  }

  return passages
}
