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
}
