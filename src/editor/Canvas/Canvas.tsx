import { useCallback, useEffect, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
} from '@xyflow/react'
import type {
  Connection,
  FinalConnectionState,
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
import { nodeTypes } from './nodes/nodeTypes'
import { edgeTypes } from './edges/edgeTypes'
import { ConnectionMenu } from './ConnectionMenu'
import styles from './Canvas.module.css'

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
  const setViewport = useProjectStore((state) => state.setViewport)
  const beginNodeDrag = useProjectStore((state) => state.beginNodeDrag)
  const updateNodeDragPosition = useProjectStore((state) => state.updateNodeDragPosition)
  const endNodeDrag = useProjectStore((state) => state.endNodeDrag)
  const clearFocusRequest = useProjectStore((state) => state.clearFocusRequest)
  const openContextMenu = useProjectStore((state) => state.openContextMenu)
  const closeContextMenu = useProjectStore((state) => state.closeContextMenu)
  const createConnectedNodeFromMenu = useProjectStore((state) => state.createConnectedNodeFromMenu)

  const nodes = toFlowNodes(project, selectedNodeIds)
  const edges = toFlowEdges(project, selectedNodeIds)

  // Instancia de React Flow, capturada vía `onInit` (evita necesitar un
  // `<ReactFlowProvider>` + `useReactFlow()` solo para esto). Vive en un
  // ref, no en estado: no debe disparar un re-render propio.
  const instanceRef = useRef<ReactFlowInstance<CanvasFlowNode, CanvasFlowEdge> | null>(null)

  const handleInit = useCallback((instance: ReactFlowInstance<CanvasFlowNode, CanvasFlowEdge>) => {
    instanceRef.current = instance
  }, [])

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
  const startNodeId = project.graph.startNodeId
  const handleBeforeDelete: OnBeforeDelete<CanvasFlowNode, CanvasFlowEdge> = useCallback(
    async ({ nodes: candidateNodes, edges: candidateEdges }) => {
      const allowedNodes = candidateNodes.filter((node) => node.id !== startNodeId)
      if (allowedNodes.length === 0 && candidateNodes.length > 0) {
        return false
      }
      return { nodes: allowedNodes, edges: candidateEdges }
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

  // -- Viewport: fuera del historial (ver store). Solo se persiste al
  // terminar un gesto de pan/zoom, nunca en cada frame.
  const handleMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      setViewport(viewport)
    },
    [setViewport],
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
    <div className={styles.canvas}>
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
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        onMoveEnd={handleMoveEnd}
        onBeforeDelete={handleBeforeDelete}
        onNodesDelete={handleNodesDelete}
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.1}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="var(--bs-color-canvas-dot)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      {contextMenu.open && contextMenu.position && (
        <ConnectionMenu
          position={contextMenu.position}
          onSelect={handleSelectMenuType}
          onClose={closeContextMenu}
        />
      )}
    </div>
  )
}
