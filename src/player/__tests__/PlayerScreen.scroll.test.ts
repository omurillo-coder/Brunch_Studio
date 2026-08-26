// 'node:fs'/'node:url' no están en los tipos de la app (tsconfig.app.json
// solo declara "types": ["vite/client"], a propósito: el código de la app
// corre en el navegador/webview, no en Node). Este archivo es solo de test,
// y Vitest sí corre sobre Node de verdad, así que el import funciona en
// tiempo de ejecución; se suprime aquí solo el aviso de tipos (por línea),
// en vez de añadir "node" a los tipos de toda la app. Import vía `?raw`
// (soportado por Vite) se descartó: el `test.css` por defecto de Vitest
// intercepta CUALQUIER import de un `.css` (con o sin `?raw`) y lo sustituye
// por el objeto vacío de CSS Modules, así que no llega a devolver el texto
// fuente.
// @ts-expect-error -- ver nota de arriba
import { fileURLToPath } from 'node:url'
// @ts-expect-error -- ver nota de arriba
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// `new URL('...', import.meta.url)` escrito literal así lo intercepta Vite
// (transform de "asset URL" en dev/test) y lo reescribe contra el servidor
// de desarrollo (http://localhost:...) en vez de dejarlo como file://, que
// es justo lo que hace falta aquí. Pasar la base por una variable en vez de
// escribir `import.meta.url` como segundo argumento literal evita ese
// reconocimiento sintáctico.
const testFileUrl = import.meta.url
const resolved = new URL('../PlayerScreen.module.css', testFileUrl)
const css = readFileSync(fileURLToPath(resolved), 'utf-8')

/**
 * Test de estructura/CSS del arreglo de scroll de contenido largo en
 * "Probar" (bug: la tarjeta quedaba centrada verticalmente sin límite de
 * altura ni scroll, cortando el principio del contenido cuando era más alto
 * que el área visible — ver `PlayerScreen.module.css`).
 *
 * jsdom no implementa layout real (todo mide 0×0, `scrollHeight`/`scrollTop`
 * no reflejan overflow de verdad), así que un test de "scroll real" contra
 * el DOM montado no sería fiable. En su lugar se comprueba directamente el
 * CSS fuente: que `.stage` (el contenedor compartido por las CUATRO vistas
 * del Player — `continue`, `decision`, `final` y `dead-end`, todas dentro de
 * `<main className={styles.stage}>` en `PlayerScreen.tsx`) ancla la tarjeta
 * arriba (`align-items: flex-start`, no `center`) y sigue teniendo
 * `overflow-y: auto`. Queda para verificación manual comprobar que el
 * scroll llega de verdad al principio y al final del contenido en un
 * navegador real (documentado en el informe de la tarea).
 */
describe('PlayerScreen.module.css — .stage ancla la tarjeta arriba y permite scroll', () => {
  function ruleFor(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
    if (!match) {
      throw new Error(`No se encontró la regla ${selector} en PlayerScreen.module.css`)
    }
    return match[1]!
  }

  it('.stage ancla la tarjeta arriba (align-items: flex-start), no centrada verticalmente', () => {
    expect(ruleFor('.stage')).toMatch(/align-items:\s*flex-start/)
    expect(ruleFor('.stage')).not.toMatch(/align-items:\s*center/)
  })

  it('.stage sigue centrando horizontalmente (justify-content: center) sin cambiar el ancho máximo de .card', () => {
    expect(ruleFor('.stage')).toMatch(/justify-content:\s*center/)
    expect(ruleFor('.card')).toMatch(/max-width:\s*520px/)
  })

  it('.stage tiene overflow-y: auto para que el contenido más alto que el área visible sea alcanzable', () => {
    expect(ruleFor('.stage')).toMatch(/overflow-y:\s*auto/)
  })
})
