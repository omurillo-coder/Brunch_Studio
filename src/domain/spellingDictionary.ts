import NSpell from 'nspell'

/**
 * Datos crudos del diccionario ortográfico de español (Hunspell), tal como
 * los distribuye el paquete `dictionary-es`.
 *
 * Deliberadamente NO importamos `dictionary-es` por su punto de entrada JS
 * (`import dictionary from 'dictionary-es'`): ese módulo lee los ficheros
 * `.aff`/`.dic` con `node:fs/promises` (ver `node_modules/dictionary-es/
 * index.js`), lo que solo funciona en un proceso Node — esta app corre en el
 * webview de Tauri (un entorno de navegador, sin `node:fs`), así que esa vía
 * rompería en tiempo de ejecución aunque compilara bien.
 *
 * En su lugar referenciamos los dos ficheros de datos del paquete por RUTA
 * RELATIVA de fichero (no por el specifier del paquete, `dictionary-es/
 * index.aff`, que el `exports` de su `package.json` bloquearía: solo expone
 * `./index.js`) con el sufijo `?url` de Vite. Vite resuelve esto en
 * desarrollo sirviendo el fichero real y en build copiándolo al bundle con
 * nombre con hash, devolviendo en ambos casos una URL que se puede `fetch`
 * en tiempo de ejecución — mismo mecanismo en `npm run dev` y en un build
 * empaquetado. El paquete `dictionary-es` sigue siendo la fuente real de
 * estos datos (instalado como dependencia normal); solo cambia CÓMO se leen
 * sus ficheros, no de dónde vienen.
 */
import affUrl from '../../node_modules/dictionary-es/index.aff?url'
import dicUrl from '../../node_modules/dictionary-es/index.dic?url'

/**
 * Promesa memoizada del corrector cargado — singleton de módulo. Cargar el
 * diccionario (descarga de los dos ficheros + `new NSpell(...)`, que parsea
 * miles de reglas/palabras) tiene coste no trivial, así que se hace COMO
 * MUCHO una vez por sesión de la app: la primera llamada dispara la carga,
 * cualquier llamada posterior (incluidas las que llegan mientras la primera
 * carga sigue en curso) reciben la MISMA promesa en vez de repetir la
 * descarga/parseo.
 *
 * Si la carga falla (p.ej. el `fetch` de alguno de los dos ficheros falla),
 * se limpia la memoización para que una llamada futura pueda reintentarlo en
 * vez de quedar rota para siempre con una promesa rechazada cacheada.
 */
let cachedSpellerPromise: Promise<NSpell> | null = null

async function loadDictionaryFiles(): Promise<{ aff: string; dic: string }> {
  const [affResponse, dicResponse] = await Promise.all([fetch(affUrl), fetch(dicUrl)])
  if (!affResponse.ok || !dicResponse.ok) {
    throw new Error('No se pudo cargar el diccionario de español (fichero .aff/.dic).')
  }
  const [aff, dic] = await Promise.all([affResponse.text(), dicResponse.text()])
  return { aff, dic }
}

/** Carga (una única vez, cacheada en memoria) el corrector ortográfico de
 *  español. Ver comentario del módulo para el porqué de la estrategia de
 *  carga y el criterio de memoización. */
export function loadSpanishSpellChecker(): Promise<NSpell> {
  if (!cachedSpellerPromise) {
    cachedSpellerPromise = loadDictionaryFiles()
      .then(({ aff, dic }) => new NSpell({ aff, dic }))
      .catch((error: unknown) => {
        cachedSpellerPromise = null
        throw error instanceof Error ? error : new Error(String(error))
      })
  }
  return cachedSpellerPromise
}
