import { useEffect } from 'react'
import { useProjectStore, useSelectedNodeIds } from '../../store'

/**
 * Detecta si el foco actual está en un campo de texto editable (un
 * `<input>`, un `<textarea>`, o cualquier elemento `contentEditable` como el
 * editor de cuerpo Tiptap). Mientras el foco esté ahí, Ctrl/Cmd+C/V deben
 * seguir siendo el copiar/pegar de texto nativo del navegador — nunca deben
 * disparar la duplicación de diapositivas de este hook.
 *
 * Copia deliberada de `isEditableTarget` en `src/editor/Topbar/Topbar.tsx`
 * (mismo criterio exacto, usado ahí para no interceptar Ctrl/Cmd+Z/Y dentro
 * de un campo de texto): no se extrae a un módulo compartido porque
 * `Topbar.tsx` queda fuera del alcance de este cambio (lo toca otro proceso
 * en paralelo sobre este mismo repo). Si en el futuro ambos ficheros se
 * tocan en el mismo cambio, vale la pena unificar esto en un helper común.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  )
}

/**
 * Ctrl/Cmd+C / Ctrl/Cmd+V para duplicar diapositivas (Tarea 1, "Duplicar
 * diapositivas"). Se monta desde `Canvas` porque la selección de nodos vive
 * conceptualmente ahí — es el componente que ya se suscribe a
 * `selection.selectedNodeIds` para pintar la selección del lienzo.
 *
 * - Ctrl/Cmd+C, con el foco FUERA de un campo editable y al menos un nodo
 *   seleccionado: guarda esos ids en `ui.clipboardNodeIds` (el
 *   "portapapeles" interno del store, ver su comentario en
 *   `src/store/types.ts` — deliberadamente NO el portapapeles real del
 *   sistema operativo, no hace falta la Clipboard API del navegador para
 *   este caso de uso).
 * - Ctrl/Cmd+V, con el foco FUERA de un campo editable y contenido en el
 *   portapapeles: duplica cada id guardado que TODAVÍA exista en el
 *   proyecto en ese momento (uno podría haberse borrado entre copiar y
 *   pegar), sin repetir un mismo id dos veces aunque estuviera duplicado en
 *   la lista guardada, y deja seleccionadas TODAS las copias nuevas a la
 *   vez — generalización de "`duplicateNode` selecciona la copia" (ver
 *   store) al caso de pegar varios nodos de golpe.
 *
 * Con el foco DENTRO de un campo editable (título, editor de cuerpo, texto
 * de una respuesta...) ambos atajos se dejan pasar sin `preventDefault`: el
 * copiar/pegar de texto nativo del navegador sigue funcionando exactamente
 * igual, sin ninguna interferencia de este hook — es el caso más importante
 * de no romper, ver el test dedicado.
 */
export function useCanvasClipboard() {
  const selectedNodeIds = useSelectedNodeIds()

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return

      const modifier = event.metaKey || event.ctrlKey
      if (!modifier) return

      const key = event.key.toLowerCase()

      if (key === 'c') {
        if (selectedNodeIds.length === 0) return
        event.preventDefault()
        useProjectStore.getState().setClipboardNodeIds(selectedNodeIds)
        return
      }

      if (key === 'v') {
        const { clipboardNodeIds } = useProjectStore.getState().ui
        if (clipboardNodeIds.length === 0) return

        const before = useProjectStore.getState().project
        const existingIds = new Set(before.graph.nodes.map((node) => node.id))
        const idsToDuplicate = [...new Set(clipboardNodeIds)].filter((id) => existingIds.has(id))
        if (idsToDuplicate.length === 0) return

        event.preventDefault()
        for (const id of idsToDuplicate) {
          useProjectStore.getState().duplicateNode(id)
        }

        // `duplicateNode` selecciona su propia copia en cada llamada; tras
        // el bucle, se sustituye esa selección "del último" por el conjunto
        // completo de copias nuevas, comparando el documento antes/después
        // del bucle (mismo criterio "por id, no por número máximo" que
        // `createConnectedNodeFromMenu`/`createConnectedNode` de dominio).
        const after = useProjectStore.getState().project
        const newIds = after.graph.nodes
          .filter((node) => !existingIds.has(node.id))
          .map((node) => node.id)
        if (newIds.length > 0) {
          useProjectStore.getState().setSelection(newIds)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedNodeIds])
}
