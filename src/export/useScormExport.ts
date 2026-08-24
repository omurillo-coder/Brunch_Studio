import { useState } from 'react'
import { useAppServices } from '../app/AppServicesContext'
import { useProject } from '../store'
import { resolveExportAssets } from './exportAssets'
import { buildHtmlBundle } from './htmlBundle'
import { buildScormManifest } from './scormManifest'

/**
 * Orquestación del flujo "Exportar SCORM" (Milestone 3, fase 2):
 *
 *  1. Pide al usuario dónde guardar (diálogo nativo, `pickExportScormPath`).
 *  2. Lee los bytes de todos los assets referenciados (`resolveExportAssets`,
 *     el mismo paso 2 de "Exportar HTML").
 *  3. Genera el `index.html` autónomo (`buildHtmlBundle`, el mismo de la
 *     fase 1: el script exportado ya sabe hablar con la API SCORM por sí
 *     mismo, así que no hace falta una variante distinta) y el
 *     `imsmanifest.xml` (`buildScormManifest`).
 *  4. Los empaqueta en un `.zip` (`scormPackageWriter`, comando Rust).
 *
 * Mismo patrón que `useHtmlExport`: vive en su propio hook para no arrastrar
 * nada de la barra superior, y nunca lanza — cualquier fallo acaba en
 * `status: 'error'` con un mensaje honesto.
 */

export type ScormExportStatus = 'idle' | 'exporting' | 'done' | 'error'

export interface ScormExportState {
  status: ScormExportStatus
  /** Mensaje para el usuario (éxito, aviso o error); `null` si no hay nada
   *  que contar todavía. Sin jerga técnica, mismo criterio que `HomeScreen`. */
  message: string | null
  /** Lanza el flujo completo. Nunca lanza: los fallos acaban en `status`
   *  `'error'` con su `message`. */
  exportScorm: () => Promise<void>
}

/** Aviso honesto cuando la exportación se completó pero algún medio no se
 *  pudo incluir (ver criterio de `resolveExportAssets`). */
function incompleteAssetsMessage(failedCount: number): string {
  return failedCount === 1
    ? 'Paquete SCORM exportado, pero una imagen o audio no se ha podido incluir.'
    : `Paquete SCORM exportado, pero ${failedCount} imágenes o audios no se han podido incluir.`
}

export function useScormExport(filePath: string): ScormExportState {
  const project = useProject()
  const { pickExportScormPath, assetRepository, scormPackageWriter } = useAppServices()
  const [status, setStatus] = useState<ScormExportStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function exportScorm(): Promise<void> {
    setStatus('exporting')
    setMessage(null)
    try {
      const path = await pickExportScormPath(project.metadata.name)
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
      const html = buildHtmlBundle(project, assets)
      const manifest = buildScormManifest(project)
      await scormPackageWriter.writeScormPackage(path, html, manifest)

      setStatus('done')
      setMessage(
        failedAssetIds.length > 0
          ? incompleteAssetsMessage(failedAssetIds.length)
          : 'Paquete SCORM exportado.',
      )
    } catch {
      setStatus('error')
      setMessage(
        'No se ha podido exportar el paquete SCORM. Prueba con otra carpeta u otro nombre de archivo.',
      )
    }
  }

  return { status, message, exportScorm }
}
