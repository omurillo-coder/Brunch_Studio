import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { Topbar } from '../Topbar'
import { AppServicesProvider } from '../../../app/AppServicesContext'
import type { AppServices } from '../../../app/AppServices'
import {
  MemoryAssetRepository,
  MemoryHtmlBundleWriter,
  MemoryScormPackageWriter,
} from '../../../persistence'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'

const TEST_FILE_PATH = '/tmp/topbar-test.brunch'

/**
 * `Topbar` recibe `filePath` desde fase 1 del Milestone 3 (lo necesita
 * "Exportar HTML" para leer los assets a embeber) y consume `AppServices`
 * para el diálogo de guardado y la escritura del archivo, así que se envuelve
 * siempre en `AppServicesProvider` con dobles en memoria — nunca el backend
 * Tauri real, inexistente en este entorno.
 *
 * "Nueva ventana"/"Cerrar proyecto" ya no viven aquí (tarea 2: se movieron
 * al menú nativo "Archivo" — ver `useNativeMenuActions.test.tsx`), así que
 * `Topbar` no necesita ningún mock de `@tauri-apps/api/webviewWindow` ni de
 * `@tauri-apps/api/event`.
 */
function renderTopbar(services: Partial<AppServices> = {}, extra?: ReactElement) {
  return render(
    <AppServicesProvider services={services}>
      {extra}
      <Topbar filePath={TEST_FILE_PATH} leftPanelVisible onToggleLeftPanel={vi.fn()} />
    </AppServicesProvider>,
  )
}

beforeEach(() => {
  resetProjectStore()
})

describe('Topbar', () => {
  it('muestra el nombre del proyecto y el estado de guardado', () => {
    renderTopbar()

    expect(screen.getByText('Untitled')).toBeInTheDocument()
    expect(screen.getByText('Guardado')).toBeInTheDocument()
  })

  it('traduce cada saveStatus a su texto', () => {
    renderTopbar()

    act(() => {
      useProjectStore.setState({ saveStatus: 'saving' })
    })
    expect(screen.getByText('Guardando…')).toBeInTheDocument()

    act(() => {
      useProjectStore.setState({ saveStatus: 'saved' })
    })
    expect(screen.getByText('Guardado')).toBeInTheDocument()

    act(() => {
      useProjectStore.setState({ saveStatus: 'error' })
    })
    expect(screen.getByText('Error al guardar')).toBeInTheDocument()
  })

  it('deshabilita Deshacer/Rehacer cuando no hay historial', () => {
    renderTopbar()

    expect(screen.getByLabelText('Deshacer')).toBeDisabled()
    expect(screen.getByLabelText('Rehacer')).toBeDisabled()
  })

  it('Deshacer/Rehacer llaman a las acciones del store cuando están habilitados', () => {
    renderTopbar()

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
    renderTopbar()

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
    renderTopbar({}, <input aria-label="campo de prueba" />)

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
    renderTopbar()

    expect(useProjectStore.getState().ui.previewMode).toBe(false)
    fireEvent.click(screen.getByText('▶ Probar'))
    expect(useProjectStore.getState().ui.previewMode).toBe(true)
  })

  it('el botón de panel izquierdo (tarea 1) refleja leftPanelVisible y llama a onToggleLeftPanel', () => {
    const onToggleLeftPanel = vi.fn()
    render(
      <AppServicesProvider services={{}}>
        <Topbar
          filePath={TEST_FILE_PATH}
          leftPanelVisible
          onToggleLeftPanel={onToggleLeftPanel}
        />
      </AppServicesProvider>,
    )

    const button = screen.getByLabelText('Ocultar panel izquierdo')
    expect(button).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(button)
    expect(onToggleLeftPanel).toHaveBeenCalledTimes(1)
  })

  it('el botón de panel izquierdo muestra "Mostrar" cuando está oculto', () => {
    render(
      <AppServicesProvider services={{}}>
        <Topbar filePath={TEST_FILE_PATH} leftPanelVisible={false} onToggleLeftPanel={vi.fn()} />
      </AppServicesProvider>,
    )

    const button = screen.getByLabelText('Mostrar panel izquierdo')
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('Topbar — Exportar HTML', () => {
  it('pide la ruta, genera el HTML y lo escribe', async () => {
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    const pickExportHtmlPath = vi.fn(async () => '/tmp/experiencia.html')
    renderTopbar({
      pickExportHtmlPath,
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    fireEvent.click(screen.getByText('Exportar HTML'))

    await waitFor(() => {
      expect(screen.getByText('Experiencia exportada a HTML.')).toBeInTheDocument()
    })

    // El nombre del proyecto se propone como nombre de archivo.
    expect(pickExportHtmlPath).toHaveBeenCalledWith('Untitled')
    expect(htmlBundleWriter.writtenPaths()).toEqual(['/tmp/experiencia.html'])
    expect(htmlBundleWriter.read('/tmp/experiencia.html')).toContain('<!doctype html>')
  })

  it('si el usuario cancela el diálogo, no escribe nada ni muestra error', async () => {
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    renderTopbar({
      pickExportHtmlPath: async () => null,
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    fireEvent.click(screen.getByText('Exportar HTML'))

    await waitFor(() => {
      expect(screen.getByText('Exportar HTML')).not.toBeDisabled()
    })
    expect(htmlBundleWriter.writtenPaths()).toEqual([])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('muestra un mensaje honesto y sin jerga si la escritura falla', async () => {
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    htmlBundleWriter.failNextWrite()
    renderTopbar({
      pickExportHtmlPath: async () => '/tmp/experiencia.html',
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    fireEvent.click(screen.getByText('Exportar HTML'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'No se ha podido exportar la experiencia. Prueba con otra carpeta u otro nombre de archivo.',
      )
    })
    expect(htmlBundleWriter.writtenPaths()).toEqual([])
  })
})

describe('Topbar — Exportar SCORM', () => {
  it('pide la ruta, genera el HTML y el manifiesto, y empaqueta el .zip', async () => {
    const scormPackageWriter = new MemoryScormPackageWriter()
    const pickExportScormPath = vi.fn(async () => '/tmp/experiencia.zip')
    renderTopbar({
      pickExportScormPath,
      scormPackageWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    fireEvent.click(screen.getByText('Exportar SCORM'))

    await waitFor(() => {
      expect(screen.getByText('Paquete SCORM exportado.')).toBeInTheDocument()
    })

    // El nombre del proyecto se propone como nombre de archivo.
    expect(pickExportScormPath).toHaveBeenCalledWith('Untitled')
    expect(scormPackageWriter.writtenPaths()).toEqual(['/tmp/experiencia.zip'])
    const written = scormPackageWriter.read('/tmp/experiencia.zip')
    expect(written?.html).toContain('<!doctype html>')
    expect(written?.manifest).toContain('<manifest')
    expect(written?.manifest).toContain('index.html')
  })

  it('si el usuario cancela el diálogo, no escribe nada ni muestra error', async () => {
    const scormPackageWriter = new MemoryScormPackageWriter()
    renderTopbar({
      pickExportScormPath: async () => null,
      scormPackageWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    fireEvent.click(screen.getByText('Exportar SCORM'))

    await waitFor(() => {
      expect(screen.getByText('Exportar SCORM')).not.toBeDisabled()
    })
    expect(scormPackageWriter.writtenPaths()).toEqual([])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('muestra un mensaje honesto y sin jerga si la escritura falla', async () => {
    const scormPackageWriter = new MemoryScormPackageWriter()
    scormPackageWriter.failNextWrite()
    renderTopbar({
      pickExportScormPath: async () => '/tmp/experiencia.zip',
      scormPackageWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    fireEvent.click(screen.getByText('Exportar SCORM'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'No se ha podido exportar el paquete SCORM. Prueba con otra carpeta u otro nombre de archivo.',
      )
    })
    expect(scormPackageWriter.writtenPaths()).toEqual([])
  })

  it('un asset que falla no rompe la exportación (mensaje honesto, pero éxito)', async () => {
    const scormPackageWriter = new MemoryScormPackageWriter()
    // El proyecto de partida referencia una imagen (`imageAssetIds`) que el
    // repositorio de assets NO tiene: `resolveExportAssets` lo cuenta como
    // fallido (ver `exportAssets.test.ts`) en vez de abortar toda la
    // exportación.
    act(() => {
      const startNodeId = useProjectStore.getState().project.graph.startNodeId
      useProjectStore.getState().updateNode(startNodeId, { imageAssetIds: ['asset-inexistente'] })
    })
    renderTopbar({
      pickExportScormPath: async () => '/tmp/experiencia.zip',
      scormPackageWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    fireEvent.click(screen.getByText('Exportar SCORM'))

    await waitFor(() => {
      expect(
        screen.getByText('Paquete SCORM exportado, pero una imagen o audio no se ha podido incluir.'),
      ).toBeInTheDocument()
    })
    expect(scormPackageWriter.writtenPaths()).toEqual(['/tmp/experiencia.zip'])
    expect(scormPackageWriter.read('/tmp/experiencia.zip')?.html).not.toContain('data:image')
  })
})
