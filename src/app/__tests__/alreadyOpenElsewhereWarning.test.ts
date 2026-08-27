import { describe, expect, it, vi, afterEach } from 'vitest'
import { PersistenceCommandError } from '../../persistence'
import { showAlreadyOpenElsewhereWarningIfApplicable } from '../alreadyOpenElsewhereWarning'

const messageMock = vi.fn()
vi.mock('@tauri-apps/plugin-dialog', () => ({
  message: (...args: unknown[]) => messageMock(...args),
}))

afterEach(() => {
  messageMock.mockReset()
})

describe('showAlreadyOpenElsewhereWarningIfApplicable', () => {
  it('con un PersistenceCommandError de kind AlreadyOpenElsewhere: muestra el diálogo nativo y devuelve true', async () => {
    messageMock.mockResolvedValue(undefined)
    const error = new PersistenceCommandError('AlreadyOpenElsewhere', '/tmp/proyecto.brunch')

    const handled = await showAlreadyOpenElsewhereWarningIfApplicable(error)

    expect(handled).toBe(true)
    expect(messageMock).toHaveBeenCalledTimes(1)
    const [msg, options] = messageMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(msg).toMatch(/ya está abierto en otra ventana/i)
    expect(options.kind).toBe('warning')
  })

  it('con un PersistenceCommandError de OTRO kind: no muestra el diálogo y devuelve false', async () => {
    const error = new PersistenceCommandError('NotFound', '/tmp/no-existe.brunch')

    const handled = await showAlreadyOpenElsewhereWarningIfApplicable(error)

    expect(handled).toBe(false)
    expect(messageMock).not.toHaveBeenCalled()
  })

  it('con un error que no es PersistenceCommandError: no muestra el diálogo y devuelve false', async () => {
    const handled = await showAlreadyOpenElsewhereWarningIfApplicable(new Error('cualquier otro fallo'))

    expect(handled).toBe(false)
    expect(messageMock).not.toHaveBeenCalled()
  })

  it('con undefined/otro valor no-Error: no muestra el diálogo y devuelve false', async () => {
    expect(await showAlreadyOpenElsewhereWarningIfApplicable(undefined)).toBe(false)
    expect(await showAlreadyOpenElsewhereWarningIfApplicable('texto plano')).toBe(false)
    expect(messageMock).not.toHaveBeenCalled()
  })

  it('sin backend Tauri real detrás (message rechaza): sigue devolviendo true sin propagar el error', async () => {
    messageMock.mockRejectedValue(new Error('no Tauri backend'))
    const error = new PersistenceCommandError('AlreadyOpenElsewhere', '/tmp/proyecto.brunch')

    await expect(showAlreadyOpenElsewhereWarningIfApplicable(error)).resolves.toBe(true)
  })
})
