import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useScriptExport } from '../useScriptExport'
import { AppServicesProvider } from '../../app/AppServicesContext'
import type { AppServices } from '../../app/AppServices'
import { MemoryHtmlBundleWriter } from '../../persistence'
import { resetProjectStore } from '../../store/testHelpers'

/**
 * Tests de `useScriptExport`: mismo patrón que `useHtmlExport.test.tsx`, pero
 * SIN el bloqueo por diapositiva de Inicio incompleta — la vista de guión es
 * un documento de revisión de contenido, debe poder generarse en cualquier
 * estado del proyecto (ver comentario de cabecera de `useScriptExport.ts`).
 */

function renderUseScriptExport(services: Partial<AppServices> = {}) {
  function wrapper({ children }: { children: ReactNode }) {
    return <AppServicesProvider services={services}>{children}</AppServicesProvider>
  }
  return renderHook(() => useScriptExport(), { wrapper })
}

beforeEach(() => {
  resetProjectStore()
})

describe('useScriptExport', () => {
  it('pide la ruta, genera el documento y lo escribe, incluso con la portada incompleta', async () => {
    const pickExportScriptPath = vi.fn(async () => '/tmp/guion.html')
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    const { result } = renderUseScriptExport({ pickExportScriptPath, htmlBundleWriter })

    await act(async () => {
      await result.current.exportScript()
    })

    expect(result.current.status).toBe('done')
    expect(result.current.message).toBe('Guión exportado.')
    expect(pickExportScriptPath).toHaveBeenCalledTimes(1)
    expect(htmlBundleWriter.writtenPaths()).toEqual(['/tmp/guion.html'])
    expect(htmlBundleWriter.read('/tmp/guion.html')).toContain('<!doctype html>')
  })

  it('cancelar el selector deja el estado en idle, sin mensaje ni escritura', async () => {
    const pickExportScriptPath = vi.fn(async () => null)
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    const { result } = renderUseScriptExport({ pickExportScriptPath, htmlBundleWriter })

    await act(async () => {
      await result.current.exportScript()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.message).toBeNull()
    expect(htmlBundleWriter.writtenPaths()).toEqual([])
  })

  it('un fallo al escribir termina en estado de error con un mensaje honesto', async () => {
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    htmlBundleWriter.failNextWrite()
    const { result } = renderUseScriptExport({
      pickExportScriptPath: async () => '/tmp/guion.html',
      htmlBundleWriter,
    })

    await act(async () => {
      await result.current.exportScript()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.message).toContain('No se ha podido exportar el guión')
  })
})
