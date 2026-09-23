import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useProjectStore } from '../../../store'
import { DEFAULT_IMAGE_ALT, IMAGE_SIZES } from '../../../domain'
import type { ContentBlock, ImageSize, SlideNode } from '../../../domain'
import { useAppServices } from '../../../app/AppServicesContext'
import { PersistenceCommandError } from '../../../persistence/wrapInvokeError'
import { RichTextEditor } from '../../richText/RichTextEditor'
import styles from '../Inspector.module.css'
import { AssetPreview, ASSET_KIND_LABEL, assetTooLargeMessage } from './mediaAttachment'
import type { AssetKind } from './mediaAttachment'

/**
 * ---------------------------------------------------------------------------
 * Bloques de contenido de una diapositiva (milestone "Bloques de contenido",
 * fase 2 — editor)
 * ---------------------------------------------------------------------------
 *
 * Sustituye el antiguo editor de "un único body + lista de imágenes
 * apiladas + un audio + orden texto/imagen" por una lista ORDENABLE de
 * bloques heterogéneos (`SlideNode.content`, ver `src/domain/content.ts`),
 * pintados en el mismo orden en que aparecerán en el Player/export — el
 * índice del array ES el orden, sin ningún concepto de "orden del
 * contenido" aparte que mantener sincronizado.
 *
 * Cada bloque se renderiza según su `type`:
 * - `text`: reutiliza el editor de texto enriquecido ya existente
 *   (`RichTextEditor`), montado con `key={block.id}` a través de
 *   `ContentBlockRow` — igual que antes se remontaba con `key={node.id}` al
 *   cambiar de nodo, aquí se remonta al cambiar de bloque, así que su estado
 *   interno nunca se mezcla entre dos bloques de texto distintos de la misma
 *   diapositiva.
 * - `image`/`audio`/`video`: reutiliza `AssetPreview` (miniatura, `<audio
 *   controls>` o `<video controls>`) sobre el asset ya importado. A diferencia del antiguo
 *   `MediaAttachment` (adjuntar/reemplazar/quitar un único adjunto), un
 *   bloque de imagen/audio no ofrece "Reemplazar": para cambiar el archivo
 *   se quita el bloque y se añade uno nuevo — un bloque, una vez creado, no
 *   cambia de asset ni de tipo, mismo criterio de identidad estable que
 *   documenta `ContentBlockSchema`.
 *
 * Quitar un bloque (decisión de diseño deliberada): SIN confirmación, a
 * diferencia de "Eliminar <diapositiva/final>". Quitar un bloque es una
 * operación de grano fino con undo disponible de inmediato (mismo criterio
 * que "Duplicar" o "Eliminar respuesta", que tampoco piden confirmación) —
 * incluso quitar el ÚNICO bloque de texto restante es una operación válida
 * que el propio dominio permite (`removeContentBlock` no impone ningún
 * mínimo, ver su comentario en `src/domain/content.ts`): la diapositiva
 * queda sin contenido de texto, y "+ Texto" la recupera en cualquier
 * momento. Pedir una confirmación solo para ese caso concreto introduciría
 * una excepción difícil de justificar frente al resto de bloques sin aportar
 * protección real (el undo ya cubre el arrepentimiento).
 */

/** Icono discreto por tipo de bloque (petición de usuario: "que se vea algo
 *  más la diferencia de bloques entre texto, imagen, audio, vídeo") — mismo
 *  criterio "emoji + texto, sin librería de iconos" que `PinBadge`/
 *  `MediaBadges` del lienzo (`nodeTypes.tsx`): un vistazo a la forma del
 *  icono ya distingue el tipo de bloque en la lista, sin depender solo de
 *  leer la etiqueta de texto ("Texto 1", "Imagen 2"...). */
const CONTENT_BLOCK_TYPE_ICON: Record<ContentBlock['type'], string> = {
  text: '📝',
  image: '🖼️',
  audio: '🔊',
  video: '🎬',
}

/** Añade un bloque nuevo al FINAL de `content` — criterio elegido (frente a
 *  "en la posición del bloque enfocado"): más predecible y sin necesidad de
 *  rastrear qué bloque tiene el foco en cada momento; el usuario siempre
 *  puede reordenar el bloque recién creado con ↑ si lo quiere en otro sitio. */
function ContentBlockRow({
  slideNodeId,
  block,
  index,
  lastIndex,
  filePath,
}: {
  slideNodeId: string
  block: ContentBlock
  index: number
  lastIndex: number
  filePath: string
}) {
  const moveContentBlock = useProjectStore((state) => state.moveContentBlock)
  const removeContentBlock = useProjectStore((state) => state.removeContentBlock)
  const updateTextBlockBody = useProjectStore((state) => state.updateTextBlockBody)

  const position = index + 1
  const labelId = `inspector-content-block-${block.id}-label`
  const typeLabel =
    block.type === 'text'
      ? 'Texto'
      : block.type === 'image'
        ? 'Imagen'
        : block.type === 'audio'
          ? 'Audio'
          : 'Vídeo'

  return (
    <div className={styles.contentBlockRow}>
      <div className={styles.contentBlockHeader}>
        <span id={labelId} className={styles.contentBlockLabel}>
          <span aria-hidden="true">{CONTENT_BLOCK_TYPE_ICON[block.type]}</span> {typeLabel} {position}
        </span>
        <div className={styles.contentBlockControls}>
          <button
            type="button"
            className={styles.contentBlockMoveButton}
            onClick={() => moveContentBlock(slideNodeId, block.id, index - 1)}
            disabled={index === 0}
            aria-label={`Subir bloque ${position}`}
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.contentBlockMoveButton}
            onClick={() => moveContentBlock(slideNodeId, block.id, index + 1)}
            disabled={index === lastIndex}
            aria-label={`Bajar bloque ${position}`}
          >
            ↓
          </button>
          <button
            type="button"
            className={styles.removeButton}
            onClick={() => removeContentBlock(slideNodeId, block.id)}
            aria-label={`Quitar bloque ${position}`}
          >
            Quitar
          </button>
        </div>
      </div>
      {block.type === 'text' && (
        <RichTextEditor
          body={block.body}
          onCommit={(nextBody) => updateTextBlockBody(slideNodeId, block.id, nextBody)}
          ariaLabelledBy={labelId}
        />
      )}
      {block.type === 'image' && !block.assetId && (
        <PendingImageBlock slideNodeId={slideNodeId} blockId={block.id} filePath={filePath} />
      )}
      {block.type !== 'text' && block.assetId && (
        <AssetPreview
          key={block.assetId}
          kind={block.type}
          assetId={block.assetId}
          filePath={filePath}
          suffix={` ${position}`}
        />
      )}
      {block.type === 'image' && block.assetId && (
        <ImageBlockOptions slideNodeId={slideNodeId} block={block} />
      )}
    </div>
  )
}

/**
 * Bloque de imagen "pendiente de subir" (milestone "+1 fallo con Game
 * Over", ver comentario de `ContentBlockSchema` en `schemas.ts`): un hueco
 * reservado sin archivo todavía. Mismo flujo de importación que "+ Imagen"
 * (`ContentBlocksSection.handleAddAsset`, más abajo) pero rellenando el
 * bloque YA CREADO (`attachImageAsset`) en vez de crear uno nuevo — no se
 * comparte ese handler porque este necesita el `blockId` del bloque
 * pendiente concreto, que `handleAddAsset` no conoce.
 */
function PendingImageBlock({
  slideNodeId,
  blockId,
  filePath,
}: {
  slideNodeId: string
  blockId: string
  filePath: string
}) {
  const attachImageAsset = useProjectStore((state) => state.attachImageAsset)
  const { pickImportAssetPath, assetRepository } = useAppServices()
  const [busy, setBusy] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  async function handleAttach() {
    setPickError(null)
    setBusy(true)
    try {
      const sourcePath = await pickImportAssetPath('image')
      if (!sourcePath) {
        // Cancelado por el usuario: sin error visible, sin cambios.
        return
      }
      const meta = await assetRepository.importAsset(filePath, sourcePath)
      attachImageAsset(slideNodeId, blockId, meta.id)
    } catch (error) {
      if (error instanceof PersistenceCommandError && error.kind === 'AssetTooLarge') {
        setPickError(assetTooLargeMessage(error))
      } else {
        setPickError('No se ha podido adjuntar la imagen. Inténtalo de nuevo.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.pendingImageBlock}>
      <p className={styles.pendingImageNotice}>
        Imagen pendiente de subir. Mientras no tenga archivo, el Player la omite y no se puede
        exportar.
      </p>
      <button type="button" className={styles.replaceButton} onClick={handleAttach} disabled={busy}>
        Adjuntar imagen
      </button>
      {pickError && (
        <p role="alert" className={styles.mediaError}>
          {pickError}
        </p>
      )}
    </div>
  )
}

/**
 * Controles de "ampliable"/"tamaño" de un bloque de imagen YA resuelto (con
 * `assetId`) — petición de usuario: "un botón debajo de cada imagen para
 * poder hacer no ampliable la imagen" + "un desplegable que ponga Tamaño
 * normal y te deje escoger entre pequeño normal y grande". Se pintan justo
 * debajo de la vista previa (`AssetPreview`, en `ContentBlockRow`); no tiene
 * sentido mostrarlos para un bloque "pendiente de subir"
 * (`PendingImageBlock`, sin imagen que previsualizar todavía).
 *
 * `expandable`/`size`/`alt` son puramente visuales/accesibles para el
 * Player/export (`PlayerImage`, `Lightbox` — ver `src/player/runtime.ts`/
 * `src/export/exportedPlayerScript.ts`): ninguno de los tres cambia nada en
 * el propio editor, solo en cómo se ve o se anuncia la imagen para quien
 * juega la experiencia.
 */
function ImageBlockOptions({
  slideNodeId,
  block,
}: {
  slideNodeId: string
  block: Extract<ContentBlock, { type: 'image' }>
}) {
  const updateImageBlockOptions = useProjectStore((state) => state.updateImageBlockOptions)
  // `undefined` = ampliable (valor por defecto, ver comentario de
  // `ContentBlockSchema.expandable`).
  const expandable = block.expandable !== false
  const sizeFieldId = `inspector-image-size-${block.id}`
  const altFieldId = `inspector-image-alt-${block.id}`

  // Mismo criterio "commit on blur" que el texto del botón de continuar
  // (ver `ContinueSection` más arriba): estado local + confirmación en
  // blur/Enter/desmontaje, comparando contra lo último confirmado para no
  // generar entradas de historial vacías.
  const [alt, setAlt] = useState(block.alt ?? '')
  const committedAltRef = useRef(block.alt ?? '')
  const latestAltRef = useRef(alt)
  latestAltRef.current = alt

  useEffect(() => {
    return () => {
      commitPendingAlt()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commitPendingAlt() {
    const pending = latestAltRef.current
    if (pending === committedAltRef.current) return
    // Vacío significa "vuelve al texto genérico por defecto" (`null` borra el campo).
    updateImageBlockOptions(slideNodeId, block.id, { alt: pending.trim() === '' ? null : pending })
    committedAltRef.current = pending
  }

  function handleAltKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      commitPendingAlt()
    }
  }

  return (
    <div className={styles.imageOptions}>
      <button
        type="button"
        className={styles.replaceButton}
        onClick={() =>
          updateImageBlockOptions(slideNodeId, block.id, {
            // Se borra el campo (`null`) al volver a "ampliable" — ese es
            // el valor por defecto, no hace falta guardar `true` explícito.
            expandable: expandable ? false : null,
          })
        }
      >
        {expandable ? 'Hacer no ampliable' : 'Hacer ampliable'}
      </button>
      <div className={styles.imageSizeField}>
        <label htmlFor={sizeFieldId}>Tamaño</label>
        <select
          id={sizeFieldId}
          className={styles.select}
          value={block.size ?? 'normal'}
          onChange={(event) => {
            const nextSize = event.target.value as ImageSize
            updateImageBlockOptions(slideNodeId, block.id, {
              // "normal" es el valor por defecto: se borra el campo en vez
              // de guardarlo explícito, mismo criterio que `expandable`.
              size: nextSize === 'normal' ? null : nextSize,
            })
          }}
        >
          {IMAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size === 'small' ? 'Pequeño' : size === 'normal' ? 'Normal' : 'Grande'}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.imageAltField}>
        <label className={styles.label} htmlFor={altFieldId}>
          Texto alternativo (para lectores de pantalla)
        </label>
        <input
          id={altFieldId}
          className={styles.input}
          type="text"
          value={alt}
          placeholder={DEFAULT_IMAGE_ALT}
          onChange={(event) => setAlt(event.target.value)}
          onBlur={commitPendingAlt}
          onKeyDown={handleAltKeyDown}
        />
      </div>
    </div>
  )
}

/**
 * Sección de contenido de una diapositiva: la lista de bloques (vacía en
 * teoría posible, aunque `createNode`/`duplicateNode` siempre siembran al
 * menos uno) más los cuatro controles de añadir. Mismo criterio de "+ Añadir
 * X" que otros botones "+" ya usados en la app (`.addResponseButton`): +
 * Texto añade un bloque vacío al instante (sin diálogo); + Imagen/+ Audio/+
 * Vídeo reutilizan el mismo flujo de importación de asset ya existente
 * (diálogo nativo -> `assetRepository.importAsset`, con la misma
 * deduplicación por contenido que el resto de adjuntos de la app) y solo
 * añaden el bloque si el usuario no cancela. El límite de tamaño depende del
 * tipo (15 MB para imagen/audio, 100 MB para vídeo — ver
 * `MAX_VIDEO_ASSET_BYTES` en `src-tauri/src/persistence/assets.rs`), pero el
 * mensaje de error ante un archivo demasiado grande se construye en tiempo
 * real a partir del error devuelto (`assetTooLargeMessage`), sin
 * hardcodearlo aquí.
 */
export function ContentBlocksSection({ node, filePath }: { node: SlideNode; filePath: string }) {
  const addTextBlock = useProjectStore((state) => state.addTextBlock)
  const addImageBlock = useProjectStore((state) => state.addImageBlock)
  const addAudioBlock = useProjectStore((state) => state.addAudioBlock)
  const addVideoBlock = useProjectStore((state) => state.addVideoBlock)
  const { pickImportAssetPath, assetRepository } = useAppServices()

  const [busyKind, setBusyKind] = useState<AssetKind | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)

  async function handleAddAsset(kind: AssetKind) {
    setPickError(null)
    setBusyKind(kind)
    try {
      const sourcePath = await pickImportAssetPath(kind)
      if (!sourcePath) {
        // Cancelado por el usuario: sin error visible, sin cambios.
        return
      }
      const meta = await assetRepository.importAsset(filePath, sourcePath)
      if (kind === 'image') {
        addImageBlock(node.id, meta.id)
      } else if (kind === 'audio') {
        addAudioBlock(node.id, meta.id)
      } else {
        addVideoBlock(node.id, meta.id)
      }
    } catch (error) {
      if (error instanceof PersistenceCommandError && error.kind === 'AssetTooLarge') {
        setPickError(assetTooLargeMessage(error))
      } else {
        setPickError(`No se ha podido adjuntar el ${ASSET_KIND_LABEL[kind]}. Inténtalo de nuevo.`)
      }
    } finally {
      setBusyKind(null)
    }
  }

  const lastIndex = node.content.length - 1

  return (
    <div className={styles.contentBlocksSection}>
      <span className={styles.label}>Contenido</span>
      {node.content.length > 0 && (
        <div className={styles.contentBlocksList}>
          {node.content.map((block, index) => (
            <ContentBlockRow
              key={block.id}
              slideNodeId={node.id}
              block={block}
              index={index}
              lastIndex={lastIndex}
              filePath={filePath}
            />
          ))}
        </div>
      )}
      {pickError && (
        <p role="alert" className={styles.mediaError}>
          {pickError}
        </p>
      )}
      <div className={styles.contentBlocksAddRow}>
        <button
          type="button"
          className={styles.addResponseButton}
          onClick={() => addTextBlock(node.id)}
        >
          + Texto
        </button>
        <button
          type="button"
          className={styles.addResponseButton}
          onClick={() => handleAddAsset('image')}
          disabled={busyKind === 'image'}
        >
          + Imagen
        </button>
        <button
          type="button"
          className={styles.addResponseButton}
          onClick={() => handleAddAsset('audio')}
          disabled={busyKind === 'audio'}
        >
          + Audio
        </button>
        <button
          type="button"
          className={styles.addResponseButton}
          onClick={() => handleAddAsset('video')}
          disabled={busyKind === 'video'}
        >
          + Vídeo
        </button>
      </div>
    </div>
  )
}
