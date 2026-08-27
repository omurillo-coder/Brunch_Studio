import { describe, expect, it, vi } from 'vitest'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { defaultAppServices, sanitizeFileName } from '../AppServicesContext'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn().mockResolvedValue('/tmp/elegido.brunch'),
  open: vi.fn().mockResolvedValue(null),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({ label: 'main' })),
}))

describe('sanitizeFileName', () => {
  it('deja intacto un nombre ya válido', () => {
    expect(sanitizeFileName('Mi escenario')).toBe('Mi escenario')
  })

  it('sustituye caracteres no válidos en un nombre de archivo por espacios', () => {
    expect(sanitizeFileName('Ruta/Escenario:¿Final?')).toBe('Ruta Escenario ¿Final')
  })

  it('colapsa espacios repetidos y recorta los extremos', () => {
    expect(sanitizeFileName('  Mi    escenario  ')).toBe('Mi escenario')
  })

  it('recorta puntos y espacios finales (Windows los rechaza)', () => {
    expect(sanitizeFileName('Escenario...')).toBe('Escenario')
  })

  it('devuelve un nombre por defecto si no queda nada aprovechable', () => {
    expect(sanitizeFileName('   ///   ')).toBe('Sin título')
    expect(sanitizeFileName('')).toBe('Sin título')
  })
})

describe('pickSaveProjectPath (diálogo nativo)', () => {
  it('propone el nombre saneado + extensión .brunch como defaultPath', async () => {
    await defaultAppServices.pickSaveProjectPath('Mi: escenario')

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'Mi escenario.brunch' }),
    )
  })

  it('sin nombre sugerido, no fija defaultPath', async () => {
    await defaultAppServices.pickSaveProjectPath()

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: undefined }))
  })
})

/**
 * `getInitialOpenPath` (tarea "abrir un `.brunch` desde Finder/Explorador"):
 * consulta al backend Rust (`take_pending_open_path`, ver
 * `src-tauri/src/open_file.rs`) si ESTA ventana tiene una ruta pendiente de
 * abrir. La lógica pura (qué comando se invoca, con qué argumento, y cómo se
 * trata un fallo) se prueba aquí con `invoke`/`getCurrentWindow` mockeados;
 * la integración real con Rust queda fuera del alcance de `vitest` (ver el
 * informe de la tarea).
 */
describe('getInitialOpenPath (consulta la ruta .brunch pendiente al backend)', () => {
  it('invoca take_pending_open_path con la label de la ventana actual y devuelve la ruta', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('/tmp/desde-finder.brunch')

    const path = await defaultAppServices.getInitialOpenPath()

    expect(invoke).toHaveBeenCalledWith('take_pending_open_path', { windowLabel: 'main' })
    expect(path).toBe('/tmp/desde-finder.brunch')
  })

  it('sin ninguna ruta pendiente, devuelve null', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null)

    expect(await defaultAppServices.getInitialOpenPath()).toBeNull()
  })

  it('sin backend Tauri real detrás (invoke rechaza), devuelve null en vez de propagar el error', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('no Tauri backend'))

    await expect(defaultAppServices.getInitialOpenPath()).resolves.toBeNull()
  })
})

/**
 * `releaseOpenProject` (guarda "mismo `.brunch` en dos ventanas a la vez"):
 * invoca `release_open_project` (ver `src-tauri/src/commands/mod.rs`) para
 * que Rust libere, si la había, la ruta que esta ventana tenía reservada en
 * `OpenProjectRegistry`. La ventana que llama la identifica Tauri
 * automáticamente (parámetro `window: tauri::WebviewWindow` inyectado en el
 * comando), así que no hace falta pasar ninguna label desde aquí — a
 * diferencia de `take_pending_open_path`.
 */
describe('releaseOpenProject (libera el registro de proyecto abierto en Rust)', () => {
  it('invoca release_open_project sin argumentos adicionales', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)

    await defaultAppServices.releaseOpenProject()

    expect(invoke).toHaveBeenCalledWith('release_open_project')
  })

  it('sin backend Tauri real detrás (invoke rechaza), no propaga el error', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('no Tauri backend'))

    await expect(defaultAppServices.releaseOpenProject()).resolves.toBeUndefined()
  })
})
