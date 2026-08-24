import type { ScormPackageWriter } from './ScormPackageWriter'

/**
 * Implementación de `ScormPackageWriter` en memoria para tests: guarda lo
 * "escrito" en un `Map` en vez de tocar el disco, y permite simular un fallo
 * de escritura con `failNextWrite()`.
 *
 * Mismo papel que `MemoryHtmlBundleWriter`: que los tests de UI puedan
 * ejercitar el flujo completo de exportación SCORM sin backend Tauri.
 */
export class MemoryScormPackageWriter implements ScormPackageWriter {
  private readonly files = new Map<string, { html: string; manifest: string }>()
  private shouldFail = false

  /** Hace que el siguiente `writeScormPackage` rechace en vez de escribir. */
  failNextWrite(): void {
    this.shouldFail = true
  }

  /** Contenido escrito en `path`, o `undefined` si no se escribió nada ahí. */
  read(path: string): { html: string; manifest: string } | undefined {
    return this.files.get(path)
  }

  /** Rutas escritas hasta ahora, en orden de escritura. */
  writtenPaths(): string[] {
    return [...this.files.keys()]
  }

  async writeScormPackage(path: string, html: string, manifest: string): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false
      throw new Error(`MemoryScormPackageWriter: fallo simulado al escribir "${path}".`)
    }
    this.files.set(path, { html, manifest })
  }
}
