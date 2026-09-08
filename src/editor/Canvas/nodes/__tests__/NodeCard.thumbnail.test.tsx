import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Canvas } from '../../Canvas'
import { useProjectStore } from '../../../../store'
import { resetProjectStore } from '../../../../store/testHelpers'
import { AppServicesProvider } from '../../../../app/AppServicesContext'
import type { AppServices } from '../../../../app/AppServices'
import { MemoryAssetRepository } from '../../../../persistence'
import styles from '../NodeCard.module.css'

/**
 * Rediseño minimalista, petición de usuario ("que en las pantallas se vea
 * bastante lo que hay dentro"): miniatura de imagen (`Thumbnail`) e iconos
 * de audio/vídeo (`MediaBadges`) en la tarjeta de una `slide`, ver
 * `nodeTypes.tsx`/`useNodeThumbnail.ts`/`CanvasAssetContext.tsx`.
 */

const TEST_FILE_PATH = '/tmp/canvas-thumbnail-test.brunch'

beforeEach(() => {
  resetProjectStore()
})

function renderCanvasWithServices(services: Partial<AppServices>, filePath = TEST_FILE_PATH) {
  return render(
    <AppServicesProvider services={services}>
      <Canvas filePath={filePath} />
    </AppServicesProvider>,
  )
}

/** Registra una imagen de prueba y la importa, devolviendo su `assetId` real
 *  (necesario para que `getAsset` la resuelva luego con el mismo id que
 *  lleve el bloque de contenido — ver `MemoryAssetRepository`). */
async function importTestImage(assetRepository: MemoryAssetRepository, path = '/tmp/foto.png') {
  assetRepository.registerSourceFile(path, new Uint8Array([1, 2, 3]), 'image/png')
  const meta = await assetRepository.importAsset(TEST_FILE_PATH, path)
  return meta.id
}

function startNodeId(): string {
  return useProjectStore.getState().project.graph.startNodeId
}

describe('NodeCard — miniatura de imagen (Thumbnail)', () => {
  it('pinta la imagen como franja superior cuando el primer bloque de imagen ya tiene assetId', async () => {
    const assetRepository = new MemoryAssetRepository()
    const assetId = await importTestImage(assetRepository)
    act(() => {
      useProjectStore.getState().addImageBlock(startNodeId(), assetId)
    })

    const { container } = renderCanvasWithServices({ assetRepository })

    await waitFor(() => {
      const img = container.querySelector(`.${CSS.escape(styles.thumbnailImage as string)}`)
      expect(img).not.toBeNull()
    })
    const img = container.querySelector(
      `.${CSS.escape(styles.thumbnailImage as string)}`,
    ) as HTMLImageElement
    expect(img.src).toMatch(/^data:image\/png;base64,/)
  })

  it('no pinta ninguna miniatura si la diapositiva no tiene ningún bloque de imagen', () => {
    const assetRepository = new MemoryAssetRepository()
    const { container } = renderCanvasWithServices({ assetRepository })

    expect(container.querySelector(`.${CSS.escape(styles.thumbnail as string)}`)).toBeNull()
  })

  it('sin `filePath` (p.ej. tests que montan `<Canvas />` sin él) no intenta resolver ninguna miniatura, sin lanzar', async () => {
    const assetRepository = new MemoryAssetRepository()
    const assetId = await importTestImage(assetRepository)
    act(() => {
      useProjectStore.getState().addImageBlock(startNodeId(), assetId)
    })

    // `filePath: undefined` (equivalente a `<Canvas />` a secas): degrada
    // con gracia, ver comentario de `CanvasAssetContextValue.filePath`.
    expect(() =>
      render(
        <AppServicesProvider services={{ assetRepository }}>
          <Canvas />
        </AppServicesProvider>,
      ),
    ).not.toThrow()

    // Le da tiempo de sobra a un posible `getAsset` fallido a resolverse
    // antes de comprobar que, en efecto, nunca llegó a pintarse nada.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('un fallo al resolver la imagen (assetId no existe) no rompe la tarjeta — sigue mostrando su cabecera', async () => {
    const assetRepository = new MemoryAssetRepository()
    act(() => {
      // `assetId` inventado, nunca importado: `getAsset` lanzará.
      useProjectStore.getState().addImageBlock(startNodeId(), crypto.randomUUID())
      useProjectStore.getState().updateNode(startNodeId(), { title: 'Mi diapositiva' })
    })

    renderCanvasWithServices({ assetRepository })

    expect(await screen.findByText('Mi diapositiva')).toBeInTheDocument()
    // Le da tiempo de sobra al `getAsset` fallido a resolverse.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('dos diapositivas con la MISMA imagen comparten una única llamada a getAsset (deduplicación)', async () => {
    const assetRepository = new MemoryAssetRepository()
    const assetId = await importTestImage(assetRepository)
    const getAssetSpy = vi.spyOn(assetRepository, 'getAsset')

    act(() => {
      useProjectStore.getState().addImageBlock(startNodeId(), assetId)
      useProjectStore
        .getState()
        .createNode('slide', { x: 300, y: 0 }, { title: 'Segunda' })
    })
    const secondId = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.type === 'slide' && n.title === 'Segunda')?.id
    if (!secondId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().addImageBlock(secondId, assetId)
    })

    const { container } = renderCanvasWithServices({ assetRepository })

    await waitFor(() => {
      const imgs = container.querySelectorAll(`.${CSS.escape(styles.thumbnailImage as string)}`)
      expect(imgs.length).toBe(2)
    })
    expect(getAssetSpy).toHaveBeenCalledTimes(1)
  })
})

describe('NodeCard — iconos de audio/vídeo (MediaBadges)', () => {
  it('pinta un icono de audio cuando la diapositiva tiene un bloque de audio, y de vídeo si además tiene uno de vídeo', async () => {
    act(() => {
      useProjectStore.getState().addAudioBlock(startNodeId(), crypto.randomUUID())
    })
    render(<Canvas />)

    expect(await screen.findByTitle('Contiene audio')).toBeInTheDocument()
    expect(screen.queryByTitle('Contiene vídeo')).not.toBeInTheDocument()

    act(() => {
      useProjectStore.getState().addVideoBlock(startNodeId(), crypto.randomUUID())
    })
    expect(await screen.findByTitle('Contiene vídeo')).toBeInTheDocument()
  })

  it('sin ningún bloque de audio/vídeo, no pinta ninguno de los dos iconos', () => {
    render(<Canvas />)
    expect(screen.queryByTitle('Contiene audio')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Contiene vídeo')).not.toBeInTheDocument()
  })
})
