import { describe, expect, it } from 'vitest'
import { buildHtmlBundle } from '../htmlBundle'
import { ROOT_ELEMENT_ID } from '../exportedPlayerScript'
import { advance, choose, getInitialState, getView } from '../../player/runtime'
import type { PlayerState, PlayerView } from '../../player/runtime'
import { FINAL_ALTERNATE_HEADING, FINAL_TOP_HEADING } from '../../domain'
import type {
  ContentBlock,
  DecisionResponse,
  FinalNode,
  IntroNode,
  ProjectDocument,
  SlideNode,
  VariableDef,
} from '../../domain'
import type { ExportAssetMap } from '../exportAssets'

/**
 * ---------------------------------------------------------------------------
 * Test de PARIDAD entre los dos runtimes del reproductor
 * ---------------------------------------------------------------------------
 *
 * `src/player/runtime.ts` (React, usado por "Probar" dentro del editor) y
 * `src/export/exportedPlayerScript.ts` (JS vanilla embebido en el HTML
 * exportado) implementan la MISMA lógica de recorrido dos veces — el
 * segundo es, literalmente, una traducción a mano del primero (ver el
 * comentario de cabecera de `exportedPlayerScript.ts`). Ya han quedado
 * desincronizados una vez en producción: el gate de "Final con fallos"
 * exigía `alternateBody` no vacío en un runtime más tiempo que en el otro,
 * y ningún test lo detectó porque cada runtime solo se probaba contra sí
 * mismo. Este archivo es ese test que faltaba: recorre EL MISMO proyecto
 * con LA MISMA secuencia de decisiones en los dos runtimes y compara, paso
 * a paso, que ambos tomen las mismas decisiones de navegación.
 *
 * Cómo se conduce cada runtime:
 * - React: directamente con sus funciones puras (`getInitialState`/
 *   `getView`/`advance`/`choose`) — sin montar ningún componente.
 * - Export: ejecutando de verdad el `<script>` generado por
 *   `buildHtmlBundle` en jsdom (mismo mecanismo que `htmlBundle.test.ts`) y
 *   simulando los mismos clics que haría una persona.
 *
 * Qué se compara en cada paso: una "huella" mínima y deliberadamente
 * independiente del marcado HTML/JSX de cada uno (que SÍ difiere entre
 * React y el HTML a mano sin que eso sea un bug) — el TIPO de vista y un
 * marcador de texto único por nodo (el cuerpo de un bloque de contenido, o
 * qué variante de Final se resolvió). Lo que importa es que ambos motores
 * evalúen las MISMAS condiciones y lleguen al MISMO nodo, no que produzcan
 * el mismo DOM.
 */

const INTRO_ID = 'ffffffff-0000-4000-8000-000000000001'
const SLIDE_A_ID = 'ffffffff-0000-4000-8000-000000000002'
const DECISION_ID = 'ffffffff-0000-4000-8000-000000000003'
const FINAL_ID = 'ffffffff-0000-4000-8000-000000000004'
const RESPONSE_OK_ID = 'ffffffff-0000-4000-8000-000000000005'
const RESPONSE_FAIL_ID = 'ffffffff-0000-4000-8000-000000000006'
const VARIABLE_FALLOS_ID = 'ffffffff-0000-4000-8000-000000000007'

const CASE_NAME = 'CASO_PARIDAD_UNICO'
const MARKER_SLIDE_A = 'MARCADOR_SLIDE_A_UNICO'
const MARKER_DECISION = 'MARCADOR_DECISION_UNICO'
const RESPONSE_OK_TEXT = 'Seguir el protocolo'
const RESPONSE_FAIL_TEXT = 'Saltarse el protocolo'

/** Documento Tiptap serializado mínimo (un único párrafo de texto plano),
 *  tal cual lo guarda `RichTextEditor` — mismo formato que usan
 *  `htmlBundle.test.ts`/`teacherReviewExport.test.ts`. */
function richBody(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })
}

function textBlock(id: string, body: string): ContentBlock {
  return { id, type: 'text', body: richBody(body) }
}

/**
 * Proyecto compartido por ambos runtimes: Inicio -> diapositiva "de
 * continuar" -> decisión con dos respuestas, una de las cuales incrementa
 * la variable "Fallos" -> un único Final cuya `alternateCondition`
 * depende de esa variable. Reproduce deliberadamente la forma exacta del
 * bug real ya corregido (`resolveFinalContent`/`evaluateCondition`
 * duplicados entre los dos runtimes): sin efectos, el Final debe resolver
 * al contenido por defecto; con el efecto aplicado, al alternativo.
 */
function buildParityProject(): ProjectDocument {
  const intro: IntroNode = {
    id: INTRO_ID,
    number: 1,
    type: 'intro',
    position: { x: 0, y: 0 },
    title: '',
    cicloId: undefined,
    asignaturaId: undefined,
    caseName: CASE_NAME,
    targetNodeId: SLIDE_A_ID,
  }

  const slideA: SlideNode = {
    id: SLIDE_A_ID,
    number: 2,
    type: 'slide',
    position: { x: 200, y: 0 },
    title: 'Diapositiva de continuar',
    targetNodeId: DECISION_ID,
    continueLabel: undefined,
    responses: [],
    content: [textBlock('block-slide-a', MARKER_SLIDE_A)],
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
      {
        id: RESPONSE_OK_ID,
        letter: 'A',
        text: RESPONSE_OK_TEXT,
        targetNodeId: FINAL_ID,
      } as DecisionResponse,
      {
        id: RESPONSE_FAIL_ID,
        letter: 'B',
        text: RESPONSE_FAIL_TEXT,
        targetNodeId: FINAL_ID,
        effects: [{ variableId: VARIABLE_FALLOS_ID, operation: 'increment', value: 1 }],
      } as DecisionResponse,
    ],
    content: [textBlock('block-decision', MARKER_DECISION)],
  }

  const final: FinalNode = {
    id: FINAL_ID,
    number: 4,
    type: 'final',
    variant: 'general',
    position: { x: 600, y: 0 },
    title: 'Final',
    body: richBody('Cuerpo por defecto (no se pinta: texto fijo de marca).'),
    alternateCondition: { variableId: VARIABLE_FALLOS_ID, operator: '>', value: 0 },
    alternateBody: richBody('Cuerpo alternativo (tampoco se pinta).'),
  }

  const fallosVariable: VariableDef = {
    id: VARIABLE_FALLOS_ID,
    name: 'Fallos',
    type: 'number',
    initialValue: 0,
  }

  return {
    schemaVersion: 1,
    metadata: {
      id: 'ffffffff-1111-4111-8111-111111111111',
      name: 'Proyecto de paridad',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    settings: {},
    variables: [fallosVariable],
    graph: { nodes: [intro, slideA, decision, final], startNodeId: INTRO_ID },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  }
}

const emptyAssets: ExportAssetMap = {}

/** Una acción de la secuencia de recorrido: "Continuar" (`advance`) o
 *  elegir una respuesta por su texto EXACTO (sin la flecha "→" que añade
 *  el export, ver `stripTrailingArrow`). */
type Action = { kind: 'advance' } | { kind: 'choose'; responseText: string }

/** Huella mínima de una vista, comparable entre los dos runtimes sin
 *  depender de su marcado HTML/JSX (ver comentario de cabecera). */
interface ViewFingerprint {
  kind: PlayerView['kind']
  marker: string
}

/** Reduce un texto cualquiera (el `body` serializado de Tiptap tal cual lo
 *  ve React, o el texto plano ya renderizado en el DOM exportado) al
 *  marcador único que contiene — así ambos runtimes producen la MISMA
 *  huella aunque uno la calcule sobre el JSON sin parsear y el otro sobre
 *  el texto visible ya extraído: lo único que importa comparar es CUÁL de
 *  los marcadores conocidos aparece, no la representación intermedia. */
function markerWithin(text: string): string {
  if (text.includes(CASE_NAME)) return CASE_NAME
  if (text.includes(MARKER_SLIDE_A)) return MARKER_SLIDE_A
  if (text.includes(MARKER_DECISION)) return MARKER_DECISION
  return text
}

function fingerprintOfReactView(view: PlayerView): ViewFingerprint {
  if (view.kind === 'intro') {
    return { kind: 'intro', marker: markerWithin(view.node.caseName ?? '') }
  }
  if (view.kind === 'continue' || view.kind === 'decision') {
    const block = view.node.content.find((candidate) => candidate.type === 'text')
    return { kind: view.kind, marker: markerWithin(block?.type === 'text' ? block.body : '') }
  }
  if (view.kind === 'final') {
    return { kind: 'final', marker: view.usedAlternate ? 'alternate' : 'default' }
  }
  return { kind: 'dead-end', marker: '' }
}

/** Mismo criterio que `fingerprintOfReactView`, pero leyendo el DOM que ha
 *  pintado el runtime exportado. */
function fingerprintOfExportedDom(): ViewFingerprint {
  const root = document.getElementById(ROOT_ELEMENT_ID)
  if (!root) throw new Error(`No se ha encontrado #${ROOT_ELEMENT_ID} en el documento.`)
  const text = root.textContent ?? ''

  if (text.includes(FINAL_ALTERNATE_HEADING)) return { kind: 'final', marker: 'alternate' }
  if (text.includes(FINAL_TOP_HEADING)) return { kind: 'final', marker: 'default' }
  if (text.includes(CASE_NAME)) return { kind: 'intro', marker: markerWithin(text) }
  if (text.includes(MARKER_SLIDE_A)) return { kind: 'continue', marker: markerWithin(text) }
  if (text.includes(MARKER_DECISION)) return { kind: 'decision', marker: markerWithin(text) }
  return { kind: 'dead-end', marker: text.trim() }
}

/** Recorre `project` con `actions` conduciendo directamente el runtime de
 *  React (sin montar ningún componente), devolviendo la huella de la
 *  vista ANTES de cada acción y de la vista final tras la última. */
function traceReactRuntime(project: ProjectDocument, actions: Action[]): ViewFingerprint[] {
  let state: PlayerState = getInitialState(project)
  const trace: ViewFingerprint[] = []

  for (const action of actions) {
    const view = getView(project, state)
    trace.push(fingerprintOfReactView(view))

    if (action.kind === 'advance') {
      state = advance(project, state)
      continue
    }
    if (view.kind !== 'decision') {
      throw new Error(`Se esperaba una decisión para elegir "${action.responseText}".`)
    }
    const response = view.visibleResponses.find((candidate) => candidate.text === action.responseText)
    if (!response) {
      throw new Error(`No existe la respuesta "${action.responseText}" en la decisión actual.`)
    }
    state = choose(project, state, response.id)
  }

  trace.push(fingerprintOfReactView(getView(project, state)))
  return trace
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

function stripTrailingArrow(text: string | null): string {
  return (text ?? '').replace(/→\s*$/, '').trim()
}

function clickButtonWithText(text: string): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => stripTrailingArrow(candidate.textContent) === text,
  )
  if (!button) {
    throw new Error(`No existe ningún botón con el texto "${text}".`)
  }
  button.click()
}

/** Recorre el HTML exportado de `project` con `actions`, simulando los
 *  mismos clics que un navegador real — devuelve la huella tras cada paso
 *  con el mismo criterio que `traceReactRuntime`. */
function traceExportedRuntime(project: ProjectDocument, actions: Action[]): ViewFingerprint[] {
  document.body.innerHTML = ''
  runExportedBundle(buildHtmlBundle(project, emptyAssets))

  const trace: ViewFingerprint[] = [fingerprintOfExportedDom()]
  for (const action of actions) {
    if (action.kind === 'advance') {
      clickButtonWithText('Continuar')
    } else {
      clickButtonWithText(action.responseText)
    }
    trace.push(fingerprintOfExportedDom())
  }
  return trace
}

/**
 * Mismo proyecto que `buildParityProject`, pero SIN `alternateCondition`/
 * `alternateBody` guardados en el Final — ejercita el default AUTOMÁTICO
 * (petición de usuario: "que siempre salgan esos dos finales... sin tener
 * que activar nada", `defaultAlternateCondition` en
 * `src/domain/nodePacks.ts`) en vez de una condición explícita. Es
 * precisamente el tipo de lógica que ya se desincronizó una vez entre los
 * dos runtimes durante esta misma sesión (se me olvidó replicar en
 * `exportedPlayerScript.ts` el ajuste que sí hice en `nodePacks.ts`) — este
 * test es la protección permanente contra que vuelva a pasar.
 */
function buildParityProjectWithAutomaticDefault(): ProjectDocument {
  const base = buildParityProject()
  return {
    ...base,
    graph: {
      ...base.graph,
      nodes: base.graph.nodes.map((node) =>
        node.id === FINAL_ID && node.type === 'final'
          ? { ...node, alternateCondition: undefined, alternateBody: undefined }
          : node,
      ),
    },
  }
}

describe('paridad runtime React vs. runtime exportado', () => {
  it('camino sin fallos: ambos runtimes llegan al Final con el contenido por defecto', () => {
    const project = buildParityProject()
    const actions: Action[] = [
      { kind: 'advance' }, // Inicio -> diapositiva "de continuar"
      { kind: 'advance' }, // diapositiva "de continuar" -> decisión
      { kind: 'choose', responseText: RESPONSE_OK_TEXT }, // decisión -> Final (sin incrementar Fallos)
    ]

    const reactTrace = traceReactRuntime(project, actions)
    const exportTrace = traceExportedRuntime(project, actions)

    expect(exportTrace).toEqual(reactTrace)
    expect(reactTrace.at(-1)).toEqual({ kind: 'final', marker: 'default' })
  })

  it('camino con fallos: ambos runtimes activan la variante alternativa del Final (bug real ya corregido)', () => {
    const project = buildParityProject()
    const actions: Action[] = [
      { kind: 'advance' },
      { kind: 'advance' },
      { kind: 'choose', responseText: RESPONSE_FAIL_TEXT }, // decisión -> Final (incrementa Fallos)
    ]

    const reactTrace = traceReactRuntime(project, actions)
    const exportTrace = traceExportedRuntime(project, actions)

    expect(exportTrace).toEqual(reactTrace)
    expect(reactTrace.at(-1)).toEqual({ kind: 'final', marker: 'alternate' })
  })

  it('sin alternateCondition guardada (default automático "Fallos"): camino sin fallos, ambos runtimes se quedan en el contenido por defecto', () => {
    const project = buildParityProjectWithAutomaticDefault()
    const actions: Action[] = [
      { kind: 'advance' },
      { kind: 'advance' },
      { kind: 'choose', responseText: RESPONSE_OK_TEXT },
    ]

    const reactTrace = traceReactRuntime(project, actions)
    const exportTrace = traceExportedRuntime(project, actions)

    expect(exportTrace).toEqual(reactTrace)
    expect(reactTrace.at(-1)).toEqual({ kind: 'final', marker: 'default' })
  })

  it('sin alternateCondition guardada (default automático "Fallos"): camino con fallos, ambos runtimes activan la variante alternativa igualmente', () => {
    const project = buildParityProjectWithAutomaticDefault()
    const actions: Action[] = [
      { kind: 'advance' },
      { kind: 'advance' },
      { kind: 'choose', responseText: RESPONSE_FAIL_TEXT },
    ]

    const reactTrace = traceReactRuntime(project, actions)
    const exportTrace = traceExportedRuntime(project, actions)

    expect(exportTrace).toEqual(reactTrace)
    expect(reactTrace.at(-1)).toEqual({ kind: 'final', marker: 'alternate' })
  })
})
