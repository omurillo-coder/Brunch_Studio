import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerScreen } from '../PlayerScreen'
import { useProjectStore } from '../../store'
import { resetProjectStore } from '../../store/testHelpers'
import { CICLOS, cicloOutputName, createProject } from '../../domain'
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

/** Id del bloque de `content` de una diapositiva en la posición `index`. */
function contentBlockIdAt(nodeId: string, index: number): string {
  const node = useProjectStore.getState().project.graph.nodes.find((n) => n.id === nodeId)
  const content = node?.type === 'slide' ? node.content : []
  const id = content[index]?.id
  if (!id) throw new Error(`No hay ningún bloque de content en el índice ${index} de "${nodeId}"`)
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
  const startBlockId = contentBlockIdAt(startId, 0)
  act(() => {
    useProjectStore.getState().updateNode(startId, { title: 'Bienvenida' })
    useProjectStore
      .getState()
      .updateTextBlockBody(startId, startBlockId, 'Hola, esto es el inicio.')
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

  it('"Reintentar" solo aparece en la tarjeta de Final, con el mismo estilo de acento que "Continuar"', () => {
    buildGraphInStore()
    renderPlayer()

    expect(screen.queryByText('Reintentar')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Continuar'))
    expect(screen.queryByText('Reintentar')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Camino A'))
    const replayButton = screen.getByText('Reintentar')
    expect(replayButton).toBeInTheDocument()
    expect(replayButton.className).toBe(styles.primaryButton)
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

  describe('"Probar desde aquí" (ui.previewStartNodeId)', () => {
    it('arranca en el nodo del override en vez de en graph.startNodeId', () => {
      const { decisionId } = buildGraphInStore()
      act(() => {
        useProjectStore.getState().setPreviewMode(true, decisionId)
      })

      renderPlayer()

      // Muestra directamente la diapositiva de decisión, no la de inicio
      // ("Bienvenida").
      expect(screen.getByText('¿Qué eliges?')).toBeInTheDocument()
      expect(screen.queryByText('Bienvenida')).not.toBeInTheDocument()
    })

    it('"Reiniciar experiencia" vuelve al mismo nodo del override, no a graph.startNodeId', () => {
      const { decisionId, finalId } = buildGraphInStore()
      act(() => {
        useProjectStore.getState().setPreviewMode(true, decisionId)
      })
      renderPlayer()

      fireEvent.click(screen.getByText('Camino A'))
      expect(screen.getByText('Fin de la experiencia')).toBeInTheDocument()
      expect(finalId).toBeTruthy()

      fireEvent.click(screen.getByText('↺ Reiniciar experiencia'))

      expect(screen.getByText('¿Qué eliges?')).toBeInTheDocument()
      expect(screen.queryByText('Bienvenida')).not.toBeInTheDocument()
    })

    it('sin override (botón normal "▶ Probar"), arranca en graph.startNodeId como siempre', () => {
      buildGraphInStore()
      act(() => {
        useProjectStore.getState().setPreviewMode(true)
      })

      renderPlayer()

      expect(screen.getByText('Bienvenida')).toBeInTheDocument()
    })
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
    const startBlockId = contentBlockIdAt(startId, 0)
    act(() => {
      useProjectStore.getState().updateNode(startId, { title: 'Título exacto' })
      useProjectStore.getState().updateTextBlockBody(startId, startBlockId, 'Cuerpo exacto')
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
    const startBlockId = contentBlockIdAt(startId, 0)
    act(() => {
      useProjectStore.getState().updateNode(startId, { title })
      useProjectStore.getState().updateTextBlockBody(startId, startBlockId, body)
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
  it('el vídeo de un nodo se carga y se muestra con controles nativos, sin desbordar la tarjeta (clase "media")', async () => {
    const assetRepository = new MemoryAssetRepository()
    const videoId = await importFakeAsset(assetRepository, '/tmp/clip.mp4', [1, 2, 3], 'video/mp4')

    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().updateNode(startId, { title: 'Con vídeo' })
      useProjectStore.getState().addVideoBlock(startId, videoId)
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    const finalId = otherNodeIdOf('final')
    act(() => {
      useProjectStore.getState().connect(startId, finalId)
    })

    const { container } = renderPlayer({ assetRepository })

    await waitFor(() => {
      const video = container.querySelector('video')
      expect(video?.getAttribute('src')).toContain('data:video/mp4;base64,')
      expect(video?.controls).toBe(true)
      expect(video?.classList.contains(styles.media ?? '')).toBe(true)
    })
  })

  it('la imagen y el audio de un nodo se cargan y se muestran', async () => {
    const assetRepository = new MemoryAssetRepository()
    const imageId = await importFakeAsset(assetRepository, '/tmp/foto.png', [1, 2, 3], 'image/png')
    const audioId = await importFakeAsset(assetRepository, '/tmp/audio.mp3', [4, 5, 6], 'audio/mpeg')

    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().updateNode(startId, { title: 'Con media' })
      useProjectStore.getState().addImageBlock(startId, imageId)
      useProjectStore.getState().addAudioBlock(startId, audioId)
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

  it('la imagen de una respuesta es descendiente del contenedor de ESA respuesta (.option), no un hermano suelto después de él', async () => {
    // Bug reportado: la imagen de una respuesta se percibía "a continuación"
    // de la opción en vez de "dentro" de ella. La causa era puramente visual
    // (el borde de tarjeta vivía en `.optionButton`, no en `.option` — ver
    // `PlayerScreen.module.css`), pero este test fija además el contrato de
    // ESTRUCTURA que ese arreglo visual da por hecho: la imagen debe colgar
    // del mismo `.option` que el botón de ESA respuesta concreta, nunca
    // aparecer como hijo directo de `.options` (la lista completa) ni de
    // ningún otro `.option`.
    const assetRepository = new MemoryAssetRepository()
    const imageId = await importFakeAsset(assetRepository, '/tmp/foto-c.png', [1, 2], 'image/png')

    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().updateNode(startId, { title: '¿Qué eliges?' })
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    const finalId = otherNodeIdOf('final')
    const responseAId = addResponseTo(startId)
    const responseBId = addResponseTo(startId)
    act(() => {
      useProjectStore
        .getState()
        .updateResponse(startId, responseAId, { text: 'Opción sin imagen' })
      useProjectStore
        .getState()
        .updateResponse(startId, responseBId, { text: 'Opción con imagen', imageAssetId: imageId })
      useProjectStore.getState().connect(startId, finalId, responseAId)
      useProjectStore.getState().connect(startId, finalId, responseBId)
    })

    const { container } = renderPlayer({ assetRepository })

    const img = await waitFor(() => screen.getByAltText('Imagen de la respuesta 2'))

    // Descendiente de SU `.option` (el contenedor de esa respuesta concreta).
    const optionContainer = img.closest(`.${styles.option}`)
    expect(optionContainer).not.toBeNull()

    // Ese mismo `.option` contiene también el botón de ESA respuesta (no de
    // otra): el texto y la imagen de una respuesta comparten un único
    // contenedor.
    const buttonInSameOption = optionContainer!.querySelector(`.${styles.optionButton}`)
    expect(buttonInSameOption?.textContent).toContain('Opción con imagen')

    // NO es un hijo directo de `.options` (la lista completa de opciones):
    // sigue anidada dentro de su propio `.option`, no colgada suelta después
    // de la lista entera.
    const optionsList = container.querySelector(`.${styles.options}`)
    expect(optionsList?.contains(img)).toBe(true)
    expect([...(optionsList?.children ?? [])]).not.toContain(img)
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
    const seededBlockId = contentBlockIdAt(startId, 0)

    act(() => {
      useProjectStore.getState().updateNode(startId, { title: 'Diapositiva con media rota' })
      useProjectStore.getState().updateTextBlockBody(startId, seededBlockId, 'El texto sigue aquí.')
      useProjectStore.getState().addImageBlock(startId, 'asset-inexistente')
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

describe('PlayerScreen: bloques de contenido de una diapositiva (milestone "Bloques de contenido")', () => {
  it('pinta TODAS las imágenes de imageAssetIds, apiladas, en el orden del array', async () => {
    const assetRepository = new MemoryAssetRepository()
    const imageAId = await importFakeAsset(assetRepository, '/tmp/a.png', [1], 'image/png')
    const imageBId = await importFakeAsset(assetRepository, '/tmp/b.png', [2], 'image/png')

    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().updateNode(startId, { title: 'Con varias imágenes' })
      useProjectStore.getState().addImageBlock(startId, imageAId)
      useProjectStore.getState().addImageBlock(startId, imageBId)
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
    // Ambas cargadas (assets distintos), en el mismo orden en que se añadieron.
    await waitFor(() => {
      expect(images.every((img) => img.getAttribute('src')?.startsWith('data:image/png;base64,'))).toBe(
        true,
      )
    })
  })

  it('pinta bloques de texto/imagen/audio intercalados, en el orden exacto en que se añadieron', async () => {
    const assetRepository = new MemoryAssetRepository()
    const imageId = await importFakeAsset(assetRepository, '/tmp/e.png', [5], 'image/png')
    const audioId = await importFakeAsset(assetRepository, '/tmp/e.mp3', [6], 'audio/mpeg')

    const startId = startNodeId()
    // La diapositiva nace con un único bloque de texto vacío (ver
    // `newSlideNode` en `src/domain/project.ts`): se reutiliza como PRIMER
    // bloque de texto en vez de añadir uno nuevo, así el orden final es
    // texto -> imagen -> texto -> audio.
    const seededBlockId = contentBlockIdAt(startId, 0)

    act(() => {
      useProjectStore.getState().updateTextBlockBody(startId, seededBlockId, 'Primer texto')
      useProjectStore.getState().addImageBlock(startId, imageId)
      useProjectStore.getState().addTextBlock(startId)
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })

    const secondTextBlockId = contentBlockIdAt(startId, 2)

    act(() => {
      useProjectStore.getState().updateTextBlockBody(startId, secondTextBlockId, 'Segundo texto')
      useProjectStore.getState().addAudioBlock(startId, audioId)
    })

    const finalId = otherNodeIdOf('final')
    act(() => {
      useProjectStore.getState().connect(startId, finalId)
    })

    const { container } = renderPlayer({ assetRepository })

    await waitFor(() => {
      expect(container.querySelector('audio')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(container.querySelector('audio')?.getAttribute('src')).toContain(
        'data:audio/mpeg;base64,',
      )
    })

    const card = container.querySelector(`.${styles.card}`)
    const elements = [
      ...(card?.querySelectorAll<HTMLElement>(`.${styles.body}, img, audio`) ?? []),
    ]
    // Orden exacto de `SlideNode.content`: texto, imagen, texto, audio.
    expect(elements.map((element) => element.tagName)).toEqual(['DIV', 'IMG', 'DIV', 'AUDIO'])
    expect(elements[0]?.textContent).toContain('Primer texto')
    expect(elements[2]?.textContent).toContain('Segundo texto')
  })

  it('pinta un bloque de vídeo intercalado con imagen/audio, en el orden exacto de content', async () => {
    const assetRepository = new MemoryAssetRepository()
    const imageId = await importFakeAsset(assetRepository, '/tmp/f.png', [5], 'image/png')
    const videoId = await importFakeAsset(assetRepository, '/tmp/f.mp4', [6], 'video/mp4')
    const audioId = await importFakeAsset(assetRepository, '/tmp/f.mp3', [7], 'audio/mpeg')

    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().addImageBlock(startId, imageId)
      useProjectStore.getState().addVideoBlock(startId, videoId)
      useProjectStore.getState().addAudioBlock(startId, audioId)
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    const finalId = otherNodeIdOf('final')
    act(() => {
      useProjectStore.getState().connect(startId, finalId)
    })

    const { container } = renderPlayer({ assetRepository })

    await waitFor(() => {
      expect(container.querySelector('video')).toBeInTheDocument()
    })

    const card = container.querySelector(`.${styles.card}`)
    const elements = [
      ...(card?.querySelectorAll<HTMLElement>(`.${styles.body}, img, video, audio`) ?? []),
    ]
    // El bloque de texto inicial sembrado por `createNode` va vacío (no se
    // rellenó), así que no pinta nada: solo imagen, vídeo, audio.
    expect(elements.map((element) => element.tagName)).toEqual(['IMG', 'VIDEO', 'AUDIO'])
  })
})

describe('PlayerScreen: imágenes ampliables + tamaño (petición de usuario)', () => {
  /** Diapositiva de inicio con un único bloque de imagen (assetId ya
   *  adjunto) conectada a un Final, lista para jugar — mismo patrón que el
   *  describe de "bloques de contenido" de arriba. */
  async function slideWithImageBlock() {
    const assetRepository = new MemoryAssetRepository()
    const imageId = await importFakeAsset(assetRepository, '/tmp/g.png', [9], 'image/png')

    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().addImageBlock(startId, imageId)
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    const finalId = otherNodeIdOf('final')
    act(() => {
      useProjectStore.getState().connect(startId, finalId)
    })
    const blockId = contentBlockIdAt(startId, 1)

    return { assetRepository, startId, blockId }
  }

  it('por defecto (sin tocar `expandable`), la imagen es ampliable: un clic abre el lightbox a pantalla completa', async () => {
    const { assetRepository } = await slideWithImageBlock()
    const { container } = renderPlayer({ assetRepository })

    const image = await screen.findByAltText('Imagen de esta pantalla')
    expect(image.closest('button')?.classList.contains(styles.expandableImage ?? '')).toBe(true)
    expect(container.querySelector(`.${styles.lightboxBackdrop}`)).not.toBeInTheDocument()

    fireEvent.click(image)

    const lightbox = container.querySelector(`.${styles.lightboxBackdrop}`)
    expect(lightbox).toBeInTheDocument()
    const lightboxImage = lightbox?.querySelector(`.${styles.lightboxImage}`)
    expect(lightboxImage?.getAttribute('src')).toBe(image.getAttribute('src'))
  })

  it('el lightbox se cierra al pulsar el fondo, el botón "×", o la tecla Escape', async () => {
    const { assetRepository } = await slideWithImageBlock()
    const { container } = renderPlayer({ assetRepository })

    const image = await screen.findByAltText('Imagen de esta pantalla')

    fireEvent.click(image)
    expect(container.querySelector(`.${styles.lightboxBackdrop}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar imagen ampliada' }))
    expect(container.querySelector(`.${styles.lightboxBackdrop}`)).not.toBeInTheDocument()

    fireEvent.click(image)
    expect(container.querySelector(`.${styles.lightboxBackdrop}`)).toBeInTheDocument()
    fireEvent.click(container.querySelector(`.${styles.lightboxBackdrop}`) as HTMLElement)
    expect(container.querySelector(`.${styles.lightboxBackdrop}`)).not.toBeInTheDocument()

    fireEvent.click(image)
    expect(container.querySelector(`.${styles.lightboxBackdrop}`)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(container.querySelector(`.${styles.lightboxBackdrop}`)).not.toBeInTheDocument()
  })

  it('pulsar la propia imagen dentro del lightbox no lo cierra (solo pulsar el fondo)', async () => {
    const { assetRepository } = await slideWithImageBlock()
    const { container } = renderPlayer({ assetRepository })

    fireEvent.click(await screen.findByAltText('Imagen de esta pantalla'))
    const lightboxImage = container.querySelector(`.${styles.lightboxImage}`) as HTMLElement
    fireEvent.click(lightboxImage)

    expect(container.querySelector(`.${styles.lightboxBackdrop}`)).toBeInTheDocument()
  })

  it('petición de usuario ("un botón... para hacer no ampliable la imagen"): `expandable: false` la deja como una imagen normal, sin botón ni lightbox', async () => {
    const { assetRepository, startId, blockId } = await slideWithImageBlock()
    act(() => {
      useProjectStore.getState().updateImageBlockOptions(startId, blockId, { expandable: false })
    })
    const { container } = renderPlayer({ assetRepository })

    const image = await screen.findByAltText('Imagen de esta pantalla')
    expect(image.closest('button')).toBeNull()

    fireEvent.click(image)
    expect(container.querySelector(`.${styles.lightboxBackdrop}`)).not.toBeInTheDocument()
  })

  it('petición de usuario ("un desplegable... Pequeño/Normal/Grande"): `size` fija la clase de tamaño de la imagen; sin `size` usa el tamaño normal de siempre', async () => {
    const { assetRepository, startId, blockId } = await slideWithImageBlock()
    act(() => {
      useProjectStore.getState().updateImageBlockOptions(startId, blockId, { size: 'large' })
    })
    const { container, rerender } = renderPlayer({ assetRepository })

    const large = await screen.findByAltText('Imagen de esta pantalla')
    expect(large.classList.contains(styles.mediaLarge ?? '')).toBe(true)
    expect(large.classList.contains(styles.mediaNormal ?? '')).toBe(false)

    act(() => {
      useProjectStore.getState().updateImageBlockOptions(startId, blockId, { size: null })
    })
    rerender(
      <AppServicesProvider services={{ assetRepository }}>
        <PlayerScreen filePath={TEST_FILE_PATH} />
      </AppServicesProvider>,
    )
    await waitFor(() => {
      expect(
        container
          .querySelector('img[alt="Imagen de esta pantalla"]')
          ?.classList.contains(styles.mediaNormal ?? ''),
      ).toBe(true)
    })
  })

  it('la imagen de una respuesta nunca es ampliable (no hay lightbox al pulsarla, solo elige la respuesta)', async () => {
    const assetRepository = new MemoryAssetRepository()
    const imageId = await importFakeAsset(assetRepository, '/tmp/h.png', [11], 'image/png')

    const startId = startNodeId()
    const responseId = addResponseTo(startId)
    act(() => {
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    const finalId = otherNodeIdOf('final')
    act(() => {
      useProjectStore.getState().connect(startId, finalId, responseId)
      useProjectStore.getState().updateResponse(startId, responseId, { imageAssetId: imageId })
    })

    const { container } = renderPlayer({ assetRepository })

    const image = await screen.findByAltText('Imagen de la respuesta 1')
    // La imagen vive DENTRO del botón de la propia opción (petición de
    // usuario: "responder... cuando haces clic en cualquier parte del
    // cuadro"), pero sin el wrapper `.expandableImage` propio del lightbox.
    expect(image.closest(`.${styles.expandableImage}`)).toBeNull()

    fireEvent.click(image)
    expect(container.querySelector(`.${styles.lightboxBackdrop}`)).not.toBeInTheDocument()
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

describe('PlayerScreen: botón "Salir" (vista Final)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Lleva el Player hasta la tarjeta de Final del recorrido de prueba. */
  function reachFinal() {
    buildGraphInStore()
    renderPlayer()
    fireEvent.click(screen.getByText('Continuar'))
    fireEvent.click(screen.getByText('Camino A'))
    expect(screen.getByText('Fin de la experiencia')).toBeInTheDocument()
  }

  it('aparece junto a "Reintentar", solo en la tarjeta de Final, con estilo neutro (no de acento)', () => {
    buildGraphInStore()
    renderPlayer()

    expect(screen.queryByText('Salir')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Continuar'))
    expect(screen.queryByText('Salir')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Camino A'))
    const exitButton = screen.getByText('Salir')
    expect(exitButton).toBeInTheDocument()
    // Estilo neutro, no el de "Reintentar" (acento, ver test de abajo).
    expect(exitButton.className).toBe(styles.neutralButton)
    expect(exitButton.className).not.toBe(styles.primaryButton)
  })

  it('al pulsarlo llama a window.close() y muestra el aviso de que ya se puede cerrar la pestaña', () => {
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {})
    reachFinal()

    expect(screen.queryByText('Ya puedes cerrar esta pestaña.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Salir'))

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Ya puedes cerrar esta pestaña.')).toBeInTheDocument()
  })
})

describe('PlayerScreen: milestone "+1 fallo con Game Over"', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('una respuesta actsAsExit es pulsable sin destino, y al elegirla se queda en la misma diapositiva mostrando el aviso de "Salir"', () => {
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {})
    const { decisionId } = buildGraphInStore()
    const responseExitId = addResponseTo(decisionId)
    act(() => {
      useProjectStore.getState().updateResponse(decisionId, responseExitId, {
        text: 'No, me rindo.',
        actsAsExit: true,
      })
    })

    renderPlayer()
    fireEvent.click(screen.getByText('Continuar'))

    const exitOption = screen.getByText('No, me rindo.').closest('button')
    expect(exitOption).not.toBeNull()
    expect(exitOption).not.toBeDisabled()

    fireEvent.click(screen.getByText('No, me rindo.'))

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Ya puedes cerrar esta pestaña.')).toBeInTheDocument()
    // Sigue en la MISMA diapositiva: la otra respuesta ("Camino A") sigue
    // visible, no navegó al Final.
    expect(screen.getByText('Camino A')).toBeInTheDocument()
    expect(screen.queryByText('Fin de la experiencia')).not.toBeInTheDocument()
  })

  it('corrección de revisión de código: "↺ Reiniciar experiencia" limpia el aviso de "Salir" — no debe reaparecer en la primera decisión del recorrido reiniciado', () => {
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {})
    const { decisionId } = buildGraphInStore()
    const responseExitId = addResponseTo(decisionId)
    act(() => {
      useProjectStore.getState().updateResponse(decisionId, responseExitId, {
        text: 'No, me rindo.',
        actsAsExit: true,
      })
    })

    renderPlayer()
    fireEvent.click(screen.getByText('Continuar'))
    fireEvent.click(screen.getByText('No, me rindo.'))
    expect(screen.getByText('Ya puedes cerrar esta pestaña.')).toBeInTheDocument()

    fireEvent.click(screen.getByText('↺ Reiniciar experiencia'))
    // De vuelta al inicio: el aviso de "Salir" no debe seguir presente.
    expect(screen.queryByText('Ya puedes cerrar esta pestaña.')).not.toBeInTheDocument()

    // Ni siquiera al volver a alcanzar la misma diapositiva de decisión sin
    // haber pulsado ningún botón de salir esta vez.
    fireEvent.click(screen.getByText('Continuar'))
    expect(screen.queryByText('Ya puedes cerrar esta pestaña.')).not.toBeInTheDocument()
    expect(screen.getByText('No, me rindo.')).toBeInTheDocument()

    closeSpy.mockRestore()
  })

  it('el Final muestra su contenido alternativo cuando la condición se cumple (tras visitar la diapositiva con visitEffects)', () => {
    const { startId, finalId } = buildGraphInStore()
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Fallos', type: 'number', initialValue: 0 })
    })
    const fallosVar = useProjectStore.getState().project.variables[0]
    if (!fallosVar) throw new Error('setup inválido')
    act(() => {
      // La diapositiva de inicio suma +1 a "Fallos" al visitarla.
      useProjectStore.getState().updateNode(startId, {
        visitEffects: [{ variableId: fallosVar.id, operation: 'increment', value: 1 }],
      })
      useProjectStore.getState().updateNode(finalId, {
        alternateCondition: { variableId: fallosVar.id, operator: '>=', value: 1 },
        alternateBody: 'Contenido alternativo por fallos.',
      })
    })

    renderPlayer()
    fireEvent.click(screen.getByText('Continuar')) // visita el inicio -> +1 Fallos
    fireEvent.click(screen.getByText('Camino A')) // -> Final

    expect(screen.getByText('Contenido alternativo por fallos.')).toBeInTheDocument()
    expect(screen.queryByText('Llegaste al final A.')).not.toBeInTheDocument()
  })

  it('el Final muestra su contenido por defecto cuando la condición NO se cumple', () => {
    const { finalId } = buildGraphInStore()
    act(() => {
      useProjectStore.getState().addVariable({ name: 'Fallos', type: 'number', initialValue: 0 })
    })
    const fallosVar = useProjectStore.getState().project.variables[0]
    if (!fallosVar) throw new Error('setup inválido')
    act(() => {
      // Ninguna diapositiva de este recorrido tiene visitEffects: "Fallos"
      // se queda en su valor inicial (0), la condición (>= 1) es falsa.
      useProjectStore.getState().updateNode(finalId, {
        alternateCondition: { variableId: fallosVar.id, operator: '>=', value: 1 },
        alternateBody: 'Contenido alternativo por fallos.',
      })
    })

    renderPlayer()
    fireEvent.click(screen.getByText('Continuar'))
    fireEvent.click(screen.getByText('Camino A'))

    expect(screen.getByText('Llegaste al final A.')).toBeInTheDocument()
    expect(screen.queryByText('Contenido alternativo por fallos.')).not.toBeInTheDocument()
  })

  describe('indicador de fallos (petición de usuario: "un indicador de fallos... durante la experiencia")', () => {
    it('sin ninguna variable "Fallos" en el proyecto, no muestra nada', () => {
      buildGraphInStore()
      renderPlayer()

      expect(screen.queryByText(/^Fallos: /)).not.toBeInTheDocument()
    })

    it('con la variable "Fallos", muestra su valor inicial y lo actualiza en vivo al aplicarse un visitEffect', () => {
      const { startId } = buildGraphInStore()
      act(() => {
        useProjectStore.getState().addVariable({ name: 'Fallos', type: 'number', initialValue: 0 })
      })
      const fallosVar = useProjectStore.getState().project.variables[0]
      if (!fallosVar) throw new Error('setup inválido')
      act(() => {
        useProjectStore.getState().updateNode(startId, {
          visitEffects: [{ variableId: fallosVar.id, operation: 'increment', value: 1 }],
        })
      })

      renderPlayer()
      // El arranque ya visita `startId`: el efecto se aplica desde
      // `getInitialState` (ver `runtime.ts`), así que el indicador ya
      // debería reflejar 1, no 0, incluso antes de pulsar nada.
      expect(screen.getByText('Fallos: 1')).toBeInTheDocument()
    })

    it('una variable "Fallos" de tipo boolean (no number) no cuenta: el indicador no aparece', () => {
      buildGraphInStore()
      act(() => {
        useProjectStore.getState().addVariable({ name: 'Fallos', type: 'boolean', initialValue: false })
      })

      renderPlayer()

      expect(screen.queryByText(/^Fallos: /)).not.toBeInTheDocument()
    })
  })

  describe('confeti del Final "Perfecto" (petición de usuario: "con confeti")', () => {
    function confettiPieceCount(): number {
      return document.querySelectorAll(`.${styles.confettiPiece}`).length
    }

    it('celebrateDefault + contenido por defecto -> confeti visible', () => {
      const { finalId } = buildGraphInStore()
      act(() => {
        useProjectStore.getState().updateNode(finalId, { celebrateDefault: true })
      })

      renderPlayer()
      fireEvent.click(screen.getByText('Continuar'))
      fireEvent.click(screen.getByText('Camino A'))

      expect(document.querySelector(`.${styles.confetti}`)).toBeInTheDocument()
      expect(confettiPieceCount()).toBeGreaterThan(0)
    })

    it('celebrateDefault + contenido ALTERNATIVO (condición cumplida) -> sin confeti', () => {
      const { startId, finalId } = buildGraphInStore()
      act(() => {
        useProjectStore.getState().addVariable({ name: 'Fallos', type: 'number', initialValue: 0 })
      })
      const fallosVar = useProjectStore.getState().project.variables[0]
      if (!fallosVar) throw new Error('setup inválido')
      act(() => {
        useProjectStore.getState().updateNode(startId, {
          visitEffects: [{ variableId: fallosVar.id, operation: 'increment', value: 1 }],
        })
        useProjectStore.getState().updateNode(finalId, {
          celebrateDefault: true,
          alternateCondition: { variableId: fallosVar.id, operator: '>=', value: 1 },
          alternateBody: 'Contenido alternativo por fallos.',
        })
      })

      renderPlayer()
      fireEvent.click(screen.getByText('Continuar'))
      fireEvent.click(screen.getByText('Camino A'))

      expect(screen.getByText('Contenido alternativo por fallos.')).toBeInTheDocument()
      expect(document.querySelector(`.${styles.confetti}`)).not.toBeInTheDocument()
    })

    it('sin celebrateDefault, nunca hay confeti aunque se muestre el contenido por defecto', () => {
      buildGraphInStore()

      renderPlayer()
      fireEvent.click(screen.getByText('Continuar'))
      fireEvent.click(screen.getByText('Camino A'))

      expect(screen.getByText('Llegaste al final A.')).toBeInTheDocument()
      expect(document.querySelector(`.${styles.confetti}`)).not.toBeInTheDocument()
    })
  })
})

describe('PlayerScreen: contenedor de scroll compartido por las 4 vistas', () => {
  /** El bug de scroll (ver `PlayerScreen.module.css`, clase `.stage`) podía
   *  afectar a las cuatro vistas del Player si cada una tuviera su propio
   *  contenedor; este test confirma que las CUATRO (`continue`, `decision`,
   *  `final`, `dead-end`) están, de verdad, dentro del mismo `<main>` con la
   *  clase `.stage`, así que el arreglo de esa única clase las cubre todas. */
  function mainStage(container: HTMLElement): HTMLElement {
    const main = container.querySelector('main')
    if (!main) throw new Error('No se encontró <main> en el Player.')
    return main
  }

  it('"dead-end" usa <main class="stage">', () => {
    // Diapositiva de inicio de un proyecto nuevo, sin destino configurado.
    const { container } = renderPlayer()
    expect(mainStage(container).className).toBe(styles.stage)
  })

  it('"continue", "decision" y "final" usan el mismo <main class="stage"> al navegar', () => {
    buildGraphInStore()
    const { container } = renderPlayer()

    expect(mainStage(container).className).toBe(styles.stage) // continue
    fireEvent.click(screen.getByText('Continuar'))

    expect(mainStage(container).className).toBe(styles.stage) // decision
    fireEvent.click(screen.getByText('Camino A'))

    expect(mainStage(container).className).toBe(styles.stage) // final
  })
})

describe('PlayerScreen: portada (nodo intro, milestone "Diapositiva de Inicio")', () => {
  /**
   * Añade una portada (`intro`) completa al proyecto del store —
   * `createNode('intro', ...)` ya desplaza `graph.startNodeId` a ella, ver
   * `createNode` en `src/domain/project.ts`— y la conecta a un Final
   * trivial, para poder observar tanto la portada como el avance tras
   * pulsar "Continuar".
   */
  function buildIntroInStore() {
    act(() => {
      useProjectStore.getState().createNode('intro', { x: -200, y: 0 })
    })
    const introId = useProjectStore.getState().project.graph.startNodeId
    const ciclo = CICLOS[0]!
    const asignatura = ciclo.asignaturas[0]!
    act(() => {
      useProjectStore.getState().updateNode(introId, {
        cicloId: ciclo.id,
        asignaturaId: asignatura.id,
        caseName: 'Caso de la fábrica',
      })
      useProjectStore
        .getState()
        .createNode('final', { x: 200, y: 0 }, { title: 'Fin', body: 'Fin del caso.' })
    })
    const finalId = otherNodeIdOf('final')
    act(() => {
      useProjectStore.getState().connect(introId, finalId)
    })
    return { introId, finalId, ciclo, asignatura }
  }

  it('el recorrido empieza en la portada, con ciclo/asignatura/caseName resueltos a nombres legibles', () => {
    const { ciclo, asignatura } = buildIntroInStore()
    renderPlayer()

    expect(screen.getByText('Caso de la fábrica')).toBeInTheDocument()
    // Ciclo y asignatura van en dos líneas independientes (`.introMetaLine`
    // x2, ver `IntroCard`), no unidas en un solo string " · " como antes del
    // rediseño de la portada de marca. `CICLOS[0]` ("TRONCAL ESP") no lleva
    // prefijo de código, así que `cicloOutputName` no le cambia nada aquí —
    // el siguiente test cubre el caso con prefijo, que sí se recorta.
    expect(screen.getByText(cicloOutputName(ciclo.name))).toBeInTheDocument()
    expect(screen.getByText(asignatura.name)).toBeInTheDocument()
    expect(screen.getByText('Continuar')).toBeInTheDocument()
  })

  it('"▶ Probar" simula la salida real: un ciclo con prefijo de código (p.ej. "AC - ") lo pierde, igual que en la exportación', () => {
    const ciclo = CICLOS.find((candidate) => candidate.name.includes(' - '))
    if (!ciclo) throw new Error('El catálogo necesita al menos un ciclo con prefijo " - "')
    const asignatura = ciclo.asignaturas[0]
    if (!asignatura) throw new Error('El ciclo de prueba no tiene asignaturas')

    act(() => {
      useProjectStore.getState().createNode('intro', { x: -200, y: 0 })
    })
    const introId = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      useProjectStore.getState().updateNode(introId, {
        cicloId: ciclo.id,
        asignaturaId: asignatura.id,
        caseName: 'Caso con ciclo prefijado',
      })
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    const finalId = otherNodeIdOf('final')
    act(() => {
      useProjectStore.getState().connect(introId, finalId)
    })
    renderPlayer()

    expect(screen.getByText(cicloOutputName(ciclo.name))).toBeInTheDocument()
    expect(screen.getByText(asignatura.name)).toBeInTheDocument()
    // El nombre CON el prefijo (el crudo del catálogo) no debe aparecer en
    // ningún sitio: confirma que de verdad se recortó, no que casualmente
    // coincidan.
    expect(screen.queryByText(ciclo.name)).not.toBeInTheDocument()
  })

  it('el botón de continuar de la portada avanza a targetNodeId (primera diapositiva narrativa real)', () => {
    buildIntroInStore()
    renderPlayer()

    fireEvent.click(screen.getByText('Continuar'))

    expect(screen.getByText('Fin de la experiencia')).toBeInTheDocument()
    expect(screen.getByText('Fin del caso.')).toBeInTheDocument()
  })

  it('con la portada incompleta (sin ciclo/asignatura/caseName) no rompe la vista: pinta placeholders grises', () => {
    act(() => {
      useProjectStore.getState().createNode('intro', { x: -200, y: 0 })
    })
    const introId = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })
    const finalId = otherNodeIdOf('final')
    act(() => {
      useProjectStore.getState().connect(introId, finalId)
    })

    renderPlayer()

    // Ni ciclo/asignatura ni caseName están elegidos: a diferencia del resto
    // de vistas del Player ("vacío" se omite sin más), la portada sustituye
    // cada dato que falte por un placeholder gris — ver comentario de
    // `IntroCard` — y sigue pintando el botón de continuar sin romperse.
    expect(screen.getByText('— Ciclo sin elegir —')).toBeInTheDocument()
    expect(screen.getByText('— Asignatura sin elegir —')).toBeInTheDocument()
    expect(screen.getByText('— Título sin definir —')).toBeInTheDocument()
    expect(screen.getByText('Continuar')).toBeInTheDocument()
  })

  it('"Reiniciar experiencia" desde cualquier punto del recorrido vuelve a mostrar la portada', () => {
    buildIntroInStore()
    renderPlayer()

    fireEvent.click(screen.getByText('Continuar'))
    expect(screen.getByText('Fin de la experiencia')).toBeInTheDocument()

    fireEvent.click(screen.getByText('↺ Reiniciar experiencia'))

    expect(screen.getByText('Caso de la fábrica')).toBeInTheDocument()
  })

  it('sin targetNodeId, la portada muestra el mismo aviso de "sin continuación" que el resto del motor', () => {
    act(() => {
      useProjectStore.getState().createNode('intro', { x: -200, y: 0 })
    })
    const introId = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      useProjectStore.getState().updateNode(introId, { caseName: 'Caso sin destino aún' })
    })

    renderPlayer()

    expect(
      screen.getByText(/todavía no tiene una continuación configurada/i),
    ).toBeInTheDocument()
    expect(screen.queryByText('Caso sin destino aún')).not.toBeInTheDocument()
  })
})
