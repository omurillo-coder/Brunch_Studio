import { invoke } from '@tauri-apps/api/core'
import type { TextDocumentWriter } from './TextDocumentWriter'
import { wrapInvokeError } from './wrapInvokeError'

/**
 * Implementación de `TextDocumentWriter` que delega en el comando Tauri
 * `export_text_document` (`src-tauri/src/commands/mod.rs`), que a su vez
 * reutiliza el mismo `std::fs::write` que `export_html_bundle` — ver el
 * comentario de `TextDocumentWriter` para el porqué de mantener el contrato
 * TS aparte pese a esa implementación compartida. El lado JS/webview nunca
 * escribe en disco directamente, mismo criterio que el resto de la
 * persistencia.
 *
 * Rechaza con `PersistenceCommandError` (normalmente `kind: 'Io'`) cuando la
 * ruta no es escribible, igual que `TauriHtmlBundleWriter`.
 */
export class TauriTextDocumentWriter implements TextDocumentWriter {
  async writeTextDocument(path: string, content: string): Promise<void> {
    try {
      await invoke('export_text_document', { path, content })
    } catch (error) {
      wrapInvokeError(error)
    }
  }
}
