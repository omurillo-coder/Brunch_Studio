/**
 * Contrato de escritura de un documento de texto plano/Markdown exportado
 * (petición de usuario: "documento para revisión con IA", ver
 * `src/export/aiReviewExport.ts`).
 *
 * Mismo criterio que `HtmlBundleWriter`, del que se separa deliberadamente
 * en vez de reutilizarse pese a que ambos delegan en el mismo comando Rust
 * genérico (`export_text_document`, que a su vez reutiliza tal cual la
 * misma escritura que `export_html_bundle`, ver su comentario): el nombre
 * del método/contrato debe ser honesto sobre el TIPO de contenido que
 * escribe, no sobre cómo está implementado por debajo — quien lea
 * `AppServices` no debería tener que saber que, por dentro, ambos acaban en
 * el mismo `std::fs::write`.
 *
 * `path` es siempre una ruta absoluta ya elegida por el usuario (vía
 * `AppServices.pickExportAiReviewPath`, que solo abre un diálogo nativo).
 */
export interface TextDocumentWriter {
  /**
   * Escribe `content` en `path`, sobrescribiendo si ya existe (el diálogo
   * nativo de guardar ya avisó al usuario de la sobrescritura). Rechaza la
   * promesa si la escritura falla.
   */
  writeTextDocument(path: string, content: string): Promise<void>
}
