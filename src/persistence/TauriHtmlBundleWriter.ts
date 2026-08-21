import { invoke } from '@tauri-apps/api/core'
import type { HtmlBundleWriter } from './HtmlBundleWriter'
import { wrapInvokeError } from './wrapInvokeError'

/**
 * Implementación de `HtmlBundleWriter` que delega en el comando Tauri
 * `export_html_bundle` (`src-tauri/src/commands/mod.rs`), que hace el
 * `std::fs::write` en Rust. El lado JS/webview nunca escribe en disco
 * directamente, mismo criterio que el resto de la persistencia.
 *
 * Rechaza con `PersistenceCommandError` (normalmente `kind: 'Io'`) cuando la
 * ruta no es escribible, igual que los repositorios.
 */
export class TauriHtmlBundleWriter implements HtmlBundleWriter {
  async writeHtmlBundle(path: string, html: string): Promise<void> {
    try {
      await invoke('export_html_bundle', { path, html })
    } catch (error) {
      wrapInvokeError(error)
    }
  }
}
