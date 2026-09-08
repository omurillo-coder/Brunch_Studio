import { describe, expect, it } from 'vitest'
import {
  addAudioBlock,
  addImageBlock,
  addResponse,
  addTextBlock,
  addVideoBlock,
  asignaturaWorkspaceName,
  CICLOS,
  connect,
  createNode,
  createProject,
  disconnect,
  updateNode,
  updateTextBlockBody,
} from '../../../domain'
import type { ProjectDocument } from '../../../domain'
import { serializeRichBody } from '../../richText/richTextContent'
import { resolveConnection, toFlowEdges, toFlowNodes } from '../adapter'
import type { FlowEdgeCache, FlowNodeCache } from '../adapter'
import { BRUNCH_EDGE_TYPE } from '../edges/edgeTypes'
import { IN_HANDLE_ID, OUT_HANDLE_ID, responseHandleId } from '../handles'

function otherNodeIdOf(project: ProjectDocument, type: 'slide' | 'final'): string {
  const id = project.graph.nodes.find(
    (n) => n.type === type && n.id !== project.graph.startNodeId,
  )?.id
  if (!id) throw new Error(`No hay nodo "${type}" distinto del inicio en el setup`)
  return id
}

/** Id del nodo `intro` del proyecto — a diferencia de `otherNodeIdOf`, un
 *  `intro` SIEMPRE es `graph.startNodeId` cuando existe (ver
 *  `IntroNodeSchema`), así que se busca directamente por tipo. */
function introNodeId(project: ProjectDocument): string {
  const id = project.graph.nodes.find((n) => n.type === 'intro')?.id
  if (!id) throw new Error('No hay nodo "intro" en el setup')
  return id
}

function firstResponseId(project: ProjectDocument, nodeId: string): string {
  const node = project.graph.nodes.find((n) => n.id === nodeId)
  const id = node?.type === 'slide' ? node.responses[0]?.id : undefined
  if (!id) throw new Error('setup inválido')
  return id
}

/** Ids, en orden, de todos los bloques de `content` de una diapositiva. */
function blockIds(project: ProjectDocument, nodeId: string): string[] {
  const node = project.graph.nodes.find((n) => n.id === nodeId)
  return node?.type === 'slide' ? node.content.map((block) => block.id) : []
}

/** Id del primer bloque de `content` de una diapositiva — el bloque de
 *  texto inicial que siembra `createNode`/`createProject`. */
function firstBlockId(project: ProjectDocument, nodeId: string): string {
  const id = blockIds(project, nodeId)[0]
  if (!id) throw new Error('setup inválido')
  return id
}

describe('toFlowNodes', () => {
  it('mapea tipo, número y título de cada nodo de dominio', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 10, y: 20 }, { title: 'Diapositiva 1' })
    const startId = project.graph.startNodeId
    const slideId = otherNodeIdOf(project, 'slide')

    const flowNodes = toFlowNodes(project, [])

    expect(flowNodes.find((n) => n.id === startId)).toMatchObject({
      id: startId,
      type: 'slide',
      position: { x: 0, y: 0 },
      selected: false,
      data: { nodeType: 'slide', number: 1, title: '', isStart: true },
    })
    expect(flowNodes.find((n) => n.id === slideId)).toMatchObject({
      id: slideId,
      type: 'slide',
      position: { x: 10, y: 20 },
      selected: false,
      data: { nodeType: 'slide', number: 2, title: 'Diapositiva 1', isStart: false },
    })
  })

  it('marca `isStart: true` solo para la diapositiva de graph.startNodeId', () => {
    const project = createNode(createProject('P'), 'slide', { x: 0, y: 0 })
    const flowNodes = toFlowNodes(project, [])

    const starts = flowNodes.filter((n) => n.data.isStart)
    expect(starts).toHaveLength(1)
    expect(starts[0]?.id).toBe(project.graph.startNodeId)
  })

  it('marca `selected: true` solo para los ids indicados', () => {
    const project = createNode(createProject('P'), 'slide', { x: 0, y: 0 })
    const startId = project.graph.startNodeId
    const slideId = otherNodeIdOf(project, 'slide')

    const flowNodes = toFlowNodes(project, [slideId])

    expect(flowNodes.find((n) => n.id === startId)?.selected).toBe(false)
    expect(flowNodes.find((n) => n.id === slideId)?.selected).toBe(true)
  })

  it('una diapositiva sin respuestas lleva `responses` vacío', () => {
    const project = createProject('P')
    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes[0]?.data.responses).toEqual([])
  })

  it('incluye el resumen de respuestas (id y texto, sin letra) en orden de letra', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = addResponse(project, startId) // A
    project = addResponse(project, startId) // B

    const flowNodes = toFlowNodes(project, [])
    const summaries = flowNodes.find((n) => n.id === startId)?.data.responses

    expect(summaries).toHaveLength(2)
    // El resumen no transporta la letra: el lienzo pinta un punto, no letras.
    for (const summary of summaries ?? []) {
      expect(Object.keys(summary).sort()).toEqual(['id', 'text'])
    }
  })

  it('un nodo final no lleva campo `responses`', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === finalId)?.data.responses).toBeUndefined()
  })
})

describe('toFlowNodes — hasNoOutgoing (punto 1: destacar nodos sin salida)', () => {
  it('una diapositiva "de continuar" sin destino se marca hasNoOutgoing', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId
    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === startId)?.data.hasNoOutgoing).toBe(true)
  })

  it('una diapositiva "de continuar" con destino NO se marca', () => {
    let project = createNode(createProject('P'), 'slide', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const slideId = otherNodeIdOf(project, 'slide')
    project = connect(project, startId, slideId)

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === startId)?.data.hasNoOutgoing).toBe(false)
  })

  it('una diapositiva "de decisión" sin ninguna respuesta con destino se marca hasNoOutgoing', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    project = addResponse(project, startId)

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === startId)?.data.hasNoOutgoing).toBe(true)
  })

  it('una diapositiva "de decisión" con TODAS sus respuestas sin destino se marca hasNoOutgoing', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    project = addResponse(project, startId)
    // Ninguna de las dos respuestas se conecta.

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === startId)?.data.hasNoOutgoing).toBe(true)
  })

  it('una diapositiva "de decisión" con AL MENOS una respuesta conectada no se marca', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = addResponse(project, startId)
    project = addResponse(project, startId)
    const responseId = firstResponseId(project, startId)
    project = connect(project, startId, finalId, responseId)

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === startId)?.data.hasNoOutgoing).toBe(false)
  })

  it('desconectar la única respuesta conectada vuelve a marcar hasNoOutgoing', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = addResponse(project, startId)
    const responseId = firstResponseId(project, startId)
    project = connect(project, startId, finalId, responseId)
    project = disconnect(project, startId, responseId)

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === startId)?.data.hasNoOutgoing).toBe(true)
  })

  it('un nodo `final` nunca se marca hasNoOutgoing, aunque no tenga ninguna salida', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === finalId)?.data.hasNoOutgoing).toBe(false)
  })
})

describe('toFlowNodes — resaltado por selección (punto 4)', () => {
  it('sin selección, ningún nodo se marca isHighlighted ni isDimmed', () => {
    let project = createNode(createProject('P'), 'slide', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const slideId = otherNodeIdOf(project, 'slide')
    project = connect(project, startId, slideId)

    const flowNodes = toFlowNodes(project, [])
    for (const node of flowNodes) {
      expect(node.data.isHighlighted).toBe(false)
      expect(node.data.isDimmed).toBe(false)
    }
  })

  it('al seleccionar un nodo, su destino se marca isHighlighted y el resto isDimmed', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    project = createNode(project, 'slide', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    const unrelatedSlideId = project.graph.nodes.find(
      (n) => n.type === 'slide' && n.id !== startId,
    )?.id
    if (!unrelatedSlideId) throw new Error('setup inválido')
    project = connect(project, startId, finalId)

    const flowNodes = toFlowNodes(project, [startId])

    const start = flowNodes.find((n) => n.id === startId)
    const final = flowNodes.find((n) => n.id === finalId)
    const unrelated = flowNodes.find((n) => n.id === unrelatedSlideId)

    // El propio nodo seleccionado: ni resaltado (ya lo marca `selected`) ni
    // atenuado.
    expect(start?.selected).toBe(true)
    expect(start?.data.isHighlighted).toBe(false)
    expect(start?.data.isDimmed).toBe(false)

    // Su destino: resaltado, no atenuado.
    expect(final?.data.isHighlighted).toBe(true)
    expect(final?.data.isDimmed).toBe(false)

    // Nodo no relacionado: atenuado, no resaltado.
    expect(unrelated?.data.isHighlighted).toBe(false)
    expect(unrelated?.data.isDimmed).toBe(true)
  })
})

describe('toFlowNodes — internalNote (tarea 6) y bodyPreview (tarea 8)', () => {
  it('internalNote es undefined cuando el nodo no tiene ninguna', () => {
    const project = createProject('P')
    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes[0]?.data.internalNote).toBeUndefined()
  })

  it('internalNote lleva el texto recortado cuando el nodo tiene una nota con contenido', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = updateNode(project, startId, { internalNote: '  Pedir gráfico  ' })

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes[0]?.data.internalNote).toBe('Pedir gráfico')
  })

  it('internalNote es undefined cuando la nota es solo espacios en blanco', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = updateNode(project, startId, { internalNote: '   ' })

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes[0]?.data.internalNote).toBeUndefined()
  })

  it('bodyPreview es undefined cuando el nodo no tiene contenido', () => {
    const project = createProject('P')
    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes[0]?.data.bodyPreview).toBeUndefined()
  })

  it('bodyPreview extrae el texto plano del body (Tiptap) de una diapositiva, no el JSON en crudo', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    const body = serializeRichBody({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bienvenido al escenario' }] }],
    })
    project = updateTextBlockBody(project, startId, firstBlockId(project, startId), body)

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes[0]?.data.bodyPreview).toBe('Bienvenido al escenario')
    expect(flowNodes[0]?.data.bodyPreview).not.toMatch(/[{}]/)
  })

  it('bodyPreview concatena, en orden, el texto plano de TODOS los bloques de texto de una diapositiva', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    const firstBody = serializeRichBody({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Primer bloque' }] }],
    })
    project = updateTextBlockBody(project, startId, firstBlockId(project, startId), firstBody)
    // Un bloque de imagen intermedio: no aporta texto, no debe romper la
    // concatenación de los bloques de texto que lo rodean.
    project = addImageBlock(project, startId, crypto.randomUUID())
    project = addTextBlock(project, startId)
    const secondTextBlockId = blockIds(project, startId).at(-1)
    if (!secondTextBlockId) throw new Error('setup inválido')
    const secondBody = serializeRichBody({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'segundo bloque' }] }],
    })
    project = updateTextBlockBody(project, startId, secondTextBlockId, secondBody)

    const flowNodes = toFlowNodes(project, [])
    // Los dos bloques de texto se concatenan con un espacio, en el orden
    // del array `content` (el bloque de imagen intermedio se salta).
    expect(flowNodes[0]?.data.bodyPreview).toBe('Primer bloque segundo bloque')
  })

  it('bodyPreview se trunca con "…" cuando el texto supera el máximo', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    const longText = 'x'.repeat(200)
    const body = serializeRichBody({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: longText }] }],
    })
    project = updateTextBlockBody(project, startId, firstBlockId(project, startId), body)

    const flowNodes = toFlowNodes(project, [])
    const preview = flowNodes[0]?.data.bodyPreview
    expect(preview?.endsWith('…')).toBe(true)
    expect(preview?.length).toBeLessThan(longText.length)
  })

  it('bodyPreview de un Final sigue usando su único body (sin content)', () => {
    let project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    const body = serializeRichBody({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fin del recorrido' }] }],
    })
    project = updateNode(project, finalId, { body })

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === finalId)?.data.bodyPreview).toBe('Fin del recorrido')
  })
})

describe('toFlowNodes — previewImageAssetId/hasAudioContent/hasVideoContent (rediseño minimalista, "que se vea bastante lo que hay dentro")', () => {
  it('previewImageAssetId es undefined si la diapositiva no tiene ningún bloque de imagen', () => {
    const project = createProject('P')
    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes[0]?.data.previewImageAssetId).toBeUndefined()
  })

  it('previewImageAssetId toma el assetId del primer bloque de imagen CON assetId', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    const assetId = crypto.randomUUID()
    project = addImageBlock(project, startId, assetId)

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes[0]?.data.previewImageAssetId).toBe(assetId)
  })

  it('un bloque de imagen "pendiente de subir" (sin assetId) se salta — sigue buscando en los siguientes', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    const realAssetId = crypto.randomUUID()
    // Bloque pendiente primero (sin assetId, ver `addImageBlock`), luego uno
    // con material real: el pendiente no debe "ganar" con un `undefined`.
    project = addImageBlock(project, startId)
    project = addImageBlock(project, startId, realAssetId)

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes[0]?.data.previewImageAssetId).toBe(realAssetId)
  })

  it('previewImageAssetId sigue undefined si TODOS los bloques de imagen están pendientes de subir', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = addImageBlock(project, startId)

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes[0]?.data.previewImageAssetId).toBeUndefined()
  })

  it('hasAudioContent/hasVideoContent reflejan si `content` tiene algún bloque de ese tipo', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = addAudioBlock(project, startId, crypto.randomUUID())

    let flowNodes = toFlowNodes(project, [])
    expect(flowNodes[0]?.data.hasAudioContent).toBe(true)
    // `.some()` sobre `content` (ver `toNodeData`) siempre devuelve un
    // booleano real, nunca `undefined`, para una `slide` — a diferencia de
    // `previewImageAssetId` (un `string | undefined`, sin "false" posible).
    expect(flowNodes[0]?.data.hasVideoContent).toBe(false)

    project = addVideoBlock(project, startId, crypto.randomUUID())
    flowNodes = toFlowNodes(project, [])
    expect(flowNodes[0]?.data.hasAudioContent).toBe(true)
    expect(flowNodes[0]?.data.hasVideoContent).toBe(true)
  })

  it('un `final` (sin `content`) nunca lleva estos tres campos', () => {
    let project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')

    const flowNodes = toFlowNodes(project, [])
    const finalData = flowNodes.find((n) => n.id === finalId)?.data
    expect(finalData?.previewImageAssetId).toBeUndefined()
    expect(finalData?.hasAudioContent).toBeUndefined()
    expect(finalData?.hasVideoContent).toBeUndefined()
  })
})

describe('toFlowNodes — nodo `intro` (milestone "Diapositiva de Inicio", Tarea 4)', () => {
  it('no lanza con un nodo `intro` recién creado (sin cicloId/asignaturaId/caseName)', () => {
    const project = createNode(createProject('P'), 'intro', { x: -260, y: 0 })
    expect(() => toFlowNodes(project, [])).not.toThrow()
  })

  it('un `intro` incompleto muestra un aviso sutil de "pendiente de completar", nunca un id crudo', () => {
    const project = createNode(createProject('P'), 'intro', { x: -260, y: 0 })
    const introId = introNodeId(project)

    const flowNodes = toFlowNodes(project, [])
    const preview = flowNodes.find((n) => n.id === introId)?.data.bodyPreview
    expect(preview).toBe('(pendiente de completar)')
  })

  it('un `intro` completo resuelve ciclo/asignatura a sus NOMBRES legibles (espacio de trabajo: ciclo con prefijo, asignatura con su código de módulo), nunca al id crudo del ciclo', () => {
    const ciclo = CICLOS[0]
    const asignatura = ciclo?.asignaturas[0]
    if (!ciclo || !asignatura) throw new Error('El catálogo de prueba está vacío')

    let project = createNode(createProject('P'), 'intro', { x: -260, y: 0 })
    const introId = introNodeId(project)
    project = updateNode(project, introId, {
      cicloId: ciclo.id,
      asignaturaId: asignatura.id,
      caseName: 'Simulación de urgencias',
    })

    const flowNodes = toFlowNodes(project, [])
    const preview = flowNodes.find((n) => n.id === introId)?.data.bodyPreview
    // Resumen de ESPACIO DE TRABAJO (tarjeta del canvas): el ciclo conserva
    // su prefijo interno tal cual (`ciclo.name`, sin recortar) y la
    // asignatura lleva su código de módulo entre paréntesis
    // (`asignaturaWorkspaceName`, el propio `asignatura.id`) — al contrario
    // que en la salida exportada, que sí recorta el prefijo del ciclo y
    // nunca añade el código. Ver `cicloOutputName`/`asignaturaWorkspaceName`
    // en `src/domain/catalog.ts`.
    expect(preview).toBe(
      `${ciclo.name} · ${asignaturaWorkspaceName(asignatura)} — Simulación de urgencias`,
    )
    expect(preview).not.toContain(ciclo.id)
  })

  it('un `intro` sin targetNodeId se marca hasNoOutgoing, igual que una diapositiva "de continuar" sin destino', () => {
    const project = createNode(createProject('P'), 'intro', { x: -260, y: 0 })
    const introId = introNodeId(project)

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === introId)?.data.hasNoOutgoing).toBe(true)
  })

  it('un `intro` CON targetNodeId no se marca hasNoOutgoing', () => {
    let project = createNode(createProject('P'), 'intro', { x: -260, y: 0 })
    const introId = introNodeId(project)
    // El `intro` desplaza `startNodeId`; el destino es la `SlideNode` que
    // antes era el inicio.
    const slideId = project.graph.nodes.find((n) => n.type === 'slide')?.id
    if (!slideId) throw new Error('setup inválido')
    project = connect(project, introId, slideId)

    const flowNodes = toFlowNodes(project, [])
    expect(flowNodes.find((n) => n.id === introId)?.data.hasNoOutgoing).toBe(false)
  })
})

describe('toFlowEdges', () => {
  it('la arista de "continuar" usa el handle de salida único (OUT_HANDLE_ID) y de entrada (IN_HANDLE_ID)', () => {
    let project = createNode(createProject('P'), 'slide', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const slideId = otherNodeIdOf(project, 'slide')
    project = connect(project, startId, slideId)

    expect(toFlowEdges(project)).toEqual([
      {
        id: `${startId}->${slideId}`,
        source: startId,
        target: slideId,
        sourceHandle: OUT_HANDLE_ID,
        targetHandle: IN_HANDLE_ID,
        type: BRUNCH_EDGE_TYPE,
        data: { laneIndex: 0, laneSize: 1, isHighlighted: false, isDimmed: false, isElse: false },
      },
    ])
  })

  it('la arista de una respuesta usa response:<id> como sourceHandle y NO lleva label', () => {
    let project = createNode(createProject('P'), 'final', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = addResponse(project, startId)
    const responseId = firstResponseId(project, startId)

    project = connect(project, startId, finalId, responseId)

    expect(toFlowEdges(project)).toEqual([
      {
        id: `${startId}:${responseId}->${finalId}`,
        source: startId,
        target: finalId,
        sourceHandle: responseHandleId(responseId),
        targetHandle: IN_HANDLE_ID,
        type: BRUNCH_EDGE_TYPE,
        data: { laneIndex: 0, laneSize: 1, isHighlighted: false, isDimmed: false, isElse: false },
      },
    ])
  })

  it('no genera arista para una respuesta sin destino', () => {
    const base = createProject('P')
    const project = addResponse(base, base.graph.startNodeId)
    expect(toFlowEdges(project)).toEqual([])
  })

  it('la arista "si no" (fase 2, Variables/condiciones) lleva data.isElse: true', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    project = createNode(project, 'final', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const [finalSi, finalNo] = project.graph.nodes.filter((n) => n.type === 'final')
    if (!finalSi || !finalNo) throw new Error('setup inválido')

    project = connect(project, startId, finalSi.id)
    project = updateNode(project, startId, {
      condition: { variableId: crypto.randomUUID(), operator: '==', value: true },
      elseTargetNodeId: finalNo.id,
    })

    const edges = toFlowEdges(project)
    const elseEdge = edges.find((edge) => edge.target === finalNo.id)
    const normalEdge = edges.find((edge) => edge.target === finalSi.id)
    expect(elseEdge?.data).toMatchObject({ isElse: true })
    expect(normalEdge?.data).toMatchObject({ isElse: false })
  })
})

describe('toFlowEdges — carriles de aristas paralelas/convergentes (punto 3)', () => {
  it('una arista sola (sin nada con lo que solaparse) lleva laneIndex 0 y laneSize 1', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = connect(project, startId, finalId)

    const [edge] = toFlowEdges(project)
    expect(edge?.data).toMatchObject({ laneIndex: 0, laneSize: 1 })
  })

  it('varias respuestas de una misma diapositiva hacia el MISMO destino reciben laneIndex distintos', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = addResponse(project, startId)
    project = addResponse(project, startId)
    const [responseA, responseB] = (() => {
      const node = project.graph.nodes.find((n) => n.id === startId)
      return node?.type === 'slide' ? node.responses.map((r) => r.id) : []
    })()
    if (!responseA || !responseB) throw new Error('setup inválido')
    project = connect(project, startId, finalId, responseA)
    project = connect(project, startId, finalId, responseB)

    const edges = toFlowEdges(project)
    expect(edges).toHaveLength(2)
    const laneIndexes = edges.map((e) => e.data?.laneIndex).sort()
    expect(laneIndexes).toEqual([0, 1])
    for (const edge of edges) {
      expect(edge.data?.laneSize).toBe(2)
    }
    // Las dos aristas deben tener laneIndex DISTINTO entre sí.
    expect(edges[0]?.data?.laneIndex).not.toBe(edges[1]?.data?.laneIndex)
  })

  it('varias diapositivas distintas convergiendo en el MISMO destino reciben laneIndex distintos', () => {
    let project = createNode(createProject('P'), 'final', { x: 200, y: 0 })
    project = createNode(project, 'slide', { x: 100, y: 100 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    const otherSlideId = project.graph.nodes.find(
      (n) => n.type === 'slide' && n.id !== startId,
    )?.id
    if (!otherSlideId) throw new Error('setup inválido')

    project = connect(project, startId, finalId)
    project = connect(project, otherSlideId, finalId)

    const edges = toFlowEdges(project)
    expect(edges).toHaveLength(2)
    expect(edges.every((e) => e.data?.laneSize === 2)).toBe(true)
    expect(edges[0]?.data?.laneIndex).not.toBe(edges[1]?.data?.laneIndex)
  })

  it('aristas hacia destinos DISTINTOS no comparten carril (laneSize 1 cada una)', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    project = createNode(project, 'final', { x: 100, y: 100 })
    const startId = project.graph.startNodeId
    const finals = project.graph.nodes.filter((n) => n.type === 'final').map((n) => n.id)
    project = addResponse(project, startId)
    project = addResponse(project, startId)
    const [responseA, responseB] = (() => {
      const node = project.graph.nodes.find((n) => n.id === startId)
      return node?.type === 'slide' ? node.responses.map((r) => r.id) : []
    })()
    if (!responseA || !responseB) throw new Error('setup inválido')
    project = connect(project, startId, finals[0]!, responseA)
    project = connect(project, startId, finals[1]!, responseB)

    const edges = toFlowEdges(project)
    for (const edge of edges) {
      expect(edge.data).toMatchObject({ laneIndex: 0, laneSize: 1 })
    }
  })

  it('el carril asignado es estable entre llamadas sucesivas (mismo project → mismo resultado)', () => {
    let project = createNode(createProject('P'), 'final', { x: 200, y: 0 })
    project = createNode(project, 'slide', { x: 100, y: 100 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    const otherSlideId = project.graph.nodes.find(
      (n) => n.type === 'slide' && n.id !== startId,
    )?.id
    if (!otherSlideId) throw new Error('setup inválido')
    project = connect(project, startId, finalId)
    project = connect(project, otherSlideId, finalId)

    const first = toFlowEdges(project)
    const second = toFlowEdges(project)
    expect(first.map((e) => [e.id, e.data?.laneIndex])).toEqual(
      second.map((e) => [e.id, e.data?.laneIndex]),
    )
  })
})

describe('toFlowEdges — resaltado por selección (punto 4)', () => {
  it('sin selección, ninguna arista se marca isHighlighted ni isDimmed', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = connect(project, startId, finalId)

    const [edge] = toFlowEdges(project, [])
    expect(edge?.data).toMatchObject({ isHighlighted: false, isDimmed: false })
  })

  it('una arista saliente del nodo seleccionado se marca isHighlighted, no isDimmed', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = connect(project, startId, finalId)

    const [edge] = toFlowEdges(project, [startId])
    expect(edge?.data).toMatchObject({ isHighlighted: true, isDimmed: false })
  })

  it('una arista que NO sale del nodo seleccionado se marca isDimmed, no isHighlighted', () => {
    let project = createNode(createProject('P'), 'final', { x: 100, y: 0 })
    project = createNode(project, 'slide', { x: 100, y: 100 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    const otherSlideId = project.graph.nodes.find(
      (n) => n.type === 'slide' && n.id !== startId,
    )?.id
    if (!otherSlideId) throw new Error('setup inválido')
    project = connect(project, otherSlideId, finalId)

    const [edge] = toFlowEdges(project, [startId])
    expect(edge?.data).toMatchObject({ isHighlighted: false, isDimmed: true })
  })
})

describe('resolveConnection', () => {
  it('deriva responseId cuando sourceHandle tiene el prefijo response:', () => {
    const resolved = resolveConnection({
      source: 'node-a',
      target: 'node-b',
      sourceHandle: responseHandleId('resp-1'),
    })

    expect(resolved).toEqual({
      sourceNodeId: 'node-a',
      targetNodeId: 'node-b',
      responseId: 'resp-1',
    })
  })

  it('no lleva responseId cuando sourceHandle es el handle de salida único', () => {
    const resolved = resolveConnection({
      source: 'node-a',
      target: 'node-b',
      sourceHandle: OUT_HANDLE_ID,
    })

    expect(resolved).toEqual({
      sourceNodeId: 'node-a',
      targetNodeId: 'node-b',
      responseId: undefined,
    })
  })

  it('devuelve null si falta source o target', () => {
    expect(resolveConnection({ source: null, target: 'node-b', sourceHandle: null })).toBeNull()
    expect(resolveConnection({ source: 'node-a', target: null, sourceHandle: null })).toBeNull()
  })
})

/**
 * `FlowNodeCache`/`FlowEdgeCache` (corrección de bug real: "clic en una
 * arista/nodo y luego en otro nodo deja la pantalla en gris" — ver
 * comentario de `Canvas.tsx`). Sin esta caché, `toFlowNodes`/`toFlowEdges`
 * construían un objeto NUEVO para cada nodo/arista en CADA llamada, aunque
 * la mayoría no hubiera cambiado de verdad; en un proyecto real de 35 nodos
 * eso disparaba una remedición en cadena en `@xyflow/react` que terminaba en
 * "Maximum update depth exceeded" — sin `ErrorBoundary`, eso se lleva por
 * delante TODA la app. Estos tests verifican la propiedad que evita ese
 * bucle (identidad estable cuando nada cambió de verdad) directamente sobre
 * el adaptador, sin necesidad de montar `@xyflow/react` ni el lienzo entero.
 */
describe('toFlowNodes — FlowNodeCache (estabilidad de identidad)', () => {
  it('con la misma caché y los mismos insumos, devuelve el MISMO objeto CanvasFlowNode entre dos llamadas', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 200, y: 0 })
    const cache: FlowNodeCache = new Map()

    const first = toFlowNodes(project, [], cache)
    const second = toFlowNodes(project, [], cache)

    expect(first).toHaveLength(2)
    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
  })

  it('al mover la selección de un nodo a otro, crea objetos NUEVOS solo para los dos afectados — un tercero sin relación conserva su referencia', () => {
    // Con 3 nodos (ninguno conectado entre sí) y la selección moviéndose de
    // A a B, el tercero (C) tiene los MISMOS insumos en ambas llamadas
    // (`hasSelection` es `true` en las dos, y C nunca está ni seleccionado
    // ni resaltado) — es el caso real que motivó esta caché: mover la
    // selección de un nodo a otro en un proyecto de 35 nodos no debería
    // tocar los otros 33.
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 200, y: 0 })
    project = createNode(project, 'slide', { x: 400, y: 0 })
    const [nodeA, nodeB, nodeC] = project.graph.nodes.map((n) => n.id)
    if (!nodeA || !nodeB || !nodeC) throw new Error('setup inválido')
    const cache: FlowNodeCache = new Map()

    const withASelected = toFlowNodes(project, [nodeA], cache)
    const withBSelected = toFlowNodes(project, [nodeB], cache)

    const cBefore = withASelected.find((n) => n.id === nodeC)
    const cAfter = withBSelected.find((n) => n.id === nodeC)
    const aAfter = withBSelected.find((n) => n.id === nodeA)
    const bAfter = withBSelected.find((n) => n.id === nodeB)

    expect(cAfter).toBe(cBefore)
    expect(aAfter?.selected).toBe(false)
    expect(bAfter?.selected).toBe(true)
  })

  it('regresión del bug real: isSelected cambia de false a true SIN que isHighlighted/isDimmed cambien (nodos sin arista entre sí) — el objeto igualmente se actualiza', () => {
    // Reproduce EXACTAMENTE la condición que se coló en la primera versión
    // de esta caché: sin selección previa, un nodo sin relación de arista
    // con nadie tiene isHighlighted=false/isDimmed=false; al seleccionarlo,
    // isHighlighted/isDimmed SIGUEN siendo false/false (nunca llegan a
    // "true" en ningún punto intermedio) — si la caché solo comparara esos
    // dos campos (como hacía una versión intermedia de este arreglo),
    // reutilizaría por error el objeto viejo con `selected: false`.
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 200, y: 0 })
    const otherId = otherNodeIdOf(project, 'slide')
    const cache: FlowNodeCache = new Map()

    const before = toFlowNodes(project, [], cache)
    const beforeOther = before.find((n) => n.id === otherId)
    expect(beforeOther?.data.isHighlighted).toBe(false)
    expect(beforeOther?.data.isDimmed).toBe(false)
    expect(beforeOther?.selected).toBe(false)

    const after = toFlowNodes(project, [otherId], cache)
    const afterOther = after.find((n) => n.id === otherId)
    // isHighlighted/isDimmed sin cambios (siguen false/false)...
    expect(afterOther?.data.isHighlighted).toBe(false)
    expect(afterOther?.data.isDimmed).toBe(false)
    // ...pero `selected` SÍ cambió, y la caché no puede haberlo perdido.
    expect(afterOther?.selected).toBe(true)
  })

  it('poda de la caché: un nodo borrado no se queda acumulado indefinidamente', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 200, y: 0 })
    const otherId = otherNodeIdOf(project, 'slide')
    const cache: FlowNodeCache = new Map()

    toFlowNodes(project, [], cache)
    expect(cache.has(otherId)).toBe(true)

    const startId = project.graph.startNodeId
    const withoutOther = {
      ...project,
      graph: { ...project.graph, nodes: project.graph.nodes.filter((n) => n.id === startId) },
    }
    toFlowNodes(withoutOther, [], cache)

    expect(cache.has(otherId)).toBe(false)
  })
})

describe('toFlowEdges — FlowEdgeCache (estabilidad de identidad)', () => {
  it('con la misma caché y los mismos insumos, devuelve el MISMO objeto CanvasFlowEdge entre dos llamadas', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const otherId = otherNodeIdOf(project, 'slide')
    project = connect(project, startId, otherId)
    const cache: FlowEdgeCache = new Map()

    const first = toFlowEdges(project, [], cache)
    const second = toFlowEdges(project, [], cache)

    expect(first).toHaveLength(1)
    expect(second[0]).toBe(first[0])
  })

  it('al cambiar la selección de forma que resalta la arista, crea un objeto NUEVO', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const otherId = otherNodeIdOf(project, 'slide')
    project = connect(project, startId, otherId)
    const cache: FlowEdgeCache = new Map()

    const before = toFlowEdges(project, [], cache)
    const after = toFlowEdges(project, [startId], cache)

    expect(before[0]?.data?.isHighlighted).toBe(false)
    expect(after[0]?.data?.isHighlighted).toBe(true)
    expect(after[0]).not.toBe(before[0])
  })
})
