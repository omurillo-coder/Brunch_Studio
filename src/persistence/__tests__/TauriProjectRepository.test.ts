import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProject, type ProjectDocument } from '../../domain'
import { PersistenceCommandError, TauriProjectRepository } from '../TauriProjectRepository'

afterEach(() => {
  clearMocks()
  vi.restoreAllMocks()
})

describe('TauriProjectRepository.createProject', () => {
  it('invoca create_branch_project con la ruta y el JSON serializado del documento', async () => {
    const document = createProject('Mi escenario')
    const calls: Array<{ cmd: string; payload: unknown }> = []

    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload })
      return null
    })

    const repo = new TauriProjectRepository()
    await repo.createProject('/tmp/proyecto.brunch', document)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.cmd).toBe('create_branch_project')
    const payload = calls[0]?.payload as { path: string; documentJson: string }
    expect(payload.path).toBe('/tmp/proyecto.brunch')
    expect(JSON.parse(payload.documentJson)).toEqual(document)
  })

  it('propaga un PersistenceCommandError si el comando rechaza con esa forma', async () => {
    mockIPC(() => {
      throw { kind: 'AlreadyExists', content: '/tmp/proyecto.brunch' }
    })

    const repo = new TauriProjectRepository()
    const document = createProject('Mi escenario')

    await expect(repo.createProject('/tmp/proyecto.brunch', document)).rejects.toBeInstanceOf(
      PersistenceCommandError,
    )
    await expect(repo.createProject('/tmp/proyecto.brunch', document)).rejects.toMatchObject({
      kind: 'AlreadyExists',
    })
  })
})

describe('TauriProjectRepository.openProject', () => {
  it('invoca open_branch_project con la ruta y valida el JSON devuelto con Zod', async () => {
    // `createProject` (dominio, de bajo nivel) no siembra ninguna diapositiva
    // de Inicio — abrir el documento la sintetiza (`ensureIntroNode`, parte
    // de la migración), así que el grafo gana ese nodo respecto al original.
    const document = createProject('Mi escenario')
    let receivedCmd = ''
    let receivedPayload: unknown

    mockIPC((cmd, payload) => {
      receivedCmd = cmd
      receivedPayload = payload
      return JSON.stringify(document)
    })

    const repo = new TauriProjectRepository()
    const opened = await repo.openProject('/tmp/proyecto.brunch')

    expect(receivedCmd).toBe('open_branch_project')
    expect(receivedPayload).toEqual({ path: '/tmp/proyecto.brunch' })
    expect(opened.metadata).toEqual(document.metadata)
    expect(opened.graph.nodes).toHaveLength(document.graph.nodes.length + 1)
    const intro = opened.graph.nodes.find((node) => node.type === 'intro')
    expect(intro).toBeDefined()
    expect(opened.graph.startNodeId).toBe(intro?.id)
    expect(intro?.type === 'intro' ? intro.targetNodeId : undefined).toBe(document.graph.startNodeId)
  })

  it('rechaza si el JSON devuelto no cumple ProjectDocumentSchema', async () => {
    mockIPC(() => JSON.stringify({ not: 'a valid project document' }))

    const repo = new TauriProjectRepository()
    await expect(repo.openProject('/tmp/proyecto.brunch')).rejects.toThrow()
  })

  it('migra un documento guardado con el modelo de nodos anterior', async () => {
    // Forma antigua: nodos `start`/`content`/`final` y sin `graph.startNodeId`
    // (ver `src/domain/migration.ts`). Debe abrirse sin fallar, con el
    // `content` convertido en diapositiva y el inicio apuntando a él.
    const legacyJson = JSON.stringify({
      schemaVersion: 1,
      metadata: {
        id: '99999999-9999-4999-8999-999999999999',
        name: 'Antiguo',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      settings: {},
      editor: { viewport: { x: 0, y: 0, zoom: 1 } },
      graph: {
        nodes: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            number: 1,
            type: 'start',
            position: { x: 0, y: 0 },
            title: '',
            body: '',
            targetNodeId: '22222222-2222-4222-8222-222222222222',
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            number: 2,
            type: 'content',
            position: { x: 200, y: 0 },
            title: 'Pantalla',
            body: '',
          },
        ],
      },
    })
    mockIPC(() => legacyJson)

    const repo = new TauriProjectRepository()
    const opened = await repo.openProject('/tmp/antiguo.brunch')

    // El nodo `content` migrado a `slide` sigue teniendo el id de siempre;
    // lo nuevo es que ya no es él quien arranca el recorrido, sino un nodo
    // `intro` sintetizado (id fresco, no determinista) cuyo destino es él.
    expect(opened.graph.nodes).toHaveLength(2)
    const slide = opened.graph.nodes.find((node) => node.id === '22222222-2222-4222-8222-222222222222')
    expect(slide?.type).toBe('slide')
    const intro = opened.graph.nodes.find((node) => node.type === 'intro')
    expect(intro).toBeDefined()
    expect(opened.graph.startNodeId).toBe(intro?.id)
    expect(intro?.type === 'intro' ? intro.targetNodeId : undefined).toBe(
      '22222222-2222-4222-8222-222222222222',
    )
  })

  it('propaga un PersistenceCommandError con kind NotFound', async () => {
    mockIPC(() => {
      throw { kind: 'NotFound', content: '/tmp/no-existe.brunch' }
    })

    const repo = new TauriProjectRepository()
    await expect(repo.openProject('/tmp/no-existe.brunch')).rejects.toMatchObject({
      kind: 'NotFound',
    })
  })
})

describe('TauriProjectRepository.saveProject', () => {
  it('invoca save_branch_project con la ruta y el JSON serializado del documento', async () => {
    const document: ProjectDocument = createProject('Mi escenario')
    const calls: Array<{ cmd: string; payload: unknown }> = []

    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload })
      return null
    })

    const repo = new TauriProjectRepository()
    await repo.saveProject('/tmp/proyecto.brunch', document)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.cmd).toBe('save_branch_project')
    const payload = calls[0]?.payload as { path: string; documentJson: string }
    expect(payload.path).toBe('/tmp/proyecto.brunch')
    expect(JSON.parse(payload.documentJson)).toEqual(document)
  })
})
