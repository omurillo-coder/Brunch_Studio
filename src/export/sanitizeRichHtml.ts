/**
 * Sanitización propia del HTML enriquecido antes de embeberlo en el archivo
 * exportado (hallazgo de auditoría: "sin sanitización propia... hoy está
 * protegido por el comportamiento por defecto de Tiptap, no por una defensa
 * explícita de Brunch Studio... una reconfiguración futura de Tiptap podría
 * reabrir la vía sin que nada lo detecte").
 *
 * `generateHTML` (`@tiptap/core`) ya serializa de forma segura por diseño —
 * genera nodos DOM programáticamente a partir del JSON del documento, nunca
 * concatena strings de usuario en el HTML — así que hoy no hay ninguna vía
 * de inyección real. Pero esa seguridad es un EFECTO SECUNDARIO de cómo
 * está construido Tiptap, no una garantía explícita de este proyecto: si
 * `RICH_TEXT_EXTENSIONS` (`richTextContent.ts`) ganara en el futuro una
 * extensión que sí permita HTML crudo (o una mal configurada), el HTML
 * resultante se embebería sin ningún control propio.
 *
 * Esta función es esa defensa explícita: una lista blanca de exactamente lo
 * que `RICH_TEXT_EXTENSIONS` puede producir hoy (comprobado generando HTML
 * de verdad para cada marca/nodo de esa lista, no adivinado) — cualquier
 * etiqueta/atributo fuera de esa lista se descarta, sea cual sea su origen.
 * Se aplica UNA VEZ en tiempo de exportación (`renderNodeBodies` en
 * `htmlBundle.ts`), no en el script exportado: el HTML que viaja dentro del
 * archivo ya sale saneado, así que el runtime vanilla JS no necesita cargar
 * ningún sanitizador propio.
 */

/** Etiquetas que `generateHTML(doc, RICH_TEXT_EXTENSIONS)` puede producir
 *  hoy — StarterKit (párrafo/títulos/negrita/cursiva/tachado/código/listas/
 *  cita/bloque de código/línea horizontal/salto de línea), Highlight
 *  (`mark`), Table/TableRow/TableHeader/TableCell. `colgroup`/`col` son
 *  parte de cómo Tiptap serializa una tabla (anchos de columna), no algo
 *  que el usuario pueda escribir directamente. Cualquier otra etiqueta
 *  (`script`, `style`, `iframe`, `a`, `img`, `svg`, `object`...) se
 *  descarta — ninguna extensión instalada las produce. */
const ALLOWED_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  's',
  'code',
  'mark',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'hr',
  'br',
  'table',
  'colgroup',
  'col',
  'tbody',
  'tr',
  'th',
  'td',
])

/** Atributos permitidos por etiqueta — los únicos que
 *  `RICH_TEXT_EXTENSIONS` llega a escribir de verdad:
 *  - `style` en `p`/`h1`-`h6` (`TextAlign`) y en `table`/`col` (anchos fijos
 *    de `Table.configure({ resizable: false })`) — su VALOR se valida aparte
 *    con `SAFE_STYLE_RE`, no basta con permitir el nombre del atributo.
 *  - `colspan`/`rowspan` en `th`/`td` (valor por defecto de la extensión de
 *    tabla, siempre `"1"` sin selección de celdas combinadas en esta fase). */
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  p: new Set(['style']),
  h1: new Set(['style']),
  h2: new Set(['style']),
  h3: new Set(['style']),
  h4: new Set(['style']),
  h5: new Set(['style']),
  h6: new Set(['style']),
  table: new Set(['style']),
  col: new Set(['style']),
  th: new Set(['colspan', 'rowspan']),
  td: new Set(['colspan', 'rowspan']),
}

/** Valores de `style` que de verdad escribe `RICH_TEXT_EXTENSIONS`:
 *  `text-align: left|center|right|justify` (`TextAlign`) o
 *  `min-width: <número>px` (anchos de columna de `Table`/`TableCell`) — uno
 *  o varios, separados por `;`. Cualquier otra propiedad CSS (o cualquier
 *  valor con `url(`/`expression(`/`javascript:`) se descarta entera: nunca
 *  se deja pasar un `style` a medio validar. */
const SAFE_STYLE_DECLARATION_RE =
  /^(?:text-align:\s*(?:left|center|right|justify)|min-width:\s*\d+(?:\.\d+)?px)$/

function sanitizeStyleValue(value: string): string | null {
  const declarations = value
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.length > 0)
  if (declarations.length === 0) return null
  const allSafe = declarations.every((declaration) => SAFE_STYLE_DECLARATION_RE.test(declaration))
  // `;` final incluido (no solo entre declaraciones): mismo formato exacto
  // que ya escribe `generateHTML` (comprobado generando HTML de verdad),
  // para que sanear un documento ya seguro sea un no-op byte a byte.
  return allSafe ? `${declarations.join('; ')};` : null
}

/** Etiquetas cuyo CONTENIDO nunca debe tratarse como texto a mostrar —
 *  `<script>`/`<style>` guardan código, no texto legible, así que "quitar
 *  la etiqueta mas conservar lo de dentro" (el criterio general de abajo)
 *  sería exactamente el bug al revés: dejaría el código fuente visible como
 *  si fuera contenido legítimo. Estas se eliminan ENTERAS, con su
 *  contenido, antes incluso de mirar sus hijos. El resto de la lista
 *  (`iframe`/`object`/`embed`/`noscript`/`template`/`svg`/`math`) por el
 *  mismo motivo: ninguna aporta texto legible propio y todas son vectores
 *  de contenido activo o incrustado que `RICH_TEXT_EXTENSIONS` no produce
 *  ni necesita. */
const STRIP_WITH_CONTENT_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'svg',
  'math',
])

/** Sanea un único elemento in situ: quita los atributos no permitidos (o
 *  con valor inseguro) y sanea recursivamente sus hijos. Los elementos
 *  fuera de la lista blanca (pero no en `STRIP_WITH_CONTENT_TAGS`) se
 *  "desenvuelven" (se sustituyen por sus hijos, ya saneados) en vez de
 *  borrarse enteros junto con su contenido — mismo criterio tolerante que
 *  ya documenta `richTextContent.ts` para el HTML embebido de Twee: una
 *  etiqueta sin equivalente pierde la etiqueta, nunca el texto que
 *  contenía. */
function sanitizeElement(element: Element): void {
  const tag = element.tagName.toLowerCase()

  if (STRIP_WITH_CONTENT_TAGS.has(tag)) {
    element.remove()
    return
  }

  for (const child of [...element.children]) {
    sanitizeElement(child)
  }

  if (!ALLOWED_TAGS.has(tag)) {
    element.replaceWith(...element.childNodes)
    return
  }

  const allowedAttributes = ALLOWED_ATTRIBUTES[tag]
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase()
    if (!allowedAttributes?.has(name)) {
      element.removeAttribute(attribute.name)
      continue
    }
    if (name === 'style') {
      const safeValue = sanitizeStyleValue(attribute.value)
      if (safeValue) {
        element.setAttribute('style', safeValue)
      } else {
        element.removeAttribute('style')
      }
    }
  }
}

/**
 * Sanea `html` (ya generado por `generateHTML(doc, RICH_TEXT_EXTENSIONS)`)
 * contra la lista blanca de arriba y devuelve el resultado como string,
 * listo para embeberse en el archivo exportado.
 *
 * Usa `DOMParser` (disponible tanto en el webview de Tauri en tiempo de
 * exportación como en jsdom para los tests) para parsear de verdad, en vez
 * de una limpieza por regex sobre el string — recorrer el DOM ya parseado
 * es la única forma fiable de distinguir una etiqueta real de texto que
 * simplemente CONTIENE los caracteres `<`/`>`.
 */
export function sanitizeRichHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = parsed.getElementById('root')
  if (!root) return ''

  // Se sanea cada HIJO de `root`, nunca `root` mismo: es un contenedor
  // propio de esta función (nunca parte del HTML de Tiptap), así que no
  // está en `ALLOWED_TAGS` — pasarlo por `sanitizeElement` lo
  // "desenvolvería" a él también (`replaceWith(...childNodes)`), que
  // MUEVE sus hijos a ser hermanos suyos en vez de sus hijos, dejando
  // `root.innerHTML` vacío justo cuando ya no queda `root` al que
  // preguntarle.
  for (const child of [...root.children]) {
    sanitizeElement(child)
  }

  return root.innerHTML
}
