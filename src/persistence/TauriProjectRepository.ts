import { invoke } from '@tauri-apps/api/core'
import { parseOrMigrateProjectDocument, type ProjectDocument } from '../domain'
import type { ProjectRepository } from './ProjectRepository'
import { wrapInvokeError } from './wrapInvokeError'

// Reexportados aquí por compatibilidad: código existente los importa desde
// este módulo. La definición vive en `wrapInvokeError.ts`, compartida con
// `TauriAssetRepository`.
export { PersistenceCommandError, type PersistenceErrorKind } from './wrapInvokeError'

/**
 * Implementación de `ProjectRepository` que delega en los comandos Tauri
 * definidos en `src-tauri/src/commands/mod.rs` (`create_branch_project`,
 * `open_branch_project`, `save_branch_project`).
 *
 * Serializa el `ProjectDocument` a JSON antes de invocar, y valida con
 * `parseOrMigrateProjectDocument` cualquier JSON que Rust devuelva antes de
 * confiar en su forma — Rust lo trata como texto opaco, así que la
 * validación real de la forma del documento vive aquí. Esa misma función es
 * la que reconoce y convierte los `.brunch` guardados con el modelo de nodos
 * anterior (`start`/`content`/`decision`, sin `graph.startNodeId`), ver
 * `src/domain/migration.ts`.
 */
export class TauriProjectRepository implements ProjectRepository {
  async createProject(path: string, document: ProjectDocument): Promise<void> {
    try {
      await invoke('create_branch_project', {
        path,
        documentJson: JSON.stringify(document),
      })
    } catch (error) {
      wrapInvokeError(error)
    }
  }

  async openProject(path: string): Promise<ProjectDocument> {
    try {
      const json = await invoke<string>('open_branch_project', { path })
      const parsed: unknown = JSON.parse(json)
      return parseOrMigrateProjectDocument(parsed)
    } catch (error) {
      wrapInvokeError(error)
    }
  }

  async saveProject(path: string, document: ProjectDocument): Promise<void> {
    try {
      await invoke('save_branch_project', {
        path,
        documentJson: JSON.stringify(document),
      })
    } catch (error) {
      wrapInvokeError(error)
    }
  }
}
