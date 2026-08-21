import { useEffect, useState } from 'react'
import type { AssetRepository } from '../persistence'

export interface AssetDataUriResult {
  /** `null` mientras la carga está en curso, o si `error` es `true`. */
  dataUri: string | null
  /** `true` si la última carga de `assetId` falló. */
  error: boolean
}

/**
 * Carga un asset (imagen/audio) ya importado a un `.brunch` como `data:`
 * URI, con guarda contra respuestas obsoletas: si `assetId`/`filePath`/
 * `assetRepository` cambian antes de que la promesa en curso resuelva, su
 * resultado se descarta.
 *
 * Compartido entre `Inspector` (vista previa de edición, `AssetPreview` en
 * `Inspector.tsx`) y `PlayerScreen` (contenido real para quien juega, fase 5
 * del Milestone 2) — ambos necesitan exactamente esta misma lógica de carga;
 * lo único que cambia entre ellos es cómo renderizan el resultado (miniatura
 * de edición vs. contenido real) y qué hacen ante un error (`Inspector`
 * muestra un mensaje; `PlayerScreen` omite el medio en silencio), así que
 * ambas decisiones se dejan al llamador en vez de fijarlas aquí.
 *
 * No resetea `dataUri`/`error` al arrancar un nuevo `assetId`: como en
 * `AssetPreview`, se espera que el llamador monte el componente que use este
 * hook con `key={assetId}` cuando el asset mostrado pueda cambiar (adjuntar
 * el primero, "Reemplazar" uno existente, o avanzar a otro nodo en el
 * Player) — así React destruye la instancia anterior y crea una nueva desde
 * cero en vez de reutilizar un `dataUri` que ya no corresponde al asset
 * mostrado.
 */
export function useAssetDataUri(
  filePath: string,
  assetId: string,
  assetRepository: AssetRepository,
): AssetDataUriResult {
  const [dataUri, setDataUri] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    assetRepository
      .getAsset(filePath, assetId)
      .then((data) => {
        if (cancelled) return
        setDataUri(`data:${data.mimeType};base64,${data.dataBase64}`)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [assetId, filePath, assetRepository])

  return { dataUri, error }
}
