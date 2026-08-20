import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeScreen } from '../HomeScreen'
import { AppServicesProvider } from '../../../app/AppServicesContext'
import type { AppServices } from '../../../app/AppServices'
import { MemoryProjectRepository } from '../../../persistence'
import { createProject } from '../../../domain'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'

beforeEach(() => {
  resetProjectStore()
})

function renderHomeScreen(services: Partial<AppServices>, onProjectOpened = vi.fn()) {
  render(
    <AppServicesProvider services={services}>
      <HomeScreen onProjectOpened={onProjectOpened} />
    </AppServicesProvider>,
  )
  return onProjectOpened
}

describe('HomeScreen', () => {
  it('el flujo "Nuevo proyecto" crea el documento y notifica la ruta elegida', async () => {
    const repository = new MemoryProjectRepository()
    const pickSaveProjectPath = vi.fn().mockResolvedValue('/tmp/nuevo.branch')
    const onProjectOpened = renderHomeScreen({ repository, pickSaveProjectPath })

    fireEvent.click(screen.getByText('Nuevo proyecto'))
    fireEvent.change(screen.getByLabelText('Nombre del proyecto'), {
      target: { value: 'Mi escenario' },
    })
    fireEvent.click(screen.getByText('Crear'))

    await vi.waitFor(() => expect(onProjectOpened).toHaveBeenCalledWith('/tmp/nuevo.branch'))
    // El nombre escrito en el formulario se propone como nombre de archivo
    // en el propio diálogo nativo de guardar (el usuario puede cambiarlo).
    expect(pickSaveProjectPath).toHaveBeenCalledWith('Mi escenario')

    const stored = await repository.openProject('/tmp/nuevo.branch')
    expect(stored.metadata.name).toBe('Mi escenario')
    expect(useProjectStore.getState().project.metadata.name).toBe('Mi escenario')
  })

  it('cancelar el diálogo de guardar no crea nada ni notifica', async () => {
    const repository = new MemoryProjectRepository()
    const pickSaveProjectPath = vi.fn().mockResolvedValue(null)
    const onProjectOpened = renderHomeScreen({ repository, pickSaveProjectPath })

    fireEvent.click(screen.getByText('Nuevo proyecto'))
    fireEvent.change(screen.getByLabelText('Nombre del proyecto'), {
      target: { value: 'Mi escenario' },
    })
    fireEvent.click(screen.getByText('Crear'))

    await vi.waitFor(() => expect(pickSaveProjectPath).toHaveBeenCalled())

    expect(onProjectOpened).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Se mantiene la pantalla inicial (el formulario de nombre sigue ahí).
    expect(screen.getByLabelText('Nombre del proyecto')).toBeInTheDocument()
  })

  it('el flujo "Abrir proyecto" carga el documento existente y notifica la ruta', async () => {
    const repository = new MemoryProjectRepository()
    const existing = createProject('Proyecto existente')
    await repository.createProject('/tmp/existente.branch', existing)
    const pickOpenProjectPath = vi.fn().mockResolvedValue('/tmp/existente.branch')
    const onProjectOpened = renderHomeScreen({ repository, pickOpenProjectPath })

    fireEvent.click(screen.getByText('Abrir proyecto'))

    await vi.waitFor(() => expect(onProjectOpened).toHaveBeenCalledWith('/tmp/existente.branch'))
    expect(useProjectStore.getState().project.metadata.name).toBe('Proyecto existente')
  })

  it('cancelar el diálogo de abrir no notifica ni muestra error', async () => {
    const repository = new MemoryProjectRepository()
    const pickOpenProjectPath = vi.fn().mockResolvedValue(null)
    const onProjectOpened = renderHomeScreen({ repository, pickOpenProjectPath })

    fireEvent.click(screen.getByText('Abrir proyecto'))

    await vi.waitFor(() => expect(pickOpenProjectPath).toHaveBeenCalled())

    expect(onProjectOpened).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Abrir proyecto')).toBeInTheDocument()
  })

  it('un fallo al abrir muestra un mensaje de error comprensible, sin jerga técnica', async () => {
    const repository = new MemoryProjectRepository()
    const pickOpenProjectPath = vi.fn().mockResolvedValue('/tmp/invalido.branch')
    const onProjectOpened = renderHomeScreen({ repository, pickOpenProjectPath })

    fireEvent.click(screen.getByText('Abrir proyecto'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/error|stack|undefined|NaN|\[object/i)
    expect(onProjectOpened).not.toHaveBeenCalled()
  })
})
