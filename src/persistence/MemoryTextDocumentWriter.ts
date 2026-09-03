import type { TextDocumentWriter } from './TextDocumentWriter'

/**
 * Implementación de `TextDocumentWriter` en memoria para tests: mismo papel
 * que `MemoryHtmlBundleWriter`, del que copia el diseño (guarda lo "escrito"
 * en un `Map`, permite simular un fallo con `failNextWrite()`).
 */
export class MemoryTextDocumentWriter implements TextDocumentWriter {
  private readonly files = new Map<string, string>()
  private shouldFail = false

  /** Hace que el siguiente `writeTextDocument` rechace en vez de escribir. */
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

  async writeTextDocument(path: string, content: string): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false
      throw new Error(`MemoryTextDocumentWriter: fallo simulado al escribir "${path}".`)
    }
    this.files.set(path, content)
  }
}
