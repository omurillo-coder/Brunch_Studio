import { generateHTML } from '@tiptap/core'
import { CICLOS, cicloOutputName, DEFAULT_CONTINUE_LABEL, RESPONSE_LETTERS } from '../domain'
import type { ProjectDocument } from '../domain'
import { RICH_TEXT_EXTENSIONS, parseRichBody } from '../editor/richText/richTextContent'
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
 * estático, y cada imagen/audio/vídeo como `data:` URI. Cero peticiones de red,
 * cero dependencias, cero build step en destino.
 *
 * Lo que NO viaja al archivo exportado: React, Tiptap y ProseMirror. El
 * `body` de cada nodo (un documento Tiptap serializado) se convierte a HTML
 * aquí, en tiempo de exportación, con `generateHTML` de `@tiptap/core` y las
 * MISMAS extensiones que usan `RichTextEditor`/`RichTextView`
 * (`RICH_TEXT_EXTENSIONS`, `richTextContent.ts`), así que el resultado
 * visual coincide con lo que se editó — pero el archivo resultante no
 * arrastra un editor entero solo para pintar párrafos y listas.
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
  retry: 'Volver a jugar',
  deadEnd: 'Esta parte de la experiencia no tiene una continuación configurada.',
  nodeImageAlt: 'Imagen de esta pantalla',
  responseImageAlt: 'Imagen de la respuesta ',
}

/** Mensaje para quien abra el archivo con JavaScript desactivado. */
const NOSCRIPT_MESSAGE =
  'Esta experiencia interactiva necesita JavaScript. Actívalo en tu navegador para poder reproducirla.'

/**
 * Datos del modo revisión profes ("Exportar revisión profes") que viajan
 * embebidos en el bundle cuando está activo. `buildTeacherReviewBundle`
 * (`src/export/teacherReviewExport.ts`) es quien las produce (textos fijos +
 * la imagen del pingüino ya convertida a `data:` URI EN TIEMPO DE
 * EXPORTACIÓN, mismo motivo que `resolveIntroCatalogNames` más abajo: este
 * módulo puede hacer `fetch` de un asset propio de la app, el runtime JS
 * vanilla embebido no) y las pasa a `buildHtmlBundle` — este archivo no las
 * conoce más que como texto opaco.
 */
export interface TeacherReviewBundleOptions {
  welcomeText: string
  completionText: string
  penguinDataUri: string
}

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
  /**
   * Nombres legibles de `cicloId`/`asignaturaId` del nodo `intro` (portada),
   * ya resueltos contra `CICLOS` (`src/domain/catalog.ts`) EN TIEMPO DE
   * EXPORTACIÓN — ver `resolveIntroCatalogNames` más abajo para por qué se
   * resuelven aquí y no en el runtime JS vanilla embebido. `null` si no hay
   * nodo `intro`, o si el campo correspondiente no está elegido, o si el id
   * ya no existe en el catálogo.
   */
  introCicloName: string | null
  introAsignaturaName: string | null
  /**
   * Bandera de "modo revisión profes" (ver `exportedPlayerScript.ts`,
   * sección "Modo revisión profes"), y los datos que ese modo necesita.
   * Ausentes (no `false`/`null`) en el export HTML/SCORM normal —
   * `serializeBundle`/`JSON.stringify` omite del todo un campo `undefined`,
   * así que un HTML exportado normal no lleva ni rastro de estas dos claves.
   */
  reviewMode?: true
  teacherReview?: TeacherReviewBundleOptions
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
 * El título de un nodo y su nota interna (`internalNote`) son solo
 * referencia/recordatorio del diseñador instruccional, nunca contenido
 * final: no deben aparecer en ningún punto del HTML/SCORM exportado.
 * `exportedPlayerScript.ts` ya no pinta el título en el DOM (vistas
 * `continue`/`decision`; `final` nunca lo usó, tiene su propio texto fijo
 * "Fin de la experiencia") y nunca ha leído `internalNote` para nada, pero el
 * `project` completo viaja embebido como JSON en el HTML para que el runtime
 * lo lea — así que, para que ninguno de los dos quede visible con un simple
 * "ver código fuente", se vacían aquí antes de embeberlo. `internalNote` se
 * deja en `undefined` (no `''`): al ser un campo opcional, `JSON.stringify`
 * lo omite por completo del JSON embebido, en vez de dejar una cadena vacía
 * visible. El runtime exportado no usa ninguno de los dos campos para nada
 * más, así que esto no cambia ningún comportamiento.
 */
function stripEditorOnlyFields(project: ProjectDocument): ProjectDocument {
  return {
    ...project,
    graph: {
      ...project.graph,
      nodes: project.graph.nodes.map((node) => ({ ...node, title: '', internalNote: undefined })),
    },
  }
}

/**
 * Convierte a HTML estático cada cuerpo de texto Tiptap serializado del
 * documento: el `body` de un `final` (clave = `node.id`, igual que antes de
 * "Bloques de contenido") y el `body` de cada bloque `text` de
 * `SlideNode.content` (clave = `block.id` — una diapositiva puede tener
 * VARIOS bloques de texto, así que ya no basta con la clave por nodo). Se
 * omiten los cuerpos vacíos o solo espacios: el runtime exportado ya pinta
 * su texto de respaldo en ese caso (solo para `continue`/`final`; un bloque
 * de texto vacío en medio de `content` simplemente no pinta nada, igual que
 * `PlayerScreen.tsx`).
 */
function renderNodeBodies(project: ProjectDocument): Record<string, string> {
  const bodyHtml: Record<string, string> = {}
  for (const node of project.graph.nodes) {
    if (node.type === 'intro') {
      // El nodo `intro` (portada) no tiene ningún texto enriquecido que
      // pre-renderizar: `caseName` es texto plano (viaja tal cual en el
      // `project` embebido) y `cicloId`/`asignaturaId` se resuelven aparte,
      // ver `resolveIntroCatalogNames`.
      continue
    }
    if (node.type === 'final') {
      if (!node.body.trim()) continue
      bodyHtml[node.id] = generateHTML(parseRichBody(node.body), RICH_TEXT_EXTENSIONS)
      continue
    }
    for (const block of node.content) {
      if (block.type !== 'text') continue
      if (!block.body.trim()) continue
      bodyHtml[block.id] = generateHTML(parseRichBody(block.body), RICH_TEXT_EXTENSIONS)
    }
  }
  return bodyHtml
}

/**
 * Resuelve `cicloId`/`asignaturaId` del nodo `intro` del proyecto (si existe
 * y están elegidos) a sus nombres legibles, vía el catálogo `CICLOS`
 * (`src/domain/catalog.ts`).
 *
 * Se resuelve AQUÍ, en tiempo de exportación (dentro de la app, con acceso
 * normal a un módulo TS), y no dentro de `exportedPlayerScript.ts`: ese
 * runtime es JS vanilla embebido en un único `<script>` clásico sin módulos
 * (ver cabecera de ese archivo) y no puede hacer `import` de `catalog.ts`;
 * la alternativa —serializar el catálogo entero (374 asignaturas) dentro de
 * CADA HTML/SCORM exportado solo para resolver dos ids— sería mucho más
 * pesado y frágil que resolverlos una única vez aquí y embeber ya el
 * resultado (dos strings, o `null`) en el JSON del bundle. `PlayerScreen.tsx`
 * (dentro de la app) no tiene esta restricción: importa `CICLOS` directamente
 * y resuelve en el momento de pintar.
 *
 * Tolerante, igual que `asignaturaBelongsToCiclo`
 * (`src/domain/introValidation.ts`): un id que ya no está en el catálogo, o
 * que aún no se ha elegido, resuelve a `null` sin lanzar — un proyecto puede
 * "probarse"/exportarse con la portada incompleta antes de que
 * `validateIntroForExport` bloquee la exportación real (ver
 * `useHtmlExport`/`useScormExport`).
 *
 * El nombre del ciclo se devuelve sin su prefijo interno de código
 * (`cicloOutputName`, p.ej. "AC - "/"ADAF - "): no significa nada para quien
 * hace el caso práctico, solo es útil dentro del espacio de trabajo (ver
 * ese comentario en `src/domain/catalog.ts`). El de la asignatura se
 * devuelve tal cual, sin su código de módulo — ese sí es exclusivo del
 * espacio de trabajo.
 */
function resolveIntroCatalogNames(project: ProjectDocument): {
  cicloName: string | null
  asignaturaName: string | null
} {
  const intro = project.graph.nodes.find((node) => node.type === 'intro')
  if (!intro) return { cicloName: null, asignaturaName: null }

  const ciclo = intro.cicloId ? CICLOS.find((candidate) => candidate.id === intro.cicloId) : undefined
  const asignatura =
    ciclo && intro.asignaturaId
      ? ciclo.asignaturas.find((candidate) => candidate.id === intro.asignaturaId)
      : undefined

  return {
    cicloName: ciclo ? cicloOutputName(ciclo.name) : null,
    asignaturaName: asignatura?.name ?? null,
  }
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
 *
 * `teacherReview` (opcional): presente ÚNICAMENTE cuando quien llama es
 * `buildTeacherReviewBundle` (`src/export/teacherReviewExport.ts`) — activa
 * el "modo revisión profes" embebiendo `reviewMode: true` y estos datos en
 * el bundle. El export HTML normal (`useHtmlExport`) y el SCORM
 * (`useScormExport`) no lo pasan nunca, así que su HTML generado no lleva
 * ni la bandera ni estos datos (ver `ExportBundle.reviewMode`/
 * `teacherReview` más arriba). Todo lo demás de esta función —
 * `bodyHtml`/`assetUris`/`texts`/nombres de portada/el propio wrapper
 * HTML— es exactamente lo mismo para los tres tipos de export: no hay
 * ninguna rama especial aquí más allá de esta única clave añadida al JSON
 * embebido.
 */
export function buildHtmlBundle(
  project: ProjectDocument,
  assets: ExportAssetMap,
  teacherReview?: TeacherReviewBundleOptions,
): string {
  const introNames = resolveIntroCatalogNames(project)
  const bundle: ExportBundle = {
    project: stripEditorOnlyFields(project),
    bodyHtml: renderNodeBodies(project),
    assetUris: buildAssetUris(assets),
    responseLetters: [...RESPONSE_LETTERS],
    texts: EXPORTED_TEXTS,
    introCicloName: introNames.cicloName,
    introAsignaturaName: introNames.asignaturaName,
    ...(teacherReview ? { reviewMode: true as const, teacherReview } : {}),
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
