import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  useProject,
  useProjectStore,
  useSelectedNodeIds,
  useTitleFocusRequestNodeId,
} from '../../store'
import {
  DEFAULT_CONTINUE_LABEL,
  MAX_RESPONSES,
  RESPONSE_LETTERS,
  deriveEdges,
} from '../../domain'
import type {
  ContentOrder,
  DecisionResponse,
  Node,
  NodeType,
  ProjectDocument,
  SlideNode,
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
  const counts: Record<NodeType, number> = { slide: 0, final: 0 }
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
 * "<Tipo> <número> — <título o 'Sin título'>", p.ej.
 * "Diapositiva 3 — Bienvenida".
 */
function nodeOptionLabel(node: Node): string {
  const title = node.title.trim() || 'Sin título'
  return `${NODE_TYPE_LABEL[node.type]} ${node.number} — ${title}`
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

type AssetKind = 'image' | 'audio'

const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  image: 'imagen',
  audio: 'audio',
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
        setPickError('El archivo es demasiado grande (máximo 15 MB). Prueba con uno más ligero.')
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
 * Lista de imágenes de una diapositiva: botón "Añadir imagen" (reutiliza el
 * mismo flujo de importación que el resto de adjuntos — límite de 15 MB y
 * deduplicación por contenido los gestiona `assetRepository.importAsset`,
 * igual que para la imagen única de antes), una miniatura por imagen con su
 * posición, y controles para quitarla o moverla en el orden (↑/↓ — el orden
 * del array es el orden de aparición en el Player/export, apiladas en
 * columna a ancho completo).
 *
 * `updateNode(node.id, { imageAssetIds: [...] })` siempre reemplaza la lista
 * completa (ver `UpdateNodePatch` en `src/domain/project.ts`): añadir/quitar/
 * mover una imagen se hace leyendo `node.imageAssetIds` y escribiendo la
 * lista ya modificada.
 */
function NodeImagesSection({ node, filePath }: { node: SlideNode; filePath: string }) {
  const updateNode = useProjectStore((state) => state.updateNode)
  const { pickImportAssetPath, assetRepository } = useAppServices()

  const [busy, setBusy] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  async function handleAdd() {
    setPickError(null)
    setBusy(true)
    try {
      const sourcePath = await pickImportAssetPath('image')
      if (!sourcePath) {
        // Cancelado por el usuario: sin error visible, sin cambios.
        return
      }
      const meta = await assetRepository.importAsset(filePath, sourcePath)
      updateNode(node.id, { imageAssetIds: [...node.imageAssetIds, meta.id] })
    } catch (error) {
      if (error instanceof PersistenceCommandError && error.kind === 'AssetTooLarge') {
        setPickError('El archivo es demasiado grande (máximo 15 MB). Prueba con uno más ligero.')
      } else {
        setPickError('No se ha podido adjuntar la imagen. Inténtalo de nuevo.')
      }
    } finally {
      setBusy(false)
    }
  }

  function handleRemove(assetId: string) {
    updateNode(node.id, { imageAssetIds: node.imageAssetIds.filter((id) => id !== assetId) })
  }

  function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= node.imageAssetIds.length) return
    const next = [...node.imageAssetIds]
    const [moved] = next.splice(index, 1)
    if (moved === undefined) return
    next.splice(target, 0, moved)
    updateNode(node.id, { imageAssetIds: next })
  }

  return (
    <div className={styles.nodeImagesSection}>
      <div className={styles.nodeImagesHeader}>
        <span className={styles.label}>Imágenes</span>
        <button
          type="button"
          className={styles.attachButton}
          onClick={handleAdd}
          disabled={busy}
        >
          + Añadir imagen
        </button>
      </div>
      {pickError && (
        <p role="alert" className={styles.mediaError}>
          {pickError}
        </p>
      )}
      {node.imageAssetIds.length > 0 && (
        <ul className={styles.imageList}>
          {node.imageAssetIds.map((assetId, index) => (
            <li key={assetId} className={styles.imageListItem}>
              <AssetPreview
                key={assetId}
                kind="image"
                assetId={assetId}
                filePath={filePath}
                suffix={` ${index + 1}`}
              />
              <span className={styles.imageListPosition}>{index + 1}</span>
              <div className={styles.imageListControls}>
                <button
                  type="button"
                  className={styles.imageMoveButton}
                  onClick={() => handleMove(index, -1)}
                  disabled={index === 0}
                  aria-label={`Subir imagen ${index + 1}`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={styles.imageMoveButton}
                  onClick={() => handleMove(index, 1)}
                  disabled={index === node.imageAssetIds.length - 1}
                  aria-label={`Bajar imagen ${index + 1}`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => handleRemove(assetId)}
                  aria-label={`Quitar imagen ${index + 1}`}
                >
                  Quitar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Elige si el bloque de imágenes va antes o después del cuerpo de texto en
 *  el Player/export (`SlideNode.contentOrder`). Por defecto "Texto primero",
 *  que es como se comportaba la app antes de admitir varias imágenes. */
function ContentOrderControl({ node }: { node: SlideNode }) {
  const updateNode = useProjectStore((state) => state.updateNode)
  const fieldId = 'inspector-content-order'

  return (
    <div>
      <label className={styles.label} htmlFor={fieldId}>
        Orden del contenido
      </label>
      <select
        id={fieldId}
        className={styles.select}
        value={node.contentOrder}
        onChange={(event) =>
          updateNode(node.id, { contentOrder: event.target.value as ContentOrder })
        }
      >
        <option value="text-first">Texto primero</option>
        <option value="image-first">Imagen primero</option>
      </select>
    </div>
  )
}

/**
 * Adjuntos de nivel de nodo (solo Diapositiva): imágenes (varias,
 * ordenables), su orden respecto al texto, y el audio (uno solo). Se
 * muestra justo debajo de título/contenido.
 */
function NodeMediaSection({ node, filePath }: { node: SlideNode; filePath: string }) {
  const updateNode = useProjectStore((state) => state.updateNode)

  return (
    <div className={styles.nodeMediaSection}>
      <NodeImagesSection node={node} filePath={filePath} />
      <ContentOrderControl node={node} />
      <div>
        <span className={styles.label}>Audio</span>
        <MediaAttachment
          kind="audio"
          assetId={node.audioAssetId}
          filePath={filePath}
          onAttach={(assetId) => updateNode(node.id, { audioAssetId: assetId })}
          onRemove={() => updateNode(node.id, { audioAssetId: null })}
        />
      </div>
    </div>
  )
}

/**
 * Modo "de continuar" de una diapositiva: destino único de "Continuar" más
 * el texto personalizable de ese botón. Solo se muestra mientras la
 * diapositiva NO tiene respuestas — en cuanto tiene una, esos dos campos
 * dejan de tener efecto en el Player (quedan dormidos en el documento, sin
 * borrarse) y se ocultan; si se eliminan todas las respuestas, vuelven a
 * aparecer con el valor que ya tuvieran.
 *
 * Se monta con `key={node.id}` (a través de `NodeFields`) por el mismo
 * motivo que el resto de campos con estado local: el texto en edición debe
 * arrancar limpio al cambiar de nodo.
 */
function ContinueSection({ node, allNodes }: { node: SlideNode; allNodes: Node[] }) {
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
          className={styles.input}
          type="text"
          value={label}
          placeholder={DEFAULT_CONTINUE_LABEL}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={commitPending}
          onKeyDown={handleKeyDown}
        />
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
}: {
  slideNodeId: string
  response: DecisionResponse
  index: number
  allNodes: Node[]
  filePath: string
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
          className={styles.textarea}
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
}: {
  node: SlideNode
  allNodes: Node[]
  filePath: string
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
        className={styles.textarea}
        rows={3}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commitPending}
      />
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
  const deleteNode = useProjectStore((state) => state.deleteNode)
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

  return (
    <div className={styles.fields}>
      <div>
        <label className={styles.label} htmlFor="inspector-node-title">
          Título
        </label>
        <input
          id="inspector-node-title"
          ref={titleInputRef}
          className={styles.input}
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
      <InternalNoteField node={node} />
      {node.type === 'slide' && (
        <>
          <NodeMediaSection node={node} filePath={filePath} />
          {node.responses.length === 0 && <ContinueSection node={node} allNodes={allNodes} />}
          <ResponsesSection node={node} allNodes={allNodes} filePath={filePath} />
        </>
      )}
      <ConnectionsSection node={node} project={project} />
      {/* Acción de borrado descubrible sin depender de la tecla Supr/Backspace
          del lienzo (ver `Canvas`). Nunca se muestra para la diapositiva de
          inicio — `store.deleteNode` (dominio) lanza si se intentara. Sin
          diálogo de confirmación: el propio undo (Ctrl/Cmd+Z) cubre el
          "deshacer por error", mismo criterio que "Eliminar respuesta". */}
      {node.id !== startNodeId && (
        <button
          type="button"
          className={styles.deleteNodeButton}
          onClick={() => deleteNode(node.id)}
        >
          Eliminar {NODE_TYPE_LABEL[node.type].toLowerCase()}
        </button>
      )}
    </div>
  )
}

export interface InspectorProps {
  /**
   * Ruta absoluta del `.brunch` abierto. La necesitan los controles de
   * imagen/audio (`NodeMediaSection`/`ResponseRow` vía `MediaAttachment`)
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
