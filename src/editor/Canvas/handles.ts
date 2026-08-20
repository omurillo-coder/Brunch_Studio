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
