import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useHtmlExport } from '../useHtmlExport'
import { AppServicesProvider } from '../../app/AppServicesContext'
import type { AppServices } from '../../app/AppServices'
import { MemoryAssetRepository, MemoryHtmlBundleWriter } from '../../persistence'
import { useProjectStore } from '../../store'
import { resetProjectStore, seedReachableFinal } from '../../store/testHelpers'
import { CICLOS } from '../../domain'

/**
 * Tests de `useHtmlExport` — Tarea 3 del milestone "Diapositiva de Inicio",
 * fase 3: bloquear la exportación ANTES de abrir el selector de guardado
 * cuando la diapositiva de Inicio (nodo `intro`) está incompleta
 * (`validateIntroForExport`, `src/domain/introValidation.ts`).
 *
 * `Topbar.test.tsx` ya cubre el flujo feliz completo (pedir ruta, generar,
 * escribir) a través de la UI; estos tests se centran en el propio hook y en
 * el caso nuevo: portada incompleta.
 */

/**
 * `useHtmlExport` resuelve los assets de marca de la portada
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

const TEST_FILE_PATH = '/tmp/use-html-export-test.brunch'

function renderUseHtmlExport(services: Partial<AppServices> = {}) {
  function wrapper({ children }: { children: ReactNode }) {
    return <AppServicesProvider services={services}>{children}</AppServicesProvider>
  }
  return renderHook(() => useHtmlExport(TEST_FILE_PATH), { wrapper })
}

/** Añade una portada (`intro`) completa —ciclo, asignatura coherente con ese
 *  ciclo y nombre de caso— al proyecto del store, y la conecta a un Final
 *  (`seedReachableFinal`, `src/store/testHelpers.ts`) — desde que
 *  `validateGraphForExport` bloquea también la exportación, no basta con
 *  completar la portada: el grafo en sí debe tener un Final alcanzable.
 *  Mismo criterio que `seedCompleteIntro` en
 *  `src/editor/Topbar/__tests__/Topbar.test.tsx`. */
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
  // El nodo `intro` recién creado pasa a ser `startNodeId` (ver
  // `IntroNodeSchema`): esto tiene que ir DESPUÉS de crearlo, para conectar
  // el Final al inicio real y no al que hubiera antes.
  act(() => {
    seedReachableFinal()
  })
}

function introNodeId(): string {
  const id = useProjectStore
    .getState()
    .project.graph.nodes.find((node) => node.type === 'intro')?.id
  if (!id) throw new Error('No hay ningún nodo "intro" en el proyecto de prueba')
  return id
}

beforeEach(() => {
  resetProjectStore()
})

describe('useHtmlExport — bloqueo con la diapositiva de Inicio incompleta', () => {
  it('sin ningún nodo intro, bloquea sin abrir el selector de guardado ni escribir nada', async () => {
    const pickExportHtmlPath = vi.fn(async () => '/tmp/experiencia.html')
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    const { result } = renderUseHtmlExport({
      pickExportHtmlPath,
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    await act(async () => {
      await result.current.exportHtml()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.message).toContain('El proyecto no tiene diapositiva de Inicio.')
    expect(pickExportHtmlPath).not.toHaveBeenCalled()
    expect(htmlBundleWriter.writtenPaths()).toEqual([])
  })

  it('con ciclo/asignatura/caseName vacíos, bloquea con un texto por cada dato que falta', async () => {
    act(() => {
      useProjectStore.getState().createNode('intro', { x: -300, y: 0 })
    })
    const pickExportHtmlPath = vi.fn(async () => '/tmp/experiencia.html')
    const { result } = renderUseHtmlExport({
      pickExportHtmlPath,
      htmlBundleWriter: new MemoryHtmlBundleWriter(),
      assetRepository: new MemoryAssetRepository(),
    })

    await act(async () => {
      await result.current.exportHtml()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.message).toContain('Elige un ciclo')
    expect(result.current.message).toContain('Elige una asignatura')
    expect(result.current.message).toContain('Escribe el nombre del caso práctico')
    expect(pickExportHtmlPath).not.toHaveBeenCalled()
  })

  it('con una asignatura que no pertenece al ciclo elegido, bloquea con ese mensaje concreto', async () => {
    act(() => {
      useProjectStore.getState().createNode('intro', { x: -300, y: 0 })
    })
    const ciclo = CICLOS[0]!
    const otroCiclo = CICLOS[1]
    if (!otroCiclo) throw new Error('El catálogo necesita al menos dos ciclos para este test')
    act(() => {
      useProjectStore.getState().updateNode(introNodeId(), {
        cicloId: ciclo.id,
        asignaturaId: otroCiclo.asignaturas[0]!.id, // de OTRO ciclo: incoherente
        caseName: 'Caso de prueba',
      })
    })
    const { result } = renderUseHtmlExport({
      pickExportHtmlPath: async () => '/tmp/experiencia.html',
      htmlBundleWriter: new MemoryHtmlBundleWriter(),
      assetRepository: new MemoryAssetRepository(),
    })

    await act(async () => {
      await result.current.exportHtml()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.message).toContain('La asignatura elegida no pertenece al ciclo elegido')
  })

  it('petición de usuario ("conecta validateProject al bloqueo de exportación"): con la portada completa pero SIN ningún Final alcanzable, bloquea sin abrir el selector de guardado', async () => {
    // Portada completa a mano (sin `seedCompleteIntro`, que además conecta
    // un Final vía `seedReachableFinal` — justo lo que este test necesita
    // NO tener): un `intro` con ciclo/asignatura/caseName válidos, pero sin
    // ningún destino conectado, así que el proyecto sigue sin ningún Final
    // alcanzable.
    act(() => {
      useProjectStore.getState().createNode('intro', { x: -300, y: 0 })
    })
    const introId = useProjectStore
      .getState()
      .project.graph.nodes.find((node) => node.type === 'intro')?.id
    if (!introId) throw new Error('setup inválido')
    const ciclo = CICLOS[0]!
    const asignatura = ciclo.asignaturas[0]!
    act(() => {
      useProjectStore.getState().updateNode(introId, {
        cicloId: ciclo.id,
        asignaturaId: asignatura.id,
        caseName: 'Caso de prueba',
      })
    })

    const pickExportHtmlPath = vi.fn(async () => '/tmp/experiencia.html')
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    const { result } = renderUseHtmlExport({
      pickExportHtmlPath,
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    await act(async () => {
      await result.current.exportHtml()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.message).toContain('el recorrido no puede terminar')
    expect(pickExportHtmlPath).not.toHaveBeenCalled()
    expect(htmlBundleWriter.writtenPaths()).toEqual([])
  })

  it('con la portada completa, exporta con normalidad (pide ruta, genera y escribe)', async () => {
    seedCompleteIntro()
    const pickExportHtmlPath = vi.fn(async () => '/tmp/experiencia.html')
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    const { result } = renderUseHtmlExport({
      pickExportHtmlPath,
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    await act(async () => {
      await result.current.exportHtml()
    })

    expect(result.current.status).toBe('done')
    expect(result.current.message).toBe('Experiencia exportada a HTML.')
    expect(pickExportHtmlPath).toHaveBeenCalledTimes(1)
    expect(htmlBundleWriter.writtenPaths()).toEqual(['/tmp/experiencia.html'])
  })

  /** Corrección de revisión de código: `setMessage(null)` seguido de
   *  `setMessage(blockingExportIssuesMessage(...))` en el mismo tick
   *  síncrono hacía que React agrupara ambas actualizaciones en un único
   *  render — `message` nunca llegaba a pintarse como `null` de verdad
   *  entre dos intentos de exportación bloqueados seguidos, así que
   *  `ExportToast` (que depende de ese desmontaje real para reiniciar su
   *  máquina de fases) podía quedarse mudo en el segundo intento. Este test
   *  comprueba, sin llegar a `ExportToast`, que el propio hook SÍ pasa por
   *  `message: null` de verdad antes de fijar el mensaje de bloqueo — ver
   *  `waitForRenderFlush`. */
  it('en un SEGUNDO intento bloqueado, el hook pasa por message: null de verdad antes de fijar el mensaje de bloqueo (para que ExportToast pueda desmontarse y remontarse)', async () => {
    const { result } = renderUseHtmlExport({
      pickExportHtmlPath: vi.fn(async () => '/tmp/experiencia.html'),
      htmlBundleWriter: new MemoryHtmlBundleWriter(),
      assetRepository: new MemoryAssetRepository(),
    })

    // Primer intento: bloqueado, deja `message` con texto (no null).
    await act(async () => {
      await result.current.exportHtml()
    })
    expect(result.current.message).toContain('El proyecto no tiene diapositiva de Inicio.')

    // Segundo intento, mismo bloqueo: sin `waitForRenderFlush`, `message`
    // pasaría directo del texto del primer intento al del segundo sin
    // ningún render intermedio con `null` — exactamente el bug que
    // `ExportToast` no puede detectar.
    let exportPromise!: Promise<void>
    act(() => {
      exportPromise = result.current.exportHtml()
    })
    await waitFor(() => expect(result.current.message).toBeNull())

    await act(async () => {
      await exportPromise
    })
    expect(result.current.status).toBe('error')
    expect(result.current.message).toContain('El proyecto no tiene diapositiva de Inicio.')
  })
})
