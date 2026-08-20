/**
 * Generación de identificadores.
 *
 * Usa `crypto.randomUUID()` nativo (disponible en el runtime de Tauri/
 * navegador moderno y en Node >= 19, por lo que jsdom + Vitest lo exponen
 * sin necesidad de polyfill).
 */
export function createId(): string {
  return crypto.randomUUID()
}

/**
 * Calcula el siguiente número visible de nodo: el mayor número existente + 1
 * (o 1 si el proyecto no tiene nodos). Los números nunca se reasignan ni se
 * reciclan al borrar nodos.
 */
export function nextNodeNumber(existingNumbers: readonly number[]): number {
  if (existingNumbers.length === 0) return 1
  return Math.max(...existingNumbers) + 1
}
