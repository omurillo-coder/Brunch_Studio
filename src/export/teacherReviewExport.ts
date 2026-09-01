import type { ProjectDocument } from '../domain'
import type { ExportAssetMap } from './exportAssets'
import { buildHtmlBundle } from './htmlBundle'
import { resolvePlayerIntroBrandAssets } from './introBrandAssets'
/**
 * Ruta del archivo binario de la imagen de felicitación, resuelta a una URL
 * en tiempo de build/dev por Vite (sufijo `?url`) — mismo mecanismo que
 * `affUrl`/`dicUrl` en `src/domain/spellingDictionary.ts`. `fetch()` la
 * resuelve a bytes reales tanto en `npm run dev` como en un build empaquetado.
 */
import penguinUrl from '../assets/teacherReview/completion-penguin.png?url'

/**
 * ---------------------------------------------------------------------------
 * "Exportar revisión profes"
 * ---------------------------------------------------------------------------
 *
 * TERCER tipo de export (junto a "Exportar HTML" y "Exportar SCORM"), pensado
 * para que un profesor SIN el programa revise TODA la experiencia ramificada
 * (no solo un recorrido) y sepa qué pantallas ya ha visto.
 *
 * Es un `index.html` autónomo — nada de SCORM, nada de un `.zip` — así que
 * REUTILIZA `buildHtmlBundle` (`src/export/htmlBundle.ts`) tal cual, pasándole
 * el tercer parámetro opcional `teacherReview`: mismo motor de recorrido,
 * mismos `bodyHtml`/`assetUris`/`texts`/nombres de portada, mismo wrapper
 * HTML/CSS. Lo único propio de este archivo es:
 *
 *  1. Los dos textos fijos (bienvenida/felicitación) exactos de este modo.
 *  2. Resolver la imagen del pingüino de felicitación a `data:` URI EN TIEMPO
 *     DE EXPORTACIÓN (mismo patrón que `src/domain/spellingDictionary.ts`:
 *     referenciar el archivo binario por ruta con el sufijo `?url` de Vite y
 *     leerlo con `fetch()`, para no meter un string base64 enorme en el
 *     código fuente) — el runtime JS vanilla embebido
 *     (`exportedPlayerScript.ts`) no puede hacer ese `fetch` a un asset de la
 *     propia app, así que se resuelve aquí, igual que
 *     `resolveIntroCatalogNames` resuelve el catálogo de ciclos/asignaturas
 *     en tiempo de exportación en vez de en el script embebido.
 *
 * La capa de presentación del modo revisión (pantalla de bienvenida,
 * "Diapositiva {número}", indicador de progreso + lista de cobertura,
 * pantalla de felicitación) vive en `exportedPlayerScript.ts` — activada por
 * la bandera `reviewMode: true` que `buildHtmlBundle` añade al bundle cuando
 * se le pasa este tercer parámetro. Este archivo no pinta nada: solo produce
 * los datos y delega la generación del HTML.
 */

/**
 * Texto EXACTO de la pantalla de bienvenida (antes de la diapositiva de
 * Inicio real). Cada `\n` es un párrafo aparte en el HTML exportado (ver
 * `buildWelcomeCard` en `exportedPlayerScript.ts`) — se respetan los saltos
 * de línea tal cual se definieron, sin corregir ninguna palabra.
 */
export const TEACHER_REVIEW_WELCOME_TEXT =
  'Hola profe :)\n' +
  'Desde la Content hemos preparado este soporte para tu aula. Se trata de un caso practico interactivo con varios posibles caminos. Como no somos expertos nos iria muy bien que te mirases toda la experiencia y que nos digas que te parece. Te hemos dejado el nombre de las diapositivas para que en el excel de validaciones nos dejes los comentarios.\n' +
  'Muchas gracias!!!'

/** Texto EXACTO de la pantalla de felicitación al llegar al 100%. */
export const TEACHER_REVIEW_COMPLETION_TEXT =
  'Ya has revisado todo el caso práctico interactivo. Muchísimas gracias por el feedback!'

/** Convierte los bytes de un `ArrayBuffer` a base64, sin depender de Node
 *  (`Buffer` no existe en el webview de Tauri) — mismo entorno que el resto
 *  de `src/export`. `btoa` está disponible tanto en el navegador real como
 *  en jsdom (tests). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

/**
 * Lee la imagen de felicitación (`completion-penguin.png`) y la convierte a
 * `data:` URI. Se llama UNA vez por exportación, desde
 * `buildTeacherReviewBundle` — el HTML final no depende de ningún fichero
 * externo: la imagen queda embebida en el propio archivo, igual que los
 * assets del proyecto (`buildAssetUris` en `htmlBundle.ts`).
 */
export async function resolveCompletionPenguinDataUri(): Promise<string> {
  const response = await fetch(penguinUrl)
  if (!response.ok) {
    throw new Error('No se ha podido cargar la imagen de felicitación del modo revisión profes.')
  }
  const buffer = await response.arrayBuffer()
  return `data:image/png;base64,${arrayBufferToBase64(buffer)}`
}

/**
 * Construye el `index.html` autónomo de la "revisión profes" de `project`:
 * mismo documento HTML que `buildHtmlBundle`, con el modo revisión activado.
 *
 * A diferencia de `buildHtmlBundle` (síncrona, pura), esta función es
 * ASÍNCRONA porque necesita resolver primero la imagen del pingüino
 * (`resolveCompletionPenguinDataUri`) y los assets de marca de la portada
 * (`resolvePlayerIntroBrandAssets`, ver `introBrandAssets.ts` — los mismos
 * que resuelven `useHtmlExport`/`useScormExport`, este modo de exportación
 * no es una excepción); una vez resueltos, delega en `buildHtmlBundle` sin
 * ninguna lógica propia de generación de HTML.
 */
export async function buildTeacherReviewBundle(
  project: ProjectDocument,
  assets: ExportAssetMap,
): Promise<string> {
  const [penguinDataUri, introBrandAssets] = await Promise.all([
    resolveCompletionPenguinDataUri(),
    resolvePlayerIntroBrandAssets(),
  ])
  return buildHtmlBundle(
    project,
    assets,
    {
      welcomeText: TEACHER_REVIEW_WELCOME_TEXT,
      completionText: TEACHER_REVIEW_COMPLETION_TEXT,
      penguinDataUri,
    },
    introBrandAssets,
  )
}
