import { invoke } from '@tauri-apps/api/core'
import type { ScormPackageWriter } from './ScormPackageWriter'
import { wrapInvokeError } from './wrapInvokeError'

/**
 * Implementación de `ScormPackageWriter` que delega en el comando Tauri
 * `export_scorm_package` (`src-tauri/src/commands/mod.rs`), que crea el
 * `.zip` en Rust. El lado JS/webview nunca escribe en disco directamente,
 * mismo criterio que el resto de la persistencia.
 *
 * Rechaza con `PersistenceCommandError` (normalmente `kind: 'Io'`) cuando la
 * ruta no es escribible, igual que los repositorios.
 */
export class TauriScormPackageWriter implements ScormPackageWriter {
  async writeScormPackage(path: string, html: string, manifest: string): Promise<void> {
    try {
      await invoke('export_scorm_package', { path, html, manifest })
    } catch (error) {
      wrapInvokeError(error)
    }
  }
}
