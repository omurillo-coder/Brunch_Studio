/**
 * Assets de marca de la portada iLERNA ("¿Qué harías tú?", ver `IntroCard`
 * en `src/player/PlayerScreen.tsx`), resueltos a `data:` URI EN TIEMPO DE
 * EXPORTACIÓN — mismo patrón que `resolveCompletionPenguinDataUri` en
 * `src/export/teacherReviewExport.ts` y que `spellingDictionary.ts`:
 * referenciar el archivo binario por ruta con el sufijo `?url` de Vite y
 * leerlo con `fetch()`, para que el HTML exportado sea 100% autónomo (cero
 * peticiones de red) sin meter strings base64 enormes directamente en el
 * código fuente.
 *
 * A diferencia del pingüino de "revisión profes" (exclusivo de ese modo),
 * estos assets los necesitan LOS TRES tipos de exportación (HTML/SCORM/
 * revisión profes) — cada uno de sus hooks (`useHtmlExport`/
 * `useScormExport`/`teacherReviewExport`) llama a
 * `resolvePlayerIntroBrandAssets` y pasa el resultado a `buildHtmlBundle`.
 */

import logoUrl from '../assets/playerIntro/ilerna-logo.png?url'
import backgroundUrl from '../assets/playerIntro/fondo-inicio.jpg?url'
import fontRegularUrl from '../assets/playerIntro/fonts/FSMillbank-Regular.otf?url'
import fontBoldUrl from '../assets/playerIntro/fonts/FSMillbank-Bold.otf?url'

export interface PlayerIntroBrandAssets {
  logoDataUri: string
  backgroundDataUri: string
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
 * Resuelve los cuatro assets de marca de la portada (logo, ilustración de
 * fondo, y las dos tipografías FS Millbank usadas — Regular/Bold, ver
 * comentario de encargo del resto de pesos en
 * `src/assets/playerIntro/fonts/`) a `data:` URI. Se llama UNA vez por
 * exportación, antes de `buildHtmlBundle`.
 */
export async function resolvePlayerIntroBrandAssets(): Promise<PlayerIntroBrandAssets> {
  const [logoDataUri, backgroundDataUri, fontRegularDataUri, fontBoldDataUri] = await Promise.all([
    resolveDataUri(logoUrl, 'image/png', 'el logo'),
    resolveDataUri(backgroundUrl, 'image/jpeg', 'la ilustración de fondo'),
    resolveDataUri(fontRegularUrl, 'font/otf', 'la tipografía (Regular)'),
    resolveDataUri(fontBoldUrl, 'font/otf', 'la tipografía (Bold)'),
  ])
  return { logoDataUri, backgroundDataUri, fontRegularDataUri, fontBoldDataUri }
}
