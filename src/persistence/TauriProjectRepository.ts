import { invoke } from '@tauri-apps/api/core'
import { ProjectDocumentSchema, type ProjectDocument } from '../domain'
import type { ProjectRepository } from './ProjectRepository'

/**
 * Forma en la que Rust serializa `PersistenceError` (ver
 * `src-tauri/src/persistence/error.rs`): tag adyacente `kind` + `content`.
 * Se expone para que quien capture el rechazo de una promesa pueda hacer
 * `error instanceof PersistenceCommandError` y mirar `error.kind`.
 */
export type PersistenceErrorKind =
  | 'NotFound'
  | 'AlreadyExists'
  | 'InvalidFile'
  | 'UnsupportedSchemaVersion'
  | 'InvalidDocument'
  | 'Io'
  | 'Sqlite'

export class PersistenceCommandError extends Error {
  readonly kind: PersistenceErrorKind
  readonly content: unknown

  constructor(kind: PersistenceErrorKind, content: unknown) {
    super(`[${kind}] ${JSON.stringify(content)}`)
    this.name = 'PersistenceCommandError'
    this.kind = kind
    this.content = content
  }
}

function isPersistenceErrorShape(
  value: unknown,
): value is { kind: PersistenceErrorKind; content: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof (value as { kind: unknown }).kind === 'string'
  )
}

/** Envuelve un rechazo de `invoke()` en un `PersistenceCommandError` cuando tiene la forma esperada. */
function wrapInvokeError(error: unknown): never {
  if (isPersistenceErrorShape(error)) {
    throw new PersistenceCommandError(error.kind, error.content)
  }
  throw error
}

/**
 * Implementación de `ProjectRepository` que delega en los comandos Tauri
 * definidos en `src-tauri/src/commands/mod.rs` (`create_branch_project`,
 * `open_branch_project`, `save_branch_project`).
 *
 * Serializa el `ProjectDocument` a JSON antes de invocar, y valida con
 * `ProjectDocumentSchema.parse` cualquier JSON que Rust devuelva antes de
 * confiar en su forma — Rust lo trata como texto opaco, así que la
 * validación real de la forma del documento vive aquí.
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
      return ProjectDocumentSchema.parse(parsed)
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
