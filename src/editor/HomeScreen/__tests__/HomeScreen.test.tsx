import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeScreen } from '../HomeScreen'
import { AppServicesProvider } from '../../../app/AppServicesContext'
import type { AppServices } from '../../../app/AppServices'
import { MemoryProjectRepository, MemoryTextFileReader } from '../../../persistence'
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
    const pickSaveProjectPath = vi.fn().mockResolvedValue('/tmp/nuevo.brunch')
    const onProjectOpened = renderHomeScreen({ repository, pickSaveProjectPath })

    fireEvent.click(screen.getByText('Nuevo proyecto'))
    fireEvent.change(screen.getByLabelText('Nombre del proyecto'), {
      target: { value: 'Mi escenario' },
    })
    fireEvent.click(screen.getByText('Crear'))

    await vi.waitFor(() => expect(onProjectOpened).toHaveBeenCalledWith('/tmp/nuevo.brunch'))
    // El nombre escrito en el formulario se propone como nombre de archivo
    // en el propio diálogo nativo de guardar (el usuario puede cambiarlo).
    expect(pickSaveProjectPath).toHaveBeenCalledWith('Mi escenario')

    const stored = await repository.openProject('/tmp/nuevo.brunch')
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
    await repository.createProject('/tmp/existente.brunch', existing)
    const pickOpenProjectPath = vi.fn().mockResolvedValue('/tmp/existente.brunch')
    const onProjectOpened = renderHomeScreen({ repository, pickOpenProjectPath })

    fireEvent.click(screen.getByText('Abrir proyecto'))

    await vi.waitFor(() => expect(onProjectOpened).toHaveBeenCalledWith('/tmp/existente.brunch'))
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
    const pickOpenProjectPath = vi.fn().mockResolvedValue('/tmp/invalido.brunch')
    const onProjectOpened = renderHomeScreen({ repository, pickOpenProjectPath })

    fireEvent.click(screen.getByText('Abrir proyecto'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/error|stack|undefined|NaN|\[object/i)
    expect(onProjectOpened).not.toHaveBeenCalled()
  })

  describe('Importar .twee', () => {
    // Un único pasaje enlazado, sin macros ni enlaces rotos: no genera avisos.
    const TWEE_SIN_AVISOS = ':: Inicio\nTexto. [[Siguiente]]\n\n:: Siguiente\nFin.'
    // Un enlace a un pasaje inexistente: genera un aviso.
    const TWEE_CON_AVISO = ':: Inicio\nTexto. [[Fantasma]]'

    it('sin avisos: crea el proyecto y navega directo, sin pantalla intermedia', async () => {
      const repository = new MemoryProjectRepository()
      const textFileReader = new MemoryTextFileReader()
      textFileReader.registerFile('/tmp/historia.twee', TWEE_SIN_AVISOS)
      const pickImportTweePath = vi.fn().mockResolvedValue('/tmp/historia.twee')
      const pickSaveProjectPath = vi.fn().mockResolvedValue('/tmp/historia.brunch')
      const onProjectOpened = renderHomeScreen({
        repository,
        textFileReader,
        pickImportTweePath,
        pickSaveProjectPath,
      })

      fireEvent.click(screen.getByText('Importar .twee'))

      await vi.waitFor(() => expect(onProjectOpened).toHaveBeenCalledWith('/tmp/historia.brunch'))
      expect(screen.queryByText(/aviso/i)).not.toBeInTheDocument()
      const stored = await repository.openProject('/tmp/historia.brunch')
      expect(stored.metadata.name).toBe('historia')
    })

    it('con avisos: los muestra y solo crea el proyecto tras confirmar', async () => {
      const repository = new MemoryProjectRepository()
      const textFileReader = new MemoryTextFileReader()
      textFileReader.registerFile('/tmp/historia.twee', TWEE_CON_AVISO)
      const pickImportTweePath = vi.fn().mockResolvedValue('/tmp/historia.twee')
      const pickSaveProjectPath = vi.fn().mockResolvedValue('/tmp/historia.brunch')
      const onProjectOpened = renderHomeScreen({
        repository,
        textFileReader,
        pickImportTweePath,
        pickSaveProjectPath,
      })

      fireEvent.click(screen.getByText('Importar .twee'))

      await screen.findByText(/Fantasma/)
      expect(onProjectOpened).not.toHaveBeenCalled()
      expect(pickSaveProjectPath).not.toHaveBeenCalled()

      fireEvent.click(screen.getByText('Crear proyecto de todos modos'))

      await vi.waitFor(() => expect(onProjectOpened).toHaveBeenCalledWith('/tmp/historia.brunch'))
    })

    it('con avisos: cancelar no crea ningún proyecto', async () => {
      const repository = new MemoryProjectRepository()
      const textFileReader = new MemoryTextFileReader()
      textFileReader.registerFile('/tmp/historia.twee', TWEE_CON_AVISO)
      const pickImportTweePath = vi.fn().mockResolvedValue('/tmp/historia.twee')
      const pickSaveProjectPath = vi.fn().mockResolvedValue('/tmp/historia.brunch')
      const onProjectOpened = renderHomeScreen({
        repository,
        textFileReader,
        pickImportTweePath,
        pickSaveProjectPath,
      })

      fireEvent.click(screen.getByText('Importar .twee'))
      await screen.findByText(/Fantasma/)

      fireEvent.click(screen.getByText('Cancelar'))

      expect(pickSaveProjectPath).not.toHaveBeenCalled()
      expect(onProjectOpened).not.toHaveBeenCalled()
      expect(screen.queryByText(/Fantasma/)).not.toBeInTheDocument()
      // Vuelve a la pantalla inicial.
      expect(screen.getByText('Importar .twee')).toBeInTheDocument()
    })

    it('cancelar el diálogo de elegir archivo no hace nada', async () => {
      const repository = new MemoryProjectRepository()
      const textFileReader = new MemoryTextFileReader()
      const pickImportTweePath = vi.fn().mockResolvedValue(null)
      const onProjectOpened = renderHomeScreen({ repository, textFileReader, pickImportTweePath })

      fireEvent.click(screen.getByText('Importar .twee'))

      await vi.waitFor(() => expect(pickImportTweePath).toHaveBeenCalled())
      expect(onProjectOpened).not.toHaveBeenCalled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByText('Importar .twee')).toBeInTheDocument()
    })

    it('un fallo de lectura muestra un error breve sin romper la pantalla', async () => {
      const repository = new MemoryProjectRepository()
      const textFileReader = new MemoryTextFileReader() // sin registerFile: readTextFile rechaza
      const pickImportTweePath = vi.fn().mockResolvedValue('/tmp/no-registrado.twee')
      const onProjectOpened = renderHomeScreen({ repository, textFileReader, pickImportTweePath })

      fireEvent.click(screen.getByText('Importar .twee'))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).not.toMatch(/error|stack|undefined|NaN|\[object/i)
      expect(onProjectOpened).not.toHaveBeenCalled()
      expect(screen.getByText('Importar .twee')).toBeInTheDocument()
    })

    it('un fallo de conversión (archivo sin pasajes reconocibles) muestra un error breve sin romper la pantalla', async () => {
      const repository = new MemoryProjectRepository()
      const textFileReader = new MemoryTextFileReader()
      textFileReader.registerFile('/tmp/vacio.twee', '')
      const pickImportTweePath = vi.fn().mockResolvedValue('/tmp/vacio.twee')
      const onProjectOpened = renderHomeScreen({ repository, textFileReader, pickImportTweePath })

      fireEvent.click(screen.getByText('Importar .twee'))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).not.toMatch(/error|stack|undefined|NaN|\[object/i)
      expect(onProjectOpened).not.toHaveBeenCalled()
    })
  })
})
