import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { PlayerScreen } from '../PlayerScreen'
import { useProjectStore } from '../../store'
import { resetProjectStore } from '../../store/testHelpers'
import { createProject } from '../../domain'
import type { ProjectDocument } from '../../domain'
import { AppServicesProvider } from '../../app/AppServicesContext'
import type { AppServices } from '../../app/AppServices'
import { MemoryAssetRepository } from '../../persistence'
import { serializeRichBody } from '../../editor/richText/richTextContent'

const TEST_FILE_PATH = '/tmp/player-screen-test.brunch'

function nodeIdOf(project: ProjectDocument, type: 'start' | 'content' | 'decision' | 'final'): string {
  const ids = project.graph.nodes.filter((node) => node.type === type).map((node) => node.id)
  const id = ids[ids.length - 1]
  if (!id) throw new Error(`No hay nodo de tipo ${type} en el setup`)
  return id
}

function renderPlayer(services?: Partial<AppServices>) {
  return render(
    <AppServicesProvider services={services}>
      <PlayerScreen filePath={TEST_FILE_PATH} />
    </AppServicesProvider>,
  )
}

/** Construye, directamente sobre el store real, el recorrido:
 *  start -> pantalla "Bienvenida" -> decisión "¿Qué eliges?" -[A]-> final "Fin A"
 */
function buildGraphInStore() {
  const store = useProjectStore.getState()
  act(() => {
    store.createNode('content', { x: 100, y: 0 }, { title: 'Bienvenida', body: 'Hola, esto es el inicio.' })
  })
  let project = useProjectStore.getState().project
  const startId = nodeIdOf(project, 'start')
  const contentId = nodeIdOf(project, 'content')
  act(() => {
    useProjectStore.getState().connect(startId, contentId)
    useProjectStore.getState().createNode('decision', { x: 200, y: 0 }, { title: '¿Qué eliges?' })
  })
  project = useProjectStore.getState().project
  const decisionId = nodeIdOf(project, 'decision')
  act(() => {
    useProjectStore.getState().connect(contentId, decisionId)
    useProjectStore.getState().createNode('final', { x: 300, y: 0 }, { title: 'Fin A', body: 'Llegaste al final A.' })
  })
  project = useProjectStore.getState().project
  const finalId = nodeIdOf(project, 'final')
  const decisionNode = project.graph.nodes.find((node) => node.id === decisionId)
  const responses = decisionNode?.type === 'decision' ? decisionNode.responses : []
  const responseA = responses.find((response) => response.letter === 'A')
  if (!responseA) throw new Error('setup inválido')
  act(() => {
    useProjectStore.getState().updateResponse(decisionId, responseA.id, { text: 'Camino A' })
    useProjectStore.getState().connect(decisionId, finalId, responseA.id)
  })

  return { contentId, decisionId, finalId, responseAId: responseA.id }
}

/** Importa un asset "de mentira" en un `MemoryAssetRepository` y devuelve su
 *  id — mismo patrón que los tests de `Inspector`, sin pasar por ningún
 *  diálogo nativo ni backend Tauri real. */
async function importFakeAsset(
  assetRepository: MemoryAssetRepository,
  sourcePath: string,
  bytes: number[],
  mimeType: string,
): Promise<string> {
  assetRepository.registerSourceFile(sourcePath, new Uint8Array(bytes), mimeType)
  const meta = await assetRepository.importAsset(TEST_FILE_PATH, sourcePath)
  return meta.id
}

beforeEach(() => {
  resetProjectStore()
})

describe('PlayerScreen', () => {
  it('muestra la pantalla con su contenido y avanza al pulsar Continuar', () => {
    buildGraphInStore()
    renderPlayer()

    expect(screen.getByText('Bienvenida')).toBeInTheDocument()
    expect(screen.getByText('Hola, esto es el inicio.')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Continuar'))

    expect(screen.getByText('¿Qué eliges?')).toBeInTheDocument()
  })

  it('muestra las opciones de una Decisión con su texto y avanza según la elegida', () => {
    buildGraphInStore()
    renderPlayer()

    fireEvent.click(screen.getByText('Continuar'))
    expect(screen.getByText('Camino A')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Camino A'))

    expect(screen.getByText('Fin de la experiencia')).toBeInTheDocument()
    expect(screen.getByText('Llegaste al final A.')).toBeInTheDocument()
  })

  it('muestra el mensaje de Final', () => {
    buildGraphInStore()
    renderPlayer()

    fireEvent.click(screen.getByText('Continuar'))
    fireEvent.click(screen.getByText('Camino A'))

    expect(screen.getByText('Fin de la experiencia')).toBeInTheDocument()
  })

  it('"Reiniciar experiencia" vuelve al principio dentro del propio Player', () => {
    buildGraphInStore()
    renderPlayer()

    fireEvent.click(screen.getByText('Continuar'))
    expect(screen.getByText('¿Qué eliges?')).toBeInTheDocument()

    fireEvent.click(screen.getByText('↺ Reiniciar experiencia'))

    expect(screen.getByText('Bienvenida')).toBeInTheDocument()
  })

  it('"Volver al editor" llama a setPreviewMode(false)', () => {
    buildGraphInStore()
    act(() => {
      useProjectStore.getState().setPreviewMode(true)
    })
    renderPlayer()

    fireEvent.click(screen.getByText('← Volver al editor'))

    expect(useProjectStore.getState().ui.previewMode).toBe(false)
  })

  it('muestra el aviso de "sin continuación" cuando el recorrido llega a un callejón sin salida', () => {
    act(() => {
      useProjectStore.getState().createNode('content', { x: 100, y: 0 }, { title: 'Pantalla suelta' })
    })
    const project = useProjectStore.getState().project
    const startId = nodeIdOf(project, 'start')
    const contentId = nodeIdOf(project, 'content')
    act(() => {
      useProjectStore.getState().connect(startId, contentId)
      // Deliberadamente sin conectar la pantalla a ningún destino.
    })

    renderPlayer()

    expect(
      screen.getByText(/todavía no tiene una continuación configurada/i),
    ).toBeInTheDocument()
    // Los controles permanentes siguen visibles incluso en el callejón sin salida.
    expect(screen.getByText('↺ Reiniciar experiencia')).toBeInTheDocument()
    expect(screen.getByText('← Volver al editor')).toBeInTheDocument()
  })

  it('lee el project real del store (no una copia): refleja exactamente los nodos/textos creados', () => {
    const project = createProject('Mi proyecto de prueba')
    act(() => {
      useProjectStore.getState().loadProject(project)
      useProjectStore
        .getState()
        .createNode('content', { x: 50, y: 0 }, { title: 'Título exacto', body: 'Cuerpo exacto' })
    })
    const withContent = useProjectStore.getState().project
    const startId = nodeIdOf(withContent, 'start')
    const contentId = nodeIdOf(withContent, 'content')
    // Se conecta la pantalla a un final para que tenga destino configurado
    // (si no, el Player la trataría como callejón sin salida, un caso
    // distinto ya cubierto por otro test) y así se puede comprobar que
    // muestra exactamente el título/body reales del documento.
    act(() => {
      useProjectStore.getState().connect(startId, contentId)
      useProjectStore.getState().createNode('final', { x: 150, y: 0 })
    })
    const withFinal = useProjectStore.getState().project
    const finalId = nodeIdOf(withFinal, 'final')
    act(() => {
      useProjectStore.getState().connect(contentId, finalId)
    })

    renderPlayer()

    expect(screen.getByText('Título exacto')).toBeInTheDocument()
    expect(screen.getByText('Cuerpo exacto')).toBeInTheDocument()
    // Y el propio documento del store sigue siendo el mismo objeto de
    // proyecto (mismo id de metadata) que el Player está leyendo.
    expect(useProjectStore.getState().project.metadata.name).toBe('Mi proyecto de prueba')
  })
})

describe('PlayerScreen: texto enriquecido del body (fase 5, Milestone 2)', () => {
  it('un body en texto enriquecido (negrita + lista) se muestra formateado, no como JSON en crudo', async () => {
    const richBody = serializeRichBody({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Importante' },
            { type: 'text', text: ': lee esto con atención.' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Primer punto' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Segundo punto' }] }] },
          ],
        },
      ],
    })

    act(() => {
      useProjectStore
        .getState()
        .createNode('content', { x: 100, y: 0 }, { title: 'Pantalla enriquecida', body: richBody })
    })
    let project = useProjectStore.getState().project
    const startId = nodeIdOf(project, 'start')
    const contentId = nodeIdOf(project, 'content')
    act(() => {
      useProjectStore.getState().connect(startId, contentId)
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    project = useProjectStore.getState().project
    const finalId = nodeIdOf(project, 'final')
    act(() => {
      useProjectStore.getState().connect(contentId, finalId)
    })

    const { container } = renderPlayer()

    await waitFor(() => {
      expect(screen.getByText('Importante')).toBeInTheDocument()
    })
    // Renderizado real por Tiptap (negrita como <strong>, no un mero texto
    // "**Importante**" ni el JSON serializado en crudo).
    expect(container.querySelector('strong')?.textContent).toBe('Importante')
    expect(screen.getByText('Primer punto')).toBeInTheDocument()
    expect(screen.getByText('Segundo punto')).toBeInTheDocument()
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(screen.queryByText(/"type":"doc"/)).not.toBeInTheDocument()
  })

  it('un body en texto plano histórico (sin pasar por Tiptap) se muestra igual de bien', async () => {
    act(() => {
      useProjectStore
        .getState()
        .createNode('content', { x: 100, y: 0 }, { title: 'Pantalla histórica', body: 'Texto plano de siempre.' })
    })
    let project = useProjectStore.getState().project
    const startId = nodeIdOf(project, 'start')
    const contentId = nodeIdOf(project, 'content')
    act(() => {
      useProjectStore.getState().connect(startId, contentId)
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    project = useProjectStore.getState().project
    const finalId = nodeIdOf(project, 'final')
    act(() => {
      useProjectStore.getState().connect(contentId, finalId)
    })

    renderPlayer()

    await waitFor(() => {
      expect(screen.getByText('Texto plano de siempre.')).toBeInTheDocument()
    })
  })
})

describe('PlayerScreen: imagen/audio adjuntos (fase 5, Milestone 2)', () => {
  it('la imagen y el audio de un nodo se cargan y se muestran', async () => {
    const assetRepository = new MemoryAssetRepository()
    const imageId = await importFakeAsset(assetRepository, '/tmp/foto.png', [1, 2, 3], 'image/png')
    const audioId = await importFakeAsset(assetRepository, '/tmp/audio.mp3', [4, 5, 6], 'audio/mpeg')

    act(() => {
      useProjectStore.getState().createNode('content', { x: 100, y: 0 }, { title: 'Con media' })
    })
    let project = useProjectStore.getState().project
    const startId = nodeIdOf(project, 'start')
    const contentId = nodeIdOf(project, 'content')
    act(() => {
      useProjectStore.getState().connect(startId, contentId)
      useProjectStore
        .getState()
        .updateNode(contentId, { imageAssetId: imageId, audioAssetId: audioId })
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    project = useProjectStore.getState().project
    const finalId = nodeIdOf(project, 'final')
    act(() => {
      useProjectStore.getState().connect(contentId, finalId)
    })

    const { container } = renderPlayer({ assetRepository })

    await waitFor(() => {
      const img = screen.getByAltText('Imagen de esta pantalla') as HTMLImageElement
      expect(img.getAttribute('src')).toContain('data:image/png;base64,')
    })
    await waitFor(() => {
      const audio = container.querySelector('audio')
      expect(audio?.getAttribute('src')).toContain('data:audio/mpeg;base64,')
    })
  })

  it('la imagen y el audio de una respuesta de Decisión se muestran junto a la opción', async () => {
    const assetRepository = new MemoryAssetRepository()
    const imageId = await importFakeAsset(assetRepository, '/tmp/foto-b.png', [7, 8, 9], 'image/png')

    act(() => {
      useProjectStore.getState().createNode('decision', { x: 100, y: 0 }, { title: '¿Qué eliges?' })
    })
    let project = useProjectStore.getState().project
    const startId = nodeIdOf(project, 'start')
    const decisionId = nodeIdOf(project, 'decision')
    act(() => {
      useProjectStore.getState().connect(startId, decisionId)
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    project = useProjectStore.getState().project
    const finalId = nodeIdOf(project, 'final')
    const decisionNode = project.graph.nodes.find((node) => node.id === decisionId)
    const responseA =
      decisionNode?.type === 'decision' ? decisionNode.responses.find((r) => r.letter === 'A') : undefined
    if (!responseA) throw new Error('setup inválido')
    act(() => {
      useProjectStore
        .getState()
        .updateResponse(decisionId, responseA.id, { text: 'Opción con imagen', imageAssetId: imageId })
      useProjectStore.getState().connect(decisionId, finalId, responseA.id)
    })

    renderPlayer({ assetRepository })

    expect(screen.getByText('Opción con imagen')).toBeInTheDocument()
    await waitFor(() => {
      const img = screen.getByAltText('Imagen de la respuesta A') as HTMLImageElement
      expect(img.getAttribute('src')).toContain('data:image/png;base64,')
    })
  })

  it('un fallo al cargar un asset no rompe el resto de la pantalla', async () => {
    const failingAssetRepository: AppServices['assetRepository'] = {
      importAsset: async () => {
        throw new Error('no debería llamarse en este test')
      },
      getAsset: async () => {
        throw new Error('fallo simulado de carga de asset')
      },
    }

    act(() => {
      useProjectStore
        .getState()
        .createNode('content', { x: 100, y: 0 }, { title: 'Pantalla con media rota', body: 'El texto sigue aquí.' })
    })
    let project = useProjectStore.getState().project
    const startId = nodeIdOf(project, 'start')
    const contentId = nodeIdOf(project, 'content')
    act(() => {
      useProjectStore.getState().connect(startId, contentId)
      useProjectStore.getState().updateNode(contentId, { imageAssetId: 'asset-inexistente' })
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    project = useProjectStore.getState().project
    const finalId = nodeIdOf(project, 'final')
    act(() => {
      useProjectStore.getState().connect(contentId, finalId)
    })

    renderPlayer({ assetRepository: failingAssetRepository })

    // El texto y los controles de navegación siguen presentes aunque el
    // asset no cargue nunca.
    await waitFor(() => {
      expect(screen.getByText('El texto sigue aquí.')).toBeInTheDocument()
    })
    expect(screen.getByText('Continuar')).toBeInTheDocument()
    expect(screen.getByText('↺ Reiniciar experiencia')).toBeInTheDocument()
    expect(screen.queryByAltText('Imagen de esta pantalla')).not.toBeInTheDocument()
  })
})

describe('PlayerScreen: puntuación acumulada (fase 5, Milestone 2)', () => {
  function buildGraphWithPoints() {
    act(() => {
      useProjectStore.getState().createNode('decision', { x: 100, y: 0 }, { title: '¿Qué eliges?' })
    })
    let project = useProjectStore.getState().project
    const startId = nodeIdOf(project, 'start')
    const decisionId = nodeIdOf(project, 'decision')
    act(() => {
      useProjectStore.getState().connect(startId, decisionId)
      useProjectStore.getState().createNode('final', { x: 200, y: 0 }, { title: 'Fin' })
    })
    project = useProjectStore.getState().project
    const finalId = nodeIdOf(project, 'final')
    const decisionNode = project.graph.nodes.find((node) => node.id === decisionId)
    const responses = decisionNode?.type === 'decision' ? decisionNode.responses : []
    const responseA = responses.find((r) => r.letter === 'A')
    if (!responseA) throw new Error('setup inválido')
    act(() => {
      useProjectStore.getState().connect(decisionId, finalId, responseA.id)
    })
    return { decisionId, finalId, responseAId: responseA.id }
  }

  it('al llegar a un Final con puntuación acumulada, se muestra esa puntuación', () => {
    const { decisionId, responseAId } = buildGraphWithPoints()
    act(() => {
      useProjectStore.getState().updateResponse(decisionId, responseAId, { text: 'Camino con puntos', points: 7 })
    })

    renderPlayer()

    fireEvent.click(screen.getByText('Camino con puntos'))

    expect(screen.getByText('Fin de la experiencia')).toBeInTheDocument()
    expect(screen.getByText('Puntuación final: 7 puntos')).toBeInTheDocument()
  })

  it('si ninguna respuesta elegida en el camino tenía "points", no se muestra ninguna puntuación', () => {
    const { decisionId, responseAId } = buildGraphWithPoints()
    // La respuesta se deja deliberadamente sin "points" configurado, con un
    // texto propio para poder elegirla sin ambigüedad (la respuesta B, sin
    // destino configurado, comparte el texto por defecto "Opción sin texto
    // configurado" y no es pulsable).
    act(() => {
      useProjectStore.getState().updateResponse(decisionId, responseAId, { text: 'Camino sin puntos' })
    })

    renderPlayer()

    fireEvent.click(screen.getByText('Camino sin puntos'))

    expect(screen.getByText('Fin de la experiencia')).toBeInTheDocument()
    expect(screen.queryByText(/Puntuación final/)).not.toBeInTheDocument()
  })
})
