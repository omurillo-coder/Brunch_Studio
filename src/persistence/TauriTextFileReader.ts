import { invoke } from '@tauri-apps/api/core'
import type { TextFileReader } from './TextFileReader'
import { wrapInvokeError } from './wrapInvokeError'

/**
 * Implementación de `TextFileReader` que delega en el comando Tauri
 * `read_text_file` (`src-tauri/src/commands/mod.rs`), que a su vez lee bytes
 * UTF-8 en Rust y los devuelve tal cual — el frontend nunca lee el disco
 * directamente.
 */
export class TauriTextFileReader implements TextFileReader {
  async readTextFile(path: string): Promise<string> {
    try {
      return await invoke<string>('read_text_file', { path })
    } catch (error) {
      wrapInvokeError(error)
    }
  }
}
