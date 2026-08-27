import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildHtmlBundle } from '../htmlBundle'
import { BUNDLE_ELEMENT_ID } from '../exportedPlayerScript'
import type { ExportAssetMap } from '../exportAssets'
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
const VIDEO_ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'

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

/** Bloques de `SlideNode.content` de prueba, con un id único por llamada
 *  (milestone "Bloques de contenido"). */
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

function sampleProject(): ProjectDocument {
  const slide: SlideNode = {
    id: SLIDE_ID,
    number: 1,
    type: 'slide',
    position: { x: 0, y: 0 },
    title: 'Primer contacto',
    targetNodeId: DECISION_ID,
    continueLabel: 'Empezar el caso',
    responses: [],
    content: [
      textBlock(richBody('Bienvenido al escenario. Presta atención al ', 'protocolo')),
      imageBlock(IMAGE_ASSET_ID),
      audioBlock(AUDIO_ASSET_ID),
    ],
    internalNote: 'Recordatorio interno: pedir revisión al equipo de diseño',
  }

  const decision: SlideNode = {
    id: DECISION_ID,
    number: 2,
    type: 'slide',
    position: { x: 300, y: 0 },
    title: '¿Qué haces?',
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
    content: [textBlock(richBody('El paciente no responde.'))],
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
  [VIDEO_ASSET_ID]: { mimeType: 'video/mp4', dataBase64: 'TVA0RkFLRQ==' },
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

/** Documento mínimo con una única diapositiva "de continuar" con el
 *  `content` (bloques de texto/imagen/audio, milestone "Bloques de
 *  contenido") indicado y sin destino más que el Final trivial de abajo,
 *  para observar solo esos bloques en el DOM exportado sin el ruido del
 *  resto de `sampleProject()`. */
function blocksProject(content: ContentBlock[]): ProjectDocument {
  const slide: SlideNode = {
    id: MULTI_IMAGE_SLIDE_ID,
    number: 1,
    type: 'slide',
    position: { x: 0, y: 0 },
    title: 'Varios bloques',
    // Destino de "continuar" a un Final trivial: solo hace falta que la
    // vista resuelva a `continue` (con target) en vez de `dead-end`, para
    // poder observar los bloques.
    targetNodeId: MULTI_IMAGE_FINAL_ID,
    continueLabel: undefined,
    responses: [],
    content,
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
            targetNodeId: undefined,
            continueLabel: undefined,
            responses: [],
            content: [textBlock(body)],
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

  it('conserva una tabla (fase 9) con su estructura <table>/<tr>/<th>/<td> en el HTML exportado', () => {
    // Mismo criterio de documento mínimo independiente que el test de
    // `highlight` de arriba: solo lo necesario para un nodo `slide` con un
    // `body` que trae una tabla de 1 fila de cabecera + 1 fila de datos.
    const slideId = '66666666-6666-4666-8666-666666666666'
    const cell = (type: 'tableHeader' | 'tableCell', text: string) => ({
      type,
      attrs: { colspan: 1, rowspan: 1, colwidth: null },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })
    const body = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('tableHeader', 'Encabezado')] },
            { type: 'tableRow', content: [cell('tableCell', 'Celda')] },
          ],
        },
      ],
    })

    const project: ProjectDocument = {
      schemaVersion: 1,
      metadata: {
        id: '99999999-9999-4999-8999-999999999997',
        name: 'Proyecto con tabla',
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
            title: 'Con tabla',
            targetNodeId: undefined,
            continueLabel: undefined,
            responses: [],
            content: [textBlock(body)],
          },
        ],
        startNodeId: slideId,
      },
      editor: { viewport: { x: 0, y: 0, zoom: 1 } },
    }

    const html = buildHtmlBundle(project, {})

    // `<` va escapado como \u003c dentro del JSON embebido (ver
    // `serializeBundle`); `generateHTML` con `RICH_TEXT_EXTENSIONS` (que
    // incluye las cuatro extensiones de tabla) produce la estructura real
    // (`<table>` con su `colgroup`/`tbody` propios de la extensión de
    // tabla, `<tr>`, `<th>`, `<td>`), no texto plano. No se comprueban los
    // atributos exactos de cada etiqueta (p.ej. el `style="min-width"` que
    // añade la extensión): son detalle interno de `@tiptap/extension-table`
    // y no la conservación de la tabla, que es lo que este test verifica.
    expect(html).toContain('\\u003ctable')
    expect(html).toContain('\\u003ctr>')
    expect(html).toContain('\\u003cth')
    expect(html).toContain('Encabezado')
    expect(html).toContain('\\u003ctd')
    expect(html).toContain('Celda')
    expect(html).toContain('\\u003c/table>')
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

  it('"Salir" aparece junto a "Reintentar" en el Final, llama a window.close() y muestra el aviso de cierre', () => {
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {})

    runExportedBundle(buildHtmlBundle(sampleProject(), sampleAssets))
    clickButton('Empezar el caso')
    clickButton('Avisar al responsable')

    const card = currentCard()
    expect(card.textContent).toContain('Salir')
    expect(card.querySelector('.dangerButton')?.textContent).toBe('Reintentar')
    expect(card.textContent).not.toContain('Ya puedes cerrar esta pestaña.')

    clickButton('Salir')

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(currentCard().textContent).toContain('Ya puedes cerrar esta pestaña.')

    closeSpy.mockRestore()
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

describe('buildHtmlBundle — bloques de contenido de una diapositiva (milestone "Bloques de contenido")', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('pinta TODOS los bloques de imagen, en el orden de content', () => {
    const content = [imageBlock(IMAGE_ASSET_ID), imageBlock(SECOND_IMAGE_ASSET_ID)]
    runExportedBundle(buildHtmlBundle(blocksProject(content), multiImageAssets))

    const images = [...currentCard().querySelectorAll<HTMLImageElement>('img')]
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      'data:image/png;base64,UE5HRkFLRQ==',
      'data:image/png;base64,U0VDT05EQQ==',
    ])
  })

  it('pinta bloques de texto/imagen/audio intercalados, en el orden exacto de content', () => {
    const content = [
      textBlock(richBody('Primer texto')),
      imageBlock(IMAGE_ASSET_ID),
      textBlock(richBody('Segundo texto')),
      audioBlock(AUDIO_ASSET_ID),
    ]
    runExportedBundle(buildHtmlBundle(blocksProject(content), sampleAssets))

    const card = currentCard()
    const elements = [...card.querySelectorAll<HTMLElement>('.body, img, audio')]
    expect(elements.map((element) => element.tagName)).toEqual(['DIV', 'IMG', 'DIV', 'AUDIO'])
    expect(elements[0]?.textContent).toContain('Primer texto')
    expect((elements[1] as HTMLImageElement).getAttribute('src')).toBe(
      'data:image/png;base64,UE5HRkFLRQ==',
    )
    expect(elements[2]?.textContent).toContain('Segundo texto')
    expect((elements[3] as HTMLAudioElement).getAttribute('src')).toBe(
      'data:audio/mpeg;base64,TVAzRkFLRQ==',
    )
  })

  it('pinta un bloque de vídeo con controles nativos y el mismo ancho/alto máximo que la imagen (clase "media")', () => {
    const content = [imageBlock(IMAGE_ASSET_ID), videoBlock(VIDEO_ASSET_ID)]
    runExportedBundle(buildHtmlBundle(blocksProject(content), sampleAssets))

    const card = currentCard()
    const video = card.querySelector<HTMLVideoElement>('video')
    expect(video).not.toBeNull()
    expect(video?.getAttribute('src')).toBe('data:video/mp4;base64,TVA0RkFLRQ==')
    expect(video?.controls).toBe(true)
    expect(video?.classList.contains('media')).toBe(true)
  })

  it('pinta bloques de texto/imagen/audio/vídeo intercalados, en el orden exacto de content', () => {
    const content = [
      textBlock(richBody('Primer texto')),
      videoBlock(VIDEO_ASSET_ID),
      imageBlock(IMAGE_ASSET_ID),
      audioBlock(AUDIO_ASSET_ID),
    ]
    runExportedBundle(buildHtmlBundle(blocksProject(content), sampleAssets))

    const card = currentCard()
    const elements = [...card.querySelectorAll<HTMLElement>('.body, video, img, audio')]
    expect(elements.map((element) => element.tagName)).toEqual(['DIV', 'VIDEO', 'IMG', 'AUDIO'])
  })

  it('un vídeo no resuelto se omite sin romper el orden de los demás bloques', () => {
    const content = [videoBlock(VIDEO_ASSET_ID), imageBlock(IMAGE_ASSET_ID)]
    runExportedBundle(
      buildHtmlBundle(blocksProject(content), {
        [IMAGE_ASSET_ID]: sampleAssets[IMAGE_ASSET_ID]!,
      }),
    )

    const card = currentCard()
    expect(card.querySelector('video')).toBeNull()
    expect(card.querySelector('img')).not.toBeNull()
  })

  it('una imagen no resuelta se omite sin romper el orden de las demás', () => {
    // Solo la segunda imagen está en el mapa de assets: la primera se omite.
    const content = [imageBlock(IMAGE_ASSET_ID), imageBlock(SECOND_IMAGE_ASSET_ID)]
    runExportedBundle(
      buildHtmlBundle(blocksProject(content), {
        [SECOND_IMAGE_ASSET_ID]: multiImageAssets[SECOND_IMAGE_ASSET_ID]!,
      }),
    )

    const images = [...currentCard().querySelectorAll<HTMLImageElement>('img')]
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      'data:image/png;base64,U0VDT05EQQ==',
    ])
  })

  it('un bloque de texto vacío en medio de content no pinta nada, sin romper el resto', () => {
    const content = [textBlock(richBody('Antes')), textBlock(''), imageBlock(IMAGE_ASSET_ID)]
    runExportedBundle(buildHtmlBundle(blocksProject(content), sampleAssets))

    const card = currentCard()
    expect(card.querySelectorAll('.body')).toHaveLength(1)
    expect(card.querySelector('.body')?.textContent).toContain('Antes')
    expect(card.querySelector('img')).not.toBeNull()
  })

  it('una diapositiva sin ningún bloque pinta el texto de repuesto', () => {
    runExportedBundle(buildHtmlBundle(blocksProject([]), {}))

    expect(currentCard().querySelector('.body')?.textContent).toBe(
      'Esta diapositiva todavía no tiene contenido.',
    )
  })
})

// ---------------------------------------------------------------------------
// Variables/condiciones (FASE 3 del milestone "Variables/condiciones")
// ---------------------------------------------------------------------------

const FLAG_VAR_ID = '88888888-8888-4888-8888-888888888801'
const COUNTER_VAR_ID = '88888888-8888-4888-8888-888888888802'

const VAR_START_ID = '99999999-1111-4111-8111-111111111111'
const VAR_ROUTER_ID = '99999999-2222-4222-8222-222222222222'
const VAR_FINAL_TRUE_ID = '99999999-3333-4333-8333-333333333333'
const VAR_FINAL_FALSE_ID = '99999999-4444-4444-8444-444444444444'
const VAR_RESPONSE_ACTIVATE_ID = '99999999-5555-4555-8555-555555555551'
const VAR_RESPONSE_SKIP_ID = '99999999-5555-4555-8555-555555555552'
const VAR_RESPONSE_HIDDEN_ID = '99999999-5555-4555-8555-555555555553'

/**
 * Documento con variables/condiciones/efectos completo (mismo escenario que
 * `runtime.test.ts`, pero como export): una diapositiva de decisión con TRES
 * respuestas —
 *   A "Activar" (sin condición, con efectos: fija `flag=true` e incrementa
 *     `contador` en 5),
 *   B "Omitir" (sin condición, sin efectos),
 *   C "Solo si ya está activo" (con `condition: flag == true`, oculta al
 *     empezar porque `flag` arranca en `false`) —
 * seguida de una diapositiva "de continuar" SIN respuestas que enruta con
 * `condition`/`elseTargetNodeId` según el valor de `flag` tras la elección.
 */
function variablesProject(): ProjectDocument {
  const flag: VariableDef = { id: FLAG_VAR_ID, name: 'flag', type: 'boolean', initialValue: false }
  const counter: VariableDef = {
    id: COUNTER_VAR_ID,
    name: 'contador',
    type: 'number',
    initialValue: 0,
  }

  const start: SlideNode = {
    id: VAR_START_ID,
    number: 1,
    type: 'slide',
    position: { x: 0, y: 0 },
    title: 'Decisión con condiciones',
    targetNodeId: undefined,
    continueLabel: undefined,
    responses: [
      makeResponse({
        id: VAR_RESPONSE_ACTIVATE_ID,
        letter: 'A',
        text: 'Activar',
        targetNodeId: VAR_ROUTER_ID,
        effects: [
          { variableId: FLAG_VAR_ID, operation: 'set', value: true },
          { variableId: COUNTER_VAR_ID, operation: 'increment', value: 5 },
        ],
      }),
      makeResponse({
        id: VAR_RESPONSE_SKIP_ID,
        letter: 'B',
        text: 'Omitir',
        targetNodeId: VAR_ROUTER_ID,
      }),
      makeResponse({
        id: VAR_RESPONSE_HIDDEN_ID,
        letter: 'C',
        text: 'Solo si ya está activo',
        targetNodeId: VAR_ROUTER_ID,
        condition: { variableId: FLAG_VAR_ID, operator: '==', value: true },
      }),
    ],
    content: [textBlock(richBody('¿Qué haces?'))],
  }

  const router: SlideNode = {
    id: VAR_ROUTER_ID,
    number: 2,
    type: 'slide',
    position: { x: 300, y: 0 },
    title: 'Enrutador condicional',
    targetNodeId: VAR_FINAL_TRUE_ID,
    elseTargetNodeId: VAR_FINAL_FALSE_ID,
    condition: { variableId: FLAG_VAR_ID, operator: '==', value: true },
    continueLabel: 'Ver resultado',
    responses: [],
    content: [textBlock(richBody('Calculando destino…'))],
  }

  const finalTrue: FinalNode = {
    id: VAR_FINAL_TRUE_ID,
    number: 3,
    type: 'final',
    position: { x: 600, y: -50 },
    title: 'Final activado',
    body: richBody('Terminaste con el flag activado.'),
  }

  const finalFalse: FinalNode = {
    id: VAR_FINAL_FALSE_ID,
    number: 4,
    type: 'final',
    position: { x: 600, y: 50 },
    title: 'Final no activado',
    body: richBody('Terminaste sin activar el flag.'),
  }

  return {
    schemaVersion: 1,
    metadata: {
      id: '99999999-9999-4999-8999-999999999996',
      name: 'Proyecto con variables',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    settings: {},
    variables: [flag, counter],
    graph: { nodes: [start, router, finalTrue, finalFalse], startNodeId: VAR_START_ID },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  }
}

describe('buildHtmlBundle — project.variables viaja íntegro en el bundle exportado', () => {
  it('el JSON embebido contiene project.variables tal cual, sin que la limpieza de campos de editor lo toque', () => {
    const html = buildHtmlBundle(variablesProject(), {})

    const marker = `<script type="application/json" id="${BUNDLE_ELEMENT_ID}">`
    const start = html.indexOf(marker) + marker.length
    const end = html.indexOf('</script>', start)
    const embedded = JSON.parse(html.slice(start, end)) as { project: ProjectDocument }

    expect(embedded.project.variables).toEqual(variablesProject().variables)
  })
})

describe('buildHtmlBundle — comportamiento del HTML generado: variables/condiciones (jsdom)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('una respuesta con condición no cumplida no se pinta como opción (flag arranca en false)', () => {
    runExportedBundle(buildHtmlBundle(variablesProject(), {}))

    const optionTexts = [
      ...document.querySelectorAll<HTMLButtonElement>('#brunch-root .optionButton'),
    ].map((button) => button.textContent)
    expect(optionTexts).toEqual(['Activar', 'Omitir'])
    expect(optionTexts).not.toContain('Solo si ya está activo')
  })

  it('elegir "Activar" aplica sus efectos y el enrutador condicional lleva al Final "activado"', () => {
    runExportedBundle(buildHtmlBundle(variablesProject(), {}))
    clickButton('Activar')

    // Diapositiva "de continuar" (VAR_ROUTER_ID): su condición ahora es
    // verdadera (flag=true tras el efecto de "Activar").
    clickButton('Ver resultado')

    expect(currentCard().querySelector('.body')?.textContent).toContain(
      'Terminaste con el flag activado.',
    )
  })

  it('elegir "Omitir" (sin efectos) deja flag=false y el enrutador lleva al Final "no activado"', () => {
    runExportedBundle(buildHtmlBundle(variablesProject(), {}))
    clickButton('Omitir')
    clickButton('Ver resultado')

    expect(currentCard().querySelector('.body')?.textContent).toContain(
      'Terminaste sin activar el flag.',
    )
  })

  it('"Reintentar" reinicia las variables: tras reiniciar, la respuesta condicionada vuelve a estar oculta', () => {
    runExportedBundle(buildHtmlBundle(variablesProject(), {}))
    clickButton('Activar')
    clickButton('Ver resultado')
    clickButton('Reintentar')

    const optionTexts = [
      ...document.querySelectorAll<HTMLButtonElement>('#brunch-root .optionButton'),
    ].map((button) => button.textContent)
    expect(optionTexts).toEqual(['Activar', 'Omitir'])
  })
})

// ---------------------------------------------------------------------------
// Reproducción exacta del reporte de bug (Tarea 1, ver también
// `runtime.test.ts`): variable NUMÉRICA con efecto `increment +1` en una
// respuesta de decisión, seguida de una diapositiva "de continuar" con
// `condition` (`>=` 1) y AMBOS `targetNodeId`/`elseTargetNodeId`
// configurados explícitamente. Ejecutado contra el bundle HTML exportado de
// verdad (jsdom), no contra `runtime.ts` directamente, para comprobar que
// `exportedPlayerScript.ts` traduce el mecanismo con el mismo resultado.
// ---------------------------------------------------------------------------

const BUG_DECISION_ID = 'bbbbbbbb-0000-4000-8000-000000000001'
const BUG_ROUTER_ID = 'bbbbbbbb-0000-4000-8000-000000000002'
const BUG_FINAL_TRUE_ID = 'bbbbbbbb-0000-4000-8000-000000000003'
const BUG_FINAL_FALSE_ID = 'bbbbbbbb-0000-4000-8000-000000000004'
const BUG_RESPONSE_GET_POINT_ID = 'bbbbbbbb-0000-4000-8000-000000000005'
const BUG_RESPONSE_SKIP_ID = 'bbbbbbbb-0000-4000-8000-000000000006'
const BUG_COUNTER_VAR_ID = 'bbbbbbbb-0000-4000-8000-000000000007'

function bugReportProject(): ProjectDocument {
  const counter: VariableDef = {
    id: BUG_COUNTER_VAR_ID,
    name: 'puntos',
    type: 'number',
    initialValue: 0,
  }

  const decision: SlideNode = {
    id: BUG_DECISION_ID,
    number: 1,
    type: 'slide',
    position: { x: 0, y: 0 },
    title: 'Pregunta anterior',
    targetNodeId: undefined,
    continueLabel: undefined,
    responses: [
      makeResponse({
        id: BUG_RESPONSE_GET_POINT_ID,
        letter: 'A',
        text: 'Consigue el +1',
        targetNodeId: BUG_ROUTER_ID,
        effects: [{ variableId: BUG_COUNTER_VAR_ID, operation: 'increment', value: 1 }],
      }),
      makeResponse({
        id: BUG_RESPONSE_SKIP_ID,
        letter: 'B',
        text: 'No lo consigue',
        targetNodeId: BUG_ROUTER_ID,
      }),
    ],
    content: [textBlock(richBody('¿Consigues el punto?'))],
  }

  const router: SlideNode = {
    id: BUG_ROUTER_ID,
    number: 2,
    type: 'slide',
    position: { x: 300, y: 0 },
    title: 'Enrutado condicional',
    targetNodeId: BUG_FINAL_TRUE_ID,
    elseTargetNodeId: BUG_FINAL_FALSE_ID,
    condition: { variableId: BUG_COUNTER_VAR_ID, operator: '>=', value: 1 },
    continueLabel: 'Ver resultado',
    responses: [],
    content: [textBlock(richBody('Calculando destino…'))],
  }

  const finalTrue: FinalNode = {
    id: BUG_FINAL_TRUE_ID,
    number: 3,
    type: 'final',
    position: { x: 600, y: -50 },
    title: 'Final con el punto',
    body: richBody('Llegaste con el punto.'),
  }

  const finalFalse: FinalNode = {
    id: BUG_FINAL_FALSE_ID,
    number: 4,
    type: 'final',
    position: { x: 600, y: 50 },
    title: 'Final sin el punto',
    body: richBody('Llegaste sin el punto.'),
  }

  return {
    schemaVersion: 1,
    metadata: {
      id: '99999999-9999-4999-8999-999999999994',
      name: 'Reporte de bug: enrutado condicional',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    settings: {},
    variables: [counter],
    graph: { nodes: [decision, router, finalTrue, finalFalse], startNodeId: BUG_DECISION_ID },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  }
}

describe('buildHtmlBundle — reproducción del reporte de bug: ambas ramas del enrutado condicional navegan', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('rama VERDADERA (elige la respuesta con el +1): navega al Final correspondiente, sin dead-end', () => {
    runExportedBundle(buildHtmlBundle(bugReportProject(), {}))
    clickButton('Consigue el +1')
    clickButton('Ver resultado')

    const card = currentCard()
    expect(card.textContent).not.toContain(
      'Esta parte de la experiencia no tiene una continuación configurada.',
    )
    expect(card.querySelector('.body')?.textContent).toContain('Llegaste con el punto.')
  })

  it('rama FALSA (elige la respuesta SIN el +1): navega a elseTargetNodeId, NO aparece el aviso de dead-end', () => {
    runExportedBundle(buildHtmlBundle(bugReportProject(), {}))
    clickButton('No lo consigue')
    clickButton('Ver resultado')

    const card = currentCard()
    // Aserción central del reporte de bug: con elseTargetNodeId configurado,
    // la rama falsa NUNCA debe mostrar el aviso de "sin continuación".
    expect(card.textContent).not.toContain(
      'Esta parte de la experiencia no tiene una continuación configurada.',
    )
    expect(card.querySelector('.body')?.textContent).toContain('Llegaste sin el punto.')
  })
})

// ---------------------------------------------------------------------------
// Diapositiva de Inicio (nodo `intro`, milestone "Diapositiva de Inicio",
// fase 3)
// ---------------------------------------------------------------------------

const INTRO_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const INTRO_SLIDE_ID = 'aaaaaaaa-0000-4000-8000-000000000002'
const INTRO_FINAL_ID = 'aaaaaaaa-0000-4000-8000-000000000003'

/**
 * Proyecto mínimo con una portada (`intro`) completa como `startNodeId`,
 * conectada a una diapositiva "de continuar" trivial (sin contenido, sin
 * `continueLabel` propio) que lleva a un Final. `cicloId`/`asignaturaId` son
 * del catálogo real (`CICLOS`, primer ciclo/primera asignatura), coherentes
 * entre sí, para poder comprobar la resolución a nombres legibles.
 * `overrides` se aplica sobre el nodo `intro` para los tests de portada
 * incompleta/sin destino.
 */
function introProject(overrides: Partial<IntroNode> = {}): ProjectDocument {
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
    caseName: 'Caso de exportación',
    targetNodeId: INTRO_SLIDE_ID,
    ...overrides,
  }

  const slide: SlideNode = {
    id: INTRO_SLIDE_ID,
    number: 2,
    type: 'slide',
    position: { x: 200, y: 0 },
    title: 'Primera diapositiva',
    targetNodeId: INTRO_FINAL_ID,
    continueLabel: undefined,
    responses: [],
    content: [],
  }

  const final: FinalNode = {
    id: INTRO_FINAL_ID,
    number: 3,
    type: 'final',
    position: { x: 400, y: 0 },
    title: 'Fin',
    body: '',
  }

  return {
    schemaVersion: 1,
    metadata: {
      id: '99999999-9999-4999-8999-999999999995',
      name: 'Proyecto con portada',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    settings: {},
    variables: [],
    graph: { nodes: [intro, slide, final], startNodeId: INTRO_ID },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  }
}

/** Extrae `{ introCicloName, introAsignaturaName }` del JSON embebido en el
 *  HTML generado, sin pasar por jsdom. */
function embeddedIntroNames(html: string): {
  introCicloName: string | null
  introAsignaturaName: string | null
} {
  const marker = `<script type="application/json" id="${BUNDLE_ELEMENT_ID}">`
  const start = html.indexOf(marker) + marker.length
  const end = html.indexOf('</script>', start)
  return JSON.parse(html.slice(start, end)) as {
    introCicloName: string | null
    introAsignaturaName: string | null
  }
}

describe('buildHtmlBundle — diapositiva de Inicio: cicloId/asignaturaId resueltos en tiempo de exportación', () => {
  it('resuelve cicloId/asignaturaId a sus nombres legibles y los embebe ya resueltos en el bundle', () => {
    const ciclo = CICLOS[0]!
    const asignatura = ciclo.asignaturas[0]!

    const names = embeddedIntroNames(buildHtmlBundle(introProject(), {}))

    expect(names.introCicloName).toBe(ciclo.name)
    expect(names.introAsignaturaName).toBe(asignatura.name)
  })

  it('sin nodo intro en el proyecto, introCicloName/introAsignaturaName son null', () => {
    const names = embeddedIntroNames(buildHtmlBundle(sampleProject(), sampleAssets))

    expect(names.introCicloName).toBeNull()
    expect(names.introAsignaturaName).toBeNull()
  })

  it('con cicloId/asignaturaId sin elegir, resuelve a null sin lanzar', () => {
    const names = embeddedIntroNames(
      buildHtmlBundle(introProject({ cicloId: undefined, asignaturaId: undefined }), {}),
    )

    expect(names.introCicloName).toBeNull()
    expect(names.introAsignaturaName).toBeNull()
  })

  it('el catálogo completo (CICLOS) no viaja embebido en el HTML exportado', () => {
    // Solo dos nombres resueltos, nunca el catálogo entero: comprobado con
    // el nombre de un ciclo/asignatura que NO es el elegido en el proyecto
    // de prueba (ver `introProject`, que usa siempre CICLOS[0]).
    const otroCiclo = CICLOS[1]
    if (!otroCiclo) throw new Error('El catálogo necesita al menos dos ciclos para este test')

    const html = buildHtmlBundle(introProject(), {})

    expect(html).not.toContain(otroCiclo.name)
  })
})

describe('buildHtmlBundle — diapositiva de Inicio: comportamiento del HTML generado (jsdom)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('arranca pintando la portada: contexto (ciclo · asignatura), caseName como título y "Continuar"', () => {
    const ciclo = CICLOS[0]!
    const asignatura = ciclo.asignaturas[0]!

    runExportedBundle(buildHtmlBundle(introProject(), {}))

    const card = currentCard()
    expect(card.querySelector('.introContext')?.textContent).toBe(
      `${ciclo.name} · ${asignatura.name}`,
    )
    expect(card.querySelector('.title')?.textContent).toBe('Caso de exportación')
    expect(card.querySelector('.primaryButton')?.textContent).toBe('Continuar')
  })

  it('pulsar "Continuar" en la portada avanza a la primera diapositiva narrativa real', () => {
    runExportedBundle(buildHtmlBundle(introProject(), {}))
    clickButton('Continuar')

    // Ya no es la portada (sin contexto de ciclo/asignatura): es la
    // diapositiva "de continuar" enlazada, sin contenido propio, que pinta
    // su texto de repuesto.
    const card = currentCard()
    expect(card.querySelector('.introContext')).toBeNull()
    expect(card.textContent).toContain('Esta diapositiva todavía no tiene contenido.')
  })

  it('con la portada incompleta (sin ciclo/asignatura/caseName) no rompe el HTML exportado: omite lo que falta', () => {
    runExportedBundle(
      buildHtmlBundle(
        introProject({ cicloId: undefined, asignaturaId: undefined, caseName: '' }),
        {},
      ),
    )

    const card = currentCard()
    expect(card.querySelector('.introContext')).toBeNull()
    expect(card.querySelector('.title')).toBeNull()
    // El botón de continuar sigue ahí, aunque no haya nada más que pintar.
    expect(card.querySelector('.primaryButton')?.textContent).toBe('Continuar')
  })

  it('sin targetNodeId, la portada exportada cae en el mismo aviso de "sin continuación" que el resto del runtime', () => {
    runExportedBundle(buildHtmlBundle(introProject({ targetNodeId: undefined }), {}))

    expect(currentCard().textContent).toContain(
      'Esta parte de la experiencia no tiene una continuación configurada.',
    )
    // Y no queda ningún resto de portada (ni contexto ni caseName).
    expect(currentCard().querySelector('.introContext')).toBeNull()
    expect(currentCard().textContent).not.toContain('Caso de exportación')
  })

  it('el título del nodo intro (siempre vacío, referencia interna) no aparece en ningún punto', () => {
    const html = buildHtmlBundle(introProject({ title: 'Nota interna de la portada' }), {})

    // `stripEditorOnlyFields` vacía el título de TODOS los nodos, incluido
    // el `intro` — mismo criterio que el resto del documento.
    expect(html).not.toContain('Nota interna de la portada')
  })
})
