import { beforeEach, describe, expect, it } from 'vitest'
import { buildHtmlBundle } from '../htmlBundle'
import type { ExportAssetMap } from '../exportAssets'
import type { DecisionResponse, FinalNode, ProjectDocument, SlideNode } from '../../domain'

/**
 * Tests del generador del `index.html` autónomo (Milestone 3, fase 1).
 *
 * Dos niveles de comprobación:
 *
 * 1. Sobre el string generado: que contenga lo que debe (títulos, cuerpo ya
 *    renderizado desde Tiptap, `data:` URI de los assets, acento iLERNA,
 *    "Reintentar") y que NO contenga lo que no debe (letras A/B/C/D como
 *    etiqueta de opción, React/Tiptap/ProseMirror, peticiones de red).
 *
 * 2. Ejecutando de verdad el `<script>` del propio HTML generado en jsdom
 *    (`runExportedBundle`), para verificar el comportamiento de navegación
 *    completo (continuar, elegir con acumulación de puntuación, reiniciar)
 *    contra la misma lógica de `src/player/runtime.ts` que traduce.
 */

const IMAGE_ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const AUDIO_ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'

const SLIDE_ID = '11111111-1111-4111-8111-111111111111'
const DECISION_ID = '22222222-2222-4222-8222-222222222222'
const FINAL_ID = '33333333-3333-4333-8333-333333333333'
const RESPONSE_GOOD_ID = '44444444-4444-4444-8444-444444444441'
const RESPONSE_BAD_ID = '44444444-4444-4444-8444-444444444442'

/** Documento Tiptap serializado, tal cual lo guarda `RichTextEditor`. */
function richBody(text: string, boldTail?: string): string {
  const content: unknown[] = [{ type: 'text', text }]
  if (boldTail) {
    content.push({ type: 'text', marks: [{ type: 'bold' }], text: boldTail })
  }
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content }] })
}

function makeResponse(overrides: Partial<DecisionResponse> & { id: string }): DecisionResponse {
  return {
    letter: 'A',
    text: '',
    ...overrides,
  } as DecisionResponse
}

function sampleProject(): ProjectDocument {
  const slide: SlideNode = {
    id: SLIDE_ID,
    number: 1,
    type: 'slide',
    position: { x: 0, y: 0 },
    title: 'Primer contacto',
    body: richBody('Bienvenido al escenario. Presta atención al ', 'protocolo'),
    targetNodeId: DECISION_ID,
    continueLabel: 'Empezar el caso',
    responses: [],
    imageAssetIds: [IMAGE_ASSET_ID],
    audioAssetId: AUDIO_ASSET_ID,
    contentOrder: 'text-first',
    internalNote: 'Recordatorio interno: pedir revisión al equipo de diseño',
  }

  const decision: SlideNode = {
    id: DECISION_ID,
    number: 2,
    type: 'slide',
    position: { x: 300, y: 0 },
    title: '¿Qué haces?',
    body: richBody('El paciente no responde.'),
    targetNodeId: undefined,
    continueLabel: undefined,
    responses: [
      makeResponse({
        id: RESPONSE_GOOD_ID,
        letter: 'A',
        text: 'Avisar al responsable',
        points: 10,
        targetNodeId: FINAL_ID,
        imageAssetId: IMAGE_ASSET_ID,
      }),
      makeResponse({
        id: RESPONSE_BAD_ID,
        letter: 'B',
        text: 'No hacer nada',
        points: -5,
        targetNodeId: FINAL_ID,
      }),
    ],
    imageAssetIds: [],
    audioAssetId: undefined,
    contentOrder: 'text-first',
  }

  const final: FinalNode = {
    id: FINAL_ID,
    number: 3,
    type: 'final',
    position: { x: 600, y: 0 },
    title: 'Caso cerrado',
    body: richBody('Has terminado el recorrido.'),
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
    variables: [],
    graph: { nodes: [slide, decision, final], startNodeId: SLIDE_ID },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  }
}

const sampleAssets: ExportAssetMap = {
  [IMAGE_ASSET_ID]: { mimeType: 'image/png', dataBase64: 'UE5HRkFLRQ==' },
  [AUDIO_ASSET_ID]: { mimeType: 'audio/mpeg', dataBase64: 'TVAzRkFLRQ==' },
}

// -----------------------------------------------------------------------
// Varias imágenes por diapositiva + orden de contenido (tarea 5)
// -----------------------------------------------------------------------

const SECOND_IMAGE_ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const MULTI_IMAGE_SLIDE_ID = '66666666-6666-4666-8666-666666666666'
const MULTI_IMAGE_FINAL_ID = '77777777-7777-4777-8777-777777777777'

const multiImageAssets: ExportAssetMap = {
  [IMAGE_ASSET_ID]: { mimeType: 'image/png', dataBase64: 'UE5HRkFLRQ==' },
  [SECOND_IMAGE_ASSET_ID]: { mimeType: 'image/png', dataBase64: 'U0VDT05EQQ==' },
}

/** Documento mínimo con una única diapositiva "de continuar" con dos
 *  imágenes (en `imageAssetIds`, orden IMAGE_ASSET_ID -> SECOND_IMAGE_ASSET_ID)
 *  y sin destino, para observar solo el bloque de medios en el DOM
 *  exportado sin el ruido del resto de `sampleProject()`. */
function multiImageProject(contentOrder: 'text-first' | 'image-first'): ProjectDocument {
  const slide: SlideNode = {
    id: MULTI_IMAGE_SLIDE_ID,
    number: 1,
    type: 'slide',
    position: { x: 0, y: 0 },
    title: 'Varias imágenes',
    body: richBody('Cuerpo de la diapositiva.'),
    // Destino de "continuar" a un Final trivial: solo hace falta que la
    // vista resuelva a `continue` (con target) en vez de `dead-end`, para
    // poder observar el bloque de medios.
    targetNodeId: MULTI_IMAGE_FINAL_ID,
    continueLabel: undefined,
    responses: [],
    imageAssetIds: [IMAGE_ASSET_ID, SECOND_IMAGE_ASSET_ID],
    audioAssetId: undefined,
    contentOrder,
  }

  const final: FinalNode = {
    id: MULTI_IMAGE_FINAL_ID,
    number: 2,
    type: 'final',
    position: { x: 300, y: 0 },
    title: 'Fin',
    body: '',
  }

  return {
    schemaVersion: 1,
    metadata: {
      id: '99999999-9999-4999-8999-999999999997',
      name: 'Proyecto con varias imágenes',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    settings: {},
    variables: [],
    graph: { nodes: [slide, final], startNodeId: MULTI_IMAGE_SLIDE_ID },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  }
}

/**
 * Monta el HTML generado en el documento de jsdom y ejecuta su propio
 * `<script>` clásico.
 *
 * `innerHTML` inserta los `<script>` sin ejecutarlos, así que el script se
 * localiza y se ejecuta a mano con `new Function`. Esto ejercita el artefacto
 * real (el string que se escribiría a disco), no una copia del runtime.
 */
function runExportedBundle(html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  document.body.innerHTML = parsed.body.innerHTML

  const script = document.querySelector<HTMLScriptElement>('script:not([type])')
  if (!script) {
    throw new Error('El HTML exportado debe incluir un <script> clásico con el runtime.')
  }
  new Function(script.textContent ?? '')()
}

function currentCard(): HTMLElement {
  const card = document.querySelector<HTMLElement>('#brunch-root .card')
  if (!card) {
    throw new Error('No se ha pintado ninguna tarjeta en el HTML exportado.')
  }
  return card
}

function clickButton(text: string): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>('#brunch-root button')].find(
    (candidate) => candidate.textContent === text,
  )
  if (!button) {
    throw new Error(`No existe ningún botón con el texto "${text}".`)
  }
  button.click()
}

describe('buildHtmlBundle — contenido del archivo generado', () => {
  it('produce un documento HTML completo y autónomo', () => {
    const html = buildHtmlBundle(sampleProject(), sampleAssets)

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<html lang="es">')
    expect(html).toContain('</html>')
    // El nombre del proyecto va escapado en el título.
    expect(html).toContain('<title>Escenario de &lt;prueba&gt;</title>')
    // Un único JSON embebido con el documento y un único script de runtime.
    expect(html).toContain('<script type="application/json" id="brunch-bundle">')
    expect(html).toContain('<main id="brunch-root" class="stage">')
  })

  it('no arrastra frameworks ni pide nada por red', () => {
    const html = buildHtmlBundle(sampleProject(), sampleAssets)

    // Ni React, ni Tiptap, ni ProseMirror: el archivo solo lleva JS vanilla.
    // (La palabra "Tiptap" sí puede aparecer en un comentario explicativo;
    // lo que no debe aparecer es nada de sus paquetes ni de su runtime.)
    expect(html).not.toContain('ProseMirror')
    expect(html).not.toContain('prosemirror')
    expect(html).not.toContain('@tiptap')
    expect(html).not.toMatch(/\breact\b/i)
    expect(html).not.toContain('fetch(')
    expect(html).not.toContain('XMLHttpRequest')
    expect(html).not.toContain('http://')
    expect(html).not.toContain('https://')
    expect(html).not.toContain('<link')
  })

  it('embebe los assets como data: URI, sin rutas relativas', () => {
    const html = buildHtmlBundle(sampleProject(), sampleAssets)

    expect(html).toContain('data:image/png;base64,UE5HRkFLRQ==')
    expect(html).toContain('data:audio/mpeg;base64,TVAzRkFLRQ==')
  })

  it('usa el acento corporativo iLERNA y el rojo de peligro de la app', () => {
    const html = buildHtmlBundle(sampleProject(), sampleAssets)

    expect(html).toContain('#00aec7')
    expect(html).toContain('#c22b3a')
  })

  it('incluye los textos de interfaz del Player, con "Reintentar"', () => {
    const html = buildHtmlBundle(sampleProject(), sampleAssets)

    expect(html).toContain('Reintentar')
    expect(html).toContain('Puntuación final: ')
    expect(html).toContain('Continuar')
    expect(html).toContain('Fin de la experiencia')
  })

  it('no incluye en ningún punto el título de las diapositivas (es solo referencia interna)', () => {
    const html = buildHtmlBundle(sampleProject(), sampleAssets)

    // Ni en el DOM pintado ni en el JSON embebido con el documento del
    // proyecto: el título del nodo no debe sobrevivir a la exportación en
    // ninguna forma, a diferencia del nombre del proyecto (que sí viaja,
    // como <title> de la pestaña).
    expect(html).not.toContain('Primer contacto')
    expect(html).not.toContain('¿Qué haces?')
    expect(html).not.toContain('Caso cerrado')
  })

  it('convierte el body Tiptap a HTML estático con las mismas extensiones', () => {
    const html = buildHtmlBundle(sampleProject(), sampleAssets)

    // El párrafo y la negrita quedan ya renderizados (con `<` escapado como
    // \\u003c porque el HTML viaja dentro de un JSON en un <script>).
    expect(html).toContain('\\u003cp>Bienvenido al escenario.')
    expect(html).toContain('\\u003cstrong>protocolo\\u003c/strong>')
  })

  it('conserva la marca highlight (destacado, fase 8) como <mark> en el HTML exportado', () => {
    // Documento mínimo independiente de `sampleProject()`: solo lo
    // necesario para un nodo `slide` con un `body` que trae la marca
    // `highlight`, sin arrastrar los demás campos de la muestra grande.
    const slideId = '55555555-5555-4555-8555-555555555555'
    const body = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Presta atención a lo ' },
            { type: 'text', text: 'destacado', marks: [{ type: 'highlight' }] },
            { type: 'text', text: '.' },
          ],
        },
      ],
    })

    const project: ProjectDocument = {
      schemaVersion: 1,
      metadata: {
        id: '99999999-9999-4999-8999-999999999998',
        name: 'Proyecto con destacado',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      settings: {},
      variables: [],
      graph: {
        nodes: [
          {
            id: slideId,
            number: 1,
            type: 'slide',
            position: { x: 0, y: 0 },
            title: 'Con destacado',
            body,
            targetNodeId: undefined,
            continueLabel: undefined,
            responses: [],
            imageAssetIds: [],
            audioAssetId: undefined,
            contentOrder: 'text-first',
          },
        ],
        startNodeId: slideId,
      },
      editor: { viewport: { x: 0, y: 0, zoom: 1 } },
    }

    const html = buildHtmlBundle(project, {})

    // `<` va escapado como < dentro del JSON embebido (ver
    // `serializeBundle`); `generateHTML` con `RICH_TEXT_EXTENSIONS` (que
    // incluye `Highlight`) produce un `<mark>` de verdad, no texto plano.
    expect(html).toContain('\\u003cmark>destacado\\u003c/mark>')
  })

  it('no incluye en ningún punto la nota interna del nodo (internalNote, tarea 6: nunca se exporta)', () => {
    const html = buildHtmlBundle(sampleProject(), sampleAssets)

    // `sampleProject()` fija un `internalNote` con contenido real en la
    // diapositiva de inicio (ver arriba): ni su texto literal debe aparecer
    // en ningún punto del HTML generado (ni pintado, ni en el JSON
    // embebido), mismo criterio que el título del nodo.
    expect(html).not.toContain('Recordatorio interno')
    expect(html).not.toContain('pedir revisión al equipo de diseño')
    expect(html).not.toContain('internalNote')
  })

  it('omite los assets que no se pudieron leer sin romper el archivo', () => {
    // Solo se resolvió el audio: la imagen referenciada no está en el mapa.
    const html = buildHtmlBundle(sampleProject(), {
      [AUDIO_ASSET_ID]: sampleAssets[AUDIO_ASSET_ID]!,
    })

    expect(html).toContain('data:audio/mpeg;base64,TVAzRkFLRQ==')
    expect(html).not.toContain('data:image/png')
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })
})

describe('buildHtmlBundle — comportamiento del HTML generado (jsdom)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('arranca en la diapositiva de startNodeId con su cuerpo y medios, sin pintar el título', () => {
    runExportedBundle(buildHtmlBundle(sampleProject(), sampleAssets))

    const card = currentCard()
    // El título del nodo ("Primer contacto") es solo referencia interna del
    // diseñador instruccional: no se pinta en el HTML exportado.
    expect(card.querySelector('.title')).toBeNull()
    expect(card.textContent).not.toContain('Primer contacto')
    expect(card.querySelector('.body')?.innerHTML).toContain('<strong>protocolo</strong>')
    expect(card.querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,UE5HRkFLRQ==',
    )
    expect(card.querySelector('audio')?.getAttribute('src')).toBe(
      'data:audio/mpeg;base64,TVAzRkFLRQ==',
    )
    // Texto personalizado del botón de continuar.
    expect(card.querySelector('.primaryButton')?.textContent).toBe('Empezar el caso')
  })

  it('avanza con el botón de continuar y muestra las opciones sin letras A/B/C/D, ni el título del nodo', () => {
    runExportedBundle(buildHtmlBundle(sampleProject(), sampleAssets))
    clickButton('Empezar el caso')

    const card = currentCard()
    // El título de la diapositiva de decisión ("¿Qué haces?") tampoco se
    // pinta: es la misma referencia interna que en la de continuar.
    expect(card.querySelector('.title')).toBeNull()
    expect(card.textContent).not.toContain('¿Qué haces?')

    const options = [...card.querySelectorAll<HTMLButtonElement>('.optionButton')]
    expect(options.map((option) => option.textContent)).toEqual([
      'Avisar al responsable',
      'No hacer nada',
    ])
    // Cada opción lleva un punto/viñeta, nunca una letra.
    expect(card.querySelectorAll('.optionBullet')).toHaveLength(2)
    for (const option of options) {
      expect(option.textContent).not.toMatch(/^[ABCD][).\s]/)
    }
    // La imagen de la respuesta va fuera del <button> (contenido interactivo).
    expect(card.querySelector('.optionMedia img')).not.toBeNull()
    expect(card.querySelector('.optionButton img')).toBeNull()
  })

  it('acumula la puntuación de la respuesta elegida y la muestra en el Final', () => {
    runExportedBundle(buildHtmlBundle(sampleProject(), sampleAssets))
    clickButton('Empezar el caso')
    clickButton('Avisar al responsable')

    const card = currentCard()
    expect(card.querySelector('.title')?.textContent).toBe('Fin de la experiencia')
    expect(card.querySelector('.body')?.textContent).toContain('Has terminado el recorrido.')
    expect(card.querySelector('.points')?.textContent).toBe('Puntuación final: 10 puntos')
    expect(card.querySelector('.dangerButton')?.textContent).toBe('Reintentar')
  })

  it('la respuesta con puntuación negativa también se acumula tal cual', () => {
    runExportedBundle(buildHtmlBundle(sampleProject(), sampleAssets))
    clickButton('Empezar el caso')
    clickButton('No hacer nada')

    expect(currentCard().querySelector('.points')?.textContent).toBe(
      'Puntuación final: -5 puntos',
    )
  })

  it('"Reintentar" vuelve al inicio y descarta la puntuación acumulada', () => {
    runExportedBundle(buildHtmlBundle(sampleProject(), sampleAssets))
    clickButton('Empezar el caso')
    clickButton('Avisar al responsable')
    clickButton('Reintentar')

    // De vuelta a la diapositiva de inicio: se reconoce por su botón de
    // continuar personalizado, no por su título (que no se pinta).
    expect(currentCard().querySelector('.primaryButton')?.textContent).toBe('Empezar el caso')

    // Y el segundo recorrido no arrastra la puntuación del primero.
    clickButton('Empezar el caso')
    clickButton('No hacer nada')
    expect(currentCard().querySelector('.points')?.textContent).toBe(
      'Puntuación final: -5 puntos',
    )
  })

  it('un Final alcanzado sin ninguna respuesta con puntuación no muestra puntuación', () => {
    const project = sampleProject()
    const slide = project.graph.nodes[0] as SlideNode
    slide.targetNodeId = FINAL_ID

    runExportedBundle(buildHtmlBundle(project, sampleAssets))
    clickButton('Empezar el caso')

    const card = currentCard()
    expect(card.querySelector('.title')?.textContent).toBe('Fin de la experiencia')
    expect(card.querySelector('.points')).toBeNull()
  })

  it('un Final sin body no usa su título como texto de repuesto (referencia interna, no contenido)', () => {
    const project = sampleProject()
    const final = project.graph.nodes[2] as FinalNode
    final.body = ''
    // El título sigue teniendo un valor no vacío ("Caso cerrado"): si se
    // filtrara por el HTML exportado, no debe aparecer en ningún sitio, ni
    // siquiera como texto de repuesto del cuerpo.

    const html = buildHtmlBundle(project, sampleAssets)
    runExportedBundle(html)
    clickButton('Empezar el caso')
    clickButton('Avisar al responsable')

    const card = currentCard()
    expect(card.textContent).not.toContain('Caso cerrado')
    expect(card.querySelector('.body')?.textContent).toBe(
      'Has llegado al final de esta experiencia.',
    )
    expect(html).not.toContain('Caso cerrado')
  })

  it('una diapositiva sin continuación configurada avisa sin romperse', () => {
    const project = sampleProject()
    const slide = project.graph.nodes[0] as SlideNode
    slide.targetNodeId = undefined

    runExportedBundle(buildHtmlBundle(project, sampleAssets))

    expect(currentCard().textContent).toContain(
      'Esta parte de la experiencia no tiene una continuación configurada.',
    )
  })

  it('una respuesta sin destino se pinta deshabilitada y no navega', () => {
    const project = sampleProject()
    const decision = project.graph.nodes[1] as SlideNode
    decision.responses[1]!.targetNodeId = undefined

    runExportedBundle(buildHtmlBundle(project, sampleAssets))
    clickButton('Empezar el caso')

    const disabled = [...document.querySelectorAll<HTMLButtonElement>('.optionButton')].find(
      (button) => button.textContent === 'No hacer nada',
    )
    expect(disabled?.disabled).toBe(true)

    disabled?.click()
    // Sigue en la diapositiva de decisión (no navega): se reconoce por sus
    // opciones, no por su título (que no se pinta).
    expect(currentCard().querySelectorAll('.optionButton')).toHaveLength(2)
  })
})

describe('buildHtmlBundle — varias imágenes por diapositiva y orden de contenido (tarea 5)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('pinta TODAS las imágenes de imageAssetIds, apiladas, en el orden del array', () => {
    runExportedBundle(buildHtmlBundle(multiImageProject('text-first'), multiImageAssets))

    const images = [...currentCard().querySelectorAll<HTMLImageElement>('.mediaSection img')]
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      'data:image/png;base64,UE5HRkFLRQ==',
      'data:image/png;base64,U0VDT05EQQ==',
    ])
  })

  it('contentOrder "text-first" (por defecto) pinta el cuerpo antes que las imágenes', () => {
    runExportedBundle(buildHtmlBundle(multiImageProject('text-first'), multiImageAssets))

    const card = currentCard()
    const body = card.querySelector('.body')
    const mediaSection = card.querySelector('.mediaSection')
    expect(body).not.toBeNull()
    expect(mediaSection).not.toBeNull()
    // `compareDocumentPosition` con el bit DOCUMENT_POSITION_FOLLOWING (4)
    // confirma que `mediaSection` viene DESPUÉS de `body` en el DOM.
    expect(body!.compareDocumentPosition(mediaSection!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('contentOrder "image-first" pinta las imágenes antes que el cuerpo', () => {
    runExportedBundle(buildHtmlBundle(multiImageProject('image-first'), multiImageAssets))

    const card = currentCard()
    const body = card.querySelector('.body')
    const mediaSection = card.querySelector('.mediaSection')
    expect(body).not.toBeNull()
    expect(mediaSection).not.toBeNull()
    expect(mediaSection!.compareDocumentPosition(body!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('una imagen no resuelta se omite sin romper el orden de las demás', () => {
    // Solo la segunda imagen está en el mapa de assets: la primera se omite.
    runExportedBundle(
      buildHtmlBundle(multiImageProject('text-first'), {
        [SECOND_IMAGE_ASSET_ID]: multiImageAssets[SECOND_IMAGE_ASSET_ID]!,
      }),
    )

    const images = [...currentCard().querySelectorAll<HTMLImageElement>('.mediaSection img')]
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      'data:image/png;base64,U0VDT05EQQ==',
    ])
  })
})
