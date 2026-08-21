import { describe, expect, it } from 'vitest'
import { MemoryAssetRepository } from '../MemoryAssetRepository'

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('MemoryAssetRepository', () => {
  it('importa y luego obtiene los mismos bytes (roundtrip)', async () => {
    const repo = new MemoryAssetRepository()
    repo.registerSourceFile('/home/user/foto.png', bytes('contenido-png'), 'image/png')

    const meta = await repo.importAsset('/fake/proyecto.brunch', '/home/user/foto.png')
    expect(meta.mimeType).toBe('image/png')
    expect(meta.filename).toBe('foto.png')

    const data = await repo.getAsset('/fake/proyecto.brunch', meta.id)
    expect(data.mimeType).toBe('image/png')
    expect(data.filename).toBe('foto.png')
    expect(atob(data.dataBase64)).toBe('contenido-png')
  })

  it('deduplica por contenido: mismos bytes desde rutas distintas devuelven el mismo id', async () => {
    const repo = new MemoryAssetRepository()
    const content = bytes('mismo contenido de audio')
    repo.registerSourceFile('/a/cancion.mp3', content, 'audio/mpeg')
    repo.registerSourceFile('/b/otra-copia.mp3', content, 'audio/mpeg')

    const first = await repo.importAsset('/fake/proyecto.brunch', '/a/cancion.mp3')
    const second = await repo.importAsset('/fake/proyecto.brunch', '/b/otra-copia.mp3')

    expect(second.id).toBe(first.id)
  })

  it('contenidos distintos producen ids distintos', async () => {
    const repo = new MemoryAssetRepository()
    repo.registerSourceFile('/a/uno.png', bytes('contenido A'), 'image/png')
    repo.registerSourceFile('/b/dos.png', bytes('contenido B'), 'image/png')

    const first = await repo.importAsset('/fake/proyecto.brunch', '/a/uno.png')
    const second = await repo.importAsset('/fake/proyecto.brunch', '/b/dos.png')

    expect(second.id).not.toBe(first.id)
  })

  it('getAsset con un id inexistente rechaza la promesa', async () => {
    const repo = new MemoryAssetRepository()
    await expect(repo.getAsset('/fake/proyecto.brunch', 'no-existe')).rejects.toThrow()
  })

  it('importAsset sin registerSourceFile previo rechaza la promesa', async () => {
    const repo = new MemoryAssetRepository()
    await expect(
      repo.importAsset('/fake/proyecto.brunch', '/no/registrado.png'),
    ).rejects.toThrow()
  })
})
