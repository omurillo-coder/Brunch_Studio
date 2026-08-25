import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeMenuActions } from '../useNativeMenuActions'

/**
 * `listen()` real (`@tauri-apps/api/event`) solo funciona dentro de un
 * webview Tauri de verdad — inexistente en jsdom. Se mockea con un registro
 * en memoria de `evento -> callbacks`, controlable desde el test con
 * `emit(evento)`, para poder simular "el menú nativo se ha pulsado" sin
 * ningún backend Tauri real. Mismo criterio que el mock de
 * `@tauri-apps/api/webviewWindow` que ya usaba `Topbar.test.tsx` para
 * "Nueva ventana" antes de que ese botón se moviera aquí.
 */
const listeners = new Map<string, Set<() => void>>()

function emit(event: string) {
  const callbacks = listeners.get(event)
  if (!callbacks) return
  callbacks.forEach((callback) => callback())
}

const openNewProjectWindowMock = vi.fn()
vi.mock('../../../app/openNewProjectWindow', () => ({
  openNewProjectWindow: () => openNewProjectWindowMock(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event: string, callback: () => void) => {
    let callbacks = listeners.get(event)
    if (!callbacks) {
      callbacks = new Set()
      listeners.set(event, callbacks)
    }
    callbacks.add(callback)
    return Promise.resolve(() => {
      callbacks?.delete(callback)
    })
  }),
}))

/** Componente mínimo para montar el hook bajo prueba (no puede llamarse fuera de un componente). */
function HookHost({ onCloseProject }: { onCloseProject: () => void }) {
  useNativeMenuActions({ onCloseProject })
  return null
}

beforeEach(() => {
  listeners.clear()
  openNewProjectWindowMock.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useNativeMenuActions', () => {
  it('el evento "menu-new-window" llama a openNewProjectWindow()', async () => {
    render(<HookHost onCloseProject={vi.fn()} />)
    // Los listeners se registran de forma asíncrona (`await listen(...)`
    // dentro del hook): se deja pasar un tick antes de emitir.
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      emit('menu-new-window')
    })

    expect(openNewProjectWindowMock).toHaveBeenCalledTimes(1)
  })

  it('el evento "menu-close-project" llama a onCloseProject', async () => {
    const onCloseProject = vi.fn()
    render(<HookHost onCloseProject={onCloseProject} />)
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      emit('menu-close-project')
    })

    expect(onCloseProject).toHaveBeenCalledTimes(1)
    expect(openNewProjectWindowMock).not.toHaveBeenCalled()
  })

  it('usa siempre la versión más reciente de onCloseProject, sin reinstalar el listener', async () => {
    const firstHandler = vi.fn()
    const { rerender } = render(<HookHost onCloseProject={firstHandler} />)
    await act(async () => {
      await Promise.resolve()
    })

    const secondHandler = vi.fn()
    rerender(<HookHost onCloseProject={secondHandler} />)

    act(() => {
      emit('menu-close-project')
    })

    expect(firstHandler).not.toHaveBeenCalled()
    expect(secondHandler).toHaveBeenCalledTimes(1)
  })

  it('al desmontar, deja de reaccionar a los eventos', async () => {
    const onCloseProject = vi.fn()
    const { unmount } = render(<HookHost onCloseProject={onCloseProject} />)
    await act(async () => {
      await Promise.resolve()
    })

    unmount()

    act(() => {
      emit('menu-close-project')
      emit('menu-new-window')
    })

    expect(onCloseProject).not.toHaveBeenCalled()
    expect(openNewProjectWindowMock).not.toHaveBeenCalled()
  })
})
