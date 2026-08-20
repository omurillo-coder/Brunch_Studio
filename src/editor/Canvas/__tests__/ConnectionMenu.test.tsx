import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionMenu } from '../ConnectionMenu'

describe('ConnectionMenu', () => {
  it('se muestra con las 3 opciones (Pantalla, Decisión, Final)', () => {
    render(<ConnectionMenu position={{ x: 10, y: 20 }} onSelect={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('¿Qué quieres añadir?')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Pantalla' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Decisión' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Final' })).toBeInTheDocument()
  })

  it('pulsar una opción llama a onSelect con el tipo correcto', () => {
    const onSelect = vi.fn()
    render(<ConnectionMenu position={{ x: 0, y: 0 }} onSelect={onSelect} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Decisión' }))

    expect(onSelect).toHaveBeenCalledWith('decision')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('Escape cierra sin crear nada', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<ConnectionMenu position={{ x: 0, y: 0 }} onSelect={onSelect} onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('un clic fuera del menú cierra sin crear nada', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(
      <div>
        <div data-testid="outside">fuera</div>
        <ConnectionMenu position={{ x: 0, y: 0 }} onSelect={onSelect} onClose={onClose} />
      </div>,
    )

    fireEvent.mouseDown(screen.getByTestId('outside'))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('un clic dentro del menú (pero no en un botón) no lo cierra', () => {
    const onClose = vi.fn()
    render(<ConnectionMenu position={{ x: 0, y: 0 }} onSelect={vi.fn()} onClose={onClose} />)

    fireEvent.mouseDown(screen.getByText('¿Qué quieres añadir?'))

    expect(onClose).not.toHaveBeenCalled()
  })
})
