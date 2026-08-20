/**
 * Ids de los handles de conexión usados por los nodos personalizados de
 * `@xyflow/react` (ver `nodes/nodeTypes.tsx`).
 *
 * - `start`/`content` tienen una única salida: handle fijo `OUT_HANDLE_ID`.
 * - `decision` tiene una salida por respuesta existente: un handle
 *   `response:<responseId>` por cada una — el prefijo permite recuperar el
 *   `responseId` original a partir del `sourceHandle` que entrega
 *   `onConnect` de `@xyflow/react`, sin mantener un mapa aparte ni otra
 *   fuente de verdad.
 * - Todos los nodos con entrada (`content`, `decision`, `final`, y `start`
 *   por consistencia visual — ver `nodeTypes.tsx`) usan el mismo handle de
 *   entrada fijo `IN_HANDLE_ID`.
 */

export const OUT_HANDLE_ID = 'out'
export const IN_HANDLE_ID = 'in'

const RESPONSE_HANDLE_PREFIX = 'response:'

/** Construye el id de handle de salida de una respuesta concreta. */
export function responseHandleId(responseId: string): string {
  return `${RESPONSE_HANDLE_PREFIX}${responseId}`
}

/**
 * Recupera el `responseId` original de un id de handle de salida de
 * respuesta. Devuelve `undefined` si `handleId` no tiene el prefijo
 * esperado (p.ej. es `OUT_HANDLE_ID`, `IN_HANDLE_ID`, `null` o `undefined`).
 */
export function parseResponseHandleId(handleId: string | null | undefined): string | undefined {
  if (!handleId || !handleId.startsWith(RESPONSE_HANDLE_PREFIX)) return undefined
  return handleId.slice(RESPONSE_HANDLE_PREFIX.length)
}

/** Origen resuelto de un gesto de conexión que terminó soltado en el vacío
 *  del lienzo (ver `resolveEmptyPaneDrop`). */
export interface EmptyPaneDropOrigin {
  sourceNodeId: string
  sourceResponseId?: string
}

/**
 * Decide si el final de un gesto de conexión de `@xyflow/react`
 * (`onConnectEnd`) corresponde al patrón "arrastrar desde un handle real de
 * un nodo existente y soltar en una zona vacía del lienzo" — el gatillo del
 * menú contextual "¿Qué quieres añadir?" (fase 7).
 *
 * Pura y testeable sin montar `@xyflow/react` ni el DOM real: recibe ya
 * reducidos los tres datos relevantes de `FinalConnectionState` y del evento
 * DOM del gesto, en vez del objeto completo de la librería.
 *
 * - `isValid`: `connectionState.isValid` tal cual. `true` significa que el
 *   gesto terminó sobre un handle de destino válido — ese caso ya lo cubre
 *   el `onConnect` normal (fase anterior) y aquí se descarta explícitamente
 *   devolviendo `null`.
 * - `fromHandle`: `connectionState.fromHandle`. Si es `null` no hubo un
 *   arrastre real desde un handle existente (no debería ocurrir en la
 *   práctica para que `onConnectEnd` dispare, pero se cubre por si acaso en
 *   vez de asumirlo).
 * - `droppedOnPane`: si el elemento DOM sobre el que se soltó el gesto
 *   (`event.target`) es el pane vacío de `@xyflow/react` — normalmente
 *   comprobado con `target.classList.contains('react-flow__pane')` por
 *   quien llama. Si el drop cae dentro de un nodo existente pero no sobre un
 *   handle válido, esto debe ser `false`: ese caso no debe abrir el menú (lo
 *   pide el spec explícitamente: "no sobre un nodo/handle existente").
 *
 * `sourceResponseId` se deriva del `id` del handle de origen reutilizando
 * `parseResponseHandleId` — la misma lógica que ya usa `resolveConnection`
 * en `adapter.ts` para el `onConnect` normal, sin duplicarla.
 */
export function resolveEmptyPaneDrop(params: {
  isValid: boolean | null
  fromHandle: { nodeId: string; id?: string | null } | null
  droppedOnPane: boolean
}): EmptyPaneDropOrigin | null {
  if (params.isValid) return null
  if (!params.droppedOnPane) return null
  if (!params.fromHandle) return null

  return {
    sourceNodeId: params.fromHandle.nodeId,
    sourceResponseId: parseResponseHandleId(params.fromHandle.id),
  }
}
