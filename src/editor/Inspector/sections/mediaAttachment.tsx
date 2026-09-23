import { useState } from 'react'
import { useAppServices } from '../../../app/AppServicesContext'
import { useAssetDataUri } from '../../../hooks/useAssetDataUri'
import { PersistenceCommandError } from '../../../persistence/wrapInvokeError'
import styles from '../Inspector.module.css'

export type AssetKind = 'image' | 'audio' | 'video'

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  image: 'imagen',
  audio: 'audio',
  video: 'vídeo',
}

/**
 * Mensaje de error cuando el archivo elegido supera el límite de tamaño de
 * su tipo de asset. El límite ya NO es un único valor global (ver
 * `MAX_ASSET_BYTES`/`MAX_VIDEO_ASSET_BYTES` en
 * `src-tauri/src/persistence/assets.rs`: 15 MB para imagen/audio, 100 MB
 * para vídeo), así que el mensaje se construye leyendo `max_bytes` del
 * propio error (`PersistenceError::AssetTooLarge`, serializado tal cual, sin
 * `rename_all`) en vez de hardcodear un número fijo — así es correcto para
 * cualquier tipo de asset sin tener que duplicar el límite aquí.
 */
export function assetTooLargeMessage(error: PersistenceCommandError): string {
  const content = error.content as { max_bytes?: unknown } | undefined
  const maxBytes = typeof content?.max_bytes === 'number' ? content.max_bytes : undefined
  const maxMb = maxBytes !== undefined ? Math.round(maxBytes / (1024 * 1024)) : undefined
  return maxMb !== undefined
    ? `El archivo es demasiado grande (máximo ${maxMb} MB). Prueba con uno más ligero.`
    : 'El archivo es demasiado grande. Prueba con uno más ligero.'
}

export interface MediaAttachmentProps {
  kind: AssetKind
  /** `undefined` si el nodo/respuesta no tiene ningún adjunto de este tipo. */
  assetId?: string
  /** Ruta absoluta del `.brunch` abierto: los assets viven dentro de él. */
  filePath: string
  onAttach: (assetId: string) => void
  onRemove: () => void
  /**
   * Contexto adicional para el nombre accesible de los botones cuando hay
   * varios controles del mismo tipo en pantalla a la vez (p.ej. una fila por
   * respuesta). Vacío a nivel de nodo, donde solo hay un control de cada
   * tipo y no hace falta desambiguar.
   */
  contextLabel?: string
}

/**
 * Vista previa de un asset ya adjunto: carga sus bytes reales
 * (`assetRepository.getAsset`) y los muestra como `data:` URI (imagen) o
 * reproductor (audio).
 *
 * Se monta con `key={assetId}` desde `MediaAttachment` — mismo patrón que
 * `NodeFields`/`ResponseRow` se montan con `key={node.id}`/`key={response.id}`
 * desde sus padres: cuando el `assetId` mostrado cambia (adjuntar el
 * primero, o "Reemplazar" uno ya existente), React destruye esta instancia
 * y crea una nueva en vez de reutilizarla, así que el estado de vista previa
 * siempre arranca limpio para el asset nuevo. La carga en sí (y su guarda
 * contra respuestas obsoletas si esta instancia se desmontara con la
 * promesa todavía en vuelo) vive en `useAssetDataUri`, compartido con
 * `PlayerScreen` — aquí solo se decide cómo renderizar el resultado y qué
 * mostrar ante un error.
 */
export function AssetPreview({
  kind,
  assetId,
  filePath,
  suffix,
}: {
  kind: AssetKind
  assetId: string
  filePath: string
  suffix: string
}) {
  const { assetRepository } = useAppServices()
  const { dataUri, error } = useAssetDataUri(filePath, assetId, assetRepository)

  return (
    <>
      {dataUri && kind === 'image' && (
        <img
          className={styles.mediaThumbnail}
          src={dataUri}
          alt={`Vista previa de la imagen adjunta${suffix}`}
        />
      )}
      {dataUri && kind === 'audio' && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio className={styles.audioPreview} controls src={dataUri} />
      )}
      {dataUri && kind === 'video' && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video className={styles.videoPreview} controls src={dataUri} />
      )}
      {error && (
        <p role="alert" className={styles.mediaError}>
          No se ha podido cargar la vista previa.
        </p>
      )}
    </>
  )
}

/**
 * Control de adjuntar/ver/quitar/reemplazar una imagen o un audio, reusado
 * tanto a nivel de nodo (Diapositiva) como por respuesta.
 *
 * Flujo de adjuntar: `pickImportAssetPath(kind)` (diálogo nativo) -> si el
 * usuario elige un archivo, `assetRepository.importAsset` lo importa al
 * `.brunch` abierto -> con el id devuelto, `onAttach` hace una única llamada
 * a `updateNode`/`updateResponse` (una sola entrada de historial). Cancelar
 * el diálogo (`null`) no hace nada.
 */
export function MediaAttachment({
  kind,
  assetId,
  filePath,
  onAttach,
  onRemove,
  contextLabel,
}: MediaAttachmentProps) {
  const { pickImportAssetPath, assetRepository } = useAppServices()
  const label = ASSET_KIND_LABEL[kind]
  const suffix = contextLabel ? ` ${contextLabel}` : ''

  const [busy, setBusy] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  async function handlePick() {
    setPickError(null)
    setBusy(true)
    try {
      const sourcePath = await pickImportAssetPath(kind)
      if (!sourcePath) {
        // Cancelado por el usuario: sin error visible, sin cambios.
        return
      }
      const meta = await assetRepository.importAsset(filePath, sourcePath)
      onAttach(meta.id)
    } catch (error) {
      // `AssetTooLarge` (ver `PersistenceError` en Rust) es el único caso en
      // el que damos un mensaje específico: el resto de fallos (E/S, tipo no
      // soportado, etc.) comparten el mensaje genérico de siempre.
      if (error instanceof PersistenceCommandError && error.kind === 'AssetTooLarge') {
        setPickError(assetTooLargeMessage(error))
      } else {
        setPickError(`No se ha podido adjuntar el ${label}. Inténtalo de nuevo.`)
      }
    } finally {
      setBusy(false)
    }
  }

  if (!assetId) {
    return (
      <div className={styles.mediaAttachment}>
        <button
          type="button"
          className={styles.attachButton}
          onClick={handlePick}
          disabled={busy}
          aria-label={`Adjuntar ${label}${suffix}`}
        >
          {`Adjuntar ${label}`}
        </button>
        {pickError && (
          <p role="alert" className={styles.mediaError}>
            {pickError}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={styles.mediaAttachment}>
      <div className={styles.mediaPreviewRow}>
        <AssetPreview key={assetId} kind={kind} assetId={assetId} filePath={filePath} suffix={suffix} />
        <div className={styles.mediaButtons}>
          <button
            type="button"
            className={styles.replaceButton}
            onClick={handlePick}
            disabled={busy}
            aria-label={`Reemplazar ${label}${suffix}`}
          >
            Reemplazar
          </button>
          <button
            type="button"
            className={styles.removeButton}
            onClick={onRemove}
            disabled={busy}
            aria-label={`Quitar ${label}${suffix}`}
          >
            Quitar
          </button>
        </div>
      </div>
      {pickError && (
        <p role="alert" className={styles.mediaError}>
          {pickError}
        </p>
      )}
    </div>
  )
}
