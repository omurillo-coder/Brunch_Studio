import { describe, expect, it } from 'vitest'
import { createProject } from '../project'
import { validateProject } from '../validation'
import { DEFAULT_PROJECT_TEMPLATE_ID, PROJECT_TEMPLATES, getProjectTemplate } from '../templates'
import type { ProjectDocument, SlideNode } from '../schemas'

function slideOf(project: ProjectDocument, id: string): SlideNode {
  const node = project.graph.nodes.find((candidate) => candidate.id === id)
  if (!node || node.type !== 'slide') {
    throw new Error(`No hay una diapositiva con id "${id}"`)
  }
  return node
}

describe('PROJECT_TEMPLATES', () => {
  it('define exactamente 3 plantillas, "En blanco" primero', () => {
    expect(PROJECT_TEMPLATES).toHaveLength(3)
    expect(PROJECT_TEMPLATES[0]?.id).toBe('blank')
    expect(PROJECT_TEMPLATES[0]?.name).toBe('En blanco')
  })

  it('cada plantilla tiene id, name y description no vacíos y build es una función', () => {
    for (const template of PROJECT_TEMPLATES) {
      expect(template.id.length).toBeGreaterThan(0)
      expect(template.name.length).toBeGreaterThan(0)
      expect(template.description.length).toBeGreaterThan(0)
      expect(typeof template.build).toBe('function')
    }
  })

  it('los ids son únicos', () => {
    const ids = PROJECT_TEMPLATES.map((template) => template.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('DEFAULT_PROJECT_TEMPLATE_ID apunta a "blank"', () => {
    expect(DEFAULT_PROJECT_TEMPLATE_ID).toBe('blank')
  })

  it('getProjectTemplate encuentra por id y lanza si no existe', () => {
    expect(getProjectTemplate('simple-decision').name).toBe('Decisión simple')
    expect(() => getProjectTemplate('no-existe')).toThrow()
  })

  it('las plantillas con estructura ("Decisión simple", "Ramificación con reencuentro") no generan ningún aviso de validateProject', () => {
    for (const id of ['simple-decision', 'branch-reunion']) {
      const project = getProjectTemplate(id).build('Proyecto de prueba')
      expect(validateProject(project)).toEqual([])
    }
  })

  it('"En blanco" tiene exactamente los mismos avisos que createProject (ninguna plantilla empeora lo ya existente)', () => {
    const fromTemplate = getProjectTemplate('blank').build('Proyecto de prueba')
    const fromCreateProject = createProject('Proyecto de prueba')
    const stripIds = (issues: ReturnType<typeof validateProject>) =>
      issues.map((issue) => issue.code)
    expect(stripIds(validateProject(fromTemplate))).toEqual(stripIds(validateProject(fromCreateProject)))
  })

  it('cada plantilla usa el nombre de proyecto pasado a build', () => {
    for (const template of PROJECT_TEMPLATES) {
      const project = template.build('Mi proyecto')
      expect(project.metadata.name).toBe('Mi proyecto')
      expect(project.schemaVersion).toBe(1)
    }
  })
})

describe('plantilla "En blanco"', () => {
  it('produce exactamente el mismo resultado que createProject (salvo ids/fechas)', () => {
    const template = getProjectTemplate('blank')
    const fromTemplate = template.build('Mi escenario')
    const fromCreateProject = createProject('Mi escenario')

    expect(fromTemplate.schemaVersion).toBe(fromCreateProject.schemaVersion)
    expect(fromTemplate.metadata.name).toBe(fromCreateProject.metadata.name)
    expect(fromTemplate.settings).toEqual(fromCreateProject.settings)
    expect(fromTemplate.editor).toEqual(fromCreateProject.editor)
    expect(fromTemplate.graph.nodes).toHaveLength(fromCreateProject.graph.nodes.length)
    expect(fromTemplate.graph.nodes).toHaveLength(1)

    const node = fromTemplate.graph.nodes[0]
    const referenceNode = fromCreateProject.graph.nodes[0]
    expect(node?.type).toBe(referenceNode?.type)
    expect(node?.number).toBe(referenceNode?.number)
    expect(node?.title).toBe(referenceNode?.title)
    // Ambos nacen con el mismo único bloque de texto vacío (mismo criterio
    // que `body` antes de "Bloques de contenido"): se compara por tipo/body,
    // ignorando el `id` de bloque, que es aleatorio en cada llamada.
    expect(node?.type === 'slide' ? node.content.map((b) => (b.type === 'text' ? b.body : b)) : undefined).toEqual(
      referenceNode?.type === 'slide'
        ? referenceNode.content.map((b) => (b.type === 'text' ? b.body : b))
        : undefined,
    )
    expect(node?.position).toEqual(referenceNode?.position)
    expect(fromTemplate.graph.startNodeId).toBe(node?.id)
  })
})

describe('plantilla "Decisión simple"', () => {
  function build(): ProjectDocument {
    return getProjectTemplate('simple-decision').build('Decisión simple')
  }

  it('tiene 4 nodos: inicio, decisión y dos finales distintos', () => {
    const project = build()
    expect(project.graph.nodes).toHaveLength(4)

    const slides = project.graph.nodes.filter((node) => node.type === 'slide')
    const finals = project.graph.nodes.filter((node) => node.type === 'final')
    expect(slides).toHaveLength(2)
    expect(finals).toHaveLength(2)
    expect(finals[0]?.id).not.toBe(finals[1]?.id)
  })

  it('el inicio ("de continuar") conecta con la diapositiva de decisión', () => {
    const project = build()
    const start = slideOf(project, project.graph.startNodeId)
    expect(start.responses).toEqual([])
    expect(start.targetNodeId).toBeDefined()

    const decision = slideOf(project, start.targetNodeId!)
    expect(decision.title).toBe('¿Qué opción elige el usuario?')
  })

  it('la diapositiva de decisión tiene 2 respuestas, cada una con un destino final distinto', () => {
    const project = build()
    const start = slideOf(project, project.graph.startNodeId)
    const decision = slideOf(project, start.targetNodeId!)

    expect(decision.responses).toHaveLength(2)
    const targets = decision.responses.map((response) => response.targetNodeId)
    expect(targets.every((target) => target !== undefined)).toBe(true)
    expect(new Set(targets).size).toBe(2)

    const targetNodes = targets.map(
      (targetId) => project.graph.nodes.find((node) => node.id === targetId)!,
    )
    expect(targetNodes.every((node) => node.type === 'final')).toBe(true)

    const texts = decision.responses.map((response) => response.text).sort()
    expect(texts).toEqual(['Opción A', 'Opción B'])
  })
})

describe('plantilla "Ramificación con reencuentro"', () => {
  function build(): ProjectDocument {
    return getProjectTemplate('branch-reunion').build('Reencuentro')
  }

  it('tiene 4 nodos: inicio, decisión, diapositiva común y un único final', () => {
    const project = build()
    expect(project.graph.nodes).toHaveLength(4)

    const slides = project.graph.nodes.filter((node) => node.type === 'slide')
    const finals = project.graph.nodes.filter((node) => node.type === 'final')
    expect(slides).toHaveLength(3)
    expect(finals).toHaveLength(1)
  })

  it('ambas respuestas de la decisión llevan a la MISMA diapositiva intermedia', () => {
    const project = build()
    const start = slideOf(project, project.graph.startNodeId)
    const decision = slideOf(project, start.targetNodeId!)

    expect(decision.responses).toHaveLength(2)
    const targets = decision.responses.map((response) => response.targetNodeId)
    expect(targets[0]).toBeDefined()
    expect(targets[0]).toBe(targets[1])
  })

  it('la diapositiva común conecta ("de continuar") con el único final', () => {
    const project = build()
    const start = slideOf(project, project.graph.startNodeId)
    const decision = slideOf(project, start.targetNodeId!)
    const meetingId = decision.responses[0]?.targetNodeId
    expect(meetingId).toBeDefined()

    const meeting = slideOf(project, meetingId!)
    expect(meeting.responses).toEqual([])
    expect(meeting.targetNodeId).toBeDefined()

    const final = project.graph.nodes.find((node) => node.id === meeting.targetNodeId)
    expect(final?.type).toBe('final')
  })
})
