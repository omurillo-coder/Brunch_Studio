import type { Edge as XyEdge, Node as XyNode } from '@xyflow/react'
import { asignaturaWorkspaceName, CICLOS, deriveEdges, RESPONSE_LETTERS } from '../../domain'
import type {
  DecisionResponse,
  Edge as DomainEdge,
  IntroNode,
  Node as DomainNode,
  NodeType,
  ProjectDocument,
  SlideColor,
} from '../../domain'
import { extractPlainText, parseRichBody } from '../richText/richTextContent'
import { IN_HANDLE_ID, OUT_HANDLE_ID, parseResponseHandleId, responseHandleId } from './handles'
import { BRUNCH_EDGE_TYPE } from './edges/edgeTypes'
import { computeEdgeLanes } from './edges/edgeGeometry'

/**
 * Adaptador dominio → `@xyflow/react`.
 *
 * Funciones puras y testeables sin montar el lienzo. `@xyflow/react` nunca
 * es una segunda fuente de verdad: estas funciones se llaman en cada render
 * del componente `Canvas` a partir de `project` (posiciones, tipos,
 * respuestas) y `deriveEdges` de dominio (aristas) + la selección actual del
 * store (transitoria, no forma parte del documento). El resultado se pasa
 * tal cual a las props `nodes`/`edges` de `<ReactFlow>`.
 */

/**
 * Resumen de una respuesta de una diapositiva, para pintar en la tarjeta del
 * lienzo. Deliberadamente NO lleva la letra: las respuestas se muestran con
 * un punto, nunca con la letra A/B/C/D (que sigue existiendo en el dominio
 * solo como criterio interno de orden y de cota de 4, ver
 * `RESPONSE_LETTERS`). El orden del array ya viene aplicado (por letra).
 */
export interface CanvasResponseSummary {
  id: string
  text: string
}

/**
 * Subconjunto de `CanvasNodeData` que depende solo del propio nodo de
 * dominio (`toNodeData`), sin la información transversal del lienzo entero
 * (aristas, selección) que añade `toFlowNodes` después.
 *
 * Deliberadamente una interfaz propia y no `Omit<CanvasNodeData, ...>`:
 * como `CanvasNodeData` extiende `Record<string, unknown>` (lo exige el
 * tipo `data` de `@xyflow/react`), `keyof CanvasNodeData` colapsa a
 * `string` y `Omit`/`Pick` sobre ella pierden la forma de las propiedades
 * concretas — de ahí que se declaren los campos compartidos una sola vez
 * aquí y `CanvasNodeData` los herede.
 */
interface BaseCanvasNodeData {
  nodeType: NodeType
  number: number
  title: string
  /** Solo presente en nodos `slide`; vacío si la diapositiva no tiene
   *  respuestas (y por tanto se comporta como "de continuar"). */
  responses?: CanvasResponseSummary[]
  /**
   * Color opcional de la tarjeta (paleta cerrada, ver `SlideColorSchema` en
   * `src/domain/schemas.ts`). Solo presente en nodos `slide` — `intro`/
   * `final` no tienen este campo en su schema, tienen su propio fondo fijo
   * por tipo (ver `cardClassName`/`.cardFinal`/`.cardIntro`). `undefined` =
   * sin colorear, fondo neutro de siempre.
   */
  color?: SlideColor
  /** `true` solo para la diapositiva de inicio (`graph.startNodeId`). */
  isStart: boolean
  /**
   * Nota interna recortada y no vacía (ver `bodyPreviewFor`/`toNodeData`), o
   * `undefined` si el nodo no tiene ninguna. Alimenta el icono de pin
   * discreto de la tarjeta (tarea 6) — nunca viaja al export, ver
   * `stripEditorOnlyFields` en `src/export/htmlBundle.ts`.
   */
  internalNote?: string
  /**
   * Fragmento corto de texto plano del `body` del nodo (tarea 8), para ver
   * de un vistazo qué contiene la diapositiva sin abrir el Inspector.
   * `undefined` si el nodo todavía no tiene contenido.
   */
  bodyPreview?: string
}

/** Datos que lleva cada nodo de `@xyflow/react` en su campo `data`. */
export interface CanvasNodeData extends BaseCanvasNodeData, Record<string, unknown> {
  /**
   * `true` cuando este nodo no tiene NINGUNA arista saliente en
   * `deriveEdges(project)` — ni el destino de "Continuar" (o el único
   * destino de un `intro`), ni el de ninguna respuesta. Siempre `false`
   * para nodos `final` (no tienen salida por diseño; que no la tengan no es
   * un aviso, es lo esperado). Se calcula igual para `slide` e `intro`
   * (milestone "Diapositiva de Inicio"): un `intro` sin `targetNodeId` deja
   * al alumno sin poder avanzar tras la portada, exactamente el mismo
   * problema que una diapositiva "de continuar" sin destino — mismo aviso
   * visual, ver `nodeIdsWithOutgoingEdge`/`NoOutgoingBadge`.
   */
  hasNoOutgoing: boolean
  /**
   * `true` cuando hay una selección activa (`selectedNodeIds` no vacío) y
   * este nodo es el destino de al menos una arista saliente de un nodo
   * seleccionado. Alimenta el anillo de resaltado (ver punto 4 del lienzo).
   * Nunca es `true` simultáneamente con `selected` (un nodo seleccionado ya
   * se resalta con su propio estilo de selección).
   */
  isHighlighted: boolean
  /**
   * `true` cuando hay una selección activa y este nodo no es ni el
   * seleccionado ni uno de sus destinos resaltados — se atenúa (opacidad
   * reducida) para dar contraste sin ocultarlo.
   */
  isDimmed: boolean
}

/** Ordena las respuestas por letra (A→D), igual que el Inspector y el
 *  Player: el array interno conserva el orden de creación, que puede no
 *  coincidir con el de letra tras eliminar y reañadir una intermedia. */
function sortByLetter(responses: DecisionResponse[]): DecisionResponse[] {
  return [...responses].sort(
    (a, b) => RESPONSE_LETTERS.indexOf(a.letter) - RESPONSE_LETTERS.indexOf(b.letter),
  )
}

/**
 * Tamaño aproximado que se le declara a `@xyflow/react` ANTES de que su
 * `ResizeObserver` interno mida el nodo de verdad por primera vez.
 *
 * Causa raíz confirmada leyendo `calculateNodePosition` en
 * `@xyflow/system` (`node_modules/@xyflow/system/dist/esm/index.js`): esa
 * función, invocada en cada frame de un arrastre, comprueba
 * `node.measured.width`/`height` y emite el aviso de consola "It seems that
 * you are trying to drag a node that is not initialized" (`error015`) si
 * son `undefined` — algo que ocurre para cualquier nodo cuyo primer paso de
 * medición (asíncrono, vía `ResizeObserver`) todavía no se haya completado,
 * como un nodo recién creado que se arrastra de inmediato. `initialWidth`/
 * `initialHeight` le dan a la librería un tamaño de partida coherente con
 * el que realmente van a pintar las tarjetas (`NodeCard.module.css`:
 * `.card` tiene `min-width: 160px`/`max-width: 220px`; la cabecera por sí
 * sola mide bastante menos que una diapositiva con respuestas) mientras
 * llega la medición real, que la sustituye en cuanto el `ResizeObserver` la
 * reporta — no hace falta que sea exacto, solo evitar el hueco de "sin
 * medir todavía". Se reutilizan los mismos valores que ya usa `Canvas`
 * como aproximación para centrar la vista sobre un nodo no medido
 * (`FALLBACK_NODE_WIDTH`/`FALLBACK_NODE_HEIGHT`), por coherencia entre
 * ambos usos.
 *
 * Exportadas (no solo un detalle interno de este fichero) para que
 * `layout/autoLayout.ts` calcule el espaciado del auto-layout con el mismo
 * tamaño de tarjeta que asume el resto del lienzo, en vez de duplicar estos
 * valores como un segundo número mágico que pudiera desincronizarse.
 */
export const INITIAL_NODE_WIDTH = 180
export const INITIAL_NODE_HEIGHT = 60

export type CanvasFlowNode = XyNode<CanvasNodeData>
export type CanvasFlowEdge = XyEdge<CanvasEdgeData>

/** Longitud máxima (en caracteres) del fragmento de contenido que se pinta
 *  en la tarjeta del lienzo (tarea 8): suficiente para "saber de un vistazo
 *  qué hay" sin que un `body` largo rompa el layout compacto de la tarjeta
 *  (además la propia tarjeta lo trunca visualmente con CSS si no cupiera). */
const BODY_PREVIEW_MAX_LENGTH = 90

/** Caché de fragmentos de contenido ya calculados, indexada por la propia
 *  cadena de entrada (el `body` de un Final, o los `body` de todos los
 *  bloques de texto de una diapositiva ya concatenados con un espacio — ver
 *  `textPreviewSourceFor`). `toFlowNodes` se recalcula en cada render de
 *  `Canvas` a partir de `project` (ver comentario de cabecera del módulo);
 *  extraer texto plano de uno o varios documentos Tiptap es barato pero no
 *  gratis, así que se evita repetirlo para nodos cuyo contenido de texto no
 *  ha cambiado entre renders — solo cambia cuando se edita de verdad, así
 *  que esta caché no crece de forma descontrolada en una sesión de edición
 *  normal. */
const bodyPreviewCache = new Map<string, string | undefined>()

function computeBodyPreview(source: string): string | undefined {
  const plain = source.trim()
  if (!plain) return undefined
  if (plain.length <= BODY_PREVIEW_MAX_LENGTH) return plain
  return `${plain.slice(0, BODY_PREVIEW_MAX_LENGTH).trimEnd()}…`
}

function bodyPreviewFor(source: string): string | undefined {
  const cached = bodyPreviewCache.get(source)
  if (cached !== undefined || bodyPreviewCache.has(source)) {
    return cached
  }
  const preview = computeBodyPreview(source)
  bodyPreviewCache.set(source, preview)
  return preview
}

/**
 * Fuente de texto plano de la vista previa de contenido de un nodo (tarea 8,
 * generalizada en el milestone "Bloques de contenido", fase 2):
 * - Un Final sigue teniendo un único `body` -> su texto plano tal cual.
 * - Una diapositiva ya no tiene un `body` único: se concatena, EN ORDEN, el
 *   texto plano de TODOS sus bloques `type: 'text'` de `content` (los
 *   bloques de imagen/audio no aportan texto), unidos por un espacio. Con un
 *   único bloque de texto (el caso más común) el resultado es idéntico al
 *   `body` único de antes.
 *
 * Recibe únicamente `SlideNode | FinalNode`: un nodo `intro` no tiene ni
 * `content` ni `body` (ver `IntroNodeSchema`) y usa su propio resumen,
 * `introSummaryFor` más abajo — `toNodeData` decide cuál de las dos llamar
 * antes de llegar aquí, así que esta función nunca necesita saber de `intro`.
 */
function textPreviewSourceFor(node: Exclude<DomainNode, IntroNode>): string {
  if (node.type === 'final') {
    return extractPlainText(parseRichBody(node.body))
  }
  return node.content
    .filter((block) => block.type === 'text')
    .map((block) => extractPlainText(parseRichBody(block.body)))
    .filter((text) => text !== '')
    .join(' ')
}

/**
 * Resumen legible de la diapositiva de Inicio (tarea 3, milestone
 * "Diapositiva de Inicio"), pintado en su tarjeta del lienzo a través del
 * mismo campo `bodyPreview` que ya usan `slide`/`final` (ver `BodyPreview`
 * en `nodeTypes.tsx`, agnóstica del tipo de nodo).
 *
 * `cicloId`/`asignaturaId` son ids internos (slugs/códigos), NUNCA texto
 * legible por sí mismos — se resuelven a sus NOMBRES buscando en `CICLOS`
 * (`src/domain/catalog.ts`). Si la portada está incompleta (falta ciclo,
 * asignatura, o el nombre del caso está vacío) se devuelve un aviso sutil en
 * vez de un resumen a medias con huecos — nunca un id crudo visible.
 */
function introSummaryFor(node: IntroNode): string {
  const ciclo = node.cicloId ? CICLOS.find((candidate) => candidate.id === node.cicloId) : undefined
  const asignatura =
    ciclo && node.asignaturaId
      ? ciclo.asignaturas.find((candidate) => candidate.id === node.asignaturaId)
      : undefined
  const caseName = node.caseName.trim()

  if (ciclo && asignatura && caseName) {
    // Resumen de ESPACIO DE TRABAJO: el ciclo conserva su prefijo interno
    // ("AC - ", "ADAF - "…) y la asignatura lleva su código de módulo entre
    // paréntesis (`asignaturaWorkspaceName`) — al contrario que en la
    // salida (HTML/SCORM/revisión profes/reproductor), donde el ciclo pierde
    // ese prefijo (`cicloOutputName`) y la asignatura no lleva código. Ver
    // comentarios de ambas funciones en `src/domain/catalog.ts`.
    return `${ciclo.name} · ${asignaturaWorkspaceName(asignatura)} — ${caseName}`
  }
  return '(pendiente de completar)'
}

function toNodeData(node: DomainNode, startNodeId: string): BaseCanvasNodeData {
  const trimmedNote = node.internalNote?.trim()
  const base: BaseCanvasNodeData = {
    nodeType: node.type,
    number: node.number,
    title: node.title,
    isStart: node.id === startNodeId,
    internalNote: trimmedNote ? trimmedNote : undefined,
    bodyPreview:
      node.type === 'intro' ? introSummaryFor(node) : bodyPreviewFor(textPreviewSourceFor(node)),
  }
  if (node.type === 'slide') {
    base.responses = sortByLetter(node.responses).map((response) => ({
      id: response.id,
      text: response.text,
    }))
    base.color = node.color
  }
  return base
}

/**
 * Mapea los nodos de dominio a nodos de `@xyflow/react`.
 *
 * `selectedNodeIds` alimenta el campo `selected` de cada nodo. Esto no crea
 * una segunda fuente de verdad (sigue derivándose de `store.selection` en
 * cada render) y es necesario para que la selección se vea reflejada
 * visualmente en el lienzo cuando cambia por una vía distinta al propio
 * gesto de selección de `@xyflow/react` (p.ej. `focusNode` desde
 * `LeftPanel`) — como el lienzo es "controlado" (no usa `onNodesChange`),
 * sin este campo el resaltado de selección no sobreviviría a un re-render
 * no relacionado.
 */
export function toFlowNodes(
  project: ProjectDocument,
  selectedNodeIds: readonly string[],
): CanvasFlowNode[] {
  const selected = new Set(selectedNodeIds)
  const edges = deriveEdges(project)
  const nodesWithOutgoing = nodeIdsWithOutgoingEdge(edges)
  const highlightedTargets = highlightedTargetNodeIds(edges, selected)
  const hasSelection = selected.size > 0

  return project.graph.nodes.map((node) => {
    const isSelected = selected.has(node.id)
    const isHighlighted = !isSelected && highlightedTargets.has(node.id)
    return {
      id: node.id,
      type: node.type,
      position: node.position,
      selected: isSelected,
      data: {
        ...toNodeData(node, project.graph.startNodeId),
        hasNoOutgoing:
          (node.type === 'slide' || node.type === 'intro') && !nodesWithOutgoing.has(node.id),
        isHighlighted,
        isDimmed: hasSelection && !isSelected && !isHighlighted,
      },
      initialWidth: INITIAL_NODE_WIDTH,
      initialHeight: INITIAL_NODE_HEIGHT,
    }
  })
}

/**
 * Ids de todos los nodos que son origen de al menos una arista derivada
 * (`deriveEdges`). Pura, sin dependencia de `@xyflow/react`: es la base del
 * cálculo de "sin salida" (punto 1) — un nodo `slide` que NO está en este
 * conjunto no tiene ninguna salida conectada, sea porque es "de continuar"
 * sin `targetNodeId`, porque es "de decisión" sin ninguna respuesta, o
 * porque tiene respuestas pero ninguna con destino.
 */
function nodeIdsWithOutgoingEdge(edges: readonly DomainEdge[]): Set<string> {
  return new Set(edges.map((edge) => edge.source))
}

/**
 * Ids de los nodos destino de una arista saliente de algún nodo
 * seleccionado (punto 4: resaltar las conexiones de la diapositiva
 * seleccionada). Vacío si no hay selección.
 */
function highlightedTargetNodeIds(
  edges: readonly DomainEdge[],
  selectedNodeIds: ReadonlySet<string>,
): Set<string> {
  const targets = new Set<string>()
  for (const edge of edges) {
    if (selectedNodeIds.has(edge.source)) {
      targets.add(edge.target)
    }
  }
  return targets
}

/** Datos que lleva cada arista de `@xyflow/react` en su campo `data`,
 *  consumidos por el tipo de arista personalizado (`edges/edgeTypes.tsx`). */
export interface CanvasEdgeData extends Record<string, unknown> {
  /** Posición (0-based) de esta arista dentro de su grupo de aristas
   *  "paralelas" (ver `computeEdgeLanes` en `edges/edgeGeometry.ts`). `0` =
   *  sin desplazamiento. */
  laneIndex: number
  /** Tamaño total del grupo al que pertenece esta arista. `1` si va sola
   *  (nada con lo que solaparse). */
  laneSize: number
  /** `true` cuando el nodo origen de esta arista está seleccionado (punto
   *  4): se pinta con el color de acento y trazo más grueso. */
  isHighlighted: boolean
  /** `true` cuando hay una selección activa y esta arista no sale de un
   *  nodo seleccionado: se atenúa para dar contraste. */
  isDimmed: boolean
  /** `true` para la arista de la rama "si no" (`Edge.kind === 'else'` en
   *  dominio, ver `deriveEdges`): se pinta discontinua y con una etiqueta
   *  "si no" (ver `edges/edgeTypes.tsx`), para distinguirla de un vistazo de
   *  una arista normal. */
  isElse: boolean
}

/**
 * Mapea las aristas derivadas de dominio (`deriveEdges`) a aristas de
 * `@xyflow/react`. El `sourceHandle` de dominio es el `responseId` "pelado"
 * (o `undefined` para la salida de "Continuar" de una diapositiva sin
 * respuestas); aquí se traduce al id de handle real usado por los nodos
 * personalizados (`response:<id>` u `OUT_HANDLE_ID`).
 *
 * Las aristas no llevan `label`: antes mostraban la letra de la respuesta
 * (A/B/C/D) sobre la línea, y las letras ya no se muestran nunca al
 * usuario.
 *
 * Todas las aristas usan el tipo personalizado `BRUNCH_EDGE_TYPE` (punto 2
 * y 3: siempre por delante de los nodos y con desplazamiento lateral
 * determinista cuando hay paralelismo/convergencia) y llevan en `data` el
 * carril calculado por `computeEdgeLanes` y el resaltado derivado de
 * `selectedNodeIds` (punto 4).
 */
export function toFlowEdges(
  project: ProjectDocument,
  selectedNodeIds: readonly string[] = [],
): CanvasFlowEdge[] {
  const edges = deriveEdges(project)
  const lanes = computeEdgeLanes(edges)
  const selected = new Set(selectedNodeIds)
  const hasSelection = selected.size > 0

  return edges.map((edge) => {
    const lane = lanes.get(edge.id) ?? { laneIndex: 0, laneSize: 1 }
    const isHighlighted = selected.has(edge.source)
    const data: CanvasEdgeData = {
      laneIndex: lane.laneIndex,
      laneSize: lane.laneSize,
      isHighlighted,
      isDimmed: hasSelection && !isHighlighted,
      isElse: edge.kind === 'else',
    }
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ? responseHandleId(edge.sourceHandle) : OUT_HANDLE_ID,
      targetHandle: IN_HANDLE_ID,
      type: BRUNCH_EDGE_TYPE,
      data,
    }
  })
}

/** Argumentos resueltos para `store.connect` a partir de un `onConnect`. */
export interface ResolvedConnection {
  sourceNodeId: string
  targetNodeId: string
  responseId?: string
}

/**
 * Resuelve los parámetros de `onConnect` de `@xyflow/react` (que pueden
 * llevar `source`/`target` nulos según su propio tipado) a los argumentos
 * que espera `store.connect`, derivando `responseId` del `sourceHandle`
 * cuando tiene el prefijo `response:`. Devuelve `null` si faltan `source` o
 * `target` (conexión incompleta; no debería ocurrir en la práctica, pero el
 * tipo de `@xyflow/react` los declara opcionales).
 */
export function resolveConnection(params: {
  source?: string | null
  target?: string | null
  sourceHandle?: string | null
}): ResolvedConnection | null {
  if (!params.source || !params.target) return null
  return {
    sourceNodeId: params.source,
    targetNodeId: params.target,
    responseId: parseResponseHandleId(params.sourceHandle),
  }
}
