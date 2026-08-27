import { message } from '@tauri-apps/plugin-dialog'
import { PersistenceCommandError } from '../persistence'

/** Mensaje mostrado en el diálogo nativo de aviso. */
const ALREADY_OPEN_ELSEWHERE_MESSAGE = 'Este proyecto ya está abierto en otra ventana.'

/**
 * Trata el caso específico de intentar abrir un `.brunch` que ya está
 * abierto en otra ventana (`PersistenceCommandError` con
 * `kind === 'AlreadyOpenElsewhere'` — ver la guarda del lado Rust en
 * `src-tauri/src/commands/mod.rs::open_branch_project` y
 * `src-tauri/src/open_registry.rs`).
 *
 * Punto único compartido por TODOS los flujos que pueden toparse con este
 * error al abrir un `.brunch` ya existente: "Abrir proyecto" en
 * `HomeScreen.tsx` y la ruta inicial recibida de Finder/Explorador en
 * `App.tsx`. Ambos llaman a esta función en su `catch`, ANTES de caer en su
 * tratamiento de error genérico.
 *
 * Si `error` es ese caso concreto: muestra el mismo diálogo nativo de aviso
 * (`message()` de `@tauri-apps/plugin-dialog`, mismo patrón que ya usa
 * `useWindowCloseGuard.ts` para el aviso de "cambios sin guardar" al
 * cerrar) y devuelve `true` — quien llama no debe navegar a `EditorScreen`
 * ni mostrar su propio mensaje de error genérico. La ventana donde el
 * proyecto ya está abierto pasa a primer plano por su cuenta, en Rust
 * (`window.set_focus()`), antes de que este error llegue aquí — no hace
 * falta nada más en el frontend para eso.
 *
 * Para cualquier otro error devuelve `false` sin hacer nada: quien llama
 * sigue con su propio tratamiento (mensaje genérico de "no se ha podido
 * abrir…").
 *
 * Envuelto en `try/catch` alrededor de `message()`: sin backend Tauri real
 * detrás (tests en jsdom, `npm run dev` fuera de un webview Tauri), no debe
 * tirar la app abajo — mismo criterio de robustez que
 * `useWindowCloseGuard.ts`/`getInitialOpenPathFromTauri`.
 */
export async function showAlreadyOpenElsewhereWarningIfApplicable(error: unknown): Promise<boolean> {
  if (!(error instanceof PersistenceCommandError) || error.kind !== 'AlreadyOpenElsewhere') {
    return false
  }

  try {
    await message(ALREADY_OPEN_ELSEWHERE_MESSAGE, {
      title: 'Proyecto ya abierto',
      kind: 'warning',
    })
  } catch (dialogError) {
    console.warn(
      '[showAlreadyOpenElsewhereWarningIfApplicable] No se pudo mostrar el diálogo nativo de aviso.',
      dialogError,
    )
  }

  return true
}
