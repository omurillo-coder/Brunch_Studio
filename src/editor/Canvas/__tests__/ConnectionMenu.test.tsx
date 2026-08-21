import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionMenu } from '../ConnectionMenu'

describe('ConnectionMenu', () => {
  it('se muestra con las 2 opciones del modelo (Diapositiva, Final)', () => {
    render(<ConnectionMenu position={{ x: 10, y: 20 }} onSelect={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('¿Qué quieres añadir?')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Diapositiva',
      'Final',
    ])
    // Las antiguas opciones separadas ya no existen.
    expect(screen.queryByRole('menuitem', { name: 'Pantalla' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Decisión' })).not.toBeInTheDocument()
  })

  it('pulsar una opción llama a onSelect con el tipo correcto', () => {
    const onSelect = vi.fn()
    render(<ConnectionMenu position={{ x: 0, y: 0 }} onSelect={onSelect} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Diapositiva' }))
    expect(onSelect).toHaveBeenCalledWith('slide')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Final' }))
    expect(onSelect).toHaveBeenCalledWith('final')
    expect(onSelect).toHaveBeenCalledTimes(2)
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
