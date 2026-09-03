import { useState } from 'react'
import { useAppServices } from '../app/AppServicesContext'
import { useProject } from '../store'
import { buildAiReviewDocument } from './aiReviewExport'

/**
 * Orquestación del flujo "Exportar para revisión con IA" (petición de
 * usuario: "que este archivo lo pudiese ver ChatGPT o alguna otra IA...
 * para que le dé opinión"): mismo patrón que `useHtmlExport`, mucho más
 * corto porque no hay ningún asset que resolver ni portada que validar —
 * `buildAiReviewDocument` (función pura) ya sabe describir un proyecto
 * incompleto sin lanzar (a diferencia del HTML/SCORM, este documento no
 * tiene ningún requisito técnico que cumplir: es útil pedir opinión sobre
 * una narrativa a medias tanto como sobre una terminada).
 *
 *  1. Pide al usuario dónde guardar (diálogo nativo, `pickExportAiReviewPath`).
 *  2. Genera el documento (`buildAiReviewDocument`, función pura).
 *  3. Lo escribe en disco (`textDocumentWriter`).
 */

export type AiReviewExportStatus = 'idle' | 'exporting' | 'done' | 'error'

export interface AiReviewExportState {
  status: AiReviewExportStatus
  /** Mensaje para el usuario (éxito o error); `null` si no hay nada que
   *  contar todavía. Sin jerga técnica, mismo criterio que `useHtmlExport`. */
  message: string | null
  /** Lanza el flujo completo. Nunca lanza: los fallos acaban en `status`
   *  `'error'` con su `message`. */
  exportAiReview: () => Promise<void>
}

export function useAiReviewExport(): AiReviewExportState {
  const project = useProject()
  const { pickExportAiReviewPath, textDocumentWriter } = useAppServices()
  const [status, setStatus] = useState<AiReviewExportStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function exportAiReview(): Promise<void> {
    setStatus('exporting')
    setMessage(null)
    try {
      const path = await pickExportAiReviewPath(project.metadata.name)
      if (!path) {
        // Cancelado por el usuario: sin error visible y sin mensaje.
        setStatus('idle')
        return
      }

      const document = buildAiReviewDocument(project)
      await textDocumentWriter.writeTextDocument(path, document)

      setStatus('done')
      setMessage('Documento para revisión con IA exportado.')
    } catch {
      setStatus('error')
      setMessage(
        'No se ha podido exportar el documento. Prueba con otra carpeta u otro nombre de archivo.',
      )
    }
  }

  return { status, message, exportAiReview }
}
