import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  useProject,
  useProjectStore,
  useSelectedNodeIds,
  useTitleFocusRequestNodeId,
} from '../../store'
import {
  asignaturaBelongsToCiclo,
  CICLOS,
  COMPARISON_OPERATORS,
  DEFAULT_CONTINUE_LABEL,
  FINAL_VARIANTS,
  MAX_RESPONSES,
  RESPONSE_LETTERS,
  SLIDE_COLORS,
  deriveEdges,
} from '../../domain'
import type {
  ComparisonOperator,
  ContentBlock,
  DecisionResponse,
  FinalNode,
  FinalVariant,
  IntroNode,
  Node,
  NodeType,
  ProjectDocument,
  SlideColor,
  SlideNode,
  VariableCondition,
  VariableDef,
  VariableEffect,
} from '../../domain'
import { useAppServices } from '../../app/AppServicesContext'
import { useAssetDataUri } from '../../hooks/useAssetDataUri'
import { PersistenceCommandError } from '../../persistence/wrapInvokeError'
import { NODE_TYPE_LABEL } from '../Canvas/nodes/nodeTypes'
import { RichTextEditor } from '../richText/RichTextEditor'
import {
  clampInspectorWidth,
  loadInspectorWidth,
  saveInspectorWidth,
} from '../uiPreferences'
import styles from './Inspector.module.css'

/** Vista sin selección: información básica de solo lectura del proyecto. */
function ProjectSummary({ project }: { project: ProjectDocument }) {
  // `intro: 0` (milestone "Diapositiva de Inicio"): el desglose por tipo no
  // gana una fila propia para "Inicio" (0 o 1 nodo siempre, no aporta mucho
  // frente a "Diapositiva"/"Final") pero el `Record` sí debe cubrir los tres
  // tipos del dominio — si no, TypeScript rechaza este literal.
  const counts: Record<NodeType, number> = { intro: 0, slide: 0, final: 0 }
  for (const node of project.graph.nodes) {
    counts[node.type] += 1
  }

  return (
    <div>
      <h2 className={styles.summaryTitle}>{project.metadata.name}</h2>
      <dl className={styles.summaryList}>
        <div className={styles.summaryRow}>
          <dt>Nodos totales</dt>
          <dd>{project.graph.nodes.length}</dd>
        </div>
        <div className={styles.summaryRow}>
          <dt>{NODE_TYPE_LABEL.slide}</dt>
          <dd>{counts.slide}</dd>
        </div>
        <div className={styles.summaryRow}>
          <dt>{NODE_TYPE_LABEL.final}</dt>
          <dd>{counts.final}</dd>
        </div>
      </dl>
    </div>
  )
}

/** Valor de la opción "— Sin destino —" de los `<select>` de destino. Nunca
 *  puede coincidir con un id real (los ids son UUIDs). */
const NO_TARGET_VALUE = '__none__'

/**
 * Etiqueta legible de un nodo para mostrarlo como destino posible en un
 * `<select>` — nunca el `id` interno (UUID) como texto visible. Formato:
 * "<Tipo> <número> — <referencia o 'Sin ref. oculta'>", p.ej.
 * "Diapositiva 3 — Bienvenida". "Ref. oculta" es la etiqueta de UI del campo
 * `title` del dominio (ver comentario de `NodeFields` más abajo, junto al
 * `<label>` del campo): el nombre del campo en el modelo no cambia, solo su
 * texto visible.
 */
function nodeOptionLabel(node: Node): string {
  const title = node.title.trim() || 'Sin ref. oculta'
  return `${NODE_TYPE_LABEL[node.type]} ${node.number} — ${title}`
}

/**
 * Clase CSS de un campo de texto libre (`.input`/`.textarea`) del Inspector
 * según si está vacío o no — petición de usuario: "los campos por rellenar
 * deberían estar en blanco, no en gris [...] para saber exactamente lo que
 * tienes que rellenar". Añade `.fieldEmpty` (ver `Inspector.module.css`,
 * fondo `--bs-color-surface` en vez del `--bs-color-bg` habitual) cuando
 * `value.trim() === ''` — mismo criterio de "vacío" que ya usa el resto del
 * dominio para estos campos (p.ej. `ContinueSection.commitPending`,
 * `InternalNoteField.commitPending`: `trim() === ''` decide si se guarda
 * `null`).
 *
 * Recibe SIEMPRE el estado local en edición (`title`/`label`/`caseName`/
 * `text`/`value`, no el último valor confirmado en el store) porque cada uno
 * de esos componentes ya re-renderiza en cada pulsación (`onChange`) — así
 * el fondo cambia EN VIVO mientras se escribe o se borra, no solo al cargar
 * el Inspector o al perder el foco.
 *
 * Deliberadamente NO existe una variante para `.select`: los desplegables
 * de elección cerrada (Ciclo, Asignatura, variante de Final, operador de
 * condición, variable, operación, valor booleano, y los `<select>` de
 * destino de nodo) no son "campos de texto libre a rellenar" en el mismo
 * sentido — se quedan con su fondo `--bs-color-bg` de siempre.
 */
function fieldClassName(base: string | undefined, value: string): string {
  // `base` viaja como `string | undefined` porque el módulo CSS se tipa vía
  // `CSSModuleClasses` (`Record<string, string>`) con `noUncheckedIndexedAccess`
  // activo (mismo motivo que el resto del archivo hace `as string` al pasar
  // una clase de este módulo a una API que exige `string`, p.ej.
  // `CSS.escape(styles.metaGroup as string)` en los tests) — en la práctica
  // nunca es `undefined` (la clase existe siempre en el CSS compilado), así
  // que aquí se normaliza con `?? ''` en vez de forzar el cast en cada punto
  // de llamada.
  const safeBase = base ?? ''
  return value.trim() === '' ? `${safeBase} ${styles.fieldEmpty}` : safeBase
}

/** Respuestas de una diapositiva, siempre en el orden fijo interno A→B→C→D
 *  (la letra nunca se muestra; solo ordena) — el array interno conserva el
 *  orden de creación, que puede no coincidir con el orden de letra tras
 *  eliminar y reañadir una intermedia. */
function sortByLetter(responses: DecisionResponse[]): DecisionResponse[] {
  return [...responses].sort(
    (a, b) => RESPONSE_LETTERS.indexOf(a.letter) - RESPONSE_LETTERS.indexOf(b.letter),
  )
}

/** Etiqueta legible de cada color de la paleta cerrada (Tarea "Colorear
 *  diapositivas"), usada como `title`/`aria-label` de su pastilla — nunca
 *  como texto visible aparte (el propio color de fondo de la pastilla ya
 *  identifica la opción). */
const SLIDE_COLOR_LABEL: Record<SlideColor, string> = {
  yellow: 'Amarillo',
  orange: 'Naranja',
  pink: 'Rosa',
  purple: 'Morado',
  cyan: 'Cian',
  gray: 'Gris',
  red: 'Rojo',
}

/** Mapa color de paleta -> clase CSS de la pastilla correspondiente
 *  (`Inspector.module.css`), mismo criterio de mapa explícito que
 *  `SLIDE_COLOR_CARD_CLASS` en `nodeTypes.tsx` (evita indexar `styles` con
 *  una cadena construida dinámicamente). */
const SLIDE_COLOR_SWATCH_CLASS: Record<SlideColor, string | undefined> = {
  yellow: styles.colorSwatchYellow,
  orange: styles.colorSwatchOrange,
  pink: styles.colorSwatchPink,
  purple: styles.colorSwatchPurple,
  cyan: styles.colorSwatchCyan,
  gray: styles.colorSwatchGray,
  red: styles.colorSwatchRed,
}

/**
 * Color de una diapositiva `slide` (nunca `intro`/`final`, que ya tienen su
 * propio fondo fijo por tipo — ver comentario de `SlideColorSchema` en
 * `src/domain/schemas.ts`): fila de pastillas clicables, una por cada color
 * de `SLIDE_COLORS` más "Sin color" para volver a `null`. Situada junto al
 * campo "Ref. oculta" (ver `NodeFields`) por ser, junto al título, uno de los
 * primeros datos que identifican la diapositiva de un vistazo.
 *
 * La pastilla del color actualmente elegido se marca con `.colorSwatchSelected`
 * (borde de acento + halo, mismo criterio que el anillo de selección del
 * lienzo) y `aria-pressed`, para que el estado "elegido" sea perceptible
 * tanto visual como programáticamente (lectores de pantalla).
 */
function SlideColorSection({ node }: { node: SlideNode }) {
  const updateNode = useProjectStore((state) => state.updateNode)

  function swatchClassName(selected: boolean, colorClass?: string): string {
    return [styles.colorSwatch, colorClass, selected && styles.colorSwatchSelected]
      .filter(Boolean)
      .join(' ')
  }

  return (
    <div className={styles.colorSection}>
      <span className={styles.label}>Color</span>
      <div className={styles.colorSwatchRow} role="group" aria-label="Color de la diapositiva">
        <button
          type="button"
          className={swatchClassName(!node.color, styles.colorSwatchNone)}
          aria-pressed={!node.color}
          aria-label="Sin color"
          title="Sin color"
          onClick={() => updateNode(node.id, { color: null })}
        />
        {SLIDE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={swatchClassName(node.color === color, SLIDE_COLOR_SWATCH_CLASS[color])}
            aria-pressed={node.color === color}
            aria-label={SLIDE_COLOR_LABEL[color]}
            title={SLIDE_COLOR_LABEL[color]}
            onClick={() => updateNode(node.id, { color })}
          />
        ))}
      </div>
    </div>
  )
}

type AssetKind = 'image' | 'audio' | 'video'

const ASSET_KIND_LABEL: Record<AssetKind, string> = {
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
function assetTooLargeMessage(error: PersistenceCommandError): string {
  const content = error.content as { max_bytes?: unknown } | undefined
  const maxBytes = typeof content?.max_bytes === 'number' ? content.max_bytes : undefined
  const maxMb = maxBytes !== undefined ? Math.round(maxBytes / (1024 * 1024)) : undefined
  return maxMb !== undefined
    ? `El archivo es demasiado grande (máximo ${maxMb} MB). Prueba con uno más ligero.`
    : 'El archivo es demasiado grande. Prueba con uno más ligero.'
}

interface MediaAttachmentProps {
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
function AssetPreview({
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
function MediaAttachment({
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
          {typeLabel} {position}
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
      {block.type !== 'text' && (
        <AssetPreview
          key={block.assetId}
          kind={block.type}
          assetId={block.assetId}
          filePath={filePath}
          suffix={` ${position}`}
        />
      )}
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
function ContentBlocksSection({ node, filePath }: { node: SlideNode; filePath: string }) {
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

/**
 * ---------------------------------------------------------------------------
 * Variables/condiciones (fase 2 del milestone): controles compartidos por la
 * condición de visibilidad de una respuesta (Tarea 2), los efectos de una
 * respuesta (Tarea 2) y el enrutado condicional de una diapositiva "de
 * continuar" (Tarea 3).
 * ---------------------------------------------------------------------------
 *
 * `ConditionEditor` y `EffectRow` (definidos más abajo) llaman a
 * `onChange`/`onChange(index, ...)` con el objeto COMPLETO ya construido en
 * cada cambio de `<select>` (variable/operador/operación) — no hay "commit on
 * blur" para esos controles porque un `<select>` no tiene un estado
 * intermedio que proteger de spam de historial (a diferencia de un campo de
 * texto). Solo el campo de VALOR numérico usa el patrón "commit on blur"
 * habitual del resto del Inspector (estado local + confirmación en
 * blur/Enter), para no generar una entrada de historial por cada dígito
 * tecleado.
 */

/** Valor de partida razonable al crear una condición/efecto nuevo sobre una
 *  variable: `0` para una numérica, `false` para una booleana. */
function defaultValueForVariable(variable: VariableDef): number | boolean {
  return variable.type === 'boolean' ? false : 0
}

/** Operadores de comparación con sentido sobre una variable booleana: solo
 *  igualdad/desigualdad (ver comentario de `ComparisonOperatorSchema` en
 *  `src/domain/schemas.ts` — el dominio no lo prohíbe a nivel de schema,
 *  pero la UI no tiene motivo para ofrecer `>`/`>=`/`<`/`<=` ahí). */
const BOOLEAN_OPERATORS: ComparisonOperator[] = ['==', '!=']

function operatorsForVariable(variable: VariableDef): readonly ComparisonOperator[] {
  return variable.type === 'boolean' ? BOOLEAN_OPERATORS : COMPARISON_OPERATORS
}

const OPERATOR_LABEL: Record<ComparisonOperator, string> = {
  '==': 'es igual a',
  '!=': 'es distinto de',
  '>': 'es mayor que',
  '>=': 'es mayor o igual que',
  '<': 'es menor que',
  '<=': 'es menor o igual que',
}

const EFFECT_OPERATION_LABEL: Record<VariableEffect['operation'], string> = {
  set: 'fijar a',
  increment: 'sumar',
  decrement: 'restar',
}

/** Construye un `VariableEffect` bien tipado para la unión discriminada por
 *  `operation`: `increment`/`decrement` exigen un `value` `number` (si se
 *  pasa uno no numérico —no debería ocurrir desde esta UI— se sustituye por
 *  `0` en vez de dejar pasar un valor incoherente con el schema). */
function makeEffect(
  variableId: string,
  operation: VariableEffect['operation'],
  value: number | boolean,
): VariableEffect {
  if (operation === 'set') return { variableId, operation: 'set', value }
  return { variableId, operation, value: typeof value === 'number' ? value : 0 }
}

/**
 * Editor de una `VariableCondition`: selector de variable, selector de
 * operador (acotado a `==`/`!=` si la variable es booleana) y campo de
 * valor (número con "commit on blur", o `<select>` Sí/No si la variable es
 * booleana). `idPrefix` desambigua los `id`/`htmlFor` cuando hay varias
 * condiciones en pantalla a la vez (una por respuesta, más la del enrutado
 * condicional de la diapositiva).
 *
 * Cambiar de variable recalcula operador/valor si dejan de tener sentido
 * para el nuevo tipo (p.ej. pasar de una numérica en modo `>` a una
 * booleana resetea el operador a `==`), en vez de dejar guardada una
 * combinación sin sentido — aunque el dominio la tolere (evalúa a `false`,
 * nunca lanza, ver `evaluateCondition`), la UI evita ofrecerla activamente.
 */
function ConditionEditor({
  condition,
  variables,
  onChange,
  onRemove,
  idPrefix,
  removeLabel = 'Quitar condición',
}: {
  condition: VariableCondition
  variables: VariableDef[]
  onChange: (next: VariableCondition) => void
  onRemove: () => void
  idPrefix: string
  removeLabel?: string
}) {
  const variable = variables.find((candidate) => candidate.id === condition.variableId) ?? variables[0]

  const [valueText, setValueText] = useState(
    typeof condition.value === 'number' ? String(condition.value) : '',
  )
  // Resincroniza el texto local con `condition.value` cuando cambia por una
  // vía DISTINTA de teclear en este propio campo (el `<select>` de variable
  // fija un valor por defecto nuevo, o el store cambia desde fuera, p.ej.
  // undo/redo) — mientras el usuario teclea, `condition.value` no cambia
  // hasta el blur/Enter que confirma, así que este efecto no interfiere con
  // la edición en curso. No hay evento de UI al que "colgar" este
  // re-sincronizado (no lo dispara ningún campo de este propio componente),
  // así que un efecto es la herramienta correcta pese al aviso de la regla
  // — mismo criterio que `initialError` en `HomeScreen.tsx`.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (typeof condition.value === 'number') setValueText(String(condition.value))
  }, [condition.value])

  if (!variable) {
    // La variable referenciada ya no existe: no debería ocurrir en la
    // práctica (`deleteVariable` limpia la condición al borrar la variable
    // que referencia), pero se cubre para no romper el resto del panel —
    // solo se ofrece quitar la condición huérfana.
    return (
      <div className={styles.conditionEditor}>
        <button type="button" className={styles.removeResponseButton} onClick={onRemove}>
          {removeLabel}
        </button>
      </div>
    )
  }

  function commitValueText() {
    const parsed = Number(valueText.trim())
    if (Number.isNaN(parsed)) return
    onChange({ ...condition, value: parsed })
  }

  function handleVariableChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextVariable = variables.find((candidate) => candidate.id === event.target.value)
    if (!nextVariable) return
    const validOperators = operatorsForVariable(nextVariable)
    const nextOperator = validOperators.includes(condition.operator) ? condition.operator : '=='
    const nextValue =
      nextVariable.type === 'boolean'
        ? typeof condition.value === 'boolean'
          ? condition.value
          : false
        : typeof condition.value === 'number'
          ? condition.value
          : 0
    onChange({ variableId: nextVariable.id, operator: nextOperator, value: nextValue })
  }

  function handleOperatorChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange({ ...condition, operator: event.target.value as ComparisonOperator })
  }

  function handleBooleanValueChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange({ ...condition, value: event.target.value === 'true' })
  }

  return (
    <div className={styles.conditionEditor}>
      <div>
        <label className={styles.label} htmlFor={`${idPrefix}-variable`}>
          Variable
        </label>
        <select
          id={`${idPrefix}-variable`}
          className={styles.select}
          value={variable.id}
          onChange={handleVariableChange}
        >
          {variables.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={styles.label} htmlFor={`${idPrefix}-operator`}>
          Operador
        </label>
        <select
          id={`${idPrefix}-operator`}
          className={styles.select}
          value={condition.operator}
          onChange={handleOperatorChange}
        >
          {operatorsForVariable(variable).map((operator) => (
            <option key={operator} value={operator}>
              {OPERATOR_LABEL[operator]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={styles.label} htmlFor={`${idPrefix}-value`}>
          Valor
        </label>
        {variable.type === 'boolean' ? (
          <select
            id={`${idPrefix}-value`}
            className={styles.select}
            value={String(condition.value === true)}
            onChange={handleBooleanValueChange}
          >
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        ) : (
          <input
            id={`${idPrefix}-value`}
            className={styles.input}
            type="number"
            value={valueText}
            onChange={(event) => setValueText(event.target.value)}
            onBlur={commitValueText}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitValueText()
            }}
          />
        )}
      </div>
      <button type="button" className={styles.removeResponseButton} onClick={onRemove}>
        {removeLabel}
      </button>
    </div>
  )
}

/**
 * Fila de un efecto de variable dentro de la lista de efectos de una
 * respuesta. A diferencia de una respuesta o de una variable, un
 * `VariableEffect` no lleva `id` propio en el schema (ver
 * `VariableEffectSchema`): la lista se manipula por posición (`index`), que
 * `ResponseEffectsSection` traduce a `updateResponse` reemplazando el array
 * completo (ver `UpdateResponsePatch.effects` en `src/domain/responses.ts`).
 *
 * Igual que `ConditionEditor`: la operación se acota a `set` cuando la
 * variable es booleana (ocultando `increment`/`decrement`, que el dominio
 * trata como no-op silencioso sobre una booleana — mejor no ofrecerlos
 * donde no tienen ningún efecto real).
 */
function EffectRow({
  effect,
  index,
  variables,
  onChange,
  onRemove,
  idPrefix,
}: {
  effect: VariableEffect
  index: number
  variables: VariableDef[]
  onChange: (index: number, next: VariableEffect) => void
  onRemove: (index: number) => void
  /** Desambigua los `id`/`htmlFor` cuando hay listas de efectos de varias
   *  respuestas distintas en pantalla — no ocurre en el modo actual de
   *  edición (solo la respuesta seleccionada se ve a la vez), pero evita
   *  ids duplicados si eso cambiara. */
  idPrefix: string
}) {
  const variable = variables.find((candidate) => candidate.id === effect.variableId) ?? variables[0]

  const [valueText, setValueText] = useState(
    typeof effect.value === 'number' ? String(effect.value) : '',
  )
  // Mismo motivo que el `useEffect` análogo de `ConditionEditor`: resincroniza
  // con `effect.value` cuando cambia por una vía distinta de teclear aquí
  // (cambiar de variable/operación fija un valor por defecto nuevo).
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (typeof effect.value === 'number') setValueText(String(effect.value))
  }, [effect.value])

  if (!variable) {
    return (
      <div className={styles.effectRow}>
        <button
          type="button"
          className={styles.removeResponseButton}
          onClick={() => onRemove(index)}
        >
          Quitar efecto {index + 1}
        </button>
      </div>
    )
  }

  function commitValueText() {
    const parsed = Number(valueText.trim())
    if (Number.isNaN(parsed)) return
    onChange(index, makeEffect(effect.variableId, effect.operation, parsed))
  }

  function handleVariableChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextVariable = variables.find((candidate) => candidate.id === event.target.value)
    if (!nextVariable) return
    const nextOperation: VariableEffect['operation'] =
      nextVariable.type === 'boolean' ? 'set' : effect.operation
    const nextValue: number | boolean =
      nextVariable.type === 'boolean'
        ? typeof effect.value === 'boolean'
          ? effect.value
          : false
        : typeof effect.value === 'number'
          ? effect.value
          : 0
    onChange(index, makeEffect(nextVariable.id, nextOperation, nextValue))
  }

  function handleOperationChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange(
      index,
      makeEffect(effect.variableId, event.target.value as VariableEffect['operation'], effect.value),
    )
  }

  function handleBooleanValueChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange(index, makeEffect(effect.variableId, 'set', event.target.value === 'true'))
  }

  const operations: VariableEffect['operation'][] =
    variable.type === 'boolean' ? ['set'] : ['set', 'increment', 'decrement']

  return (
    <div className={styles.effectRow}>
      <div>
        <label className={styles.label} htmlFor={`${idPrefix}-variable`}>
          Variable del efecto {index + 1}
        </label>
        <select
          id={`${idPrefix}-variable`}
          className={styles.select}
          value={variable.id}
          onChange={handleVariableChange}
        >
          {variables.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={styles.label} htmlFor={`${idPrefix}-operation`}>
          Operación del efecto {index + 1}
        </label>
        <select
          id={`${idPrefix}-operation`}
          className={styles.select}
          value={effect.operation}
          onChange={handleOperationChange}
        >
          {operations.map((operation) => (
            <option key={operation} value={operation}>
              {EFFECT_OPERATION_LABEL[operation]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={styles.label} htmlFor={`${idPrefix}-value`}>
          Valor del efecto {index + 1}
        </label>
        {variable.type === 'boolean' ? (
          <select
            id={`${idPrefix}-value`}
            className={styles.select}
            value={String(effect.value === true)}
            onChange={handleBooleanValueChange}
          >
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        ) : (
          <input
            id={`${idPrefix}-value`}
            className={styles.input}
            type="number"
            value={valueText}
            onChange={(event) => setValueText(event.target.value)}
            onBlur={commitValueText}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitValueText()
            }}
          />
        )}
      </div>
      <button type="button" className={styles.removeResponseButton} onClick={() => onRemove(index)}>
        Quitar efecto {index + 1}
      </button>
    </div>
  )
}

/**
 * Condición de visibilidad de una respuesta (Tarea 2): "esta respuesta solo
 * aparece si...". Sin variables en el proyecto, muestra un aviso sobrio en
 * vez de un desplegable vacío confuso (ver comentario de cabecera de esta
 * sección). Sin condición todavía, un botón "+ Añadir condición" la crea con
 * un valor de partida razonable (primera variable del proyecto, `==`, valor
 * por defecto de su tipo).
 */
function ResponseConditionSection({
  slideNodeId,
  response,
  variables,
}: {
  slideNodeId: string
  response: DecisionResponse
  variables: VariableDef[]
}) {
  const updateResponse = useProjectStore((state) => state.updateResponse)

  function handleEnable() {
    const firstVariable = variables[0]
    if (!firstVariable) return
    updateResponse(slideNodeId, response.id, {
      condition: {
        variableId: firstVariable.id,
        operator: '==',
        value: defaultValueForVariable(firstVariable),
      },
    })
  }

  return (
    <div className={styles.conditionSection}>
      <span className={styles.label}>Condición de visibilidad</span>
      {!response.condition && (
        <button type="button" className={styles.addResponseButton} onClick={handleEnable}>
          + Añadir condición
        </button>
      )}
      {response.condition && (
        <ConditionEditor
          condition={response.condition}
          variables={variables}
          onChange={(next) => updateResponse(slideNodeId, response.id, { condition: next })}
          onRemove={() => updateResponse(slideNodeId, response.id, { condition: null })}
          idPrefix={`inspector-response-condition-${response.id}`}
          removeLabel="Quitar condición"
        />
      )}
    </div>
  )
}

/**
 * Efectos sobre variables aplicados al elegir una respuesta (Tarea 2):
 * "al elegir esta respuesta...". Mismo patrón visual que "+ Añadir
 * respuesta" (botón al final de la lista, debajo del último efecto).
 */
function ResponseEffectsSection({
  slideNodeId,
  response,
  variables,
}: {
  slideNodeId: string
  response: DecisionResponse
  variables: VariableDef[]
}) {
  const updateResponse = useProjectStore((state) => state.updateResponse)
  const effects = response.effects ?? []

  function handleChange(index: number, next: VariableEffect) {
    const nextEffects = effects.map((item, i) => (i === index ? next : item))
    updateResponse(slideNodeId, response.id, { effects: nextEffects })
  }

  function handleRemove(index: number) {
    const remaining = effects.filter((_, i) => i !== index)
    updateResponse(slideNodeId, response.id, { effects: remaining.length > 0 ? remaining : null })
  }

  function handleAdd() {
    const firstVariable = variables[0]
    if (!firstVariable) return
    const newEffect = makeEffect(firstVariable.id, 'set', defaultValueForVariable(firstVariable))
    updateResponse(slideNodeId, response.id, { effects: [...effects, newEffect] })
  }

  return (
    <div className={styles.effectsSection}>
      <span className={styles.label}>Efectos al elegir esta respuesta</span>
      {effects.map((effect, index) => (
        <EffectRow
          key={index}
          effect={effect}
          index={index}
          variables={variables}
          onChange={handleChange}
          onRemove={handleRemove}
          idPrefix={`inspector-response-effect-${response.id}-${index}`}
        />
      ))}
      <button type="button" className={styles.addResponseButton} onClick={handleAdd}>
        + Añadir efecto
      </button>
    </div>
  )
}

/**
 * Bloque combinado de condición + efectos de variables de una respuesta.
 * Sin ninguna variable definida en el proyecto todavía, sustituye ambas
 * secciones por un único aviso sobrio invitando a crearlas desde el panel
 * "Variables" (Tarea 1) — nunca un desplegable vacío. Es seguro asumir que
 * sin variables no puede haber ninguna condición/efecto ya guardado
 * referenciando una: `deleteVariable` (dominio) limpia esas referencias en
 * el momento de borrar la variable, así que si `variables` está vacío, todas
 * las respuestas ya están limpias.
 */
function ResponseVariablesSection({
  slideNodeId,
  response,
  variables,
}: {
  slideNodeId: string
  response: DecisionResponse
  variables: VariableDef[]
}) {
  if (variables.length === 0) {
    return (
      <p className={styles.noVariablesNotice}>
        Todavía no hay variables en el proyecto. Créalas desde el panel "Variables" para poder
        condicionar esta respuesta o modificarlas al elegirla.
      </p>
    )
  }

  return (
    <>
      <ResponseConditionSection slideNodeId={slideNodeId} response={response} variables={variables} />
      <ResponseEffectsSection slideNodeId={slideNodeId} response={response} variables={variables} />
    </>
  )
}

/**
 * Enrutado condicional de una diapositiva "de continuar" (Tarea 3):
 * `condition`+`elseTargetNodeId` de `SlideNode`. Reutiliza `ConditionEditor`
 * (mismo control que la condición de visibilidad de una respuesta) y un
 * `<select>` de destino "si no" idéntico en UX al "Destino de continuar" de
 * `ContinueSection` — mismo `NO_TARGET_VALUE`/`nodeOptionLabel`.
 *
 * Activar/desactivar es una única acción sobre `condition` (crear/borrar);
 * desactivar limpia AMBOS campos (`condition` y `elseTargetNodeId`) en la
 * MISMA llamada a `updateNode` (una sola entrada de historial), como pide el
 * enunciado — no dos llamadas separadas.
 */
function ConditionalRoutingSection({
  node,
  allNodes,
  variables,
}: {
  node: SlideNode
  allNodes: Node[]
  variables: VariableDef[]
}) {
  const updateNode = useProjectStore((state) => state.updateNode)

  function handleEnable() {
    const firstVariable = variables[0]
    if (!firstVariable) return
    updateNode(node.id, {
      condition: {
        variableId: firstVariable.id,
        operator: '==',
        value: defaultValueForVariable(firstVariable),
      },
    })
  }

  function handleDisable() {
    updateNode(node.id, { condition: null, elseTargetNodeId: null })
  }

  function handleElseTargetChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    updateNode(node.id, { elseTargetNodeId: value === NO_TARGET_VALUE ? null : value })
  }

  const elseTargetFieldId = 'inspector-continue-else-target'

  return (
    <div className={styles.conditionalRoutingSection}>
      <h3 className={styles.responsesTitle}>Condición de aparición</h3>
      {!node.condition && variables.length === 0 && (
        <p className={styles.noVariablesNotice}>
          Todavía no hay variables en el proyecto. Créalas desde el panel "Variables" para poder
          condicionar el destino de esta diapositiva.
        </p>
      )}
      {!node.condition && variables.length > 0 && (
        <button type="button" className={styles.addResponseButton} onClick={handleEnable}>
          + Activar condición de aparición
        </button>
      )}
      {node.condition && (
        <>
          <ConditionEditor
            condition={node.condition}
            variables={variables}
            onChange={(next) => updateNode(node.id, { condition: next })}
            onRemove={handleDisable}
            idPrefix="inspector-continue-condition"
            removeLabel="Desactivar condición de aparición"
          />
          <div>
            <label className={styles.label} htmlFor={elseTargetFieldId}>
              Destino "si no"
            </label>
            <select
              id={elseTargetFieldId}
              className={styles.select}
              value={node.elseTargetNodeId ?? NO_TARGET_VALUE}
              onChange={handleElseTargetChange}
            >
              <option value={NO_TARGET_VALUE}>— Sin destino —</option>
              {allNodes.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {nodeOptionLabel(candidate)}
                </option>
              ))}
            </select>
            <p className={styles.helperText}>
              El destino normal (arriba, "Destino de continuar") se usa si la condición es
              verdadera o no hay condición. Este destino "si no" solo se usa cuando la condición
              es falsa.
            </p>
            {!node.elseTargetNodeId && (
              <p className={styles.elseTargetWarning} role="alert">
                ⚠ Sin destino "si no" configurado: cuando la condición no se cumpla, el recorrido
                llegará a un punto sin continuación.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Modo "de continuar" de una diapositiva: destino único de "Continuar" más
 * el texto personalizable de ese botón, y — Tarea 3 — su enrutado
 * condicional opcional. Solo se muestra mientras la diapositiva NO tiene
 * respuestas — en cuanto tiene una, esos campos dejan de tener efecto en el
 * Player (quedan dormidos en el documento, sin borrarse) y se ocultan; si se
 * eliminan todas las respuestas, vuelven a aparecer con el valor que ya
 * tuvieran.
 *
 * Se monta con `key={node.id}` (a través de `NodeFields`) por el mismo
 * motivo que el resto de campos con estado local: el texto en edición debe
 * arrancar limpio al cambiar de nodo.
 */
function ContinueSection({
  node,
  allNodes,
  variables,
}: {
  node: SlideNode
  allNodes: Node[]
  variables: VariableDef[]
}) {
  const updateNode = useProjectStore((state) => state.updateNode)
  const connect = useProjectStore((state) => state.connect)
  const disconnect = useProjectStore((state) => state.disconnect)

  // Mismo criterio "commit on blur" que el título del nodo: estado local +
  // confirmación en blur/Enter/desmontaje, comparando contra lo último
  // confirmado para no generar entradas de historial vacías.
  const [label, setLabel] = useState(node.continueLabel ?? '')
  const committedRef = useRef(node.continueLabel ?? '')
  const latestRef = useRef(label)
  latestRef.current = label

  useEffect(() => {
    return () => {
      commitPending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commitPending() {
    const pending = latestRef.current
    if (pending === committedRef.current) return
    // Vacío significa "vuelve al texto por defecto" (`null` borra el campo).
    updateNode(node.id, { continueLabel: pending.trim() === '' ? null : pending })
    committedRef.current = pending
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      commitPending()
    }
  }

  function handleTargetChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    if (value === NO_TARGET_VALUE) {
      if (node.targetNodeId) {
        disconnect(node.id)
      }
    } else {
      connect(node.id, value)
    }
  }

  const targetFieldId = 'inspector-continue-target'
  const labelFieldId = 'inspector-continue-label'

  return (
    <div className={styles.continueSection}>
      <div>
        <label className={styles.label} htmlFor={targetFieldId}>
          Destino de continuar
        </label>
        <select
          id={targetFieldId}
          className={styles.select}
          value={node.targetNodeId ?? NO_TARGET_VALUE}
          onChange={handleTargetChange}
        >
          <option value={NO_TARGET_VALUE}>— Sin destino —</option>
          {allNodes.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {nodeOptionLabel(candidate)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={styles.label} htmlFor={labelFieldId}>
          Texto del botón de continuar
        </label>
        <input
          id={labelFieldId}
          className={fieldClassName(styles.input, label)}
          type="text"
          value={label}
          placeholder={DEFAULT_CONTINUE_LABEL}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={commitPending}
          onKeyDown={handleKeyDown}
        />
      </div>
      <ConditionalRoutingSection node={node} allNodes={allNodes} variables={variables} />
    </div>
  )
}

/**
 * Sentinela del `<select>` de ciclo/asignatura de la diapositiva de Inicio
 * cuando no hay ninguno elegido. A diferencia de `NO_TARGET_VALUE` (que debe
 * ser un valor que NUNCA coincida con un id real, siempre UUID), `cicloId`/
 * `asignaturaId` son slugs/códigos del catálogo (`src/domain/catalog.ts`),
 * nunca vacíos — así que la cadena vacía nativa del `<select>` sin opción
 * elegida es un sentinela perfectamente seguro aquí, sin necesitar un valor
 * "mágico" como `NO_TARGET_VALUE`.
 */
const NO_CATALOG_VALUE = ''

/**
 * Edición de la diapositiva de Inicio (nodo `intro`, milestone "Diapositiva
 * de Inicio", Tarea 2): ciclo → asignatura en cascada, nombre del caso
 * práctico y destino tras la portada. Sustituye por completo a
 * `ContentBlocksSection`/`ContinueSection`/`ResponsesSection` para este tipo
 * de nodo — un `intro` no tiene bloques de contenido ni respuestas.
 *
 * Cascada ciclo → asignatura: cambiar de ciclo limpia `asignaturaId` en la
 * MISMA llamada a `updateNode` (una sola entrada de historial) cuando la
 * asignatura ya elegida no pertenece al ciclo nuevo (`asignaturaBelongsToCiclo`,
 * `src/domain/introValidation.ts`) — nunca se deja guardada una combinación
 * incoherente, ni siquiera momentáneamente entre dos acciones separadas. El
 * `<select>` de asignatura se deshabilita mientras no haya ciclo elegido, con
 * un aviso explícito en vez de un desplegable vacío confuso.
 *
 * "Destino tras la portada" (`targetNodeId`) reutiliza exactamente el mismo
 * patrón que "Destino de continuar" de `ContinueSection`: mismo sentinela
 * `NO_TARGET_VALUE`, mismo `connect`/`disconnect` genéricos (ya aceptan un
 * `intro` como origen, ver `src/domain/graph.ts`), mismo `nodeOptionLabel`.
 * Sin aviso textual propio aquí si falta destino — el aviso visual de "sin
 * salida" ya lo cubre el lienzo (ver `adapter.ts`/`nodeTypes.tsx`, que
 * detectan un `intro` sin `targetNodeId` con el mismo criterio que una
 * diapositiva "de continuar" sin destino), exactamente igual que
 * `ContinueSection` tampoco duplica ese aviso en el Inspector.
 */
function IntroSection({ node, allNodes }: { node: IntroNode; allNodes: Node[] }) {
  const updateNode = useProjectStore((state) => state.updateNode)
  const connect = useProjectStore((state) => state.connect)
  const disconnect = useProjectStore((state) => state.disconnect)

  // Mismo criterio "commit on blur" que el resto de campos de texto libre
  // del Inspector (título, nota interna...): estado local + confirmación en
  // blur/Enter/desmontaje.
  const [caseName, setCaseName] = useState(node.caseName)
  const committedRef = useRef(node.caseName)
  const latestRef = useRef(caseName)
  latestRef.current = caseName

  useEffect(() => {
    return () => {
      commitCaseName()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commitCaseName() {
    const pending = latestRef.current
    if (pending === committedRef.current) return
    updateNode(node.id, { caseName: pending })
    committedRef.current = pending
  }

  function handleCaseNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') commitCaseName()
  }

  function handleCicloChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextCicloId = event.target.value
    if (nextCicloId === NO_CATALOG_VALUE) {
      updateNode(node.id, { cicloId: null, asignaturaId: null })
      return
    }
    const asignaturaStillValid = node.asignaturaId
      ? asignaturaBelongsToCiclo(nextCicloId, node.asignaturaId)
      : false
    updateNode(node.id, {
      cicloId: nextCicloId,
      // `undefined` (no tocar) si la asignatura ya elegida sigue
      // perteneciendo al ciclo nuevo; `null` (borrar) si no.
      asignaturaId: asignaturaStillValid ? undefined : null,
    })
  }

  function handleAsignaturaChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    updateNode(node.id, { asignaturaId: value === NO_CATALOG_VALUE ? null : value })
  }

  function handleTargetChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    if (value === NO_TARGET_VALUE) {
      if (node.targetNodeId) {
        disconnect(node.id)
      }
    } else {
      connect(node.id, value)
    }
  }

  const selectedCiclo = node.cicloId
    ? CICLOS.find((candidate) => candidate.id === node.cicloId)
    : undefined
  const asignaturaOptions = selectedCiclo?.asignaturas ?? []

  const cicloFieldId = 'inspector-intro-ciclo'
  const asignaturaFieldId = 'inspector-intro-asignatura'
  const caseNameFieldId = 'inspector-intro-case-name'
  const targetFieldId = 'inspector-intro-target'

  return (
    <div className={styles.introSection}>
      <div>
        <label className={styles.label} htmlFor={cicloFieldId}>
          Ciclo
        </label>
        <select
          id={cicloFieldId}
          className={styles.select}
          value={node.cicloId ?? NO_CATALOG_VALUE}
          onChange={handleCicloChange}
        >
          <option value={NO_CATALOG_VALUE}>— Elige un ciclo —</option>
          {CICLOS.map((ciclo) => (
            <option key={ciclo.id} value={ciclo.id}>
              {ciclo.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={styles.label} htmlFor={asignaturaFieldId}>
          Asignatura
        </label>
        <select
          id={asignaturaFieldId}
          className={styles.select}
          value={node.asignaturaId ?? NO_CATALOG_VALUE}
          onChange={handleAsignaturaChange}
          disabled={!node.cicloId}
        >
          <option value={NO_CATALOG_VALUE}>— Elige una asignatura —</option>
          {asignaturaOptions.map((asignatura) => (
            <option key={asignatura.id} value={asignatura.id}>
              {asignatura.name}
            </option>
          ))}
        </select>
        {!node.cicloId && <p className={styles.helperText}>Elige primero un ciclo.</p>}
      </div>
      <div>
        <label className={styles.label} htmlFor={caseNameFieldId}>
          Nombre del caso práctico interactivo
        </label>
        <input
          id={caseNameFieldId}
          className={fieldClassName(styles.input, caseName)}
          type="text"
          value={caseName}
          onChange={(event) => setCaseName(event.target.value)}
          onBlur={commitCaseName}
          onKeyDown={handleCaseNameKeyDown}
        />
      </div>
      <div>
        <label className={styles.label} htmlFor={targetFieldId}>
          Destino tras la portada
        </label>
        <select
          id={targetFieldId}
          className={styles.select}
          value={node.targetNodeId ?? NO_TARGET_VALUE}
          onChange={handleTargetChange}
        >
          <option value={NO_TARGET_VALUE}>— Sin destino —</option>
          {allNodes.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {nodeOptionLabel(candidate)}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

/**
 * Una fila de respuesta dentro del inspector de una diapositiva: texto
 * editable ("commit on blur", mismo criterio que título/body), `<select>` de
 * destino, puntuación e imagen/audio.
 *
 * `index` es la posición 1-based de la respuesta en el orden mostrado, y se
 * usa solo para desambiguar las etiquetas visibles y los nombres accesibles
 * ("Texto de la respuesta 2"). Deliberadamente NO se usa la letra
 * (A/B/C/D): sigue existiendo en el dominio como criterio de orden, pero no
 * se muestra nunca al usuario.
 *
 * Se monta con `key={response.id}` desde `ResponsesSection` por el mismo
 * motivo que `NodeFields` se monta con `key={node.id}`: el estado local de
 * texto debe arrancar limpio para cada respuesta y no reutilizarse entre
 * respuestas distintas si la lista se reordena.
 */
function ResponseRow({
  slideNodeId,
  response,
  index,
  allNodes,
  filePath,
  variables,
}: {
  slideNodeId: string
  response: DecisionResponse
  index: number
  allNodes: Node[]
  filePath: string
  variables: VariableDef[]
}) {
  const updateResponse = useProjectStore((state) => state.updateResponse)
  const removeResponse = useProjectStore((state) => state.removeResponse)
  const connect = useProjectStore((state) => state.connect)
  const disconnect = useProjectStore((state) => state.disconnect)

  const [text, setText] = useState(response.text)
  const committedRef = useRef(response.text)
  const latestRef = useRef(text)
  latestRef.current = text

  // Puntuación: mismo criterio "commit on blur" que el texto, pero como
  // campo de texto local independiente (una cadena, no un número) para
  // poder representar "vacío" sin forzar un `0` cuando el usuario no ha
  // tocado el campo. `response.points` ausente -> cadena vacía.
  const [pointsText, setPointsText] = useState(
    response.points !== undefined ? String(response.points) : '',
  )
  const pointsCommittedRef = useRef(pointsText)
  const pointsLatestRef = useRef(pointsText)
  pointsLatestRef.current = pointsText

  useEffect(() => {
    return () => {
      commitPending()
      commitPendingPoints()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commitPending() {
    if (latestRef.current !== committedRef.current) {
      updateResponse(slideNodeId, response.id, { text: latestRef.current })
      committedRef.current = latestRef.current
    }
  }

  function commitPendingPoints() {
    const pending = pointsLatestRef.current
    if (pending === pointsCommittedRef.current) {
      return
    }
    const trimmed = pending.trim()
    if (trimmed === '') {
      updateResponse(slideNodeId, response.id, { points: null })
      pointsCommittedRef.current = pending
      return
    }
    const parsed = Number(trimmed)
    if (Number.isNaN(parsed)) {
      // Entrada no numérica: no se confirma nada (queda pendiente hasta un
      // valor válido o un vaciado explícito).
      return
    }
    updateResponse(slideNodeId, response.id, { points: parsed })
    pointsCommittedRef.current = pending
  }

  function handlePointsKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      commitPendingPoints()
    }
  }

  function handleTargetChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    if (value === NO_TARGET_VALUE) {
      if (response.targetNodeId) {
        disconnect(slideNodeId, response.id)
      }
    } else {
      connect(slideNodeId, value, response.id)
    }
  }

  const textFieldId = `inspector-response-text-${response.id}`
  const targetFieldId = `inspector-response-target-${response.id}`
  const pointsFieldId = `inspector-response-points-${response.id}`
  const responseContextLabel = `de la respuesta ${index}`

  return (
    <div className={styles.responseRow}>
      <div className={styles.responseRowHeader}>
        <span className={styles.responseBullet} aria-hidden="true" />
        <button
          type="button"
          className={styles.removeResponseButton}
          onClick={() => removeResponse(slideNodeId, response.id)}
          aria-label={`Eliminar respuesta ${index}`}
        >
          Eliminar
        </button>
      </div>
      <div>
        <label className={styles.label} htmlFor={textFieldId}>
          Texto de la respuesta {index}
        </label>
        <textarea
          id={textFieldId}
          className={fieldClassName(styles.textarea, text)}
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commitPending}
        />
      </div>
      <div>
        <label className={styles.label} htmlFor={targetFieldId}>
          Destino de la respuesta {index}
        </label>
        <select
          id={targetFieldId}
          className={styles.select}
          value={response.targetNodeId ?? NO_TARGET_VALUE}
          onChange={handleTargetChange}
        >
          <option value={NO_TARGET_VALUE}>— Sin destino —</option>
          {allNodes.map((node) => (
            <option key={node.id} value={node.id}>
              {nodeOptionLabel(node)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={styles.label} htmlFor={pointsFieldId}>
          Puntuación de la respuesta {index}
        </label>
        <input
          id={pointsFieldId}
          className={styles.input}
          type="number"
          value={pointsText}
          onChange={(event) => setPointsText(event.target.value)}
          onBlur={commitPendingPoints}
          onKeyDown={handlePointsKeyDown}
        />
      </div>
      <div className={styles.responseMediaRow}>
        <div>
          <span className={styles.label}>Imagen</span>
          <MediaAttachment
            kind="image"
            assetId={response.imageAssetId}
            filePath={filePath}
            onAttach={(assetId) =>
              updateResponse(slideNodeId, response.id, { imageAssetId: assetId })
            }
            onRemove={() => updateResponse(slideNodeId, response.id, { imageAssetId: null })}
            contextLabel={responseContextLabel}
          />
        </div>
        <div>
          <span className={styles.label}>Audio</span>
          <MediaAttachment
            kind="audio"
            assetId={response.audioAssetId}
            filePath={filePath}
            onAttach={(assetId) =>
              updateResponse(slideNodeId, response.id, { audioAssetId: assetId })
            }
            onRemove={() => updateResponse(slideNodeId, response.id, { audioAssetId: null })}
            contextLabel={responseContextLabel}
          />
        </div>
      </div>
      <ResponseVariablesSection slideNodeId={slideNodeId} response={response} variables={variables} />
    </div>
  )
}

/**
 * Sección de respuestas de una diapositiva. Se muestra SIEMPRE (para
 * cualquier diapositiva), porque "+ Añadir respuesta" es justo la vía por la
 * que una diapositiva "de continuar" se convierte en decisión — ya no hay un
 * tipo de nodo "Decisión" que crear desde el panel izquierdo. Con 0
 * respuestas solo se ve la cabecera con ese botón.
 */
/**
 * Sección de respuestas de una diapositiva. Se muestra SIEMPRE (para
 * cualquier diapositiva), porque "+ Añadir respuesta" es justo la vía por la
 * que una diapositiva "de continuar" se convierte en decisión — ya no hay un
 * tipo de nodo "Decisión" que crear desde el panel izquierdo. Con 0
 * respuestas solo se ve la cabecera con ese botón.
 *
 * El botón "+ Añadir respuesta" vive DENTRO de `.responsesList` (el mismo
 * flujo vertical que las filas de respuesta), como último elemento — no en
 * una cabecera aparte — para que aparezca justo debajo de la última
 * respuesta añadida: el flujo natural es "añades una, el botón para la
 * siguiente aparece justo debajo". Desaparece al llegar a `MAX_RESPONSES`.
 */
function ResponsesSection({
  node,
  allNodes,
  filePath,
  variables,
}: {
  node: SlideNode
  allNodes: Node[]
  filePath: string
  variables: VariableDef[]
}) {
  const addResponse = useProjectStore((state) => state.addResponse)
  const canAddResponse = node.responses.length < MAX_RESPONSES
  const responses = sortByLetter(node.responses)

  return (
    <div className={styles.responsesSection}>
      <h3 className={styles.responsesTitle}>Respuestas</h3>
      <div className={styles.responsesList}>
        {responses.map((response, index) => (
          <ResponseRow
            key={response.id}
            slideNodeId={node.id}
            response={response}
            index={index + 1}
            allNodes={allNodes}
            filePath={filePath}
            variables={variables}
          />
        ))}
        {canAddResponse && (
          <button
            type="button"
            className={styles.addResponseButton}
            onClick={() => addResponse(node.id)}
          >
            + Añadir respuesta
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Diapositivas conectadas con el nodo seleccionado (fase de navegación
 * rápida): las que APUNTAN a este nodo, y las que ESTE nodo referencia.
 * Calculado con `deriveEdges` (dominio): esa función ya encapsula
 * exactamente la definición de "salida" de un nodo (el `targetNodeId` de una
 * diapositiva "de continuar", o el de cada respuesta con destino de una "de
 * decisión"), así que no se duplica esa regla aquí.
 */
function incomingNodesOf(project: ProjectDocument, nodeId: string): Node[] {
  const edges = deriveEdges(project)
  const sourceIds = new Set(edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source))
  return project.graph.nodes.filter((node) => sourceIds.has(node.id))
}

function outgoingNodesOf(project: ProjectDocument, nodeId: string): Node[] {
  const edges = deriveEdges(project)
  const targetIds = new Set(edges.filter((edge) => edge.source === nodeId).map((edge) => edge.target))
  return project.graph.nodes.filter((node) => targetIds.has(node.id))
}

/**
 * Navegación rápida entre diapositivas conectadas: quién apunta a este nodo
 * y a quién apunta este nodo. Cada elemento es clicable y reutiliza
 * `focusNode` (mismo mecanismo que `LeftPanel`) para seleccionar y centrar
 * el lienzo en el nodo elegido — no se inventa un mecanismo nuevo. No se
 * muestra nada si el nodo no tiene ninguna conexión en ningún sentido.
 */
function ConnectionsSection({ node, project }: { node: Node; project: ProjectDocument }) {
  const focusNode = useProjectStore((state) => state.focusNode)
  const incoming = incomingNodesOf(project, node.id)
  const outgoing = outgoingNodesOf(project, node.id)

  if (incoming.length === 0 && outgoing.length === 0) return null

  return (
    <div className={styles.connectionsSection}>
      {incoming.length > 0 && (
        <div>
          <h3 className={styles.connectionsTitle}>Diapositivas que llevan aquí</h3>
          <ul className={styles.connectionsList}>
            {incoming.map((source) => (
              <li key={source.id}>
                <button
                  type="button"
                  className={styles.connectionItem}
                  onClick={() => focusNode(source.id)}
                >
                  {nodeOptionLabel(source)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {outgoing.length > 0 && (
        <div>
          <h3 className={styles.connectionsTitle}>A dónde lleva esta diapositiva</h3>
          <ul className={styles.connectionsList}>
            {outgoing.map((target) => (
              <li key={target.id}>
                <button
                  type="button"
                  className={styles.connectionItem}
                  onClick={() => focusNode(target.id)}
                >
                  {nodeOptionLabel(target)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * Nota interna del diseñador instruccional (p.ej. "pedir gráfico a diseño"):
 * campo de texto libre, puramente de uso del equipo — nunca aparece en el
 * HTML/SCORM exportado (ver `stripEditorOnlyFields` en
 * `src/export/htmlBundle.ts`) ni en `PlayerScreen` (a diferencia del título,
 * que sí se ve en gris ahí). Mismo criterio "commit on blur" que el resto de
 * campos de texto de este panel. Disponible para cualquier tipo de nodo.
 */
function InternalNoteField({ node }: { node: Node }) {
  const updateNode = useProjectStore((state) => state.updateNode)

  const [value, setValue] = useState(node.internalNote ?? '')
  const committedRef = useRef(node.internalNote ?? '')
  const latestRef = useRef(value)
  latestRef.current = value

  useEffect(() => {
    return () => {
      commitPending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commitPending() {
    const pending = latestRef.current
    if (pending === committedRef.current) return
    updateNode(node.id, { internalNote: pending.trim() === '' ? null : pending })
    committedRef.current = pending
  }

  const fieldId = 'inspector-internal-note'

  return (
    <div>
      <label className={styles.label} htmlFor={fieldId}>
        Nota interna (no se exporta)
      </label>
      <textarea
        id={fieldId}
        className={fieldClassName(styles.textarea, value)}
        rows={3}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commitPending}
      />
    </div>
  )
}

/**
 * Botón de eliminar el nodo seleccionado, con confirmación INLINE (nunca
 * `window.confirm()` del navegador ni un modal propio — mismo criterio "sin
 * diálogos/overlays propios" que el resto de la app, ver comentario de
 * diseño en `HomeScreen`). El primer clic NO borra nada todavía: sustituye
 * el propio botón por un aviso con dos acciones, "Sí, eliminar" (la única
 * que de verdad llama a `deleteNode`) y "Cancelar" (vuelve al botón normal
 * sin tocar el documento).
 *
 * Nunca se monta para la diapositiva de inicio: `NodeFields` ya filtra ese
 * caso antes de renderizar este componente (ver `node.id !== startNodeId`
 * más abajo) — el dominio (`store.deleteNode`) lanzaría si se intentara
 * borrar de todos modos.
 *
 * Estado de confirmación puramente local (`useState`, no en el store): al
 * montarse con `key={node.id}` a través de `NodeFields` (ver su comentario
 * de diseño), cambiar de nodo seleccionado destruye y vuelve a crear esta
 * instancia, así que la confirmación nunca queda "colgada" de un nodo
 * distinto al que se está mirando.
 */
function DeleteNodeButton({ node }: { node: Node }) {
  const deleteNode = useProjectStore((state) => state.deleteNode)
  const [confirming, setConfirming] = useState(false)
  const typeLabel = NODE_TYPE_LABEL[node.type].toLowerCase()

  if (confirming) {
    return (
      <div className={styles.deleteNodeConfirm}>
        <span className={styles.deleteNodeConfirmText}>¿Eliminar {typeLabel}?</span>
        <div className={styles.deleteNodeConfirmActions}>
          <button
            type="button"
            className={styles.deleteNodeConfirmButton}
            onClick={() => deleteNode(node.id)}
          >
            Sí, eliminar
          </button>
          <button
            type="button"
            className={styles.cancelDeleteButton}
            onClick={() => setConfirming(false)}
          >
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      className={styles.deleteNodeButton}
      onClick={() => setConfirming(true)}
    >
      Eliminar {typeLabel}
    </button>
  )
}

/**
 * Botón "Duplicar" del nodo seleccionado (Tarea 1, "Duplicar diapositivas").
 * A diferencia de `DeleteNodeButton`, no lleva confirmación: duplicar no es
 * una acción destructiva (crea un nodo nuevo, nunca toca ni sobrescribe el
 * original) y ya cuenta con deshacer si el usuario se arrepiente, mismo
 * criterio que el resto de acciones directas de esta app (p.ej. "Ordenar
 * automáticamente" en `Canvas`).
 *
 * Disponible también para la diapositiva de inicio (a diferencia de
 * `DeleteNodeButton`, que `NodeFields` nunca monta para ella): duplicarla es
 * perfectamente seguro porque la copia NO hereda esa condición especial —
 * ver el comentario de diseño de `duplicateNode` en `src/domain/project.ts`.
 */
function DuplicateNodeButton({ node }: { node: Node }) {
  const duplicateNode = useProjectStore((state) => state.duplicateNode)
  const typeLabel = NODE_TYPE_LABEL[node.type].toLowerCase()

  return (
    <button
      type="button"
      className={styles.duplicateNodeButton}
      onClick={() => duplicateNode(node.id)}
    >
      Duplicar {typeLabel}
    </button>
  )
}

/**
 * Etiqueta legible de cada variante de un nodo `final` (estructura de datos
 * únicamente por ahora, ver comentario de `FinalVariantSchema` en
 * `src/domain/schemas.ts`: el TEXTO real de cada variante lo aportará el
 * usuario más adelante, este desplegable solo fija la categoría).
 */
const FINAL_VARIANT_LABEL: Record<FinalVariant, string> = {
  general: 'Final general',
  good: 'Final bueno',
  bad: 'Final malo',
}

/**
 * Desplegable de variante de un nodo `final` (general/bueno/malo, ver
 * `FinalVariantSchema`). Cambiar de variante es un único `updateNode` con
 * SOLO `variant` en el patch — nunca toca ni vacía `body` (el texto del
 * Final, editado aparte más abajo por `RichTextEditor`): son campos
 * completamente independientes, ver comentario de `UpdateNodePatch.variant`
 * en `src/domain/project.ts`. Sin "commit on blur": un `<select>` no tiene
 * estado intermedio que proteger, mismo criterio que el resto de selectores
 * de este archivo (`SlideColorSection`, `ConditionEditor`...).
 */
function FinalVariantSection({ node }: { node: FinalNode }) {
  const updateNode = useProjectStore((state) => state.updateNode)
  const fieldId = 'inspector-final-variant'

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    updateNode(node.id, { variant: event.target.value as FinalVariant })
  }

  return (
    <div>
      <label className={styles.label} htmlFor={fieldId}>
        Variante
      </label>
      <select id={fieldId} className={styles.select} value={node.variant} onChange={handleChange}>
        {FINAL_VARIANTS.map((variant) => (
          <option key={variant} value={variant}>
            {FINAL_VARIANT_LABEL[variant]}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * Campos de edición de un nodo (título/body), comunes a cualquier tipo, más
 * — para una Diapositiva — sus adjuntos, su modo "de continuar" (si no tiene
 * respuestas) y la sección de respuestas.
 *
 * Se monta con `key={node.id}` desde `Inspector` para que cambiar de nodo
 * seleccionado destruya y vuelva a crear esta instancia en vez de
 * reutilizarla. Eso da dos cosas gratis:
 * - Los campos locales (`title`, y los de sus secciones hijas) siempre
 *   arrancan con el valor del nodo recién seleccionado, sin lógica de
 *   sincronización manual.
 * - El efecto de limpieza (`useEffect` con `return () => ...`) se ejecuta
 *   exactamente cuando se abandona ese nodo (cambio de selección o
 *   deselección total), y ahí se confirma cualquier edición pendiente que
 *   no hubiera pasado por `onBlur` — el criterio elegido para "¿qué pasa
 *   si cambias de nodo sin hacer blur?".
 */
function NodeFields({
  node,
  allNodes,
  startNodeId,
  filePath,
  project,
}: {
  node: Node
  allNodes: Node[]
  startNodeId: string
  filePath: string
  project: ProjectDocument
}) {
  const updateNode = useProjectStore((state) => state.updateNode)
  const titleFocusRequestNodeId = useTitleFocusRequestNodeId()
  const clearTitleFocusRequest = useProjectStore((state) => state.clearTitleFocusRequest)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // El campo `body` (editor de texto enriquecido) no se gestiona aquí como
  // estado local de texto — `RichTextEditor` confirma sus propios cambios en
  // el store vía su prop `onCommit`, con el mismo criterio "commit on blur"
  // (ver `RichTextEditor.tsx`). Este componente solo gestiona el título.
  const [title, setTitle] = useState(node.title)

  // Snapshot de lo último confirmado contra el store, para no repetir un
  // `updateNode` si el valor local coincide con lo ya guardado (evita una
  // entrada de historial vacía, p.ej. blur sin haber tecleado nada, o un
  // segundo blur tras un commit ya hecho con Enter).
  const committedRef = useRef({ title: node.title })
  // Siempre el valor local más reciente, para poder leerlo desde el
  // cleanup del efecto de desmontaje sin depender de closures obsoletas.
  const latestRef = useRef({ title })
  latestRef.current = { title }

  useEffect(() => {
    return () => {
      commitPending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Foco de título tras crear un nodo desde el menú "¿Qué quieres añadir?"
  // (ver `ui.titleFocusRequestNodeId`). Solo actúa cuando la petición apunta
  // exactamente a este nodo — una selección "normal" (clic en `LeftPanel` o
  // en el lienzo) nunca fija este campo, así que nunca le roba el foco al
  // usuario en esos casos. Se limpia inmediatamente para no repetir el foco
  // en renders posteriores.
  useEffect(() => {
    if (titleFocusRequestNodeId === node.id) {
      titleInputRef.current?.focus()
      clearTitleFocusRequest()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleFocusRequestNodeId, node.id])

  function commitPending() {
    const pending = latestRef.current
    const committed = committedRef.current
    if (pending.title !== committed.title) {
      updateNode(node.id, { title: pending.title })
      committedRef.current = { title: pending.title }
    }
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      commitPending()
    }
  }

  // "Ref. oculta" es la etiqueta de UI del campo `title` del dominio (el
  // nombre del campo en el modelo/schema no cambia, solo su texto visible —
  // ver también `nodeOptionLabel` más arriba y los "Sin ref. oculta" de
  // `LeftPanel`/`nodeTypes.tsx`, que otro proceso en paralelo actualiza a
  // "Sin ref. oculta" — fuera de mi alcance en este archivo). `id`/`htmlFor`
  // se dejan como estaban: son detalle interno del DOM, no texto visible.
  // Extraído a una variable (en vez de repetir el JSX) porque Tarea 4 lo
  // sitúa en dos posiciones distintas del árbol según el tipo de nodo (ver
  // más abajo): dentro del grupo "sobre esta diapositiva en sí" para una
  // `slide`, en su posición de siempre para `final`. Milestone "Inicio
  // siempre es D1": NUNCA se renderiza para un `intro` (ver más abajo) — el
  // Inicio no necesita esta referencia interna, su identidad ya es clara por
  // sí misma (ciclo/asignatura/caso + ser el único punto de partida del
  // proyecto). Antes de este milestone se mostraba también para `intro`
  // como "una nota interna más"; ya no.
  const referenceField = (
    <div>
      <label className={styles.label} htmlFor="inspector-node-title">
        Ref. oculta
      </label>
      <input
        id="inspector-node-title"
        ref={titleInputRef}
        className={fieldClassName(styles.input, title)}
        type="text"
        value={title}
        // Mismo corrector nativo del sistema/navegador que `RichTextEditor`
        // (fase 8), por consistencia — este campo no tiene su propio botón
        // de activar/desactivar (solo el editor de contenido lo necesita).
        spellCheck
        lang="es"
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commitPending}
        onKeyDown={handleTitleKeyDown}
      />
    </div>
  )

  return (
    <div className={styles.fields}>
      {node.type === 'slide' ? (
        /* Tarea 4 (reorganización del Inspector): Color + Ref. oculta +
           Contenido (bloques) + Nota interna agrupados en un bloque
           diferenciado ("sobre esta diapositiva en sí"), con Color arriba
           del todo — antes que "Ref. oculta" — y el orden relativo de
           Ref. oculta/Contenido/Nota interna intacto respecto al de siempre.
           El resto de la sección (destino/respuestas/enrutado condicional/
           conexiones) queda FUERA de este bloque, ver más abajo — mismo
           contenedor con borde/fondo sutil (`.metaGroup`,
           `Inspector.module.css`) que ya usa el resto de la app para
           agrupar visualmente (p.ej. `VariablesPanel`). */
        <div className={styles.metaGroup}>
          <SlideColorSection node={node} />
          {referenceField}
          <ContentBlocksSection node={node} filePath={filePath} />
          <InternalNoteField node={node} />
        </div>
      ) : (
        <>
          {/* Milestone "Inicio siempre es D1": "Ref. oculta" ya NO se
              muestra para un `intro` — decisión deliberada (antes se
              consideraba "solo una nota interna más" y se dejaba visible
              también ahí, ver historial de este comentario): el Inicio no
              necesita esa referencia interna, su identidad ya es clara por
              sí misma (ciclo/asignatura/caso + ser el único punto de partida
              del proyecto). Sigue exactamente igual para `final`. */}
          {node.type !== 'intro' && referenceField}
          {node.type === 'final' && (
            <>
              <FinalVariantSection node={node} />
              <div>
                <span id="inspector-node-body-label" className={styles.label}>
                  Contenido
                </span>
                <RichTextEditor
                  body={node.body}
                  onCommit={(nextBody) => updateNode(node.id, { body: nextBody })}
                  ariaLabelledBy="inspector-node-body-label"
                />
              </div>
            </>
          )}
          {/* Diapositiva de Inicio (Tarea 2, milestone "Diapositiva de
              Inicio"): ciclo/asignatura/nombre de caso/destino, ver
              `IntroSection`. */}
          {node.type === 'intro' && <IntroSection node={node} allNodes={allNodes} />}
          <InternalNoteField node={node} />
        </>
      )}
      {node.type === 'slide' && (
        <>
          {node.responses.length === 0 && (
            <ContinueSection node={node} allNodes={allNodes} variables={project.variables} />
          )}
          <ResponsesSection
            node={node}
            allNodes={allNodes}
            filePath={filePath}
            variables={project.variables}
          />
        </>
      )}
      <ConnectionsSection node={node} project={project} />
      {/* "Duplicar" (sin confirmación, ver su comentario de diseño) y
          "Eliminar" (con confirmación inline de dos pasos, ver
          `DeleteNodeButton`), agrupados para que se lean como un mismo
          bloque de acciones sobre el nodo. Ninguno de los dos se muestra
          para un nodo `intro` (milestone "Diapositiva de Inicio"): el
          dominio los rechaza incondicionalmente (`deleteNode`/
          `duplicateNode` en `src/domain/project.ts` lanzan siempre para
          `type === 'intro'`, solo puede haber uno por proyecto), así que
          ofrecer un botón garantizado a fallar sería mala UX — ni siquiera
          con confirmación. "Eliminar" además nunca se muestra para la
          diapositiva de inicio "clásica" (una `SlideNode` que es
          `startNodeId` en un documento sin `intro` todavía) —
          `store.deleteNode` (dominio) lanzaría igual si se intentara. */}
      {node.type !== 'intro' && (
        <div className={styles.nodeActions}>
          <DuplicateNodeButton node={node} />
          {node.id !== startNodeId && <DeleteNodeButton node={node} />}
        </div>
      )}
    </div>
  )
}

export interface InspectorProps {
  /**
   * Ruta absoluta del `.brunch` abierto. La necesitan los controles de
   * imagen/audio (`ContentBlocksSection`/`ResponseRow` vía `MediaAttachment`)
   * para importar/leer assets del documento actual
   * (`assetRepository.importAsset`/`getAsset`). Prop-drilling explícito
   * desde `EditorScreen`, mismo criterio que ya se usa para `filePath` en
   * el resto de la app (`useAutosave`): es un detalle de la sesión de
   * edición, no del documento, así que no vive en `useProjectStore`.
   */
  filePath: string
}

/**
 * Asa de arrastre en el borde izquierdo del Inspector para redimensionarlo.
 * Arrastrar el ratón mueve el `pointer capture` a este propio elemento
 * (`setPointerCapture`), así que sigue recibiendo `pointermove` aunque el
 * cursor salga de la franja de 6px durante el gesto — sin necesidad de
 * escuchar en `window`. El ancho se ajusta a los límites vigentes
 * (`clampInspectorWidth`) en cada movimiento y se persiste en `localStorage`
 * al soltar (`onPointerUp`), no en cada frame de arrastre.
 */
function ResizeHandle({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const dragStartRef = useRef<{ pointerX: number; startWidth: number } | null>(null)

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // `setPointerCapture` no existe en jsdom (entorno de test): se comprueba
    // antes de llamarlo para no romper el gesto ahí, sin afectar al
    // comportamiento real en un navegador/webview de verdad.
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragStartRef.current = { pointerX: event.clientX, startWidth: width }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragStartRef.current
    if (!drag) return
    // El asa está en el borde IZQUIERDO del panel: arrastrar hacia la
    // izquierda (el puntero se mueve a una x menor) debe ENSANCHAR el
    // panel, de ahí el signo invertido respecto al desplazamiento del
    // puntero.
    const delta = drag.pointerX - event.clientX
    onResize(clampInspectorWidth(drag.startWidth + delta, window.innerWidth))
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    dragStartRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  return (
    <div
      className={styles.resizeHandle}
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar panel derecho"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  )
}

/**
 * Inspector derecho: información del proyecto sin selección, o
 * título/contenido del nodo seleccionado. Con selección múltiple, muestra
 * los campos del primer nodo seleccionado (no hay edición multi-nodo).
 *
 * Ancho redimensionable (tarea 2): estado local inicializado con el ancho
 * guardado en `localStorage` (`loadInspectorWidth`), persistido de nuevo
 * cada vez que cambia. Es una preferencia de la app, no del documento
 * `.brunch` — por eso vive aquí como estado de componente y no en
 * `useProjectStore`/`project`.
 */
export function Inspector({ filePath }: InspectorProps) {
  const project = useProject()
  const selectedNodeIds = useSelectedNodeIds()
  const selectedNodeId = selectedNodeIds[0] ?? null
  const selectedNode = selectedNodeId
    ? project.graph.nodes.find((node) => node.id === selectedNodeId) ?? null
    : null

  const [width, setWidth] = useState(() => loadInspectorWidth(window.innerWidth))

  function handleResize(nextWidth: number) {
    setWidth(nextWidth)
    saveInspectorWidth(nextWidth)
  }

  return (
    <aside className={styles.inspector} style={{ width, flexBasis: width }}>
      <ResizeHandle width={width} onResize={handleResize} />
      {selectedNode ? (
        <NodeFields
          key={selectedNode.id}
          node={selectedNode}
          allNodes={project.graph.nodes}
          project={project}
          startNodeId={project.graph.startNodeId}
          filePath={filePath}
        />
      ) : (
        <ProjectSummary project={project} />
      )}
    </aside>
  )
}
