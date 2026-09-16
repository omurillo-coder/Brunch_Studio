/**
 * ---------------------------------------------------------------------------
 * Lista de proyectos recientes, persistida en `localStorage`
 * ---------------------------------------------------------------------------
 *
 * Preferencia de la APP (no del documento `.brunch`), mismo criterio que
 * `src/editor/uiPreferences.ts`: qué archivos se han abierto/creado
 * recientemente EN ESTA MÁQUINA, para poder reabrirlos con un clic desde
 * "Recientes" en `HomeScreen` sin pasar por el diálogo nativo "Abrir
 * proyecto" cada vez. Tolerante a un `localStorage` inaccesible (modo
 * privado, cuota agotada, entorno de test sin `window`...): si falla la
 * lectura o la escritura, se usa/ignora en silencio — es una comodidad, no
 * un dato crítico, y no debe romper la pantalla inicial.
 *
 * `recordRecentProject` se llama desde los TRES sitios que pueden dejar la
 * app con un `.brunch` recién abierto o creado: "Nuevo proyecto"/"Abrir
 * proyecto"/"Importar .twee" en `HomeScreen.tsx`, y la ruta inicial recibida
 * de Finder/Explorador en `App.tsx` (ver el comentario de `openExistingProject`
 * sobre por qué esos dos son los únicos puntos que abren un `.brunch`).
 */

export interface RecentProjectEntry {
  path: string
  name: string
  lastOpenedAt: string
}

const RECENT_PROJECTS_KEY = 'brunch-studio:recent-projects'

/** Cuántas entradas como máximo se recuerdan — las más antiguas se
 *  descartan al añadir una nueva por encima de este límite. */
export const MAX_RECENT_PROJECTS = 8

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // localStorage inaccesible: lista no persistida, sin romper la app.
  }
}

/** Corrección de revisión de código: antes solo comprobaba `typeof === 'string'`,
 *  así que una entrada con `path`/`name` vacíos (un `localStorage` editado a
 *  mano, o un futuro bug que llegara a llamar a `recordRecentProject` con una
 *  cadena vacía) sobrevivía al filtro — `HomeScreen` pintaría una fila en
 *  blanco cuyo clic intentaría abrir la ruta `''`. `path`/`name` no vacíos
 *  (tras recortar espacios) son ahora parte de la forma válida. */
function isRecentProjectEntry(value: unknown): value is RecentProjectEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RecentProjectEntry).path === 'string' &&
    (value as RecentProjectEntry).path.trim() !== '' &&
    typeof (value as RecentProjectEntry).name === 'string' &&
    (value as RecentProjectEntry).name.trim() !== '' &&
    typeof (value as RecentProjectEntry).lastOpenedAt === 'string'
  )
}

/** Lista de recientes, más nuevo primero. Tolerante a un valor corrupto o
 *  con forma inesperada (versión antigua del formato, edición manual del
 *  `localStorage`...): lista vacía en vez de lanzar. */
export function loadRecentProjects(): RecentProjectEntry[] {
  const raw = readLocalStorage(RECENT_PROJECTS_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecentProjectEntry)
  } catch {
    return []
  }
}

/**
 * Registra `path`/`name` como el proyecto abierto más recientemente.
 *
 * Si `path` ya estaba en la lista (se reabrió un proyecto ya reciente), esa
 * entrada vieja se quita primero — no queda duplicada, y "sube" a la
 * primera posición con la fecha de apertura nueva. La lista se recorta a
 * `MAX_RECENT_PROJECTS` para no crecer sin límite.
 */
export function recordRecentProject(path: string, name: string): void {
  const withoutThisPath = loadRecentProjects().filter((entry) => entry.path !== path)
  const next = [{ path, name, lastOpenedAt: new Date().toISOString() }, ...withoutThisPath].slice(
    0,
    MAX_RECENT_PROJECTS,
  )
  writeLocalStorage(RECENT_PROJECTS_KEY, JSON.stringify(next))
}

/** Quita `path` de la lista — se usa cuando reabrirlo desde "Recientes"
 *  falla porque el archivo ya no existe/no es accesible (ver `HomeScreen.tsx`):
 *  no tiene sentido dejar una entrada que nunca va a abrir. */
export function removeRecentProject(path: string): void {
  const next = loadRecentProjects().filter((entry) => entry.path !== path)
  writeLocalStorage(RECENT_PROJECTS_KEY, JSON.stringify(next))
}
