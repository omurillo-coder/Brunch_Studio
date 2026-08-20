import { createInitialState, useProjectStore } from './useProjectStore'

/**
 * Reinicia `useProjectStore` a un estado "de fábrica" limpio (proyecto
 * nuevo, historial vacío, selección/UI por defecto).
 *
 * Pensado únicamente para tests: llamar en un `beforeEach` para que cada
 * test arranque de un store limpio sin tener que recrear el store entero
 * (Zustand no ofrece un "reset" de fábrica, y crear un store nuevo por test
 * obligaría a los tests a importar una instancia distinta de la que usa el
 * resto de la app).
 *
 * Usa `setState` en modo *merge* (por defecto, sin pasar `true` como
 * segundo argumento): un modo *replace* sustituiría el objeto de estado
 * completo, y como las acciones viven en ese mismo objeto, se perderían.
 */
export function resetProjectStore(): void {
  useProjectStore.setState(createInitialState())
}
