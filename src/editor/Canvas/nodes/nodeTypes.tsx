import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { MAX_RESPONSES } from '../../../domain'
import type { NodeType, SlideColor } from '../../../domain'
import type { CanvasFlowNode, CanvasNodeData, CanvasResponseSummary } from '../adapter'
import { IN_HANDLE_ID, OUT_HANDLE_ID, responseHandleId } from '../handles'
import styles from './NodeCard.module.css'

/**
 * Nodos personalizados del lienzo, uno por tipo de dominio (`intro`, `slide`
 * y `final`). Compactos a propósito: referencia/título + código corto
 * "D{número}" (nunca el `id` interno), truncados con CSS si son largos. El
 * `body` completo del nodo nunca se pinta aquí — el lienzo debe seguir
 * siendo legible con decenas de nodos; el contenido completo se edita en el
 * inspector.
 *
 * Tarea "Numeración corta": la antigua etiqueta traducida de tipo
 * (`NODE_TYPE_LABEL`, "Inicio"/"Diapositiva"/"Final") ya NO se pinta en la
 * cabecera de la tarjeta — la sustituye `shortNodeLabel` ("D" + `number`)
 * para los tres tipos de nodo por igual: desde el punto de vista del
 * usuario "todo son diapositivas numeradas". `NODE_TYPE_LABEL` sigue
 * existiendo y en uso en otros sitios (menú "¿Qué quieres crear?" de
 * `ConnectionMenu`, botones "+ Inicio/Diapositiva/Final" de `LeftPanel`,
 * texto del Inspector), solo deja de usarse AQUÍ para esta etiqueta visual
 * concreta. Tarea "Orden de la tarjeta": dentro de la cabecera, la
 * referencia/título se pinta ANTES que el código corto (ver `Header` más
 * abajo y `.title`/`.type` en `NodeCard.module.css`).
 *
 * Milestone "Diapositiva de Inicio": SÍ vuelve a existir un nodo visual de
 * "Inicio" (`intro`), a diferencia del antiguo tipo `start` que este mismo
 * comentario descartaba — pero es un nodo de dominio real (portada de
 * ciclo/asignatura/caso), no el marcador puramente visual de antes. Cuando
 * el proyecto todavía no tiene `intro` (documentos construidos con
 * `createProject` de bajo nivel, ver su comentario), `graph.startNodeId`
 * sigue pudiendo apuntar a una `SlideNode` normal, marcada con la etiqueta
 * discreta de siempre en su cabecera (`data.isStart`).
 *
 * Milestone "Inicio siempre es D1": un `intro` ya NO muestra título/Ref.
 * oculta en su tarjeta (ese campo se oculta también en el Inspector, ver
 * `NodeFields` en `Inspector.tsx` — ya no aporta nada: la identidad de un
 * `intro` es su propio ciclo/asignatura/caso, siempre único en el proyecto).
 * En su lugar, `shortNodeLabel` devuelve `'INICIO'` (nunca `'D1'`) para este
 * tipo, pintado en `IntroHeader` (más abajo) en tamaño grande y prominente
 * — sustituye por completo a `Header`, que desde este mismo criterio queda
 * exclusivo de `slide`.
 *
 * Petición de usuario "el Final como el Inicio": un `final` sigue el MISMO
 * patrón que `intro` desde ese cambio — sin título/Ref. oculta (tampoco se
 * edita ya en el Inspector), `shortNodeLabel` devuelve `'FINAL'` (nunca
 * `'D{número}'`) para este tipo, pintado en `FinalHeader` (más abajo, mismo
 * tamaño/criterio que `IntroHeader`) en vez de `Header`. A diferencia de
 * `intro`, SÍ puede haber varios `final` en un proyecto — perder el número
 * visible en el lienzo es una renuncia deliberada (normalmente hay un único
 * Final por proyecto desde que existe `FinalAlternateSection`, milestone
 * "+1 fallo con Game Over"); el desplegable de destino del Inspector
 * (`nodeOptionLabel`) SÍ sigue mostrando el número, ahí hace falta para
 * distinguir varios finales entre sí.
 */

/** Exportado para que otros componentes del lienzo (p.ej. `ConnectionMenu`,
 *  el menú "¿Qué quieres añadir?") reutilicen el mismo diccionario de
 *  etiquetas en vez de duplicarlo. */
export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  intro: 'Inicio',
  slide: 'Diapositiva',
  final: 'Final',
}

/** Etiqueta discreta que marca la diapositiva de inicio del proyecto, tanto
 *  aquí como en la lista de `LeftPanel`. */
export const START_NODE_LABEL = 'Inicio'

/**
 * Código corto "D{número}" (Tarea "Numeración corta"): sustituye a
 * `NODE_TYPE_LABEL[type]` en el sitio donde se identifica visualmente cada
 * nodo, tanto en la cabecera de la tarjeta del lienzo (`Header`/`IntroHeader`
 * más abajo) como en la fila de la lista del panel izquierdo
 * (`LeftPanel.tsx`, que importa y reutiliza esta misma función en vez de
 * duplicarla — al cambiar aquí, `LeftPanel` hereda el cambio sin tocar ese
 * archivo). Acepta cualquier objeto con `number` (nodo de dominio, con
 * `type`, o `CanvasNodeData`, con `nodeType`) para no acoplarse a un tipo
 * concreto — de ahí que el discriminador se acepte con cualquiera de los dos
 * nombres de campo. Ya NO se muestra el campo `number` "pelado" aparte (sin
 * la "D"): era redundante con este mismo código corto, que ya sirve de
 * referencia.
 *
 * Milestone "Inicio siempre es D1": para un nodo `intro` devuelve siempre
 * `'INICIO'`, nunca `'D1'` — aunque el propio dominio ya garantiza que un
 * `intro` nace con `number: 1` (ver `src/domain/project.ts`/`migration.ts`),
 * esta función no depende de ese número en absoluto: un `intro` se identifica
 * por ser el único punto de partida del proyecto, no por su posición en la
 * numeración.
 *
 * Petición de usuario "el Final como el Inicio": mismo criterio para
 * `final`, que devuelve siempre `'FINAL'`, nunca `'D{número}'` — a
 * diferencia de `intro` SÍ puede haber varios en un proyecto, pero el
 * número deja de mostrarse en el lienzo/panel izquierdo de todos modos (ver
 * comentario de cabecera del módulo). Solo `slide` conserva `"D" + number`.
 */
export function shortNodeLabel(node: {
  number: number
  type?: NodeType
  nodeType?: NodeType
}): string {
  const type = node.type ?? node.nodeType
  if (type === 'intro') return 'INICIO'
  if (type === 'final') return 'FINAL'
  return `D${node.number}`
}

/** Máximo de respuestas que se resumen dentro de la tarjeta. El propio
 *  esquema de dominio ya limita `responses` a 4, así que esto es solo una
 *  defensa adicional si esa cota cambiara en el futuro. */
const MAX_SUMMARIZED_RESPONSES = MAX_RESPONSES

/** "Referencia" es la etiqueta de UI del campo `title` de dominio (ver el
 *  `<label>` del Inspector) — el nombre del campo no cambia, solo el texto
 *  visible. */
function displayTitle(title: string): string {
  return title.trim() || 'Sin ref. oculta'
}

/** Texto accesible de la insignia de aviso "sin salida" (punto 1),
 *  reutilizado como `title` del `<span>` — ver `NodeCard.module.css`.
 *  Genérico ("nodo", no "diapositiva") desde el milestone "Diapositiva de
 *  Inicio": ahora también se pinta sobre un `intro` sin `targetNodeId`. */
const NO_OUTGOING_WARNING_TEXT = 'Este nodo no tiene ninguna salida conectada'

/** Mapa color de paleta -> clase CSS del fondo correspondiente
 *  (`NodeCard.module.css`). Solo se consulta para nodos `slide` con
 *  `data.color` fijado, ver `cardClassName`. */
const SLIDE_COLOR_CARD_CLASS: Record<SlideColor, string | undefined> = {
  yellow: styles.cardSlideYellow,
  orange: styles.cardSlideOrange,
  pink: styles.cardSlidePink,
  purple: styles.cardSlidePurple,
  cyan: styles.cardSlideCyan,
  gray: styles.cardSlideGray,
  red: styles.cardSlideRed,
}

/** Combina las clases modificadoras de `.card` según el resaltado calculado
 *  en `adapter.ts` (puntos 1 y 4) y el tipo de nodo. Centralizado aquí para
 *  que `SlideNodeView`/`FinalNodeView`/`IntroNodeView` no dupliquen la
 *  combinación. `cardFinal` (fondo azul clarito) solo se aplica a `final`;
 *  `cardIntro` (fondo verde clarito, milestone "Diapositiva de Inicio") solo
 *  a `intro`; una `slide` con `data.color` fijado usa el token de esa
 *  entrada de la paleta (ver `SLIDE_COLOR_CARD_CLASS`) — sin color, mantiene
 *  su fondo neutro sin cambios, igual que siempre. `cardGameOver` (marco
 *  rojo, milestone "+1 fallo con Game Over"): solo la `slide` con
 *  `data.canvasBadge === 'game-over'` — se combina con cualquier color de
 *  fondo que además tenga, mismo canal `outline` que `cardFinal`/
 *  `cardIntro` (ver su comentario en `NodeCard.module.css`). */
function cardClassName(data: CanvasNodeData): string {
  return [
    styles.card,
    data.nodeType === 'final' && styles.cardFinal,
    data.nodeType === 'intro' && styles.cardIntro,
    data.nodeType === 'slide' && data.color && SLIDE_COLOR_CARD_CLASS[data.color],
    data.nodeType === 'slide' && data.canvasBadge === 'game-over' && styles.cardGameOver,
    data.hasNoOutgoing && styles.cardWarning,
    data.isHighlighted && styles.cardHighlighted,
    data.isDimmed && styles.cardDimmed,
  ]
    .filter(Boolean)
    .join(' ')
}

/** Insignia de aviso "sin salida" (punto 1): solo se pinta para
 *  `data.hasNoOutgoing`, que `adapter.ts` ya garantiza `false` para nodos
 *  `final`, y calcula igual para `slide`/`intro` (milestone "Diapositiva de
 *  Inicio", ver comentario de `hasNoOutgoing` en `adapter.ts`). */
function NoOutgoingBadge({ data }: { data: CanvasNodeData }) {
  if (!data.hasNoOutgoing) return null
  return (
    <span className={styles.warningBadge} title={NO_OUTGOING_WARNING_TEXT} aria-label={NO_OUTGOING_WARNING_TEXT}>
      !
    </span>
  )
}

/** Icono de pin discreto (tarea 6): solo cuando el nodo tiene una nota
 *  interna con contenido. El `title` nativo del navegador basta como
 *  tooltip — no se abre ningún panel ni popover propio. */
function PinBadge({ data }: { data: CanvasNodeData }) {
  if (!data.internalNote) return null
  return (
    <span
      className={styles.pinBadge}
      title={`Nota interna: ${data.internalNote}`}
      aria-label={`Nota interna: ${data.internalNote}`}
    >
      📌
    </span>
  )
}

/**
 * Cabecera de una `slide`, EXCLUSIVA de este tipo desde la petición de
 * usuario "el Final como el Inicio" (antes también servía para `final`,
 * ver `FinalHeader` más abajo para su reemplazo). Título/Ref. oculta + código
 * corto "D{número}".
 */
function Header({ data }: { data: CanvasNodeData }) {
  return (
    <div className={styles.header}>
      {/* Tarea "Orden de la tarjeta": la referencia/título se pinta PRIMERO,
          el código corto "D{número}" (antes, la etiqueta de tipo) justo
          después — ver `.title`/`.type` en `NodeCard.module.css` para el
          reflejo visual de este mismo orden (título a la izquierda,
          insignias a la derecha). */}
      <span className={styles.title}>{displayTitle(data.title)}</span>
      <span className={styles.type}>{shortNodeLabel(data)}</span>
      {/* La marca "Inicio" solo aporta información en una `SlideNode` que
          hace de inicio (documentos sin `intro`, ver comentario de cabecera
          del módulo): en un nodo `intro` sería redundante — un `intro`
          siempre es `startNodeId` cuando existe (`IntroNodeSchema`), y ya se
          distingue de un vistazo por su propio fondo (`.cardIntro`) y su
          contorno negro (Tarea "Contorno de Inicio/Final") sin necesidad de
          repetir "Inicio" en texto. */}
      {data.isStart && data.nodeType !== 'intro' && (
        <span className={styles.startMark} title="Diapositiva de inicio">
          {START_NODE_LABEL}
        </span>
      )}
      <PinBadge data={data} />
    </div>
  )
}

/** Fragmento corto del contenido de la diapositiva (tarea 8), para saber de
 *  un vistazo qué hay sin abrir el Inspector. No se pinta nada si el nodo
 *  todavía no tiene contenido, para no ensuciar visualmente una tarjeta
 *  recién creada. */
function BodyPreview({ data }: { data: CanvasNodeData }) {
  if (!data.bodyPreview) return null
  return <div className={styles.bodyPreview}>{data.bodyPreview}</div>
}

/**
 * Cabecera EXCLUSIVA de la tarjeta de Inicio (`intro`, milestone "Inicio
 * siempre es D1") — sustituye por completo a `Header` para este tipo, nunca
 * se usa junto a ella. Dos diferencias deliberadas frente a `Header`:
 * - SIN título/Ref. oculta: ya no aplica a un `intro` (ver comentario de
 *   cabecera del módulo y `NodeFields` en `Inspector.tsx`) — lo único que
 *   necesita esta tarjeta para identificarse es "INICIO" más el resumen de
 *   ciclo/asignatura/caso que ya pinta `BodyPreview` debajo.
 * - "INICIO" (`shortNodeLabel`, nunca `'D1'` para este tipo) en
 *   `.introLabel`, GRANDE y prominente (más grande que cualquier otro texto
 *   de la tarjeta, incluido el título de una `slide`/`final`) en vez del
 *   badge pequeño `.type` de `Header` — es el dato principal de la tarjeta,
 *   no una insignia secundaria.
 */
function IntroHeader({ data }: { data: CanvasNodeData }) {
  return (
    <div className={styles.introHeader}>
      <span className={styles.introLabel}>{shortNodeLabel(data)}</span>
      <PinBadge data={data} />
    </div>
  )
}

/**
 * Cabecera EXCLUSIVA de la tarjeta de un `final` (petición de usuario "el
 * Final como el Inicio") — sustituye por completo a `Header` para este
 * tipo, nunca se usa junto a ella. Mismo criterio EXACTO que `IntroHeader`
 * (mismo layout centrado, misma clase `.introLabel` reutilizada para el
 * tamaño grande — sin duplicar esa regla de CSS por un nombre distinto):
 * sin título/Ref. oculta (ya no se edita para `final`, ver `NodeFields` en
 * `Inspector.tsx`), "FINAL" (`shortNodeLabel`, nunca `'D{número}'` para
 * este tipo) en tamaño grande y prominente en vez del badge pequeño
 * `.type` de `Header`.
 */
function FinalHeader({ data }: { data: CanvasNodeData }) {
  return (
    <div className={styles.introHeader}>
      <span className={styles.introLabel}>{shortNodeLabel(data)}</span>
      <PinBadge data={data} />
    </div>
  )
}

/**
 * Insignia "+1 FALLO"/"GAME OVER" (milestone "+1 fallo con Game Over",
 * `SlideNodeSchema.canvasBadge`) — SOLO para los 2 nodos que crea
 * `addGameOverPack`, `undefined` para cualquier otra `slide`. A diferencia
 * de `IntroHeader`/`FinalHeader`, NO sustituye a `Header`: se pinta ANTES
 * (ver `SlideNodeView`), como una fila extra encima — una diapositiva del
 * pack sigue necesitando su título/Ref. oculta/D-número normales debajo,
 * a diferencia de `intro`/`final`. El texto en sí es fijo (no configurable
 * desde el Inspector): "+1 FALLO" en el color de acento de siempre,
 * "GAME OVER" en el rojo de aviso (`--bs-color-danger`, mismo tono que el
 * marco rojo de `.cardGameOver`, ver `cardClassName`).
 */
function SlideBadgeHeader({ data }: { data: CanvasNodeData }) {
  if (!data.canvasBadge) return null
  const isGameOver = data.canvasBadge === 'game-over'
  return (
    <div className={styles.badgeHeader}>
      <span className={isGameOver ? styles.badgeLabelDanger : styles.badgeLabel}>
        {isGameOver ? 'GAME OVER' : '+1 FALLO'}
      </span>
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
    <div className={cardClassName(data)}>
      <NoOutgoingBadge data={data} />
      <InHandle />
      <SlideBadgeHeader data={data} />
      <Header data={data} />
      <BodyPreview data={data} />
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
    <div className={cardClassName(data)}>
      <InHandle />
      <FinalHeader data={data} />
      <BodyPreview data={data} />
    </div>
  )
}

/**
 * Tarjeta de la diapositiva de Inicio (nodo `intro`, milestone "Diapositiva
 * de Inicio"). A diferencia de `SlideNodeView`/`FinalNodeView`:
 * - SIN `InHandle`: nada puede conectar HACIA el inicio, es siempre el punto
 *   de partida del recorrido (mismo criterio que documenta
 *   `IntroNodeSchema` en `src/domain/schemas.ts`).
 * - CON `OutHandle` siempre presente (nunca condicionado a "sin respuestas",
 *   a diferencia de `SlideNodeView`): un `intro` no tiene `responses`, su
 *   única salida es siempre la de "continuar" hacia `targetNodeId` — mismo
 *   handle (`OUT_HANDLE_ID`) que ya usa una diapositiva "de continuar".
 * - `BodyPreview` pinta aquí el resumen de ciclo/asignatura/caso resuelto a
 *   nombres legibles (`introSummaryFor` en `adapter.ts`), nunca el `content`
 *   de una diapositiva normal (un `intro` no tiene).
 * - Cabecera propia (`IntroHeader`, no `Header`): sin título/Ref. oculta,
 *   con "INICIO" en tamaño grande — ver comentario de `IntroHeader`.
 */
export function IntroNodeView({ data }: NodeProps<CanvasFlowNode>) {
  return (
    <div className={cardClassName(data)}>
      <NoOutgoingBadge data={data} />
      <IntroHeader data={data} />
      <BodyPreview data={data} />
      <OutHandle />
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
  intro: IntroNodeView,
  slide: SlideNodeView,
  final: FinalNodeView,
}
