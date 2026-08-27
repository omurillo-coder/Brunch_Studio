import { describe, expect, it } from 'vitest'
import { buildScriptDocument } from '../scriptExport'
import { CICLOS } from '../../domain'
import type {
  ContentBlock,
  DecisionResponse,
  FinalNode,
  IntroNode,
  ProjectDocument,
  SlideNode,
  VariableDef,
} from '../../domain'

/**
 * Tests de `buildScriptDocument` (vista de guión imprimible, export de solo
 * lectura distinto del HTML/SCORM interactivo).
 *
 * Cubre un proyecto con varios tipos de nodo (Inicio completo, diapositiva
 * "de continuar" con condición, diapositiva de decisión, Final) y comprueba
 * que el documento resultante tiene las secciones/textos esperados: título de
 * cada diapositiva, contenido, destinos por NÚMERO (nunca por id), marcadores
 * de medios (incluido `video`, el cuarto tipo de bloque llegado en paralelo —
 * ver cabecera de `scriptExport.ts`) y el resumen de portada.
 */

/** Documento Tiptap de un único párrafo, mismo formato que
 *  `RichTextEditor`/`parseRichBody`. */
function richBody(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
  })
}

let blockCounter = 0
function textBlock(body: string): ContentBlock {
  blockCounter += 1
  return { id: `block-text-${blockCounter}`, type: 'text', body }
}
function imageBlock(assetId: string): ContentBlock {
  blockCounter += 1
  return { id: `block-image-${blockCounter}`, type: 'image', assetId }
}
function audioBlock(assetId: string): ContentBlock {
  blockCounter += 1
  return { id: `block-audio-${blockCounter}`, type: 'audio', assetId }
}
function videoBlock(assetId: string): ContentBlock {
  blockCounter += 1
  return { id: `block-video-${blockCounter}`, type: 'video', assetId }
}

function makeResponse(overrides: Partial<DecisionResponse> & { id: string }): DecisionResponse {
  return { letter: 'A', text: '', ...overrides } as DecisionResponse
}

const INTRO_ID = '10000000-0000-4000-8000-000000000001'
const CONTINUE_ID = '10000000-0000-4000-8000-000000000002'
const DECISION_ID = '10000000-0000-4000-8000-000000000003'
const FINAL_GOOD_ID = '10000000-0000-4000-8000-000000000004'
const FINAL_BAD_ID = '10000000-0000-4000-8000-000000000005'
const RESPONSE_GOOD_ID = '10000000-0000-4000-8000-000000000006'
const RESPONSE_EMPTY_ID = '10000000-0000-4000-8000-000000000007'
const VARIABLE_ID = '10000000-0000-4000-8000-000000000008'
const IMAGE_ASSET_ID = '20000000-0000-4000-8000-000000000001'
const AUDIO_ASSET_ID = '20000000-0000-4000-8000-000000000002'
const VIDEO_ASSET_ID = '20000000-0000-4000-8000-000000000003'

/** Proyecto de ejemplo con: Inicio completo, una diapositiva "de continuar"
 *  con condición de aparición (y bloques de texto/imagen/audio/vídeo), una
 *  diapositiva de decisión (una respuesta con destino, otra sin texto ni
 *  destino) y dos Finales. */
function sampleProject(): ProjectDocument {
  const ciclo = CICLOS[0]!
  const asignatura = ciclo.asignaturas[0]!

  const intro: IntroNode = {
    id: INTRO_ID,
    number: 1,
    type: 'intro',
    position: { x: 0, y: 0 },
    title: '',
    cicloId: ciclo.id,
    asignaturaId: asignatura.id,
    caseName: 'Caso de urgencias',
    targetNodeId: CONTINUE_ID,
  }

  const continueSlide: SlideNode = {
    id: CONTINUE_ID,
    number: 2,
    type: 'slide',
    position: { x: 200, y: 0 },
    title: 'Bienvenida',
    targetNodeId: DECISION_ID,
    condition: { variableId: VARIABLE_ID, operator: '>=', value: 5 },
    elseTargetNodeId: FINAL_BAD_ID,
    continueLabel: undefined,
    responses: [],
    content: [
      textBlock(richBody('El paciente llega inconsciente.')),
      imageBlock(IMAGE_ASSET_ID),
      audioBlock(AUDIO_ASSET_ID),
      videoBlock(VIDEO_ASSET_ID),
    ],
  }

  const decisionSlide: SlideNode = {
    id: DECISION_ID,
    number: 3,
    type: 'slide',
    position: { x: 400, y: 0 },
    title: '¿Qué haces?',
    targetNodeId: undefined,
    continueLabel: undefined,
    responses: [
      makeResponse({
        id: RESPONSE_GOOD_ID,
        letter: 'A',
        text: 'Avisar al responsable',
        targetNodeId: FINAL_GOOD_ID,
      }),
      makeResponse({
        id: RESPONSE_EMPTY_ID,
        letter: 'B',
        text: '',
        targetNodeId: undefined,
      }),
    ],
    content: [textBlock(richBody('El paciente no responde.'))],
  }

  const finalGood: FinalNode = {
    id: FINAL_GOOD_ID,
    number: 4,
    type: 'final',
    position: { x: 600, y: 0 },
    title: 'Caso resuelto',
    body: richBody('Has actuado correctamente.'),
  }

  const finalBad: FinalNode = {
    id: FINAL_BAD_ID,
    number: 5,
    type: 'final',
    position: { x: 600, y: 200 },
    title: 'Caso fallido',
    body: richBody('No has llegado a tiempo.'),
  }

  const variable: VariableDef = {
    id: VARIABLE_ID,
    name: 'puntos',
    type: 'number',
    initialValue: 0,
  }

  return {
    schemaVersion: 1,
    metadata: {
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Escenario de <prueba>',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    settings: {},
    variables: [variable],
    graph: {
      nodes: [decisionSlide, intro, finalBad, continueSlide, finalGood], // orden deliberadamente desordenado
      startNodeId: INTRO_ID,
    },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  }
}

describe('buildScriptDocument', () => {
  it('produce un documento HTML con el nombre del proyecto en el título y en la portada', () => {
    const html = buildScriptDocument(sampleProject())
    expect(html).toContain('<title>Escenario de &lt;prueba&gt; — Guión imprimible</title>')
    expect(html).toContain('<h1>Escenario de &lt;prueba&gt;</h1>')
  })

  it('resuelve ciclo/asignatura/caso de la portada a texto legible cuando Inicio está completo', () => {
    const project = sampleProject()
    const ciclo = CICLOS[0]!
    const asignatura = ciclo.asignaturas[0]!
    const html = buildScriptDocument(project)

    expect(html).toContain('cover-meta')
    expect(html).toContain(ciclo.name)
    expect(html).toContain(asignatura.name)
    expect(html).toContain('Caso de urgencias')
  })

  it('no muestra resumen de portada cuando Inicio está incompleto', () => {
    const project = sampleProject()
    const intro = project.graph.nodes.find((node): node is IntroNode => node.type === 'intro')!
    intro.caseName = ''
    const html = buildScriptDocument(project)
    expect(html).not.toContain('<p class="cover-meta"')
  })

  it('recorre los nodos en orden de número, no en el orden del array', () => {
    const html = buildScriptDocument(sampleProject())
    // Cabeceras completas (`<h2>...</h2>`), no solo "Final 4"/"Diapositiva 2":
    // esas cadenas más cortas también aparecen antes, como referencia de
    // destino dentro de OTRA sección (p.ej. "→ Final 4" en la respuesta de la
    // diapositiva de decisión), así que no sirven para verificar el orden de
    // las propias secciones.
    const introIndex = html.indexOf('Inicio 1 — Sin referencia')
    const continueIndex = html.indexOf('Diapositiva 2 — Bienvenida')
    const decisionIndex = html.indexOf('Diapositiva 3 — ¿Qué haces?')
    const finalGoodIndex = html.indexOf('Final 4 — Caso resuelto')
    const finalBadIndex = html.indexOf('Final 5 — Caso fallido')
    expect(introIndex).toBeGreaterThan(-1)
    expect(introIndex).toBeLessThan(continueIndex)
    expect(continueIndex).toBeLessThan(decisionIndex)
    expect(decisionIndex).toBeLessThan(finalGoodIndex)
    expect(finalGoodIndex).toBeLessThan(finalBadIndex)
  })

  it('la diapositiva de Inicio muestra su resumen y a qué diapositiva lleva, por número', () => {
    const html = buildScriptDocument(sampleProject())
    expect(html).toContain('Inicio 1 — Sin referencia')
    expect(html).toContain('→ Diapositiva 2')
  })

  it('una diapositiva "de continuar" muestra su contenido, marcadores de medios (incluido vídeo) y destino', () => {
    const html = buildScriptDocument(sampleProject())
    expect(html).toContain('Diapositiva 2 — Bienvenida')
    expect(html).toContain('El paciente llega inconsciente.')
    expect(html).toContain('[Imagen adjunta]')
    expect(html).toContain('[Audio adjunto]')
    expect(html).toContain('[Vídeo adjunto]')
    expect(html).toContain('→ Diapositiva 3')
  })

  it('indica la condición de enrutado con nombre de variable, operador y valor legibles, y ambos destinos', () => {
    const html = buildScriptDocument(sampleProject())
    expect(html).toContain('puntos')
    expect(html).toContain('es mayor o igual que')
    expect(html).toContain('5')
    expect(html).toContain('si se cumple → Diapositiva 3')
    expect(html).toContain('si no → Final 5')
  })

  it('una diapositiva de decisión lista cada respuesta con su texto y destino por número', () => {
    const html = buildScriptDocument(sampleProject())
    expect(html).toContain('Diapositiva 3 — ¿Qué haces?')
    expect(html).toContain('Avisar al responsable')
    expect(html).toContain('→ Final 4')
  })

  it('una respuesta sin texto ni destino se marca honestamente', () => {
    const html = buildScriptDocument(sampleProject())
    expect(html).toContain('Opción sin texto')
    expect(html).toContain('(sin destino configurado)')
  })

  it('un nodo Final se marca como tal y muestra su propio contenido', () => {
    const html = buildScriptDocument(sampleProject())
    expect(html).toContain('Final 4 — Caso resuelto')
    expect(html).toContain('Has actuado correctamente.')
    expect(html).toContain('Final 5 — Caso fallido')
    expect(html).toContain('No has llegado a tiempo.')
    expect(html).toContain('termina el recorrido')
  })

  it('escapa HTML en textos libres (nombre de proyecto, referencia, contenido)', () => {
    const html = buildScriptDocument(sampleProject())
    expect(html).not.toContain('<prueba>')
  })
})
