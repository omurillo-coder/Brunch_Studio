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

/**
 * "Nueva ventana" usa `WebviewWindow` de `@tauri-apps/api/webviewWindow`
 * (ver `src/app/openNewProjectWindow.ts`). Se mockea el módulo entero: en
 * jsdom no hay ningún backend Tauri real detrás de `invoke`, así que sin
 * este mock el constructor real dispararía una llamada IPC que solo puede
 * rechazar (inofensivo para el test, pero no hay forma de aserto contra un
 * backend inexistente). El mock permite comprobar con qué argumentos se
 * pediría la ventana nueva sin depender de ningún runtime de Tauri.
 */
const webviewWindowConstructor = vi.fn()
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    label: string
    constructor(label: string, options: unknown) {
      this.label = label
      webviewWindowConstructor(label, options)
    }
  },
}))

const TEST_FILE_PATH = '/tmp/topbar-test.brunch'

/**
 * `Topbar` recibe `filePath` desde fase 1 del Milestone 3 (lo necesita
 * "Exportar HTML" para leer los assets a embeber) y consume `AppServices`
 * para el diálogo de guardado y la escritura del archivo, así que se envuelve
 * siempre en `AppServicesProvider` con dobles en memoria — nunca el backend
 * Tauri real, inexistente en este entorno.
 */
function renderTopbar(
  services: Partial<AppServices> = {},
  extra?: ReactElement,
  onCloseProject: () => void = vi.fn(),
) {
  return render(
    <AppServicesProvider services={services}>
      {extra}
      <Topbar filePath={TEST_FILE_PATH} onCloseProject={onCloseProject} />
    </AppServicesProvider>,
  )
}

beforeEach(() => {
  resetProjectStore()
  webviewWindowConstructor.mockClear()
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

  it('"Cerrar proyecto" invoca el callback onCloseProject', () => {
    const onCloseProject = vi.fn()
    renderTopbar({}, undefined, onCloseProject)

    expect(onCloseProject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Cerrar proyecto'))
    expect(onCloseProject).toHaveBeenCalledTimes(1)
  })

  it('"Nueva ventana" abre una WebviewWindow con label único y la misma URL raíz', () => {
    renderTopbar()

    fireEvent.click(screen.getByText('Nueva ventana'))

    expect(webviewWindowConstructor).toHaveBeenCalledTimes(1)
    const [label, options] = webviewWindowConstructor.mock.calls[0] as [string, { url?: string }]
    expect(label).toMatch(/^project-/)
    expect(options.url).toBe('/')

    // Un segundo clic pide una ventana distinta (label único cada vez).
    fireEvent.click(screen.getByText('Nueva ventana'))
    const [secondLabel] = webviewWindowConstructor.mock.calls[1] as [string, unknown]
    expect(secondLabel).not.toBe(label)
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
    // El proyecto de partida referencia un `imageAssetId` que el
    // repositorio de assets NO tiene: `resolveExportAssets` lo cuenta como
    // fallido (ver `exportAssets.test.ts`) en vez de abortar toda la
    // exportación.
    act(() => {
      const startNodeId = useProjectStore.getState().project.graph.startNodeId
      useProjectStore.getState().updateNode(startNodeId, { imageAssetId: 'asset-inexistente' })
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
