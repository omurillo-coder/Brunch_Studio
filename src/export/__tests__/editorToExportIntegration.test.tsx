import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useHtmlExport } from '../useHtmlExport'
import { AppServicesProvider } from '../../app/AppServicesContext'
import type { AppServices } from '../../app/AppServices'
import { MemoryAssetRepository, MemoryHtmlBundleWriter } from '../../persistence'
import { useProjectStore } from '../../store'
import { resetProjectStore } from '../../store/testHelpers'
import { CICLOS } from '../../domain'
import type { SlideNode } from '../../domain'

/**
 * `useHtmlExport` resuelve los assets de marca de la portada
 * (`resolvePlayerIntroBrandAssets` en `introBrandAssets.ts`) con `fetch()`
 * sobre las URLs que resuelve Vite (sufijo `?url`) — en jsdom no hay ningún
 * servidor real detrás, así que se mockea `fetch` globalmente, mismo
 * criterio que `useScormExport.test.tsx`/`Topbar.test.tsx`.
 */
vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    new Response(new Uint8Array([137, 80, 78, 71]).buffer, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  ),
)

/**
 * Hallazgo de auditoría ("sin ningún test de integración editor → export de
 * punta a punta"): cada capa se prueba aislada (Canvas, Inspector, store,
 * exportadores) con fixtures propios construidos a mano — ningún test
 * simulaba "el usuario edita en la UI → se exporta el documento resultante
 * → se ejecuta el bundle". Este archivo cubre exactamente eso, un único
 * test de humo de principio a fin:
 *
 *  1. Monta el store REAL (`useProjectStore`, no una copia) y lo edita
 *     únicamente a través de sus propias acciones públicas (`createNode`,
 *     `connect`, `addResponse`, `addVariable`...) — las mismas que dispara
 *     la UI real del editor, nunca un `ProjectDocument` construido a mano.
 *  2. Exporta con `useHtmlExport` (el hook real que usa `Topbar`, con
 *     dobles en memoria de `AppServices` en vez del backend Tauri).
 *  3. Ejecuta el HTML resultante DE VERDAD en jsdom (mismo mecanismo
 *     `runExportedBundle` que `htmlBundle.test.ts`) y navega por él como lo
 *     haría quien juega la experiencia.
 *
 * El escenario elige a propósito una característica de enrutado condicional
 * real (el Final "TOP"/"con fallos" automático por la variable "Fallos",
 * ver `defaultAlternateCondition` en `src/domain/nodePacks.ts`) en vez de
 * un recorrido lineal trivial: demuestra que un efecto sobre variable
 * elegido en el Inspector sobrevive intacto el viaje completo hasta decidir
 * qué contenido ve quien juega la experiencia exportada.
 *
 * No sustituye a los tests unitarios de cada capa — es un test de HUMO:
 * confirma que las piezas encajan juntas de verdad, no vuelve a probar cada
 * regla de negocio por separado (esas ya están cubiertas en
 * `htmlBundle.test.ts`, `useHtmlExport.test.tsx`, etc.).
 */

const TEST_FILE_PATH = '/tmp/editor-to-export-integration.brunch'

function renderUseHtmlExport(services: Partial<AppServices> = {}) {
  function wrapper({ children }: { children: ReactNode }) {
    return <AppServicesProvider services={services}>{children}</AppServicesProvider>
  }
  return renderHook(() => useHtmlExport(TEST_FILE_PATH), { wrapper })
}

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

function clickButton(text: string): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>('#brunch-root button')].find(
    (candidate) => stripTrailingArrow(candidate.textContent) === text,
  )
  if (!button) {
    throw new Error(`No existe ningún botón con el texto "${text}".`)
  }
  button.click()
}

/**
 * Construye, a base de acciones reales del store (nunca un `ProjectDocument`
 * hecho a mano), el escenario que ejercitan los dos tests de este archivo:
 * portada completa (ciclo/asignatura/caso) + variable "Fallos" + una
 * diapositiva de decisión con dos respuestas hacia el MISMO Final, una de
 * ellas incrementando "Fallos" — exactamente lo que dispararía el Inspector
 * real al editar cada campo.
 */
function buildScenarioWithRealStoreActions(): void {
  const store = useProjectStore.getState()

  // Captura el id de la diapositiva de inicio ANTES de crear el nodo
  // `intro`: crear un `intro` reasigna `graph.startNodeId` a él (siempre es
  // el punto de partida del recorrido), así que después de este punto
  // `startNodeId` ya no identifica la diapositiva "Bienvenida".
  const startId = useProjectStore.getState().project.graph.startNodeId

  act(() => {
    store.createNode('intro', { x: -300, y: 0 })
  })
  const introId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'intro')?.id
  if (!introId) throw new Error('setup inválido: no se creó el nodo intro')
  const ciclo = CICLOS[0]!
  const asignatura = ciclo.asignaturas[0]!
  act(() => {
    useProjectStore.getState().updateNode(introId, {
      cicloId: ciclo.id,
      asignaturaId: asignatura.id,
      caseName: 'Caso de integración',
    })
    // Crear el `intro` NO lo conecta solo a la diapositiva que hasta ahora
    // era el punto de partida — hay que conectarlo a mano, igual que
    // haría el diseñador arrastrando la conexión en el lienzo.
    useProjectStore.getState().connect(introId, startId)
  })

  // Variable "Fallos": nombre exacto que activa el enrutado automático
  // TOP/con-fallos de un Final sin tocar nada más (ver
  // `defaultAlternateCondition`).
  act(() => {
    store.addVariable({ name: 'Fallos', type: 'number', initialValue: 0 })
  })
  const fallosVar = useProjectStore.getState().project.variables[0]
  if (!fallosVar) throw new Error('setup inválido: no se creó la variable "Fallos"')

  act(() => {
    useProjectStore.getState().updateNode(startId, { title: 'Bienvenida' })
    useProjectStore.getState().addTextBlock(startId)
  })
  const startBlockId = (
    useProjectStore.getState().project.graph.nodes.find((n) => n.id === startId) as SlideNode
  ).content[0]?.id
  if (!startBlockId) throw new Error('setup inválido: no se creó el bloque de texto')
  act(() => {
    useProjectStore.getState().updateTextBlockBody(startId, startBlockId, '¿Qué decides hacer?')
    useProjectStore.getState().addResponse(startId)
    useProjectStore.getState().addResponse(startId)
  })
  const responses = (
    useProjectStore.getState().project.graph.nodes.find((n) => n.id === startId) as SlideNode
  ).responses
  const responseGood = responses[0]
  const responseBad = responses[1]
  if (!responseGood || !responseBad) throw new Error('setup inválido: faltan respuestas')

  act(() => {
    store.createNode('final', { x: 300, y: 0 })
  })
  const finalId = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')?.id
  if (!finalId) throw new Error('setup inválido: no se creó el Final')

  act(() => {
    useProjectStore.getState().updateResponse(startId, responseGood.id, {
      text: 'Prepararse a fondo',
    })
    useProjectStore.getState().updateResponse(startId, responseBad.id, {
      text: 'Improvisar sobre la marcha',
      effects: [{ variableId: fallosVar.id, operation: 'increment', value: 1 }],
    })
    useProjectStore.getState().connect(startId, finalId, responseGood.id)
    useProjectStore.getState().connect(startId, finalId, responseBad.id)
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  resetProjectStore()
})

describe('Editor → export: de punta a punta (hallazgo de auditoría)', () => {
  it('un recorrido montado con acciones reales del store sobrevive intacto a exportar y ejecutar el HTML — la respuesta "con fallos" muestra el Final alternativo', async () => {
    buildScenarioWithRealStoreActions()

    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    const assetRepository = new MemoryAssetRepository()
    const pickExportHtmlPath = async () => '/tmp/experiencia.zip'
    const { result } = renderUseHtmlExport({ htmlBundleWriter, assetRepository, pickExportHtmlPath })

    await act(async () => {
      await result.current.exportHtml()
    })

    expect(result.current.status).toBe('done')
    const html = htmlBundleWriter.read('/tmp/experiencia.zip')
    if (!html) throw new Error('la exportación no escribió ningún HTML')

    runExportedBundle(html)
    clickButton('Continuar') // sale de la portada de marca (intro)

    expect(document.querySelector('#brunch-root')?.textContent).toContain('¿Qué decides hacer?')

    clickButton('Improvisar sobre la marcha')

    expect(document.querySelector('#brunch-root .finalAlternateCard')).not.toBeNull()
    expect(document.querySelector('#brunch-root .finalSuccessCard')).toBeNull()
  })

  it('la misma diapositiva, con la otra respuesta (sin efecto sobre "Fallos"), muestra el Final TOP', async () => {
    buildScenarioWithRealStoreActions()

    const htmlBundleWriter = new MemoryHtmlBundleWriter()
    const { result } = renderUseHtmlExport({
      htmlBundleWriter,
      assetRepository: new MemoryAssetRepository(),
      pickExportHtmlPath: async () => '/tmp/experiencia.zip',
    })

    await act(async () => {
      await result.current.exportHtml()
    })

    const html = htmlBundleWriter.read('/tmp/experiencia.zip')
    if (!html) throw new Error('la exportación no escribió ningún HTML')

    runExportedBundle(html)
    clickButton('Continuar')
    clickButton('Prepararse a fondo')

    expect(document.querySelector('#brunch-root .finalSuccessCard')).not.toBeNull()
    expect(document.querySelector('#brunch-root .finalAlternateCard')).toBeNull()
    // Petición de usuario ("ponlo siempre en el TOP"): el confeti solo en
    // el Final TOP, nunca en el alternativo — otra pieza real que debe
    // sobrevivir el viaje completo.
    expect(document.querySelector('#brunch-root .confetti')).not.toBeNull()
  })
})
