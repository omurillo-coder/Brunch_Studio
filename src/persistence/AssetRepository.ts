/**
 * Metadatos de un asset (imagen o audio) ya importado en un `.brunch`.
 * Espejo de `AssetMetaDto` en `src-tauri/src/persistence/assets.rs`.
 */
export interface AssetMeta {
  id: string
  mimeType: string
  filename: string
  sha256: string
}

/**
 * Bytes y metadatos de un asset ya importado. Espejo de `AssetDataDto` en
 * `src-tauri/src/persistence/assets.rs`. Los bytes viajan en base64 (mismo
 * canal JSON que el resto de comandos, sin transporte binario especial);
 * quien consuma esto decide cómo decodificarlos (p.ej. a un `Blob`/URL de
 * objeto para mostrarlos).
 */
export interface AssetData {
  mimeType: string
  filename: string
  dataBase64: string
}

/**
 * Contrato de importación/lectura de assets binarios (imagen/audio) de un
 * `.brunch` en `path`.
 *
 * El frontend nunca lee bytes de disco directamente: `sourceFilePath` es una
 * ruta absoluta ya elegida por el usuario (vía `AppServices.pickImportAssetPath`,
 * que solo abre un diálogo nativo) — es la implementación de este contrato
 * quien decide cómo leer esos bytes (en `TauriProjectRepository`, delegando
 * en Rust).
 *
 * Deduplica por contenido: importar el mismo contenido dos veces (aunque sea
 * desde una ruta distinta) debe devolver el mismo `id` sin duplicar nada.
 */
export interface AssetRepository {
  importAsset(projectPath: string, sourceFilePath: string): Promise<AssetMeta>
  getAsset(projectPath: string, assetId: string): Promise<AssetData>
  /**
   * Elimina de la tabla `assets` del `.brunch` en `projectPath` las filas
   * cuyo `id` no esté en `keepAssetIds` — assets que ya ningún nodo/respuesta
   * del documento referencia (nodo borrado, imagen/audio quitado o
   * reemplazado). Devuelve cuántas filas se eliminaron.
   *
   * `keepAssetIds` lo calcula quien llama (normalmente
   * `collectReferencedAssetIds` de `src/export/exportAssets.ts`) recorriendo
   * el documento; esta operación no lo hace por su cuenta.
   */
  gcOrphanAssets(projectPath: string, keepAssetIds: string[]): Promise<number>
}
