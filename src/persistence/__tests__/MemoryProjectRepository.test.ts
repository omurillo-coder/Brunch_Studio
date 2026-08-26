import { describe, expect, it } from 'vitest'
import { createProject } from '../../domain'
import { MemoryProjectRepository } from '../MemoryProjectRepository'

describe('MemoryProjectRepository', () => {
  it('crear y luego abrir devuelve el mismo documento', async () => {
    const repo = new MemoryProjectRepository()
    // `createProject` (dominio, de bajo nivel) no siembra ninguna diapositiva
    // de Inicio — abrir el documento la sintetiza (`ensureIntroNode`, parte
    // de la migración), así que el grafo gana ese nodo respecto al original;
    // el resto del documento sí se conserva exactamente igual.
    const document = createProject('Mi escenario')

    await repo.createProject('/fake/path/proyecto.brunch', document)
    const reopened = await repo.openProject('/fake/path/proyecto.brunch')

    expect(reopened.metadata).toEqual(document.metadata)
    expect(reopened.settings).toEqual(document.settings)
    expect(reopened.graph.nodes).toHaveLength(document.graph.nodes.length + 1)
    const intro = reopened.graph.nodes.find((node) => node.type === 'intro')
    expect(intro).toBeDefined()
    expect(reopened.graph.startNodeId).toBe(intro?.id)
    expect(intro?.type === 'intro' ? intro.targetNodeId : undefined).toBe(document.graph.startNodeId)
    expect(
      reopened.graph.nodes.find((node) => node.id === document.graph.startNodeId),
    ).toEqual(document.graph.nodes.find((node) => node.id === document.graph.startNodeId))
  })

  it('guardar sobrescribe el documento y abrir devuelve la versión nueva', async () => {
    const repo = new MemoryProjectRepository()
    const document = createProject('Mi escenario')
    await repo.createProject('/fake/path/proyecto.brunch', document)

    const updated = { ...document, metadata: { ...document.metadata, name: 'Otro nombre' } }
    await repo.saveProject('/fake/path/proyecto.brunch', updated)

    const reopened = await repo.openProject('/fake/path/proyecto.brunch')
    expect(reopened.metadata.name).toBe('Otro nombre')
  })

  it('abrir una ruta inexistente rechaza la promesa', async () => {
    const repo = new MemoryProjectRepository()
    await expect(repo.openProject('/no/existe.brunch')).rejects.toThrow()
  })

  it('guardar en una ruta inexistente rechaza la promesa', async () => {
    const repo = new MemoryProjectRepository()
    const document = createProject('Mi escenario')
    await expect(repo.saveProject('/no/existe.brunch', document)).rejects.toThrow()
  })

  it('crear dos veces en la misma ruta rechaza la promesa', async () => {
    const repo = new MemoryProjectRepository()
    const document = createProject('Mi escenario')
    await repo.createProject('/fake/path/proyecto.brunch', document)

    await expect(repo.createProject('/fake/path/proyecto.brunch', document)).rejects.toThrow()
  })

  it('mutar el documento devuelto por openProject no afecta al estado interno', async () => {
    const repo = new MemoryProjectRepository()
    const document = createProject('Mi escenario')
    await repo.createProject('/fake/path/proyecto.brunch', document)

    const reopened = await repo.openProject('/fake/path/proyecto.brunch')
    reopened.metadata.name = 'Mutado localmente'

    const reopenedAgain = await repo.openProject('/fake/path/proyecto.brunch')
    expect(reopenedAgain.metadata.name).toBe('Mi escenario')
  })
})
