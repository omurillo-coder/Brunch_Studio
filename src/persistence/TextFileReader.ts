/**
 * Contrato de lectura de texto de un archivo arbitrario del sistema de
 * ficheros, en una ruta ya elegida por el usuario (p.ej. mediante el diálogo
 * nativo `pickImportTweePath` de `AppServices`).
 *
 * A diferencia de `ProjectRepository`, no asume nada sobre el formato del
 * archivo: solo lee su contenido como texto. Pensado para el importador de
 * `.twee` (ver `src/import/twee`), pero deliberadamente genérico por si en el
 * futuro hace falta leer texto de otro tipo de archivo arbitrario.
 */
export interface TextFileReader {
  /**
   * Lee el contenido de texto de `path`. Debe rechazar si la ruta no existe
   * o no se puede leer como texto (p.ej. no es UTF-8 válido).
   */
  readTextFile(path: string): Promise<string>
}
