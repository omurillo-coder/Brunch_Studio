import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { MemoryProjectRepository } from '../persistence'
import { createProject } from '../domain'
import { resetProjectStore } from '../store/testHelpers'

beforeEach(() => {
  resetProjectStore()
})

describe('App: navegación HomeScreen -> EditorScreen', () => {
  it('"Nuevo proyecto" lleva a EditorScreen con la diapositiva de inicio creada', async () => {
    const repository = new MemoryProjectRepository()
    const pickSaveProjectPath = vi.fn().mockResolvedValue('/tmp/proyecto-nuevo.brunch')
    const pickOpenProjectPath = vi.fn().mockResolvedValue(null)

    render(<App services={{ repository, pickSaveProjectPath, pickOpenProjectPath }} />)

    fireEvent.click(screen.getByText('Nuevo proyecto'))
    fireEvent.change(screen.getByLabelText('Nombre del proyecto'), {
      target: { value: 'Escenario de prueba' },
    })
    fireEvent.click(screen.getByText('Crear'))

    // El shell del editor está montado: barra superior con el nombre del
    // proyecto y el botón "Probar", panel izquierdo con los botones de
    // creación. El nombre del proyecto aparece dos veces (barra superior +
    // inspector sin selección), por eso se usa `findAllByText`.
    await screen.findByText('▶ Probar')
    expect(screen.getAllByText('Escenario de prueba').length).toBeGreaterThan(0)
    expect(screen.getByText('+ Diapositiva')).toBeInTheDocument()
    expect(screen.getByText('+ Final')).toBeInTheDocument()
    // La diapositiva de inicio, creada automáticamente por `createProject`,
    // ya aparece en la lista del panel izquierdo y en el lienzo, marcada
    // como punto de partida del recorrido.
    expect(screen.getAllByTitle('Diapositiva de inicio').length).toBeGreaterThanOrEqual(1)
  })

  it('"Abrir proyecto" con un documento existente lleva a EditorScreen con esos datos', async () => {
    const repository = new MemoryProjectRepository()
    const existing = createProject('Proyecto ya guardado')
    await repository.createProject('/tmp/existente.brunch', existing)

    const pickSaveProjectPath = vi.fn().mockResolvedValue(null)
    const pickOpenProjectPath = vi.fn().mockResolvedValue('/tmp/existente.brunch')

    render(<App services={{ repository, pickSaveProjectPath, pickOpenProjectPath }} />)

    fireEvent.click(screen.getByText('Abrir proyecto'))

    await screen.findByText('▶ Probar')
    expect(screen.getAllByText('Proyecto ya guardado').length).toBeGreaterThan(0)
  })

  it('cancelar el selector de ruta no rompe nada y deja la pantalla inicial', async () => {
    const repository = new MemoryProjectRepository()
    const pickSaveProjectPath = vi.fn().mockResolvedValue(null)
    const pickOpenProjectPath = vi.fn().mockResolvedValue(null)

    render(<App services={{ repository, pickSaveProjectPath, pickOpenProjectPath }} />)

    fireEvent.click(screen.getByText('Abrir proyecto'))
    await vi.waitFor(() => expect(pickOpenProjectPath).toHaveBeenCalled())

    // Sigue en HomeScreen: los dos botones iniciales están presentes y no
    // hay rastro del shell del editor.
    expect(screen.getByText('Nuevo proyecto')).toBeInTheDocument()
    expect(screen.getByText('Abrir proyecto')).toBeInTheDocument()
    expect(screen.queryByText('▶ Probar')).not.toBeInTheDocument()
  })

  it('"Cerrar proyecto" desde el editor vuelve a mostrar HomeScreen en la misma ventana', async () => {
    const repository = new MemoryProjectRepository()
    const pickSaveProjectPath = vi.fn().mockResolvedValue('/tmp/proyecto-a-cerrar.brunch')
    const pickOpenProjectPath = vi.fn().mockResolvedValue(null)

    render(<App services={{ repository, pickSaveProjectPath, pickOpenProjectPath }} />)

    fireEvent.click(screen.getByText('Nuevo proyecto'))
    fireEvent.change(screen.getByLabelText('Nombre del proyecto'), {
      target: { value: 'Escenario a cerrar' },
    })
    fireEvent.click(screen.getByText('Crear'))

    await screen.findByText('▶ Probar')

    fireEvent.click(screen.getByText('Cerrar proyecto'))

    // Vuelve a HomeScreen sin cerrar la aplicación: los botones iniciales
    // reaparecen y no queda ningún rastro del shell del editor.
    await screen.findByText('Nuevo proyecto')
    expect(screen.getByText('Abrir proyecto')).toBeInTheDocument()
    expect(screen.queryByText('▶ Probar')).not.toBeInTheDocument()
    expect(screen.queryByText('Cerrar proyecto')).not.toBeInTheDocument()
  })
})
