import type { JSONContent } from '@tiptap/core'
import { createId, MAX_RESPONSES, RESPONSE_LETTERS } from '../../domain'
import type { DecisionResponse, FinalNode, Node, ProjectDocument, SlideNode } from '../../domain'
import { serializeRichBody } from '../../editor/richText/richTextContent'
import { parseTweeSource } from './tweeParser'
import type { TweePassage } from './tweeParser'

/**
 * Conversión de un archivo `.twee` (formato Twee3 de Twine 2/Tweego) a un
 * `ProjectDocument` de Brunch Studio.
 *
 * Mapeo aplicado (decisiones ya tomadas, ver el encargo original):
 * - `StoryTitle`/`StoryData` nunca se convierten en nodos: `StoryTitle` da el
 *   nombre del proyecto (si no está vacío) y `StoryData.start` puede fijar el
 *   pasaje de inicio.
 * - Un pasaje "normal" con 0 enlaces `[[...]]` -> nodo `final`.
 * - Con exactamente 1 enlace -> diapositiva "de continuar" (`targetNodeId` +
 *   `continueLabel` si el texto del enlace no es genérico).
 * - Con 2 o más enlaces -> diapositiva "de decisión" (una `DecisionResponse`
 *   por enlace, máximo 4; el resto se descarta con aviso).
 * - Un enlace a un pasaje inexistente se deja sin destino, con aviso.
 * - Las macros de story format (Harlowe, SugarCube...) no se interpretan:
 *   se detecta su presencia y se avisa, dejando el texto tal cual.
 */

// ---------------------------------------------------------------------------
// Enlaces `[[...]]`
// ---------------------------------------------------------------------------

interface TweeLink {
  target: string
  /** Texto mostrado del enlace; `undefined` si la notación no especifica uno
   *  distinto del nombre del pasaje destino (p.ej. `[[Destino]]`). */
  display?: string
}

const LINK_RE = /\[\[([^\]]*)\]\]/g

/** Interpreta el contenido entre `[[` y `]]` según las cuatro notaciones
 *  equivalentes de Twee: `Destino`, `Texto->Destino`, `Destino<-Texto`,
 *  `Texto|Destino`. */
function parseLinkContent(content: string): TweeLink {
  const arrowIndex = content.indexOf('->')
  if (arrowIndex !== -1) {
    return {
      display: content.slice(0, arrowIndex).trim(),
      target: content.slice(arrowIndex + 2).trim(),
    }
  }

  const backArrowIndex = content.indexOf('<-')
  if (backArrowIndex !== -1) {
    return {
      target: content.slice(0, backArrowIndex).trim(),
      display: content.slice(backArrowIndex + 2).trim(),
    }
  }

  const pipeIndex = content.indexOf('|')
  if (pipeIndex !== -1) {
    return {
      display: content.slice(0, pipeIndex).trim(),
      target: content.slice(pipeIndex + 1).trim(),
    }
  }

  return { target: content.trim() }
}

/** Extrae los enlaces `[[...]]` de un cuerpo de pasaje, en orden de
 *  aparición, y el texto que queda tras quitar esa sintaxis (que ya no es
 *  texto visible: se convierte en la estructura del grafo). */
function extractLinks(body: string): { plainText: string; links: TweeLink[] } {
  const links: TweeLink[] = []
  const plainText = body.replace(LINK_RE, (_match, content: string) => {
    links.push(parseLinkContent(content))
    return ''
  })
  return { plainText, links }
}

// ---------------------------------------------------------------------------
// Detección (no interpretación) de macros de story format
// ---------------------------------------------------------------------------

/** Macros habituales de Harlowe: `(nombre: ...)`. */
const HARLOWE_MACRO_RE =
  /\(\s*(set|if|else-?if|else|unless|print|display|link\w*|goto|either|random|put|move|live|stop|hook|replace|append|prepend|show|hide|enchant)\s*:/i

/** Macros habituales de SugarCube: `<<nombre ...>>`. */
const SUGARCUBE_MACRO_RE =
  /<<\s*\/?\s*(set|if|elseif|else|unless|print|display|goto|link\w*|include|widget|run|silently|nobr|button|replace|append|prepend|timed|repeat|stop)\b/i

/** Detección razonable (no exhaustiva) de lógica de story format en el texto
 *  crudo de un pasaje, sin distinguir el dialecto ante quien lea el aviso. */
function containsTwineLogic(rawBody: string): boolean {
  return HARLOWE_MACRO_RE.test(rawBody) || SUGARCUBE_MACRO_RE.test(rawBody)
}

// ---------------------------------------------------------------------------
// Cuerpo enriquecido
// ---------------------------------------------------------------------------

/** Convierte texto plano (ya sin sintaxis de enlace) en un documento Tiptap
 *  simple de párrafos, separando por líneas en blanco, y lo serializa con
 *  `serializeRichBody` para que Inspector/Player lo muestren como cualquier
 *  otro `body`. No traduce marcado de story format (negrita/cursiva...): se
 *  deja como texto simple, tal como pide el encargo. */
function plainTextToRichBody(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(' '),
    )
    .filter((paragraph) => paragraph.length > 0)

  const doc: JSONContent = {
    type: 'doc',
    content:
      paragraphs.length > 0
        ? paragraphs.map((paragraph) => ({
            type: 'paragraph',
            content: [{ type: 'text', text: paragraph }],
          }))
        : [{ type: 'paragraph', content: [] }],
  }

  return serializeRichBody(doc)
}

// ---------------------------------------------------------------------------
// Texto de continuar genérico
// ---------------------------------------------------------------------------

const GENERIC_CONTINUE_LABELS = new Set(['continue', ''])

/** Decide si el texto mostrado de un enlace de un único destino merece
 *  guardarse como `continueLabel` personalizado, o si es lo bastante
 *  genérico (vacío, "Continue", o igual al nombre del pasaje destino) como
 *  para dejar el valor por defecto ("Continuar"). */
function resolveContinueLabel(display: string | undefined, targetName: string): string | undefined {
  if (display === undefined) return undefined
  const trimmed = display.trim()
  if (GENERIC_CONTINUE_LABELS.has(trimmed.toLowerCase())) return undefined
  if (trimmed === targetName.trim()) return undefined
  return trimmed
}

// ---------------------------------------------------------------------------
// Pasaje de inicio
// ---------------------------------------------------------------------------

/**
 * Decide el `startNodeId` del documento:
 * 1. Si hay un pasaje `StoryData` con un campo `start` (JSON) que nombra un
 *    pasaje real, ese es el inicio.
 * 2. Si no, el primer pasaje "normal" en orden de aparición en el archivo.
 */
function resolveStartNodeId(
  storyDataPassage: TweePassage | undefined,
  nameToId: Map<string, string>,
  firstNodeId: string,
): string {
  if (storyDataPassage) {
    try {
      const data: unknown = JSON.parse(storyDataPassage.body)
      const start =
        typeof data === 'object' && data !== null && 'start' in data
          ? (data as { start?: unknown }).start
          : undefined
      if (typeof start === 'string') {
        const startId = nameToId.get(start)
        if (startId) return startId
      }
    } catch {
      // StoryData no es JSON válido: se ignora y se usa el pasaje inicial por defecto.
    }
  }
  return firstNodeId
}

// ---------------------------------------------------------------------------
// Conversión principal
// ---------------------------------------------------------------------------

export interface ConvertTweeResult {
  document: ProjectDocument
  warnings: string[]
}

const NODES_PER_ROW = 4
const NODE_COLUMN_SPACING = 280
const NODE_ROW_SPACING = 200

/**
 * Convierte el contenido de texto de un archivo `.twee`/`.tw` en un
 * `ProjectDocument` de Brunch Studio nuevo, junto con la lista de avisos
 * (en español, sin jerga técnica) que conviene revisar tras importar.
 *
 * Usa el contenido de `StoryTitle` como nombre del proyecto si existe y no
 * está vacío; si no, usa `fallbackName` (normalmente el nombre del archivo
 * sin extensión).
 *
 * Lanza `Error` si el archivo no tiene ningún pasaje reconocible como nodo
 * (vacío, o solo `StoryTitle`/`StoryData`) en vez de crear un proyecto vacío
 * sin sentido.
 */
export function convertTweeToProject(source: string, fallbackName: string): ConvertTweeResult {
  const passages = parseTweeSource(source)
  const warnings: string[] = []

  const storyTitlePassage = passages.find((passage) => passage.name === 'StoryTitle')
  const storyDataPassage = passages.find((passage) => passage.name === 'StoryData')
  const normalPassages = passages.filter(
    (passage) => passage.name !== 'StoryTitle' && passage.name !== 'StoryData',
  )

  if (normalPassages.length === 0) {
    throw new Error(
      'El archivo .twee no contiene ningún pasaje que se pueda importar: está vacío o solo tiene información de configuración de Twine (StoryTitle/StoryData).',
    )
  }

  const projectName =
    storyTitlePassage && storyTitlePassage.body.trim().length > 0
      ? storyTitlePassage.body.trim()
      : fallbackName

  const nameToId = new Map<string, string>()
  for (const passage of normalPassages) {
    nameToId.set(passage.name, createId())
  }

  function resolveTarget(target: string, sourcePassageName: string): string | undefined {
    const targetId = nameToId.get(target)
    if (!targetId) {
      warnings.push(
        `El enlace a "${target}" del pasaje "${sourcePassageName}" no encontró ningún pasaje con ese nombre; esa conexión se deja sin destino.`,
      )
    }
    return targetId
  }

  const nodes: Node[] = normalPassages.map((passage, index) => {
    const id = nameToId.get(passage.name)
    if (!id) {
      throw new Error(`Fallo interno al importar: no se generó id para el pasaje "${passage.name}".`)
    }

    if (containsTwineLogic(passage.body)) {
      warnings.push(
        `El pasaje "${passage.name}" parece contener lógica de Twine (variables o condiciones) que no se puede importar; revísalo manualmente.`,
      )
    }

    const { plainText, links } = extractLinks(passage.body)
    const body = plainTextToRichBody(plainText)
    const position = {
      x: (index % NODES_PER_ROW) * NODE_COLUMN_SPACING,
      y: Math.floor(index / NODES_PER_ROW) * NODE_ROW_SPACING,
    }
    const common = { id, number: index + 1, position, title: passage.name, body }

    if (links.length === 0) {
      const final: FinalNode = { ...common, type: 'final' }
      return final
    }

    if (links.length === 1) {
      const link = links[0]
      if (!link) {
        throw new Error('Fallo interno al importar: enlace ausente pese a longitud 1.')
      }
      const slide: SlideNode = {
        ...common,
        type: 'slide',
        targetNodeId: resolveTarget(link.target, passage.name),
        continueLabel: resolveContinueLabel(link.display, link.target),
        responses: [],
        imageAssetId: undefined,
        audioAssetId: undefined,
      }
      return slide
    }

    let usedLinks = links
    if (links.length > MAX_RESPONSES) {
      const discarded = links.length - MAX_RESPONSES
      warnings.push(
        `El pasaje "${passage.name}" tiene más de ${MAX_RESPONSES} enlaces; solo se han usado los ${MAX_RESPONSES} primeros y se ${
          discarded === 1 ? 'ha descartado 1 enlace adicional' : `han descartado ${discarded} enlaces adicionales`
        }.`,
      )
      usedLinks = links.slice(0, MAX_RESPONSES)
    }

    const responses: DecisionResponse[] = usedLinks.map((link, responseIndex) => {
      const letter = RESPONSE_LETTERS[responseIndex]
      if (!letter) {
        throw new Error('Fallo interno al importar: índice de respuesta fuera de rango.')
      }
      return {
        id: createId(),
        letter,
        text: link.display ?? link.target,
        imageAssetId: undefined,
        audioAssetId: undefined,
        points: undefined,
        targetNodeId: resolveTarget(link.target, passage.name),
      }
    })

    const slide: SlideNode = {
      ...common,
      type: 'slide',
      targetNodeId: undefined,
      continueLabel: undefined,
      responses,
      imageAssetId: undefined,
      audioAssetId: undefined,
    }
    return slide
  })

  const firstNode = nodes[0]
  if (!firstNode) {
    throw new Error('Fallo interno al importar: no se generó ningún nodo.')
  }
  const startNodeId = resolveStartNodeId(storyDataPassage, nameToId, firstNode.id)

  const now = new Date().toISOString()
  const document: ProjectDocument = {
    schemaVersion: 1,
    metadata: {
      id: createId(),
      name: projectName,
      createdAt: now,
      updatedAt: now,
    },
    settings: {},
    graph: { nodes, startNodeId },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  }

  return { document, warnings }
}
