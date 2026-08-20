import { describe, expect, it, vi } from 'vitest'
import { save } from '@tauri-apps/plugin-dialog'
import { defaultAppServices, sanitizeFileName } from '../AppServicesContext'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn().mockResolvedValue('/tmp/elegido.brunch'),
  open: vi.fn().mockResolvedValue(null),
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
