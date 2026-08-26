import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { AUTOSAVE_DEBOUNCE_MS, useAutosave } from '../useAutosave'
import { AppServicesProvider } from '../../../app/AppServicesContext'
import { MemoryProjectRepository } from '../../../persistence'
import type { ProjectRepository } from '../../../persistence'
import { createProject, deriveEdges } from '../../../domain'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'
import { MemoryAssetRepository } from '../../../persistence'

/**
 * Tests de `useAutosave` (fase 9): autoguardado real con debounce, guardado
 * forzado por `Ctrl+S`/`Cmd+S`, y la prueba de fidelidad de reapertura que
 * apunta al criterio de aceptación del milestone completo.
 *
 * Todos usan temporizadores simulados (`vi.useFakeTimers()`): el hook
 * programa sus escrituras con `setTimeout`, así que sin control del reloj
 * los tests tendrían que esperar de verdad `AUTOSAVE_DEBOUNCE_MS` cada vez.
 */

/** Monta el hook sin más JSX alrededor: no necesita renderizar nada visible. */
function Harness({ filePath }: { filePath: string }) {
  useAutosave(filePath)
  return null
}

function renderHarness(repository: ProjectRepository, filePath = '/tmp/autosave-test.brunch') {
  return render(
    <AppServicesProvider services={{ repository }}>
      <Harness filePath={filePath} />
    </AppServicesProvider>,
  )
}

/** Repositorio de pega: mismos métodos que `ProjectRepository`, todos mockeados. */
function createStubRepository(overrides: Partial<ProjectRepository> = {}): ProjectRepository & {
  saveProject: Mock
} {
  return {
    createProject: vi.fn().mockResolvedValue(undefined),
    openProject: vi.fn().mockResolvedValue(createProject('stub')),
    saveProject: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as ProjectRepository & { saveProject: Mock }
}

beforeEach(() => {
  resetProjectStore()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAutosave — debounce y guardado', () => {
  it('un cambio en project dispara "guardando" y, tras el debounce completo, llama a saveProject una vez y pasa a "guardado"', async () => {
    const repository = createStubRepository()
    renderHarness(repository)

    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    })

    expect(useProjectStore.getState().saveStatus).toBe('saving')
    expect(repository.saveProject).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)
    })

    expect(repository.saveProject).toHaveBeenCalledTimes(1)
    expect(repository.saveProject).toHaveBeenCalledWith(
      '/tmp/autosave-test.brunch',
      useProjectStore.getState().project,
    )
    expect(useProjectStore.getState().saveStatus).toBe('saved')
  })

  it('varios cambios rápidos consecutivos (arrastre de un nodo) producen una única llamada a saveProject', async () => {
    const repository = createStubRepository()
    renderHarness(repository)

    const nodeId = useProjectStore.getState().project.graph.nodes[0]?.id
    if (!nodeId) throw new Error('setup inválido: no hay nodo de inicio')

    act(() => {
      const store = useProjectStore.getState()
      store.beginNodeDrag([nodeId])
      // 20 mutaciones "en caliente" de la posición, cada una separada solo
      // 20ms (400ms en total, por debajo del debounce de 700ms) — simula
      // los frames de un arrastre de nodo.
      for (let frame = 0; frame < 20; frame += 1) {
        useProjectStore.getState().updateNodeDragPosition([{ nodeId, position: { x: frame, y: frame * 2 } }])
        vi.advanceTimersByTime(20)
      }
      store.endNodeDrag()
    })

    expect(repository.saveProject).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)
    })

    // Ni un guardado por frame ni uno por el `endNodeDrag` final: una única
    // escritura tras el primer respiro sin cambios.
    expect(repository.saveProject).toHaveBeenCalledTimes(1)
    const savedProject = repository.saveProject.mock.calls[0]?.[1]
    const finalNode = savedProject.graph.nodes.find((node: { id: string }) => node.id === nodeId)
    expect(finalNode.position).toEqual({ x: 19, y: 38 })
  })

  it('cargar un proyecto (loadProject) no dispara ningún guardado inmediato', async () => {
    const repository = createStubRepository()
    renderHarness(repository)

    const otherProject = createProject('Otro proyecto cargado')
    act(() => {
      useProjectStore.getState().loadProject(otherProject)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2)
    })

    expect(repository.saveProject).not.toHaveBeenCalled()
    // El documento cargado se considera "en sincronía con el disco", no
    // "sin guardar": no se queda colgado en un estado transitorio.
    expect(useProjectStore.getState().saveStatus).toBe('saved')
  })

  it('Ctrl+S/Cmd+S fuerza el guardado ya, a mitad del debounce, y no deja un guardado duplicado después', async () => {
    const repository = createStubRepository()
    renderHarness(repository)

    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    })

    // A mitad del periodo de debounce: todavía no se ha guardado nada.
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS / 2)
    })
    expect(repository.saveProject).not.toHaveBeenCalled()

    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })
    await act(async () => {
      window.dispatchEvent(event)
      // Deja que se resuelva la promesa de `saveProject` (microtask) sin
      // avanzar el reloj más allá de lo ya transcurrido.
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(repository.saveProject).toHaveBeenCalledTimes(1)
    expect(useProjectStore.getState().saveStatus).toBe('saved')

    // El temporizador de debounce original quedó cancelado por el guardado
    // forzado: dejar pasar el resto de su plazo no debe producir una
    // segunda llamada.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)
    })
    expect(repository.saveProject).toHaveBeenCalledTimes(1)
  })

  it('si saveProject falla, el estado lo refleja de forma honesta sin romper la app, y un cambio posterior con éxito recupera "guardado"', async () => {
    const saveProject = vi
      .fn()
      .mockRejectedValueOnce(new Error('disco lleno'))
      .mockResolvedValue(undefined)
    const repository = createStubRepository({ saveProject })
    renderHarness(repository)

    act(() => {
      useProjectStore.getState().createNode('final', { x: 0, y: 0 })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)
    })

    expect(repository.saveProject).toHaveBeenCalledTimes(1)
    expect(useProjectStore.getState().saveStatus).toBe('error')

    act(() => {
      useProjectStore.getState().createNode('slide', { x: 10, y: 10 })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)
    })

    expect(repository.saveProject).toHaveBeenCalledTimes(2)
    expect(useProjectStore.getState().saveStatus).toBe('saved')
  })
})

describe('useAutosave — recolección de basura de imágenes (milestone "Bloques de contenido": bloques de imagen en SlideNode.content)', () => {
  it('una imagen quitada de content se recolecta; la que sigue en content sobrevive', async () => {
    const repository = createStubRepository()
    const assetRepository = new MemoryAssetRepository()
    assetRepository.registerSourceFile('/tmp/a.png', new Uint8Array([1]), 'image/png')
    assetRepository.registerSourceFile('/tmp/b.png', new Uint8Array([2]), 'image/png')
    const keepId = (await assetRepository.importAsset('/tmp/p.brunch', '/tmp/a.png')).id
    const removedId = (await assetRepository.importAsset('/tmp/p.brunch', '/tmp/b.png')).id

    render(
      <AppServicesProvider services={{ repository, assetRepository }}>
        <Harness filePath="/tmp/autosave-test.brunch" />
      </AppServicesProvider>,
    )

    const startId = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      useProjectStore.getState().addImageBlock(startId, keepId)
      useProjectStore.getState().addImageBlock(startId, removedId)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)
    })

    // Todavía referenciadas ambas: ninguna se recolecta en este primer guardado.
    await expect(assetRepository.getAsset('/tmp/p.brunch', keepId)).resolves.toBeDefined()
    await expect(assetRepository.getAsset('/tmp/p.brunch', removedId)).resolves.toBeDefined()

    // Se quita el bloque que referencia `removedId` (queda solo el de
    // `keepId`) y se guarda de nuevo.
    act(() => {
      const node = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startId)
      const blockId =
        node?.type === 'slide'
          ? node.content.find((block) => block.type === 'image' && block.assetId === removedId)?.id
          : undefined
      if (!blockId) throw new Error('setup inválido')
      useProjectStore.getState().removeContentBlock(startId, blockId)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)
    })

    // La que sigue en `content` sobrevive; la quitada se recolecta.
    await expect(assetRepository.getAsset('/tmp/p.brunch', keepId)).resolves.toBeDefined()
    await expect(assetRepository.getAsset('/tmp/p.brunch', removedId)).rejects.toThrow()
  })
})

describe('useAutosave — fidelidad de reapertura (criterio de aceptación del milestone)', () => {
  it('editar, autoguardar y reabrir desde el repositorio devuelve un documento estructuralmente idéntico', async () => {
    const repository = new MemoryProjectRepository()
    const filePath = '/tmp/fidelidad-reapertura.brunch'

    // `createProject` (bajo nivel) NO siembra ningún nodo `intro` (ver su
    // comentario en `src/domain/project.ts`), pero `repository.openProject`
    // SÍ lo sintetiza incondicionalmente al abrir (`ensureIntroNode`,
    // `src/domain/migration.ts`, milestone "Diapositiva de Inicio") — igual
    // que el flujo real de la app (`openExistingProject` + `loadProject`,
    // ver `HomeScreen.handleOpen`). Se reproduce ese mismo camino aquí (guardar
    // en bruto, reabrir vía el repositorio, y SOLO ENTONCES cargar en el
    // store) para que el documento cargado ya tenga su `intro` desde el
    // principio: si se cargara `initial` directamente (como antes de este
    // milestone), el siguiente `repository.openProject(filePath)` de más
    // abajo sintetizaría un `intro` NUEVO que `inMemory` nunca tuvo,
    // rompiendo la comparación de fidelidad por una razón ajena a lo que
    // este test intenta comprobar (edición/autoguardado/reapertura).
    const initial = createProject('Proyecto de fidelidad')
    await repository.createProject(filePath, initial)
    const migratedInitial = await repository.openProject(filePath)
    act(() => {
      useProjectStore.getState().loadProject(migratedInitial)
    })

    renderHarness(repository, filePath)

    // La diapositiva de Inicio "narrativa" (`SlideNode`, la que sembraba
    // `createProject`) ya NO es `graph.startNodeId` — ese id apunta ahora al
    // `intro` recién sintetizado (ver comentario de arriba). El resto de
    // este test edita/conecta esa diapositiva exactamente igual que antes de
    // este milestone, así que se recupera su id explícitamente por tipo (en
    // este punto es la única `slide` del documento) en vez de asumir que
    // coincide con `graph.startNodeId`.
    const introId = useProjectStore.getState().project.graph.startNodeId
    const seedSlide = useProjectStore
      .getState()
      .project.graph.nodes.find((node) => node.type === 'slide')
    if (!seedSlide) {
      throw new Error('setup inválido: falta la diapositiva semilla')
    }
    const startId = seedSlide.id

    // 1. Crea nodos con título/body propios.
    act(() => {
      const store = useProjectStore.getState()
      store.createNode('slide', { x: 100, y: 50 }, { title: 'Diapositiva 1', body: 'Cuerpo de la diapositiva' })
      store.createNode('slide', { x: 200, y: 150 })
      store.createNode('final', { x: 300, y: 250 })
    })

    const project = useProjectStore.getState().project
    const slideIds = project.graph.nodes
      .filter((node) => node.type === 'slide' && node.id !== startId)
      .map((node) => node.id)
    const [contentId, decisionId] = slideIds as [string, string]
    const finalId = project.graph.nodes.find((node) => node.type === 'final')?.id
    if (!contentId || !decisionId || !finalId) {
      throw new Error('setup inválido: faltan nodos')
    }

    // 2. Conecta los nodos, añade y edita respuestas, y mueve nodos.
    act(() => {
      const store = useProjectStore.getState()
      store.connect(startId, contentId)
      store.connect(contentId, decisionId)
      store.addResponse(decisionId)
      store.addResponse(decisionId)
    })

    const decisionNode = useProjectStore
      .getState()
      .project.graph.nodes.find((node) => node.id === decisionId)
    const responses = decisionNode?.type === 'slide' ? decisionNode.responses : []
    const [responseA, responseB] = responses
    if (!responseA || !responseB) throw new Error('setup inválido: faltan respuestas')

    act(() => {
      const store = useProjectStore.getState()
      store.connect(decisionId, finalId, responseA.id)
      store.connect(decisionId, contentId, responseB.id)
      store.updateResponse(decisionId, responseA.id, { text: 'Sí, continuar' })
      store.updateResponse(decisionId, responseB.id, { text: 'No, repetir' })
      store.updateNode(startId, { title: 'Inicio del escenario', continueLabel: 'Vamos' })
      store.moveNode(contentId, { x: 111, y: 222 })
      store.moveNode(decisionId, { x: 333, y: 444 })
      store.setViewport({ x: 42, y: -17, zoom: 1.5 })
    })

    // 3. Deja correr el autoguardado (temporizadores simulados).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)
    })
    expect(useProjectStore.getState().saveStatus).toBe('saved')

    // 4. Reabre desde el repositorio, como haría `HomeScreen` al volver a
    // abrir el mismo `.brunch` en una sesión nueva.
    const reopened = await repository.openProject(filePath)
    const inMemory = useProjectStore.getState().project

    // Deliberadamente comparado dos veces: contra el documento en memoria
    // (deep equality completa) y contra expectativas explícitas campo a
    // campo, para que un fallo señale con precisión qué se perdió.
    expect(reopened).toEqual(inMemory)

    // 4 nodos "narrativos" (igual que antes de este milestone) + 1 nodo
    // `intro` sintetizado al abrir por primera vez (ver comentario de
    // cabecera del test).
    expect(reopened.graph.nodes).toHaveLength(5)
    // La referencia de inicio (el `intro` sintetizado) sobrevive al ciclo
    // guardar/reabrir.
    expect(reopened.graph.startNodeId).toBe(introId)

    const reopenedStart = reopened.graph.nodes.find((node) => node.id === startId)
    const reopenedContent = reopened.graph.nodes.find((node) => node.id === contentId)
    const reopenedDecision = reopened.graph.nodes.find((node) => node.id === decisionId)
    const reopenedFinal = reopened.graph.nodes.find((node) => node.id === finalId)

    expect(reopenedStart?.type).toBe('slide')
    expect(reopenedStart?.title).toBe('Inicio del escenario')
    expect(reopenedStart).toMatchObject({ targetNodeId: contentId, continueLabel: 'Vamos' })

    expect(reopenedContent?.type).toBe('slide')
    expect(reopenedContent?.title).toBe('Diapositiva 1')
    // `createNode('slide', ..., { body: '...' })` siembra el cuerpo del
    // ÚNICO bloque de texto inicial de la diapositiva (ver `CreateNodeExtra`
    // en `src/domain/project.ts`) — una diapositiva ya no tiene un `body`
    // propio.
    expect(reopenedContent?.type === 'slide' ? reopenedContent.content[0] : undefined).toMatchObject({
      type: 'text',
      body: 'Cuerpo de la diapositiva',
    })
    expect(reopenedContent?.position).toEqual({ x: 111, y: 222 })
    expect(reopenedContent).toMatchObject({ targetNodeId: decisionId })

    expect(reopenedDecision?.type).toBe('slide')
    expect(reopenedDecision?.position).toEqual({ x: 333, y: 444 })
    const reopenedResponses = reopenedDecision?.type === 'slide' ? reopenedDecision.responses : []
    expect(reopenedResponses).toHaveLength(2)
    expect(reopenedResponses.find((response) => response.id === responseA.id)).toMatchObject({
      text: 'Sí, continuar',
      targetNodeId: finalId,
    })
    expect(reopenedResponses.find((response) => response.id === responseB.id)).toMatchObject({
      text: 'No, repetir',
      targetNodeId: contentId,
    })

    expect(reopenedFinal?.type).toBe('final')
    expect(reopenedFinal?.position).toEqual({ x: 300, y: 250 })

    // Mismas conexiones: se compara vía `deriveEdges` (dominio) sobre el
    // documento reabierto, sin duplicar su lógica en el propio test.
    const edges = deriveEdges(reopened)
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: introId, target: startId }),
        expect.objectContaining({ source: startId, target: contentId }),
        expect.objectContaining({ source: contentId, target: decisionId }),
        expect.objectContaining({ source: decisionId, target: finalId }),
        expect.objectContaining({ source: decisionId, target: contentId }),
      ]),
    )
    // Las 4 conexiones narrativas de siempre + la del `intro` sintetizado
    // hacia la diapositiva semilla (ver comentario de cabecera del test).
    expect(edges).toHaveLength(5)

    // Mismo viewport (x/y/zoom).
    expect(reopened.editor.viewport).toEqual({ x: 42, y: -17, zoom: 1.5 })
  })
})
