import { useEffect } from 'react'
import { useProjectStore, useSelectedNodeIds } from '../../store'

/** Copia deliberada de `isEditableTarget` en `useCanvasClipboard.ts` (ver su
 *  comentario sobre por qué no se comparte todavía en un helper común). */
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  )
}

/**
 * Hallazgo de auditoría ("crear un nodo nuevo depende del ratón"):
 * seleccionar/mover/borrar un nodo ya existente ya era operable por
 * teclado, pero crear uno nuevo dependía por completo de arrastrar una
 * conexión desde un handle hasta un hueco vacío del lienzo
 * (`Canvas.handleConnectEnd`/`resolveEmptyPaneDrop`).
 *
 * Con exactamente UN nodo seleccionado (mismo criterio de "sin ambigüedad
 * posible" que "Probar desde aquí" en `Topbar`) y el foco fuera de un campo
 * editable, `Enter` abre el MISMO menú "¿Qué quieres añadir?" que ya
 * dispara ese arrastre — mismo `originNodeId`, sin `originResponseId` (usa
 * la salida de "Continuar"/única del nodo, igual que soltar la conexión
 * desde el handle de salida). La posición de pantalla se calcula a partir
 * del propio elemento DOM del nodo seleccionado (borde derecho, centrado
 * verticalmente): el menú aparece donde tendría sentido si se hubiera
 * arrastrado desde ahí, en vez de en una esquina fija arbitraria.
 *
 * Se ignora mientras el menú ya está abierto (`ui.contextMenu.open`): una
 * segunda pulsación de `Enter` con el menú ya en pantalla no debe
 * recolocarlo ni reabrirlo — `ConnectionMenu` ya gestiona su propio cierre
 * con `Escape`/clic fuera.
 */
export function useCanvasKeyboardCreate() {
  const selectedNodeIds = useSelectedNodeIds()

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter') return
      if (isEditableTarget(event.target)) return
      if (selectedNodeIds.length !== 1) return
      if (useProjectStore.getState().ui.contextMenu.open) return

      const nodeId = selectedNodeIds[0]
      if (!nodeId) return
      const nodeElement = document.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${CSS.escape(nodeId)}"]`,
      )
      if (!nodeElement) return

      event.preventDefault()
      const rect = nodeElement.getBoundingClientRect()
      useProjectStore.getState().openContextMenu({
        position: { x: rect.right + 8, y: rect.top + rect.height / 2 },
        originNodeId: nodeId,
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedNodeIds])
}
