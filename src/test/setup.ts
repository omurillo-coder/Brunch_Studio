import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * `globals: false` en `vitest.config.ts` significa que `afterEach` no está
 * disponible como global, así que el auto-cleanup de
 * `@testing-library/react` (que depende de detectar ese global) nunca se
 * registra solo. Sin este hook, cada `render()` de un test deja su árbol
 * montado en el DOM compartido de jsdom y el siguiente test que use una
 * query como `getByText` puede encontrar coincidencias duplicadas de tests
 * anteriores.
 */
afterEach(() => {
  cleanup()
})

/**
 * Polyfills necesarios para poder montar `@xyflow/react` en jsdom (fase 5,
 * lienzo real). Sin ellos, montar `<ReactFlow>` en un test lanza un
 * `TypeError` inmediato o mide todo a 0×0.
 *
 * - `ResizeObserver`: `@xyflow/react` lo usa internamente para medir cada
 *   nodo tras montarlo (`node.measured.width/height`) y el propio
 *   contenedor del lienzo. jsdom no lo implementa; un mock vacío basta
 *   porque los tests de este proyecto no dependen de que se dispare de
 *   verdad (no se testea layout real, ver limitaciones en
 *   `Canvas/__tests__`).
 * - `DOMMatrixReadOnly`: usado por la lógica interna de transform del
 *   viewport (lectura del `scale` de una matriz CSS). El mock solo expone
 *   `m22` (el componente de escala vertical), que es el único campo que
 *   `@xyflow/react` lee de él.
 * - `Element.prototype.getBoundingClientRect`: jsdom devuelve siempre
 *   0×0×0×0 (no hay motor de layout real). Sin un tamaño no-cero, React
 *   Flow considera el contenedor sin dimensiones (avisa con su error 004) y
 *   varios cálculos de viewport degeneran. Se sustituye por un tamaño fijo
 *   "razonable" solo para el entorno de test.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverMock implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverMock
}

if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
  class DOMMatrixReadOnlyMock {
    m22 = 1
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1]
      this.m22 = scale !== undefined ? Number(scale) : 1
    }
  }
  globalThis.DOMMatrixReadOnly = DOMMatrixReadOnlyMock as unknown as typeof DOMMatrixReadOnly
}

Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 1000,
    height: 800,
    top: 0,
    left: 0,
    right: 1000,
    bottom: 800,
    toJSON() {
      return this
    },
  }
}
