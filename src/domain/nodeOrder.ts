import { produce } from 'immer'
import type { ProjectDocument } from './schemas'

/**
 * ---------------------------------------------------------------------------
 * Orden de aparición de las diapositivas en el panel izquierdo
 * ---------------------------------------------------------------------------
 *
 * `project.graph.nodes` es un array, así que YA tiene un orden — pero ese
 * orden nunca ha significado nada funcional: ni el recorrido real de la
 * experiencia (que se resuelve enteramente por id, vía `targetNodeId`/
 * `graph.startNodeId`, ver `src/domain/graph.ts` y `src/player/runtime.ts`),
 * ni el auto-layout del lienzo (`computeAutoLayout` en
 * `src/editor/Canvas/layout/autoLayout.ts`, que documenta explícitamente ser
 * determinista "sea cual sea el orden de iteración de `project.graph.nodes`"),
 * ni el carril de las aristas del lienzo (`computeEdgeLanes` en
 * `src/editor/Canvas/edges/edgeGeometry.ts`, que decide el orden DENTRO de un
 * carril por `source`/`sourceHandle`, nunca por el orden del array), ni la
 * exportación HTML/SCORM (`src/export/htmlBundle.ts`,
 * `src/export/exportedPlayerScript.ts`, que buscan cada nodo por id) dependen
 * de ese orden para nada más que iterar de forma determinista (p.ej.
 * `collectReferencedAssetIds` en `src/export/exportAssets.ts`, cuyo propio
 * comentario aclara que el orden solo existe para que el HTML exportado sea
 * diffable entre exportaciones, no por ningún motivo funcional).
 *
 * Este módulo introduce la ÚNICA operación que SÍ cambia ese orden a
 * propósito: `reorderNode`, pensada para que el diseñador organice
 * visualmente la lista de diapositivas del panel izquierdo (`LeftPanel`) a su
 * gusto — por ejemplo, agrupar juntas las que tratan un mismo tema — sin que
 * mover una tarjeta en esa lista tenga NINGÚN efecto sobre el recorrido, el
 * auto-layout, la exportación o el guardado. Es, deliberadamente, un archivo
 * de dominio aparte y no una función más de `src/domain/project.ts`: mismo
 * criterio de "familia de operaciones separada" que ya siguen
 * `src/domain/content.ts` (bloques de una diapositiva) y
 * `src/domain/responses.ts` (respuestas de decisión) frente al resto de
 * `project.ts`.
 */

/**
 * Mueve el nodo con id `nodeId` a la posición `toIndex` dentro de
 * `project.graph.nodes`, recolocando el resto de nodos alrededor (mismo
 * efecto que "sacar la carta de la baraja y volver a insertarla en otro
 * hueco" — no un intercambio con el nodo que ocupaba `toIndex`).
 *
 * `toIndex` se recorta a `[0, nodes.length - 1]` (mismo criterio tolerante
 * que `moveContentBlock` en `src/domain/content.ts`, ver `clampIndex` ahí):
 * un índice fuera de rango mueve el nodo al principio/final de la lista en
 * vez de lanzar, así que quien llama (el panel izquierdo) no tiene que
 * clampear nada por su cuenta. Mover un nodo a su propio índice actual es un
 * no-op válido (no lanza, no cambia el orden).
 *
 * NO toca `number` de ningún nodo (el número identificador visible, asignado
 * una única vez al crear el nodo y nunca reciclado ni reasignado, ver
 * `src/domain/id.ts`) ni ningún otro campo: esta función reordena el array,
 * nada más. `number` sigue identificando "cuándo se creó" cada diapositiva,
 * independientemente de dónde aparezca ahora en la lista.
 *
 * Lanza `Error` si `nodeId` no existe, mismo criterio que el resto del
 * dominio (`findNodeIndex` de `src/domain/project.ts`, `findBlockIndex` de
 * `src/domain/content.ts`...).
 */
export function reorderNode(
  project: ProjectDocument,
  nodeId: string,
  toIndex: number,
): ProjectDocument {
  const fromIndex = project.graph.nodes.findIndex((node) => node.id === nodeId)
  if (fromIndex === -1) {
    throw new Error(`No existe un nodo con id "${nodeId}".`)
  }

  const clampedTarget = Math.min(Math.max(toIndex, 0), project.graph.nodes.length - 1)

  return produce(project, (draft) => {
    const [moved] = draft.graph.nodes.splice(fromIndex, 1)
    if (moved) {
      draft.graph.nodes.splice(clampedTarget, 0, moved)
    }
    draft.metadata.updatedAt = new Date().toISOString()
  })
}
