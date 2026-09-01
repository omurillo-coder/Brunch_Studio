import { produce } from 'immer'
import type { ProjectDocument } from './schemas'

/**
 * Arista derivada del grafo, propia del dominio y sin dependencia de
 * `@xyflow/react`. La capa de edición la traduce al tipo `Edge` de React
 * Flow (ver `src/editor/Canvas/adapter.ts`).
 *
 * Nota: deliberadamente no lleva ninguna etiqueta de texto. Las aristas de
 * respuesta mostraban antes la letra (A/B/C/D) sobre la línea de conexión;
 * las letras ya no se muestran nunca al usuario (son un detalle interno de
 * ordenación, ver `RESPONSE_LETTERS`), así que la arista tampoco las
 * transporta.
 */
export interface Edge {
  id: string
  source: string
  target: string
  /** Para aristas de respuesta: id de la respuesta que origina la arista. */
  sourceHandle?: string
  /**
   * Presente y a `'else'` únicamente para la arista de la rama "si no" de
   * una diapositiva "de continuar" con `condition`+`elseTargetNodeId`
   * (ver más abajo). Ausente (`undefined`) para cualquier otra arista
   * ("normal": de "Continuar" o de una respuesta) — así un consumidor que
   * no conoce este campo (p.ej. un test antiguo con `toEqual` sobre el
   * objeto completo) no se ve afectado, porque `toEqual` trata una
   * propiedad `undefined` como ausente.
   */
  kind?: 'else'
}

/**
 * Deriva las aristas visuales del grafo a partir del estado actual del
 * proyecto. Pura, no depende del store ni de bibliotecas de UI.
 *
 * Para una diapositiva:
 * - Con respuestas (`responses.length > 0`): una arista por cada respuesta
 *   que tenga destino. `condition`/`elseTargetNodeId` quedan "dormidos" en
 *   este modo (mismo criterio que en el resto del dominio, ver
 *   `SlideNodeSchema`), así que no generan ninguna arista adicional aquí.
 * - Sin respuestas ("de continuar"): una arista desde `targetNodeId`, si lo
 *   tiene, MÁS — fase 2 del milestone "Variables/condiciones" — una arista
 *   adicional de tipo `kind: 'else'` hacia `elseTargetNodeId` cuando la
 *   diapositiva tiene AMBOS `condition` y `elseTargetNodeId` (sin
 *   `condition`, `elseTargetNodeId` no tiene ningún efecto en el Player —
 *   ver `resolveSlideTarget` — así que tampoco debe generar arista visual;
 *   y sin `elseTargetNodeId` no hay destino al que dibujarla). Que esta
 *   arista se derive aquí, junto con la normal, es deliberado: así
 *   `validateProject` (alcanzabilidad, BFS sobre `deriveEdges`) y el
 *   indicador visual de "sin salida" del lienzo (`adapter.ts`,
 *   `nodeIdsWithOutgoingEdge`) cuentan la rama "si no" como una salida
 *   válida gratis, sin lógica duplicada en ningún otro sitio.
 *
 * Para un nodo `intro` (milestone "Diapositiva de Inicio"): una única
 * arista desde `targetNodeId`, si lo tiene — MISMO tratamiento que una
 * diapositiva "de continuar" sin respuestas, sin `condition`/
 * `elseTargetNodeId` (un `intro` nunca los tiene, ver `IntroNodeSchema`).
 * Es deliberado que se derive aquí igual que el resto: como `intro` es
 * SIEMPRE `graph.startNodeId` cuando existe (ver esa propiedad en
 * `src/domain/schemas.ts`), el BFS de alcanzabilidad de `validateProject`
 * arranca desde él — si esta función no generara su arista saliente, TODO
 * el resto del grafo aparecería como inalcanzable en cuanto un proyecto
 * tuviera portada, que es justo el caso normal tras este milestone.
 *
 * Los nodos `final` no tienen salida: no generan aristas.
 */
export function deriveEdges(project: ProjectDocument): Edge[] {
  const edges: Edge[] = []

  for (const node of project.graph.nodes) {
    if (node.type === 'intro') {
      if (node.targetNodeId) {
        edges.push({
          id: `${node.id}->${node.targetNodeId}`,
          source: node.id,
          target: node.targetNodeId,
        })
      }
      continue
    }

    if (node.type !== 'slide') continue

    if (node.responses.length > 0) {
      for (const response of node.responses) {
        if (response.targetNodeId) {
          edges.push({
            id: `${node.id}:${response.id}->${response.targetNodeId}`,
            source: node.id,
            target: response.targetNodeId,
            sourceHandle: response.id,
          })
        }
      }
      continue
    }

    if (node.targetNodeId) {
      edges.push({
        id: `${node.id}->${node.targetNodeId}`,
        source: node.id,
        target: node.targetNodeId,
      })
    }
    if (node.condition && node.elseTargetNodeId) {
      edges.push({
        id: `${node.id}:else->${node.elseTargetNodeId}`,
        source: node.id,
        target: node.elseTargetNodeId,
        kind: 'else',
      })
    }
  }

  return edges
}

function assertNodeExists(project: ProjectDocument, nodeId: string): void {
  if (!project.graph.nodes.some((node) => node.id === nodeId)) {
    throw new Error(`No existe un nodo con id "${nodeId}".`)
  }
}

/**
 * Localiza el nodo de origen de un `connect`/`disconnect` y valida que la
 * combinación nodo/respuesta sea coherente. Lanza `Error` con un mensaje
 * explícito en cualquier caso inválido, igual que el resto del dominio.
 *
 * Milestone "Diapositiva de Inicio": un nodo `intro` es ahora también un
 * origen válido (mismo caso que una `SlideNode` "de continuar" sin
 * `responseId`, ver `connect`/`disconnect` más abajo), porque tiene su
 * propio `targetNodeId` — pero NUNCA con `responseId`, ya que un `intro` no
 * tiene `responses` (no es un punto de decisión). Solo `final` sigue sin
 * salida.
 */
function assertConnectableSource(
  project: ProjectDocument,
  sourceNodeId: string,
  responseId: string | undefined,
): void {
  const source = project.graph.nodes.find((node) => node.id === sourceNodeId)
  if (!source) {
    throw new Error(`No existe un nodo con id "${sourceNodeId}".`)
  }
  if (source.type === 'final') {
    throw new Error('Un nodo "final" no tiene salida; no se puede conectar.')
  }
  if (responseId) {
    if (source.type !== 'slide') {
      throw new Error(
        `El nodo "${sourceNodeId}" es de tipo "${source.type}" y nunca tiene respuestas; no se puede conectar por "responseId".`,
      )
    }
    if (!source.responses.some((response) => response.id === responseId)) {
      throw new Error(`El nodo "${sourceNodeId}" no tiene una respuesta con id "${responseId}".`)
    }
  }
}

/**
 * Conecta una salida de una diapositiva (o de un nodo `intro`, ver más
 * abajo) a un destino.
 *
 * - Con `responseId`: conecta el destino de esa respuesta concreta (solo
 *   válido si el origen es una `SlideNode`).
 * - Sin `responseId`: conecta el destino general del nodo de origen
 *   (`targetNodeId`) — el de "Continuar" en una `SlideNode`, o el único
 *   destino posible en un nodo `intro` (la diapositiva a la que lleva la
 *   portada tras el milestone "Diapositiva de Inicio"; mismo campo, mismo
 *   cableado, ver `IntroNodeSchema.targetNodeId`).
 * - Los nodos `final` no tienen salida y no se pueden usar como origen.
 */
export function connect(
  project: ProjectDocument,
  sourceNodeId: string,
  targetNodeId: string,
  responseId?: string,
): ProjectDocument {
  assertNodeExists(project, targetNodeId)
  assertConnectableSource(project, sourceNodeId, responseId)

  return produce(project, (draft) => {
    const draftSource = draft.graph.nodes.find((node) => node.id === sourceNodeId)
    if (!draftSource || draftSource.type === 'final') return

    if (responseId) {
      if (draftSource.type !== 'slide') return
      const response = draftSource.responses.find((candidate) => candidate.id === responseId)
      if (response) {
        response.targetNodeId = targetNodeId
        // Mutuamente excluyente con `actsAsExit` (milestone "+1 fallo con
        // Game Over", ver comentario de `UpdateResponsePatch.actsAsExit` en
        // `src/domain/responses.ts`): conectar un destino de verdad
        // desactiva "actúa como Salir" si estaba activo.
        response.actsAsExit = undefined
      }
    } else {
      draftSource.targetNodeId = targetNodeId
    }

    draft.metadata.updatedAt = new Date().toISOString()
  })
}

/**
 * Desconecta una salida de un nodo (la de una respuesta concreta si se
 * indica `responseId`, o la general si no — de "Continuar" en una
 * `SlideNode`, o la única de un nodo `intro`), dejando el `targetNodeId`
 * correspondiente en `undefined`.
 */
export function disconnect(
  project: ProjectDocument,
  sourceNodeId: string,
  responseId?: string,
): ProjectDocument {
  assertConnectableSource(project, sourceNodeId, responseId)

  return produce(project, (draft) => {
    const draftSource = draft.graph.nodes.find((node) => node.id === sourceNodeId)
    if (!draftSource || draftSource.type === 'final') return

    if (responseId) {
      if (draftSource.type !== 'slide') return
      const response = draftSource.responses.find((candidate) => candidate.id === responseId)
      if (response) {
        response.targetNodeId = undefined
      }
    } else {
      draftSource.targetNodeId = undefined
    }

    draft.metadata.updatedAt = new Date().toISOString()
  })
}
