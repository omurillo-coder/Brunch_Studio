import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Topbar } from '../Topbar'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'

beforeEach(() => {
  resetProjectStore()
})

describe('Topbar', () => {
  it('muestra el nombre del proyecto y el estado de guardado', () => {
    render(<Topbar />)

    expect(screen.getByText('Untitled')).toBeInTheDocument()
    expect(screen.getByText('Guardado')).toBeInTheDocument()
  })

  it('traduce cada saveStatus a su texto', () => {
    render(<Topbar />)

    act(() => {
      useProjectStore.setState({ saveStatus: 'saving' })
    })
    expect(screen.getByText('Guardando…')).toBeInTheDocument()

    act(() => {
      useProjectStore.setState({ saveStatus: 'saved' })
    })
    expect(screen.getByText('Guardado')).toBeInTheDocument()
  })

  it('deshabilita Deshacer/Rehacer cuando no hay historial', () => {
    render(<Topbar />)

    expect(screen.getByLabelText('Deshacer')).toBeDisabled()
    expect(screen.getByLabelText('Rehacer')).toBeDisabled()
  })

  it('Deshacer/Rehacer llaman a las acciones del store cuando están habilitados', () => {
    render(<Topbar />)

    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    })
    const countAfterCreate = useProjectStore.getState().project.graph.nodes.length

    const undoButton = screen.getByLabelText('Deshacer')
    expect(undoButton).not.toBeDisabled()
    fireEvent.click(undoButton)
    expect(useProjectStore.getState().project.graph.nodes.length).toBe(countAfterCreate - 1)

    const redoButton = screen.getByLabelText('Rehacer')
    expect(redoButton).not.toBeDisabled()
    fireEvent.click(redoButton)
    expect(useProjectStore.getState().project.graph.nodes.length).toBe(countAfterCreate)
  })

  it('el atajo de teclado Cmd/Ctrl+Z deshace y Cmd/Ctrl+Shift+Z rehace', () => {
    render(<Topbar />)

    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    })
    const countAfterCreate = useProjectStore.getState().project.graph.nodes.length

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(useProjectStore.getState().project.graph.nodes.length).toBe(countAfterCreate - 1)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(useProjectStore.getState().project.graph.nodes.length).toBe(countAfterCreate)
  })

  it('no intercepta el atajo cuando el foco está en un campo de texto', () => {
    render(
      <div>
        <input aria-label="campo de prueba" />
        <Topbar />
      </div>,
    )

    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    })
    const countAfterCreate = useProjectStore.getState().project.graph.nodes.length

    const input = screen.getByLabelText('campo de prueba')
    input.focus()
    // Se dispara sobre el propio input (no sobre `window`) para que el
    // evento burbujee de forma natural con `target` apuntando al campo de
    // texto — así el listener global de Topbar lo ve igual que ocurriría
    // en un navegador real.
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true })

    expect(useProjectStore.getState().project.graph.nodes.length).toBe(countAfterCreate)
  })

  it('"Probar" llama a setPreviewMode(true)', () => {
    render(<Topbar />)

    expect(useProjectStore.getState().ui.previewMode).toBe(false)
    fireEvent.click(screen.getByText('▶ Probar'))
    expect(useProjectStore.getState().ui.previewMode).toBe(true)
  })
})
