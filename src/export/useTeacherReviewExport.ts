import { useState } from 'react'
import { useAppServices } from '../app/AppServicesContext'
import { useProject } from '../store'
import { validateIntroForExport, validatePendingContentForExport } from '../domain'
import { resolveExportAssets } from './exportAssets'
import { buildTeacherReviewBundle } from './teacherReviewExport'
import { waitForRenderFlush } from './waitForRenderFlush'

/**
 * Orquestación del flujo "Exportar revisión profes" — MISMO patrón que
 * `useHtmlExport`/`useScormExport`:
 *
 *  1. Bloquea si la diapositiva de Inicio está incompleta
 *     (`validateIntroForExport`, igual criterio que los otros dos exports).
 *  2. Pide al usuario dónde guardar (diálogo nativo, `pickExportTeacherReviewPath`).
 *  3. Lee los bytes de todos los assets referenciados (`resolveExportAssets`,
 *     el mismo paso 2 de "Exportar HTML"/"Exportar SCORM").
 *  4. Genera el `index.html` autónomo con el modo revisión activado
 *     (`buildTeacherReviewBundle`, `src/export/teacherReviewExport.ts`).
 *  5. Lo escribe en disco con `htmlBundleWriter` — el MISMO escritor que ya
 *     usa "Exportar HTML" (comando Rust genérico "escribe este string en esta
 *     ruta", sin lógica propia de ningún tipo de export): este export
 *     produce un `.html` autónomo igual que el normal, así que no hace falta
 *     ningún escritor ni comando Rust nuevo.
 */

export type TeacherReviewExportStatus = 'idle' | 'exporting' | 'done' | 'error'

export interface TeacherReviewExportState {
  status: TeacherReviewExportStatus
  /** Mensaje para el usuario (éxito, aviso o error); `null` si no hay nada
   *  que contar todavía. Sin jerga técnica, mismo criterio que
   *  `useHtmlExport`/`useScormExport`. */
  message: string | null
  /** Lanza el flujo completo. Nunca lanza: los fallos acaban en `status`
   *  `'error'` con su `message`. */
  exportTeacherReview: () => Promise<void>
}

/** Aviso honesto cuando la exportación se completó pero algún medio no se
 *  pudo incluir (ver criterio de `resolveExportAssets`). */
function incompleteAssetsMessage(failedCount: number): string {
  return failedCount === 1
    ? 'Revisión para profes exportada, pero una imagen o audio no se ha podido incluir.'
    : `Revisión para profes exportada, pero ${failedCount} imágenes o audios no se han podido incluir.`
}

/** Mismo criterio que `useHtmlExport`/`useScormExport`: une los textos de
 *  `validateIntroForExport`/`validatePendingContentForExport` en una sola
 *  línea legible, reutilizando el mismo campo `message`/`status: 'error'`
 *  que `Topbar.tsx` ya pinta sin ningún cambio. */
function blockingExportIssuesMessage(issues: string[]): string {
  return `No se puede exportar: ${issues.join('; ')}.`
}

export function useTeacherReviewExport(filePath: string): TeacherReviewExportState {
  const project = useProject()
  const { pickExportTeacherReviewPath, assetRepository, htmlBundleWriter } = useAppServices()
  const [status, setStatus] = useState<TeacherReviewExportStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function exportTeacherReview(): Promise<void> {
    setStatus('exporting')
    setMessage(null)
    try {
      // Bloquea ANTES de abrir el selector de guardado (y de leer assets o
      // generar nada), igual criterio que "Exportar HTML"/"Exportar SCORM".
      const blockingIssues = [
        ...validateIntroForExport(project),
        ...validatePendingContentForExport(project),
      ]
      if (blockingIssues.length > 0) {
        // Corrección de revisión de código: ver comentario de
        // `waitForRenderFlush` (mismo motivo que `useHtmlExport`).
        await waitForRenderFlush()
        setStatus('error')
        setMessage(blockingExportIssuesMessage(blockingIssues))
        return
      }

      const path = await pickExportTeacherReviewPath(project.metadata.name)
      if (!path) {
        // Cancelado por el usuario: sin error visible y sin mensaje.
        setStatus('idle')
        return
      }

      const { assets, failedAssetIds } = await resolveExportAssets(
        filePath,
        project,
        assetRepository,
      )
      const html = await buildTeacherReviewBundle(project, assets)
      await htmlBundleWriter.writeHtmlBundle(path, html)

      setStatus('done')
      setMessage(
        failedAssetIds.length > 0
          ? incompleteAssetsMessage(failedAssetIds.length)
          : 'Revisión para profes exportada.',
      )
    } catch {
      setStatus('error')
      setMessage(
        'No se ha podido exportar la revisión para profes. Prueba con otra carpeta u otro nombre de archivo.',
      )
    }
  }

  return { status, message, exportTeacherReview }
}
