import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildHtmlBundle } from '../htmlBundle'
import {
  TEACHER_REVIEW_COMPLETION_TEXT,
  TEACHER_REVIEW_WELCOME_TEXT,
  buildTeacherReviewBundle,
} from '../teacherReviewExport'
import type { ExportAssetMap } from '../exportAssets'
import type { DecisionResponse, FinalNode, IntroNode, ProjectDocument, SlideNode } from '../../domain'

/**
 * Tests de "Exportar revisión profes":
 *
 * 1. Sobre el string generado (`buildHtmlBundle` con las opciones de
 *    revisión, y `buildTeacherReviewBundle` de punta a punta con `fetch`
 *    mockeado): la bandera `reviewMode`, los textos EXACTOS de
 *    bienvenida/felicitación, y la imagen embebida como `data:` URI (nunca
 *    una referencia externa).
 * 2. Ejecutando el `<script>` del HTML generado en jsdom (mismo mecanismo que
 *    `htmlBundle.test.ts`): pantalla de bienvenida antes del Inicio,
 *    "Diapositiva {número}" en cada tarjeta, indicador de progreso, salto
 *    directo desde la lista de cobertura, pantalla de felicitación al 100%,
 *    y persistencia en `localStorage` namespaced por `metadata.id`.
 */

const INTRO_ID = 'cccccccc-0000-4000-8000-000000000001'
const SLIDE_ID = 'cccccccc-0000-4000-8000-000000000002'
const DECISION_ID = 'cccccccc-0000-4000-8000-000000000003'
const FINAL_A_ID = 'cccccccc-0000-4000-8000-000000000004'
const FINAL_B_ID = 'cccccccc-0000-4000-8000-000000000005'
const RESPONSE_A_ID = 'cccccccc-0000-4000-8000-000000000006'
const RESPONSE_B_ID = 'cccccccc-0000-4000-8000-000000000007'

function makeResponse(overrides: Partial<DecisionResponse> & { id: string }): DecisionResponse {
  return { letter: 'A', text: '', ...overrides } as DecisionResponse
}

/**
 * Proyecto de 5 nodos (Inicio + 3 diapositivas + 2 finales, cada uno cuenta
 * igual para el progreso): Inicio (1) -> continuar (2) -> decisión (3) con
 * dos respuestas hacia dos finales distintos (4 y 5), para poder ejercitar
 * el camino normal completo Y el salto directo desde la lista de cobertura
 * a un final que el camino normal no visita.
 */
function reviewProject(metadataId: string): ProjectDocument {
  const intro: IntroNode = {
    id: INTRO_ID,
    number: 1,
    type: 'intro',
    position: { x: 0, y: 0 },
    title: '',
    cicloId: undefined,
    asignaturaId: undefined,
    caseName: 'Caso de revisión',
    targetNodeId: SLIDE_ID,
  }

  const slide: SlideNode = {
    id: SLIDE_ID,
    number: 2,
    type: 'slide',
    position: { x: 200, y: 0 },
    title: 'Diapositiva de continuar',
    targetNodeId: DECISION_ID,
    continueLabel: undefined,
    responses: [],
    content: [],
  }

  const decision: SlideNode = {
    id: DECISION_ID,
    number: 3,
    type: 'slide',
    position: { x: 400, y: 0 },
    title: 'Decisión',
    targetNodeId: undefined,
    continueLabel: undefined,
    responses: [
      makeResponse({ id: RESPONSE_A_ID, letter: 'A', text: 'Ir al final A', targetNodeId: FINAL_A_ID }),
      makeResponse({ id: RESPONSE_B_ID, letter: 'B', text: 'Ir al final B', targetNodeId: FINAL_B_ID }),
    ],
    content: [],
  }

  const finalA: FinalNode = {
    id: FINAL_A_ID,
    number: 4,
    type: 'final',
    variant: 'general',
    position: { x: 600, y: -50 },
    title: 'Final A',
    body: '',
  }

  const finalB: FinalNode = {
    id: FINAL_B_ID,
    number: 5,
    type: 'final',
    variant: 'general',
    position: { x: 600, y: 50 },
    title: 'Final B',
    body: '',
  }

  return {
    schemaVersion: 1,
    metadata: {
      id: metadataId,
      name: 'Proyecto de revisión',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    settings: {},
    variables: [],
    graph: { nodes: [intro, slide, decision, finalA, finalB], startNodeId: INTRO_ID },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  }
}

const METADATA_ID_A = 'dddddddd-0000-4000-8000-000000000001'
const METADATA_ID_B = 'dddddddd-0000-4000-8000-000000000002'

const emptyAssets: ExportAssetMap = {}

const TEST_PENGUIN_DATA_URI = 'data:image/png;base64,AAAA'

function buildReviewHtml(metadataId: string): string {
  return buildHtmlBundle(reviewProject(metadataId), emptyAssets, {
    welcomeText: TEACHER_REVIEW_WELCOME_TEXT,
    completionText: TEACHER_REVIEW_COMPLETION_TEXT,
    penguinDataUri: TEST_PENGUIN_DATA_URI,
  })
}

/** Mismo mecanismo que `runExportedBundle` en `htmlBundle.test.ts`: ejecuta
 *  de verdad el `<script>` del HTML generado en jsdom. */
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

function clickButtonWithText(text: string, root: ParentNode = document): void {
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent === text,
  )
  if (!button) {
    throw new Error(`No existe ningún botón con el texto "${text}".`)
  }
  button.click()
}

function indicatorButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('.reviewIndicatorButton')
  if (!button) throw new Error('No se ha pintado el indicador de progreso.')
  return button
}

function coveragePanelItems(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.reviewPanelItem')]
}

beforeEach(() => {
  document.body.innerHTML = ''
  window.localStorage.clear()
})

describe('buildTeacherReviewBundle — contenido del bundle', () => {
  it('activa reviewMode y embebe los textos EXACTOS y la imagen como data: URI', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([137, 80, 78, 71]).buffer, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const html = await buildTeacherReviewBundle(reviewProject(METADATA_ID_A), emptyAssets)

    expect(html).toContain('"reviewMode":true')
    expect(html).toContain('Hola profe :)')
    expect(html).toContain(
      'Desde la Content hemos preparado este soporte para tu aula. Se trata de un caso practico interactivo con varios posibles caminos. Como no somos expertos nos iria muy bien que te mirases toda la experiencia y que nos digas que te parece. Te hemos dejado el nombre de las diapositivas para que en el excel de validaciones nos dejes los comentarios.',
    )
    expect(html).toContain('Muchas gracias!!!')
    expect(html).toContain(
      'Ya has revisado todo el caso práctico interactivo. Muchísimas gracias por el feedback!',
    )
    // La imagen viaja como data: URI ya embebida, nunca como referencia
    // externa a un fichero.
    expect(html).toMatch(/data:image\/png;base64,[A-Za-z0-9+/=]+/)
    expect(html).not.toContain('completion-penguin.png')

    vi.unstubAllGlobals()
  })

  it('sin reviewMode (buildHtmlBundle normal, sin tercer argumento), el bundle embebido no activa el modo revisión ni pinta "Diapositiva"', () => {
    const html = buildHtmlBundle(reviewProject(METADATA_ID_A), emptyAssets)

    // El SCRIPT (JS vanilla, estático, el mismo para los tres tipos de
    // export) menciona literalmente `reviewMode`/`teacherReview`/
    // "Diapositiva " en su propio código fuente — eso no cambia entre
    // exports. Lo que sí debe cambiar es el JSON EMBEBIDO: sin bandera
    // activa, y el runtime en jsdom no debe pintar nada del modo revisión.
    expect(html).not.toContain('"reviewMode":true')
    expect(html).not.toContain('"teacherReview":')
    expect(html).not.toContain('Hola profe')

    document.body.innerHTML = ''
    runExportedBundle(html)
    expect(document.querySelector('.reviewSlideLabel')).toBeNull()
    expect(document.querySelector('.reviewIndicator')).toBeNull()
  })
})

describe('buildHtmlBundle con opciones de revisión — comportamiento en jsdom', () => {
  it('muestra la pantalla de bienvenida ANTES del Inicio; "Continuar" lleva al Inicio real', () => {
    runExportedBundle(buildReviewHtml(METADATA_ID_A))

    // Pantalla de bienvenida: sin "Diapositiva N" todavía, con el texto fijo.
    const welcomeCard = currentCard()
    expect(welcomeCard.querySelector('.reviewSlideLabel')).toBeNull()
    expect(welcomeCard.textContent).toContain('Hola profe :)')
    expect(welcomeCard.textContent).toContain('Muchas gracias!!!')

    clickButtonWithText('Continuar', currentCard())

    // Ahora sí, la diapositiva de Inicio real (nodo intro, number 1).
    const card = currentCard()
    expect(card.querySelector('.reviewSlideLabel')?.textContent).toBe('Diapositiva 1')
    expect(card.textContent).toContain('Caso de revisión')
  })

  it('"Diapositiva {número}" aparece en cada tipo de pantalla con su número real', () => {
    runExportedBundle(buildReviewHtml(METADATA_ID_A))
    clickButtonWithText('Continuar', currentCard()) // bienvenida -> intro (1)
    expect(currentCard().querySelector('.reviewSlideLabel')?.textContent).toBe('Diapositiva 1')

    clickButtonWithText('Continuar') // intro -> slide "de continuar" (2)
    expect(currentCard().querySelector('.reviewSlideLabel')?.textContent).toBe('Diapositiva 2')

    clickButtonWithText('Continuar') // slide -> decisión (3)
    expect(currentCard().querySelector('.reviewSlideLabel')?.textContent).toBe('Diapositiva 3')

    clickButtonWithText('Ir al final A') // decisión -> final A (4)
    expect(currentCard().querySelector('.reviewSlideLabel')?.textContent).toBe('Diapositiva 4')
  })

  it('el indicador de progreso sube al visitar diapositivas nuevas y no sube al revisitar', () => {
    runExportedBundle(buildReviewHtml(METADATA_ID_A))
    // Bienvenida: 0% (nada visitado todavía).
    expect(indicatorButton().textContent).toBe('0% revisado')

    clickButtonWithText('Continuar', currentCard()) // visita Diapositiva 1 (1/5)
    expect(indicatorButton().textContent).toBe('20% revisado')

    clickButtonWithText('Continuar') // Diapositiva 2 (2/5)
    expect(indicatorButton().textContent).toBe('40% revisado')

    clickButtonWithText('Continuar') // Diapositiva 3 (3/5)
    expect(indicatorButton().textContent).toBe('60% revisado')

    clickButtonWithText('Ir al final A') // Diapositiva 4 (4/5)
    expect(indicatorButton().textContent).toBe('80% revisado')

    // "Volver a jugar" reinicia el RECORRIDO (vuelve al Inicio), pero el
    // PROGRESO de cobertura no retrocede: Diapositiva 1 ya estaba visitada.
    clickButtonWithText('Volver a jugar')
    expect(indicatorButton().textContent).toBe('80% revisado')
  })

  it('saltar desde la lista de cobertura a una diapositiva no visitada lleva ahí y la marca como visitada', () => {
    runExportedBundle(buildReviewHtml(METADATA_ID_A))
    clickButtonWithText('Continuar', currentCard()) // Diapositiva 1

    // Abre la lista de cobertura.
    indicatorButton().click()
    const items = coveragePanelItems()
    expect(items.map((item) => item.textContent)).toEqual([
      '✓ Diapositiva 1',
      'Diapositiva 2',
      'Diapositiva 3',
      'Diapositiva 4',
      'Diapositiva 5',
    ])

    // Salta directamente a la Diapositiva 5 (Final B) sin pasar por la
    // decisión intermedia.
    const target = items.find((item) => item.textContent === 'Diapositiva 5')
    if (!target) throw new Error('No se encontró el ítem "Diapositiva 5" en la lista de cobertura.')
    target.click()

    expect(currentCard().querySelector('.reviewSlideLabel')?.textContent).toBe('Diapositiva 5')
    expect(indicatorButton().textContent).toBe('40% revisado')
  })

  it('al completar el 100% aparece la pantalla de felicitación con el texto exacto y la imagen; "Continuar" la cierra', () => {
    runExportedBundle(buildReviewHtml(METADATA_ID_A))
    clickButtonWithText('Continuar', currentCard()) // 1
    clickButtonWithText('Continuar') // 2
    clickButtonWithText('Continuar') // 3
    clickButtonWithText('Ir al final A') // 4

    expect(indicatorButton().textContent).toBe('80% revisado')
    expect(document.querySelector<HTMLElement>('.reviewOverlayBackdrop')?.style.display).not.toBe(
      'flex',
    )

    // Salta a la última diapositiva que falta desde la lista de cobertura.
    indicatorButton().click()
    clickButtonWithText('Diapositiva 5')

    expect(indicatorButton().textContent).toBe('100% revisado')
    const overlay = document.querySelector<HTMLElement>('.reviewOverlayBackdrop')
    expect(overlay?.style.display).toBe('flex')
    expect(overlay?.textContent).toContain(
      'Ya has revisado todo el caso práctico interactivo. Muchísimas gracias por el feedback!',
    )
    expect(overlay?.querySelector('img')?.getAttribute('src')).toBe(TEST_PENGUIN_DATA_URI)

    clickButtonWithText('Continuar', overlay!)
    expect(overlay?.style.display).toBe('none')

    // El recorrido sigue funcionando con normalidad tras cerrar el overlay:
    // seguimos viendo la Diapositiva 5, no se ha perdido el estado.
    expect(currentCard().querySelector('.reviewSlideLabel')?.textContent).toBe('Diapositiva 5')
  })

  it('el progreso persiste en localStorage namespaced por metadata.id', () => {
    runExportedBundle(buildReviewHtml(METADATA_ID_A))
    clickButtonWithText('Continuar', currentCard())
    clickButtonWithText('Continuar')

    const raw = window.localStorage.getItem(`brunch-teacher-review:${METADATA_ID_A}`)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).visited).toHaveLength(2)

    // "Recargar" el mismo archivo (mismo metadata.id): recupera el progreso.
    document.body.innerHTML = ''
    runExportedBundle(buildReviewHtml(METADATA_ID_A))
    expect(indicatorButton().textContent).toBe('40% revisado')
  })

  it('dos proyectos con distinto metadata.id no comparten progreso', () => {
    runExportedBundle(buildReviewHtml(METADATA_ID_A))
    clickButtonWithText('Continuar', currentCard())
    clickButtonWithText('Continuar')
    clickButtonWithText('Continuar')
    expect(indicatorButton().textContent).toBe('60% revisado')

    document.body.innerHTML = ''
    runExportedBundle(buildReviewHtml(METADATA_ID_B))
    // El segundo proyecto (id distinto) arranca de cero, sin arrastrar el
    // progreso del primero.
    expect(indicatorButton().textContent).toBe('0% revisado')

    // Y el progreso del primero sigue intacto en su propia clave.
    const rawA = window.localStorage.getItem(`brunch-teacher-review:${METADATA_ID_A}`)
    expect(JSON.parse(rawA!).visited).toHaveLength(3)
  })
})
