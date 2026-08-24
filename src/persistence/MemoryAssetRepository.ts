import type { AssetData, AssetMeta, AssetRepository } from './AssetRepository'

interface StoredAsset extends AssetMeta {
  bytes: Uint8Array
}

/**
 * Hash de contenido simplificado para deduplicación en memoria (no es
 * `sha256` real: no hace falta serlo para que los tests de fases futuras
 * puedan verificar "mismo contenido -> mismo id", que es la única propiedad
 * que importa aquí). Se deriva de la longitud y de una suma ponderada de los
 * bytes, suficiente para no colisionar en los casos de prueba realistas de
 * este proyecto sin depender de `crypto.subtle` (asíncrono, y esta función
 * se usa en un contexto síncrono).
 */
function contentFingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5 // FNV-1a offset basis
  for (const byte of bytes) {
    hash ^= byte
    hash = (hash * 0x01000193) >>> 0 // FNV-1a prime, mantenido en 32 bits
  }
  return `${bytes.length}-${hash.toString(16)}`
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

let nextId = 1

/**
 * Implementación de `AssetRepository` respaldada por un `Map` en memoria.
 * Pensada para tests de UI (store, Inspector) que no necesitan un backend
 * Tauri real — igual que `MemoryProjectRepository`.
 *
 * Replica la deduplicación por contenido: dos `importAsset` con los mismos
 * bytes (aunque desde nombres de archivo distintos) devuelven el mismo `id`
 * sin crear una entrada nueva. Los "bytes" a importar se pasan a través de
 * `registerSourceFile` (ver más abajo) porque, a diferencia del backend
 * real, aquí no hay ningún proceso Rust que pueda leer el disco: quien use
 * este repositorio en un test decide qué bytes "contiene" cada ruta.
 */
export class MemoryAssetRepository implements AssetRepository {
  private readonly assetsById = new Map<string, StoredAsset>()
  private readonly assetIdByFingerprint = new Map<string, string>()
  private readonly sourceFiles = new Map<string, { bytes: Uint8Array; mimeType: string }>()

  /**
   * Registra qué bytes y `mimeType` debe "leer" una ruta de origen dada al
   * llamar a `importAsset` con ella. Solo para tests: sustituye la lectura
   * real de disco que haría Rust.
   */
  registerSourceFile(sourceFilePath: string, bytes: Uint8Array, mimeType: string): void {
    this.sourceFiles.set(sourceFilePath, { bytes, mimeType })
  }

  async importAsset(projectPath: string, sourceFilePath: string): Promise<AssetMeta> {
    const source = this.sourceFiles.get(sourceFilePath)
    if (!source) {
      throw new Error(
        `MemoryAssetRepository: no se registraron bytes para "${sourceFilePath}" ` +
          '(usa registerSourceFile antes de importAsset).',
      )
    }

    const fingerprint = contentFingerprint(source.bytes)
    const existingId = this.assetIdByFingerprint.get(fingerprint)
    if (existingId) {
      const existing = this.assetsById.get(existingId)
      if (existing) {
        return { ...existing }
      }
    }

    const id = `memory-asset-${nextId++}`
    const filename = sourceFilePath.split(/[/\\]/).pop() ?? sourceFilePath
    const stored: StoredAsset = {
      id,
      mimeType: source.mimeType,
      filename,
      sha256: fingerprint,
      bytes: source.bytes,
    }
    this.assetsById.set(id, stored)
    this.assetIdByFingerprint.set(fingerprint, id)

    void projectPath // no distinguimos proyectos: alcanza para los tests actuales.
    const { bytes: _bytes, ...meta } = stored
    return meta
  }

  async getAsset(projectPath: string, assetId: string): Promise<AssetData> {
    void projectPath
    const stored = this.assetsById.get(assetId)
    if (!stored) {
      throw new Error(`MemoryAssetRepository: no existe ningún asset con id "${assetId}".`)
    }
    return {
      mimeType: stored.mimeType,
      filename: stored.filename,
      dataBase64: bytesToBase64(stored.bytes),
    }
  }

  async gcOrphanAssets(projectPath: string, keepAssetIds: string[]): Promise<number> {
    void projectPath
    const keep = new Set(keepAssetIds)
    let deleted = 0
    for (const [id, stored] of [...this.assetsById]) {
      if (keep.has(id)) continue
      this.assetsById.delete(id)
      this.assetIdByFingerprint.delete(stored.sha256)
      deleted += 1
    }
    return deleted
  }
}
