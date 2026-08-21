import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { MAX_RESPONSES } from '../../../domain'
import type { NodeType } from '../../../domain'
import type { CanvasFlowNode, CanvasNodeData, CanvasResponseSummary } from '../adapter'
import { IN_HANDLE_ID, OUT_HANDLE_ID, responseHandleId } from '../handles'
import styles from './NodeCard.module.css'

/**
 * Nodos personalizados del lienzo, uno por tipo de dominio (`slide` y
 * `final`). Compactos a propósito: tipo traducido + número visible + título
 * (nunca el `id` interno), truncados con CSS si son largos. El `body`
 * completo del nodo nunca se pinta aquí — el lienzo debe seguir siendo
 * legible con decenas de nodos; el contenido completo se edita en el
 * inspector.
 *
 * Ya no existe un nodo visual de "Inicio": la diapositiva de inicio
 * (`graph.startNodeId`) es una diapositiva normal, marcada con una etiqueta
 * discreta en su cabecera (`data.isStart`).
 */

/** Exportado para que otros componentes del lienzo (p.ej. `ConnectionMenu`,
 *  el menú "¿Qué quieres añadir?") reutilicen el mismo diccionario de
 *  etiquetas en vez de duplicarlo. */
export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  slide: 'Diapositiva',
  final: 'Final',
}

/** Etiqueta discreta que marca la diapositiva de inicio del proyecto, tanto
 *  aquí como en la lista de `LeftPanel`. */
export const START_NODE_LABEL = 'Inicio'

/** Máximo de respuestas que se resumen dentro de la tarjeta. El propio
 *  esquema de dominio ya limita `responses` a 4, así que esto es solo una
 *  defensa adicional si esa cota cambiara en el futuro. */
const MAX_SUMMARIZED_RESPONSES = MAX_RESPONSES

function displayTitle(title: string): string {
  return title.trim() || 'Sin título'
}

function Header({ data }: { data: CanvasNodeData }) {
  return (
    <div className={styles.header}>
      <span className={styles.type}>{NODE_TYPE_LABEL[data.nodeType]}</span>
      {data.isStart && (
        <span className={styles.startMark} title="Diapositiva de inicio">
          {START_NODE_LABEL}
        </span>
      )}
      <span className={styles.number}>{data.number}</span>
      <span className={styles.title}>{displayTitle(data.title)}</span>
    </div>
  )
}

/** Handle de entrada único, compartido por diapositivas y finales. */
function InHandle() {
  return (
    <Handle
      className={styles.handle}
      type="target"
      position={Position.Left}
      id={IN_HANDLE_ID}
    />
  )
}

/** Handle de salida de "Continuar", presente solo en diapositivas SIN
 *  respuestas (en cuanto hay respuestas, cada una tiene el suyo). */
function OutHandle() {
  return (
    <Handle
      className={styles.handle}
      type="source"
      position={Position.Right}
      id={OUT_HANDLE_ID}
    />
  )
}

/** Una respuesta resumida: un punto (nunca la letra) + su texto + su propio
 *  handle de salida. */
function ResponseRow({ response }: { response: CanvasResponseSummary }) {
  return (
    <div className={styles.responseRow}>
      <span className={styles.responseBullet} aria-hidden="true" />
      <span className={styles.responseText}>{response.text.trim() || 'Sin texto'}</span>
      <Handle
        className={styles.handle}
        type="source"
        position={Position.Right}
        id={responseHandleId(response.id)}
        style={{ top: '50%' }}
      />
    </div>
  )
}

export function SlideNodeView({ data }: NodeProps<CanvasFlowNode>) {
  const responses = (data.responses ?? []).slice(0, MAX_SUMMARIZED_RESPONSES)

  return (
    <div className={styles.card}>
      <InHandle />
      <Header data={data} />
      {responses.length > 0 ? (
        <div className={styles.body}>
          <div className={styles.responseList}>
            {responses.map((response) => (
              <ResponseRow key={response.id} response={response} />
            ))}
          </div>
        </div>
      ) : (
        <OutHandle />
      )}
    </div>
  )
}

export function FinalNodeView({ data }: NodeProps<CanvasFlowNode>) {
  return (
    <div className={styles.card}>
      <InHandle />
      <Header data={data} />
    </div>
  )
}

/**
 * Mapa `nodeTypes` de `@xyflow/react`. Definido una sola vez a nivel de
 * módulo (no dentro del componente `Canvas`) para que sea una referencia
 * estable entre renders — `@xyflow/react` avisa (`error002`) si detecta un
 * objeto `nodeTypes`/`edgeTypes` nuevo en cada render.
 */
export const nodeTypes = {
  slide: SlideNodeView,
  final: FinalNodeView,
}
