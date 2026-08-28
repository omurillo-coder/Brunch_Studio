import { describe, expect, it } from 'vitest'
import { createProject } from '../project'
import { validateProject } from '../validation'
import { DEFAULT_PROJECT_TEMPLATE_ID, PROJECT_TEMPLATES, getProjectTemplate } from '../templates'
import type { IntroNode, ProjectDocument, SlideNode } from '../schemas'

function slideOf(project: ProjectDocument, id: string): SlideNode {
  const node = project.graph.nodes.find((candidate) => candidate.id === id)
  if (!node || node.type !== 'slide') {
    throw new Error(`No hay una diapositiva con id "${id}"`)
  }
  return node
}

/**
 * Milestone "Diapositiva de Inicio": el nodo `intro` de un proyecto —
 * `graph.startNodeId`, que las tres plantillas dejan siempre apuntando a él
 * tras `seedIntroNode` (ver `src/domain/templates.ts`).
 */
function introOf(project: ProjectDocument): IntroNode {
  const node = project.graph.nodes.find((candidate) => candidate.id === project.graph.startNodeId)
  if (!node || node.type !== 'intro') {
    throw new Error('El proyecto no tiene un nodo "intro" como startNodeId')
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

  it('las tres plantillas nacen con un único nodo intro, vacío, que es siempre graph.startNodeId', () => {
    for (const id of ['blank', 'simple-decision', 'branch-reunion']) {
      const project = getProjectTemplate(id).build('Proyecto de prueba')
      const introNodes = project.graph.nodes.filter((node) => node.type === 'intro')
      expect(introNodes).toHaveLength(1)

      const intro = introOf(project)
      expect(intro.cicloId).toBeUndefined()
      expect(intro.asignaturaId).toBeUndefined()
      expect(intro.caseName).toBe('')
      // Apunta a lo que antes de este milestone era el primer nodo/inicio
      // de la plantilla.
      expect(intro.targetNodeId).toBeDefined()
    }
  })

  it('milestone "Inicio siempre es D1": las tres plantillas nacen con el Inicio en number 1, y ningún otro nodo repite ese número', () => {
    for (const id of ['blank', 'simple-decision', 'branch-reunion']) {
      const project = getProjectTemplate(id).build('Proyecto de prueba')
      const intro = introOf(project)
      expect(intro.number).toBe(1)

      // Nunca dos nodos con el mismo `number`.
      const numbers = project.graph.nodes.map((node) => node.number)
      expect(new Set(numbers).size).toBe(numbers.length)
    }
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
  it('añade el nodo intro obligatorio delante de la única diapositiva que crea createProject, apuntándola y desplazando startNodeId', () => {
    const template = getProjectTemplate('blank')
    const fromTemplate = template.build('Mi escenario')
    const fromCreateProject = createProject('Mi escenario')

    expect(fromTemplate.schemaVersion).toBe(fromCreateProject.schemaVersion)
    expect(fromTemplate.metadata.name).toBe(fromCreateProject.metadata.name)
    expect(fromTemplate.settings).toEqual(fromCreateProject.settings)
    expect(fromTemplate.editor).toEqual(fromCreateProject.editor)

    // Un nodo más que `createProject` a secas: el intro.
    expect(fromTemplate.graph.nodes).toHaveLength(fromCreateProject.graph.nodes.length + 1)

    const intro = introOf(fromTemplate)
    const referenceNode = fromCreateProject.graph.nodes[0]
    const slide = fromTemplate.graph.nodes.find((node) => node.id !== intro.id)

    expect(slide?.type).toBe(referenceNode?.type)
    // Milestone "Inicio siempre es D1": el intro se queda con el 1 y esta
    // diapositiva (la única que crea `createProject`, `number: 1` ahí)
    // desplaza su número una unidad hacia arriba al pasar a ser la segunda
    // del proyecto, en vez de conservar el mismo número que en
    // `fromCreateProject`.
    expect(intro.number).toBe(1)
    expect(slide?.number).toBe((referenceNode?.number ?? 0) + 1)
    expect(slide?.title).toBe(referenceNode?.title)
    // Misma diapositiva de siempre (mismo único bloque de texto vacío),
    // ahora precedida por la portada en vez de ser ella misma el inicio.
    expect(
      slide?.type === 'slide' ? slide.content.map((b) => (b.type === 'text' ? b.body : b)) : undefined,
    ).toEqual(
      referenceNode?.type === 'slide'
        ? referenceNode.content.map((b) => (b.type === 'text' ? b.body : b))
        : undefined,
    )
    expect(slide?.position).toEqual(referenceNode?.position)

    // El intro apunta a esa diapositiva y es ahora el startNodeId real.
    expect(intro.targetNodeId).toBe(slide?.id)
    expect(fromTemplate.graph.startNodeId).toBe(intro.id)
    // Posición del intro: a la izquierda de la diapositiva, offset fijo de
    // 260px en X (mismo criterio que usa la síntesis de migración).
    expect(intro.position).toEqual({
      x: (slide?.position.x ?? 0) - 260,
      y: slide?.position.y,
    })
  })
})

describe('plantilla "Decisión simple"', () => {
  function build(): ProjectDocument {
    return getProjectTemplate('simple-decision').build('Decisión simple')
  }

  it('tiene 5 nodos: intro, inicio narrativo, decisión y dos finales distintos', () => {
    const project = build()
    expect(project.graph.nodes).toHaveLength(5)

    const intros = project.graph.nodes.filter((node) => node.type === 'intro')
    const slides = project.graph.nodes.filter((node) => node.type === 'slide')
    const finals = project.graph.nodes.filter((node) => node.type === 'final')
    expect(intros).toHaveLength(1)
    expect(slides).toHaveLength(2)
    expect(finals).toHaveLength(2)
    expect(finals[0]?.id).not.toBe(finals[1]?.id)
  })

  it('el intro apunta al inicio narrativo ("de continuar"), que a su vez conecta con la diapositiva de decisión', () => {
    const project = build()
    const intro = introOf(project)
    expect(intro.targetNodeId).toBeDefined()

    const start = slideOf(project, intro.targetNodeId!)
    expect(start.responses).toEqual([])
    expect(start.targetNodeId).toBeDefined()

    const decision = slideOf(project, start.targetNodeId!)
    expect(decision.title).toBe('¿Qué opción elige el usuario?')
  })

  it('la diapositiva de decisión tiene 2 respuestas, cada una con un destino final distinto', () => {
    const project = build()
    const intro = introOf(project)
    const start = slideOf(project, intro.targetNodeId!)
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

  it('tiene 5 nodos: intro, inicio narrativo, decisión, diapositiva común y un único final', () => {
    const project = build()
    expect(project.graph.nodes).toHaveLength(5)

    const intros = project.graph.nodes.filter((node) => node.type === 'intro')
    const slides = project.graph.nodes.filter((node) => node.type === 'slide')
    const finals = project.graph.nodes.filter((node) => node.type === 'final')
    expect(intros).toHaveLength(1)
    expect(slides).toHaveLength(3)
    expect(finals).toHaveLength(1)
  })

  it('ambas respuestas de la decisión llevan a la MISMA diapositiva intermedia', () => {
    const project = build()
    const intro = introOf(project)
    const start = slideOf(project, intro.targetNodeId!)
    const decision = slideOf(project, start.targetNodeId!)

    expect(decision.responses).toHaveLength(2)
    const targets = decision.responses.map((response) => response.targetNodeId)
    expect(targets[0]).toBeDefined()
    expect(targets[0]).toBe(targets[1])
  })

  it('la diapositiva común conecta ("de continuar") con el único final', () => {
    const project = build()
    const intro = introOf(project)
    const start = slideOf(project, intro.targetNodeId!)
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
