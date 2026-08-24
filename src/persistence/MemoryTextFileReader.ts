import type { TextFileReader } from './TextFileReader'

/**
 * Implementación de `TextFileReader` respaldada por un `Map` en memoria.
 * Pensada para tests que no necesitan un backend Tauri real — igual que
 * `MemoryAssetRepository.registerSourceFile`, quien use este lector en un
 * test decide qué contenido "tiene" cada ruta mediante `registerFile` antes
 * de llamar a `readTextFile`.
 */
export class MemoryTextFileReader implements TextFileReader {
  private readonly files = new Map<string, string>()

  /** Registra qué contenido debe "leer" una ruta dada al llamar a `readTextFile`. */
  registerFile(path: string, content: string): void {
    this.files.set(path, content)
  }

  async readTextFile(path: string): Promise<string> {
    const content = this.files.get(path)
    if (content === undefined) {
      throw new Error(
        `MemoryTextFileReader: no se registró contenido para "${path}" (usa registerFile antes de readTextFile).`,
      )
    }
    return content
  }
}
