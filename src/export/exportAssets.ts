import type { ProjectDocument } from '../domain'
import type { AssetRepository } from '../persistence'

/**
 * ---------------------------------------------------------------------------
 * Resolución de assets para la exportación (Milestone 3, fase 1)
 * ---------------------------------------------------------------------------
 *
 * El `index.html` exportado tiene que funcionar abierto con `file://`, sin
 * servidor ni backend Tauri, así que NO puede pedir los assets en tiempo de
 * reproducción (nada de `getAsset`, nada de `fetch`): todos van embebidos
 * como `data:` URI dentro del propio archivo. Este módulo es el paso previo
 * a la generación del HTML: recorre el documento, reúne todos los assetIds
 * realmente referenciados y pide sus bytes (ya en base64) al
 * `AssetRepository`, exactamente igual que hacen `Inspector` y `Player` al
 * mostrar un asset suelto.
 */

/** Bytes y tipo de un asset, listos para construir un `data:` URI. */
export interface ExportAsset {
  mimeType: string
  dataBase64: string
}

/** Assets resueltos, indexados por `assetId`. */
export type ExportAssetMap = Record<string, ExportAsset>

export interface ResolveExportAssetsResult {
  /** Assets que se han podido leer; los únicos que se embeberán. */
  assets: ExportAssetMap
  /**
   * Ids de los assets referenciados por el documento que NO se han podido
   * leer. La exportación sigue adelante sin ellos (ver criterio más abajo);
   * quien llama decide cómo avisar al usuario.
   */
  failedAssetIds: string[]
}

/**
 * Todos los `assetId` (imagen, audio y vídeo) referenciados por el
 * documento, sin duplicados y en orden estable de aparición: primero los
 * bloques de imagen/audio/vídeo de `SlideNode.content` (en el orden exacto
 * del array, milestone "Bloques de contenido") y después los de cada una de
 * sus respuestas (solo imagen/audio: `DecisionResponse` no admite vídeo),
 * recorriendo los nodos en el orden en que están en `graph.nodes`.
 *
 * El orden es estable a propósito: hace que el HTML generado para un mismo
 * documento sea idéntico entre exportaciones (comparable/diffeable), en vez
 * de depender del orden de resolución de las promesas.
 */
export function collectReferencedAssetIds(project: ProjectDocument): string[] {
  const ids: string[] = []
  const seen = new Set<string>()

  function push(assetId: string | undefined): void {
    if (!assetId || seen.has(assetId)) return
    seen.add(assetId)
    ids.push(assetId)
  }

  for (const node of project.graph.nodes) {
    if (node.type !== 'slide') continue
    for (const block of node.content) {
      if (block.type === 'image' || block.type === 'audio' || block.type === 'video') {
        push(block.assetId)
      }
    }
    for (const response of node.responses) {
      push(response.imageAssetId)
      push(response.audioAssetId)
    }
  }

  return ids
}

/**
 * Lee los bytes de todos los assets referenciados por `project` desde el
 * `.brunch` en `projectPath`.
 *
 * Criterio ante un asset que falla (decisión de diseño): se OMITE de la
 * exportación y su id se devuelve en `failedAssetIds`, en vez de abortar la
 * exportación completa. Un archivo de imagen o audio ilegible no debe
 * impedir publicar una experiencia entera de decenas de diapositivas — el
 * HTML resultante sigue siendo válido y reproducible, simplemente sin ese
 * medio (mismo criterio de "fallo silencioso del medio, el resto sigue
 * funcionando" que ya usa `PlayerScreen` con `PlayerImage`/`PlayerAudio`). La
 * lista de ids fallidos existe para que la UI pueda avisar de forma honesta
 * de que la exportación quedó incompleta.
 *
 * Nunca rechaza: cualquier error de cualquier asset queda contabilizado en
 * `failedAssetIds`.
 */
export async function resolveExportAssets(
  projectPath: string,
  project: ProjectDocument,
  assetRepository: AssetRepository,
): Promise<ResolveExportAssetsResult> {
  const assetIds = collectReferencedAssetIds(project)
  const settled = await Promise.allSettled(
    assetIds.map((assetId) => assetRepository.getAsset(projectPath, assetId)),
  )

  const assets: ExportAssetMap = {}
  const failedAssetIds: string[] = []

  settled.forEach((result, index) => {
    const assetId = assetIds[index]
    if (assetId === undefined) return
    if (result.status === 'fulfilled') {
      assets[assetId] = {
        mimeType: result.value.mimeType,
        dataBase64: result.value.dataBase64,
      }
    } else {
      failedAssetIds.push(assetId)
    }
  })

  return { assets, failedAssetIds }
}
