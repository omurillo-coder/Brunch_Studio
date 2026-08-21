import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import type { AssetData, AssetMeta, AssetRepository } from './AssetRepository'
import { wrapInvokeError } from './wrapInvokeError'

/** Espejo de `AssetMetaDto` (Rust); valida la forma antes de confiar en ella. */
const AssetMetaSchema = z.object({
  id: z.string(),
  mimeType: z.string(),
  filename: z.string(),
  sha256: z.string(),
})

/** Espejo de `AssetDataDto` (Rust); valida la forma antes de confiar en ella. */
const AssetDataSchema = z.object({
  mimeType: z.string(),
  filename: z.string(),
  dataBase64: z.string(),
})

/**
 * Implementación de `AssetRepository` que delega en los comandos Tauri
 * `import_asset`/`get_asset` (`src-tauri/src/commands/mod.rs`), que a su vez
 * leen/escriben bytes en Rust sobre la tabla `assets` del `.brunch`.
 */
export class TauriAssetRepository implements AssetRepository {
  async importAsset(projectPath: string, sourceFilePath: string): Promise<AssetMeta> {
    try {
      const result = await invoke('import_asset', {
        projectPath,
        sourcePath: sourceFilePath,
      })
      return AssetMetaSchema.parse(result)
    } catch (error) {
      wrapInvokeError(error)
    }
  }

  async getAsset(projectPath: string, assetId: string): Promise<AssetData> {
    try {
      const result = await invoke('get_asset', { projectPath, assetId })
      return AssetDataSchema.parse(result)
    } catch (error) {
      wrapInvokeError(error)
    }
  }
}
