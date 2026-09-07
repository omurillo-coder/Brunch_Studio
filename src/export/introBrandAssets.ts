/**
 * Assets de marca de las pantallas bespoke del Player — la portada iLERNA
 * ("¿Qué harías tú?", ver `IntroCard` en `src/player/PlayerScreen.tsx`) Y,
 * desde el milestone "+1 fallo con Game Over", la pantalla "Game Over"
 * (`GameOverCard`, `brandedGameOverScreen`) — resueltos a `data:` URI EN
 * TIEMPO DE EXPORTACIÓN — mismo patrón que `resolveCompletionPenguinDataUri`
 * en `src/export/teacherReviewExport.ts` y que `spellingDictionary.ts`:
 * referenciar el archivo binario por ruta con el sufijo `?url` de Vite y
 * leerlo con `fetch()`, para que el HTML exportado sea 100% autónomo (cero
 * peticiones de red) sin meter strings base64 enormes directamente en el
 * código fuente. El nombre del módulo/función/interfaz sigue hablando de
 * "intro" por no arriesgar una renombrada que toque ocho archivos sin
 * necesidad real (ver decisión documentada en el PR de esta pantalla) — el
 * campo `gameOverBackgroundDataUri` conviene con esa realidad sin romper
 * nada.
 *
 * A diferencia del pingüino de "revisión profes" (exclusivo de ese modo),
 * estos assets los necesitan LOS TRES tipos de exportación (HTML/SCORM/
 * revisión profes) — cada uno de sus hooks (`useHtmlExport`/
 * `useScormExport`/`teacherReviewExport`) llama a
 * `resolvePlayerIntroBrandAssets` y pasa el resultado a `buildHtmlBundle`.
 */

import logoUrl from '../assets/playerIntro/ilerna-logo.png?url'
import backgroundUrl from '../assets/playerIntro/fondo-inicio.jpg?url'
import gameOverBackgroundUrl from '../assets/playerIntro/game-over.jpg?url'
import fontRegularUrl from '../assets/playerIntro/fonts/FSMillbank-Regular.otf?url'
import fontBoldUrl from '../assets/playerIntro/fonts/FSMillbank-Bold.otf?url'
import type { ProjectDocument } from '../domain'

/**
 * ¿Tiene `project` alguna diapositiva "Game Over" (`brandedGameOverScreen`)?
 * Calculado UNA vez por cada uno de los 3 hooks de exportación y pasado como
 * `needsGameOverAssets` a `resolvePlayerIntroBrandAssets` — ver el
 * comentario de esa función para el motivo (no depender de este asset en
 * proyectos que no usan el pack).
 */
export function projectNeedsGameOverAssets(project: ProjectDocument): boolean {
  return project.graph.nodes.some((node) => node.type === 'slide' && node.brandedGameOverScreen)
}

export interface PlayerIntroBrandAssets {
  logoDataUri: string
  backgroundDataUri: string
  /** Ilustración de fondo de la pantalla bespoke "Game Over"
   *  (`brandedGameOverScreen`, ver `GameOverCard` en
   *  `src/player/PlayerScreen.tsx` y `buildGameOverCard` en
   *  `exportedPlayerScript.ts`) — mismo patrón que `backgroundDataUri`
   *  (portada iLERNA), assets distintos para pantallas distintas.
   *
   *  OPCIONAL (a diferencia de `backgroundDataUri`, que TODO proyecto
   *  necesita porque la portada es obligatoria): corrección de revisión de
   *  código — antes se resolvía sin condición en CUALQUIER exportación, así
   *  que un fallo al descargarla rompía la exportación de proyectos que ni
   *  siquiera usan el pack "+1 fallo con Game Over". Ahora
   *  `resolvePlayerIntroBrandAssets` solo la resuelve cuando
   *  `needsGameOverAssets` lo pide (ver ese parámetro), y queda `undefined`
   *  en cualquier otro caso — `buildGameOverCard`
   *  (`exportedPlayerScript.ts`) ya sabía degradar sin ella (comprueba
   *  `introBrand.gameOverBackgroundDataUri` antes de usarla). */
  gameOverBackgroundDataUri?: string
  fontRegularDataUri: string
  fontBoldDataUri: string
}

/** Mismo helper que `teacherReviewExport.ts` (sin depender de `Buffer`, que
 *  no existe en el webview de Tauri). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

async function resolveDataUri(url: string, mimeType: string, label: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`No se ha podido cargar ${label} de la portada.`)
  }
  const buffer = await response.arrayBuffer()
  return `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`
}

/**
 * Resuelve los assets de marca de la portada — logo, ilustración de fondo, y
 * las dos tipografías FS Millbank usadas (Regular/Bold, ver comentario de
 * encargo del resto de pesos en `src/assets/playerIntro/fonts/`) — a `data:`
 * URI, siempre. Se llama UNA vez por exportación, antes de `buildHtmlBundle`.
 *
 * `needsGameOverAssets`: el llamador lo calcula a partir del PROYECTO que se
 * está exportando (`project.graph.nodes.some(n => n.type === 'slide' &&
 * n.brandedGameOverScreen)`) — corrección de revisión de código: antes la
 * ilustración de "Game Over" se resolvía sin condición para cualquier
 * exportación, así que (a) todo proyecto pagaba ~46KB de base64 por una
 * imagen que la mayoría nunca muestra, y (b) un fallo de red al
 * descargarla rompía la exportación de proyectos que ni siquiera usan el
 * pack. Ahora solo se resuelve — y solo puede fallar la exportación — para
 * los proyectos que de verdad la necesitan, igual que el pingüino de
 * "revisión profes" en `teacherReviewExport.ts` solo se resuelve en ESE
 * flujo de exportación.
 */
export async function resolvePlayerIntroBrandAssets(
  needsGameOverAssets: boolean,
): Promise<PlayerIntroBrandAssets> {
  const [logoDataUri, backgroundDataUri, gameOverBackgroundDataUri, fontRegularDataUri, fontBoldDataUri] =
    await Promise.all([
      resolveDataUri(logoUrl, 'image/png', 'el logo'),
      resolveDataUri(backgroundUrl, 'image/jpeg', 'la ilustración de fondo'),
      needsGameOverAssets
        ? resolveDataUri(gameOverBackgroundUrl, 'image/jpeg', 'la ilustración de Game Over')
        : Promise.resolve(undefined),
      resolveDataUri(fontRegularUrl, 'font/otf', 'la tipografía (Regular)'),
      resolveDataUri(fontBoldUrl, 'font/otf', 'la tipografía (Bold)'),
    ])
  return { logoDataUri, backgroundDataUri, gameOverBackgroundDataUri, fontRegularDataUri, fontBoldDataUri }
}
