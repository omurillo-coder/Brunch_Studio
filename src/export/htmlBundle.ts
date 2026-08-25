import { generateHTML } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { DEFAULT_CONTINUE_LABEL, RESPONSE_LETTERS } from '../domain'
import type { ProjectDocument } from '../domain'
import { parseRichBody } from '../editor/richText/richTextContent'
import type { ExportAssetMap } from './exportAssets'
import {
  BUNDLE_ELEMENT_ID,
  EXPORTED_PLAYER_SCRIPT,
  ROOT_ELEMENT_ID,
} from './exportedPlayerScript'
import { EXPORTED_STYLES } from './exportedStyles'

/**
 * ---------------------------------------------------------------------------
 * Generación del `index.html` autónomo (Milestone 3, fase 1)
 * ---------------------------------------------------------------------------
 *
 * `buildHtmlBundle` es una función PURA (nada de React, nada de Tauri, nada
 * de disco): recibe el documento y los assets ya resueltos en base64 (ver
 * `resolveExportAssets`) y devuelve un único string HTML que se puede abrir
 * con `file://`, subir a cualquier hosting estático o meter tal cual en un
 * paquete SCORM en la fase siguiente.
 *
 * Todo va embebido: estilos, runtime del Player en JS vanilla, el documento
 * como JSON, el cuerpo enriquecido de cada nodo ya convertido a HTML
 * estático, y cada imagen/audio como `data:` URI. Cero peticiones de red,
 * cero dependencias, cero build step en destino.
 *
 * Lo que NO viaja al archivo exportado: React, Tiptap y ProseMirror. El
 * `body` de cada nodo (un documento Tiptap serializado) se convierte a HTML
 * aquí, en tiempo de exportación, con `generateHTML` de `@tiptap/core` y las
 * MISMAS extensiones que usan `RichTextEditor`/`RichTextView` (`StarterKit`),
 * así que el resultado visual coincide con lo que se editó — pero el archivo
 * resultante no arrastra un editor entero solo para pintar párrafos y listas.
 */

/** Texto que se muestra en el HTML exportado. Viaja dentro del JSON
 *  embebido, no interpolado en el script, para no tener que escapar código.
 *  Los valores replican literalmente los de `PlayerScreen`, salvo el de
 *  `deadEnd`: en un archivo publicado no existe ningún editor al que volver,
 *  así que ese texto se adapta en vez de copiarse. */
interface ExportedTexts {
  defaultContinueLabel: string
  emptySlideBody: string
  emptyResponse: string
  finalTitle: string
  finalFallbackBody: string
  pointsPrefix: string
  pointsSuffix: string
  retry: string
  deadEnd: string
  nodeImageAlt: string
  responseImageAlt: string
}

const EXPORTED_TEXTS: ExportedTexts = {
  defaultContinueLabel: DEFAULT_CONTINUE_LABEL,
  emptySlideBody: 'Esta diapositiva todavía no tiene contenido.',
  emptyResponse: 'Opción sin texto configurado',
  finalTitle: 'Fin de la experiencia',
  finalFallbackBody: 'Has llegado al final de esta experiencia.',
  pointsPrefix: 'Puntuación final: ',
  pointsSuffix: ' puntos',
  retry: 'Reintentar',
  deadEnd: 'Esta parte de la experiencia no tiene una continuación configurada.',
  nodeImageAlt: 'Imagen de esta pantalla',
  responseImageAlt: 'Imagen de la respuesta ',
}

/** Mensaje para quien abra el archivo con JavaScript desactivado. */
const NOSCRIPT_MESSAGE =
  'Esta experiencia interactiva necesita JavaScript. Actívalo en tu navegador para poder reproducirla.'

/** Forma del JSON embebido que lee el runtime del HTML exportado. */
interface ExportBundle {
  project: ProjectDocument
  /** `nodeId` -> cuerpo enriquecido ya convertido a HTML estático. Solo
   *  contiene los nodos con cuerpo no vacío. */
  bodyHtml: Record<string, string>
  /** `assetId` -> `data:` URI completo, listo para un `src`. */
  assetUris: Record<string, string>
  /** Orden fijo de letras con el que se ordenan las respuestas (la letra
   *  nunca se muestra; ver `RESPONSE_LETTERS` en el dominio). */
  responseLetters: string[]
  texts: ExportedTexts
}

/** Escapa texto para insertarlo como contenido/atributo de HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Serializa el bundle para meterlo en un `<script type="application/json">`.
 *
 * El contenido de un elemento `script` es texto crudo: el navegador no
 * interpreta entidades ahí, y lo único que puede cerrarlo antes de tiempo es
 * la secuencia de cierre de un `script`. Escapar TODOS los `<` como la
 * secuencia de escape unicode `\\u003c` (válida en JSON, y que `JSON.parse`
 * devuelve como `<`) elimina ese riesgo de raíz, incluido el HTML ya
 * renderizado de los cuerpos y cualquier `<` que el autor haya escrito en un
 * título o en una respuesta.
 */
function serializeBundle(bundle: ExportBundle): string {
  return JSON.stringify(bundle).replace(/</g, '\\u003c')
}

/**
 * El título de un nodo es solo referencia interna del diseñador
 * instruccional, nunca contenido final: no debe aparecer en ningún punto del
 * HTML/SCORM exportado. `exportedPlayerScript.ts` ya no lo pinta en el DOM
 * (vistas `continue`/`decision`; `final` nunca lo usó, tiene su propio texto
 * fijo "Fin de la experiencia"), pero el `project` completo viaja embebido
 * como JSON en el HTML para que el runtime lo lea — así que, para que el
 * título tampoco quede visible con un simple "ver código fuente", se vacía
 * aquí antes de embeberlo. El runtime exportado no usa `node.title` para
 * nada más, así que esto no cambia ningún comportamiento.
 */
function stripNodeTitles(project: ProjectDocument): ProjectDocument {
  return {
    ...project,
    graph: {
      ...project.graph,
      nodes: project.graph.nodes.map((node) => ({ ...node, title: '' })),
    },
  }
}

/**
 * Convierte el `body` (documento Tiptap serializado) de cada nodo con
 * contenido a HTML estático. Se omiten los nodos con `body` vacío o solo
 * espacios: el runtime exportado ya pinta su texto de respaldo en ese caso,
 * igual que el Player.
 */
function renderNodeBodies(project: ProjectDocument): Record<string, string> {
  const bodyHtml: Record<string, string> = {}
  for (const node of project.graph.nodes) {
    if (!node.body.trim()) continue
    bodyHtml[node.id] = generateHTML(parseRichBody(node.body), [StarterKit])
  }
  return bodyHtml
}

/** `assetId` -> `data:` URI, solo para los assets que se pudieron leer. */
function buildAssetUris(assets: ExportAssetMap): Record<string, string> {
  const assetUris: Record<string, string> = {}
  for (const [assetId, asset] of Object.entries(assets)) {
    assetUris[assetId] = `data:${asset.mimeType};base64,${asset.dataBase64}`
  }
  return assetUris
}

/**
 * Construye el `index.html` autónomo de `project`.
 *
 * `assets` son los assets ya leídos (base64) indexados por id — normalmente
 * el `assets` que devuelve `resolveExportAssets`. Un asset referenciado por
 * el documento que no esté en el mapa simplemente no se pinta en el HTML
 * exportado (misma tolerancia que el Player ante un medio que no carga): el
 * resto de la experiencia sigue funcionando.
 *
 * Determinista: el mismo documento con los mismos assets produce byte a byte
 * el mismo HTML (no se incluye fecha de exportación ni nada variable), lo que
 * permite comparar exportaciones y hace los tests estables.
 */
export function buildHtmlBundle(project: ProjectDocument, assets: ExportAssetMap): string {
  const bundle: ExportBundle = {
    project: stripNodeTitles(project),
    bodyHtml: renderNodeBodies(project),
    assetUris: buildAssetUris(assets),
    responseLetters: [...RESPONSE_LETTERS],
    texts: EXPORTED_TEXTS,
  }

  const title = project.metadata.name.trim() || 'Experiencia interactiva'

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="Brunch Studio — Content Factory iLERNA" />
<title>${escapeHtml(title)}</title>
<style>${EXPORTED_STYLES}</style>
</head>
<body>
<main id="${ROOT_ELEMENT_ID}" class="stage"></main>
<noscript><p class="noscript">${escapeHtml(NOSCRIPT_MESSAGE)}</p></noscript>
<script type="application/json" id="${BUNDLE_ELEMENT_ID}">${serializeBundle(bundle)}</script>
<script>${EXPORTED_PLAYER_SCRIPT}</script>
</body>
</html>
`
}
