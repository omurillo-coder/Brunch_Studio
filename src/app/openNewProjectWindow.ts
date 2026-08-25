import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

/**
 * Abre una ventana nueva e independiente de la aplicación — el equivalente
 * a abrir "Brunch Studio" por segunda vez.
 *
 * Cada ventana de Tauri tiene su propio contexto de JavaScript (su propio
 * árbol de React, su propia instancia de `useProjectStore`), así que no hay
 * nada que compartir ni sincronizar con la ventana desde la que se abre:
 * la nueva arranca sola en su propia `HomeScreen`, tal cual lo hace la
 * ventana principal al iniciar la app.
 *
 * `url: '/'` apunta a la misma página raíz que ya carga la ventana
 * principal (el `index.html` de `frontendDist`/`devUrl`, ver
 * `src-tauri/tauri.conf.json`): no hace falta ninguna ruta especial para
 * "reabrir en blanco", la app siempre arranca en `HomeScreen` mientras no
 * haya ningún proyecto abierto en el estado de esa ventana.
 */
export function openNewProjectWindow(): WebviewWindow {
  // Prefijo "project-" deliberado: coincide con el patrón glob
  // "project-*" añadido a `windows` en `src-tauri/capabilities/default.json`
  // junto a "main". Sin esa entrada, la ventana nueva no heredaría ningún
  // permiso (ni `core:default`, ni `dialog:default`, ni los comandos propios
  // de la app) porque las capabilities de Tauri 2 son por ventana y no se
  // heredan automáticamente de quien la creó.
  const label = `project-${crypto.randomUUID()}`
  return new WebviewWindow(label, {
    url: '/',
    title: 'Brunch Studio',
    width: 800,
    height: 600,
  })
}
