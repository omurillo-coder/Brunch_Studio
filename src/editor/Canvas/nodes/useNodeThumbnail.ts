import { useContext, useEffect, useState } from 'react'
import { CanvasAssetContext } from './CanvasAssetContext'

/**
 * Resuelve la miniatura de imagen de una tarjeta del lienzo (`Thumbnail`,
 * `nodeTypes.tsx`) a partir de su `assetId` (`data.previewImageAssetId`,
 * `adapter.ts`) — mismo mecanismo de fondo que `useAssetDataUri`
 * (`src/hooks/useAssetDataUri.ts`), pero con dos diferencias deliberadas:
 *
 * - Caché COMPARTIDA por `assetId` (`CanvasAssetContext.cache`), no un
 *   `useState` propio por componente: dos diapositivas con la misma imagen
 *   comparten el resultado sin pedirlo dos veces, y una tarjeta que se
 *   desmonta/remonta (p.ej. al hacer scroll fuera y volver a entrar en el
 *   lienzo) lo recupera al instante en vez de volver a pedirlo.
 * - Deduplicación de peticiones EN VUELO (`inFlight`): si dos tarjetas piden
 *   el mismo `assetId` en el mismo instante (dos nodos con la misma imagen
 *   montándose a la vez), comparten una única llamada a
 *   `assetRepository.getAsset` en vez de disparar dos peticiones IPC
 *   idénticas — relevante en un lienzo con decenas de nodos (ver el
 *   comentario de "coste con N nodos" en el informe de exploración de esta
 *   tarea).
 *
 * `undefined` si no hay contexto (tests que montan `<Canvas />` sin
 * `filePath`, ver `CanvasAssetContextValue.filePath`) o si `assetId` es
 * `undefined` (la diapositiva no tiene ninguna imagen resuelta en su
 * contenido) — en ambos casos devuelve `null` sin intentar ningún `getAsset`.
 * Un fallo de red/lectura se traga en silencio (igual que `PlayerScreen`
 * omite un medio que no carga, ver comentario de `useAssetDataUri`): la
 * tarjeta simplemente no pinta miniatura, nunca un icono de error — no es un
 * dato crítico, solo una ayuda visual adicional.
 */
export function useNodeThumbnail(assetId: string | undefined): string | null {
  const ctx = useContext(CanvasAssetContext)
  const [dataUri, setDataUri] = useState<string | null>(
    assetId ? (ctx?.cache.get(assetId) ?? null) : null,
  )

  useEffect(() => {
    if (!assetId || !ctx || !ctx.filePath) {
      setDataUri(null)
      return
    }
    const { filePath, assetRepository, cache, inFlight } = ctx

    const cached = cache.get(assetId)
    if (cached) {
      setDataUri(cached)
      return
    }

    let cancelled = false
    let promise = inFlight.get(assetId)
    if (!promise) {
      promise = assetRepository
        .getAsset(filePath, assetId)
        .then((data) => {
          cache.set(assetId, `data:${data.mimeType};base64,${data.dataBase64}`)
        })
        .catch(() => {
          // Silencioso a propósito, ver comentario de cabecera: sin
          // miniatura, la tarjeta sigue mostrando el resto de su contenido.
        })
        .finally(() => {
          inFlight.delete(assetId)
        })
      inFlight.set(assetId, promise)
    }
    promise.then(() => {
      if (cancelled) return
      setDataUri(cache.get(assetId) ?? null)
    })

    return () => {
      cancelled = true
    }
  }, [assetId, ctx])

  return dataUri
}
