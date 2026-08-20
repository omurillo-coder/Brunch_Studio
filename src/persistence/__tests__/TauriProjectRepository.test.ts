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
    expect(opened).toEqual(document)
  })

  it('rechaza si el JSON devuelto no cumple ProjectDocumentSchema', async () => {
    mockIPC(() => JSON.stringify({ not: 'a valid project document' }))

    const repo = new TauriProjectRepository()
    await expect(repo.openProject('/tmp/proyecto.brunch')).rejects.toThrow()
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
