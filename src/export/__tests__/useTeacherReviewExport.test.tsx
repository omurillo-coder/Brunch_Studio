import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useTeacherReviewExport } from '../useTeacherReviewExport'
import { AppServicesProvider } from '../../app/AppServicesContext'
import type { AppServices } from '../../app/AppServices'
import { MemoryAssetRepository, MemoryHtmlBundleWriter } from '../../persistence'
import { useProjectStore } from '../../store'
import { resetProjectStore } from '../../store/testHelpers'
import { CICLOS } from '../../domain'

/**
 * Tests de `useTeacherReviewExport` — mismo patrón que
 * `useHtmlExport.test.tsx`/`useScormExport.test.tsx`: bloqueo con la
 * diapositiva de Inicio incompleta, y el flujo feliz completo (pedir ruta,
 * generar con `reviewMode` activo, escribir). `Topbar.test.tsx` cubre además
 * cancelar y fallo de escritura a través de la UI.
 */

const TEST_FILE_PATH = '/tmp/use-teacher-review-export-test.brunch'

vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    new Response(new Uint8Array([137, 80, 78, 71]).buffer, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  ),
)

function renderUseTeacherReviewExport(services: Partial<AppServices> = {}) {
  function wrapper({ children }: { children: ReactNode }) {
    return <AppServicesProvider services={services}>{children}</AppServicesProvider>
  }
  return renderHook(() => useTeacherReviewExport(TEST_FILE_PATH), { wrapper })
}

/** Mismo criterio que `seedCompleteIntro` en `useHtmlExport.test.tsx`. */
function seedCompleteIntro(): void {
  act(() => {
    useProjectStore.getState().createNode('intro', { x: -300, y: 0 })
  })
  const introId = useProjectStore
    .getState()
    .project.graph.nodes.find((node) => node.type === 'intro')?.id
  if (!introId) throw new Error('seedCompleteIntro: no se creó ningún nodo "intro"')

  const ciclo = CICLOS[0]!
  const asignatura = ciclo.asignaturas[0]!
  act(() => {
    useProjectStore.getState().updateNode(introId, {
      cicloId: ciclo.id,
      asignaturaId: asignatura.id,
      caseName: 'Caso de prueba',
    })
  })
}

beforeEach(() => {
  resetProjectStore()
})

describe('useTeacherReviewExport — bloqueo con la diapositiva de Inicio incompleta', () => {
  it('sin ningún nodo intro, bloquea sin abrir el selector de guardado ni escribir nada', async () => {
    const pickExportTeacherReviewPath = vi.fn(async () => '/tmp/revision.html')
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    const { result } = renderUseTeacherReviewExport({
      pickExportTeacherReviewPath,
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    await act(async () => {
      await result.current.exportTeacherReview()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.message).toContain('El proyecto no tiene diapositiva de Inicio.')
    expect(pickExportTeacherReviewPath).not.toHaveBeenCalled()
    expect(htmlBundleWriter.writtenPaths()).toEqual([])
  })
})

describe('useTeacherReviewExport — flujo feliz', () => {
  it('con la portada completa, pide ruta, genera con reviewMode y escribe', async () => {
    seedCompleteIntro()
    const pickExportTeacherReviewPath = vi.fn(async () => '/tmp/revision.html')
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    const { result } = renderUseTeacherReviewExport({
      pickExportTeacherReviewPath,
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    await act(async () => {
      await result.current.exportTeacherReview()
    })

    expect(result.current.status).toBe('done')
    expect(result.current.message).toBe('Revisión para profes exportada.')
    expect(pickExportTeacherReviewPath).toHaveBeenCalledTimes(1)
    expect(htmlBundleWriter.writtenPaths()).toEqual(['/tmp/revision.html'])
    expect(htmlBundleWriter.read('/tmp/revision.html')).toContain('"reviewMode":true')
  })

  it('cancelado por el usuario: vuelve a idle sin escribir nada', async () => {
    seedCompleteIntro()
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    const { result } = renderUseTeacherReviewExport({
      pickExportTeacherReviewPath: async () => null,
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    await act(async () => {
      await result.current.exportTeacherReview()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.message).toBeNull()
    expect(htmlBundleWriter.writtenPaths()).toEqual([])
  })

  it('un fallo de escritura acaba en status "error" con un mensaje honesto', async () => {
    seedCompleteIntro()
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    htmlBundleWriter.failNextWrite()
    const { result } = renderUseTeacherReviewExport({
      pickExportTeacherReviewPath: async () => '/tmp/revision.html',
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    await act(async () => {
      await result.current.exportTeacherReview()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.message).toBe(
      'No se ha podido exportar la revisión para profes. Prueba con otra carpeta u otro nombre de archivo.',
    )
  })
})
