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
    const original = createProject('Coincide')
    await repository.createProject('/tmp/Coincide.brunch', original)

    const document = await openExistingProject(repository, '/tmp/Coincide.brunch')

    expect(document.metadata.name).toBe('Coincide')
    expect(document.metadata.id).toBe(original.metadata.id)
    expect(document.graph).toEqual(original.graph)
  })

  it('propaga el rechazo si el repositorio no puede abrir la ruta', async () => {
    const repository = new MemoryProjectRepository()

    await expect(openExistingProject(repository, '/tmp/no-existe.brunch')).rejects.toThrow()
  })
})
