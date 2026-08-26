import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VariablesPanel } from '../VariablesPanel'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'

beforeEach(() => {
  resetProjectStore()
})

describe('VariablesPanel — crear variables', () => {
  it('crea una variable numérica con el valor inicial indicado', () => {
    render(<VariablesPanel onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Puntos' } })
    fireEvent.change(screen.getByLabelText('Valor inicial'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Añadir variable' }))

    const variables = useProjectStore.getState().project.variables
    expect(variables).toHaveLength(1)
    expect(variables[0]).toMatchObject({ name: 'Puntos', type: 'number', initialValue: 10 })
  })

  it('el control de valor inicial cambia a checkbox al elegir el tipo "Sí/no"', () => {
    render(<VariablesPanel onClose={vi.fn()} />)

    expect(screen.getByLabelText('Valor inicial')).toHaveAttribute('type', 'number')

    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'boolean' } })

    expect(screen.getByLabelText('Valor inicial')).toHaveAttribute('type', 'checkbox')
  })

  it('crea una variable booleana con el valor inicial marcado', () => {
    render(<VariablesPanel onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Aprobado' } })
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'boolean' } })
    fireEvent.click(screen.getByLabelText('Valor inicial'))
    fireEvent.click(screen.getByRole('button', { name: '+ Añadir variable' }))

    const variables = useProjectStore.getState().project.variables
    expect(variables).toHaveLength(1)
    expect(variables[0]).toMatchObject({ name: 'Aprobado', type: 'boolean', initialValue: true })
  })

  it('crear una variable limpia el formulario para poder añadir la siguiente', () => {
    render(<VariablesPanel onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Puntos' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Añadir variable' }))

    expect(screen.getByLabelText('Nombre')).toHaveValue('')
  })

  it('nombre duplicado muestra un error inline (no alert()) y no crea la segunda variable', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 0 })
    })
    render(<VariablesPanel onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Puntos' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Añadir variable' }))

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/ya existe/i)
    expect(useProjectStore.getState().project.variables).toHaveLength(1)
  })
})

describe('VariablesPanel — lista y edición de variables existentes', () => {
  it('lista las variables existentes con su tipo', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 5 })
      useProjectStore.getState().addVariable({ name: 'Aprobado', type: 'boolean', initialValue: false })
    })
    render(<VariablesPanel onClose={vi.fn()} />)

    expect(screen.getByLabelText('Nombre de la variable 1')).toHaveValue('Puntos')
    expect(screen.getByLabelText('Nombre de la variable 2')).toHaveValue('Aprobado')
  })

  it('editar el nombre y hacer blur lo confirma en el store', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 5 })
    })
    render(<VariablesPanel onClose={vi.fn()} />)

    const nameField = screen.getByLabelText('Nombre de la variable 1')
    fireEvent.change(nameField, { target: { value: 'Puntuación' } })
    fireEvent.blur(nameField)

    expect(useProjectStore.getState().project.variables[0]?.name).toBe('Puntuación')
  })

  it('editar el valor inicial numérico y hacer blur lo confirma en el store', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 5 })
    })
    render(<VariablesPanel onClose={vi.fn()} />)

    const valueField = screen.getByLabelText('Valor inicial de la variable 1')
    fireEvent.change(valueField, { target: { value: '42' } })
    fireEvent.blur(valueField)

    expect(useProjectStore.getState().project.variables[0]?.initialValue).toBe(42)
  })

  it('editar el valor inicial booleano (checkbox) lo confirma de inmediato', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Aprobado', type: 'boolean', initialValue: false })
    })
    render(<VariablesPanel onClose={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Valor inicial de la variable 1'))

    expect(useProjectStore.getState().project.variables[0]?.initialValue).toBe(true)
  })

  it('no ofrece ningún control para cambiar el tipo de una variable ya creada', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 5 })
    })
    render(<VariablesPanel onClose={vi.fn()} />)

    const row = screen.getByLabelText('Nombre de la variable 1').closest('li') as HTMLElement
    expect(within(row).getByText('Número')).toBeInTheDocument()
    // Solo hay un <select> visible: el de "Tipo" del formulario de alta.
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
  })

  it('renombrar a un nombre ya usado por otra variable muestra un error inline y no lo cambia', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 5 })
      useProjectStore.getState().addVariable({ name: 'Vidas', type: 'number', initialValue: 3 })
    })
    render(<VariablesPanel onClose={vi.fn()} />)

    const nameField = screen.getByLabelText('Nombre de la variable 2')
    fireEvent.change(nameField, { target: { value: 'Puntos' } })
    fireEvent.blur(nameField)

    expect(screen.getByRole('alert').textContent).toMatch(/ya existe/i)
    expect(useProjectStore.getState().project.variables[1]?.name).toBe('Vidas')
  })
})

describe('VariablesPanel — borrado con confirmación inline', () => {
  it('el primer clic en "Eliminar" no borra todavía: solo muestra la confirmación', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 5 })
    })
    render(<VariablesPanel onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar variable 1' }))

    expect(useProjectStore.getState().project.variables).toHaveLength(1)
    expect(screen.getByText(/¿Eliminar la variable "Puntos"\?/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sí, eliminar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
  })

  it('confirmar con "Sí, eliminar" borra la variable', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 5 })
    })
    render(<VariablesPanel onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar variable 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }))

    expect(useProjectStore.getState().project.variables).toHaveLength(0)
    expect(screen.getByText('Todavía no hay variables. Créala con el formulario de arriba.')).toBeInTheDocument()
  })

  it('cancelar la confirmación no borra nada y vuelve al botón normal', () => {
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Puntos', type: 'number', initialValue: 5 })
    })
    render(<VariablesPanel onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar variable 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(useProjectStore.getState().project.variables).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Eliminar variable 1' })).toBeInTheDocument()
  })
})

describe('VariablesPanel — cierre', () => {
  it('el botón "✕" llama a onClose', () => {
    const onClose = vi.fn()
    render(<VariablesPanel onClose={onClose} />)

    fireEvent.click(screen.getByLabelText('Cerrar panel de variables'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
