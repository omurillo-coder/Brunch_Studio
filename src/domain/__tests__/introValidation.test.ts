import { describe, expect, it } from 'vitest'
import {
  asignaturaBelongsToCiclo,
  validateIntroForExport,
  validatePendingContentForExport,
} from '../introValidation'
import { createNode, createProject, updateNode } from '../project'
import { addImageBlock } from '../content'
import { CICLOS } from '../catalog'
import type { ProjectDocument } from '../schemas'

// Un ciclo/asignatura reales del catálogo, para no depender de fixtures
// inventados que pudieran dejar de reflejar la forma real de CICLOS.
const CICLO = CICLOS[0]
const ASIGNATURA = CICLO?.asignaturas[0]
if (!CICLO || !ASIGNATURA) {
  throw new Error('CICLOS está vacío: los tests de introValidation necesitan al menos un ciclo con una asignatura')
}
// Una asignatura de OTRO ciclo (si existe alguno con al menos dos ciclos),
// para probar el caso de incoherencia ciclo/asignatura.
const OTHER_CICLO = CICLOS.find((c) => c.id !== CICLO.id && c.asignaturas.length > 0)

function projectWithIntro(): { project: ProjectDocument; introId: string } {
  const project = createNode(createProject('P'), 'intro', { x: -260, y: 0 })
  const introId = project.graph.nodes.find((node) => node.type === 'intro')?.id
  if (!introId) throw new Error('setup inválido')
  return { project, introId }
}

describe('asignaturaBelongsToCiclo', () => {
  it('devuelve true cuando la asignatura pertenece al ciclo', () => {
    expect(asignaturaBelongsToCiclo(CICLO.id, ASIGNATURA.id)).toBe(true)
  })

  it('devuelve false cuando el ciclo no existe en el catálogo', () => {
    expect(asignaturaBelongsToCiclo('no-existe-en-el-catalogo', ASIGNATURA.id)).toBe(false)
  })

  it('devuelve false cuando el ciclo existe pero la asignatura no es suya', () => {
    if (!OTHER_CICLO) return // catálogo con un único ciclo: caso no aplicable
    const foreignAsignatura = OTHER_CICLO.asignaturas[0]
    if (!foreignAsignatura) return
    expect(asignaturaBelongsToCiclo(CICLO.id, foreignAsignatura.id)).toBe(false)
  })

  it('devuelve false cuando la asignatura no existe en absoluto', () => {
    expect(asignaturaBelongsToCiclo(CICLO.id, 'no-existe-en-ningun-ciclo')).toBe(false)
  })
})

describe('validateIntroForExport', () => {
  it('devuelve un único aviso si el proyecto no tiene ningún nodo intro', () => {
    const project = createProject('P') // bajo nivel: nunca siembra intro
    const issues = validateIntroForExport(project)
    expect(issues).toEqual(['El proyecto no tiene diapositiva de Inicio.'])
  })

  it('devuelve tres avisos (ciclo/asignatura/nombre de caso) para un intro recién creado, vacío', () => {
    const { project } = projectWithIntro()
    const issues = validateIntroForExport(project)
    expect(issues).toEqual(['Elige un ciclo', 'Elige una asignatura', 'Escribe el nombre del caso práctico'])
  })

  it('devuelve solo el aviso de asignatura si el ciclo ya está elegido', () => {
    const { project, introId } = projectWithIntro()
    const updated = updateNode(project, introId, { cicloId: CICLO.id, caseName: 'Caso de prueba' })
    expect(validateIntroForExport(updated)).toEqual(['Elige una asignatura'])
  })

  it('no devuelve ningún aviso cuando ciclo/asignatura/nombre de caso están completos y son coherentes', () => {
    const { project, introId } = projectWithIntro()
    const updated = updateNode(project, introId, {
      cicloId: CICLO.id,
      asignaturaId: ASIGNATURA.id,
      caseName: 'Atención a un cliente disgustado',
    })
    expect(validateIntroForExport(updated)).toEqual([])
  })

  it('avisa de incoherencia si cicloId/asignaturaId están rellenos pero la asignatura no pertenece a ese ciclo', () => {
    if (!OTHER_CICLO) return // catálogo con un único ciclo: caso no aplicable
    const foreignAsignatura = OTHER_CICLO.asignaturas[0]
    if (!foreignAsignatura) return

    const { project, introId } = projectWithIntro()
    const updated = updateNode(project, introId, {
      cicloId: CICLO.id,
      asignaturaId: foreignAsignatura.id,
      caseName: 'Caso de prueba',
    })
    const issues = validateIntroForExport(updated)
    expect(issues).toEqual(['La asignatura elegida no pertenece al ciclo elegido'])
  })

  it('trata un caseName con solo espacios como vacío', () => {
    const { project, introId } = projectWithIntro()
    const updated = updateNode(project, introId, {
      cicloId: CICLO.id,
      asignaturaId: ASIGNATURA.id,
      caseName: '   ',
    })
    expect(validateIntroForExport(updated)).toEqual(['Escribe el nombre del caso práctico'])
  })
})

describe('validatePendingContentForExport (milestone "+1 fallo con Game Over")', () => {
  it('sin ningún bloque de imagen pendiente, no devuelve ningún problema', () => {
    const project = createProject('P')
    expect(validatePendingContentForExport(project)).toEqual([])
  })

  it('detecta un bloque de imagen pendiente (sin assetId) y lo identifica por el número D de su diapositiva', () => {
    const project = createProject('P')
    const slideId = project.graph.startNodeId
    const withPending = addImageBlock(project, slideId)

    const issues = validatePendingContentForExport(withPending)
    expect(issues).toEqual(['La diapositiva D1 tiene una imagen pendiente de subir.'])
  })

  it('detecta varios bloques pendientes en distintas diapositivas', () => {
    let project = createProject('P')
    const firstSlideId = project.graph.startNodeId
    project = addImageBlock(project, firstSlideId)
    project = createNode(project, 'slide', { x: 200, y: 0 })
    const secondSlideId = project.graph.nodes.find(
      (node) => node.type === 'slide' && node.id !== firstSlideId,
    )?.id
    if (!secondSlideId) throw new Error('setup inválido')
    project = addImageBlock(project, secondSlideId)

    const issues = validatePendingContentForExport(project)
    expect(issues).toHaveLength(2)
  })

  it('un bloque de imagen con assetId ya asignado no cuenta como pendiente', () => {
    const project = createProject('P')
    const slideId = project.graph.startNodeId
    const withImage = addImageBlock(project, slideId, '11111111-1111-1111-1111-111111111111')

    expect(validatePendingContentForExport(withImage)).toEqual([])
  })
})
