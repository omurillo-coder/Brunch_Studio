import { createContext } from 'react'
import type { ReactNode } from 'react'
import type { AssetRepository } from '../../../persistence'

/**
 * Rediseño minimalista, petición de usuario ("que en las pantallas se vea
 * bastante lo que hay dentro"): contexto que le da a la tarjeta de una
 * diapositiva (`Thumbnail` en `nodeTypes.tsx`, vía el hook `useNodeThumbnail`)
 * lo que necesita para resolver la miniatura de imagen de su `content` —
 * `filePath` + `assetRepository`, igual que `useAssetDataUri` ya necesita en
 * `Inspector`/`PlayerScreen` — más una caché COMPARTIDA por `assetId` (no por
 * nodo): si varias diapositivas usan la misma imagen, se pide una sola vez.
 *
 * Por qué un contexto y no una prop más de `nodeTypes`: `@xyflow/react` solo
 * pasa a cada componente de nodo personalizado su propio `NodeProps` (`id`,
 * `data`, `selected`...) — no hay forma de colar una prop propia del
 * `<Canvas>` que lo monta. Un contexto es el mecanismo estándar de React para
 * esto exactamente.
 *
 * `cache`/`inFlight` viven en un `useRef` de `Canvas.tsx` (nunca a nivel de
 * módulo) — mismo criterio de ciclo de vida que `FlowNodeCache`/
 * `FlowEdgeCache` en `adapter.ts`: ligados al lienzo MONTADO (un proyecto
 * abierto), nunca acumulando entradas de un proyecto ya cerrado. Como
 * `assetId` es un UUID generado por proyecto, una colisión entre dos
 * proyectos distintos abiertos en sesiones sucesivas es prácticamente
 * imposible, pero atarlo al ciclo de vida del lienzo montado (en vez de a
 * nivel de módulo, que sí sobreviviría a cerrar y abrir otro proyecto) es la
 * misma disciplina ya establecida, no una precaución nueva.
 */
export interface CanvasAssetContextValue {
  /** Ruta del `.brunch` abierto — `undefined` en los tests que montan
   *  `<Canvas />` sin ella (ver su prop opcional): sin `filePath` no hay
   *  ninguna miniatura que resolver, `useNodeThumbnail` no intenta ningún
   *  `getAsset`. */
  filePath: string | undefined
  assetRepository: AssetRepository
  /** `assetId` -> `data:` URI ya resuelta. */
  cache: Map<string, string>
  /** `assetId` -> promesa de resolución en curso, para que dos tarjetas que
   *  piden el mismo `assetId` en el mismo instante compartan una única
   *  llamada a `assetRepository.getAsset` en vez de duplicarla. */
  inFlight: Map<string, Promise<void>>
}

export const CanvasAssetContext = createContext<CanvasAssetContextValue | null>(null)

export function CanvasAssetProvider({
  value,
  children,
}: {
  value: CanvasAssetContextValue
  children: ReactNode
}) {
  return <CanvasAssetContext.Provider value={value}>{children}</CanvasAssetContext.Provider>
}
