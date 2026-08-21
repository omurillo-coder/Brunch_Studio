import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import {
  useProject,
  useProjectStore,
  useSelectedNodeIds,
  useTitleFocusRequestNodeId,
} from '../../store'
import { RESPONSE_LETTERS } from '../../domain'
import type {
  ContentNode,
  DecisionNode,
  DecisionResponse,
  Node,
  NodeType,
  ProjectDocument,
} from '../../domain'
import { useAppServices } from '../../app/AppServicesContext'
import { RichTextEditor } from '../richText/RichTextEditor'
import styles from './Inspector.module.css'

const NODE_TYPE_LABEL: Record<NodeType, string> = {
  start: 'Inicio',
  content: 'Pantalla',
  decision: 'Decisión',
  final: 'Final',
}

/** Vista sin selección: información básica de solo lectura del proyecto. */
function ProjectSummary({ project }: { project: ProjectDocument }) {
  const counts: Record<NodeType, number> = { start: 0, content: 0, decision: 0, final: 0 }
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
          <dt>{NODE_TYPE_LABEL.start}</dt>
          <dd>{counts.start}</dd>
        </div>
        <div className={styles.summaryRow}>
          <dt>{NODE_TYPE_LABEL.content}</dt>
          <dd>{counts.content}</dd>
        </div>
        <div className={styles.summaryRow}>
          <dt>{NODE_TYPE_LABEL.decision}</dt>
          <dd>{counts.decision}</dd>
        </div>
        <div className={styles.summaryRow}>
          <dt>{NODE_TYPE_LABEL.final}</dt>
          <dd>{counts.final}</dd>
        </div>
      </dl>
    </div>
  )
}

/** Valor de la opción "— Sin destino —" del `<select>` de destino de una
 *  respuesta. Nunca puede coincidir con un id real (los ids son UUIDs). */
const NO_TARGET_VALUE = '__none__'

/**
 * Etiqueta legible de un nodo para mostrarlo como destino posible en el
 * `<select>` de una respuesta — nunca el `id` interno (UUID) como texto
 * visible. Formato: "<Tipo> <número> — <título o 'Sin título'>", p.ej.
 * "Pantalla 3 — Bienvenida" o "Pantalla 3 — Sin título".
 */
function nodeOptionLabel(node: Node): string {
  const title = node.title.trim() || 'Sin título'
  return `${NODE_TYPE_LABEL[node.type]} ${node.number} — ${title}`
}

/** Respuestas de un nodo decision, siempre en el orden fijo A→B→C→D — el
 *  array interno conserva el orden de creación, que puede no coincidir con
 *  el orden de letra tras eliminar y reañadir una intermedia. */
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
 * siempre arranca limpio para el asset nuevo sin necesitar un `setState`
 * síncrono de "reseteo" al principio del efecto. El flag `cancelled` en el
 * cleanup sigue siendo necesario aparte: cubre el caso de que esta misma
 * instancia se desmonte (cambio de asset, o de nodo/respuesta seleccionado)
 * mientras la promesa de `getAsset` todavía está en vuelo.
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
  const [previewDataUri, setPreviewDataUri] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    assetRepository
      .getAsset(filePath, assetId)
      .then((data) => {
        if (cancelled) return
        setPreviewDataUri(`data:${data.mimeType};base64,${data.dataBase64}`)
      })
      .catch(() => {
        if (cancelled) return
        setPreviewError('No se ha podido cargar la vista previa.')
      })
    return () => {
      cancelled = true
    }
  }, [assetId, filePath, assetRepository])

  return (
    <>
      {previewDataUri && kind === 'image' && (
        <img
          className={styles.mediaThumbnail}
          src={previewDataUri}
          alt={`Vista previa de la imagen adjunta${suffix}`}
        />
      )}
      {previewDataUri && kind === 'audio' && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio className={styles.audioPreview} controls src={previewDataUri} />
      )}
      {previewError && (
        <p role="alert" className={styles.mediaError}>
          {previewError}
        </p>
      )}
    </>
  )
}

/**
 * Control de adjuntar/ver/quitar/reemplazar una imagen o un audio, reusado
 * tanto a nivel de nodo (Pantalla/Decisión) como por respuesta de Decisión.
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
    } catch {
      setPickError(`No se ha podido adjuntar el ${label}. Inténtalo de nuevo.`)
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
 * Adjuntos de imagen/audio a nivel de nodo (Pantalla o Decisión). Se muestra
 * justo debajo de título/contenido, antes de la sección de respuestas si el
 * nodo es una Decisión.
 */
function NodeMediaSection({
  node,
  filePath,
}: {
  node: ContentNode | DecisionNode
  filePath: string
}) {
  const updateNode = useProjectStore((state) => state.updateNode)

  return (
    <div className={styles.nodeMediaSection}>
      <div>
        <span className={styles.label}>Imagen</span>
        <MediaAttachment
          kind="image"
          assetId={node.imageAssetId}
          filePath={filePath}
          onAttach={(assetId) => updateNode(node.id, { imageAssetId: assetId })}
          onRemove={() => updateNode(node.id, { imageAssetId: null })}
        />
      </div>
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
 * Una fila de respuesta dentro del inspector de un nodo decision: texto
 * editable ("commit on blur", mismo criterio que título/body) y `<select>`
 * de destino.
 *
 * Se monta con `key={response.id}` desde `DecisionResponsesSection` por el
 * mismo motivo que `NodeFields` se monta con `key={node.id}`: el estado
 * local de texto debe arrancar limpio para cada respuesta y no reutilizarse
 * entre respuestas distintas si la lista se reordena.
 */
function ResponseRow({
  decisionNodeId,
  response,
  allNodes,
  filePath,
}: {
  decisionNodeId: string
  response: DecisionResponse
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
      updateResponse(decisionNodeId, response.id, { text: latestRef.current })
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
      updateResponse(decisionNodeId, response.id, { points: null })
      pointsCommittedRef.current = pending
      return
    }
    const parsed = Number(trimmed)
    if (Number.isNaN(parsed)) {
      // Entrada no numérica: no se confirma nada (queda pendiente hasta un
      // valor válido o un vaciado explícito).
      return
    }
    updateResponse(decisionNodeId, response.id, { points: parsed })
    pointsCommittedRef.current = pending
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      commitPending()
    }
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
        disconnect(decisionNodeId, response.id)
      }
    } else {
      connect(decisionNodeId, value, response.id)
    }
  }

  const textFieldId = `inspector-response-text-${response.id}`
  const targetFieldId = `inspector-response-target-${response.id}`
  const pointsFieldId = `inspector-response-points-${response.id}`
  const responseContextLabel = `de la respuesta ${response.letter}`

  return (
    <div className={styles.responseRow}>
      <div className={styles.responseRowHeader}>
        <span className={styles.responseLetter}>{response.letter}</span>
        <button
          type="button"
          className={styles.removeResponseButton}
          onClick={() => removeResponse(decisionNodeId, response.id)}
          aria-label={`Eliminar respuesta ${response.letter}`}
        >
          Eliminar
        </button>
      </div>
      <div>
        <label className={styles.label} htmlFor={textFieldId}>
          Texto de la respuesta {response.letter}
        </label>
        <input
          id={textFieldId}
          className={styles.input}
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commitPending}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div>
        <label className={styles.label} htmlFor={targetFieldId}>
          Destino de la respuesta {response.letter}
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
          Puntuación de la respuesta {response.letter}
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
              updateResponse(decisionNodeId, response.id, { imageAssetId: assetId })
            }
            onRemove={() => updateResponse(decisionNodeId, response.id, { imageAssetId: null })}
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
              updateResponse(decisionNodeId, response.id, { audioAssetId: assetId })
            }
            onRemove={() => updateResponse(decisionNodeId, response.id, { audioAssetId: null })}
            contextLabel={responseContextLabel}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Sección de respuestas de un nodo decision (fase 6, "inspector completo").
 * Desde la fase 3 de Milestone 2 incluye también puntuación e imagen/audio
 * por respuesta (ver `ResponseRow`). El menú "¿qué quieres añadir?" al
 * soltar una conexión en el vacío se implementa en la fase 7
 * (`Canvas`/`ConnectionMenu`), no aquí.
 */
function DecisionResponsesSection({
  node,
  allNodes,
  filePath,
}: {
  node: DecisionNode
  allNodes: Node[]
  filePath: string
}) {
  const addResponse = useProjectStore((state) => state.addResponse)
  const canAddResponse = node.responses.length < 4
  const responses = sortByLetter(node.responses)

  return (
    <div className={styles.responsesSection}>
      <div className={styles.responsesSectionHeader}>
        <h3 className={styles.responsesTitle}>Respuestas</h3>
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
      <div className={styles.responsesList}>
        {responses.map((response) => (
          <ResponseRow
            key={response.id}
            decisionNodeId={node.id}
            response={response}
            allNodes={allNodes}
            filePath={filePath}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Campos de edición de un nodo (título/body), comunes a cualquier tipo, más
 * — para Decisión — la sección de respuestas (`DecisionResponsesSection`).
 *
 * Se monta con `key={node.id}` desde `Inspector` para que cambiar de nodo
 * seleccionado destruya y vuelva a crear esta instancia en vez de
 * reutilizarla. Eso da dos cosas gratis:
 * - Los campos locales (`title`/`body`) siempre arrancan con el valor del
 *   nodo recién seleccionado, sin lógica de sincronización manual.
 * - El efecto de limpieza (`useEffect` con `return () => ...`) se ejecuta
 *   exactamente cuando se abandona ese nodo (cambio de selección o
 *   deselección total), y ahí se confirma cualquier edición pendiente que
 *   no hubiera pasado por `onBlur` — el criterio elegido para "¿qué pasa
 *   si cambias de nodo sin hacer blur?".
 */
function NodeFields({
  node,
  allNodes,
  filePath,
}: {
  node: Node
  allNodes: Node[]
  filePath: string
}) {
  const updateNode = useProjectStore((state) => state.updateNode)
  const deleteNode = useProjectStore((state) => state.deleteNode)
  const titleFocusRequestNodeId = useTitleFocusRequestNodeId()
  const clearTitleFocusRequest = useProjectStore((state) => state.clearTitleFocusRequest)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // El campo `body` (fase 4, Milestone 2: editor de texto enriquecido) ya no
  // se gestiona aquí como estado local de texto — `RichTextEditor` confirma
  // sus propios cambios en el store vía su prop `onCommit`, con el mismo
  // criterio "commit on blur" (ver `RichTextEditor.tsx`). Este componente
  // solo sigue gestionando el título.
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
  // (fase 7, ver `ui.titleFocusRequestNodeId`). Solo actúa cuando la
  // petición apunta exactamente a este nodo — una selección "normal" (clic
  // en `LeftPanel` o en el lienzo) nunca fija este campo, así que nunca le
  // roba el foco al usuario en esos casos. Se limpia inmediatamente para no
  // repetir el foco en renders posteriores (p.ej. si el usuario edita el
  // título y luego el componente se re-renderiza por otro motivo).
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
      {(node.type === 'content' || node.type === 'decision') && (
        <NodeMediaSection node={node} filePath={filePath} />
      )}
      {node.type === 'decision' && (
        <DecisionResponsesSection node={node} allNodes={allNodes} filePath={filePath} />
      )}
      {/* Acción de borrado descubrible sin depender de la tecla Supr/Backspace
          del lienzo (ver `Canvas`). Nunca se muestra para el nodo Inicio —
          `store.deleteNode` (dominio) lanza si se intentara. Sin diálogo de
          confirmación: el propio undo (Ctrl/Cmd+Z) cubre el "deshacer por
          error", mismo criterio que "Eliminar respuesta" más arriba. */}
      {node.type !== 'start' && (
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
 * Inspector derecho: información del proyecto sin selección, o
 * título/contenido del nodo seleccionado. Con selección múltiple, muestra
 * los campos del primer nodo seleccionado (no hay edición multi-nodo en
 * esta fase).
 */
export function Inspector({ filePath }: InspectorProps) {
  const project = useProject()
  const selectedNodeIds = useSelectedNodeIds()
  const selectedNodeId = selectedNodeIds[0] ?? null
  const selectedNode = selectedNodeId
    ? project.graph.nodes.find((node) => node.id === selectedNodeId) ?? null
    : null

  return (
    <aside className={styles.inspector}>
      {selectedNode ? (
        <NodeFields
          key={selectedNode.id}
          node={selectedNode}
          allNodes={project.graph.nodes}
          filePath={filePath}
        />
      ) : (
        <ProjectSummary project={project} />
      )}
    </aside>
  )
}
