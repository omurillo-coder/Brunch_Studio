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
  MemoryTextDocumentWriter,
} from '../../../persistence'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'
import { CICLOS } from '../../../domain'
import { BUNDLE_ELEMENT_ID } from '../../../export/exportedPlayerScript'

const TEST_FILE_PATH = '/tmp/topbar-test.brunch'

/**
 * "Exportar revisión profes" resuelve la imagen del pingüino de
 * felicitación con `fetch()` (ver `resolveCompletionPenguinDataUri` en
 * `src/export/teacherReviewExport.ts`, mismo patrón que
 * `src/domain/spellingDictionary.ts`). En jsdom no hay ningún servidor real
 * detrás de la URL que resuelve Vite para el `?url` de la imagen, así que se
 * mockea `fetch` globalmente para estos tests — nada más de este archivo
 * depende de `fetch` (los dobles en memoria de assets/escritura no lo usan).
 */
vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    new Response(new Uint8Array([137, 80, 78, 71]).buffer, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  ),
)

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
      <Topbar
        filePath={TEST_FILE_PATH}
        leftPanelVisible
        onToggleLeftPanel={vi.fn()}
        variablesPanelVisible={false}
        onToggleVariablesPanel={vi.fn()}
      />
    </AppServicesProvider>,
  )
}

beforeEach(() => {
  resetProjectStore()
})

/**
 * Añade una diapositiva de Inicio (nodo `intro`, milestone "Diapositiva de
 * Inicio") completa —ciclo, asignatura coherente con ese ciclo y nombre de
 * caso— al proyecto del store. Necesaria en los tests de "Exportar HTML"/
 * "Exportar SCORM" de más abajo desde que ambos hooks bloquean la
 * exportación con `validateIntroForExport` (`src/domain/introValidation.ts`,
 * fase 3 del milestone): el proyecto "de fábrica" de `resetProjectStore`
 * (creado con la función de bajo nivel `createProject`, ver su comentario en
 * `src/domain/project.ts`) NO nace con ningún nodo `intro`, así que sin esto
 * la exportación quedaría siempre bloqueada y estos tests —que verifican la
 * mecánica de exportar (pedir ruta, generar, escribir), no la validación de
 * la portada— dejarían de poder probarla.
 */
function seedCompleteIntro(): void {
  act(() => {
    useProjectStore.getState().createNode('intro', { x: -300, y: 0 })
  })
  const introId = useProjectStore
    .getState()
    .project.graph.nodes.find((node) => node.type === 'intro')?.id
  if (!introId) throw new Error('seedCompleteIntro: no se creó ningún nodo "intro"')

  const ciclo = CICLOS[0]!
  const asignatura = ciclo.asignaturas[0]!
  act(() => {
    useProjectStore.getState().updateNode(introId, {
      cicloId: ciclo.id,
      asignaturaId: asignatura.id,
      caseName: 'Caso de prueba',
    })
  })
}

/** Id del nodo `slide` del proyecto de prueba — ya no es necesariamente
 *  `graph.startNodeId` una vez `seedCompleteIntro` añade la portada (que lo
 *  desplaza, ver `createNode` en `src/domain/project.ts`). */
function slideNodeId(): string {
  const id = useProjectStore.getState().project.graph.nodes.find((node) => node.type === 'slide')?.id
  if (!id) throw new Error('No hay ningún nodo "slide" en el proyecto de prueba')
  return id
}

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
    // Botón normal: sin override de nodo inicial.
    expect(useProjectStore.getState().ui.previewStartNodeId).toBeNull()
  })

  describe('"Probar desde aquí"', () => {
    it('está deshabilitado sin selección', () => {
      renderTopbar()

      expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([])
      expect(screen.getByText('▶ Probar desde aquí')).toBeDisabled()
    })

    it('está deshabilitado con varios nodos seleccionados', () => {
      renderTopbar()

      // El proyecto "de fábrica" solo trae un nodo: se añade uno más para
      // poder seleccionar dos a la vez.
      act(() => {
        useProjectStore.getState().createNode('final', { x: 200, y: 0 })
      })
      const ids = useProjectStore.getState().project.graph.nodes.map((node) => node.id)
      expect(ids.length).toBeGreaterThan(1)
      act(() => {
        useProjectStore.getState().setSelection(ids)
      })

      expect(screen.getByText('▶ Probar desde aquí')).toBeDisabled()
    })

    it('está habilitado con exactamente un nodo seleccionado, y arranca "Probar" en ese nodo', () => {
      renderTopbar()

      const nodeId = useProjectStore.getState().project.graph.nodes[0]!.id
      act(() => {
        useProjectStore.getState().selectNode(nodeId)
      })

      const button = screen.getByText('▶ Probar desde aquí')
      expect(button).not.toBeDisabled()

      fireEvent.click(button)

      expect(useProjectStore.getState().ui.previewMode).toBe(true)
      expect(useProjectStore.getState().ui.previewStartNodeId).toBe(nodeId)
    })
  })

  it('el botón de panel izquierdo (tarea 1) refleja leftPanelVisible y llama a onToggleLeftPanel', () => {
    const onToggleLeftPanel = vi.fn()
    render(
      <AppServicesProvider services={{}}>
        <Topbar
          filePath={TEST_FILE_PATH}
          leftPanelVisible
          onToggleLeftPanel={onToggleLeftPanel}
          variablesPanelVisible={false}
          onToggleVariablesPanel={vi.fn()}
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
        <Topbar
          filePath={TEST_FILE_PATH}
          leftPanelVisible={false}
          onToggleLeftPanel={vi.fn()}
          variablesPanelVisible={false}
          onToggleVariablesPanel={vi.fn()}
        />
      </AppServicesProvider>,
    )

    const button = screen.getByLabelText('Mostrar panel izquierdo')
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  it('el botón "Variables" refleja variablesPanelVisible y llama a onToggleVariablesPanel', () => {
    const onToggleVariablesPanel = vi.fn()
    render(
      <AppServicesProvider services={{}}>
        <Topbar
          filePath={TEST_FILE_PATH}
          leftPanelVisible
          onToggleLeftPanel={vi.fn()}
          variablesPanelVisible
          onToggleVariablesPanel={onToggleVariablesPanel}
        />
      </AppServicesProvider>,
    )

    const button = screen.getByText('Variables')
    expect(button).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(button)
    expect(onToggleVariablesPanel).toHaveBeenCalledTimes(1)
  })
})

/** Abre el menú desplegable "Exportar" — precondición de todos los tests de
 *  las opciones que contiene (mismo mecanismo que un usuario real: hay que
 *  pulsar el botón "Exportar" antes de poder elegir una opción). */
function openExportMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
}

describe('Topbar — menú "Exportar"', () => {
  beforeEach(() => {
    seedCompleteIntro()
  })

  it('está cerrado al montar, y se abre/cierra al pulsar el botón "Exportar"', () => {
    renderTopbar()

    expect(screen.queryByRole('menu', { name: 'Exportar' })).not.toBeInTheDocument()

    openExportMenu()
    expect(screen.getByRole('menu', { name: 'Exportar' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    expect(screen.queryByRole('menu', { name: 'Exportar' })).not.toBeInTheDocument()
  })

  it('muestra las cuatro opciones, todas habilitadas', () => {
    renderTopbar()
    openExportMenu()

    expect(screen.getByRole('menuitem', { name: 'Exportar HTML' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Exportar SCORM' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Exportar revisión profes' })).not.toBeDisabled()
    expect(
      screen.getByRole('menuitem', { name: 'Exportar para revisión con IA' }),
    ).not.toBeDisabled()
  })

  it('se cierra al hacer clic fuera', () => {
    renderTopbar()
    openExportMenu()
    expect(screen.getByRole('menu', { name: 'Exportar' })).toBeInTheDocument()

    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('menu', { name: 'Exportar' })).not.toBeInTheDocument()
  })

  it('se cierra al pulsar Escape', () => {
    renderTopbar()
    openExportMenu()
    expect(screen.getByRole('menu', { name: 'Exportar' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu', { name: 'Exportar' })).not.toBeInTheDocument()
  })
})

describe('Topbar — Exportar HTML', () => {
  beforeEach(() => {
    seedCompleteIntro()
  })

  it('pide la ruta, genera el HTML y lo escribe', async () => {
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    const pickExportHtmlPath = vi.fn(async () => '/tmp/experiencia.html')
    renderTopbar({
      pickExportHtmlPath,
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    openExportMenu()
    fireEvent.click(screen.getByText('Exportar HTML'))

    await waitFor(() => {
      expect(screen.getByText('Experiencia exportada a HTML.')).toBeInTheDocument()
    })

    // El nombre del proyecto se propone como nombre de archivo.
    expect(pickExportHtmlPath).toHaveBeenCalledWith('Untitled')
    expect(htmlBundleWriter.writtenPaths()).toEqual(['/tmp/experiencia.html'])
    expect(htmlBundleWriter.read('/tmp/experiencia.html')).toContain('<!doctype html>')
  })

  it('el aviso de éxito flota bajo el botón "Exportar" y desaparece solo a los 5 segundos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const htmlBundleWriter = new MemoryHtmlBundleWriter()
      const pickExportHtmlPath = vi.fn(async () => '/tmp/experiencia.html')
      renderTopbar({
        pickExportHtmlPath,
        htmlBundleWriter,
        assetRepository: new MemoryAssetRepository(),
      })

      openExportMenu()
      fireEvent.click(screen.getByText('Exportar HTML'))

      await waitFor(() => {
        expect(screen.getByText('Experiencia exportada a HTML.')).toBeInTheDocument()
      })

      // Flota bajo el botón "Exportar" (`.exportMessages`, hermano de
      // `.exportMenu` dentro del mismo `.exportMenuWrapper`), no como un
      // elemento más de la fila de botones de la barra superior.
      const message = screen.getByText('Experiencia exportada a HTML.')
      expect(message.closest('[class*="exportMenuWrapper"]')).not.toBeNull()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(screen.queryByText('Experiencia exportada a HTML.')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('si el usuario cancela el diálogo, no escribe nada ni muestra error', async () => {
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    const pickExportHtmlPath = vi.fn(async () => null)
    renderTopbar({
      pickExportHtmlPath,
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    openExportMenu()
    fireEvent.click(screen.getByText('Exportar HTML'))

    await waitFor(() => {
      expect(pickExportHtmlPath).toHaveBeenCalled()
    })
    expect(htmlBundleWriter.writtenPaths()).toEqual([])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // El menú se cerró al elegir la opción, y reabrirlo la muestra otra vez
    // habilitada — el hook vuelve a `status: 'idle'` tras un cancelado, no
    // se queda "atascado" en `'exporting'`.
    expect(screen.queryByRole('menu', { name: 'Exportar' })).not.toBeInTheDocument()
    openExportMenu()
    expect(screen.getByRole('menuitem', { name: 'Exportar HTML' })).not.toBeDisabled()
  })

  it('muestra un mensaje honesto y sin jerga si la escritura falla', async () => {
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    htmlBundleWriter.failNextWrite()
    renderTopbar({
      pickExportHtmlPath: async () => '/tmp/experiencia.html',
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    openExportMenu()
    fireEvent.click(screen.getByText('Exportar HTML'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'No se ha podido exportar la experiencia. Prueba con otra carpeta u otro nombre de archivo.',
      )
    })
    expect(htmlBundleWriter.writtenPaths()).toEqual([])
  })
})

describe('Topbar — Exportar revisión profes', () => {
  beforeEach(() => {
    seedCompleteIntro()
  })

  it('pide la ruta, genera el HTML con reviewMode activo y lo escribe', async () => {
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    const pickExportTeacherReviewPath = vi.fn(async () => '/tmp/revision-profes.html')
    renderTopbar({
      pickExportTeacherReviewPath,
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    openExportMenu()
    fireEvent.click(screen.getByText('Exportar revisión profes'))

    await waitFor(() => {
      expect(screen.getByText('Revisión para profes exportada.')).toBeInTheDocument()
    })

    expect(pickExportTeacherReviewPath).toHaveBeenCalledWith('Untitled')
    expect(htmlBundleWriter.writtenPaths()).toEqual(['/tmp/revision-profes.html'])
    const written = htmlBundleWriter.read('/tmp/revision-profes.html')
    expect(written).toContain('<!doctype html>')
    expect(written).toContain('"reviewMode":true')
  })

  it('bloquea con la portada incompleta, sin abrir el selector de guardado', async () => {
    act(() => {
      useProjectStore.getState().updateNode(
        useProjectStore.getState().project.graph.nodes.find((node) => node.type === 'intro')!.id,
        { caseName: '' },
      )
    })
    const pickExportTeacherReviewPath = vi.fn(async () => '/tmp/revision-profes.html')
    renderTopbar({
      pickExportTeacherReviewPath,
      htmlBundleWriter: new MemoryHtmlBundleWriter(),
      assetRepository: new MemoryAssetRepository(),
    })

    openExportMenu()
    fireEvent.click(screen.getByText('Exportar revisión profes'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Escribe el nombre del caso práctico')
    })
    expect(pickExportTeacherReviewPath).not.toHaveBeenCalled()
  })

  it('si el usuario cancela el diálogo, no escribe nada ni muestra error', async () => {
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    const pickExportTeacherReviewPath = vi.fn(async () => null)
    renderTopbar({
      pickExportTeacherReviewPath,
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    openExportMenu()
    fireEvent.click(screen.getByText('Exportar revisión profes'))

    await waitFor(() => {
      expect(pickExportTeacherReviewPath).toHaveBeenCalled()
    })
    expect(htmlBundleWriter.writtenPaths()).toEqual([])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('muestra un mensaje honesto y sin jerga si la escritura falla', async () => {
    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    htmlBundleWriter.failNextWrite()
    renderTopbar({
      pickExportTeacherReviewPath: async () => '/tmp/revision-profes.html',
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    openExportMenu()
    fireEvent.click(screen.getByText('Exportar revisión profes'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'No se ha podido exportar la revisión para profes. Prueba con otra carpeta u otro nombre de archivo.',
      )
    })
    expect(htmlBundleWriter.writtenPaths()).toEqual([])
  })
})

describe('Topbar — Exportar para revisión con IA (petición de usuario: "que este archivo lo pudiese ver ChatGPT o alguna otra IA")', () => {
  it('pide la ruta, genera el documento y lo escribe — SIN necesitar la portada completa', async () => {
    // A diferencia de "Exportar HTML"/"Exportar SCORM"/"Exportar revisión
    // profes", este export no bloquea con `validateIntroForExport` (ver
    // `useAiReviewExport`): el proyecto "de fábrica" de `resetProjectStore`
    // (sin `seedCompleteIntro`) ya debe bastar.
    const textDocumentWriter = new MemoryTextDocumentWriter()
    const pickExportAiReviewPath = vi.fn(async () => '/tmp/revision-ia.md')
    renderTopbar({ pickExportAiReviewPath, textDocumentWriter })

    openExportMenu()
    fireEvent.click(screen.getByText('Exportar para revisión con IA'))

    await waitFor(() => {
      expect(screen.getByText('Documento para revisión con IA exportado.')).toBeInTheDocument()
    })

    expect(pickExportAiReviewPath).toHaveBeenCalledWith('Untitled')
    expect(textDocumentWriter.writtenPaths()).toEqual(['/tmp/revision-ia.md'])
    expect(textDocumentWriter.read('/tmp/revision-ia.md')).toContain(
      '— Documento para revisión con IA',
    )
  })

  it('si el usuario cancela el diálogo, no escribe nada ni muestra error', async () => {
    const textDocumentWriter = new MemoryTextDocumentWriter()
    const pickExportAiReviewPath = vi.fn(async () => null)
    renderTopbar({ pickExportAiReviewPath, textDocumentWriter })

    openExportMenu()
    fireEvent.click(screen.getByText('Exportar para revisión con IA'))

    await waitFor(() => {
      expect(pickExportAiReviewPath).toHaveBeenCalled()
    })
    expect(textDocumentWriter.writtenPaths()).toEqual([])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('muestra un mensaje honesto y sin jerga si la escritura falla', async () => {
    const textDocumentWriter = new MemoryTextDocumentWriter()
    textDocumentWriter.failNextWrite()
    renderTopbar({
      pickExportAiReviewPath: async () => '/tmp/revision-ia.md',
      textDocumentWriter,
    })

    openExportMenu()
    fireEvent.click(screen.getByText('Exportar para revisión con IA'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'No se ha podido exportar el documento. Prueba con otra carpeta u otro nombre de archivo.',
      )
    })
    expect(textDocumentWriter.writtenPaths()).toEqual([])
  })
})

describe('Topbar — Exportar SCORM', () => {
  beforeEach(() => {
    seedCompleteIntro()
  })

  it('pide la ruta, genera el HTML y el manifiesto, y empaqueta el .zip', async () => {
    const scormPackageWriter = new MemoryScormPackageWriter()
    const pickExportScormPath = vi.fn(async () => '/tmp/experiencia.zip')
    renderTopbar({
      pickExportScormPath,
      scormPackageWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    openExportMenu()
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
    const pickExportScormPath = vi.fn(async () => null)
    renderTopbar({
      pickExportScormPath,
      scormPackageWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    openExportMenu()
    fireEvent.click(screen.getByText('Exportar SCORM'))

    await waitFor(() => {
      expect(pickExportScormPath).toHaveBeenCalled()
    })
    expect(scormPackageWriter.writtenPaths()).toEqual([])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // Mismo criterio que "Exportar HTML": reabrir el menú lo muestra otra
    // vez habilitado tras un cancelado.
    openExportMenu()
    expect(screen.getByRole('menuitem', { name: 'Exportar SCORM' })).not.toBeDisabled()
  })

  it('muestra un mensaje honesto y sin jerga si la escritura falla', async () => {
    const scormPackageWriter = new MemoryScormPackageWriter()
    scormPackageWriter.failNextWrite()
    renderTopbar({
      pickExportScormPath: async () => '/tmp/experiencia.zip',
      scormPackageWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    openExportMenu()
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
    // El proyecto de partida referencia una imagen (un bloque de imagen de
    // `SlideNode.content`, milestone "Bloques de contenido") que el
    // repositorio de assets NO tiene: `resolveExportAssets` lo cuenta como
    // fallido (ver `exportAssets.test.ts`) en vez de abortar toda la
    // exportación.
    act(() => {
      useProjectStore.getState().addImageBlock(slideNodeId(), 'asset-inexistente')
    })
    renderTopbar({
      pickExportScormPath: async () => '/tmp/experiencia.zip',
      scormPackageWriter,
      assetRepository: new MemoryAssetRepository(),
    })

    openExportMenu()
    fireEvent.click(screen.getByText('Exportar SCORM'))

    await waitFor(() => {
      expect(
        screen.getByText('Paquete SCORM exportado, pero una imagen o audio no se ha podido incluir.'),
      ).toBeInTheDocument()
    })
    expect(scormPackageWriter.writtenPaths()).toEqual(['/tmp/experiencia.zip'])
    // No basta con "el HTML no contiene ningún `data:image`": desde el
    // rediseño de la portada de marca (milestone "Portada de marca iLERNA")
    // el HTML SIEMPRE lleva el logo/ilustración embebidos como `data:` URI,
    // con independencia de que el asset del PROYECTO haya fallado. Se
    // comprueba en su lugar que el asset fallido en concreto (identificado
    // por su id, `asset-inexistente`) no tiene entrada resuelta en
    // `assetUris` — ver `buildAssetUris` en `htmlBundle.ts`.
    const html = scormPackageWriter.read('/tmp/experiencia.zip')?.html ?? ''
    const marker = `<script type="application/json" id="${BUNDLE_ELEMENT_ID}">`
    const start = html.indexOf(marker) + marker.length
    const end = html.indexOf('</script>', start)
    const bundle = JSON.parse(html.slice(start, end)) as { assetUris?: Record<string, string> }
    expect(bundle.assetUris?.['asset-inexistente']).toBeUndefined()
  })
})
