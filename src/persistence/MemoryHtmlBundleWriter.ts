import type { HtmlBundleWriter } from './HtmlBundleWriter'

/**
 * Implementación de `HtmlBundleWriter` en memoria para tests: guarda lo
 * "escrito" en un `Map` en vez de tocar el disco, y permite simular un fallo
 * de escritura con `failNextWrite()`.
 *
 * Mismo papel que `MemoryProjectRepository`/`MemoryAssetRepository`: que los
 * tests de UI puedan ejercitar el flujo completo de exportación sin backend
 * Tauri.
 */
export class MemoryHtmlBundleWriter implements HtmlBundleWriter {
  private readonly files = new Map<string, string>()
  private shouldFail = false

  /** Hace que el siguiente `writeHtmlBundle` rechace en vez de escribir. */
  failNextWrite(): void {
    this.shouldFail = true
  }

  /** Contenido escrito en `path`, o `undefined` si no se escribió nada ahí. */
  read(path: string): string | undefined {
    return this.files.get(path)
  }

  /** Rutas escritas hasta ahora, en orden de escritura. */
  writtenPaths(): string[] {
    return [...this.files.keys()]
  }

  async writeHtmlBundle(path: string, html: string): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false
      throw new Error(`MemoryHtmlBundleWriter: fallo simulado al escribir "${path}".`)
    }
    this.files.set(path, html)
  }
}
