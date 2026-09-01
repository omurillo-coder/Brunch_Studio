import { useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useProject, useProjectStore, useSelectedNodeIds, useViewportCenter } from '../../store'
import { CICLOS } from '../../domain'
import type { Node, NodePosition, NodeType } from '../../domain'
import { NODE_TYPE_LABEL, START_NODE_LABEL, shortNodeLabel } from '../Canvas/nodes/nodeTypes'
import { extractPlainText, parseRichBody } from '../richText/richTextContent'
import styles from './LeftPanel.module.css'

/**
 * Tipos "normales" que se pueden crear desde este panel, sin límite de
 * cantidad. Ya no hay un botón de "Decisión" separado — una Diapositiva nace
 * en modo "de continuar" y se convierte en decisión al añadirle respuestas
 * desde el Inspector.
 *
 * El botón "+ Inicio" (nodo `intro`, milestone "Diapositiva de Inicio") NO
 * vive en esta lista: a diferencia de `slide`/`final`, solo puede existir
 * COMO MUCHO UNO por proyecto (ver `IntroNodeSchema`), así que se pinta
 * aparte con su propia lógica de deshabilitado — ver `handleCreate`/JSX más
 * abajo.
 */
const CREATABLE_TYPES: NodeType[] = ['slide', 'final']

/**
 * Heurística de posición de RESPALDO para nodos creados desde este panel,
 * usada únicamente mientras `Canvas` todavía no ha publicado ningún centro
 * visible (`ui.viewportCenter`, ver store) — no debería ocurrir en la app
 * real (`Canvas` siempre está montado junto a este panel), pero cubre el
 * instante antes de su primer cálculo y cualquier test que renderice
 * `LeftPanel` sin `Canvas`. Cascadeo en una cuadrícula de 5 columnas, origen
 * en (80, 80), separación de 220px en horizontal y 160px en vertical: no
 * pretende ser un layout definitivo, solo evitar que los nodos nuevos se
 * apilen exactamente unos sobre otros.
 */
function nextCascadePosition(existingNodeCount: number): NodePosition {
  const columns = 5
  const column = existingNodeCount % columns
  const row = Math.floor(existingNodeCount / columns)
  return { x: 80 + column * 220, y: 80 + row * 160 }
}

/**
 * Buscador del proyecto (fase 8; generalizado en el milestone "Bloques de
 * contenido", fase 2): `query` ya normalizado (recortado, en minúsculas). Un
 * nodo aparece en la lista filtrada si el término buscado aparece, sin
 * distinguir mayúsculas/minúsculas, en su título, en el texto plano real de
 * CUALQUIERA de sus bloques de texto (`SlideNode.content`, tipo `text`) o del
 * único `body` de un Final, o en el texto de alguna de sus respuestas de
 * decisión.
 *
 * Un cuerpo de texto (`body` de un bloque de texto, o el `body` único de un
 * Final) es JSON de Tiptap serializado, NUNCA se compara como substring
 * directo: eso encontraría falsos positivos en la propia sintaxis JSON
 * (p.ej. buscar "type" "encontraría" cualquier nodo, por la clave
 * `"type":"doc"`). Se parsea con `parseRichBody` (la misma función que usa
 * `RichTextEditor`/la exportación) y se extrae su texto real con
 * `extractPlainText`, compartida con `src/editor/richText/richTextContent.ts`.
 *
 * Antes de esta fase una diapositiva tenía un único `body`; ahora puede tener
 * varios bloques de texto intercalados con imagen/audio (`SlideNode.content`)
 * — se comprueba cada uno de los bloques `type: 'text'`, en cualquier orden,
 * no solo el primero.
 *
 * Milestone "Diapositiva de Inicio": un nodo `intro` no tiene título de la
 * misma forma "narrativa" que el resto (su `title` es solo la "Referencia"
 * interna, igual que cualquier otro nodo, ya cubierta arriba), así que
 * además se comprueba su `caseName` y los NOMBRES de ciclo/asignatura
 * elegidos — nunca sus ids (`cicloId`/`asignaturaId` son slugs/códigos
 * internos, no texto que el usuario reconocería al buscar) — resueltos
 * contra el catálogo `CICLOS`.
 */
function nodeMatchesQuery(node: Node, query: string): boolean {
  if (node.title.toLowerCase().includes(query)) {
    return true
  }
  if (node.type === 'intro') {
    if (node.caseName.toLowerCase().includes(query)) {
      return true
    }
    const ciclo = node.cicloId ? CICLOS.find((candidate) => candidate.id === node.cicloId) : undefined
    if (ciclo && ciclo.name.toLowerCase().includes(query)) {
      return true
    }
    const asignatura =
      ciclo && node.asignaturaId
        ? ciclo.asignaturas.find((candidate) => candidate.id === node.asignaturaId)
        : undefined
    return asignatura ? asignatura.name.toLowerCase().includes(query) : false
  }
  if (node.type === 'final') {
    if (extractPlainText(parseRichBody(node.body)).toLowerCase().includes(query)) {
      return true
    }
    return false
  }
  const matchesTextBlock = node.content.some(
    (block) =>
      block.type === 'text' && extractPlainText(parseRichBody(block.body)).toLowerCase().includes(query),
  )
  if (matchesTextBlock) {
    return true
  }
  return node.responses.some((response) => response.text.toLowerCase().includes(query))
}

/** Panel izquierdo: buscar/filtrar, crear nodos y navegar la lista de nodos
 *  existentes. */
export function LeftPanel() {
  const project = useProject()
  const createNode = useProjectStore((state) => state.createNode)
  const addGameOverPack = useProjectStore((state) => state.addGameOverPack)
  const selectNode = useProjectStore((state) => state.selectNode)
  const focusNode = useProjectStore((state) => state.focusNode)
  const reorderNode = useProjectStore((state) => state.reorderNode)
  const viewportCenter = useViewportCenter()
  // Sistema de guiaje: qué diapositiva está seleccionada ahora mismo, para
  // iluminarla en la lista (mismo criterio que el lienzo, que ya resalta la
  // tarjeta seleccionada con `.selected` de `@xyflow/react`).
  const selectedNodeIds = useSelectedNodeIds()

  const [searchQuery, setSearchQuery] = useState('')
  const normalizedQuery = searchQuery.trim().toLowerCase()
  // Reordenar (arrastrar-y-soltar, ver más abajo; `reorderNode` en
  // `src/domain/nodeOrder.ts`) opera sobre el índice REAL dentro de
  // `project.graph.nodes`, mientras que con un buscador activo
  // `visibleNodes` es un SUBCONJUNTO filtrado: soltar dentro de esa vista
  // parcial sería ambiguo respecto a la posición real en el array completo
  // (¿un puesto en la lista filtrada, o hasta el hueco entre los dos nodos
  // ocultos más cercanos?). Se opta por deshabilitar el arrastre mientras el
  // buscador tiene texto, en vez de intentar resolver esa ambigüedad — se
  // reactiva en cuanto se borra la búsqueda, momento en el que
  // `visibleNodes` vuelve a ser exactamente `project.graph.nodes` y el
  // índice de la lista vuelve a coincidir con el índice real.
  const isSearching = normalizedQuery !== ''

  // Filtra la lista ya existente; no toca `focusNode`/selección, así que
  // hacer clic en un resultado filtrado centra el lienzo exactamente igual
  // que ya hacía antes de este buscador. Declarada aquí (antes del bloque de
  // arrastre de más abajo) a propósito: `findDropTargetAt` la referencia, y
  // dejarla declarada DESPUÉS (aunque JavaScript lo permitiría igual, por el
  // "hoisting" de `function findDropTargetAt` — no se invoca hasta un evento
  // posterior al renderizado, cuando `visibleNodes` ya está asignada) hacía
  // que el analizador estático de oxlint (`react/preserve-manual-memoization`,
  // el aviso del React Compiler) no pudiera demostrar que esta memoización
  // se preserva.
  const visibleNodes = useMemo(() => {
    if (!normalizedQuery) {
      return project.graph.nodes
    }
    return project.graph.nodes.filter((node) => nodeMatchesQuery(node, normalizedQuery))
  }, [project.graph.nodes, normalizedQuery])

  // Arrastrar-y-soltar para mover una diapositiva a cualquier posición de la
  // lista, de un solo gesto — Pointer Events (`onPointerDown`/`onPointerMove`/
  // `onPointerUp`), NO el arrastre nativo de HTML5 (`draggable`/`ondrag*`).
  //
  // Motivo del cambio (no es una preferencia de estilo, es una corrección de
  // un bug real reportado en la app empaquetada): la primera versión de este
  // mecanismo usaba arrastre nativo de HTML5 y se verificó únicamente
  // simulando `DragEvent` en un navegador de escritorio normal (Chromium) —
  // ahí funcionaba. En la app de escritorio de verdad (Tauri, que en macOS
  // usa `WKWebView`, el motor de Safari, embebido como control nativo — NO
  // el Chromium de un navegador de escritorio) el arrastre no hacía nada en
  // absoluto. Esto es un problema documentado del arrastre nativo de HTML5
  // dentro de un webview EMBEBIDO: WebKit necesita que el elemento
  // arrastrable tenga la propiedad NO estándar `-webkit-user-drag: element`
  // para que `draggable="true"` inicie siquiera una sesión de arrastre en
  // WebKit/Safari (ver la documentación de la propiedad `-webkit-user-drag`
  // en el repositorio de WebKit — la propia existencia de esa propiedad NO
  // estándar, exclusiva de WebKit, para "activar" lo que en Chromium/Firefox
  // funciona sin más, confirma que el soporte de partida de `draggable` es
  // distinto/parcial en WebKit), y aun con ese ajuste el comportamiento
  // dentro de un `WKWebView` embebido (sin la integración nativa adicional a
  // nivel de app que sí tiene Safari como aplicación) es conocido por ser
  // inconsistente entre versiones de macOS. En vez de perseguir ese ajuste
  // (que seguiría dejando el mecanismo dependiente de una propiedad CSS NO
  // estándar, exclusiva de un motor, exactamente lo que se quiere evitar) se
  // sustituye el mecanismo entero por Pointer Events: una API de bajo nivel
  // (captura/mueve/suelta el propio puntero) que NO depende de que el motor
  // implemente una sesión de arrastre "nativa" del sistema operativo, y que
  // los tres motores relevantes (Chromium, WebKit y el motor de WebView2)
  // implementan de forma uniforme como parte del mismo estándar del W3C
  // (`PointerEvent`, `Element.setPointerCapture`/`releasePointerCapture`) —
  // sin necesitar ningún prefijo ni ajuste específico de motor. App de
  // escritorio (Tauri), no hace falta soporte táctil, pero Pointer Events lo
  // cubriría igualmente si hiciera falta en el futuro (unifica ratón/lápiz/
  // táctil bajo la misma API, cosa que el arrastre nativo de HTML5 nunca ha
  // hecho: por eso siempre ha sido "solo ratón" en la práctica). Mismo
  // criterio de índice REAL dentro de `project.graph.nodes`, deshabilitado
  // mientras el buscador tiene texto — ver `isSearching` arriba. El arrastre
  // sigue siendo el único mecanismo de reordenar (no hay botones ↑/↓).
  //
  // `draggedNodeId`: id del nodo que se está arrastrando ahora mismo (o
  // `null` si no hay ningún arrastre en curso). `dropTarget`: sobre qué fila
  // (por índice real) está el puntero y en qué mitad (`before`/`after`),
  // recalculado en cada `pointermove` una vez superado el umbral de arrastre,
  // para pintar la pista visual (línea de inserción) y para calcular el
  // índice final al soltar.
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ index: number; position: 'before' | 'after' } | null>(
    null,
  )

  // Umbral de movimiento (en píxeles) antes de considerar un gesto un
  // arrastre de verdad: sin esto, un simple clic (pointerdown+pointerup en
  // el mismo sitio, sin apenas moverse entre medias — nunca es *exactamente*
  // 0px de movimiento en el mundo real) se interpretaría como un
  // micro-arrastre y el clic normal de la fila (`focusNode`, ver el botón
  // más abajo) dejaría de funcionar.
  const DRAG_ACTIVATION_THRESHOLD_PX = 5

  // Estado del gesto en curso, en un `ref` (no en `useState`): se lee y
  // escribe desde dentro de los propios manejadores de `pointermove`/
  // `pointerup`, en cada evento, y no debe disparar un re-render por sí
  // mismo — el re-render ya lo provocan `setDraggedNodeId`/`setDropTarget`
  // cuando de verdad hace falta pintar algo distinto.
  type PointerDragState = {
    pointerId: number
    nodeId: string
    startX: number
    startY: number
    /** `false` mientras no se ha superado `DRAG_ACTIVATION_THRESHOLD_PX`
     *  (el gesto podría acabar siendo un simple clic); `true` en cuanto se
     *  confirma que es un arrastre de verdad. */
    active: boolean
  }
  const pointerDragRef = useRef<PointerDragState | null>(null)

  // Referencia a cada `<li>` de la lista, indexada por id de nodo: hace
  // falta para el "hit test" manual de `findDropTargetAt` de más abajo (con
  // qué fila coincide la coordenada Y del puntero) — con el arrastre nativo
  // de HTML5 este cálculo lo hacía el propio navegador (`event.currentTarget`
  // en `dragover` ya era la fila correcta, por el "hit testing" nativo del
  // sistema); con Pointer Events, una vez el puntero está "capturado"
  // (`setPointerCapture`, ver `handlePointerMove`) todos los eventos
  // posteriores se entregan al elemento que capturó el puntero SIN importar
  // dónde esté físicamente el cursor — así que hay que averiguar "a mano"
  // sobre qué fila está el puntero ahora mismo, comparando su coordenada Y
  // contra el rectángulo real de cada fila.
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map())

  // Evita que el `onClick` normal del botón de la fila (`focusNode`, ver
  // JSX) se dispare justo después de soltar un arrastre de verdad: es un
  // cinturón-y-tirantes deliberado, no una necesidad estricta — el propio
  // estándar de Pointer Events ya dice que, mientras el puntero está
  // "capturado" (ver `setPointerCapture` en `handlePointerMove`), los
  // eventos de ratón "de compatibilidad" que un motor sintetice a partir de
  // los eventos de puntero (incluido `click`) deberían entregarse al
  // elemento que tiene la captura (la propia fila `<li>`), no al botón
  // interior, así que un `click` sintetizado tras un arrastre real no
  // debería ni llegar a `onClick` del botón por simple "bubbling" — pero
  // como ese matiz de re-targeting es un detalle más fino del estándar (y no
  // el corazón de la API, que es lo que de verdad importa mantener uniforme
  // entre motores), se refuerza aquí con un `ref` propio que NO depende de
  // ese comportamiento y decide por sí solo, sin ambigüedad, si el próximo
  // `click` de esta fila debe ignorarse.
  const suppressClickRef = useRef(false)

  /** Busca sobre qué fila de `visibleNodes` cae la coordenada Y (de
   *  viewport) dada, y en qué mitad — mismo cálculo de mitad
   *  (`clientY - rect.top < rect.height / 2`) que usaba `handleDragOver` con
   *  el arrastre nativo, adaptado a un "hit test" manual sobre TODAS las
   *  filas (ver comentario de `rowRefs` arriba) en vez de fiarse de qué
   *  elemento disparó el evento. Si el puntero está por encima de la
   *  primera fila o por debajo de la última (p.ej. arrastrando fuera de los
   *  límites de la lista), se resuelve al hueco más cercano (antes de la
   *  primera / después de la última) en vez de no encontrar destino
   *  ninguno — mismo espíritu tolerante que `reorderNode` recortando
   *  `toIndex` fuera de rango. */
  function findDropTargetAt(clientY: number): { index: number; position: 'before' | 'after' } | null {
    if (visibleNodes.length === 0) return null
    // El Inicio es fijo (siempre `visibleNodes[0]` cuando existe, ver
    // `createNode`/`ensureIntroNode`): ningún nodo puede soltarse POR
    // DELANTE de él, así que un `{ index: 0, position: 'before' }` (el
    // único hueco que lo desplazaría de la primera posición) se convierte
    // aquí mismo en `{ index: 0, position: 'after' }` — "justo después del
    // Inicio", el primer hueco realmente disponible. El propio Inicio nunca
    // llega a ser `drag.nodeId` (ver `handlePointerDown`), así que esta
    // guarda solo afecta a soltar OTRO nodo por delante suyo.
    const introIsFirst = visibleNodes[0]?.type === 'intro'
    // Estilo funcional (`map`/`findIndex`/`find`) a propósito, en vez de un
    // `for` imperativo con una variable mutable: mismo resultado, pero deja
    // el cálculo como una cadena de expresiones sin reasignaciones, más
    // fácil de razonar (y de verificar de forma estática) que un bucle con
    // `break`/reasignación temprana.
    const rects = visibleNodes.map((node) => rowRefs.current.get(node.id)?.getBoundingClientRect() ?? null)
    const hitIndex = rects.findIndex(
      (rect) => rect !== null && clientY >= rect.top && clientY < rect.bottom,
    )
    const hitRect = hitIndex !== -1 ? rects[hitIndex] : undefined
    if (hitIndex !== -1 && hitRect) {
      const position: 'before' | 'after' = clientY - hitRect.top < hitRect.height / 2 ? 'before' : 'after'
      if (hitIndex === 0 && position === 'before' && introIsFirst) {
        return { index: 0, position: 'after' }
      }
      return { index: hitIndex, position }
    }
    const firstRect = rects.find((rect) => rect !== null) ?? null
    if (firstRect !== null && clientY < firstRect.top) {
      return introIsFirst ? { index: 0, position: 'after' } : { index: 0, position: 'before' }
    }
    return { index: visibleNodes.length - 1, position: 'after' }
  }

  /** Deja el estado de arrastre (visual e interno) como si no hubiera ningún
   *  gesto en curso — usado tanto al soltar como al cancelarse el gesto
   *  (búsqueda activada a media faena, `pointercancel`...). */
  function resetPointerDrag() {
    pointerDragRef.current = null
    setDraggedNodeId(null)
    setDropTarget(null)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLLIElement>, nodeId: string) {
    // `button !== 0`: ignora clic derecho/central (solo el botón principal
    // inicia un arrastre). `!isPrimary`: ignora punteros "secundarios" de un
    // gesto multi-táctil — no se usa en esta app de escritorio, pero es una
    // comprobación estándar y gratuita. El Inicio es fijo (siempre primero
    // en la lista, ver `createNode`/`ensureIntroNode`): nunca arranca un
    // arrastre desde su fila, así que ni siquiera puede intentar moverse —
    // mismo criterio que `isSearching`, ambos casos simplemente no inician
    // el gesto.
    const draggedNode = project.graph.nodes.find((candidate) => candidate.id === nodeId)
    if (isSearching || event.button !== 0 || !event.isPrimary || draggedNode?.type === 'intro') return
    pointerDragRef.current = {
      pointerId: event.pointerId,
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    }
    suppressClickRef.current = false
    // Deliberadamente NO se llama a `setPointerCapture` aquí todavía (ver
    // `handlePointerMove`): mientras el gesto no supere el umbral de
    // arrastre, no se toca nada del comportamiento normal de la fila, para
    // que un simple clic (sin `setPointerCapture` de por medio) le llegue al
    // botón interior exactamente igual que si este código no existiera.
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLLIElement>) {
    const drag = pointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (isSearching) {
      // Búsqueda activada a media faena (edge case improbable, pero
      // barato de cubrir): cancela el arrastre sin reordenar nada.
      if (drag.active) {
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }
      resetPointerDrag()
      return
    }
    if (!drag.active) {
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (Math.hypot(dx, dy) < DRAG_ACTIVATION_THRESHOLD_PX) {
        return
      }
      drag.active = true
      setDraggedNodeId(drag.nodeId)
      // Umbral superado: A PARTIR DE AHORA sí se captura el puntero sobre la
      // fila que está recibiendo este `pointermove` (en la inmensa mayoría
      // de los casos, la misma fila donde empezó el gesto — el umbral es de
      // pocos píxeles, mucho menor que el alto de una fila, así que el
      // puntero prácticamente no ha podido salir de ella todavía). A partir
      // de aquí, TODOS los `pointermove`/`pointerup` posteriores se siguen
      // entregando a esta fila pase lo que pase — aunque el cursor salga por
      // completo de la lista, o incluso de la ventana — que es precisamente
      // la garantía que le faltaba al arrastre nativo de HTML5 dentro de un
      // webview embebido.
      //
      // Opcional (`?.`) porque jsdom (entorno de test) no implementa
      // `setPointerCapture`/`releasePointerCapture` en absoluto (solo la
      // clase `PointerEvent`, no estos métodos de `Element`) — los tests de
      // este archivo controlan a mano sobre qué elemento se despacha cada
      // evento, así que la captura real no hace falta para verificar la
      // lógica de reordenar. `?.` es además, con o sin tests, una guarda
      // barata contra cualquier entorno que por lo que sea no implemente
      // estos métodos estándar.
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
    // Imprescindible con el puntero ya capturado: evita que el motor
    // interprete el arrastre como una selección de texto o (en un futuro
    // con soporte táctil) como un scroll de la lista.
    event.preventDefault()
    setDropTarget(findDropTargetAt(event.clientY))
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLLIElement>) {
    const drag = pointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (drag.active) {
      event.preventDefault()
      suppressClickRef.current = true
      if (!isSearching && dropTarget !== null) {
        const fromIndex = project.graph.nodes.findIndex((node) => node.id === drag.nodeId)
        if (fromIndex !== -1) {
          // `dropTarget.index` es la posición (ORIGINAL, antes de quitar el
          // nodo arrastrado) de la fila sobre la que se soltó; `desired` es
          // el hueco de inserción pedido en esa misma indexación (justo
          // antes, o justo después, de esa fila). `reorderNode` (ver
          // `src/domain/nodeOrder.ts`) espera el índice FINAL ya con el nodo
          // arrastrado fuera del array, así que si el hueco pedido cae
          // después del propio `fromIndex` hay que restar uno (quitar el
          // nodo arrastrado desplaza todo lo que iba después un puesto
          // hacia atrás).
          const desired = dropTarget.index + (dropTarget.position === 'after' ? 1 : 0)
          const toIndex = desired > fromIndex ? desired - 1 : desired
          reorderNode(drag.nodeId, toIndex)
        }
      }
    }
    resetPointerDrag()
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLLIElement>) {
    const drag = pointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    resetPointerDrag()
  }

  // Botón "+ Inicio" (Tarea 1, milestone "Diapositiva de Inicio"): existe
  // siempre por consistencia visual con los otros dos botones y como red de
  // seguridad para un documento que, por lo que sea, no tuviera todavía su
  // portada (`createProject` de bajo nivel no la siembra; las plantillas de
  // `HomeScreen` sí, así que en la práctica este botón casi siempre estará
  // deshabilitado) — pero se deshabilita en cuanto el proyecto YA tiene un
  // nodo `intro`, que el propio dominio (`createNode`) rechazaría crear dos
  // veces de todos modos.
  const hasIntro = project.graph.nodes.some((node) => node.type === 'intro')

  function handleCreate(type: NodeType) {
    // Tarea 4: la diapositiva nueva nace centrada en la parte visible del
    // lienzo (`ui.viewportCenter`, publicado por `Canvas`), en vez de en una
    // posición fija o en cascada — con la cascada como respaldo si ese
    // centro todavía no se ha calculado (ver `nextCascadePosition`).
    const position = viewportCenter ?? nextCascadePosition(project.graph.nodes.length)
    createNode(type, position)

    // `createNode` no devuelve el nodo creado, así que hay que localizarlo
    // después. El Inicio es un caso especial: SIEMPRE se crea con
    // `number: 1` (desplazando +1 al resto de nodos existentes, ver
    // `shiftNodeNumbersForNewIntro` en `domain/id.ts`), así que NO es el de
    // mayor número tras crearlo — y como solo puede existir un `intro` por
    // proyecto, basta con buscarlo por tipo. Para `slide`/`final` sí es
    // válido el atajo de "mayor número", porque esos números son
    // estrictamente crecientes y nunca se reciclan.
    const nodes = useProjectStore.getState().project.graph.nodes
    const created =
      type === 'intro'
        ? nodes.find((node) => node.type === 'intro')
        : nodes.reduce((max, node) => (node.number > max.number ? node : max))
    if (created) selectNode(created.id)
  }

  /**
   * Botón "+1 fallo con Game Over" (milestone del mismo nombre): añade el
   * paquete de 2 diapositivas ya cableadas (`addGameOverPack`,
   * `src/domain/nodePacks.ts`) y selecciona la PRIMERA (la "en blanco", que
   * el diseñador tiene que rellenar) — mismo criterio de "identificar el
   * nodo nuevo por id, nunca por número más alto" que `handleCreate`, pero
   * comparando el conjunto de nodos ANTES/DESPUÉS porque aquí se crean DOS
   * nodos de golpe, no uno.
   */
  function handleCreateGameOverPack() {
    const position = viewportCenter ?? nextCascadePosition(project.graph.nodes.length)
    const existingIds = new Set(project.graph.nodes.map((node) => node.id))
    addGameOverPack(position)

    const nodes = useProjectStore.getState().project.graph.nodes
    const newNodes = nodes.filter((node) => !existingIds.has(node.id))
    // La primera diapositiva del paquete es la que nace en `position` (la
    // de "Game Over" nace desplazada a su derecha, ver `addGameOverPack`).
    const firstSlide = newNodes.find(
      (node) => node.position.x === position.x && node.position.y === position.y,
    )
    if (firstSlide) selectNode(firstSlide.id)
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.addSection}>
        <button
          type="button"
          className={styles.addButton}
          onClick={() => handleCreate('intro')}
          disabled={hasIntro}
          title={hasIntro ? 'Ya existe la diapositiva de Inicio' : undefined}
        >
          + {NODE_TYPE_LABEL.intro}
        </button>
        {CREATABLE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={styles.addButton}
            onClick={() => handleCreate(type)}
          >
            + {NODE_TYPE_LABEL[type]}
          </button>
        ))}
        {/* "+1 fallo con Game Over": paquete de 2 diapositivas ya cableadas
            y con su contenido predefinido — ver `handleCreateGameOverPack`/
            `addGameOverPack` en `src/domain/nodePacks.ts`. Sin límite de
            cantidad (a diferencia de "+ Inicio"): se puede usar tantas
            veces como haga falta en un mismo proyecto. */}
        <button type="button" className={styles.addButton} onClick={handleCreateGameOverPack}>
          +1 fallo con Game Over
        </button>
      </div>

      <div className={styles.searchSection}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Buscar en el proyecto…"
          aria-label="Buscar en el proyecto"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>

      <ul className={styles.nodeList}>
        {visibleNodes.map((node, index) => (
          <li
            key={node.id}
            ref={(element) => {
              if (element) {
                rowRefs.current.set(node.id, element)
              } else {
                rowRefs.current.delete(node.id)
              }
            }}
            className={[
              styles.nodeRow,
              draggedNodeId === node.id && styles.nodeRowDragging,
              dropTarget?.index === index && dropTarget.position === 'before' && styles.nodeRowDropBefore,
              dropTarget?.index === index && dropTarget.position === 'after' && styles.nodeRowDropAfter,
            ]
              .filter(Boolean)
              .join(' ')}
            data-draggable={isSearching || node.type === 'intro' ? 'false' : 'true'}
            onPointerDown={(event) => handlePointerDown(event, node.id)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          >
            {/* `focusNode` selecciona el nodo (igual que `selectNode`) y
                además pide al lienzo que centre la vista en él, sin que
                este componente conozca `@xyflow/react` — ver
                `ui.focusRequestNodeId` en `src/store`. Reutilizado tal cual
                sobre la lista ya filtrada por el buscador. */}
            <button
              type="button"
              className={
                selectedNodeIds.includes(node.id)
                  ? `${styles.nodeItem} ${styles.nodeItemSelected}`
                  : styles.nodeItem
              }
              aria-current={selectedNodeIds.includes(node.id) ? 'true' : undefined}
              onClick={() => {
                // Ver `suppressClickRef` más arriba: un arrastre de verdad
                // que acaba de soltarse no debe además "seleccionar" la fila
                // como si hubiera sido un simple clic.
                if (suppressClickRef.current) {
                  suppressClickRef.current = false
                  return
                }
                focusNode(node.id)
              }}
            >
              {/* Tarea "Numeración corta": código "D{número}" en vez de la
                  antigua etiqueta traducida de tipo — misma función
                  compartida que usa `Header` en `nodeTypes.tsx`, no
                  duplicada aquí. */}
              <span className={styles.nodeType}>{shortNodeLabel(node)}</span>
              {/* Marca discreta del punto de partida del recorrido. Mismo
                  criterio (y misma etiqueta) que en la tarjeta del lienzo:
                  el inicio ya no es siempre un nodo aparte (documentos sin
                  `intro` todavía), así que hay que poder distinguirlo de un
                  vistazo entre las demás diapositivas. Se omite para un nodo
                  `intro` (siempre es `startNodeId` cuando existe, ver
                  `IntroNodeSchema`): ya se distingue de un vistazo por su
                  propio fondo/contorno en el lienzo, y repetir "Inicio" aquí
                  sería redundante — mismo criterio que `Header` en
                  `nodeTypes.tsx`. */}
              {node.id === project.graph.startNodeId && node.type !== 'intro' && (
                <span className={styles.nodeStartMark} title="Diapositiva de inicio">
                  {START_NODE_LABEL}
                </span>
              )}
              {/* "Referencia" es la etiqueta de UI del campo `title` de
                  dominio (ver el `<label>` del Inspector) — el nombre del
                  campo no cambia, solo el texto que ve el usuario. Petición
                  de usuario "el Final como el Inicio": ni `intro` ni
                  `final` editan ya `title` desde el Inspector (ver
                  `referenceField` en `NodeFields`, `Inspector.tsx`), así
                  que mostrar "Sin ref. oculta" para ellos sería el mismo
                  hueco vacío de siempre sin ninguna información real —
                  `.nodeType` (arriba, "INICIO"/"FINAL") ya los identifica
                  del todo, se omite esta segunda etiqueta entera. */}
              {node.type === 'slide' && (
                <span className={styles.nodeTitle}>{node.title.trim() || 'Sin ref. oculta'}</span>
              )}
            </button>
          </li>
        ))}
        {normalizedQuery && visibleNodes.length === 0 && (
          <li className={styles.noResults}>Sin resultados para "{searchQuery.trim()}"</li>
        )}
      </ul>
    </aside>
  )
}
