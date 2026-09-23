import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useAiReviewExport } from '../useAiReviewExport'
import { AppServicesProvider } from '../../app/AppServicesContext'
import type { AppServices } from '../../app/AppServices'
import { MemoryTextDocumentWriter } from '../../persistence'
import { useProjectStore } from '../../store'
import { resetProjectStore } from '../../store/testHelpers'

/**
 * Hallazgo de auditoría ("useAiReviewExport.ts es el único de los 4 hooks de
 * exportación sin test unitario propio"): `useHtmlExport`/`useScormExport`/
 * `useTeacherReviewExport` tienen cada uno su suite dedicada; este solo se
 * ejercitaba indirectamente vía `Topbar.test.tsx` (que sigue cubriendo el
 * flujo feliz completo a través de la UI — no se duplica aquí). Mismo
 * criterio/estructura que `useScormExport.test.tsx`: `renderHook` +
 * `AppServicesProvider` con dobles en memoria, sin pasar por ningún
 * componente de UI.
 *
 * A diferencia de los otros tres, `useAiReviewExport` NO bloquea con
 * `validateIntroForExport` (petición de usuario: "que este archivo lo
 * pudiese ver ChatGPT... para que le dé opinión" — útil incluso sobre un
 * proyecto a medias), así que no hace falta ningún `seedCompleteIntro`.
 */

function renderUseAiReviewExport(services: Partial<AppServices> = {}) {
  function wrapper({ children }: { children: ReactNode }) {
    return <AppServicesProvider services={services}>{children}</AppServicesProvider>
  }
  return renderHook(() => useAiReviewExport(), { wrapper })
}

beforeEach(() => {
  resetProjectStore()
})

describe('useAiReviewExport', () => {
  it('empieza en `idle`, sin mensaje', () => {
    const { result } = renderUseAiReviewExport()

    expect(result.current.status).toBe('idle')
    expect(result.current.message).toBeNull()
  })

  it('con la portada incompleta (proyecto "de fábrica"), exporta igualmente: pide la ruta, genera el documento y lo escribe', async () => {
    const textDocumentWriter = new MemoryTextDocumentWriter()
    const pickExportAiReviewPath = vi.fn(async () => '/tmp/revision-ia.md')
    const { result } = renderUseAiReviewExport({ pickExportAiReviewPath, textDocumentWriter })

    await act(async () => {
      await result.current.exportAiReview()
    })

    expect(result.current.status).toBe('done')
    expect(result.current.message).toBe('Documento para revisión con IA exportado.')
    expect(pickExportAiReviewPath).toHaveBeenCalledWith(useProjectStore.getState().project.metadata.name)
    expect(textDocumentWriter.writtenPaths()).toEqual(['/tmp/revision-ia.md'])
    expect(textDocumentWriter.read('/tmp/revision-ia.md')).toContain('— Documento para revisión con IA')
  })

  it('si el usuario cancela el diálogo de guardado, vuelve a `idle` sin escribir nada ni mostrar mensaje', async () => {
    const textDocumentWriter = new MemoryTextDocumentWriter()
    const pickExportAiReviewPath = vi.fn(async () => null)
    const { result } = renderUseAiReviewExport({ pickExportAiReviewPath, textDocumentWriter })

    await act(async () => {
      await result.current.exportAiReview()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.message).toBeNull()
    expect(textDocumentWriter.writtenPaths()).toEqual([])
  })

  it('si la escritura falla, pasa a `error` con un mensaje honesto y sin jerga técnica', async () => {
    const textDocumentWriter = new MemoryTextDocumentWriter()
    textDocumentWriter.failNextWrite()
    const { result } = renderUseAiReviewExport({
      pickExportAiReviewPath: async () => '/tmp/revision-ia.md',
      textDocumentWriter,
    })

    await act(async () => {
      await result.current.exportAiReview()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.message).toBe(
      'No se ha podido exportar el documento. Prueba con otra carpeta u otro nombre de archivo.',
    )
    expect(textDocumentWriter.writtenPaths()).toEqual([])
  })

  it('mientras exporta, el estado pasa por `exporting` antes de asentarse en `done`', async () => {
    const textDocumentWriter = new MemoryTextDocumentWriter()
    let resolvePick: (path: string | null) => void = () => {}
    const pickExportAiReviewPath = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          resolvePick = resolve
        }),
    )
    const { result } = renderUseAiReviewExport({ pickExportAiReviewPath, textDocumentWriter })

    let exportPromise!: Promise<void>
    act(() => {
      exportPromise = result.current.exportAiReview()
    })

    await waitFor(() => {
      expect(result.current.status).toBe('exporting')
    })

    await act(async () => {
      resolvePick('/tmp/revision-ia.md')
      await exportPromise
    })

    expect(result.current.status).toBe('done')
  })

  it('un nuevo intento limpia el `message` de un intento anterior antes de asentarse', async () => {
    const textDocumentWriter = new MemoryTextDocumentWriter()
    textDocumentWriter.failNextWrite()
    const { result } = renderUseAiReviewExport({
      pickExportAiReviewPath: async () => '/tmp/revision-ia.md',
      textDocumentWriter,
    })

    await act(async () => {
      await result.current.exportAiReview()
    })
    expect(result.current.status).toBe('error')

    await act(async () => {
      await result.current.exportAiReview()
    })

    expect(result.current.status).toBe('done')
    expect(result.current.message).toBe('Documento para revisión con IA exportado.')
  })
})
