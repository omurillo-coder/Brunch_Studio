import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  useProject,
  useProjectStore,
  useSelectedNodeIds,
  useTitleFocusRequestNodeId,
} from '../../store'
import { SLIDE_COLORS } from '../../domain'
import type { Node, NodeType, ProjectDocument, SlideColor, SlideNode } from '../../domain'
import { NODE_TYPE_LABEL, shortNodeLabel } from '../Canvas/nodes/nodeTypes'
import { RichTextEditor } from '../richText/RichTextEditor'
import {
  clampInspectorWidth,
  loadInspectorWidth,
  saveInspectorWidth,
} from '../uiPreferences'
import styles from './Inspector.module.css'
import { ContentBlocksSection } from './sections/ContentBlocksSection'
import { ResponsesSection, SlideVisitEffectsSection } from './sections/ResponsesSection'
import { ContinueSection } from './sections/RoutingSection'
import { IntroSection } from './sections/IntroSection'
import { ConnectionsSection } from './sections/ConnectionsSection'
import { DeleteNodeButton, DuplicateNodeButton, InternalNoteField } from './sections/NodeActions'
import { FinalAlternateSection } from './sections/FinalAlternateSection'

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
export const NO_TARGET_VALUE = '__none__'

/**
 * Etiqueta legible de un nodo para mostrarlo como destino posible en un
 * `<select>` — nunca el `id` interno (UUID) como texto visible. Formato:
 * "<Tipo> <número> — <referencia o 'Sin ref. oculta'>", p.ej.
 * "Diapositiva 3 — Bienvenida". "Ref. oculta" es la etiqueta de UI del campo
 * `title` del dominio (ver comentario de `NodeFields` más abajo, junto al
 * `<label>` del campo): el nombre del campo en el modelo no cambia, solo su
 * texto visible.
 *
 * `intro`/`final` (petición de usuario "el Final como el Inicio"): ninguno
 * de los dos edita ya `title` desde el Inspector (ver `referenceField` en
 * `NodeFields`, más abajo), así que mostrar "— Sin ref. oculta" tras su
 * tipo/número sería el mismo hueco vacío de siempre sin ninguna
 * información real — se omite el segmento entero para estos dos tipos,
 * dejando solo "<Tipo> <número>" (p.ej. "Inicio 1", "Final 5").
 */
export function nodeOptionLabel(node: Node): string {
  if (node.type === 'intro' || node.type === 'final') {
    return `${NODE_TYPE_LABEL[node.type]} ${node.number}`
  }
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
export function fieldClassName(base: string | undefined, value: string): string {
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
  // ver también `nodeOptionLabel` más arriba). `id`/`htmlFor` se dejan como
  // estaban: son detalle interno del DOM, no texto visible. Petición de
  // usuario "el Final como el Inicio": desde ese cambio, SOLO se renderiza
  // para una `slide` (ver más abajo) — ni `intro` (milestone "Inicio
  // siempre es D1") ni `final` la necesitan ya: cada uno se identifica por
  // su cabecera propia en el lienzo (`IntroHeader`/`FinalHeader`,
  // `nodeTypes.tsx`) en vez de por este campo de texto libre.
  const referenceField = (
    <div className={styles.referenceField}>
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

  // Petición de usuario: "que el tipo de nodo aparezca arriba de la
  // referencia oculta" — kicker discreto ("Diapositiva · D3") justo encima
  // de `referenceField`. Solo tiene sentido junto a `referenceField` (que
  // ahora, ver más abajo, SOLO se renderiza para una `slide`), así que no
  // hace falta condicionarlo aparte: viaja siempre pegado a él.
  const nodeKindLabel = (
    <span className={styles.nodeKindLabel}>
      {NODE_TYPE_LABEL[node.type]} · {shortNodeLabel(node)}
    </span>
  )

  return (
    <div className={styles.fields}>
      {node.type === 'slide' ? (
        /* Tarea 4 (reorganización del Inspector): Color + Ref. oculta +
           Contenido (bloques) + Nota interna agrupados en un bloque
           diferenciado ("sobre esta diapositiva en sí"), Contenido/Nota
           interna en el mismo orden relativo de siempre. El resto de la
           sección (destino/respuestas/enrutado condicional/conexiones)
           queda FUERA de este bloque, ver más abajo — mismo contenedor con
           borde/fondo sutil (`.metaGroup`, `Inspector.module.css`) que ya
           usa el resto de la app para agrupar visualmente (p.ej.
           `VariablesPanel`).

           Petición de usuario ("la referencia oculta y el color pueden ir
           en la misma línea", "mira de compactar las cosas"): Ref. oculta +
           Color ya NO son dos bloques apilados — comparten una fila
           (`.metaFieldsRow`), Ref. oculta a la izquierda (ocupa el espacio
           sobrante) y Color a la derecha (se ajusta a su contenido, sus
           pastillas envuelven en 2 filas en vez de 1 — ver
           `.colorSection`/`.colorSwatch` en `Inspector.module.css`). */
        <div className={styles.metaGroup}>
          {nodeKindLabel}
          <div className={styles.metaFieldsRow}>
            {referenceField}
            <SlideColorSection node={node} />
          </div>
          <ContentBlocksSection node={node} filePath={filePath} />
          <InternalNoteField node={node} />
        </div>
      ) : (
        <>
          {/* Milestone "Inicio siempre es D1" + petición de usuario "el
              Final como el Inicio": "Ref. oculta" ya NO se muestra para
              `intro` NI `final` — ninguno de los dos necesita esa
              referencia interna: el Inicio se identifica por su propio
              ciclo/asignatura/caso, y el Final ahora se identifica solo por
              "FINAL" (cabecera grande en el lienzo, ver `FinalHeader` en
              `nodeTypes.tsx`) — normalmente hay un único Final por
              proyecto, con su variante alternativa por variable
              (`FinalAlternateSection`, más abajo). El campo `title` sigue
              existiendo en el dominio (`baseNodeFields`, compatibilidad con
              documentos guardados antes de este cambio) — solo deja de
              editarse desde aquí. */}
          {node.type === 'final' && (
            <>
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
              <FinalAlternateSection node={node} variables={project.variables} />
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
          {/* Al final, DESPUÉS de las respuestas a propósito (no dentro de
              `.metaGroup`, arriba): varios tests existentes localizan
              botones "+ Añadir efecto" por posición ordinal
              (`getAllByRole(...)[0]` = el de la primera respuesta) —
              colocar esta sección antes desplazaría esos índices. */}
          <SlideVisitEffectsSection node={node} variables={project.variables} />
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
