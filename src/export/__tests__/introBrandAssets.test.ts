import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  projectNeedsFinalAlternateAssets,
  projectNeedsGameOverAssets,
  resolvePlayerIntroBrandAssets,
} from '../introBrandAssets'
import { createProject, createNode, updateNode } from '../../domain/project'
import { connect } from '../../domain/graph'
import { addGameOverPack } from '../../domain/nodePacks'
import { serializeRichBody } from '../../editor/richText/richTextContent'

/**
 * Corrección de revisión de código: `resolvePlayerIntroBrandAssets` resolvía
 * SIEMPRE la ilustración de "Game Over", en cualquier exportación, aunque el
 * proyecto no usara el pack — un fallo de red al descargarla rompía la
 * exportación de proyectos sin ninguna relación con esa pantalla. Ahora la
 * resolución de cada asset OPCIONAL está condicionada a `needs.gameOver`/
 * `needs.finalAlternate` (petición de usuario: pantalla "con fallos" del
 * Final, mismo criterio aplicado a su propio asset). Estos tests cubren
 * ambas piezas — sin ellos, un fallo al mantener esa condición pasaría
 * desapercibido en CI (ver comentario de la revisión: "no test asserts
 * gameOverBackgroundDataUri reaches the exported HTML").
 */

function stubFetch() {
  const fetchMock = vi.fn(async () =>
    new Response(new Uint8Array([137, 80, 78, 71]).buffer, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function richParagraph(text: string): string {
  return serializeRichBody({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })
}

describe('projectNeedsGameOverAssets', () => {
  it('false para un proyecto sin ninguna diapositiva brandedGameOverScreen', () => {
    const project = createProject('P')
    expect(projectNeedsGameOverAssets(project)).toBe(false)
  })

  it('true para un proyecto con el pack "+1 fallo con Game Over"', () => {
    const project = addGameOverPack(createProject('P'), { x: 0, y: 0 })
    expect(projectNeedsGameOverAssets(project)).toBe(true)
  })
})

describe('projectNeedsFinalAlternateAssets', () => {
  it('false para un proyecto sin ningún Final con contenido alternativo', () => {
    const project = createProject('P')
    expect(projectNeedsFinalAlternateAssets(project)).toBe(false)
  })

  it('false si el Final tiene alternateCondition pero alternateBody vacío', () => {
    let project = createProject('P')
    project = createNode(project, 'final', { x: 200, y: 0 })
    const finalId = project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')
    project = connect(project, project.graph.startNodeId, finalId)
    project = updateNode(project, finalId, {
      alternateCondition: { variableId: 'x', operator: '>', value: 0 },
      alternateBody: '',
    })
    expect(projectNeedsFinalAlternateAssets(project)).toBe(false)
  })

  it('true si el Final tiene alternateCondition y alternateBody con contenido', () => {
    let project = createProject('P')
    project = createNode(project, 'final', { x: 200, y: 0 })
    const finalId = project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')
    project = connect(project, project.graph.startNodeId, finalId)
    project = updateNode(project, finalId, {
      alternateCondition: { variableId: 'x', operator: '>', value: 0 },
      alternateBody: richParagraph('Con fallos'),
    })
    expect(projectNeedsFinalAlternateAssets(project)).toBe(true)
  })
})

describe('resolvePlayerIntroBrandAssets', () => {
  it('needs={false,false}: NO resuelve ninguna ilustración opcional (quedan undefined) y no las pide por fetch', async () => {
    const fetchMock = stubFetch()

    const assets = await resolvePlayerIntroBrandAssets({ gameOver: false, finalAlternate: false })

    expect(assets.gameOverBackgroundDataUri).toBeUndefined()
    expect(assets.finalAlternateBackgroundDataUri).toBeUndefined()
    expect(assets.logoDataUri).toMatch(/^data:image\/png;base64,/)
    expect(assets.backgroundDataUri).toMatch(/^data:image\/jpeg;base64,/)
    // Los 4 assets que SIEMPRE hacen falta (logo, fondo, 2 tipografías) —
    // ni uno más: ninguna ilustración opcional debe generar una petición de
    // red de más cuando no se necesita.
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('needs.gameOver=true: SÍ resuelve la ilustración de Game Over como data: URI (y solo esa)', async () => {
    const fetchMock = stubFetch()

    const assets = await resolvePlayerIntroBrandAssets({ gameOver: true, finalAlternate: false })

    expect(assets.gameOverBackgroundDataUri).toMatch(/^data:image\/jpeg;base64,/)
    expect(assets.finalAlternateBackgroundDataUri).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('needs.finalAlternate=true: SÍ resuelve la ilustración del Final "con fallos" como data: URI (y solo esa)', async () => {
    const fetchMock = stubFetch()

    const assets = await resolvePlayerIntroBrandAssets({ gameOver: false, finalAlternate: true })

    expect(assets.finalAlternateBackgroundDataUri).toMatch(/^data:image\/jpeg;base64,/)
    expect(assets.gameOverBackgroundDataUri).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('needs={true,true}: resuelve las DOS ilustraciones opcionales', async () => {
    const fetchMock = stubFetch()

    const assets = await resolvePlayerIntroBrandAssets({ gameOver: true, finalAlternate: true })

    expect(assets.gameOverBackgroundDataUri).toMatch(/^data:image\/jpeg;base64,/)
    expect(assets.finalAlternateBackgroundDataUri).toMatch(/^data:image\/jpeg;base64,/)
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })
})
