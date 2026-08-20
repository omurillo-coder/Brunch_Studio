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
