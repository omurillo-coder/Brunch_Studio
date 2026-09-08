import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useScormExport } from '../useScormExport'
import { AppServicesProvider } from '../../app/AppServicesContext'
import type { AppServices } from '../../app/AppServices'
import { MemoryAssetRepository, MemoryScormPackageWriter } from '../../persistence'
import { useProjectStore } from '../../store'
import { resetProjectStore, seedReachableFinal } from '../../store/testHelpers'
import { CICLOS } from '../../domain'

/**
 * Tests de `useScormExport` — mismo criterio de bloqueo que
 * `useHtmlExport.test.tsx` (Tarea 3 del milestone "Diapositiva de Inicio",
 * fase 3): `validateIntroForExport` ANTES de abrir el selector de guardado.
 * `Topbar.test.tsx` cubre el flujo feliz completo a través de la UI.
 */

/**
 * `useScormExport` resuelve los assets de marca de la portada
 * (`resolvePlayerIntroBrandAssets` en `introBrandAssets.ts`) con `fetch()`
 * sobre las URLs que resuelve Vite para el logo/ilustración/tipografía
 * (sufijo `?url`) — en jsdom no hay ningún servidor real detrás, así que se
 * mockea `fetch` globalmente, mismo criterio que `Topbar.test.tsx`.
 */
vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    new Response(new Uint8Array([137, 80, 78, 71]).buffer, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  ),
)

const TEST_FILE_PATH = '/tmp/use-scorm-export-test.brunch'

function renderUseScormExport(services: Partial<AppServices> = {}) {
  function wrapper({ children }: { children: ReactNode }) {
    return <AppServicesProvider services={services}>{children}</AppServicesProvider>
  }
  return renderHook(() => useScormExport(TEST_FILE_PATH), { wrapper })
}

/** Mismo criterio que `useHtmlExport.test.tsx`/`Topbar.test.tsx`: completa
 *  la portada Y conecta un Final (`seedReachableFinal`), ambos requisitos
 *  de `validateGraphForExport`/`validateIntroForExport`. */
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
  act(() => {
    seedReachableFinal()
  })
}

beforeEach(() => {
  resetProjectStore()
})

describe('useScormExport — bloqueo con la diapositiva de Inicio incompleta', () => {
  it('sin ningún nodo intro, bloquea sin abrir el selector de guardado ni empaquetar nada', async () => {
    const pickExportScormPath = vi.fn(async () => '/tmp/experiencia.zip')
    const scormPackageWriter = new MemoryScormPackageWriter()
    const { result } = renderUseScormExport({
      pickExportScormPath,
      scormPackageWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    await act(async () => {
      await result.current.exportScorm()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.message).toContain('El proyecto no tiene diapositiva de Inicio.')
    expect(pickExportScormPath).not.toHaveBeenCalled()
    expect(scormPackageWriter.writtenPaths()).toEqual([])
  })

  it('con ciclo/asignatura/caseName vacíos, bloquea con un texto por cada dato que falta', async () => {
    act(() => {
      useProjectStore.getState().createNode('intro', { x: -300, y: 0 })
    })
    const pickExportScormPath = vi.fn(async () => '/tmp/experiencia.zip')
    const { result } = renderUseScormExport({
      pickExportScormPath,
      scormPackageWriter: new MemoryScormPackageWriter(),
      assetRepository: new MemoryAssetRepository(),
    })

    await act(async () => {
      await result.current.exportScorm()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.message).toContain('Elige un ciclo')
    expect(result.current.message).toContain('Elige una asignatura')
    expect(result.current.message).toContain('Escribe el nombre del caso práctico')
    expect(pickExportScormPath).not.toHaveBeenCalled()
  })

  it('con la portada completa, exporta con normalidad (pide ruta, genera y empaqueta)', async () => {
    seedCompleteIntro()
    const pickExportScormPath = vi.fn(async () => '/tmp/experiencia.zip')
    const scormPackageWriter = new MemoryScormPackageWriter()
    const { result } = renderUseScormExport({
      pickExportScormPath,
      scormPackageWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    await act(async () => {
      await result.current.exportScorm()
    })

    expect(result.current.status).toBe('done')
    expect(result.current.message).toBe('Paquete SCORM exportado.')
    expect(pickExportScormPath).toHaveBeenCalledTimes(1)
    expect(scormPackageWriter.writtenPaths()).toEqual(['/tmp/experiencia.zip'])
  })
})
