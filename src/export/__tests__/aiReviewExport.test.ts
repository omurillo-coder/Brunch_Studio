import { describe, expect, it } from 'vitest'
import { buildAiReviewDocument } from '../aiReviewExport'
import { CICLOS, cicloOutputName } from '../../domain'
import { createProject } from '../../domain/project'
import { addGameOverPack } from '../../domain/nodePacks'
import type {
  DecisionResponse,
  FinalNode,
  IntroNode,
  ProjectDocument,
  SlideNode,
  VariableDef,
} from '../../domain'

/** Documento Tiptap serializado de un único párrafo, tal cual lo guarda
 *  `RichTextEditor` — mismo helper que `htmlBundle.test.ts`. */
function richBody(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })
}

function makeResponse(overrides: Partial<DecisionResponse> & { id: string }): DecisionResponse {
  return { letter: 'A', text: '', ...overrides } as DecisionResponse
}

const FLAG_VAR_ID = '88888888-8888-4888-8888-888888888801'
const COUNTER_VAR_ID = '88888888-8888-4888-8888-888888888802'

const INTRO_ID = '11111111-1111-4111-8111-111111111110'
const SLIDE_CONTENT_ID = '11111111-1111-4111-8111-111111111111'
const DECISION_ID = '22222222-2222-4222-8222-222222222222'
const FINAL_A_ID = '33333333-3333-4333-8333-333333333333'
const FINAL_B_ID = '33333333-3333-4333-8333-333333333334'
const RESPONSE_GOOD_ID = '44444444-4444-4444-8444-444444444441'
const RESPONSE_EXIT_ID = '44444444-4444-4444-8444-444444444442'
const ORPHAN_SLIDE_ID = '55555555-5555-4555-8555-555555555555'

/** Proyecto de prueba con un poco de todo lo que `buildAiReviewDocument`
 *  tiene que saber describir: portada con ciclo/asignatura, variables,
 *  bloques de contenido intercalados, una decisión con condición/efectos/
 *  puntos/salida (`actsAsExit`), un Final con variante alternativa +
 *  confeti, y una diapositiva SIN conectar a nada (huérfana) para
 *  comprobar que también aparece. */
function sampleProject(): ProjectDocument {
  const ciclo = CICLOS[0]!
  const asignatura = ciclo.asignaturas[0]!

  const flag: VariableDef = { id: FLAG_VAR_ID, name: 'Aprobado', type: 'boolean', initialValue: false }
  const counter: VariableDef = { id: COUNTER_VAR_ID, name: 'Puntos', type: 'number', initialValue: 0 }

  const intro: IntroNode = {
    id: INTRO_ID,
    number: 1,
    type: 'intro',
    position: { x: 0, y: 0 },
    title: '',
    cicloId: ciclo.id,
    asignaturaId: asignatura.id,
    caseName: 'Caso de revisión con IA',
    targetNodeId: SLIDE_CONTENT_ID,
  }

  const contentSlide: SlideNode = {
    id: SLIDE_CONTENT_ID,
    number: 2,
    type: 'slide',
    position: { x: 0, y: 0 },
    title: 'Bienvenida',
    targetNodeId: DECISION_ID,
    responses: [],
    content: [
      { id: 'b1', type: 'text', body: richBody('Bienvenido al caso práctico.') },
      { id: 'b2', type: 'image', assetId: 'asset-1' },
      { id: 'b3', type: 'text', body: richBody('Presta atención al protocolo.') },
    ],
  }

  const decision: SlideNode = {
    id: DECISION_ID,
    number: 3,
    type: 'slide',
    position: { x: 0, y: 0 },
    title: '¿Qué haces?',
    targetNodeId: undefined,
    responses: [
      makeResponse({
        id: RESPONSE_GOOD_ID,
        letter: 'A',
        text: 'Avisar al responsable',
        targetNodeId: FINAL_A_ID,
        points: 10,
        condition: { variableId: FLAG_VAR_ID, operator: '==', value: false },
        effects: [{ variableId: COUNTER_VAR_ID, operation: 'increment', value: 5 }],
      }),
      makeResponse({
        id: RESPONSE_EXIT_ID,
        letter: 'B',
        text: 'No, me rindo.',
        actsAsExit: true,
      }),
    ],
    content: [{ id: 'b4', type: 'text', body: richBody('El paciente no responde.') }],
  }

  const finalA: FinalNode = {
    id: FINAL_A_ID,
    number: 4,
    type: 'final',
    variant: 'general',
    position: { x: 0, y: 0 },
    title: '',
    body: richBody('Caso resuelto sin incidencias.'),
    celebrate: true,
    alternateCondition: { variableId: COUNTER_VAR_ID, operator: '>', value: 0 },
    alternateBody: richBody('Además, conseguiste puntos extra.'),
  }

  const finalB: FinalNode = {
    id: FINAL_B_ID,
    number: 5,
    type: 'final',
    variant: 'general',
    position: { x: 0, y: 0 },
    title: '',
    body: '',
  }

  const orphan: SlideNode = {
    id: ORPHAN_SLIDE_ID,
    number: 6,
    type: 'slide',
    position: { x: 0, y: 0 },
    title: 'Sin conectar todavía',
    targetNodeId: undefined,
    responses: [],
    content: [],
  }

  return {
    schemaVersion: 1,
    metadata: {
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Caso de prueba',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    settings: {},
    variables: [flag, counter],
    graph: { nodes: [intro, contentSlide, decision, finalA, finalB, orphan], startNodeId: INTRO_ID },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  }
}

describe('buildAiReviewDocument (petición de usuario: "que este archivo lo pudiese ver ChatGPT o alguna otra IA")', () => {
  it('empieza con el nombre del proyecto como título', () => {
    const doc = buildAiReviewDocument(sampleProject())
    expect(doc.startsWith('# Caso de prueba — Documento para revisión con IA')).toBe(true)
  })

  it('lista las variables con su tipo y valor inicial en español', () => {
    const doc = buildAiReviewDocument(sampleProject())
    expect(doc).toContain('- Aprobado (sí/no, valor inicial: falso)')
    expect(doc).toContain('- Puntos (número, valor inicial: 0)')
  })

  it('omite la sección de variables si el proyecto no tiene ninguna', () => {
    const project = sampleProject()
    project.variables = []
    const doc = buildAiReviewDocument(project)
    expect(doc).not.toContain('## Variables')
  })

  it('resuelve la portada: ciclo, asignatura, nombre del caso y destino', () => {
    const project = sampleProject()
    const ciclo = CICLOS[0]!
    const asignatura = ciclo.asignaturas[0]!
    const doc = buildAiReviewDocument(project)

    expect(doc).toContain('## Inicio 1 (portada)')
    expect(doc).toContain(`- Ciclo: ${cicloOutputName(ciclo.name)}`)
    expect(doc).toContain(`- Asignatura: ${asignatura.name}`)
    expect(doc).toContain('- Nombre del caso práctico: Caso de revisión con IA')
    expect(doc).toContain('- Continúa a: Diapositiva 2 — Bienvenida')
  })

  it('pinta los bloques de contenido en orden, con las imágenes como marcador entre corchetes', () => {
    const doc = buildAiReviewDocument(sampleProject())
    const section = sectionOf(doc, '## Diapositiva 2 — Bienvenida')

    const textIndex = section.indexOf('Bienvenido al caso práctico.')
    const imageIndex = section.indexOf('[Imagen]')
    const secondTextIndex = section.indexOf('Presta atención al protocolo.')
    expect(textIndex).toBeGreaterThan(-1)
    expect(imageIndex).toBeGreaterThan(textIndex)
    expect(secondTextIndex).toBeGreaterThan(imageIndex)
  })

  it('una diapositiva "de continuar" muestra su destino', () => {
    const doc = buildAiReviewDocument(sampleProject())
    const section = sectionOf(doc, '## Diapositiva 2 — Bienvenida')
    expect(section).toContain('Continúa a: Diapositiva 3 — ¿Qué haces?.')
  })

  it('una diapositiva "de decisión" lista cada respuesta con destino, condición, efectos y puntos', () => {
    const doc = buildAiReviewDocument(sampleProject())
    const section = sectionOf(doc, '## Diapositiva 3 — ¿Qué haces?')

    expect(section).toContain(
      '- A) "Avisar al responsable" → Final 4 [visible solo si Aprobado == falso] (efectos: Puntos += 5) (puntos: 10)',
    )
    expect(section).toContain('- B) "No, me rindo." → sale de la experiencia')
  })

  it('un Final con celebrate y variante alternativa describe ambos contenidos, con un único aviso de confeti para los dos', () => {
    const doc = buildAiReviewDocument(sampleProject())
    const section = sectionOf(doc, '## Final 4')

    expect(section).toContain('Caso resuelto sin incidencias.')
    expect(section).toContain(
      '🎉 Este Final se celebra con confeti al mostrarse (con o sin condición alternativa).',
    )
    expect(section).toContain('Contenido alternativo (se muestra en vez del anterior si Puntos > 0):')
    expect(section).toContain('Además, conseguiste puntos extra.')
  })

  it('un Final sin body ni celebrate ni alternativo se pinta "(sin contenido)", sin secciones de más', () => {
    const doc = buildAiReviewDocument(sampleProject())
    const section = sectionOf(doc, '## Final 5')

    expect(section).toContain('(sin contenido)')
    expect(section).not.toContain('🎉')
    expect(section).not.toContain('Contenido alternativo')
  })

  it('una diapositiva sin conectar a nada (huérfana) también aparece, con "Sin destino"', () => {
    const doc = buildAiReviewDocument(sampleProject())
    expect(doc).toContain('## Diapositiva 6 — Sin conectar todavía')
    expect(doc).toContain('Continúa a: Sin destino.')
  })

  it('las secciones aparecen en orden de `number`, no en el orden del array de nodos', () => {
    const project = sampleProject()
    // Reordena el array a propósito: el documento debe seguir saliendo 1→6.
    project.graph.nodes = [...project.graph.nodes].reverse()
    const doc = buildAiReviewDocument(project)

    const headings = [
      '## Inicio 1',
      '## Diapositiva 2',
      '## Diapositiva 3',
      '## Final 4',
      '## Final 5',
      '## Diapositiva 6',
    ]
    const indices = headings.map((heading) => doc.indexOf(heading))
    expect(indices).toEqual([...indices].sort((a, b) => a - b))
    expect(indices.every((index) => index > -1)).toBe(true)
  })

  it('nunca incluye internalNote (nota interna del equipo, no parte de la experiencia)', () => {
    const project = sampleProject()
    const slide = project.graph.nodes.find((node) => node.id === SLIDE_CONTENT_ID)
    if (slide) slide.internalNote = 'Pedir gráfico a diseño — SECRETO_INTERNO'
    const doc = buildAiReviewDocument(project)
    expect(doc).not.toContain('SECRETO_INTERNO')
  })
})

describe('diapositiva "Game Over" bespoke (SlideNode.brandedGameOverScreen)', () => {
  /** Corrección de revisión de código: `node.content` de esta diapositiva
   *  siempre está vacío (la pantalla es fija, ver `addGameOverPack`), así
   *  que describirla como cualquier otra diapositiva la reportaba como
   *  "(sin contenido)" — un falso "diapositiva vacía/sin terminar" para
   *  quien revisa el documento, cuando en realidad el Player muestra una
   *  pantalla de marca completa con logo, título e ilustración. */
  it('describe el contenido FIJO real (logo, título, ilustración) en vez de "(sin contenido)"', () => {
    const project = addGameOverPack(createProject('Caso Game Over'), { x: 0, y: 0 })
    const gameOverNode = project.graph.nodes.find(
      (node) => node.type === 'slide' && node.brandedGameOverScreen,
    )
    if (!gameOverNode) throw new Error('setup inválido: no se creó la diapositiva Game Over')

    const doc = buildAiReviewDocument(project)
    // Título vacío por defecto (`addGameOverPack` no lo fija) -> sin
    // segmento "— título" en la cabecera, mismo criterio que `nodeLabel`.
    const section = sectionOf(doc, `## Diapositiva ${gameOverNode.number}`)

    expect(section).not.toContain('(sin contenido)')
    expect(section).toContain('¿Seguro que no quieres volver a intentarlo?')
    expect(section).toContain('Reintentar')
    expect(section).toContain('Salir')
  })
})

/** Extrae el texto entre una cabecera `## ...` y la siguiente (o el final
 *  del documento) — así cada test comprueba SOLO la sección que le
 *  interesa, sin que el resto del documento pueda hacer pasar una
 *  aserción por accidente. */
function sectionOf(doc: string, heading: string): string {
  const start = doc.indexOf(heading)
  if (start === -1) throw new Error(`No se encontró la sección "${heading}"`)
  const next = doc.indexOf('\n## ', start + heading.length)
  return next === -1 ? doc.slice(start) : doc.slice(start, next)
}
