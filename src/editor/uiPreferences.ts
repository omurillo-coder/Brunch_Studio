/**
 * ---------------------------------------------------------------------------
 * Preferencias de interfaz persistidas en `localStorage`
 * ---------------------------------------------------------------------------
 *
 * Preferencias puramente de la APP (no del proyecto `.brunch`): visibilidad
 * del panel izquierdo y ancho del Inspector. Se guardan en `localStorage`
 * para que se recuerden entre sesiones, pero NUNCA en el documento — abrir el
 * mismo `.brunch` en otra máquina no debe cambiar cómo se ve, solo cómo lo
 * dejó el usuario en ESTA máquina/navegador.
 *
 * Todas las funciones son tolerantes a un `localStorage` inaccesible (modo
 * privado, cuota agotada, entorno de test sin `window`...): si falla la
 * lectura o la escritura, se usa/ignora en silencio en vez de romper la app,
 * porque esto es una preferencia de comodidad, no un dato crítico.
 */

const LEFT_PANEL_VISIBLE_KEY = 'brunch-studio:left-panel-visible'
const INSPECTOR_WIDTH_KEY = 'brunch-studio:inspector-width'

/** Ancho mínimo del Inspector, en píxeles. */
export const INSPECTOR_MIN_WIDTH = 280

/** Ancho por defecto del Inspector (el que ya usaba `Inspector.module.css`
 *  antes de ser redimensionable). */
export const INSPECTOR_DEFAULT_WIDTH = 280

/**
 * Ancho máximo del Inspector para un ancho de ventana dado: la mitad del
 * ancho de la ventana, redondeado. Función pura y testeable sin depender de
 * `window` en el llamador.
 */
export function inspectorMaxWidth(windowWidth: number): number {
  return Math.round(windowWidth / 2)
}

/**
 * Ajusta `width` a los límites válidos para un ancho de ventana dado:
 * nunca por debajo de `INSPECTOR_MIN_WIDTH`, nunca por encima de
 * `inspectorMaxWidth(windowWidth)`. Si el máximo calculado quedara por
 * debajo del mínimo (ventana muy estrecha), gana el mínimo: es preferible un
 * panel algo ancho en una ventana diminuta a uno de ancho negativo o cero.
 */
export function clampInspectorWidth(width: number, windowWidth: number): number {
  const max = Math.max(inspectorMaxWidth(windowWidth), INSPECTOR_MIN_WIDTH)
  return Math.min(Math.max(width, INSPECTOR_MIN_WIDTH), max)
}

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
    // localStorage inaccesible: preferencia no persistida, sin romper la app.
  }
}

/** Visibilidad del panel izquierdo. `true` (visible) si nunca se guardó
 *  nada — comportamiento de fábrica de antes de esta preferencia. */
export function loadLeftPanelVisible(): boolean {
  return readLocalStorage(LEFT_PANEL_VISIBLE_KEY) !== 'false'
}

export function saveLeftPanelVisible(visible: boolean): void {
  writeLocalStorage(LEFT_PANEL_VISIBLE_KEY, String(visible))
}

/** Ancho guardado del Inspector, ya ajustado a los límites vigentes para el
 *  ancho de ventana actual. `INSPECTOR_DEFAULT_WIDTH` si nunca se guardó
 *  nada o el valor guardado no es un número válido. */
export function loadInspectorWidth(windowWidth: number): number {
  const raw = readLocalStorage(INSPECTOR_WIDTH_KEY)
  const parsed = raw !== null ? Number(raw) : NaN
  const width = Number.isFinite(parsed) ? parsed : INSPECTOR_DEFAULT_WIDTH
  return clampInspectorWidth(width, windowWidth)
}

export function saveInspectorWidth(width: number): void {
  writeLocalStorage(INSPECTOR_WIDTH_KEY, String(width))
}
