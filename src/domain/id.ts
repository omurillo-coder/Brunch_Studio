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

/**
 * Desplaza el `number` de TODOS los nodos existentes una unidad hacia
 * arriba, para poder insertar delante un nodo `intro` que debe nacer SIEMPRE
 * con `number === 1` (milestone "Inicio siempre es D1"): el que era 1 pasa a
 * 2, el que era 2 pasa a 3, etc. Así el `intro` puede ocupar el 1 sin
 * colisionar nunca con ningún nodo ya existente.
 *
 * Compartida entre `createNode` (`src/domain/project.ts`, camino manual "+
 * Inicio" sobre un proyecto que ya tiene otros nodos numerados) y
 * `ensureIntroNode` (`src/domain/migration.ts`, sintetiza un Inicio para un
 * documento antiguo que no tenía ninguno): mismo criterio en los dos, para no
 * duplicar la lógica de desplazamiento.
 *
 * Efecto secundario DELIBERADO y aceptado (petición explícita de usuario):
 * esto renumera nodos ya existentes. Para `createNode` son los nodos del
 * proyecto en memoria en ese instante; para `ensureIntroNode` son los nodos
 * de un `.brunch` guardado ANTES de este milestone, que se renumeran al
 * abrirlo por primera vez tras la migración. No es un efecto colateral que
 * evitar: es el comportamiento pedido para que "Inicio" sea siempre
 * identificable como D1/número 1 sin excepción.
 *
 * No muta `nodes`: devuelve un array nuevo de objetos nuevos (`{ ...node,
 * number: node.number + 1 }`), así que funciona igual sobre nodos de dominio
 * "planos" que sobre un array `draft` de immer dentro de un `produce`.
 */
export function shiftNodeNumbersForNewIntro<T extends { number: number }>(
  nodes: readonly T[],
): T[] {
  return nodes.map((node) => ({ ...node, number: node.number + 1 }))
}
