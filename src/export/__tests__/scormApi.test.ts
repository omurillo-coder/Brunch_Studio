import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildHtmlBundle } from '../htmlBundle'
import type { ExportAssetMap } from '../exportAssets'
import type { FinalNode, ProjectDocument, SlideNode } from '../../domain'

/**
 * Tests de la comunicación con la API SCORM 2004 4ª edición del script
 * exportado (Milestone 3, fase 2).
 *
 * El mismo `EXPORTED_PLAYER_SCRIPT` sirve para la exportación HTML suelta y
 * para el paquete SCORM, así que se ejercita aquí exactamente igual que
 * `htmlBundle.test.ts` (montando el HTML generado en jsdom y ejecutando su
 * `<script>` de verdad), simulando en `window.API_1484_11` un objeto con
 * `Initialize`/`SetValue`/`Commit`/`Terminate` como espías.
 */

const SLIDE_ID = '11111111-1111-4111-8111-111111111111'
const FINAL_ID = '33333333-3333-4333-8333-333333333333'

function richBody(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })
}

/** Proyecto de una sola diapositiva que va directa a un Final, con o sin
 *  puntuación acumulada según `withPoints`. */
function sampleProject(): ProjectDocument {
  const slide: SlideNode = {
    id: SLIDE_ID,
    number: 1,
    type: 'slide',
    position: { x: 0, y: 0 },
    title: 'Inicio',
    body: richBody('Bienvenido.'),
    targetNodeId: FINAL_ID,
    continueLabel: 'Continuar',
    responses: [],
    imageAssetIds: [],
    audioAssetId: undefined,
    contentOrder: 'text-first',
  }

  const final: FinalNode = {
    id: FINAL_ID,
    number: 2,
    type: 'final',
    position: { x: 300, y: 0 },
    title: 'Fin',
    body: richBody('Se acabó.'),
  }

  return {
    schemaVersion: 1,
    metadata: {
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Escenario SCORM',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    settings: {},
    variables: [],
    graph: { nodes: [slide, final], startNodeId: SLIDE_ID },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  }
}

/** Proyecto con una decisión que otorga puntos antes de llegar al Final. */
function sampleProjectWithPoints(): ProjectDocument {
  const project = sampleProject()
  const decisionId = '22222222-2222-4222-8222-222222222222'
  const responseId = '44444444-4444-4444-8444-444444444441'

  const slide = project.graph.nodes[0] as SlideNode
  slide.targetNodeId = decisionId

  const decision: SlideNode = {
    id: decisionId,
    number: 2,
    type: 'slide',
    position: { x: 150, y: 0 },
    title: '¿Qué haces?',
    body: richBody('Elige.'),
    targetNodeId: undefined,
    continueLabel: undefined,
    responses: [
      {
        id: responseId,
        letter: 'A',
        text: 'Avanzar',
        points: 10,
        targetNodeId: FINAL_ID,
      },
    ],
    imageAssetIds: [],
    audioAssetId: undefined,
    contentOrder: 'text-first',
  }

  return {
    ...project,
    graph: { nodes: [slide, decision, project.graph.nodes[1] as FinalNode], startNodeId: SLIDE_ID },
  }
}

const emptyAssets: ExportAssetMap = {}

function runExportedBundle(html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  document.body.innerHTML = parsed.body.innerHTML

  const script = document.querySelector<HTMLScriptElement>('script:not([type])')
  if (!script) {
    throw new Error('El HTML exportado debe incluir un <script> clásico con el runtime.')
  }
  new Function(script.textContent ?? '')()
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

/** Espías de una API SCORM 2004 4ª edición mínima, tal cual la expondría un
 *  LMS real. */
function fakeScormAPI() {
  return {
    Initialize: vi.fn(() => 'true'),
    SetValue: vi.fn(() => 'true'),
    Commit: vi.fn(() => 'true'),
    Terminate: vi.fn(() => 'true'),
  }
}

describe('script exportado — SCORM 2004 4ª edición', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    // El script deja un listener de `beforeunload`; nada debe quedar entre
    // tests además de la propia API simulada, que cada test borra.
    delete (window as { API_1484_11?: unknown }).API_1484_11
  })

  it('sin ninguna API SCORM en window, no lanza y no intenta llamar nada', () => {
    expect(() => runExportedBundle(buildHtmlBundle(sampleProject(), emptyAssets))).not.toThrow()

    clickButton('Continuar')

    // Sin API, el comportamiento observable debe ser exactamente el de la
    // fase 1: llega al Final con normalidad.
    const card = document.querySelector('#brunch-root .card')
    expect(card?.querySelector('.title')?.textContent).toBe('Fin de la experiencia')
  })

  it('llama a Initialize al cargar cuando hay una API SCORM en window', () => {
    const api = fakeScormAPI()
    ;(window as unknown as { API_1484_11: typeof api }).API_1484_11 = api

    runExportedBundle(buildHtmlBundle(sampleProject(), emptyAssets))

    expect(api.Initialize).toHaveBeenCalledWith('')
  })

  it('al llegar a un Final informa cmi.completion_status "completed" y hace commit, sin puntuación si no hay ninguna', () => {
    const api = fakeScormAPI()
    ;(window as unknown as { API_1484_11: typeof api }).API_1484_11 = api

    runExportedBundle(buildHtmlBundle(sampleProject(), emptyAssets))
    clickButton('Continuar')

    expect(api.SetValue).toHaveBeenCalledWith('cmi.completion_status', 'completed')
    expect(api.SetValue).not.toHaveBeenCalledWith('cmi.success_status', expect.anything())
    expect(api.SetValue).not.toHaveBeenCalledWith('cmi.score.raw', expect.anything())
    expect(api.Commit).toHaveBeenCalledWith('')
  })

  it('al llegar a un Final con puntuación, también informa cmi.score.raw tal cual', () => {
    const api = fakeScormAPI()
    ;(window as unknown as { API_1484_11: typeof api }).API_1484_11 = api

    runExportedBundle(buildHtmlBundle(sampleProjectWithPoints(), emptyAssets))
    clickButton('Continuar')
    clickButton('Avanzar')

    expect(api.SetValue).toHaveBeenCalledWith('cmi.completion_status', 'completed')
    expect(api.SetValue).toHaveBeenCalledWith('cmi.score.raw', '10')
    expect(api.Commit).toHaveBeenCalledWith('')
  })

  it('llama a Terminate al disparar beforeunload, solo si se había inicializado', () => {
    const api = fakeScormAPI()
    ;(window as unknown as { API_1484_11: typeof api }).API_1484_11 = api

    runExportedBundle(buildHtmlBundle(sampleProject(), emptyAssets))
    window.dispatchEvent(new Event('beforeunload'))

    expect(api.Terminate).toHaveBeenCalledWith('')
  })

  it('no llama a Terminate en beforeunload si nunca hubo API (no-op de la fase 1)', () => {
    expect(() => {
      runExportedBundle(buildHtmlBundle(sampleProject(), emptyAssets))
      window.dispatchEvent(new Event('beforeunload'))
    }).not.toThrow()
  })

  it('"Salir" en el Final llama a Terminate (misma secuencia de finalización que beforeunload) ANTES de intentar cerrar la ventana', () => {
    const api = fakeScormAPI()
    ;(window as unknown as { API_1484_11: typeof api }).API_1484_11 = api
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {})

    runExportedBundle(buildHtmlBundle(sampleProject(), emptyAssets))
    clickButton('Continuar')
    clickButton('Salir')

    expect(api.Terminate).toHaveBeenCalledWith('')
    expect(closeSpy).toHaveBeenCalledTimes(1)
    // El orden importa: la finalización SCORM no debe depender solo de que
    // "beforeunload" llegue a dispararse a tiempo tras cerrar la ventana.
    const terminateOrder = api.Terminate.mock.invocationCallOrder[0]!
    const closeOrder = closeSpy.mock.invocationCallOrder[0]!
    expect(terminateOrder).toBeLessThan(closeOrder)

    closeSpy.mockRestore()
  })

  it('"Salir" en el Final sin ninguna API SCORM no lanza y sigue mostrando el aviso de cierre', () => {
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {})

    expect(() => {
      runExportedBundle(buildHtmlBundle(sampleProject(), emptyAssets))
      clickButton('Continuar')
      clickButton('Salir')
    }).not.toThrow()

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(document.querySelector('#brunch-root .card')?.textContent).toContain(
      'Ya puedes cerrar esta pestaña.',
    )

    closeSpy.mockRestore()
  })

  it('una API que lanza en cualquier llamada no rompe la reproducción', () => {
    const api = {
      Initialize: vi.fn(() => {
        throw new Error('LMS roto')
      }),
      SetValue: vi.fn(() => {
        throw new Error('LMS roto')
      }),
      Commit: vi.fn(() => {
        throw new Error('LMS roto')
      }),
      Terminate: vi.fn(() => {
        throw new Error('LMS roto')
      }),
    }
    ;(window as unknown as { API_1484_11: typeof api }).API_1484_11 = api

    expect(() => {
      runExportedBundle(buildHtmlBundle(sampleProject(), emptyAssets))
      clickButton('Continuar')
      window.dispatchEvent(new Event('beforeunload'))
    }).not.toThrow()

    const card = document.querySelector('#brunch-root .card')
    expect(card?.querySelector('.title')?.textContent).toBe('Fin de la experiencia')
  })
})
