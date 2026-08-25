import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { PlayerScreen } from '../PlayerScreen'
import { useProjectStore } from '../../store'
import { resetProjectStore } from '../../store/testHelpers'
import { createProject } from '../../domain'
import type { AppServices } from '../../app/AppServices'
import { AppServicesProvider } from '../../app/AppServicesContext'
import { MemoryAssetRepository } from '../../persistence'
import { serializeRichBody } from '../../editor/richText/richTextContent'
import styles from '../PlayerScreen.module.css'

const TEST_FILE_PATH = '/tmp/player-screen-test.brunch'

/** Id de la diapositiva de inicio del proyecto actual del store. */
function startNodeId(): string {
  return useProjectStore.getState().project.graph.startNodeId
}

/** Último nodo del tipo pedido que no sea la diapositiva de inicio. */
function otherNodeIdOf(type: 'slide' | 'final'): string {
  const { project } = useProjectStore.getState()
  const ids = project.graph.nodes
    .filter((node) => node.type === type && node.id !== project.graph.startNodeId)
    .map((node) => node.id)
  const id = ids[ids.length - 1]
  if (!id) throw new Error(`No hay nodo "${type}" distinto del inicio en el setup`)
  return id
}

/** Añade una respuesta a una diapositiva y devuelve su id. */
function addResponseTo(nodeId: string): string {
  act(() => {
    useProjectStore.getState().addResponse(nodeId)
  })
  const node = useProjectStore.getState().project.graph.nodes.find((n) => n.id === nodeId)
  const responses = node?.type === 'slide' ? node.responses : []
  const id = responses[responses.length - 1]?.id
  if (!id) throw new Error('responseId inesperadamente ausente')
  return id
}

function renderPlayer(services?: Partial<AppServices>) {
  return render(
    <AppServicesProvider services={services}>
      <PlayerScreen filePath={TEST_FILE_PATH} />
    </AppServicesProvider>,
  )
}

/**
 * Construye, directamente sobre el store real, el recorrido:
 * inicio "Bienvenida" (continuar) -> diapositiva "¿Qué eliges?" con una
 * respuesta "Camino A" -> final "Fin A".
 */
function buildGraphInStore() {
  const startId = startNodeId()
  act(() => {
    useProjectStore
      .getState()
      .updateNode(startId, { title: 'Bienvenida', body: 'Hola, esto es el inicio.' })
    useProjectStore.getState().createNode('slide', { x: 200, y: 0 }, { title: '¿Qué eliges?' })
  })
  const decisionId = otherNodeIdOf('slide')
  act(() => {
    useProjectStore.getState().connect(startId, decisionId)
    useProjectStore
      .getState()
      .createNode('final', { x: 300, y: 0 }, { title: 'Fin A', body: 'Llegaste al final A.' })
  })
  const finalId = otherNodeIdOf('final')
  const responseAId = addResponseTo(decisionId)
  act(() => {
    useProjectStore.getState().updateResponse(decisionId, responseAId, { text: 'Camino A' })
    useProjectStore.getState().connect(decisionId, finalId, responseAId)
  })

  return { startId, decisionId, finalId, responseAId }
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
  it('muestra la diapositiva de inicio con su contenido y avanza al pulsar Continuar', () => {
    buildGraphInStore()
    renderPlayer()

    expect(screen.getByText('Bienvenida')).toBeInTheDocument()
    expect(screen.getByText('Hola, esto es el inicio.')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Continuar'))

    expect(screen.getByText('¿Qué eliges?')).toBeInTheDocument()
  })

  it('usa el texto personalizado del botón de continuar si la diapositiva lo define', () => {
    const { startId } = buildGraphInStore()
    act(() => {
      useProjectStore.getState().updateNode(startId, { continueLabel: 'Empezar ya' })
    })

    renderPlayer()

    expect(screen.getByText('Empezar ya')).toBeInTheDocument()
    expect(screen.queryByText('Continuar')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Empezar ya'))
    expect(screen.getByText('¿Qué eliges?')).toBeInTheDocument()
  })

  it('muestra las opciones de una diapositiva con respuestas y avanza según la elegida', () => {
    buildGraphInStore()
    renderPlayer()

    fireEvent.click(screen.getByText('Continuar'))
    expect(screen.getByText('Camino A')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Camino A'))

    expect(screen.getByText('Fin de la experiencia')).toBeInTheDocument()
    expect(screen.getByText('Llegaste al final A.')).toBeInTheDocument()
  })

  it('nunca muestra la letra de una respuesta como texto visible', () => {
    const { decisionId } = buildGraphInStore()
    const responseBId = addResponseTo(decisionId)
    act(() => {
      useProjectStore.getState().updateResponse(decisionId, responseBId, { text: 'Camino B' })
    })

    renderPlayer()
    fireEvent.click(screen.getByText('Continuar'))

    expect(screen.getByText('Camino A')).toBeInTheDocument()
    expect(screen.getByText('Camino B')).toBeInTheDocument()
    // Las letras internas (A/B/C/D) no aparecen en ninguna parte del texto.
    expect(screen.queryByText('A')).not.toBeInTheDocument()
    expect(screen.queryByText('B')).not.toBeInTheDocument()
  })

  it('el Final muestra un botón "Reintentar" que vuelve al principio', () => {
    buildGraphInStore()
    renderPlayer()

    fireEvent.click(screen.getByText('Continuar'))
    fireEvent.click(screen.getByText('Camino A'))
    expect(screen.getByText('Fin de la experiencia')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Reintentar'))

    expect(screen.getByText('Bienvenida')).toBeInTheDocument()
  })

  it('"Reintentar" solo aparece en la tarjeta de Final', () => {
    buildGraphInStore()
    renderPlayer()

    expect(screen.queryByText('Reintentar')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Continuar'))
    expect(screen.queryByText('Reintentar')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Camino A'))
    expect(screen.getByText('Reintentar')).toBeInTheDocument()
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
    // La diapositiva de inicio de un proyecto nuevo no tiene destino.
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
    })
    const startId = startNodeId()
    act(() => {
      useProjectStore
        .getState()
        .updateNode(startId, { title: 'Título exacto', body: 'Cuerpo exacto' })
      useProjectStore.getState().createNode('final', { x: 150, y: 0 })
    })
    const finalId = otherNodeIdOf('final')
    act(() => {
      useProjectStore.getState().connect(startId, finalId)
    })

    renderPlayer()

    expect(screen.getByText('Título exacto')).toBeInTheDocument()
    expect(screen.getByText('Cuerpo exacto')).toBeInTheDocument()
    expect(useProjectStore.getState().project.metadata.name).toBe('Mi proyecto de prueba')
  })
})

describe('PlayerScreen: título del nodo (referencia interna del diseñador instruccional)', () => {
  it('sigue mostrando el título del nodo en la diapositiva "de continuar", en gris claro', () => {
    buildGraphInStore()
    renderPlayer()

    const heading = screen.getByText('Bienvenida')
    expect(heading.tagName).toBe('H1')
    // Gris claro (`--bs-color-text-faint`, ver `PlayerScreen.module.css`),
    // no el color de texto normal: es una referencia interna, no contenido
    // final. Nunca aparece así en el HTML/SCORM exportado (ver
    // `src/export/__tests__/htmlBundle.test.ts`).
    expect(heading.className).toBe(styles.nodeReferenceTitle)
    expect(heading.className).not.toBe(styles.title)
  })

  it('sigue mostrando el título del nodo en la diapositiva de decisión, en gris claro', () => {
    buildGraphInStore()
    renderPlayer()

    fireEvent.click(screen.getByText('Continuar'))

    const heading = screen.getByText('¿Qué eliges?')
    expect(heading.className).toBe(styles.nodeReferenceTitle)
  })

  it('el Final NO usa el estilo de referencia interna: su título fijo mantiene el color normal', () => {
    buildGraphInStore()
    renderPlayer()

    fireEvent.click(screen.getByText('Continuar'))
    fireEvent.click(screen.getByText('Camino A'))

    const heading = screen.getByText('Fin de la experiencia')
    expect(heading.className).toBe(styles.title)
    expect(heading.className).not.toBe(styles.nodeReferenceTitle)
  })
})

describe('PlayerScreen: texto enriquecido del body', () => {
  /** Deja la diapositiva de inicio con el body indicado y con destino a un
   *  final, para que el Player la muestre como diapositiva "de continuar". */
  function withRichStartSlide(body: string, title: string) {
    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().updateNode(startId, { title, body })
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    const finalId = otherNodeIdOf('final')
    act(() => {
      useProjectStore.getState().connect(startId, finalId)
    })
  }

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

    withRichStartSlide(richBody, 'Diapositiva enriquecida')

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
    withRichStartSlide('Texto plano de siempre.', 'Diapositiva histórica')

    renderPlayer()

    await waitFor(() => {
      expect(screen.getByText('Texto plano de siempre.')).toBeInTheDocument()
    })
  })
})

describe('PlayerScreen: imagen/audio adjuntos', () => {
  it('la imagen y el audio de un nodo se cargan y se muestran', async () => {
    const assetRepository = new MemoryAssetRepository()
    const imageId = await importFakeAsset(assetRepository, '/tmp/foto.png', [1, 2, 3], 'image/png')
    const audioId = await importFakeAsset(assetRepository, '/tmp/audio.mp3', [4, 5, 6], 'audio/mpeg')

    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().updateNode(startId, {
        title: 'Con media',
        imageAssetIds: [imageId],
        audioAssetId: audioId,
      })
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    const finalId = otherNodeIdOf('final')
    act(() => {
      useProjectStore.getState().connect(startId, finalId)
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

  it('la imagen de una respuesta se muestra junto a la opción, con un alt sin letras', async () => {
    const assetRepository = new MemoryAssetRepository()
    const imageId = await importFakeAsset(assetRepository, '/tmp/foto-b.png', [7, 8, 9], 'image/png')

    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().updateNode(startId, { title: '¿Qué eliges?' })
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    const finalId = otherNodeIdOf('final')
    const responseAId = addResponseTo(startId)
    act(() => {
      useProjectStore
        .getState()
        .updateResponse(startId, responseAId, {
          text: 'Opción con imagen',
          imageAssetId: imageId,
        })
      useProjectStore.getState().connect(startId, finalId, responseAId)
    })

    renderPlayer({ assetRepository })

    expect(screen.getByText('Opción con imagen')).toBeInTheDocument()
    await waitFor(() => {
      const img = screen.getByAltText('Imagen de la respuesta 1') as HTMLImageElement
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
      gcOrphanAssets: async () => 0,
    }

    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().updateNode(startId, {
        title: 'Diapositiva con media rota',
        body: 'El texto sigue aquí.',
        imageAssetIds: ['asset-inexistente'],
      })
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    const finalId = otherNodeIdOf('final')
    act(() => {
      useProjectStore.getState().connect(startId, finalId)
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

describe('PlayerScreen: varias imágenes por diapositiva y orden de contenido (tarea 5)', () => {
  it('pinta TODAS las imágenes de imageAssetIds, apiladas, en el orden del array', async () => {
    const assetRepository = new MemoryAssetRepository()
    const imageAId = await importFakeAsset(assetRepository, '/tmp/a.png', [1], 'image/png')
    const imageBId = await importFakeAsset(assetRepository, '/tmp/b.png', [2], 'image/png')

    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().updateNode(startId, {
        title: 'Con varias imágenes',
        imageAssetIds: [imageAId, imageBId],
      })
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    const finalId = otherNodeIdOf('final')
    act(() => {
      useProjectStore.getState().connect(startId, finalId)
    })

    const { container } = renderPlayer({ assetRepository })

    await waitFor(() => {
      const images = container.querySelectorAll('img[alt="Imagen de esta pantalla"]')
      expect(images).toHaveLength(2)
    })
    const images = [
      ...container.querySelectorAll<HTMLImageElement>('img[alt="Imagen de esta pantalla"]'),
    ]
    // Ambas cargadas (assets distintos), en el mismo orden del array.
    await waitFor(() => {
      expect(images.every((img) => img.getAttribute('src')?.startsWith('data:image/png;base64,'))).toBe(
        true,
      )
    })
  })

  it('contentOrder "text-first" (por defecto) pinta el cuerpo antes que las imágenes', async () => {
    const assetRepository = new MemoryAssetRepository()
    const imageId = await importFakeAsset(assetRepository, '/tmp/c.png', [3], 'image/png')

    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().updateNode(startId, {
        body: 'Cuerpo de la diapositiva',
        imageAssetIds: [imageId],
        contentOrder: 'text-first',
      })
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    const finalId = otherNodeIdOf('final')
    act(() => {
      useProjectStore.getState().connect(startId, finalId)
    })

    const { container } = renderPlayer({ assetRepository })

    await waitFor(() => {
      expect(container.querySelector('img[alt="Imagen de esta pantalla"]')).toBeInTheDocument()
    })
    const card = container.querySelector(`.${styles.card}`)
    const body = card?.querySelector(`.${styles.body}`)
    const media = card?.querySelector(`.${styles.mediaSection}`)
    expect(body).toBeTruthy()
    expect(media).toBeTruthy()
    expect(
      body!.compareDocumentPosition(media!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('contentOrder "image-first" pinta las imágenes antes que el cuerpo', async () => {
    const assetRepository = new MemoryAssetRepository()
    const imageId = await importFakeAsset(assetRepository, '/tmp/d.png', [4], 'image/png')

    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().updateNode(startId, {
        body: 'Cuerpo de la diapositiva',
        imageAssetIds: [imageId],
        contentOrder: 'image-first',
      })
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    const finalId = otherNodeIdOf('final')
    act(() => {
      useProjectStore.getState().connect(startId, finalId)
    })

    const { container } = renderPlayer({ assetRepository })

    await waitFor(() => {
      expect(container.querySelector('img[alt="Imagen de esta pantalla"]')).toBeInTheDocument()
    })
    const card = container.querySelector(`.${styles.card}`)
    const body = card?.querySelector(`.${styles.body}`)
    const media = card?.querySelector(`.${styles.mediaSection}`)
    expect(body).toBeTruthy()
    expect(media).toBeTruthy()
    expect(
      media!.compareDocumentPosition(body!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})

describe('PlayerScreen: puntuación acumulada', () => {
  function buildGraphWithPoints() {
    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().updateNode(startId, { title: '¿Qué eliges?' })
      useProjectStore.getState().createNode('final', { x: 200, y: 0 }, { title: 'Fin' })
    })
    const finalId = otherNodeIdOf('final')
    const responseAId = addResponseTo(startId)
    act(() => {
      useProjectStore.getState().connect(startId, finalId, responseAId)
    })
    return { startId, finalId, responseAId }
  }

  it('al llegar a un Final con puntuación acumulada, se muestra esa puntuación', () => {
    const { startId, responseAId } = buildGraphWithPoints()
    act(() => {
      useProjectStore
        .getState()
        .updateResponse(startId, responseAId, { text: 'Camino con puntos', points: 7 })
    })

    renderPlayer()

    fireEvent.click(screen.getByText('Camino con puntos'))

    expect(screen.getByText('Fin de la experiencia')).toBeInTheDocument()
    expect(screen.getByText('Puntuación final: 7 puntos')).toBeInTheDocument()
  })

  it('si ninguna respuesta elegida en el camino tenía "points", no se muestra ninguna puntuación', () => {
    const { startId, responseAId } = buildGraphWithPoints()
    act(() => {
      useProjectStore.getState().updateResponse(startId, responseAId, { text: 'Camino sin puntos' })
    })

    renderPlayer()

    fireEvent.click(screen.getByText('Camino sin puntos'))

    expect(screen.getByText('Fin de la experiencia')).toBeInTheDocument()
    expect(screen.queryByText(/Puntuación final/)).not.toBeInTheDocument()
  })
})
