import { describe, expect, it } from 'vitest'
import { createProject } from '../../domain'
import { MemoryProjectRepository } from '../../persistence'
import { openExistingProject, projectNameFromFilePath } from '../openExistingProject'

describe('projectNameFromFilePath', () => {
  it('extrae el nombre de archivo sin ruta ni extensión .brunch', () => {
    expect(projectNameFromFilePath('/Users/ana/Proyectos/Mi escenario.brunch')).toBe('Mi escenario')
  })

  it('reconoce el separador de Windows aunque el proceso corra en otro SO', () => {
    expect(projectNameFromFilePath('C:\\Usuarios\\Ana\\Cuento de Otoño.brunch')).toBe('Cuento de Otoño')
  })

  it('conserva espacios, acentos y mayúsculas del nombre de archivo', () => {
    expect(projectNameFromFilePath('/tmp/Aventura en el Bosque Mágico.brunch')).toBe(
      'Aventura en el Bosque Mágico',
    )
  })

  it('sin extensión .brunch (ruta atípica), deja el nombre tal cual', () => {
    expect(projectNameFromFilePath('/tmp/sin-extension')).toBe('sin-extension')
  })
})

describe('openExistingProject', () => {
  it('sobrescribe metadata.name con el nombre real del archivo, descartando el guardado', async () => {
    const repository = new MemoryProjectRepository()
    const stale = createProject('Nombre viejo guardado en el documento')
    await repository.createProject('/tmp/Nombre Nuevo Del Archivo.brunch', stale)

    const document = await openExistingProject(repository, '/tmp/Nombre Nuevo Del Archivo.brunch')

    expect(document.metadata.name).toBe('Nombre Nuevo Del Archivo')
  })

  it('cuando el nombre guardado ya coincide con el del archivo, no cambia nada más del documento', async () => {
    const repository = new MemoryProjectRepository()
    // `createProject` (dominio, de bajo nivel) no siembra ninguna diapositiva
    // de Inicio — eso lo hacen las plantillas, un nivel por encima (ver
    // `src/domain/templates.ts`). Abrir un documento sin ninguna la sintetiza
    // (`ensureIntroNode`, paso final incondicional de la migración), así que
    // el grafo SÍ cambia al abrir en ese caso concreto — es la única parte
    // del documento que la migración toca; el resto permanece intacto.
    const original = createProject('Coincide')
    await repository.createProject('/tmp/Coincide.brunch', original)

    const document = await openExistingProject(repository, '/tmp/Coincide.brunch')

    expect(document.metadata.name).toBe('Coincide')
    expect(document.metadata.id).toBe(original.metadata.id)
    expect(document.graph.nodes).toHaveLength(original.graph.nodes.length + 1)
    const intro = document.graph.nodes.find((node) => node.type === 'intro')
    expect(intro).toBeDefined()
    expect(document.graph.startNodeId).toBe(intro?.id)
    expect(intro?.type === 'intro' ? intro.targetNodeId : undefined).toBe(original.graph.startNodeId)
    expect(intro?.number).toBe(1)
    // El nodo original (que antes era el punto de partida) sigue presente,
    // sin ningún otro cambio salvo su `number` — el Inicio sintetizado
    // siempre ocupa el 1 (ver `ensureIntroNode`/`shiftNodeNumbersForNewIntro`
    // en `src/domain/migration.ts`/`id.ts`), así que el resto de nodos del
    // documento antiguo desplaza su número una unidad hacia arriba.
    const originalNode = original.graph.nodes.find((node) => node.id === original.graph.startNodeId)
    const migratedNode = document.graph.nodes.find((node) => node.id === original.graph.startNodeId)
    expect(migratedNode).toEqual({ ...originalNode, number: (originalNode?.number ?? 0) + 1 })
  })

  it('propaga el rechazo si el repositorio no puede abrir la ruta', async () => {
    const repository = new MemoryProjectRepository()

    await expect(openExistingProject(repository, '/tmp/no-existe.brunch')).rejects.toThrow()
  })
})
