import type { JSONContent } from '@tiptap/core'
import type { AnyExtension } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import StarterKit from '@tiptap/starter-kit'

/**
 * Serialización del campo `body` de un nodo (fase 4, Milestone 2).
 *
 * `body` sigue siendo `z.string()` en `src/domain` — el dominio no sabe nada
 * de Tiptap, sigue viendo una cadena opaca. Lo que cambia es lo que esa
 * cadena contiene: a partir de esta fase, un documento Tiptap serializado
 * como JSON (`JSON.stringify(editor.getJSON())`) en vez de texto plano. Ese
 * parseo/serialización vive aquí, fuera del dominio, precisamente para no
 * acoplarlo a Tiptap.
 *
 * Compatibilidad hacia atrás (crítico): un proyecto creado en el Milestone 1
 * tiene `body` en texto plano literal (p.ej. `"Hola, bienvenido"`). Esa
 * cadena no es JSON válido, así que `parseRichBody` cae al caso "texto
 * plano histórico" y la envuelve en un documento de un único párrafo — el
 * editor la muestra como contenido normal, nunca como JSON en crudo.
 */

/**
 * Lista ÚNICA de extensiones Tiptap del `body` de un nodo, compartida por
 * los cuatro sitios que crean un editor/convierten este documento (fase 8,
 * marca de resaltado): el editor real (`RichTextEditor`), la vista de solo
 * lectura del Player (`RichTextView`), el export HTML/SCORM
 * (`generateHTML` en `src/export/htmlBundle.ts`) y el importador de `.twee`
 * (`generateJSON` en `src/import/twee/tweeConverter.ts`).
 *
 * Centralizada aquí (y no duplicada en cada sitio) porque los cuatro deben
 * coincidir exactamente: si uno se queda atrás, el resultado visual diverge
 * (un documento con una marca que un sitio sabe pintar y otro no) o
 * `generateHTML`/`generateJSON` directamente pierden esa marca al no
 * reconocerla. `Highlight` se configura con sus opciones por defecto
 * (`multicolor: false`): una única marca `<mark>` sin atributo de color, con
 * el color de resaltado fijado por CSS (`--bs-color-highlight` en
 * `tokens.css`/`exportedStyles.ts`) — no por documento, así que cambiar el
 * tono de la marca no requiere migrar ningún `body` ya guardado.
 *
 * `Table`/`TableRow`/`TableHeader`/`TableCell` (tablas editables): mismo
 * criterio que `Highlight` arriba — se añaden aquí una única vez y los
 * cuatro sitios las reciben automáticamente. `Table` se configura con
 * `resizable: false` (deliberado: sin arrastre de anchos de columna, fuera
 * de alcance de esta fase — evita además que el HTML exportado dependa de
 * anchos inline calculados por el editor) y con selección de celda/rango
 * incluida por defecto (comportamiento de fábrica de la extensión, sin
 * configuración adicional).
 */
export const RICH_TEXT_EXTENSIONS: AnyExtension[] = [
  StarterKit,
  Highlight,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
]

/** Forma mínima que debe tener un valor para considerarlo un documento
 *  Tiptap ya serializado, en vez de texto plano histórico. */
function looksLikeTiptapDoc(value: unknown): value is JSONContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === 'doc' &&
    Array.isArray((value as { content?: unknown }).content)
  )
}

/** Documento Tiptap de un único párrafo con `text` como único contenido (o
 *  un párrafo vacío si `text` es la cadena vacía). */
function wrapPlainText(text: string): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: text ? [{ type: 'text', text }] : [],
      },
    ],
  }
}

/**
 * Interpreta el `body` (string) de un nodo como documento Tiptap.
 *
 * - `raw` vacío -> documento válido con un único párrafo vacío (no lanza).
 * - `raw` es JSON con forma de documento Tiptap (`{ type: 'doc', content:
 *   [...] }`) -> se devuelve tal cual (parseado).
 * - Cualquier otro caso (JSON.parse falla, o el JSON parseado no tiene esa
 *   forma) -> se trata `raw` como texto plano histórico y se envuelve en un
 *   párrafo único.
 *
 * Caso límite documentado: un `raw` que sea JSON válido pero no reconocible
 * como documento Tiptap (p.ej. `"42"`, `"{\"a\":1}"`) se trata igual que
 * texto plano — se envuelve tal cual como el texto del párrafo, JSON en
 * crudo incluido, porque a ojos de esta función no es distinguible de texto
 * plano "raro". No es un problema en la práctica: esta función solo ve
 * cadenas que vinieron de `serializeRichBody` (documentos Tiptap reales) o
 * de texto plano histórico anterior a esta fase; nunca JSON arbitrario de
 * otro origen.
 */
export function parseRichBody(raw: string): JSONContent {
  if (raw === '') {
    return wrapPlainText('')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return wrapPlainText(raw)
  }

  if (!looksLikeTiptapDoc(parsed)) {
    return wrapPlainText(raw)
  }

  return parsed
}

/** Inverso de `parseRichBody`: serializa un documento Tiptap a la cadena que
 *  se guarda en `body`. */
export function serializeRichBody(doc: JSONContent): string {
  return JSON.stringify(doc)
}

/**
 * Extrae el texto plano "de búsqueda" de un documento Tiptap ya parseado
 * (`parseRichBody(node.body)`), recorriendo el árbol recursivamente y
 * concatenando todos los nodos de texto de todos los niveles (párrafos,
 * listas, negrita/cursiva — las marcas no afectan al texto extraído).
 *
 * Usada por el buscador del proyecto (`LeftPanel`, fase 8): buscar
 * directamente con un substring sobre `node.body` encontraría falsos
 * positivos en la propia sintaxis JSON serializada (p.ej. buscar "type"
 * "encontraría" cualquier body, por la clave `"type":"doc"` de Tiptap) — por
 * eso hace falta parsear primero y extraer solo el texto real.
 *
 * Inserta un espacio entre el texto de un nodo de bloque (párrafo, item de
 * lista, etc.) y lo que sigue, para que el texto de dos bloques distintos
 * ("Primer punto" / "Segundo punto" en dos items de una lista) no quede
 * pegado sin separación ("Primer puntoSegundo punto"); los espacios
 * consecutivos que resultan de anidar varios bloques se colapsan al final.
 * Los nodos de texto dentro del MISMO bloque se concatenan tal cual (sin
 * insertar nada entre ellos): el espacio, si lo hay entre dos tramos con
 * formato distinto de un mismo párrafo, ya viene incluido en el propio texto
 * de Tiptap.
 */
export function extractPlainText(doc: JSONContent): string {
  const parts: string[] = []

  function visit(node: JSONContent): void {
    if (node.type === 'text' && typeof node.text === 'string') {
      parts.push(node.text)
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        visit(child as JSONContent)
      }
    }
    if (node.type !== 'text' && node.type !== 'doc') {
      parts.push(' ')
    }
  }

  visit(doc)
  return parts.join('').replace(/\s+/g, ' ').trim()
}
