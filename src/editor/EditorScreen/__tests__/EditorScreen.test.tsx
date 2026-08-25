import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { EditorScreen } from '../EditorScreen'
import { AppServicesProvider } from '../../../app/AppServicesContext'
import { MemoryAssetRepository, MemoryProjectRepository } from '../../../persistence'
import type { ProjectRepository } from '../../../persistence'
import { createProject } from '../../../domain'
import { AUTOSAVE_DEBOUNCE_MS } from '../useAutosave'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'

/**
 * Integración mínima fase 8: `EditorScreen` conmuta entre el shell de
 * edición normal (Topbar/LeftPanel/Canvas/Inspector) y el Player según
 * `previewMode`, sin que ambos convivan nunca en pantalla.
 *
 * A partir de fase 9, `EditorScreen` requiere `filePath` (lo usa
 * `useAutosave`) y estos tests se envuelven en `AppServicesProvider` con un
 * `MemoryProjectRepository` en vez del `TauriProjectRepository` real por
 * defecto, para que el autoguardado de fondo no intente invocar comandos
 * Tauri inexistentes en este entorno de test.
 */

const TEST_FILE_PATH = '/tmp/editor-screen-test.brunch'

function renderEditorScreen(onCloseProject: () => void = vi.fn()) {
  return render(
    <AppServicesProvider services={{ repository: new MemoryProjectRepository() }}>
      <EditorScreen filePath={TEST_FILE_PATH} onCloseProject={onCloseProject} />
    </AppServicesProvider>,
  )
}

/** Repositorio de pega: mismos métodos que `ProjectRepository`, todos mockeados. */
function createStubRepository(overrides: Partial<ProjectRepository> = {}): ProjectRepository & {
  saveProject: Mock
} {
  return {
    createProject: vi.fn().mockResolvedValue(undefined),
    openProject: vi.fn().mockResolvedValue(createProject('stub')),
    saveProject: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as ProjectRepository & { saveProject: Mock }
}

beforeEach(() => {
  resetProjectStore()
})

describe('EditorScreen — conmutación shell/Player (previewMode)', () => {
  it('con previewMode en false, muestra el shell normal y no el Player', () => {
    renderEditorScreen()

    // Rastro inequívoco del shell normal: el botón "▶ Probar" de Topbar.
    expect(screen.getByText('▶ Probar')).toBeInTheDocument()
    // Rastro inequívoco del Player: sus controles permanentes no aparecen.
    expect(screen.queryByText('← Volver al editor')).not.toBeInTheDocument()
    expect(screen.queryByText('↺ Reiniciar experiencia')).not.toBeInTheDocument()
  })

  it('con previewMode en true, muestra el Player y no el shell normal', () => {
    act(() => {
      useProjectStore.getState().setPreviewMode(true)
    })
    renderEditorScreen()

    expect(screen.getByText('← Volver al editor')).toBeInTheDocument()
    expect(screen.getByText('↺ Reiniciar experiencia')).toBeInTheDocument()
    // El shell normal no debe estar presente en absoluto.
    expect(screen.queryByText('▶ Probar')).not.toBeInTheDocument()
  })

  it('"▶ Probar" seguido de "Volver al editor" hace ida y vuelta entre shell y Player', () => {
    renderEditorScreen()
    expect(screen.getByText('▶ Probar')).toBeInTheDocument()

    act(() => {
      useProjectStore.getState().createNode('slide', { x: 50, y: 0 })
    })
    const project = useProjectStore.getState().project
    const startId = project.graph.startNodeId
    const slideId = project.graph.nodes.find((node) => node.id !== startId)?.id
    if (!slideId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().connect(startId, slideId)
      useProjectStore.getState().setPreviewMode(true)
    })

    // No hace falta re-renderizar a mano: el componente ya está suscrito a
    // `previewMode` vía el store.
    expect(screen.getByText('← Volver al editor')).toBeInTheDocument()
    expect(screen.queryByText('▶ Probar')).not.toBeInTheDocument()
  })
})

/**
 * "Cerrar proyecto": `handleCloseProject` debe fuerza cualquier guardado
 * pendiente (`flushPendingSave` de `useAutosave`) antes de avisar a
 * `onCloseProject`, para que un cambio hecho dentro de la ventana de
 * debounce nunca se pierda al volver a `HomeScreen`. Usa temporizadores
 * simulados, igual que `useAutosave.test.tsx`, para poder situarse a mitad
 * del debounce sin esperar de verdad.
 */
describe('EditorScreen — panel izquierdo ocultable (tarea 1)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('visible por defecto; el botón lo oculta y el botón vuelve a mostrarlo', () => {
    renderEditorScreen()

    expect(screen.getByLabelText('Buscar en el proyecto')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Ocultar panel izquierdo'))
    expect(screen.queryByLabelText('Buscar en el proyecto')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Mostrar panel izquierdo'))
    expect(screen.getByLabelText('Buscar en el proyecto')).toBeInTheDocument()
  })

  it('persiste la preferencia en localStorage entre montajes', () => {
    const { unmount } = renderEditorScreen()
    fireEvent.click(screen.getByLabelText('Ocultar panel izquierdo'))
    unmount()

    renderEditorScreen()
    expect(screen.queryByLabelText('Buscar en el proyecto')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Mostrar panel izquierdo')).toBeInTheDocument()
  })
})

describe('EditorScreen — "Cerrar proyecto"', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sin cambios pendientes, cierra de inmediato sin llamar a saveProject', async () => {
    const repository = createStubRepository()
    const onCloseProject = vi.fn()
    render(
      <AppServicesProvider services={{ repository, assetRepository: new MemoryAssetRepository() }}>
        <EditorScreen filePath={TEST_FILE_PATH} onCloseProject={onCloseProject} />
      </AppServicesProvider>,
    )

    await act(async () => {
      fireEvent.click(screen.getByText('Cerrar proyecto'))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(onCloseProject).toHaveBeenCalledTimes(1)
    expect(repository.saveProject).not.toHaveBeenCalled()
  })

  it('con un cambio a mitad del debounce, fuerza el guardado antes de avisar a onCloseProject', async () => {
    const repository = createStubRepository()
    const onCloseProject = vi.fn()
    render(
      <AppServicesProvider services={{ repository, assetRepository: new MemoryAssetRepository() }}>
        <EditorScreen filePath={TEST_FILE_PATH} onCloseProject={onCloseProject} />
      </AppServicesProvider>,
    )

    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    })
    // A mitad del periodo de debounce: todavía no se ha guardado nada.
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS / 2)
    })
    expect(repository.saveProject).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByText('Cerrar proyecto'))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(repository.saveProject).toHaveBeenCalledTimes(1)
    expect(onCloseProject).toHaveBeenCalledTimes(1)
    expect(repository.saveProject).toHaveBeenCalledWith(
      TEST_FILE_PATH,
      useProjectStore.getState().project,
    )

    // El temporizador de debounce original quedó cancelado por el guardado
    // forzado: dejar pasar el resto de su plazo no debe producir una
    // segunda llamada.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)
    })
    expect(repository.saveProject).toHaveBeenCalledTimes(1)
  })
})
