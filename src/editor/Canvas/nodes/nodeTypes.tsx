import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { NodeType } from '../../../domain'
import type { CanvasFlowNode, CanvasNodeData, CanvasResponseSummary } from '../adapter'
import { IN_HANDLE_ID, OUT_HANDLE_ID, responseHandleId } from '../handles'
import styles from './NodeCard.module.css'

/**
 * Nodos personalizados del lienzo, uno por tipo de dominio. Compactos a
 * propósito: tipo traducido + número visible + título (nunca el `id`
 * interno), truncados con CSS si son largos. El `body` completo del nodo
 * nunca se pinta aquí — el lienzo debe seguir siendo legible con decenas de
 * nodos; el contenido completo se edita en el inspector.
 */

const NODE_TYPE_LABEL: Record<NodeType, string> = {
  start: 'Inicio',
  content: 'Pantalla',
  decision: 'Decisión',
  final: 'Final',
}

/** Máximo de respuestas que se resumen dentro del nodo decision. El propio
 *  esquema de dominio ya limita `responses` a 4, así que esto es solo una
 *  defensa adicional si esa cota cambiara en el futuro. */
const MAX_SUMMARIZED_RESPONSES = 4

function displayTitle(title: string): string {
  return title.trim() || 'Sin título'
}

function Header({ data }: { data: CanvasNodeData }) {
  return (
    <div className={styles.header}>
      <span className={styles.type}>{NODE_TYPE_LABEL[data.nodeType]}</span>
      <span className={styles.number}>{data.number}</span>
      <span className={styles.title}>{displayTitle(data.title)}</span>
    </div>
  )
}

/** Handle de entrada único, reutilizado por content/decision/final y, por
 *  consistencia visual, también por start (que en la práctica nunca recibe
 *  una conexión entrante, pero así los 4 tipos de nodo tienen la misma
 *  silueta con puntos de conexión a ambos lados). */
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

export function StartNodeView({ data }: NodeProps<CanvasFlowNode>) {
  return (
    <div className={styles.card}>
      <InHandle />
      <Header data={data} />
      <OutHandle />
    </div>
  )
}

export function ContentNodeView({ data }: NodeProps<CanvasFlowNode>) {
  return (
    <div className={styles.card}>
      <InHandle />
      <Header data={data} />
      <OutHandle />
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

function ResponseRow({ response }: { response: CanvasResponseSummary }) {
  return (
    <div className={styles.responseRow}>
      <span className={styles.responseLetter}>{response.letter}</span>
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

export function DecisionNodeView({ data }: NodeProps<CanvasFlowNode>) {
  const responses = (data.responses ?? []).slice(0, MAX_SUMMARIZED_RESPONSES)

  return (
    <div className={styles.card}>
      <InHandle />
      <Header data={data} />
      <div className={styles.body}>
        {responses.length === 0 ? (
          <span className={styles.emptyResponses}>Sin respuestas</span>
        ) : (
          <div className={styles.responseList}>
            {responses.map((response) => (
              <ResponseRow key={response.id} response={response} />
            ))}
          </div>
        )}
      </div>
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
  start: StartNodeView,
  content: ContentNodeView,
  decision: DecisionNodeView,
  final: FinalNodeView,
}
