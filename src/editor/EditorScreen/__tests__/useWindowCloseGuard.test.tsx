import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWindowCloseGuard } from '../useWindowCloseGuard'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'

/**
 * Tests de `useWindowCloseGuard`: el ciclo de vida real de una ventana Tauri
 * (Cmd+Q, botón rojo del sistema…) no se puede simular de verdad en
 * jsdom/vitest — no hay ningún backend Tauri detrás. Se mockean
 * `@tauri-apps/api/window` (`getCurrentWindow`) y `@tauri-apps/plugin-dialog`
 * (`message`) para comprobar la LÓGICA del guardián: qué decide hacer ante
 * cada `saveStatus` y cada respuesta del diálogo, invocando directamente el
 * callback que el hook le pasaría a `onCloseRequested` (mismo patrón que
 * `Canvas.wiring.test.tsx` con `onBeforeDelete`/`onNodesDelete`: capturar el
 * callback real y llamarlo a mano en vez de simular el evento nativo).
 *
 * Lo que queda SOLO para verificación manual: que el sistema operativo de
 * verdad (botón rojo, Cmd+Q, "Cerrar ventana" del menú) dispare
 * `closeRequested`, y que `destroy()` cierre la ventana de verdad sin volver
 * a disparar este mismo listener.
 */

const onCloseRequestedMock = vi.fn()
const destroyMock = vi.fn().mockResolvedValue(undefined)
const closeMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: onCloseRequestedMock,
    destroy: destroyMock,
    close: closeMock,
  }),
}))

const messageMock = vi.fn()
vi.mock('@tauri-apps/plugin-dialog', () => ({
  message: (...args: unknown[]) => messageMock(...args),
}))

/** Monta el hook sin más JSX alrededor: no necesita renderizar nada visible. */
function Harness({ flushPendingSave }: { flushPendingSave: () => Promise<void> }) {
  useWindowCloseGuard({ flushPendingSave })
  return null
}

/** Instala un `UnlistenFn` de pega y devuelve el handler capturado, tal y
 *  como `getCurrentWindow().onCloseRequested(handler)` lo recibiría de
 *  verdad. Espera a que la promesa interna del hook (`setup()`) se resuelva. */
async function captureCloseHandler(): Promise<
  (event: { preventDefault: () => void }) => void | Promise<void>
> {
  await act(async () => {
    await Promise.resolve()
  })
  const handler = onCloseRequestedMock.mock.calls[0]?.[0]
  if (!handler) throw new Error('onCloseRequested no se llamó')
  return handler
}

function fakeEvent() {
  return { preventDefault: vi.fn() }
}

beforeEach(() => {
  resetProjectStore()
  onCloseRequestedMock.mockReset()
  onCloseRequestedMock.mockResolvedValue(vi.fn())
  destroyMock.mockClear()
  closeMock.mockClear()
  messageMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useWindowCloseGuard', () => {
  it('registra el listener onCloseRequested al montarse', async () => {
    render(<Harness flushPendingSave={vi.fn().mockResolvedValue(undefined)} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(onCloseRequestedMock).toHaveBeenCalledTimes(1)
  })

  it('sin cambios pendientes (saveStatus "saved"): no llama al diálogo ni cancela el cierre', async () => {
    useProjectStore.setState({ saveStatus: 'saved' })
    render(<Harness flushPendingSave={vi.fn().mockResolvedValue(undefined)} />)
    const handler = await captureCloseHandler()

    const event = fakeEvent()
    await act(async () => {
      await handler(event)
    })

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(messageMock).not.toHaveBeenCalled()
    expect(destroyMock).not.toHaveBeenCalled()
  })

  it('sin cambios pendientes (saveStatus "idle"): tampoco pregunta nada', async () => {
    useProjectStore.setState({ saveStatus: 'idle' })
    render(<Harness flushPendingSave={vi.fn().mockResolvedValue(undefined)} />)
    const handler = await captureCloseHandler()

    await act(async () => {
      await handler(fakeEvent())
    })

    expect(messageMock).not.toHaveBeenCalled()
  })

  it('con cambios pendientes (saveStatus "saving"): cancela el cierre inicial y pregunta con el diálogo nativo', async () => {
    useProjectStore.setState({ saveStatus: 'saving' })
    messageMock.mockResolvedValue('Cancel')
    render(<Harness flushPendingSave={vi.fn().mockResolvedValue(undefined)} />)
    const handler = await captureCloseHandler()

    const event = fakeEvent()
    await act(async () => {
      await handler(event)
    })

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(messageMock).toHaveBeenCalledTimes(1)
    const [msg, options] = messageMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(msg).toMatch(/cambios sin guardar/i)
    expect(options.buttons).toEqual({
      yes: 'Guardar y salir',
      no: 'Salir sin guardar',
      cancel: 'Cancelar',
    })
  })

  it('un guardado fallido (saveStatus "error") también cuenta como "hay algo sin guardar"', async () => {
    useProjectStore.setState({ saveStatus: 'error' })
    messageMock.mockResolvedValue('Cancel')
    render(<Harness flushPendingSave={vi.fn().mockResolvedValue(undefined)} />)
    const handler = await captureCloseHandler()

    await act(async () => {
      await handler(fakeEvent())
    })

    expect(messageMock).toHaveBeenCalledTimes(1)
  })

  it('"Guardar y salir" (Yes): fuerza flushPendingSave, espera a que termine y cierra con destroy()', async () => {
    useProjectStore.setState({ saveStatus: 'saving' })
    messageMock.mockResolvedValue('Yes')
    let resolveFlush: () => void = () => {}
    const flushPendingSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve
        }),
    )
    render(<Harness flushPendingSave={flushPendingSave} />)
    const handler = await captureCloseHandler()

    let settled = false
    const handlerPromise = (async () => {
      await handler(fakeEvent())
      settled = true
    })()

    // Deja correr microtasks para llegar hasta el `await flushPendingSaveRef.current()`.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(flushPendingSave).toHaveBeenCalledTimes(1)
    expect(destroyMock).not.toHaveBeenCalled()
    expect(settled).toBe(false)

    resolveFlush()
    await act(async () => {
      await handlerPromise
    })

    expect(destroyMock).toHaveBeenCalledTimes(1)
  })

  it('"Salir sin guardar" (No): cierra con destroy() sin llamar a flushPendingSave', async () => {
    useProjectStore.setState({ saveStatus: 'saving' })
    messageMock.mockResolvedValue('No')
    const flushPendingSave = vi.fn().mockResolvedValue(undefined)
    render(<Harness flushPendingSave={flushPendingSave} />)
    const handler = await captureCloseHandler()

    await act(async () => {
      await handler(fakeEvent())
    })

    expect(flushPendingSave).not.toHaveBeenCalled()
    expect(destroyMock).toHaveBeenCalledTimes(1)
  })

  it('"Cancelar" (Cancel): no guarda ni cierra, la ventana se queda abierta', async () => {
    useProjectStore.setState({ saveStatus: 'saving' })
    messageMock.mockResolvedValue('Cancel')
    const flushPendingSave = vi.fn().mockResolvedValue(undefined)
    render(<Harness flushPendingSave={flushPendingSave} />)
    const handler = await captureCloseHandler()

    await act(async () => {
      await handler(fakeEvent())
    })

    expect(flushPendingSave).not.toHaveBeenCalled()
    expect(destroyMock).not.toHaveBeenCalled()
    expect(closeMock).not.toHaveBeenCalled()
  })

  it('se desregistra el listener al desmontarse', async () => {
    const unlisten = vi.fn()
    onCloseRequestedMock.mockResolvedValue(unlisten)
    const { unmount } = render(<Harness flushPendingSave={vi.fn().mockResolvedValue(undefined)} />)
    await act(async () => {
      await Promise.resolve()
    })

    unmount()

    expect(unlisten).toHaveBeenCalledTimes(1)
  })
})
