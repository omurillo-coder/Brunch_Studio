/**
 * Forma en la que Rust serializa `PersistenceError` (ver
 * `src-tauri/src/persistence/error.rs`): tag adyacente `kind` + `content`.
 * Se expone para que quien capture el rechazo de una promesa pueda hacer
 * `error instanceof PersistenceCommandError` y mirar `error.kind`.
 *
 * Compartido por todos los repositorios respaldados por comandos Tauri
 * (`TauriProjectRepository`, `TauriAssetRepository`, …): todos delegan en el
 * mismo `PersistenceError` de Rust, así que envuelven sus rechazos igual.
 */
export type PersistenceErrorKind =
  | 'NotFound'
  | 'AlreadyExists'
  | 'InvalidFile'
  | 'UnsupportedSchemaVersion'
  | 'InvalidDocument'
  | 'UnsupportedAssetType'
  | 'AssetTooLarge'
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
export function wrapInvokeError(error: unknown): never {
  if (isPersistenceErrorShape(error)) {
    throw new PersistenceCommandError(error.kind, error.content)
  }
  throw error
}
