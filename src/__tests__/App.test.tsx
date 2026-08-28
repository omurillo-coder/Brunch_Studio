import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { MemoryProjectRepository, PersistenceCommandError } from '../persistence'
import type { ProjectRepository } from '../persistence'
import { createProject } from '../domain'
import { resetProjectStore } from '../store/testHelpers'

const messageMock = vi.fn()
vi.mock('@tauri-apps/plugin-dialog', () => ({
  message: (...args: unknown[]) => messageMock(...args),
}))

/**
 * "Cerrar proyecto" ya no es un botón (tarea 2: se movió al menú nativo
 * "Archivo" — ver `useNativeMenuActions`, montado dentro de `EditorScreen`).
 * Se mockea `@tauri-apps/api/event` con un registro en memoria de
 * `evento -> callbacks`, controlable con `emitMenuEvent(...)`, para simular
 * "el usuario ha pulsado 'Cerrar proyecto' en el menú nativo" sin ningún
 * backend Tauri real.
 */
const menuEventListeners = new Map<string, Set<() => void>>()

function emitMenuEvent(event: string) {
  menuEventListeners.get(event)?.forEach((callback) => callback())
}

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event: string, callback: () => void) => {
    let callbacks = menuEventListeners.get(event)
    if (!callbacks) {
      callbacks = new Set()
      menuEventListeners.set(event, callbacks)
    }
    callbacks.add(callback)
    return Promise.resolve(() => {
      callbacks?.delete(callback)
    })
  }),
}))

beforeEach(() => {
  resetProjectStore()
  menuEventListeners.clear()
})

afterEach(() => {
  messageMock.mockReset()
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
    // La diapositiva de Inicio, sembrada automáticamente por la plantilla al
    // crear el proyecto, ya aparece en la lista del panel izquierdo — en vez
    // de una etiqueta de tipo o un código "D{número}", muestra "INICIO" en
    // grande (siempre ocupa el número 1 internamente, pero no lo enseña: no
    // necesita distinguirse por número, ya es único) — y el botón "+ Inicio"
    // queda deshabilitado porque ya existe una.
    // "INICIO" aparece tanto en la tarjeta del lienzo como en el panel
    // izquierdo — dos elementos distintos con el mismo texto.
    expect(screen.getAllByText('INICIO').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('+ Inicio')).toBeDisabled()
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
    // El nombre mostrado se sincroniza con el del archivo ("existente"), no
    // con el guardado en el documento ("Proyecto ya guardado") — ver
    // `openExistingProject` (`src/app/openExistingProject.ts`).
    expect(screen.getAllByText('existente').length).toBeGreaterThan(0)
    expect(screen.queryByText('Proyecto ya guardado')).not.toBeInTheDocument()
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

  it('con una ruta inicial pendiente (getInitialOpenPath), salta directo a EditorScreen sin pasar por HomeScreen', async () => {
    const repository = new MemoryProjectRepository()
    const existing = createProject('Proyecto abierto desde el sistema')
    await repository.createProject('/tmp/desde-finder.brunch', existing)

    const pickSaveProjectPath = vi.fn().mockResolvedValue(null)
    const pickOpenProjectPath = vi.fn().mockResolvedValue(null)
    const getInitialOpenPath = vi.fn().mockResolvedValue('/tmp/desde-finder.brunch')

    render(
      <App services={{ repository, pickSaveProjectPath, pickOpenProjectPath, getInitialOpenPath }} />,
    )

    await screen.findByText('▶ Probar')
    // Mismo criterio que "Abrir proyecto": el nombre mostrado se sincroniza
    // con el del archivo ("desde-finder"), no con el guardado en el
    // documento ("Proyecto abierto desde el sistema").
    expect(screen.getAllByText('desde-finder').length).toBeGreaterThan(0)
    expect(screen.queryByText('Proyecto abierto desde el sistema')).not.toBeInTheDocument()
    // Nunca llegó a pasar por HomeScreen.
    expect(screen.queryByText('Nuevo proyecto')).not.toBeInTheDocument()
  })

  it('con una ruta inicial que no se puede abrir, se queda en HomeScreen mostrando el mismo error que "Abrir proyecto"', async () => {
    const repository = new MemoryProjectRepository()
    const pickSaveProjectPath = vi.fn().mockResolvedValue(null)
    const pickOpenProjectPath = vi.fn().mockResolvedValue(null)
    const getInitialOpenPath = vi.fn().mockResolvedValue('/tmp/no-existe.brunch')

    render(
      <App services={{ repository, pickSaveProjectPath, pickOpenProjectPath, getInitialOpenPath }} />,
    )

    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No se ha podido abrir ese archivo. Comprueba que es un proyecto de Brunch Studio válido.',
    )
    // Sigue en HomeScreen: no hay rastro del shell del editor.
    expect(screen.getByText('Nuevo proyecto')).toBeInTheDocument()
    expect(screen.queryByText('▶ Probar')).not.toBeInTheDocument()
  })

  it('con una ruta inicial ya abierta en otra ventana, muestra el diálogo nativo de aviso y se queda en HomeScreen', async () => {
    messageMock.mockResolvedValue(undefined)
    const repository: ProjectRepository = {
      createProject: vi.fn(),
      openProject: vi
        .fn()
        .mockRejectedValue(new PersistenceCommandError('AlreadyOpenElsewhere', '/tmp/ya-abierto.brunch')),
      saveProject: vi.fn(),
    }
    const pickSaveProjectPath = vi.fn().mockResolvedValue(null)
    const pickOpenProjectPath = vi.fn().mockResolvedValue(null)
    const getInitialOpenPath = vi.fn().mockResolvedValue('/tmp/ya-abierto.brunch')

    render(
      <App services={{ repository, pickSaveProjectPath, pickOpenProjectPath, getInitialOpenPath }} />,
    )

    await vi.waitFor(() => expect(messageMock).toHaveBeenCalledTimes(1))
    const [msg] = messageMock.mock.calls[0] as [string]
    expect(msg).toMatch(/ya está abierto en otra ventana/i)

    // Se queda en HomeScreen, sin el mensaje de error genérico ni rastro del editor.
    expect(screen.getByText('Nuevo proyecto')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('▶ Probar')).not.toBeInTheDocument()
  })

  it('sin ninguna ruta inicial pendiente, muestra HomeScreen con normalidad', async () => {
    const repository = new MemoryProjectRepository()
    const pickSaveProjectPath = vi.fn().mockResolvedValue(null)
    const pickOpenProjectPath = vi.fn().mockResolvedValue(null)
    const getInitialOpenPath = vi.fn().mockResolvedValue(null)

    render(
      <App services={{ repository, pickSaveProjectPath, pickOpenProjectPath, getInitialOpenPath }} />,
    )

    await vi.waitFor(() => expect(getInitialOpenPath).toHaveBeenCalled())
    expect(screen.getByText('Nuevo proyecto')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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
    // El listener del evento del menú nativo se registra de forma asíncrona
    // (`await listen(...)` dentro de `useNativeMenuActions`): se espera a
    // que quede instalado antes de emitir el evento simulado.
    await vi.waitFor(() => expect(menuEventListeners.get('menu-close-project')?.size).toBe(1))

    await act(async () => {
      emitMenuEvent('menu-close-project')
    })

    // Vuelve a HomeScreen sin cerrar la aplicación: los botones iniciales
    // reaparecen y no queda ningún rastro del shell del editor.
    await screen.findByText('Nuevo proyecto')
    expect(screen.getByText('Abrir proyecto')).toBeInTheDocument()
    expect(screen.queryByText('▶ Probar')).not.toBeInTheDocument()
  })
})
