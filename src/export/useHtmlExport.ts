import { useState } from 'react'
import { useAppServices } from '../app/AppServicesContext'
import { useProject } from '../store'
import { validateIntroForExport, validatePendingContentForExport } from '../domain'
import { resolveExportAssets } from './exportAssets'
import { buildHtmlBundle } from './htmlBundle'
import { projectNeedsGameOverAssets, resolvePlayerIntroBrandAssets } from './introBrandAssets'

/**
 * Orquestación del flujo "Exportar HTML" (Milestone 3, fase 1):
 *
 *  1. Pide al usuario dónde guardar (diálogo nativo, `pickExportHtmlPath`).
 *  2. Lee los bytes de todos los assets referenciados (`resolveExportAssets`).
 *  3. Genera el `index.html` autónomo (`buildHtmlBundle`, función pura).
 *  4. Lo escribe en disco (`htmlBundleWriter`, comando Rust).
 *
 * Vive en un hook y no dentro de `Topbar` para que el mismo flujo se pueda
 * reutilizar desde otro punto de entrada (y para que la fase de SCORM pueda
 * apoyarse en los pasos 2 y 3 sin arrastrar nada de la barra superior).
 */

export type HtmlExportStatus = 'idle' | 'exporting' | 'done' | 'error'

export interface HtmlExportState {
  status: HtmlExportStatus
  /** Mensaje para el usuario (éxito, aviso o error); `null` si no hay nada
   *  que contar todavía. Sin jerga técnica, mismo criterio que `HomeScreen`. */
  message: string | null
  /** Lanza el flujo completo. Nunca lanza: los fallos acaban en `status`
   *  `'error'` con su `message`. */
  exportHtml: () => Promise<void>
}

/** Aviso honesto cuando la exportación se completó pero algún medio no se
 *  pudo incluir (ver criterio de `resolveExportAssets`). */
function incompleteAssetsMessage(failedCount: number): string {
  return failedCount === 1
    ? 'Experiencia exportada, pero una imagen o audio no se ha podido incluir.'
    : `Experiencia exportada, pero ${failedCount} imágenes o audios no se han podido incluir.`
}

/**
 * Mensaje de bloqueo cuando el proyecto no está listo para exportar: une en
 * una sola línea legible los textos que devuelven `validateIntroForExport`
 * (portada incompleta) y `validatePendingContentForExport` (bloques de
 * imagen "pendientes de subir", milestone "+1 fallo con Game Over"), uno por
 * cada problema encontrado. Reutiliza el MISMO campo `message` que ya usa
 * este hook para el resto de errores (`status: 'error'`) — `Topbar.tsx` ya lo
 * pinta con `role="alert"` sin ningún cambio, así que no hace falta ningún
 * mecanismo nuevo.
 */
function blockingExportIssuesMessage(issues: string[]): string {
  return `No se puede exportar: ${issues.join('; ')}.`
}

export function useHtmlExport(filePath: string): HtmlExportState {
  const project = useProject()
  const { pickExportHtmlPath, assetRepository, htmlBundleWriter } = useAppServices()
  const [status, setStatus] = useState<HtmlExportStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function exportHtml(): Promise<void> {
    setStatus('exporting')
    setMessage(null)
    try {
      // Bloquea ANTES de abrir el selector de guardado (y de leer assets o
      // generar nada): una portada incompleta, o un bloque de imagen
      // pendiente de subir, no debe llegar a producir ningún archivo.
      const blockingIssues = [
        ...validateIntroForExport(project),
        ...validatePendingContentForExport(project),
      ]
      if (blockingIssues.length > 0) {
        setStatus('error')
        setMessage(blockingExportIssuesMessage(blockingIssues))
        return
      }

      const path = await pickExportHtmlPath(project.metadata.name)
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
      const introBrandAssets = await resolvePlayerIntroBrandAssets(projectNeedsGameOverAssets(project))
      const html = buildHtmlBundle(project, assets, undefined, introBrandAssets)
      await htmlBundleWriter.writeHtmlBundle(path, html)

      setStatus('done')
      setMessage(
        failedAssetIds.length > 0
          ? incompleteAssetsMessage(failedAssetIds.length)
          : 'Experiencia exportada a HTML.',
      )
    } catch {
      setStatus('error')
      setMessage(
        'No se ha podido exportar la experiencia. Prueba con otra carpeta u otro nombre de archivo.',
      )
    }
  }

  return { status, message, exportHtml }
}
