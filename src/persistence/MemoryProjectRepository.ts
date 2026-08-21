import { parseOrMigrateProjectDocument } from '../domain'
import type { ProjectDocument } from '../domain'
import type { ProjectRepository } from './ProjectRepository'

/**
 * Implementación de `ProjectRepository` respaldada por un `Map` en memoria.
 * Pensada para tests de UI (store, componentes) que no necesitan un backend
 * Tauri real. No persiste nada entre instancias ni entre ejecuciones.
 *
 * Guarda una copia estructurada (vía `structuredClone`) de cada documento
 * en `createProject`/`saveProject`, y devuelve otra copia en `openProject`,
 * para que mutar el objeto devuelto no afecte al estado interno del
 * repositorio — igual que ocurriría al pasar por JSON con el backend real.
 */
export class MemoryProjectRepository implements ProjectRepository {
  private readonly documents = new Map<string, ProjectDocument>()

  async createProject(path: string, document: ProjectDocument): Promise<void> {
    if (this.documents.has(path)) {
      throw new Error(`Ya existe un proyecto en memoria en la ruta "${path}".`)
    }
    this.documents.set(path, structuredClone(document))
  }

  async openProject(path: string): Promise<ProjectDocument> {
    const document = this.documents.get(path)
    if (!document) {
      throw new Error(`No existe ningún proyecto en memoria en la ruta "${path}".`)
    }
    // Mismo tratamiento que `TauriProjectRepository.openProject`: el
    // documento pasa por `parseOrMigrateProjectDocument`, así que un
    // documento con el modelo de nodos anterior guardado aquí (p.ej. una
    // fixture de test que simula un `.brunch` antiguo) se migra igual que
    // uno leído de disco. Para un documento ya en la forma nueva es una
    // validación sin efectos.
    return parseOrMigrateProjectDocument(structuredClone(document))
  }

  async saveProject(path: string, document: ProjectDocument): Promise<void> {
    if (!this.documents.has(path)) {
      throw new Error(`No existe ningún proyecto en memoria en la ruta "${path}".`)
    }
    this.documents.set(path, structuredClone(document))
  }
}
