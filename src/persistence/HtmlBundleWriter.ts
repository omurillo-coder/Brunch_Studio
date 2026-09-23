/**
 * Contrato de escritura del `index.html` autónomo exportado (Milestone 3,
 * fase 1).
 *
 * Deliberadamente separado de `ProjectRepository`: no persiste el
 * `ProjectDocument` ni tiene nada que ver con el formato `.brunch` — solo
 * volcar a disco un string ya construido en TS (`buildHtmlBundle` en
 * `src/export/htmlBundle.ts`). Mantenerlo aparte evita que el contrato del
 * proyecto crezca con operaciones que no son "abrir/guardar el documento", y
 * deja la puerta abierta a que la fase de SCORM añada su propio escritor
 * (paquete `.zip`) sin tocar este.
 *
 * `path` es siempre una ruta absoluta ya elegida por el usuario (vía
 * `AppServices.pickExportHtmlPath`, que solo abre un diálogo nativo).
 */
export interface HtmlBundleWriter {
  /**
   * Escribe `html` en `path`, sobrescribiendo si ya existe (el diálogo
   * nativo de guardar ya avisó al usuario de la sobrescritura). Rechaza la
   * promesa si la escritura falla.
   */
  writeHtmlBundle(path: string, html: string): Promise<void>

  /**
   * Igual que `writeHtmlBundle`, pero empaqueta `html` como un `.zip` con
   * una única entrada en la raíz, `index.html` — petición de usuario ("la
   * versión HTML quiero que me la des comprimida en ZIP ya"): lo usa el
   * flujo "Exportar HTML" (`useHtmlExport.ts`) en vez de `writeHtmlBundle`,
   * un `.zip` es más fácil de enviar por correo/mensajería que un `.html`
   * suelto. El resto de exportaciones que producen un `index.html`
   * autónomo (revisión profes) siguen usando `writeHtmlBundle` tal cual.
   */
  writeHtmlZipBundle(path: string, html: string): Promise<void>
}
