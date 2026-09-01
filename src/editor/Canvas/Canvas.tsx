import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  ReactFlow,
} from '@xyflow/react'
import type {
  Connection,
  FinalConnectionState,
  NodeMouseHandler,
  OnBeforeDelete,
  OnSelectionChangeFunc,
  ReactFlowInstance,
  Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  useContextMenu,
  useFocusRequestNodeId,
  useProject,
  useProjectStore,
  useSelectedNodeIds,
} from '../../store'
import type { NodeType } from '../../domain'
import type { CanvasFlowEdge, CanvasFlowNode } from './adapter'
import { resolveConnection, toFlowEdges, toFlowNodes } from './adapter'
import { resolveEmptyPaneDrop } from './handles'
import { computeAutoLayout } from './layout/autoLayout'
import { nodeTypes } from './nodes/nodeTypes'
import { edgeTypes } from './edges/edgeTypes'
import { ConnectionMenu } from './ConnectionMenu'
import { useCanvasClipboard } from './useCanvasClipboard'
import styles from './Canvas.module.css'

/** Etiqueta accesible del botón de auto-layout, reutilizada como `title`
 *  (tooltip) y `aria-label` del control — ver `handleAutoLayout` más abajo. */
const AUTO_LAYOUT_LABEL = 'Ordenar automáticamente'

/**
 * Icono del botón de auto-layout: un nodo origen a la izquierda con dos
 * ramas hacia dos nodos destino a la derecha, evocando "reorganizar según
 * las conexiones" sin depender de ningún set de iconos externo (mismo
 * criterio que los iconos ya incluidos en `@xyflow/react`, ver
 * `ControlButton`/`FitViewIcon` de la propia librería).
 */
function AutoLayoutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" />
      <rect x="17" y="1" width="6" height="6" rx="1" fill="currentColor" />
      <rect x="17" y="17" width="6" height="6" rx="1" fill="currentColor" />
      <path
        d="M7 12h3l4-7h3M10 12h4l3 7h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}

/**
 * Extrae la posición de pantalla (viewport) de un evento de fin de gesto de
 * conexión, tanto de ratón como táctil. Función de módulo (no un closure
 * dentro del componente) para poder invocarla en aislado si hiciera falta, y
 * porque no depende de ningún estado del componente.
 */
function pointFromConnectEndEvent(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ('changedTouches' in event) {
    const touch = event.changedTouches[0]
    return touch ? { x: touch.clientX, y: touch.clientY } : null
  }
  return { x: event.clientX, y: event.clientY }
}

/**
 * Tamaño asumido de un nodo cuando `@xyflow/react` todavía no lo ha medido
 * (p.ej. un `focusNode` disparado en el mismo tick que el montaje inicial).
 * Solo afecta al cálculo de centrado; no a layout ni a datos de dominio.
 */
const FALLBACK_NODE_WIDTH = 180
const FALLBACK_NODE_HEIGHT = 60

/**
 * Ventana de confirmación del borrado con Supr/Backspace (ver
 * `handleBeforeDelete` más abajo): una segunda pulsación sobre exactamente
 * el mismo conjunto de nodos, dentro de este plazo, confirma el borrado.
 * Pasado este tiempo sin una segunda pulsación, la confirmación caduca sola
 * y hay que empezar de nuevo. 3s: suficiente para que no se sienta como una
 * doble pulsación accidental, pero corto para no dejar el aviso colgado
 * mucho rato si el usuario se distrae.
 */
const DELETE_CONFIRM_WINDOW_MS = 3000

/**
 * Lienzo real del editor, sobre `@xyflow/react`.
 *
 * Invariante de esta fase: `@xyflow/react` NUNCA es una segunda fuente de
 * verdad. `nodes`/`edges` se recalculan en cada render a partir de
 * `project` (vía el adaptador `toFlowNodes`/`toFlowEdges`, que a su vez usa
 * `deriveEdges` de dominio) y de la selección transitoria del store — no se
 * usan `useNodesState`/`useEdgesState` de la librería, que crearían un
 * estado paralelo. Ver comentarios puntuales en cada handler para el
 * patrón concreto (posición durante el arrastre, selección, conexión,
 * viewport).
 */
export function Canvas() {
  const project = useProject()
  const selectedNodeIds = useSelectedNodeIds()
  const focusRequestNodeId = useFocusRequestNodeId()
  const contextMenu = useContextMenu()

  const connect = useProjectStore((state) => state.connect)
  const deleteNode = useProjectStore((state) => state.deleteNode)
  const setSelection = useProjectStore((state) => state.setSelection)
  const selectNode = useProjectStore((state) => state.selectNode)
  const clearSelection = useProjectStore((state) => state.clearSelection)
  const setViewport = useProjectStore((state) => state.setViewport)
  const beginNodeDrag = useProjectStore((state) => state.beginNodeDrag)
  const updateNodeDragPosition = useProjectStore((state) => state.updateNodeDragPosition)
  const endNodeDrag = useProjectStore((state) => state.endNodeDrag)
  const clearFocusRequest = useProjectStore((state) => state.clearFocusRequest)
  const openContextMenu = useProjectStore((state) => state.openContextMenu)
  const closeContextMenu = useProjectStore((state) => state.closeContextMenu)
  const createConnectedNodeFromMenu = useProjectStore((state) => state.createConnectedNodeFromMenu)
  const applyLayout = useProjectStore((state) => state.applyLayout)
  const setViewportCenter = useProjectStore((state) => state.setViewportCenter)

  // Ctrl/Cmd+C / Ctrl/Cmd+V para duplicar diapositivas (Tarea 1). Montado
  // aquí porque este componente ya conoce la selección actual; ver
  // `useCanvasClipboard` para el detalle de por qué no interfiere con el
  // copiar/pegar de texto normal del navegador dentro de un campo editable.
  useCanvasClipboard()

  const nodes = toFlowNodes(project, selectedNodeIds)
  const edges = toFlowEdges(project, selectedNodeIds)

  // Petición de usuario: "cuando se inicie un proyecto, los nodos
  // aparezcan en la parte central de la pantalla, no arriba a la
  // izquierda". `createProject` (`src/domain/project.ts`) siembra
  // `editor.viewport` siempre con este mismo valor exacto — nunca lo pone
  // ningún otro camino del dominio — y es también el único sitio que lo
  // pisa después `handleMoveEnd` (más abajo): solo se persiste al TERMINAR
  // un gesto de pan/zoom real, nunca antes (ver su comentario). Que el
  // viewport guardado siga siendo EXACTAMENTE `{x:0, y:0, zoom:1}` es, por
  // tanto, una señal fiable de "nadie ha tocado nunca la vista de este
  // proyecto" — se usa en `handleInit`, más abajo, para pedir un `fitView`
  // en vez de aceptar ese valor tal cual como `defaultViewport` (que deja
  // cualquier nodo situado cerca del origen, como el Inicio o D1, pegado a
  // la esquina superior izquierda — el bug reportado). Una vez el usuario
  // haga cualquier pan/zoom, `project.editor.viewport` deja de ser este
  // sentinela y las siguientes aperturas respetan su vista guardada de
  // siempre.
  const isFreshViewport =
    project.editor.viewport.x === 0 &&
    project.editor.viewport.y === 0 &&
    project.editor.viewport.zoom === 1

  // Instancia de React Flow, capturada vía `onInit` (evita necesitar un
  // `<ReactFlowProvider>` + `useReactFlow()` solo para esto). Vive en un
  // ref, no en estado: no debe disparar un re-render propio.
  const instanceRef = useRef<ReactFlowInstance<CanvasFlowNode, CanvasFlowEdge> | null>(null)

  // Contenedor del lienzo: su `getBoundingClientRect` es lo único que hace
  // falta (además de la instancia) para saber dónde está, en coordenadas de
  // pantalla, el centro de la parte VISIBLE del lienzo (tarea 4). Un `ref`,
  // no estado: solo se lee en el momento de recalcular el centro.
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // -- Centro visible del lienzo (tarea 4): se recalcula al iniciar la
  // instancia y cada vez que termina un gesto de pan/zoom (`onMoveEnd`), y
  // se publica al store (`ui.viewportCenter`) para que `LeftPanel` pueda
  // crear un nodo nuevo justo ahí sin conocer `@xyflow/react`. Si el
  // contenedor todavía no tiene tamaño real (rect 0×0 — no debería pasar en
  // la app real, pero es un estado transitorio válido en tests que no
  // montan layout) no se publica nada: mejor dejar el valor anterior (o
  // `null`) que uno claramente incorrecto.
  const updateViewportCenter = useCallback(() => {
    const instance = instanceRef.current
    const wrapper = wrapperRef.current
    // `typeof instance.screenToFlowPosition === 'function'` en vez de solo
    // `!instance`: varios tests de este fichero (`Canvas.wiring.test.tsx`)
    // inyectan vía `onInit` una instancia "de pega" que solo implementa los
    // métodos que ese test concreto necesita (p.ej. solo `setCenter`/
    // `getZoom`/`getNode` para probar `focusNode`, o solo
    // `screenToFlowPosition` para probar el menú contextual) — no un mock
    // completo de `ReactFlowInstance`. Sin esta guarda, calcular el centro
    // visible en cualquier `onInit`/`onMoveEnd` lanzaría en esos tests por
    // llamar a un método que su instancia de pega no implementa.
    if (!instance || typeof instance.screenToFlowPosition !== 'function' || !wrapper) return
    const rect = wrapper.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const center = instance.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    })
    setViewportCenter(center)
  }, [setViewportCenter])

  const handleInit = useCallback(
    (instance: ReactFlowInstance<CanvasFlowNode, CanvasFlowEdge>) => {
      instanceRef.current = instance
      updateViewportCenter()
      if (isFreshViewport) {
        // Deliberadamente NO la prop declarativa `<ReactFlow fitView>`:
        // React Flow decide si un nodo "cuenta" para el encuadre mirando
        // `node.measured.width/height` (`getFitViewNodes` en
        // `@xyflow/system`), que NO están rellenos todavía en este primer
        // instante de `onInit` — solo lo estarán tras el primer aviso del
        // `ResizeObserver` interno, asíncrono. Con la prop declarativa el
        // encuadre se calculaba sobre "cero nodos visibles", resultando en
        // un zoom absurdo (comprobado en el navegador: `scale(0.1)` con
        // todos los nodos amontonados en una esquina). Un doble
        // `requestAnimationFrame` (patrón ya usado en la app para "esperar
        // al siguiente pintado tras un cambio de layout", ver
        // `RichTextEditor.test.tsx`) da tiempo de sobra a que esa primera
        // medición real llegue antes de invocar el método imperativo
        // `fitView()`, que si lee `measured` correctamente.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // `typeof ... === 'function'` (no solo `instanceRef.current?.`):
            // mismo motivo que la guarda análoga de `updateViewportCenter`
            // más arriba — varias suites de test (`Canvas.wiring.test.tsx`)
            // inyectan vía `onInit` una instancia "de pega" que no
            // implementa `fitView`, y este `requestAnimationFrame` doble
            // puede llegar a disparase DESPUÉS de que el test ya haya
            // corrido sus aserciones (o incluso desmontado el componente).
            if (typeof instanceRef.current?.fitView === 'function') {
              instanceRef.current.fitView({ duration: 0 })
            }
          })
        })
      }
    },
    [updateViewportCenter, isFreshViewport],
  )

  // -- Arrastre de nodos: una única entrada de historial (ver store) -----
  // El array `nodes` se recalcula cada render a partir de `project`, que
  // las acciones de store ya actualizan en caliente durante el arrastre
  // (`updateNodeDragPosition` muta la posición fuera del historial); por
  // eso no hace falta `onNodesChange` para reflejar la posición mientras se
  // arrastra.
  //
  // El TERCER argumento de estos callbacks (`nodes`, no el `node` bajo el
  // puntero) es el array de TODOS los nodos que participan del gesto —
  // `@xyflow/react` ya incluye ahí a cualquier nodo seleccionado que se
  // arrastre junto al que se pulsó. Usarlo (en vez del segundo argumento)
  // es lo que permite que arrastrar varios nodos seleccionados a la vez
  // conserve la posición de todos ellos, no solo la del "principal".
  const handleNodeDragStart = useCallback(
    (_event: unknown, _node: CanvasFlowNode, nodes: CanvasFlowNode[]) => {
      beginNodeDrag(nodes.map((n) => n.id))
    },
    [beginNodeDrag],
  )

  const handleNodeDrag = useCallback(
    (_event: unknown, _node: CanvasFlowNode, nodes: CanvasFlowNode[]) => {
      updateNodeDragPosition(nodes.map((n) => ({ nodeId: n.id, position: n.position })))
    },
    [updateNodeDragPosition],
  )

  const handleNodeDragStop = useCallback(() => {
    endNodeDrag()
  }, [endNodeDrag])

  // -- Borrado de nodos con Supr/Backspace (ver `deleteKeyCode` más abajo).
  // `@xyflow/react` gestiona la tecla y decide qué nodos/aristas son
  // candidatos a borrarse (la selección actual), pero nunca debe mutar el
  // modelo por su cuenta — este componente sigue siendo un lienzo
  // "controlado" sobre `project`. `onBeforeDelete` es el punto de veto: si
  // la diapositiva de inicio (`graph.startNodeId`) está entre los
  // candidatos, se excluye del conjunto (nunca se puede borrar, ver guarda
  // de dominio en `src/domain/project.ts`). Si tras excluirla no queda
  // ningún nodo por borrar, se devuelve `false` para vetar el borrado por
  // completo — así "seleccionar solo la diapositiva de inicio y pulsar Supr"
  // no dispara ningún borrado en vez de un borrado vacío silencioso. Las
  // aristas candidatas se dejan pasar tal cual: esta app no tiene un modelo
  // de aristas propio en `@xyflow/react` (se derivan de `project` en cada
  // render, ver `adapter.ts`), así que aceptarlas aquí no tiene efecto en el
  // dominio.
  //
  // Confirmación por doble pulsación (sin `window.confirm()` ni modal
  // propio, mismo criterio "sin diálogos/overlays propios" que el resto de
  // la app — ver `DeleteNodeButton` en `Inspector.tsx` para el equivalente
  // de dos pasos con clic en vez de tecla): la PRIMERA vez que Supr/
  // Backspace deja candidatos válidos para un conjunto de nodos dado, este
  // handler los veta (`return false`) y arma una confirmación pendiente
  // (`pendingDeleteRef` + `pendingDeleteCount` para el aviso, ver JSX) que
  // caduca sola a los `DELETE_CONFIRM_WINDOW_MS`. Solo una SEGUNDA pulsación
  // sobre EXACTAMENTE el mismo conjunto de nodos (`key`, el join ordenado de
  // sus ids), dentro de esa ventana, deja pasar el borrado de verdad. Cambiar
  // la selección entre pulsaciones cuenta como un conjunto distinto, así que
  // vuelve a pedir una primera confirmación para ese nuevo conjunto.
  const startNodeId = project.graph.startNodeId
  const pendingDeleteRef = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(
    null,
  )
  const [pendingDeleteCount, setPendingDeleteCount] = useState<number | null>(null)

  const cancelPendingDelete = useCallback(() => {
    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timer)
      pendingDeleteRef.current = null
    }
    setPendingDeleteCount(null)
  }, [])

  // Limpia el temporizador pendiente si el lienzo se desmonta a mitad de la
  // ventana de confirmación (p.ej. "Cerrar proyecto"), para no dejar un
  // `setTimeout` huérfano corriendo contra un componente ya desmontado.
  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current.timer)
      }
    }
  }, [])

  const handleBeforeDelete: OnBeforeDelete<CanvasFlowNode, CanvasFlowEdge> = useCallback(
    async ({ nodes: candidateNodes, edges: candidateEdges }) => {
      const allowedNodes = candidateNodes.filter((node) => node.id !== startNodeId)
      if (allowedNodes.length === 0 && candidateNodes.length > 0) {
        return false
      }
      if (allowedNodes.length === 0) {
        // Sin nodos candidatos (solo aristas, o nada) no hay nada que
        // confirmar: se deja pasar tal cual, mismo comportamiento que antes.
        return { nodes: allowedNodes, edges: candidateEdges }
      }

      const key = allowedNodes
        .map((node) => node.id)
        .sort()
        .join('|')
      const pending = pendingDeleteRef.current

      if (pending && pending.key === key) {
        // Segunda pulsación sobre el mismo conjunto: se confirma de verdad.
        clearTimeout(pending.timer)
        pendingDeleteRef.current = null
        setPendingDeleteCount(null)
        return { nodes: allowedNodes, edges: candidateEdges }
      }

      // Primera pulsación (o una selección distinta a la que ya estaba
      // pendiente): se veta este borrado y se arma/renueva la confirmación.
      if (pending) {
        clearTimeout(pending.timer)
      }
      const timer = setTimeout(() => {
        pendingDeleteRef.current = null
        setPendingDeleteCount(null)
      }, DELETE_CONFIRM_WINDOW_MS)
      pendingDeleteRef.current = { key, timer }
      setPendingDeleteCount(allowedNodes.length)
      return false
    },
    [startNodeId],
  )

  // -- Confirmación del borrado: por cada nodo que `onBeforeDelete` dejó
  // pasar, se pide al store que lo borre de verdad (`store.deleteNode`, que
  // delega en el dominio y empuja una única entrada de historial por nodo,
  // ver comentario de diseño en `useProjectStore`). Si `deleteNode` lanzara
  // por algún motivo inesperado (p.ej. una edición concurrente que ya lo
  // hubiera borrado), se ignora ese nodo en vez de romper la UI — mismo
  // criterio que `handleConnect`.
  const handleNodesDelete = useCallback(
    (deletedNodes: CanvasFlowNode[]) => {
      for (const node of deletedNodes) {
        try {
          deleteNode(node.id)
        } catch (error) {
          console.warn('[Canvas] Borrado de nodo ignorado:', error)
        }
      }
    },
    [deleteNode],
  )

  // -- Selección: la gestiona `@xyflow/react` (clic, caja, modificadores);
  // aquí solo se escucha el resultado para sincronizar el store. El campo
  // `selected` que `toFlowNodes` calcula a partir del store cierra el
  // círculo (ver comentario en `adapter.ts`) sin que exista una segunda
  // fuente de verdad: sigue derivándose de `selection` en cada render.
  const handleSelectionChange: OnSelectionChangeFunc<CanvasFlowNode, CanvasFlowEdge> = useCallback(
    ({ nodes: selectedNodes }) => {
      setSelection(selectedNodes.map((node) => node.id))
    },
    [setSelection],
  )

  // Clic directo sobre una diapositiva: BUG reportado por el usuario ("hacen
  // falta dos clics para seleccionar"), reproducido y diagnosticado con
  // precisión leyendo `node_modules/@xyflow/react/dist/esm/index.js`.
  //
  // Causa raíz (no tiene relación con `multiSelectionKeyCode`/`onPaneClick`,
  // ambos descartados tras revisar el código de la librería — ver más abajo):
  // en la arquitectura "totalmente controlada" de este lienzo (sin
  // `defaultNodes` ni `onNodesChange`, ver invariante de cabecera de este
  // fichero), `handleNodeClick` —la función interna de `@xyflow/react` que
  // atiende el clic sobre un nodo— hace, en este orden exacto:
  //   1. `store.setState({ nodesSelectionActive: false })`   (notifica)
  //   2. `addSelectedNodes([id])` → `getSelectionChanges(..., true)`, que
  //      MUTA `nodeLookup` directamente (`item.selected = true`) sin volver
  //      a llamar a `store.setState(...)` — su propio comentario dice
  //      literalmente "the onNodesChange callback comes too late here :/".
  // Como el único `set()` del gesto ocurre ANTES de la mutación, el
  // `SelectionListener` interno (la fuente de nuestro `onSelectionChange`)
  // se entera de un cambio pero lee `nodeLookup` en el instante en que
  // TODAVÍA no refleja el nodo recién clicado — así que el PRIMER clic no
  // notifica nada. La mutación queda "guardada" en `nodeLookup` sin que
  // nadie la vea hasta el SIGUIENTE `set()` que se dispare por cualquier
  // motivo (típicamente: el clic siguiente), momento en el que por fin se
  // propaga — de ahí que haga falta un segundo clic. La selección por caja
  // (Mayús+arrastrar) no sufre esto: su propio gesto sí termina con un
  // `store.setState(...)` POSTERIOR a la mutación (`commitUserSelectionRect`),
  // así que `onSelectionChange` sigue siendo válido y se deja tal cual para
  // ese caso — no se toca nada de la selección por caja.
  //
  // Arreglo: no depender de esa notificación interna (frágil y fuera de
  // nuestro control) para el clic directo. `onNodeClick` SIEMPRE se invoca
  // de forma síncrona en el propio gesto de clic (después de que la
  // librería intente su propia mutación, la vea o no nadie), así que se usa
  // como disparador fiable y se actualiza `selection.selectedNodeIds`
  // directamente aquí — replicando el mismo criterio "clic simple
  // reemplaza, Mayús+clic añade/quita" que ya usa `@xyflow/react`
  // internamente (`event.shiftKey`, coherente con `multiSelectionKeyCode`
  // fijado a `"Shift"` más abajo). `onSelectionChange` se mantiene además
  // para la selección por caja; si en algún gesto ambos acabaran
  // disparándose para el mismo resultado, `setSelection`/`selectNode` son
  // ambos idempotentes con el mismo array, así que no hay riesgo de dejar
  // un estado inconsistente.
  const handleNodeClick: NodeMouseHandler<CanvasFlowNode> = useCallback(
    (event, node) => {
      selectNode(node.id, { additive: event.shiftKey })
    },
    [selectNode],
  )

  // Clic en el fondo del lienzo (ni un nodo ni una arista): quita el
  // resaltado de lo que hubiera seleccionado. No basta con confiar en que
  // `@xyflow/react` dispare `onSelectionChange` por su cuenta al hacer clic
  // fuera —nuestros nodos son "controlados" (`selected` viene siempre de
  // `selection` del store, ver comentario de arriba), así que se pide
  // explícitamente con la acción de dominio, igual que hace cualquier otro
  // punto de esta app que toca la selección.
  const handlePaneClick = useCallback(() => {
    clearSelection()
  }, [clearSelection])

  // -- Conexión nodo→nodo. Si `store.connect` (dominio) lanza porque la
  // combinación es inválida (p.ej. un handle que ya no existe tras una
  // edición concurrente), se ignora en silencio: no debe romper la UI. En
  // la práctica el propio lienzo ya impide la mayoría de combinaciones
  // inválidas (un nodo `final` no tiene handle de salida, así que no se
  // puede arrastrar una conexión desde él).
  const handleConnect = useCallback(
    (params: Connection) => {
      const resolved = resolveConnection(params)
      if (!resolved) return
      try {
        connect(resolved.sourceNodeId, resolved.targetNodeId, resolved.responseId)
      } catch (error) {
        console.warn('[Canvas] Conexión ignorada (combinación inválida):', error)
      }
    },
    [connect],
  )

  // -- Crear nodo arrastrando una conexión hasta el vacío (fase 7). Se
  // dispara siempre que termina un gesto de conexión, válido o no —
  // `resolveEmptyPaneDrop` (puro, testeado por separado) decide si es
  // justo el caso "vino de un handle real y se soltó en el pane vacío". Si
  // lo es, se guarda la posición de PANTALLA (no de lienzo) en
  // `ui.contextMenu`: convertir a coordenadas de lienzo requiere la
  // instancia de React Flow, y es más simple/robusto hacer esa conversión
  // una sola vez, en el momento de confirmar la creación
  // (`handleSelectMenuType`), que guardar ya la posición de lienzo aquí y
  // arriesgarse a que un pan/zoom entre medias la desactualizara (aunque
  // para una interacción tan corta el riesgo real es mínimo).
  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      const target = event.target
      const droppedOnPane = target instanceof Element && target.classList.contains('react-flow__pane')

      const origin = resolveEmptyPaneDrop({
        isValid: connectionState.isValid,
        fromHandle: connectionState.fromHandle,
        droppedOnPane,
      })
      if (!origin) return

      const screenPosition = pointFromConnectEndEvent(event)
      if (!screenPosition) return

      openContextMenu({
        position: screenPosition,
        originNodeId: origin.sourceNodeId,
        originResponseId: origin.sourceResponseId,
      })
    },
    [openContextMenu],
  )

  // -- Confirmar una opción del menú "¿Qué quieres añadir?". Aquí, y solo
  // aquí, se convierte la posición de pantalla guardada en `ui.contextMenu`
  // a coordenadas de lienzo (`screenToFlowPosition`), justo antes de pedirle
  // al store que cree el nodo y lo conecte. Sin instancia de React Flow
  // disponible (no debería ocurrir: si hubo un gesto de conexión, ya está
  // montada) se cierra el menú sin crear nada en vez de arriesgarse a una
  // posición incorrecta.
  const handleSelectMenuType = useCallback(
    (type: NodeType) => {
      if (!contextMenu.position) return
      const instance = instanceRef.current
      if (!instance) {
        closeContextMenu()
        return
      }
      const flowPosition = instance.screenToFlowPosition(contextMenu.position)
      createConnectedNodeFromMenu(type, flowPosition)
    },
    [contextMenu, createConnectedNodeFromMenu, closeContextMenu],
  )

  // -- Auto-layout del lienzo ("Ordenar automáticamente"): calcula el
  // layout jerárquico a partir del `project` actual con la función pura
  // `computeAutoLayout` (basada en `@dagrejs/dagre`) y lo aplica en una
  // única operación de dominio (`store.applyLayout`, una sola entrada de
  // historial deshacible con un solo `Ctrl/Cmd+Z`). Sin diálogo de
  // confirmación: no es una operación destructiva y el undo ya cubre
  // "me equivoqué", mismo criterio que el resto de acciones directas de
  // esta app. Tras aplicarlo se centra la vista (`fitView`) para que se
  // vea de inmediato el resultado completo, no solo la parte que ya estaba
  // encuadrada.
  const handleAutoLayout = useCallback(() => {
    const moves = computeAutoLayout(project)
    applyLayout(moves)
    instanceRef.current?.fitView({ duration: 300 })
  }, [project, applyLayout])

  // -- Viewport: fuera del historial (ver store). Solo se persiste al
  // terminar un gesto de pan/zoom, nunca en cada frame. Recalcula también el
  // centro visible (tarea 4): el pan/zoom es justo lo que puede desplazarlo.
  const handleMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      setViewport(viewport)
      updateViewportCenter()
    },
    [setViewport, updateViewportCenter],
  )

  // -- Foco desde `LeftPanel` (`ui.focusRequestNodeId`, ver store). Centra
  // la vista en el nodo pedido y limpia la petición para no repetir el
  // centrado en renders posteriores. Si la instancia todavía no está lista
  // (carrera muy poco probable con el montaje inicial), no se hace nada más
  // que limpiar la petición: es mejor perder un centrado puntual que
  // dejarla “colgada” y repetirla más tarde de forma inesperada.
  useEffect(() => {
    if (!focusRequestNodeId) return

    const instance = instanceRef.current
    if (instance) {
      const node = instance.getNode(focusRequestNodeId)
      if (node) {
        const width = node.measured?.width ?? FALLBACK_NODE_WIDTH
        const height = node.measured?.height ?? FALLBACK_NODE_HEIGHT
        instance.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
          zoom: instance.getZoom(),
          duration: 300,
        })
      }
    }

    clearFocusRequest()
  }, [focusRequestNodeId, clearFocusRequest])

  return (
    <div className={styles.canvas} ref={wrapperRef}>
      <ReactFlow
        className={styles.flow}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={project.editor.viewport}
        onInit={handleInit}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onSelectionChange={handleSelectionChange}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        onMoveEnd={handleMoveEnd}
        onBeforeDelete={handleBeforeDelete}
        onNodesDelete={handleNodesDelete}
        deleteKeyCode={['Backspace', 'Delete']}
        // Por defecto, `@xyflow/react` usa Meta/Ctrl (según plataforma) para
        // ir añadiendo nodos a la selección con clic — pero Mayús+arrastrar
        // ya es, por defecto también, el gesto para la caja de selección
        // (`selectionKeyCode`, sin tocar). Se fija Mayús aquí TAMBIÉN para
        // el clic individual: ambos gestos (clic y arrastre) conviven sin
        // conflicto porque se distinguen por dónde se origina el gesto (un
        // nodo vs. el lienzo vacío), no por qué tecla se usa — y así el
        // usuario solo necesita recordar una tecla para "seleccionar varias
        // diapositivas", sea con clic o con arrastre.
        multiSelectionKeyCode="Shift"
        minZoom={0.1}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="var(--bs-color-canvas-dot)" />
        <Controls showInteractive={false}>
          <ControlButton
            onClick={handleAutoLayout}
            title={AUTO_LAYOUT_LABEL}
            aria-label={AUTO_LAYOUT_LABEL}
          >
            <AutoLayoutIcon />
          </ControlButton>
        </Controls>
      </ReactFlow>
      {contextMenu.open && contextMenu.position && (
        <ConnectionMenu
          position={contextMenu.position}
          onSelect={handleSelectMenuType}
          onClose={closeContextMenu}
        />
      )}
      {/* Aviso de confirmación de borrado por doble pulsación (ver
          `handleBeforeDelete` arriba): discreto, anclado a la parte
          inferior del lienzo, no un modal. Desaparece solo al confirmar, al
          cancelar, o al caducar la ventana de confirmación. */}
      {pendingDeleteCount !== null && (
        <div className={styles.deleteConfirmBanner} role="status">
          <span>
            {pendingDeleteCount === 1
              ? 'Pulsa Supr/Backspace otra vez para eliminar este nodo.'
              : `Pulsa Supr/Backspace otra vez para eliminar estos ${pendingDeleteCount} nodos.`}
          </span>
          <button
            type="button"
            className={styles.deleteConfirmCancel}
            onClick={cancelPendingDelete}
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
