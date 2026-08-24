/**
 * Contrato de escritura del paquete SCORM 1.2 (`.zip`) exportado
 * (Milestone 3, fase 2).
 *
 * Mismo criterio que `HtmlBundleWriter`: no persiste el `ProjectDocument` ni
 * tiene nada que ver con el formato `.brunch`, solo vuelca a disco (en un
 * `.zip`) dos strings ya construidos en TS — el mismo `index.html` autónomo
 * de `buildHtmlBundle` y el `imsmanifest.xml` de `buildScormManifest`.
 *
 * `path` es siempre una ruta absoluta ya elegida por el usuario (vía
 * `AppServices.pickExportScormPath`, que solo abre un diálogo nativo).
 */
export interface ScormPackageWriter {
  /**
   * Crea en `path` un `.zip` con `html` como `index.html` y `manifest` como
   * `imsmanifest.xml`, sobrescribiendo si ya existe (el diálogo nativo de
   * guardar ya avisó al usuario de la sobrescritura). Rechaza la promesa si
   * la escritura falla.
   */
  writeScormPackage(path: string, html: string, manifest: string): Promise<void>
}
