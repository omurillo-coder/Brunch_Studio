import { useCallback, useEffect, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
} from '@xyflow/react'
import type {
  Connection,
  OnSelectionChangeFunc,
  ReactFlowInstance,
  Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  useFocusRequestNodeId,
  useProject,
  useProjectStore,
  useSelectedNodeIds,
} from '../../store'
import type { CanvasFlowEdge, CanvasFlowNode } from './adapter'
import { resolveConnection, toFlowEdges, toFlowNodes } from './adapter'
import { nodeTypes } from './nodes/nodeTypes'
import styles from './Canvas.module.css'

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

  const connect = useProjectStore((state) => state.connect)
  const setSelection = useProjectStore((state) => state.setSelection)
  const setViewport = useProjectStore((state) => state.setViewport)
  const beginNodeDrag = useProjectStore((state) => state.beginNodeDrag)
  const updateNodeDragPosition = useProjectStore((state) => state.updateNodeDragPosition)
  const endNodeDrag = useProjectStore((state) => state.endNodeDrag)
  const clearFocusRequest = useProjectStore((state) => state.clearFocusRequest)

  const nodes = toFlowNodes(project, selectedNodeIds)
  const edges = toFlowEdges(project)

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
  const handleNodeDragStart = useCallback(
    (_event: unknown, node: CanvasFlowNode) => {
      beginNodeDrag(node.id)
    },
    [beginNodeDrag],
  )

  const handleNodeDrag = useCallback(
    (_event: unknown, node: CanvasFlowNode) => {
      updateNodeDragPosition(node.id, node.position)
    },
    [updateNodeDragPosition],
  )

  const handleNodeDragStop = useCallback(() => {
    endNodeDrag()
  }, [endNodeDrag])

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
        defaultViewport={project.editor.viewport}
        onInit={handleInit}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onSelectionChange={handleSelectionChange}
        onConnect={handleConnect}
        onMoveEnd={handleMoveEnd}
        deleteKeyCode={null}
        minZoom={0.1}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="var(--bs-color-canvas-dot)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
