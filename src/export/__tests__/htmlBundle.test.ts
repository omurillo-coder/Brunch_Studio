import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildHtmlBundle } from '../htmlBundle'
import { BUNDLE_ELEMENT_ID } from '../exportedPlayerScript'
import type { ExportAssetMap } from '../exportAssets'
import { CICLOS, cicloOutputName } from '../../domain'
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
function imageBlock(
  assetId: string,
  overrides?: { expandable?: boolean; size?: 'small' | 'normal' | 'large' },
): ContentBlock {
  blockCounter += 1
  return { id: `block-image-${blockCounter}`, type: 'image', assetId, ...overrides }
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
    variant: 'general',
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
    variant: 'general',
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

/** `.introCard` (portada de marca) es una tarjeta con su propio layout,
 *  distinta de `.card` (el resto de vistas) — ver `buildIntroCard` en
 *  `exportedPlayerScript.ts`. */
function currentCard(): HTMLElement {
  const card = document.querySelector<HTMLElement>('#brunch-root .card, #brunch-root .introCard')
  if (!card) {
    throw new Error('No se ha pintado ninguna tarjeta en el HTML exportado.')
  }
  return card
}

/** Petición de usuario ("flecha sutil a la derecha"): el `<button>` de una
 *  opción ahora incluye la flecha "→" (`.optionArrow`) como parte de su
 *  `textContent` (p.ej. "Activar→"), así que la comparación ignora una
 *  flecha final — el resto de botones (sin flecha) no se ven afectados. */
function stripTrailingArrow(text: string | null): string {
  return (text ?? '').replace(/→\s*$/, '').trim()
}

function clickButton(text: string): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>('#brunch-root button')].find(
    (candidate) => stripTrailingArrow(candidate.textContent) === text,
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

  it('usa el acento corporativo iLERNA', () => {
    const html = buildHtmlBundle(sampleProject(), sampleAssets)

    expect(html).toContain('#00aec7')
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
    expect(options.map((option) => stripTrailingArrow(option.textContent))).toEqual([
      'Avisar al responsable',
      'No hacer nada',
    ])
    // Petición de usuario: cada opción lleva una flecha sutil a la derecha
    // (nunca un punto/viñeta a la izquierda, ni una letra).
    expect(card.querySelectorAll('.optionArrow')).toHaveLength(2)
    expect(card.querySelectorAll('.optionBullet')).toHaveLength(0)
    for (const option of options) {
      expect(stripTrailingArrow(option.textContent)).not.toMatch(/^[ABCD][).\s]/)
    }
    // Petición de usuario ("clic en cualquier parte del cuadro de
    // respuesta"): la imagen de la respuesta ahora va DENTRO del <button>
    // (no es contenido interactivo, a diferencia del audio, que sigue
    // fuera de él, ver .optionMedia).
    expect(card.querySelector('.optionButton img')).not.toBeNull()
    expect(card.querySelector('.optionMedia img')).toBeNull()
  })

  it('la imagen de una respuesta es descendiente del .option de ESA respuesta, no un hermano suelto después de él', () => {
    // Traducción del mismo contrato de estructura que fija
    // `PlayerScreen.test.tsx` para la app: la imagen vive DENTRO del
    // <button> de la propia respuesta (ver test de arriba), así que por
    // construcción ya es descendiente del mismo `.option` que agrupa
    // visualmente esa respuesta — este test fija ese contrato de estructura
    // explícitamente, nunca como hijo directo de `.options` (la lista
    // completa).
    runExportedBundle(buildHtmlBundle(sampleProject(), sampleAssets))
    clickButton('Empezar el caso')

    const card = currentCard()
    const img = card.querySelector('img')
    if (!img) throw new Error('No se encontró ninguna imagen de respuesta.')

    const optionContainer = img.closest('.option')
    expect(optionContainer).not.toBeNull()
    expect(optionContainer?.querySelector('.optionButton')?.textContent).toContain(
      'Avisar al responsable',
    )

    const optionsList = card.querySelector('.options')
    expect(optionsList?.contains(img)).toBe(true)
    expect([...(optionsList?.children ?? [])]).not.toContain(img)
  })

  it('acumula la puntuación de la respuesta elegida y la muestra en el Final', () => {
    runExportedBundle(buildHtmlBundle(sampleProject(), sampleAssets))
    clickButton('Empezar el caso')
    clickButton('Avisar al responsable')

    const card = currentCard()
    expect(card.querySelector('.title')?.textContent).toBe('Fin de la experiencia')
    expect(card.querySelector('.body')?.textContent).toContain('Has terminado el recorrido.')
    expect(card.querySelector('.points')?.textContent).toBe('Puntuación final: 10 puntos')
    expect(card.querySelector('.primaryButton')?.textContent).toBe('Reintentar')
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
    expect(card.querySelector('.primaryButton')?.textContent).toBe('Reintentar')
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
      (button) => stripTrailingArrow(button.textContent) === 'No hacer nada',
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

describe('buildHtmlBundle — orden de las respuestas (petición de usuario: interruptor "Ordenar"/"Random")', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sin responseOrder ("ordenar" implícito), las respuestas se pintan en el orden del ARRAY, no el de la letra', () => {
    const project = sampleProject()
    const decision = project.graph.nodes.find((node) => node.id === DECISION_ID)
    if (!decision || decision.type !== 'slide') throw new Error('setup inválido')
    // Invierte el array (B antes que A) sin tocar letras/ids — exactamente
    // lo que el botón "Bajar"/"Subir" del Inspector deja hacer.
    decision.responses = [...decision.responses].reverse()

    runExportedBundle(buildHtmlBundle(project, sampleAssets))
    clickButton('Empezar el caso')

    const optionTexts = [...currentCard().querySelectorAll('.option')].map((el) => el.textContent)
    expect(optionTexts[0]).toContain('No hacer nada')
    expect(optionTexts[1]).toContain('Avisar al responsable')
  })

  it('con responseOrder: "random", cada carga fresca del HTML vuelve a barajar (Math.random controlado)', () => {
    const project = sampleProject()
    const decision = project.graph.nodes.find((node) => node.id === DECISION_ID)
    if (!decision || decision.type !== 'slide') throw new Error('setup inválido')
    decision.responseOrder = 'random'
    const html = buildHtmlBundle(project, sampleAssets)

    // Mismo criterio que `runtime.test.ts`: con 2 respuestas, Fisher-Yates
    // hace un único sorteo — fijar el valor de `Math.random()` hace el
    // barajado 100% predecible, sin ninguna aserción probabilística/flaky.
    const randomSpy = vi.spyOn(Math, 'random')

    randomSpy.mockReturnValue(0.9)
    runExportedBundle(html)
    clickButton('Empezar el caso')
    const firstOrder = [...currentCard().querySelectorAll('.option')].map((el) => el.textContent)

    document.body.innerHTML = ''
    randomSpy.mockReturnValue(0.1)
    runExportedBundle(html)
    clickButton('Empezar el caso')
    const secondOrder = [...currentCard().querySelectorAll('.option')].map((el) => el.textContent)

    expect(firstOrder[0]).toContain('Avisar al responsable')
    expect(secondOrder[0]).toContain('No hacer nada')
  })
})

describe('buildHtmlBundle — imágenes ampliables + tamaño (petición de usuario)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('por defecto (sin `expandable` guardado), la imagen va envuelta en un botón "ampliar" que abre un lightbox a pantalla completa', () => {
    runExportedBundle(buildHtmlBundle(blocksProject([imageBlock(IMAGE_ASSET_ID)]), sampleAssets))

    const image = currentCard().querySelector<HTMLImageElement>('img')
    expect(image).not.toBeNull()
    expect(image?.closest('button')?.classList.contains('expandableImage')).toBe(true)
    expect(document.querySelector('.lightboxBackdrop')).toBeNull()

    image?.closest('button')?.click()

    const lightbox = document.querySelector<HTMLElement>('.lightboxBackdrop')
    expect(lightbox).not.toBeNull()
    expect(lightbox?.querySelector('img')?.getAttribute('src')).toBe(image?.getAttribute('src'))
  })

  it('el lightbox se cierra al pulsar el fondo, el botón "×", o la tecla Escape', () => {
    runExportedBundle(buildHtmlBundle(blocksProject([imageBlock(IMAGE_ASSET_ID)]), sampleAssets))
    const openLightbox = () => currentCard().querySelector<HTMLImageElement>('img')?.closest('button')?.click()

    openLightbox()
    expect(document.querySelector('.lightboxBackdrop')).not.toBeNull()
    document.querySelector<HTMLButtonElement>('.lightboxClose')?.click()
    expect(
      document.querySelector<HTMLElement>('.lightboxBackdrop')?.style.display,
    ).toBe('none')

    openLightbox()
    expect(
      document.querySelector<HTMLElement>('.lightboxBackdrop')?.style.display,
    ).toBe('flex')
    document.querySelector<HTMLElement>('.lightboxBackdrop')?.click()
    expect(
      document.querySelector<HTMLElement>('.lightboxBackdrop')?.style.display,
    ).toBe('none')

    openLightbox()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(
      document.querySelector<HTMLElement>('.lightboxBackdrop')?.style.display,
    ).toBe('none')
  })

  it('pulsar la propia imagen dentro del lightbox no lo cierra (solo pulsar el fondo)', () => {
    runExportedBundle(buildHtmlBundle(blocksProject([imageBlock(IMAGE_ASSET_ID)]), sampleAssets))
    currentCard().querySelector<HTMLImageElement>('img')?.closest('button')?.click()

    document.querySelector<HTMLElement>('.lightboxBackdrop')?.querySelector('img')?.click()

    expect(
      document.querySelector<HTMLElement>('.lightboxBackdrop')?.style.display,
    ).toBe('flex')
  })

  it('petición de usuario ("un botón... para hacer no ampliable la imagen"): `expandable: false` la deja como una imagen normal, sin botón ni lightbox', () => {
    runExportedBundle(
      buildHtmlBundle(
        blocksProject([imageBlock(IMAGE_ASSET_ID, { expandable: false })]),
        sampleAssets,
      ),
    )

    const image = currentCard().querySelector<HTMLImageElement>('img')
    expect(image?.closest('button')).toBeNull()
    image?.click()
    expect(document.querySelector('.lightboxBackdrop')).toBeNull()
  })

  it('petición de usuario ("un desplegable... Pequeño/Normal/Grande"): `size` fija la clase de tamaño de la imagen; sin `size` usa el tamaño normal de siempre', () => {
    const content = [
      imageBlock(IMAGE_ASSET_ID, { size: 'small' }),
      imageBlock(SECOND_IMAGE_ASSET_ID, { size: 'large' }),
      imageBlock(IMAGE_ASSET_ID),
    ]
    runExportedBundle(buildHtmlBundle(blocksProject(content), multiImageAssets))

    const images = [...currentCard().querySelectorAll<HTMLImageElement>('img')]
    expect(images.map((img) => img.classList.contains('mediaSmall'))).toEqual([true, false, false])
    expect(images.map((img) => img.classList.contains('mediaLarge'))).toEqual([false, true, false])
    expect(images.map((img) => img.classList.contains('mediaNormal'))).toEqual([false, false, true])
  })

  it('la imagen de una respuesta nunca es ampliable (no hay botón "ampliar" ni lightbox)', () => {
    runExportedBundle(buildHtmlBundle(sampleProject(), sampleAssets))
    clickButton('Empezar el caso')

    const responseImage = currentCard().querySelector<HTMLImageElement>('.optionButton img')
    expect(responseImage).not.toBeNull()
    expect(responseImage?.closest('.expandableImage')).toBeNull()

    responseImage?.click()
    expect(document.querySelector('.lightboxBackdrop')).toBeNull()
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
    variant: 'general',
    position: { x: 600, y: -50 },
    title: 'Final activado',
    body: richBody('Terminaste con el flag activado.'),
  }

  const finalFalse: FinalNode = {
    id: VAR_FINAL_FALSE_ID,
    number: 4,
    type: 'final',
    variant: 'general',
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
    ].map((button) => stripTrailingArrow(button.textContent))
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
    ].map((button) => stripTrailingArrow(button.textContent))
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
    variant: 'general',
    position: { x: 600, y: -50 },
    title: 'Final con el punto',
    body: richBody('Llegaste con el punto.'),
  }

  const finalFalse: FinalNode = {
    id: BUG_FINAL_FALSE_ID,
    number: 4,
    type: 'final',
    variant: 'general',
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
    variant: 'general',
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

    // `CICLOS[0]` ("TRONCAL ESP") no lleva prefijo de código, así que
    // `cicloOutputName` no le cambia nada aquí — el siguiente test cubre el
    // caso con prefijo.
    expect(names.introCicloName).toBe(cicloOutputName(ciclo.name))
    expect(names.introAsignaturaName).toBe(asignatura.name)
  })

  it('un ciclo con prefijo de código (p.ej. "AC - ") lo pierde en la salida exportada', () => {
    const ciclo = CICLOS.find((candidate) => candidate.name.includes(' - '))
    if (!ciclo) throw new Error('El catálogo necesita al menos un ciclo con prefijo " - "')
    const asignatura = ciclo.asignaturas[0]
    if (!asignatura) throw new Error('El ciclo de prueba no tiene asignaturas')

    const names = embeddedIntroNames(
      buildHtmlBundle(introProject({ cicloId: ciclo.id, asignaturaId: asignatura.id }), {}),
    )

    expect(names.introCicloName).toBe(cicloOutputName(ciclo.name))
    expect(names.introCicloName).not.toBe(ciclo.name)
    // La asignatura no lleva ningún código en la salida (eso es exclusivo
    // del espacio de trabajo, ver `asignaturaWorkspaceName`).
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

  it('arranca pintando la portada de marca: titular fijo, ciclo/asignatura pequeños, caseName y "Continuar"', () => {
    const ciclo = CICLOS[0]!
    const asignatura = ciclo.asignaturas[0]!

    runExportedBundle(buildHtmlBundle(introProject(), {}))

    const card = currentCard()
    expect(card.querySelector('.introHeading')?.textContent).toBe('¿Qué harías tú?')
    expect(card.querySelector('.introMetaLine')?.textContent).toBe(cicloOutputName(ciclo.name))
    expect(card.querySelectorAll('.introMetaLine')[1]?.textContent).toBe(asignatura.name)
    expect(card.querySelector('.introCaseTitle')?.textContent).toBe('Caso de exportación')
    expect(card.querySelector('.introButton')?.textContent).toBe('Continuar')
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

  it('con la portada incompleta (sin ciclo/asignatura/caseName) no rompe el HTML exportado: pinta placeholders grises', () => {
    runExportedBundle(
      buildHtmlBundle(
        introProject({ cicloId: undefined, asignaturaId: undefined, caseName: '' }),
        {},
      ),
    )

    const card = currentCard()
    // A diferencia del resto de vistas ("vacío" se omite sin más), la
    // portada sustituye cada dato que falte por un placeholder gris — ver
    // comentario de `IntroCard` en `PlayerScreen.tsx`.
    expect(card.querySelectorAll('.introMetaLinePlaceholder')[0]?.textContent).toBe(
      '— Ciclo sin elegir —',
    )
    expect(card.querySelectorAll('.introMetaLinePlaceholder')[1]?.textContent).toBe(
      '— Asignatura sin elegir —',
    )
    expect(card.querySelector('.introCaseTitlePlaceholder')?.textContent).toBe(
      '— Título sin definir —',
    )
    // El titular fijo de marca y el botón de continuar siguen ahí siempre.
    expect(card.querySelector('.introHeading')?.textContent).toBe('¿Qué harías tú?')
    expect(card.querySelector('.introButton')?.textContent).toBe('Continuar')
  })

  it('sin targetNodeId, la portada exportada cae en el mismo aviso de "sin continuación" que el resto del runtime', () => {
    runExportedBundle(buildHtmlBundle(introProject({ targetNodeId: undefined }), {}))

    expect(currentCard().textContent).toContain(
      'Esta parte de la experiencia no tiene una continuación configurada.',
    )
    // Y no queda ningún resto de portada (ni titular fijo ni caseName).
    expect(currentCard().querySelector('.introHeading')).toBeNull()
    expect(currentCard().textContent).not.toContain('Caso de exportación')
  })

  it('el título del nodo intro (siempre vacío, referencia interna) no aparece en ningún punto', () => {
    const html = buildHtmlBundle(introProject({ title: 'Nota interna de la portada' }), {})

    // `stripEditorOnlyFields` vacía el título de TODOS los nodos, incluido
    // el `intro` — mismo criterio que el resto del documento.
    expect(html).not.toContain('Nota interna de la portada')
  })
})

const VISIT_VAR_ID = 'cccccccc-0000-4000-8000-000000000001'
const VISIT_START_ID = 'cccccccc-0000-4000-8000-000000000002'
const VISIT_DECISION_ID = 'cccccccc-0000-4000-8000-000000000003'
const VISIT_FINAL_ID = 'cccccccc-0000-4000-8000-000000000004'
const VISIT_RESPONSE_CONTINUE_ID = 'cccccccc-0000-4000-8000-000000000005'
const VISIT_RESPONSE_EXIT_ID = 'cccccccc-0000-4000-8000-000000000006'

/**
 * Proyecto de prueba del milestone "+1 fallo con Game Over": una variable
 * numérica ("Fallos"), una diapositiva "Inicio" con `visitEffects` que la
 * incrementa en 5 al visitarla, una decisión con una respuesta normal y otra
 * `actsAsExit` (más un bloque de imagen PENDIENTE, sin `assetId`), y un
 * Final con contenido alternativo condicionado a esa misma variable
 * (`>= 5`).
 */
function gameOverFeaturesProject(): ProjectDocument {
  const start: SlideNode = {
    id: VISIT_START_ID,
    number: 1,
    type: 'slide',
    position: { x: 0, y: 0 },
    title: '',
    targetNodeId: VISIT_DECISION_ID,
    continueLabel: undefined,
    responses: [],
    content: [textBlock(richBody('Inicio'))],
    visitEffects: [{ variableId: VISIT_VAR_ID, operation: 'increment', value: 5 }],
  }

  const decision: SlideNode = {
    id: VISIT_DECISION_ID,
    number: 2,
    type: 'slide',
    position: { x: 300, y: 0 },
    title: '',
    targetNodeId: undefined,
    continueLabel: undefined,
    responses: [
      makeResponse({
        id: VISIT_RESPONSE_CONTINUE_ID,
        letter: 'A',
        text: 'Seguir',
        targetNodeId: VISIT_FINAL_ID,
      }),
      makeResponse({
        id: VISIT_RESPONSE_EXIT_ID,
        letter: 'B',
        text: 'No, me rindo.',
        actsAsExit: true,
      }),
    ],
    content: [
      textBlock(richBody('Elige qué hacer')),
      { id: 'pending-image-block', type: 'image', assetId: undefined },
    ],
  }

  const final: FinalNode = {
    id: VISIT_FINAL_ID,
    number: 3,
    type: 'final',
    variant: 'general',
    position: { x: 600, y: 0 },
    title: '',
    body: richBody('Final normal'),
    alternateCondition: { variableId: VISIT_VAR_ID, operator: '>=', value: 5 },
    alternateBody: richBody('Final alternativo por fallos'),
  }

  const fallosVariable: VariableDef = {
    id: VISIT_VAR_ID,
    name: 'Fallos',
    type: 'number',
    initialValue: 0,
  }

  return {
    schemaVersion: 1,
    metadata: {
      id: 'cccccccc-9999-4999-8999-999999999999',
      name: 'Proyecto de prueba visitEffects',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    settings: {},
    variables: [fallosVariable],
    graph: { nodes: [start, decision, final], startNodeId: VISIT_START_ID },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  }
}

describe('buildHtmlBundle — milestone "+1 fallo con Game Over"', () => {
  it('visitEffects se aplican al visitar una diapositiva, sea cual sea el camino, y afectan al contenido alternativo del Final', () => {
    runExportedBundle(buildHtmlBundle(gameOverFeaturesProject(), {}))
    // Arranca en "Inicio" (visitEffects: +5 sobre "Fallos") -> avanza a la
    // decisión.
    clickButton('Continuar')
    // Elige "Seguir" -> Final. La variable ya vale 5 (>= 5, la condición del
    // alternativo), así que se ve el contenido ALTERNATIVO.
    clickButton('Seguir')
    expect(currentCard().textContent).toContain('Final alternativo por fallos')
    expect(currentCard().textContent).not.toContain('Final normal')
  })

  it('sin haber visitado la diapositiva con visitEffects, el Final muestra su contenido por defecto', () => {
    // Arranca DIRECTAMENTE en la decisión ("Probar desde aquí", saltándose
    // "Inicio"): la variable se queda en su valor inicial (0), la condición
    // del alternativo (>= 5) es falsa.
    const project = gameOverFeaturesProject()
    project.graph.startNodeId = VISIT_DECISION_ID
    runExportedBundle(buildHtmlBundle(project, {}))

    clickButton('Seguir')

    expect(currentCard().textContent).toContain('Final normal')
    expect(currentCard().textContent).not.toContain('Final alternativo por fallos')
  })

  it('una respuesta actsAsExit es pulsable sin destino y no navega: se queda en la misma diapositiva y muestra el aviso de salir', () => {
    // Mismo motivo que el test de "Salir" del Final (más arriba en este
    // archivo): jsdom SÍ implementa window.close() de verdad (a diferencia
    // de scrollBy y compañía) y desmonta el document entero al llamarlo
    // (`delete window._document`), lo que rompería cualquier cosa que se
    // pinte después en el mismo test — se mockea a no-op, igual que el
    // comportamiento real en un navegador cuando la pestaña no la abrió un
    // script.
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {})

    const project = gameOverFeaturesProject()
    project.graph.startNodeId = VISIT_DECISION_ID
    runExportedBundle(buildHtmlBundle(project, {}))

    clickButton('No, me rindo.')

    // Sigue en la MISMA diapositiva (su propio texto sigue presente) — no
    // navegó a ningún nodo.
    expect(currentCard().textContent).toContain('Elige qué hacer')
    expect(currentCard().textContent).toContain('Ya puedes cerrar esta pestaña.')

    closeSpy.mockRestore()
  })

  it('un bloque de imagen "pendiente de subir" (sin assetId) se omite sin más, sin romper el HTML exportado', () => {
    const project = gameOverFeaturesProject()
    project.graph.startNodeId = VISIT_DECISION_ID
    runExportedBundle(buildHtmlBundle(project, {}))

    expect(currentCard().querySelector('img')).toBeNull()
  })

  describe('pantalla de marca bespoke "Game Over" (SlideNode.brandedGameOverScreen, buildGameOverCard)', () => {
    /** `gameOverFeaturesProject()`, arrancando directamente en la decisión
     *  (igual que el resto de este describe) y marcada como
     *  `brandedGameOverScreen` — el mínimo para que `buildCard` pinte
     *  `buildGameOverCard` en vez del layout genérico. */
    function brandedGameOverProject(): ProjectDocument {
      const project = gameOverFeaturesProject()
      project.graph.startNodeId = VISIT_DECISION_ID
      const decision = project.graph.nodes.find((node) => node.id === VISIT_DECISION_ID)
      if (!decision || decision.type !== 'slide') throw new Error('setup inválido')
      decision.brandedGameOverScreen = true
      return project
    }

    it('pinta buildGameOverCard (logo + título fijo + botones "Reintentar"/"Salir") en vez del layout genérico — el texto real de las respuestas no se pinta', () => {
      runExportedBundle(buildHtmlBundle(brandedGameOverProject(), {}))

      const card = document.querySelector('#brunch-root .gameOverCard')
      expect(card).not.toBeNull()
      expect(card?.textContent).toContain('¿Seguro que no quieres volver a intentarlo?')
      expect(card?.textContent).toContain('Reintentar')
      expect(card?.textContent).toContain('Salir')
      expect(card?.textContent).not.toContain('Seguir')
      expect(card?.textContent).not.toContain('No, me rindo.')
      expect(document.querySelector('#brunch-root .card')).toBeNull()
    })

    it('"Reintentar" ejecuta el comportamiento REAL de la primera respuesta visible (navega a su destino, aquí el Final)', () => {
      runExportedBundle(buildHtmlBundle(brandedGameOverProject(), {}))

      clickButton('Reintentar')

      expect(currentCard().textContent).toContain('Final normal')
    })

    it('"Salir" ejecuta el comportamiento REAL de la segunda respuesta visible (actsAsExit: no navega, aviso de salir)', () => {
      const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {})

      runExportedBundle(buildHtmlBundle(brandedGameOverProject(), {}))

      clickButton('Salir')

      const card = document.querySelector('#brunch-root .gameOverCard')
      expect(card).not.toBeNull()
      expect(card?.textContent).toContain('Ya puedes cerrar esta pestaña.')

      closeSpy.mockRestore()
    })

    it('con brandedGameOverScreen pero SIN exactamente 2 respuestas visibles, cae al layout genérico (fallback, caso raro de edición manual)', () => {
      const project = brandedGameOverProject()
      const decision = project.graph.nodes.find((node) => node.id === VISIT_DECISION_ID)
      if (!decision || decision.type !== 'slide') throw new Error('setup inválido')
      decision.responses = decision.responses.slice(0, 1)

      runExportedBundle(buildHtmlBundle(project, {}))

      expect(document.querySelector('#brunch-root .gameOverCard')).toBeNull()
      expect(currentCard().textContent).toContain('Elige qué hacer')
    })
  })

  describe('confeti del Final "Perfecto" (petición de usuario: "con confeti", ampliada después: "si llegas al final sin fallos y con fallos, en los dos")', () => {
    it('celebrate + contenido por defecto -> confeti presente en el HTML exportado', () => {
      const project = gameOverFeaturesProject()
      project.graph.startNodeId = VISIT_DECISION_ID
      const final = project.graph.nodes.find((node) => node.id === VISIT_FINAL_ID)
      if (!final || final.type !== 'final') throw new Error('setup inválido')
      final.celebrate = true
      // Sin visitar "Inicio" (que suma +5 a Fallos): la condición del
      // alternativo (>= 5) es falsa, se resuelve al contenido por defecto.
      runExportedBundle(buildHtmlBundle(project, {}))

      clickButton('Seguir')

      expect(currentCard().textContent).toContain('Final normal')
      const confetti = currentCard().querySelector('.confetti')
      expect(confetti).not.toBeNull()
      expect(confetti?.querySelectorAll('.confettiPiece').length).toBeGreaterThan(0)
    })

    it('petición de usuario ("en los dos"): celebrate + contenido ALTERNATIVO -> confeti TAMBIÉN presente', () => {
      const project = gameOverFeaturesProject()
      const final = project.graph.nodes.find((node) => node.id === VISIT_FINAL_ID)
      if (!final || final.type !== 'final') throw new Error('setup inválido')
      final.celebrate = true
      // Arranca en "Inicio" (+5 a Fallos): la condición del alternativo
      // (>= 5) se cumple, se resuelve al contenido ALTERNATIVO.
      runExportedBundle(buildHtmlBundle(project, {}))

      clickButton('Continuar')
      clickButton('Seguir')

      expect(currentCard().textContent).toContain('Final alternativo por fallos')
      const confetti = currentCard().querySelector('.confetti')
      expect(confetti).not.toBeNull()
      expect(confetti?.querySelectorAll('.confettiPiece').length).toBeGreaterThan(0)
    })

    it('sin celebrate, nunca hay confeti, ni con el contenido por defecto ni con el alternativo', () => {
      const project = gameOverFeaturesProject()
      project.graph.startNodeId = VISIT_DECISION_ID
      runExportedBundle(buildHtmlBundle(project, {}))

      clickButton('Seguir')

      expect(currentCard().textContent).toContain('Final normal')
      expect(currentCard().querySelector('.confetti')).toBeNull()
    })
  })
})
