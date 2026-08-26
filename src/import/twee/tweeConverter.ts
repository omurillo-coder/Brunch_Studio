import { generateJSON } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { createId, DEFAULT_CONTENT_ORDER, MAX_RESPONSES, RESPONSE_LETTERS } from '../../domain'
import type { DecisionResponse, FinalNode, Node, ProjectDocument, SlideNode } from '../../domain'
import { RICH_TEXT_EXTENSIONS, serializeRichBody } from '../../editor/richText/richTextContent'
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
 * - El HTML embebido en el texto de un pasaje (muy habitual en Twine/Harlowe
 *   para maquetar: `<div class="...">`, `<strong>`, `style="..."`) sí se
 *   interpreta como marcado real cuando el editor tiene un equivalente
 *   (negrita, cursiva, listas, párrafos); lo que no tiene equivalente
 *   (etiquetas de maquetación como `<div>`, atributos `class`/`style`) se
 *   descarta silenciosamente conservando su texto, nunca se muestra la
 *   etiqueta cruda. Ver `containsEmbeddedHtml`/`embeddedHtmlToRichDoc`.
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

/** Detecta una etiqueta HTML "de verdad" en el texto de un pasaje: un único
 *  `<` (no precedido de otro `<`) seguido directamente de una letra (o de
 *  `/` + letra para el cierre). Autores de Twine/Harlowe a menudo maquetan
 *  pasajes con HTML crudo (`<div class="...">`, `<strong>`, `style="..."`)
 *  directamente en el texto; sin esto, esas etiquetas se veían tal cual como
 *  texto plano en el resultado.
 *
 *  El requisito de que no vaya precedido de otro `<` es deliberado: excluye
 *  la sintaxis de macro de doble ángulo de SugarCube (`<<set ...>>`,
 *  `<<if ...>>`), que jamás debe confundirse con una etiqueta HTML real. */
const HTML_TAG_RE = /(?<!<)<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>]*)?>/

/** Decide si el texto de un pasaje (ya sin sintaxis de enlace `[[...]]`)
 *  contiene HTML embebido que conviene interpretar como marcado real, en
 *  vez de como texto plano.
 *
 *  Se excluye explícitamente cualquier texto con macro de SugarCube: pasar
 *  `<<set $x to 1>>` por un parser HTML lo corrompe (el `<` doble no forma
 *  una etiqueta válida y el resultado es basura como `<> ` + texto suelto),
 *  y el comportamiento ya existente de conservar las macros como texto con
 *  aviso (`containsTwineLogic`) tiene prioridad sobre interpretar HTML. */
function containsEmbeddedHtml(text: string): boolean {
  return HTML_TAG_RE.test(text) && !SUGARCUBE_MACRO_RE.test(text)
}

/** Convierte el HTML embebido de un pasaje en un documento Tiptap real vía
 *  `generateJSON` (mismas extensiones que el editor): las etiquetas con
 *  equivalente en el modelo de texto enriquecido de la app (`<strong>`/`<b>`
 *  -> negrita, `<em>`/`<i>` -> cursiva, `<ul>`/`<ol>`/`<li>` -> listas,
 *  `<p>`/saltos de línea -> párrafos...) se convierten en las marcas/nodos
 *  Tiptap correspondientes. Las etiquetas o atributos sin equivalente
 *  (`<div class="cpi-level">`, `style="width:0%"`, clases CSS propias de la
 *  maquetación original de Twine) no tienen regla de parseo en este esquema
 *  Tiptap: `generateJSON` las descarta silenciosamente y conserva solo su
 *  contenido de texto, que es justo el comportamiento buscado — nunca debe
 *  verse una etiqueta o atributo crudo como texto para el usuario final.
 *
 *  Devuelve `undefined` si `generateJSON` lanza (HTML demasiado irregular);
 *  la llamada debe caer entonces al tratamiento de texto plano de abajo en
 *  vez de romper la importación completa del archivo por un solo pasaje. */
function embeddedHtmlToRichDoc(text: string): JSONContent | undefined {
  try {
    return generateJSON(text, RICH_TEXT_EXTENSIONS) as JSONContent
  } catch {
    return undefined
  }
}

/** Convierte el texto de un pasaje (ya sin sintaxis de enlace) en un
 *  documento Tiptap y lo serializa con `serializeRichBody` para que
 *  Inspector/Player lo muestren como cualquier otro `body`.
 *
 * - Si el texto contiene HTML embebido de verdad (`containsEmbeddedHtml`),
 *   se interpreta como marcado real (ver `embeddedHtmlToRichDoc`).
 * - En cualquier otro caso -incluido si el HTML era demasiado irregular
 *   para interpretarse- se trata como texto plano simple: separa por líneas
 *   en blanco en párrafos, uniendo con un espacio las líneas sueltas de
 *   cada párrafo. No traduce marcado de story format (macros Harlowe/
 *   SugarCube): se deja tal cual, tal como pide el encargo, para que el
 *   aviso de `containsTwineLogic` siga teniendo sentido. */
function plainTextToRichBody(text: string): string {
  if (containsEmbeddedHtml(text)) {
    const htmlDoc = embeddedHtmlToRichDoc(text)
    if (htmlDoc) {
      return serializeRichBody(htmlDoc)
    }
  }

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
        imageAssetIds: [],
        audioAssetId: undefined,
        contentOrder: DEFAULT_CONTENT_ORDER,
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
      imageAssetIds: [],
      audioAssetId: undefined,
      contentOrder: DEFAULT_CONTENT_ORDER,
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
    // Un proyecto recién importado desde Twee nace sin variables (Twee no
    // tiene el concepto); igual que `createProject`.
    variables: [],
    graph: { nodes, startNodeId },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  }

  return { document, warnings }
}
