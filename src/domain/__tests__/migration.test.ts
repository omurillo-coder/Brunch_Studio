import { describe, expect, it } from 'vitest'
import { ProjectMigrationError, parseOrMigrateProjectDocument } from '../migration'
import { createProject } from '../project'
import type { ContentBlock } from '../schemas'

/**
 * Fixtures con la forma ANTIGUA del documento (`start`/`content`/`decision`/
 * `final`, sin `graph.startNodeId`). Se escriben como JSON literal a
 * propósito: representan bytes ya guardados en disco por una versión anterior
 * de la app, no algo que el dominio actual pueda construir.
 */

const START_ID = '11111111-1111-4111-8111-111111111111'
const CONTENT_ID = '22222222-2222-4222-8222-222222222222'
const DECISION_ID = '33333333-3333-4333-8333-333333333333'
const FINAL_ID = '44444444-4444-4444-8444-444444444444'
const RESPONSE_A_ID = '55555555-5555-4555-8555-555555555555'
const RESPONSE_B_ID = '66666666-6666-4666-8666-666666666666'
const IMAGE_ID = '77777777-7777-4777-8777-777777777777'
const IMAGE_ID_2 = '77777777-7777-4777-8777-777777777779'
const AUDIO_ID = '88888888-8888-4888-8888-888888888888'
const PROJECT_ID = '99999999-9999-4999-8999-999999999999'

function legacyBase() {
  return {
    schemaVersion: 1,
    metadata: {
      id: PROJECT_ID,
      name: 'Escenario antiguo',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    settings: {},
    editor: { viewport: { x: 10, y: 20, zoom: 1.5 } },
  }
}

/** Ordena por tipo/assetId una lista de bloques para comparar solo su
 *  "forma" (tipo + body/assetId), ignorando el `id` generado de nuevo en
 *  cada migración (aleatorio, no determinista) — igual que se comparan
 *  respuestas/variables en otros tests de este archivo por sus campos de
 *  negocio, no por el id técnico que genera `createId()`. */
function blockShapes(blocks: ContentBlock[]): unknown[] {
  return blocks.map((block) =>
    block.type === 'text' ? { type: 'text', body: block.body } : { type: block.type, assetId: block.assetId },
  )
}

/** start -> content -> decision (A/B) -> final, el caso completo. */
function legacyFullDocument(): unknown {
  return {
    ...legacyBase(),
    graph: {
      nodes: [
        {
          id: START_ID,
          number: 1,
          type: 'start',
          position: { x: 0, y: 0 },
          title: '',
          body: '',
          targetNodeId: CONTENT_ID,
        },
        {
          id: CONTENT_ID,
          number: 2,
          type: 'content',
          position: { x: 200, y: 0 },
          title: 'Bienvenida',
          body: '<p>Hola</p>',
          targetNodeId: DECISION_ID,
          imageAssetId: IMAGE_ID,
          audioAssetId: AUDIO_ID,
        },
        {
          id: DECISION_ID,
          number: 3,
          type: 'decision',
          position: { x: 400, y: 0 },
          title: '¿Qué haces?',
          body: '',
          responses: [
            {
              id: RESPONSE_A_ID,
              letter: 'A',
              text: 'Opción buena',
              points: 10,
              targetNodeId: FINAL_ID,
            },
            {
              id: RESPONSE_B_ID,
              letter: 'B',
              text: 'Opción mala',
              points: -5,
              targetNodeId: FINAL_ID,
              imageAssetId: IMAGE_ID,
            },
          ],
        },
        {
          id: FINAL_ID,
          number: 4,
          type: 'final',
          position: { x: 600, y: 0 },
          title: 'Fin',
          body: '<p>Has terminado</p>',
        },
      ],
    },
  }
}

describe('parseOrMigrateProjectDocument — documento con forma antigua', () => {
  it('convierte content y decision en slide, elimina el start y fija startNodeId a su destino', () => {
    const migrated = parseOrMigrateProjectDocument(legacyFullDocument())

    // El nodo start desaparece; los otros tres se conservan.
    expect(migrated.graph.nodes.map((node) => node.id)).toEqual([
      CONTENT_ID,
      DECISION_ID,
      FINAL_ID,
    ])
    expect(migrated.graph.startNodeId).toBe(CONTENT_ID)

    // Metadata/editor/settings intactos.
    expect(migrated.metadata).toEqual(legacyBase().metadata)
    expect(migrated.editor.viewport).toEqual({ x: 10, y: 20, zoom: 1.5 })
  })

  it('un content se convierte en diapositiva "de continuar" conservando destino y adjuntos, ahora como bloques de content', () => {
    const migrated = parseOrMigrateProjectDocument(legacyFullDocument())
    const slide = migrated.graph.nodes.find((node) => node.id === CONTENT_ID)

    expect(slide?.type).toBe('slide')
    if (slide?.type !== 'slide') throw new Error('esperaba una diapositiva')
    expect(slide.responses).toEqual([])
    expect(slide.targetNodeId).toBe(DECISION_ID)
    expect(slide.title).toBe('Bienvenida')
    expect(slide.continueLabel).toBeUndefined()

    // El antiguo `body` + `imageAssetId` + `audioAssetId` (sin `contentOrder`
    // explícito, migrado con el valor por defecto 'text-first') se
    // convierten en tres bloques en ese orden: texto, imagen, audio.
    expect(blockShapes(slide.content)).toEqual([
      { type: 'text', body: '<p>Hola</p>' },
      { type: 'image', assetId: IMAGE_ID },
      { type: 'audio', assetId: AUDIO_ID },
    ])
  })

  it('un decision se convierte en diapositiva con sus respuestas intactas', () => {
    const migrated = parseOrMigrateProjectDocument(legacyFullDocument())
    const slide = migrated.graph.nodes.find((node) => node.id === DECISION_ID)

    expect(slide?.type).toBe('slide')
    if (slide?.type !== 'slide') throw new Error('esperaba una diapositiva')
    expect(slide.responses.map((response) => response.id)).toEqual([RESPONSE_A_ID, RESPONSE_B_ID])
    expect(slide.responses.map((response) => response.letter)).toEqual(['A', 'B'])
    expect(slide.responses[0]?.points).toBe(10)
    expect(slide.responses[1]?.points).toBe(-5)
    expect(slide.responses[1]?.targetNodeId).toBe(FINAL_ID)
    expect(slide.responses[1]?.imageAssetId).toBe(IMAGE_ID)
    // Una decisión antigua no tenía destino propio de "continuar".
    expect(slide.targetNodeId).toBeUndefined()
    // Su `body` (vacío) migra igualmente a un único bloque de texto: el
    // bloque de texto SIEMPRE se crea, incluso vacío.
    expect(blockShapes(slide.content)).toEqual([{ type: 'text', body: '' }])
  })

  it('un final se conserva tal cual (sigue teniendo un único body, no content)', () => {
    const migrated = parseOrMigrateProjectDocument(legacyFullDocument())
    const final = migrated.graph.nodes.find((node) => node.id === FINAL_ID)
    expect(final?.type).toBe('final')
    if (final?.type !== 'final') throw new Error('esperaba un nodo final')
    expect(final.title).toBe('Fin')
    expect(final.body).toBe('<p>Has terminado</p>')
  })

  it('si el start no tenía destino, el inicio pasa a ser el nodo de menor number', () => {
    const document = legacyFullDocument() as {
      graph: { nodes: { id: string; targetNodeId?: string }[] }
    }
    const start = document.graph.nodes.find((node) => node.id === START_ID)
    if (start) delete start.targetNodeId

    const migrated = parseOrMigrateProjectDocument(document)
    // El de menor `number` entre los migrados es el antiguo content (2).
    expect(migrated.graph.startNodeId).toBe(CONTENT_ID)
  })

  it('si el start apuntaba a un nodo que ya no existe, cae al nodo de menor number', () => {
    const document = legacyFullDocument() as {
      graph: { nodes: { id: string; targetNodeId?: string }[] }
    }
    const start = document.graph.nodes.find((node) => node.id === START_ID)
    if (start) start.targetNodeId = '00000000-0000-4000-8000-000000000000'

    const migrated = parseOrMigrateProjectDocument(document)
    expect(migrated.graph.startNodeId).toBe(CONTENT_ID)
  })

  it('un documento antiguo con solo el nodo start convierte ese start en la diapositiva de inicio', () => {
    const document = {
      ...legacyBase(),
      graph: {
        nodes: [
          {
            id: START_ID,
            number: 1,
            type: 'start',
            position: { x: 0, y: 0 },
            title: 'Arranque',
            body: '',
          },
        ],
      },
    }

    const migrated = parseOrMigrateProjectDocument(document)
    expect(migrated.graph.nodes).toHaveLength(1)
    expect(migrated.graph.nodes[0]?.type).toBe('slide')
    expect(migrated.graph.nodes[0]?.title).toBe('Arranque')
    expect(migrated.graph.startNodeId).toBe(START_ID)
  })

  it('un documento antiguo sin ningún start usa el nodo de menor number como inicio', () => {
    const document = {
      ...legacyBase(),
      graph: {
        nodes: [
          {
            id: FINAL_ID,
            number: 7,
            type: 'final',
            position: { x: 0, y: 0 },
            title: 'Fin',
            body: '',
          },
          {
            id: CONTENT_ID,
            number: 3,
            type: 'content',
            position: { x: 0, y: 0 },
            title: 'Pantalla',
            body: '',
            targetNodeId: FINAL_ID,
          },
        ],
      },
    }

    const migrated = parseOrMigrateProjectDocument(document)
    expect(migrated.graph.startNodeId).toBe(CONTENT_ID)
  })
})

describe('parseOrMigrateProjectDocument — documento ya en forma nueva', () => {
  it('lo devuelve sin cambios', () => {
    const document = createProject('Escenario nuevo')
    const parsed = parseOrMigrateProjectDocument(JSON.parse(JSON.stringify(document)))

    expect(parsed).toEqual(JSON.parse(JSON.stringify(document)))
    expect(parsed.graph.startNodeId).toBe(document.graph.startNodeId)
  })
})

/**
 * Documento en la forma "pre-bloques-de-contenido": justo la forma que tenía
 * `SlideNode` antes de este milestone — un único `body`, una lista
 * `imageAssetIds`, un `audioAssetId` opcional y `contentOrder`
 * ('text-first'/'image-first'). Debe migrarse directamente a `content`, ver
 * `migrateContentBlocksDocument`.
 */
function preContentBlocksDocument(contentOrder: 'text-first' | 'image-first'): unknown {
  return {
    ...legacyBase(),
    variables: [],
    graph: {
      startNodeId: CONTENT_ID,
      nodes: [
        {
          id: CONTENT_ID,
          number: 1,
          type: 'slide',
          position: { x: 0, y: 0 },
          title: 'Bienvenida',
          body: '<p>Hola</p>',
          targetNodeId: DECISION_ID,
          continueLabel: 'Siguiente',
          responses: [],
          imageAssetIds: [IMAGE_ID, IMAGE_ID_2],
          audioAssetId: AUDIO_ID,
          contentOrder,
        },
        {
          id: DECISION_ID,
          number: 2,
          type: 'final',
          position: { x: 200, y: 0 },
          title: 'Fin',
          body: '',
        },
      ],
    },
  }
}

describe('parseOrMigrateProjectDocument — documento en la forma "pre-bloques-de-contenido"', () => {
  it("contentOrder 'text-first': content = [texto, ...imágenes en orden, audio]", () => {
    const migrated = parseOrMigrateProjectDocument(preContentBlocksDocument('text-first'))
    const slide = migrated.graph.nodes.find((node) => node.id === CONTENT_ID)

    expect(slide?.type).toBe('slide')
    if (slide?.type !== 'slide') throw new Error('esperaba una diapositiva')
    expect(blockShapes(slide.content)).toEqual([
      { type: 'text', body: '<p>Hola</p>' },
      { type: 'image', assetId: IMAGE_ID },
      { type: 'image', assetId: IMAGE_ID_2 },
      { type: 'audio', assetId: AUDIO_ID },
    ])
    // El resto de campos (fuera de content) se conserva intacto.
    expect(slide.targetNodeId).toBe(DECISION_ID)
    expect(slide.continueLabel).toBe('Siguiente')
    expect(slide.title).toBe('Bienvenida')

    // Cada bloque tiene un id propio, nuevo y único (no reutiliza ninguno de
    // la forma anterior, que no tenía id de bloque).
    const ids = slide.content.map((block) => block.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.length).toBeGreaterThan(0)
  })

  it("contentOrder 'image-first': content = [...imágenes en orden, texto, audio]", () => {
    const migrated = parseOrMigrateProjectDocument(preContentBlocksDocument('image-first'))
    const slide = migrated.graph.nodes.find((node) => node.id === CONTENT_ID)

    expect(slide?.type).toBe('slide')
    if (slide?.type !== 'slide') throw new Error('esperaba una diapositiva')
    expect(blockShapes(slide.content)).toEqual([
      { type: 'image', assetId: IMAGE_ID },
      { type: 'image', assetId: IMAGE_ID_2 },
      { type: 'text', body: '<p>Hola</p>' },
      { type: 'audio', assetId: AUDIO_ID },
    ])
  })

  it('sin imágenes ni audio y con body vacío, content tiene igualmente un único bloque de texto vacío', () => {
    const doc = preContentBlocksDocument('text-first') as {
      graph: { nodes: { id: string; imageAssetIds?: string[]; audioAssetId?: string; body?: string }[] }
    }
    const node = doc.graph.nodes.find((candidate) => candidate.id === CONTENT_ID)
    if (node) {
      node.imageAssetIds = []
      delete node.audioAssetId
      node.body = ''
    }

    const migrated = parseOrMigrateProjectDocument(doc)
    const slide = migrated.graph.nodes.find((candidate) => candidate.id === CONTENT_ID)

    expect(slide?.type).toBe('slide')
    if (slide?.type !== 'slide') throw new Error('esperaba una diapositiva')
    expect(blockShapes(slide.content)).toEqual([{ type: 'text', body: '' }])
  })

  it('un final de esta forma conserva su body tal cual (sin content)', () => {
    const migrated = parseOrMigrateProjectDocument(preContentBlocksDocument('text-first'))
    const final = migrated.graph.nodes.find((node) => node.id === DECISION_ID)
    expect(final?.type).toBe('final')
    if (final?.type !== 'final') throw new Error('esperaba un nodo final')
    expect(final.body).toBe('')
  })
})

/**
 * Documento en la forma "imagen única": `SlideNode.imageAssetId` singular,
 * sin `contentOrder` ni `internalNote` — la forma que tenía la app justo
 * antes de admitir varias imágenes por diapositiva. Debe migrar ENCADENADO a
 * través de dos pasos (imagen única -> pre-bloques -> `content`) en una sola
 * llamada a `parseOrMigrateProjectDocument`, ver `migrateSingularImageDocument`
 * + `migrateContentBlocksDocument`.
 */
function singularImageDocument(overrides?: { imageAssetId?: string }): unknown {
  return {
    ...legacyBase(),
    graph: {
      startNodeId: CONTENT_ID,
      nodes: [
        {
          id: CONTENT_ID,
          number: 1,
          type: 'slide',
          position: { x: 0, y: 0 },
          title: 'Bienvenida',
          body: '<p>Hola</p>',
          targetNodeId: DECISION_ID,
          continueLabel: 'Siguiente',
          responses: [],
          imageAssetId: overrides?.imageAssetId,
          audioAssetId: AUDIO_ID,
        },
        {
          id: DECISION_ID,
          number: 2,
          type: 'slide',
          position: { x: 200, y: 0 },
          title: '¿Qué haces?',
          body: '',
          responses: [
            {
              id: RESPONSE_A_ID,
              letter: 'A',
              text: 'Opción buena',
              points: 10,
              targetNodeId: FINAL_ID,
              imageAssetId: IMAGE_ID,
            },
          ],
        },
        {
          id: FINAL_ID,
          number: 3,
          type: 'final',
          position: { x: 400, y: 0 },
          title: 'Fin',
          body: '',
        },
      ],
    },
  }
}

describe('parseOrMigrateProjectDocument — documento en la forma "imagen única", encadenado hasta content', () => {
  it('migra imageAssetId (con valor) a un bloque de imagen, tras el de texto (contentOrder por defecto text-first)', () => {
    const migrated = parseOrMigrateProjectDocument(singularImageDocument({ imageAssetId: IMAGE_ID }))
    const slide = migrated.graph.nodes.find((node) => node.id === CONTENT_ID)

    expect(slide?.type).toBe('slide')
    if (slide?.type !== 'slide') throw new Error('esperaba una diapositiva')
    expect(blockShapes(slide.content)).toEqual([
      { type: 'text', body: '<p>Hola</p>' },
      { type: 'image', assetId: IMAGE_ID },
      { type: 'audio', assetId: AUDIO_ID },
    ])
    // El resto de campos se conserva intacto.
    expect(slide.targetNodeId).toBe(DECISION_ID)
    expect(slide.continueLabel).toBe('Siguiente')
    expect(slide.title).toBe('Bienvenida')
  })

  it('sin imageAssetId (undefined), migra a content sin ningún bloque de imagen', () => {
    const migrated = parseOrMigrateProjectDocument(singularImageDocument())
    const slide = migrated.graph.nodes.find((node) => node.id === CONTENT_ID)

    expect(slide?.type).toBe('slide')
    if (slide?.type !== 'slide') throw new Error('esperaba una diapositiva')
    expect(blockShapes(slide.content)).toEqual([
      { type: 'text', body: '<p>Hola</p>' },
      { type: 'audio', assetId: AUDIO_ID },
    ])
  })

  it('el resto de nodos (respuestas, final) y el startNodeId se conservan intactos', () => {
    const migrated = parseOrMigrateProjectDocument(singularImageDocument({ imageAssetId: IMAGE_ID }))

    expect(migrated.graph.startNodeId).toBe(CONTENT_ID)
    const decision = migrated.graph.nodes.find((node) => node.id === DECISION_ID)
    expect(decision?.type).toBe('slide')
    if (decision?.type !== 'slide') throw new Error('esperaba una diapositiva')
    // Las respuestas (con su propio imageAssetId singular, sin cambios: el
    // modelo de respuesta no forma parte de esta migración) se conservan tal
    // cual.
    expect(decision.responses).toEqual([
      {
        id: RESPONSE_A_ID,
        letter: 'A',
        text: 'Opción buena',
        points: 10,
        targetNodeId: FINAL_ID,
        imageAssetId: IMAGE_ID,
      },
    ])
    const final = migrated.graph.nodes.find((node) => node.id === FINAL_ID)
    expect(final?.type).toBe('final')
    expect(final?.title).toBe('Fin')
  })

  it('el resultado migrado vuelve a validar contra el schema nuevo (bloques de contenido)', () => {
    // No debe lanzar: `parseOrMigrateProjectDocument` ya revalida
    // internamente contra `ProjectDocumentSchema` antes de devolver, tras
    // las dos migraciones encadenadas.
    expect(() => parseOrMigrateProjectDocument(singularImageDocument({ imageAssetId: IMAGE_ID }))).not.toThrow()
  })
})

describe('parseOrMigrateProjectDocument — documento irreconocible', () => {
  it('lanza ProjectMigrationError con un mensaje claro', () => {
    expect(() => parseOrMigrateProjectDocument({ not: 'a project' })).toThrow(
      ProjectMigrationError,
    )
    expect(() => parseOrMigrateProjectDocument({ not: 'a project' })).toThrow(
      /no tiene una forma reconocible/i,
    )
  })

  it('lanza también con un documento a medio camino entre las formas', () => {
    // Tipos nuevos (`slide`) pero sin `graph.startNodeId` ni `content`/
    // `imageAssetIds`/`contentOrder`: no es válido como forma actual ni
    // reconocible como ninguna de las formas antiguas.
    const halfway = {
      ...legacyBase(),
      graph: {
        nodes: [
          {
            id: CONTENT_ID,
            number: 1,
            type: 'slide',
            position: { x: 0, y: 0 },
            title: '',
            body: '',
            responses: [],
          },
        ],
      },
    }

    expect(() => parseOrMigrateProjectDocument(halfway)).toThrow(ProjectMigrationError)
  })

  it('lanza con valores primitivos o nulos', () => {
    expect(() => parseOrMigrateProjectDocument(null)).toThrow(ProjectMigrationError)
    expect(() => parseOrMigrateProjectDocument('texto')).toThrow(ProjectMigrationError)
  })
})

describe('compatibilidad: documento sin `variables` (formato de hoy)', () => {
  it('parsea con variables: [] sin código de migración adicional', () => {
    // La forma ACTUAL (nodos `slide`/`final`, con `graph.startNodeId` y
    // `content`) ya no lleva `variables` porque el campo no existía antes de
    // esta fase. Es aditivo por diseño: `ProjectDocumentSchema.variables`
    // tiene `.default([])`, así que no hace falta ningún esquema/
    // transformación dedicados en `migration.ts` para reconocer esta forma —
    // a diferencia de las migraciones legacy/imagen-única/pre-bloques de
    // arriba, que sí necesitan su propio esquema de reconocimiento.
    const current = createProject('Sin variables')
    const raw = JSON.parse(JSON.stringify(current)) as Record<string, unknown>
    delete raw.variables // simula un `.brunch` guardado antes de esta fase

    const migrated = parseOrMigrateProjectDocument(raw)
    expect(migrated.variables).toEqual([])
  })
})
