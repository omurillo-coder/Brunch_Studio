import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectNeedsGameOverAssets, resolvePlayerIntroBrandAssets } from '../introBrandAssets'
import { createProject } from '../../domain/project'
import { addGameOverPack } from '../../domain/nodePacks'

/**
 * Corrección de revisión de código: `resolvePlayerIntroBrandAssets` resolvía
 * SIEMPRE la ilustración de "Game Over", en cualquier exportación, aunque el
 * proyecto no usara el pack — un fallo de red al descargarla rompía la
 * exportación de proyectos sin ninguna relación con esa pantalla. Ahora la
 * resolución de ese asset concreto está condicionada a
 * `needsGameOverAssets`, calculado por `projectNeedsGameOverAssets`. Estos
 * tests cubren ambas piezas — sin ellos, un fallo al mantener esa condición
 * pasaría desapercibido en CI (ver comentario de la revisión: "no test
 * asserts gameOverBackgroundDataUri reaches the exported HTML").
 */

function stubFetch() {
  const fetchMock = vi.fn(async () =>
    new Response(new Uint8Array([137, 80, 78, 71]).buffer, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('projectNeedsGameOverAssets', () => {
  it('false para un proyecto sin ninguna diapositiva brandedGameOverScreen', () => {
    const project = createProject('P')
    expect(projectNeedsGameOverAssets(project)).toBe(false)
  })

  it('true para un proyecto con el pack "+1 fallo con Game Over"', () => {
    const project = addGameOverPack(createProject('P'), { x: 0, y: 0 })
    expect(projectNeedsGameOverAssets(project)).toBe(true)
  })
})

describe('resolvePlayerIntroBrandAssets', () => {
  it('needsGameOverAssets=false: NO resuelve la ilustración de Game Over (queda undefined) y no la pide por fetch', async () => {
    const fetchMock = stubFetch()

    const assets = await resolvePlayerIntroBrandAssets(false)

    expect(assets.gameOverBackgroundDataUri).toBeUndefined()
    expect(assets.logoDataUri).toMatch(/^data:image\/png;base64,/)
    expect(assets.backgroundDataUri).toMatch(/^data:image\/jpeg;base64,/)
    // Los 4 assets que SIEMPRE hacen falta (logo, fondo, 2 tipografías) —
    // ni uno más: la ilustración de Game Over no debe generar una 5ª
    // petición de red cuando no se necesita.
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('needsGameOverAssets=true: SÍ resuelve la ilustración de Game Over como data: URI', async () => {
    const fetchMock = stubFetch()

    const assets = await resolvePlayerIntroBrandAssets(true)

    expect(assets.gameOverBackgroundDataUri).toMatch(/^data:image\/jpeg;base64,/)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
})
