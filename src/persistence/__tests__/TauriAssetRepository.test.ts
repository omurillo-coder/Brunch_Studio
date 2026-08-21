import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PersistenceCommandError } from '../wrapInvokeError'
import { TauriAssetRepository } from '../TauriAssetRepository'

afterEach(() => {
  clearMocks()
  vi.restoreAllMocks()
})

describe('TauriAssetRepository.importAsset', () => {
  it('invoca import_asset con projectPath/sourcePath y valida el AssetMeta devuelto', async () => {
    const calls: Array<{ cmd: string; payload: unknown }> = []
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload })
      return {
        id: '11111111-1111-1111-1111-111111111111',
        mimeType: 'image/png',
        filename: 'foto.png',
        sha256: 'abc123',
      }
    })

    const repo = new TauriAssetRepository()
    const meta = await repo.importAsset('/tmp/proyecto.brunch', '/home/user/foto.png')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.cmd).toBe('import_asset')
    expect(calls[0]?.payload).toEqual({
      projectPath: '/tmp/proyecto.brunch',
      sourcePath: '/home/user/foto.png',
    })
    expect(meta).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      mimeType: 'image/png',
      filename: 'foto.png',
      sha256: 'abc123',
    })
  })

  it('rechaza si la respuesta no cumple la forma de AssetMeta', async () => {
    mockIPC(() => ({ id: 'x' }))

    const repo = new TauriAssetRepository()
    await expect(repo.importAsset('/tmp/proyecto.brunch', '/foto.png')).rejects.toThrow()
  })

  it('propaga un PersistenceCommandError con kind UnsupportedAssetType', async () => {
    mockIPC(() => {
      throw { kind: 'UnsupportedAssetType', content: '/foto.pdf' }
    })

    const repo = new TauriAssetRepository()
    await expect(repo.importAsset('/tmp/proyecto.brunch', '/foto.pdf')).rejects.toBeInstanceOf(
      PersistenceCommandError,
    )
    await expect(repo.importAsset('/tmp/proyecto.brunch', '/foto.pdf')).rejects.toMatchObject({
      kind: 'UnsupportedAssetType',
    })
  })
})

describe('TauriAssetRepository.getAsset', () => {
  it('invoca get_asset con projectPath/assetId y valida el AssetData devuelto', async () => {
    const calls: Array<{ cmd: string; payload: unknown }> = []
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload })
      return { mimeType: 'audio/mpeg', filename: 'cancion.mp3', dataBase64: 'YWJj' }
    })

    const repo = new TauriAssetRepository()
    const data = await repo.getAsset('/tmp/proyecto.brunch', 'asset-1')

    expect(calls[0]?.cmd).toBe('get_asset')
    expect(calls[0]?.payload).toEqual({ projectPath: '/tmp/proyecto.brunch', assetId: 'asset-1' })
    expect(data).toEqual({ mimeType: 'audio/mpeg', filename: 'cancion.mp3', dataBase64: 'YWJj' })
  })

  it('propaga un PersistenceCommandError con kind NotFound', async () => {
    mockIPC(() => {
      throw { kind: 'NotFound', content: 'no-existe' }
    })

    const repo = new TauriAssetRepository()
    await expect(repo.getAsset('/tmp/proyecto.brunch', 'no-existe')).rejects.toMatchObject({
      kind: 'NotFound',
    })
  })
})
