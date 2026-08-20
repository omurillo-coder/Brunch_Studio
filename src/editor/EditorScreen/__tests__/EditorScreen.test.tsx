import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { EditorScreen } from '../EditorScreen'
import { AppServicesProvider } from '../../../app/AppServicesContext'
import { MemoryProjectRepository } from '../../../persistence'
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

const TEST_FILE_PATH = '/tmp/editor-screen-test.branch'

function renderEditorScreen() {
  return render(
    <AppServicesProvider services={{ repository: new MemoryProjectRepository() }}>
      <EditorScreen filePath={TEST_FILE_PATH} />
    </AppServicesProvider>,
  )
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
      useProjectStore.getState().createNode('content', { x: 50, y: 0 })
    })
    const project = useProjectStore.getState().project
    const startId = project.graph.nodes.find((node) => node.type === 'start')?.id
    const contentId = project.graph.nodes.find((node) => node.type === 'content')?.id
    if (!startId || !contentId) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().connect(startId, contentId)
      useProjectStore.getState().setPreviewMode(true)
    })

    // No hace falta re-renderizar a mano: el componente ya está suscrito a
    // `previewMode` vía el store.
    expect(screen.getByText('← Volver al editor')).toBeInTheDocument()
    expect(screen.queryByText('▶ Probar')).not.toBeInTheDocument()
  })
})
