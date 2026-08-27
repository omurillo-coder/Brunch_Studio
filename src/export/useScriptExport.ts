import { useState } from 'react'
import { useAppServices } from '../app/AppServicesContext'
import { useProject } from '../store'
import { buildScriptDocument } from './scriptExport'

/**
 * Orquestación del flujo "Exportar guión": mismo patrón que
 * `useHtmlExport`/`useScormExport` (hook que arma el contenido, pide una ruta
 * con el selector nativo, y un writer que la escribe a disco), pero MÁS
 * simple en dos puntos deliberados:
 *
 *  - No bloquea si la diapositiva de Inicio está incompleta
 *    (`validateIntroForExport`): a diferencia del export interactivo (que
 *    alimenta un paquete SCORM con requisitos administrativos), este es un
 *    documento de revisión de contenido — debe poder generarse en cualquier
 *    estado del proyecto, mostrando "sin definir" donde falte algo (ver
 *    `buildScriptDocument`).
 *  - No necesita `resolveExportAssets`: los bloques de imagen/audio se listan
 *    como marcador de texto, nunca se incrustan (ver cabecera de
 *    `scriptExport.ts`), así que no hace falta leer bytes de ningún asset.
 *
 * Reutiliza `htmlBundleWriter`/el comando Tauri `export_html_bundle` para
 * escribir el archivo: ese comando ya es "escribe este string en esta ruta"
 * sin más, sin nada específico del export interactivo — ver
 * `src-tauri/src/persistence/export.rs`.
 */

export type ScriptExportStatus = 'idle' | 'exporting' | 'done' | 'error'

export interface ScriptExportState {
  status: ScriptExportStatus
  /** Mensaje para el usuario (éxito o error); `null` si no hay nada que
   *  contar todavía. Sin jerga técnica, mismo criterio que el resto de
   *  exports. */
  message: string | null
  /** Lanza el flujo completo. Nunca lanza: los fallos acaban en `status`
   *  `'error'` con su `message`. */
  exportScript: () => Promise<void>
}

export function useScriptExport(): ScriptExportState {
  const project = useProject()
  const { pickExportScriptPath, htmlBundleWriter } = useAppServices()
  const [status, setStatus] = useState<ScriptExportStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function exportScript(): Promise<void> {
    setStatus('exporting')
    setMessage(null)
    try {
      const path = await pickExportScriptPath(project.metadata.name)
      if (!path) {
        // Cancelado por el usuario: sin error visible y sin mensaje.
        setStatus('idle')
        return
      }

      const html = buildScriptDocument(project)
      await htmlBundleWriter.writeHtmlBundle(path, html)

      setStatus('done')
      setMessage('Guión exportado.')
    } catch {
      setStatus('error')
      setMessage(
        'No se ha podido exportar el guión. Prueba con otra carpeta u otro nombre de archivo.',
      )
    }
  }

  return { status, message, exportScript }
}
