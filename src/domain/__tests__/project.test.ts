import { describe, expect, it } from 'vitest'
import {
  addVariable,
  createConnectedNode,
  createNode,
  createProject,
  deleteNode,
  deleteVariable,
  duplicateNode,
  moveNode,
  moveNodes,
  updateNode,
  updateVariable,
} from '../project'
import { connect, disconnect } from '../graph'
import { addResponse, updateResponse } from '../responses'
import { addAudioBlock, addImageBlock, updateTextBlockBody } from '../content'
import type { ProjectDocument, SlideNode } from '../schemas'

/** Devuelve el id del primer nodo que NO es la diapositiva de inicio y es
 *  del tipo pedido — atajo cómodo ahora que "slide" es el tipo por defecto y
 *  hay siempre una diapositiva de inicio en el documento. */
function otherNodeIdOf(project: ProjectDocument, type: 'slide' | 'final'): string {
  const node = project.graph.nodes.find(
    (candidate) => candidate.type === type && candidate.id !== project.graph.startNodeId,
  )
  if (!node) throw new Error(`No hay un nodo "${type}" distinto del inicio en el setup`)
  return node.id
}

describe('createProject', () => {
  it('crea un documento con schemaVersion 1, metadata coherente y una única diapositiva que es el inicio', () => {
    const project = createProject('Mi escenario')

    expect(project.schemaVersion).toBe(1)
    expect(project.metadata.name).toBe('Mi escenario')
    expect(project.metadata.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(project.metadata.createdAt).toBe(project.metadata.updatedAt)
    expect(project.settings).toEqual({})
    expect(project.editor.viewport).toEqual({ x: 0, y: 0, zoom: 1 })

    expect(project.graph.nodes).toHaveLength(1)
    const first = project.graph.nodes[0]
    expect(first?.type).toBe('slide')
    expect(first?.number).toBe(1)
    // El inicio ya no es un nodo aparte: es una referencia a la primera
    // diapositiva del proyecto.
    expect(project.graph.startNodeId).toBe(first?.id)
  })

  it('la diapositiva de inicio nace sin respuestas y sin destino', () => {
    const project = createProject('P')
    const start = project.graph.nodes[0]
    expect(start?.type === 'slide' ? start.responses : undefined).toEqual([])
    expect(start?.type === 'slide' ? start.targetNodeId : 'missing').toBeUndefined()
    expect(start?.type === 'slide' ? start.continueLabel : 'missing').toBeUndefined()
  })

  it('la diapositiva de inicio nace con un único bloque de texto vacío, sin imagen ni audio', () => {
    const project = createProject('P')
    const start = project.graph.nodes[0]
    expect(start?.type === 'slide' ? start.content : undefined).toHaveLength(1)
    expect(start?.type === 'slide' ? start.content[0] : undefined).toMatchObject({
      type: 'text',
      body: '',
    })
    expect(start?.internalNote).toBeUndefined()
  })
})

describe('createNode', () => {
  it('añade un nodo nuevo con número visible incremental', () => {
    const project = createProject('P')
    const updated = createNode(project, 'slide', { x: 100, y: 100 }, { title: 'Diapositiva 1' })

    expect(updated.graph.nodes).toHaveLength(2)
    const slideId = otherNodeIdOf(updated, 'slide')
    const slide = updated.graph.nodes.find((node) => node.id === slideId)
    expect(slide?.number).toBe(2)
    expect(slide?.title).toBe('Diapositiva 1')
    // Inmutabilidad: el proyecto original no se muta.
    expect(project.graph.nodes).toHaveLength(1)
  })

  it('una diapositiva nueva nace sin respuestas (modo "de continuar")', () => {
    const project = createProject('P')
    const updated = createNode(project, 'slide', { x: 0, y: 0 })
    const slideId = otherNodeIdOf(updated, 'slide')
    const slide = updated.graph.nodes.find((node) => node.id === slideId)
    expect(slide?.type === 'slide' ? slide.responses : undefined).toEqual([])
  })

  it('crea nodos final sin respuestas ni salida', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    const final = project.graph.nodes.find((node) => node.id === finalId)
    expect(final?.type).toBe('final')
  })

  it('una diapositiva nueva nace con un único bloque de texto (sembrado con `extra.body`)', () => {
    const project = createNode(createProject('P'), 'slide', { x: 0, y: 0 }, { body: 'Hola' })
    const slideId = otherNodeIdOf(project, 'slide')
    const slide = project.graph.nodes.find((node) => node.id === slideId)
    expect(slide?.type === 'slide' ? slide.content : undefined).toEqual([
      // El id concreto no importa aquí, solo tipo/body — se verifica que sea
      // un único bloque, ver `src/domain/__tests__/content.test.ts` para el
      // resto de operaciones sobre `content`.
      expect.objectContaining({ type: 'text', body: 'Hola' }),
    ])
  })

  it('un nodo final nuevo usa `extra.body` directamente como su único body', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 }, { body: 'Fin del recorrido' })
    const finalId = otherNodeIdOf(project, 'final')
    const final = project.graph.nodes.find((node) => node.id === finalId)
    expect(final?.type === 'final' ? final.body : undefined).toBe('Fin del recorrido')
  })
})

describe('deleteNode', () => {
  it('elimina el nodo y limpia el targetNodeId de las diapositivas que apuntaban a él', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = createNode(project, 'slide', { x: 100, y: 0 }, { title: 'C1' })
    const slideId = otherNodeIdOf(project, 'slide')

    project = connect(project, startId, slideId)
    project = createNode(project, 'final', { x: 200, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    project = connect(project, slideId, finalId)

    project = deleteNode(project, finalId)

    expect(project.graph.nodes.some((n) => n.id === finalId)).toBe(false)
    const slide = project.graph.nodes.find((n) => n.id === slideId)
    expect(slide?.type === 'slide' ? slide.targetNodeId : 'missing').toBeUndefined()
  })

  it('elimina el nodo y limpia el targetNodeId de las respuestas que apuntaban a él', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 100, y: 0 })
    const slideId = otherNodeIdOf(project, 'slide')
    project = createNode(project, 'final', { x: 200, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')

    project = addResponse(project, slideId)
    const slideNode = project.graph.nodes.find((n) => n.id === slideId)
    const respId = slideNode?.type === 'slide' ? slideNode.responses[0]?.id : undefined
    if (!respId) throw new Error('setup inválido')

    project = connect(project, slideId, finalId, respId)
    project = deleteNode(project, finalId)

    const slideAfter = project.graph.nodes.find((n) => n.id === slideId)
    expect(
      slideAfter?.type === 'slide' ? slideAfter.responses[0]?.targetNodeId : 'missing',
    ).toBeUndefined()
  })

  it('lanza error si el nodo no existe', () => {
    const project = createProject('P')
    expect(() => deleteNode(project, 'no-existe')).toThrow()
  })

  it('no permite eliminar la diapositiva de inicio', () => {
    const project = createProject('P')
    expect(() => deleteNode(project, project.graph.startNodeId)).toThrow()
    // No debe haber mutado nada aunque haya lanzado.
    expect(project.graph.nodes).toHaveLength(1)
  })
})

describe('moveNode', () => {
  it('actualiza la posición del nodo indicado', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId

    const updated = moveNode(project, startId, { x: 42, y: 7 })
    expect(updated.graph.nodes[0]?.position).toEqual({ x: 42, y: 7 })
    expect(project.graph.nodes[0]?.position).toEqual({ x: 0, y: 0 })
  })
})

describe('moveNodes', () => {
  it('mueve varios nodos a la vez en una sola operación', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const slideId = otherNodeIdOf(project, 'slide')

    const updated = moveNodes(project, [
      { nodeId: startId, position: { x: 10, y: 20 } },
      { nodeId: slideId, position: { x: 30, y: 40 } },
    ])

    expect(updated.graph.nodes.find((n) => n.id === startId)?.position).toEqual({ x: 10, y: 20 })
    expect(updated.graph.nodes.find((n) => n.id === slideId)?.position).toEqual({ x: 30, y: 40 })
    // Inmutabilidad: el proyecto original no se toca.
    expect(project.graph.nodes.find((n) => n.id === startId)?.position).toEqual({ x: 0, y: 0 })
    expect(project.graph.nodes.find((n) => n.id === slideId)?.position).toEqual({ x: 100, y: 0 })
  })

  it('lanza error y no muta nada si alguno de los ids no existe', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId

    expect(() =>
      moveNodes(project, [
        { nodeId: startId, position: { x: 1, y: 1 } },
        { nodeId: 'no-existe', position: { x: 2, y: 2 } },
      ]),
    ).toThrow()
    expect(project.graph.nodes.find((n) => n.id === startId)?.position).toEqual({ x: 0, y: 0 })
  })
})

describe('updateNode', () => {
  it('actualiza el título de una diapositiva sin afectar su content', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId
    const originalContent = project.graph.nodes[0]?.type === 'slide' ? project.graph.nodes[0].content : undefined

    const updated = updateNode(project, startId, { title: 'Inicio del escenario' })
    const node = updated.graph.nodes[0]
    expect(node?.title).toBe('Inicio del escenario')
    expect(node?.id).toBe(startId)
    expect(node?.type === 'slide' ? node.content : undefined).toEqual(originalContent)
  })

  it('actualiza el body de un nodo final', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')

    const updated = updateNode(project, finalId, { title: 'Fin', body: 'texto de cierre' })
    const node = updated.graph.nodes.find((n) => n.id === finalId)
    expect(node?.type === 'final' ? node.title : undefined).toBe('Fin')
    expect(node?.type === 'final' ? node.body : undefined).toBe('texto de cierre')
  })

  it('lanza error al fijar `body` en una diapositiva (ya no tiene un body único, usa src/domain/content.ts)', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId
    expect(() => updateNode(project, startId, { body: 'texto' })).toThrow()
  })

  it('fija y borra la nota interna (internalNote), disponible también en un nodo final', () => {
    let project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')

    project = updateNode(project, finalId, { internalNote: 'Pedir gráfico a diseño' })
    let node = project.graph.nodes.find((n) => n.id === finalId)
    expect(node?.internalNote).toBe('Pedir gráfico a diseño')

    project = updateNode(project, finalId, { internalNote: null })
    node = project.graph.nodes.find((n) => n.id === finalId)
    expect(node?.internalNote).toBeUndefined()
  })

  it('fija, cambia y borra el texto del botón de continuar', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId

    project = updateNode(project, startId, { continueLabel: 'Siguiente' })
    let node = project.graph.nodes.find((n) => n.id === startId)
    expect(node?.type === 'slide' ? node.continueLabel : undefined).toBe('Siguiente')

    // `undefined` no toca el campo.
    project = updateNode(project, startId, { title: 'X' })
    node = project.graph.nodes.find((n) => n.id === startId)
    expect(node?.type === 'slide' ? node.continueLabel : undefined).toBe('Siguiente')

    // `null` lo borra (vuelve al texto por defecto).
    project = updateNode(project, startId, { continueLabel: null })
    node = project.graph.nodes.find((n) => n.id === startId)
    expect(node?.type === 'slide' ? node.continueLabel : 'missing').toBeUndefined()
  })

  it('lanza error al fijar texto de continuar/condition en un nodo final', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')

    expect(() => updateNode(project, finalId, { continueLabel: 'Otra cosa' })).toThrow()
    expect(() => updateNode(project, finalId, { elseTargetNodeId: 'x' })).toThrow()
  })

  it('no lanza al fijar internalNote en un nodo final (es válido en cualquier tipo)', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')

    expect(() => updateNode(project, finalId, { internalNote: 'nota' })).not.toThrow()
  })
})

describe('createConnectedNode', () => {
  it('crea y conecta en una sola llamada desde una diapositiva sin respuestas (sin sourceResponseId)', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId

    const { project: updated, nodeId } = createConnectedNode(
      project,
      'slide',
      { x: 200, y: 50 },
      startId,
    )

    expect(updated.graph.nodes).toHaveLength(2)
    const created = updated.graph.nodes.find((node) => node.id === nodeId)
    expect(created?.type).toBe('slide')
    expect(created?.position).toEqual({ x: 200, y: 50 })

    const start = updated.graph.nodes.find((node) => node.id === startId)
    expect(start?.type === 'slide' ? start.targetNodeId : undefined).toBe(nodeId)

    // Inmutabilidad: el proyecto original no se toca.
    expect(project.graph.nodes).toHaveLength(1)
  })

  it('crea y conecta en una sola llamada desde una respuesta concreta', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    const start = project.graph.nodes.find((node) => node.id === startId)
    const responseId = start?.type === 'slide' ? start.responses[0]?.id : undefined
    if (!responseId) throw new Error('setup inválido')

    const { project: updated, nodeId } = createConnectedNode(
      project,
      'final',
      { x: 300, y: 0 },
      startId,
      responseId,
    )

    const created = updated.graph.nodes.find((node) => node.id === nodeId)
    expect(created?.type).toBe('final')

    const startAfter = updated.graph.nodes.find((node) => node.id === startId)
    const response =
      startAfter?.type === 'slide'
        ? startAfter.responses.find((r) => r.id === responseId)
        : undefined
    expect(response?.targetNodeId).toBe(nodeId)
  })

  it('propaga el error de `connect` si la respuesta de origen no existe', () => {
    const project = createProject('P')
    expect(() =>
      createConnectedNode(project, 'final', { x: 0, y: 0 }, project.graph.startNodeId, 'no-existe'),
    ).toThrow()
  })

  it('propaga el error de `connect` si el nodo de origen es un final', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    expect(() => createConnectedNode(project, 'slide', { x: 0, y: 0 }, finalId)).toThrow()
  })
})

describe('duplicateNode', () => {
  it('clona título/content (bloques)/continueLabel/internalNote de una diapositiva con id y number nuevos', () => {
    const IMAGE_ID = '11111111-1111-1111-1111-111111111111'
    const AUDIO_ID = '22222222-2222-2222-2222-222222222222'
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = updateNode(project, startId, { title: 'Original', continueLabel: 'Siguiente', internalNote: 'nota interna' })
    const firstBlockId = (project.graph.nodes.find((n) => n.id === startId) as SlideNode).content[0]?.id
    if (!firstBlockId) throw new Error('setup inválido')
    project = updateTextBlockBody(project, startId, firstBlockId, 'cuerpo')
    project = addImageBlock(project, startId, IMAGE_ID)
    project = addAudioBlock(project, startId, AUDIO_ID)

    const { project: updated, nodeId } = duplicateNode(project, startId, { x: 40, y: 40 })

    expect(updated.graph.nodes).toHaveLength(2)
    expect(nodeId).not.toBe(startId)
    const original = project.graph.nodes.find((n) => n.id === startId) as SlideNode
    const copy = updated.graph.nodes.find((n) => n.id === nodeId) as SlideNode
    expect(copy.number).not.toBe(1)
    expect(copy.position).toEqual({ x: 40, y: 40 })
    expect(copy.title).toBe('Original')
    expect(copy.continueLabel).toBe('Siguiente')
    expect(copy.internalNote).toBe('nota interna')

    // El content se clona con la misma "forma" (tipo + body/assetId, en el
    // mismo orden) pero cada bloque tiene un `id` NUEVO, distinto del
    // original — ver comentario de `duplicateNode` en `src/domain/project.ts`.
    expect(copy.content.map((block) => (block.type === 'text' ? block.body : block.assetId))).toEqual(
      original.content.map((block) => (block.type === 'text' ? block.body : block.assetId)),
    )
    expect(copy.content.map((block) => block.type)).toEqual(['text', 'image', 'audio'])
    expect(copy.content.map((block) => block.id)).not.toEqual(original.content.map((block) => block.id))

    // Inmutabilidad: el proyecto original no se toca.
    expect(project.graph.nodes).toHaveLength(1)
  })

  it('la copia NO conserva targetNodeId/condition/elseTargetNodeId del original (decisión de diseño deliberada)', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = createNode(project, 'final', { x: 200, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    project = connect(project, startId, finalId)
    project = updateNode(project, startId, {
      condition: { variableId: 'v1', operator: '==', value: true },
      elseTargetNodeId: finalId,
    })

    const original = project.graph.nodes.find((n) => n.id === startId) as SlideNode
    expect(original.targetNodeId).toBe(finalId) // setup sano

    const { project: updated, nodeId } = duplicateNode(project, startId, { x: 0, y: 100 })
    const copy = updated.graph.nodes.find((n) => n.id === nodeId) as SlideNode

    expect(copy.targetNodeId).toBeUndefined()
    expect(copy.condition).toBeUndefined()
    expect(copy.elseTargetNodeId).toBeUndefined()
    // El original no se ha tocado.
    const originalAfter = updated.graph.nodes.find((n) => n.id === startId) as SlideNode
    expect(originalAfter.targetNodeId).toBe(finalId)
  })

  it('clona respuestas con texto/puntos/efectos/condición pero con id nuevo y targetNodeId limpio', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = createNode(project, 'final', { x: 200, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    project = addResponse(project, startId)
    const responseId = (project.graph.nodes.find((n) => n.id === startId) as SlideNode).responses[0]
      ?.id
    if (!responseId) throw new Error('setup inválido')
    project = updateResponse(project, startId, responseId, {
      text: 'Opción A',
      points: 5,
      effects: [{ variableId: 'v1', operation: 'set', value: 1 }],
      condition: { variableId: 'v1', operator: '==', value: true },
    })
    project = connect(project, startId, finalId, responseId)

    const { project: updated, nodeId } = duplicateNode(project, startId, { x: 0, y: 0 })
    const copy = updated.graph.nodes.find((n) => n.id === nodeId) as SlideNode

    expect(copy.responses).toHaveLength(1)
    const clonedResponse = copy.responses[0]
    expect(clonedResponse?.id).not.toBe(responseId)
    expect(clonedResponse?.text).toBe('Opción A')
    expect(clonedResponse?.points).toBe(5)
    expect(clonedResponse?.effects).toEqual([{ variableId: 'v1', operation: 'set', value: 1 }])
    expect(clonedResponse?.condition).toEqual({ variableId: 'v1', operator: '==', value: true })
    expect(clonedResponse?.targetNodeId).toBeUndefined()
  })

  it('duplica un nodo final (título/body/internalNote, sin campos propios de diapositiva)', () => {
    let project = createNode(createProject('P'), 'final', { x: 0, y: 0 }, { title: 'Fin', body: 'x' })
    const finalId = otherNodeIdOf(project, 'final')
    project = updateNode(project, finalId, { internalNote: 'nota' })

    const { project: updated, nodeId } = duplicateNode(project, finalId, { x: 50, y: 50 })
    const copy = updated.graph.nodes.find((n) => n.id === nodeId)

    expect(copy?.type).toBe('final')
    if (copy?.type !== 'final') throw new Error('esperaba un nodo final')
    expect(copy.title).toBe('Fin')
    expect(copy.body).toBe('x')
    expect(copy.internalNote).toBe('nota')
    expect(copy.position).toEqual({ x: 50, y: 50 })
  })

  it('duplicar la diapositiva de inicio no traslada esa condición a la copia', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId

    const { project: updated, nodeId } = duplicateNode(project, startId, { x: 40, y: 40 })

    expect(updated.graph.startNodeId).toBe(startId)
    expect(updated.graph.startNodeId).not.toBe(nodeId)
  })

  it('lanza error si el nodo no existe', () => {
    const project = createProject('P')
    expect(() => duplicateNode(project, 'no-existe', { x: 0, y: 0 })).toThrow()
  })
})

describe('updateNode — condition/elseTargetNodeId', () => {
  it('fija condition/elseTargetNodeId en una diapositiva sin tocar targetNodeId', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId
    const condition = { variableId: 'v1', operator: '==' as const, value: true }

    const updated = updateNode(project, startId, {
      condition,
      elseTargetNodeId: startId, // valor arbitrario válido, solo se comprueba que se fije
    })

    const slide = updated.graph.nodes.find((n) => n.id === startId) as SlideNode
    expect(slide.condition).toEqual(condition)
    expect(slide.elseTargetNodeId).toBe(startId)
  })

  it('borra condition/elseTargetNodeId con null', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId
    let updated = updateNode(project, startId, {
      condition: { variableId: 'v1', operator: '==', value: true },
      elseTargetNodeId: startId,
    })
    updated = updateNode(updated, startId, { condition: null, elseTargetNodeId: null })

    const slide = updated.graph.nodes.find((n) => n.id === startId) as SlideNode
    expect(slide.condition).toBeUndefined()
    expect(slide.elseTargetNodeId).toBeUndefined()
  })

  it('lanza si se fija condition/elseTargetNodeId en un nodo final', () => {
    const project = createNode(createProject('P'), 'final', { x: 0, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    expect(() => updateNode(project, finalId, { elseTargetNodeId: 'x' })).toThrow()
  })
})

describe('nodo "intro" (milestone "Diapositiva de Inicio")', () => {
  function introIdOf(project: ProjectDocument): string {
    const node = project.graph.nodes.find((candidate) => candidate.type === 'intro')
    if (!node) throw new Error('El proyecto no tiene ningún nodo "intro"')
    return node.id
  }

  describe('createNode', () => {
    it('crea el primer intro, lo añade vacío y lo fija como startNodeId (desplazando el anterior)', () => {
      const project = createProject('P')
      const oldStartId = project.graph.startNodeId

      const updated = createNode(project, 'intro', { x: -260, y: 0 })

      expect(updated.graph.nodes).toHaveLength(2)
      const introId = introIdOf(updated)
      const intro = updated.graph.nodes.find((n) => n.id === introId)
      expect(intro?.type === 'intro' ? intro.cicloId : 'missing').toBeUndefined()
      expect(intro?.type === 'intro' ? intro.asignaturaId : 'missing').toBeUndefined()
      expect(intro?.type === 'intro' ? intro.caseName : undefined).toBe('')
      expect(intro?.type === 'intro' ? intro.targetNodeId : 'missing').toBeUndefined()

      // Desplaza el startNodeId anterior (la diapositiva original).
      expect(updated.graph.startNodeId).toBe(introId)
      expect(updated.graph.startNodeId).not.toBe(oldStartId)
      // Inmutabilidad: el proyecto original no se toca.
      expect(project.graph.startNodeId).toBe(oldStartId)
    })

    it('lanza si el proyecto ya tiene un nodo intro', () => {
      const project = createNode(createProject('P'), 'intro', { x: -260, y: 0 })
      expect(() => createNode(project, 'intro', { x: -260, y: 100 })).toThrow()
      // No debe haber mutado nada aunque haya lanzado.
      expect(project.graph.nodes.filter((n) => n.type === 'intro')).toHaveLength(1)
    })
  })

  describe('deleteNode', () => {
    it('nunca se puede eliminar el nodo intro, aunque coincida o no con graph.startNodeId', () => {
      const project = createNode(createProject('P'), 'intro', { x: -260, y: 0 })
      const introId = introIdOf(project)

      // Caso normal: intro === startNodeId.
      expect(project.graph.startNodeId).toBe(introId)
      expect(() => deleteNode(project, introId)).toThrow()
      expect(project.graph.nodes.some((n) => n.id === introId)).toBe(true)
    })
  })

  describe('duplicateNode', () => {
    it('lanza al intentar duplicar el nodo intro: solo puede haber uno por proyecto', () => {
      const project = createNode(createProject('P'), 'intro', { x: -260, y: 0 })
      const introId = introIdOf(project)
      expect(() => duplicateNode(project, introId, { x: 0, y: 200 })).toThrow()
      // No debe haber mutado nada aunque haya lanzado.
      expect(project.graph.nodes).toHaveLength(2)
    })
  })

  describe('connect / disconnect (generalizados a un origen intro)', () => {
    it('conecta y desconecta el targetNodeId del intro igual que el "de continuar" de una diapositiva', () => {
      let project = createNode(createProject('P'), 'intro', { x: -260, y: 0 })
      const introId = introIdOf(project)
      const slideId = project.graph.nodes.find((n) => n.id !== introId)?.id
      if (!slideId) throw new Error('setup inválido')

      project = connect(project, introId, slideId)
      let intro = project.graph.nodes.find((n) => n.id === introId)
      expect(intro?.type === 'intro' ? intro.targetNodeId : undefined).toBe(slideId)

      project = disconnect(project, introId)
      intro = project.graph.nodes.find((n) => n.id === introId)
      expect(intro?.type === 'intro' ? intro.targetNodeId : 'missing').toBeUndefined()
    })

    it('connect con un responseId sobre un intro lanza (un intro nunca tiene respuestas)', () => {
      let project = createNode(createProject('P'), 'intro', { x: -260, y: 0 })
      const introId = introIdOf(project)
      const slideId = project.graph.nodes.find((n) => n.id !== introId)?.id
      if (!slideId) throw new Error('setup inválido')

      expect(() => connect(project, introId, slideId, 'cualquier-id')).toThrow()
    })
  })

  describe('updateNode — cicloId/asignaturaId/caseName', () => {
    it('fija, cambia y borra cicloId/asignaturaId; fija caseName', () => {
      let project = createNode(createProject('P'), 'intro', { x: -260, y: 0 })
      const introId = introIdOf(project)

      project = updateNode(project, introId, {
        cicloId: 'troncal_esp',
        asignaturaId: 'TR_ENGL_GM',
        caseName: 'Atención a un cliente disgustado',
      })
      let intro = project.graph.nodes.find((n) => n.id === introId)
      expect(intro?.type === 'intro' ? intro.cicloId : undefined).toBe('troncal_esp')
      expect(intro?.type === 'intro' ? intro.asignaturaId : undefined).toBe('TR_ENGL_GM')
      expect(intro?.type === 'intro' ? intro.caseName : undefined).toBe(
        'Atención a un cliente disgustado',
      )

      project = updateNode(project, introId, { cicloId: null, asignaturaId: null })
      intro = project.graph.nodes.find((n) => n.id === introId)
      expect(intro?.type === 'intro' ? intro.cicloId : 'missing').toBeUndefined()
      expect(intro?.type === 'intro' ? intro.asignaturaId : 'missing').toBeUndefined()
    })

    it('lanza si se fija cicloId/asignaturaId/caseName en una diapositiva o un final', () => {
      const withSlide = createProject('P')
      expect(() =>
        updateNode(withSlide, withSlide.graph.startNodeId, { cicloId: 'troncal_esp' }),
      ).toThrow()

      const withFinal = createNode(createProject('P'), 'final', { x: 0, y: 0 })
      const finalId = otherNodeIdOf(withFinal, 'final')
      expect(() => updateNode(withFinal, finalId, { caseName: 'x' })).toThrow()
    })
  })
})

describe('addVariable', () => {
  it('añade una variable numérica y una booleana con id generado', () => {
    let project = createProject('P')
    project = addVariable(project, { name: 'puntos', type: 'number', initialValue: 0 })
    project = addVariable(project, { name: 'ha_hablado', type: 'boolean', initialValue: false })

    expect(project.variables).toHaveLength(2)
    expect(project.variables[0]).toMatchObject({ name: 'puntos', type: 'number', initialValue: 0 })
    expect(project.variables[0]?.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(project.variables[1]).toMatchObject({
      name: 'ha_hablado',
      type: 'boolean',
      initialValue: false,
    })
  })

  it('recorta espacios del nombre', () => {
    const project = addVariable(createProject('P'), {
      name: '  puntos  ',
      type: 'number',
      initialValue: 0,
    })
    expect(project.variables[0]?.name).toBe('puntos')
  })

  it('lanza si el nombre está vacío tras recortar espacios', () => {
    expect(() =>
      addVariable(createProject('P'), { name: '   ', type: 'number', initialValue: 0 }),
    ).toThrow()
  })

  it('lanza si ya existe una variable con el mismo nombre', () => {
    let project = createProject('P')
    project = addVariable(project, { name: 'puntos', type: 'number', initialValue: 0 })
    expect(() =>
      addVariable(project, { name: 'puntos', type: 'number', initialValue: 5 }),
    ).toThrow()
  })

  it('lanza si initialValue no es del tipo declarado', () => {
    const project = createProject('P')
    expect(() =>
      addVariable(project, { name: 'x', type: 'number', initialValue: true as unknown as number }),
    ).toThrow()
    expect(() =>
      addVariable(project, {
        name: 'y',
        type: 'boolean',
        initialValue: 1 as unknown as boolean,
      }),
    ).toThrow()
  })

  it('no muta el proyecto original', () => {
    const project = createProject('P')
    addVariable(project, { name: 'puntos', type: 'number', initialValue: 0 })
    expect(project.variables).toEqual([])
  })
})

describe('updateVariable', () => {
  it('actualiza nombre/type/initialValue de forma coherente', () => {
    let project = addVariable(createProject('P'), {
      name: 'puntos',
      type: 'number',
      initialValue: 0,
    })
    const id = project.variables[0]?.id
    if (!id) throw new Error('setup inválido')

    project = updateVariable(project, id, { name: 'puntuacion', initialValue: 10 })
    expect(project.variables[0]).toMatchObject({ name: 'puntuacion', initialValue: 10, type: 'number' })
  })

  it('no toca campos ausentes del patch (undefined)', () => {
    let project = addVariable(createProject('P'), {
      name: 'puntos',
      type: 'number',
      initialValue: 0,
    })
    const id = project.variables[0]?.id
    if (!id) throw new Error('setup inválido')

    project = updateVariable(project, id, { initialValue: 7 })
    expect(project.variables[0]?.name).toBe('puntos')
    expect(project.variables[0]?.initialValue).toBe(7)
  })

  it('lanza si el nuevo nombre ya lo usa otra variable', () => {
    let project = addVariable(createProject('P'), { name: 'a', type: 'number', initialValue: 0 })
    project = addVariable(project, { name: 'b', type: 'number', initialValue: 0 })
    const bId = project.variables[1]?.id
    if (!bId) throw new Error('setup inválido')

    expect(() => updateVariable(project, bId, { name: 'a' })).toThrow()
  })

  it('permite conservar el mismo nombre (no choca consigo misma)', () => {
    let project = addVariable(createProject('P'), { name: 'a', type: 'number', initialValue: 0 })
    const id = project.variables[0]?.id
    if (!id) throw new Error('setup inválido')
    expect(() => updateVariable(project, id, { name: 'a', initialValue: 3 })).not.toThrow()
  })

  it('lanza si cambiar solo el type deja initialValue incoherente', () => {
    let project = addVariable(createProject('P'), { name: 'a', type: 'number', initialValue: 5 })
    const id = project.variables[0]?.id
    if (!id) throw new Error('setup inválido')
    expect(() => updateVariable(project, id, { type: 'boolean' })).toThrow()
  })

  it('cambiar type e initialValue juntos y coherentes funciona', () => {
    let project = addVariable(createProject('P'), { name: 'a', type: 'number', initialValue: 5 })
    const id = project.variables[0]?.id
    if (!id) throw new Error('setup inválido')
    project = updateVariable(project, id, { type: 'boolean', initialValue: true })
    expect(project.variables[0]).toMatchObject({ type: 'boolean', initialValue: true })
  })

  it('lanza si la variable no existe', () => {
    const project = createProject('P')
    expect(() => updateVariable(project, 'no-existe', { name: 'x' })).toThrow()
  })
})

describe('deleteVariable', () => {
  it('elimina la variable del proyecto', () => {
    let project = addVariable(createProject('P'), { name: 'a', type: 'number', initialValue: 0 })
    const id = project.variables[0]?.id
    if (!id) throw new Error('setup inválido')
    project = deleteVariable(project, id)
    expect(project.variables).toEqual([])
  })

  it('lanza si la variable no existe', () => {
    expect(() => deleteVariable(createProject('P'), 'no-existe')).toThrow()
  })

  it('limpia la condition de una diapositiva "de continuar" que referenciaba la variable borrada', () => {
    let project = addVariable(createProject('P'), { name: 'a', type: 'number', initialValue: 0 })
    const variableId = project.variables[0]?.id
    if (!variableId) throw new Error('setup inválido')
    const startId = project.graph.startNodeId
    project = updateNode(project, startId, {
      condition: { variableId, operator: '==', value: 1 },
    })

    project = deleteVariable(project, variableId)

    const slide = project.graph.nodes.find((n) => n.id === startId) as SlideNode
    expect(slide.condition).toBeUndefined()
  })

  it('limpia la condition de una respuesta que referenciaba la variable borrada', () => {
    let project = addVariable(createProject('P'), { name: 'a', type: 'number', initialValue: 0 })
    const variableId = project.variables[0]?.id
    if (!variableId) throw new Error('setup inválido')
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    const responseId = (project.graph.nodes.find((n) => n.id === startId) as SlideNode).responses[0]
      ?.id
    if (!responseId) throw new Error('setup inválido')
    project = updateResponse(project, startId, responseId, {
      condition: { variableId, operator: '==', value: 1 },
    })

    project = deleteVariable(project, variableId)

    const slide = project.graph.nodes.find((n) => n.id === startId) as SlideNode
    expect(slide.responses[0]?.condition).toBeUndefined()
  })

  it('quita solo los efectos que referenciaban la variable borrada, conservando el resto de la lista', () => {
    let project = addVariable(createProject('P'), { name: 'a', type: 'number', initialValue: 0 })
    project = addVariable(project, { name: 'b', type: 'number', initialValue: 0 })
    const [varA, varB] = project.variables
    if (!varA || !varB) throw new Error('setup inválido')

    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    const responseId = (project.graph.nodes.find((n) => n.id === startId) as SlideNode).responses[0]
      ?.id
    if (!responseId) throw new Error('setup inválido')
    project = updateResponse(project, startId, responseId, {
      effects: [
        { variableId: varA.id, operation: 'set', value: 1 },
        { variableId: varB.id, operation: 'increment', value: 2 },
      ],
    })

    project = deleteVariable(project, varA.id)

    const slide = project.graph.nodes.find((n) => n.id === startId) as SlideNode
    expect(slide.responses[0]?.effects).toEqual([
      { variableId: varB.id, operation: 'increment', value: 2 },
    ])
  })

  it('si borrar la variable deja la lista de efectos vacía, el campo queda undefined (no [])', () => {
    let project = addVariable(createProject('P'), { name: 'a', type: 'number', initialValue: 0 })
    const varId = project.variables[0]?.id
    if (!varId) throw new Error('setup inválido')

    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    const responseId = (project.graph.nodes.find((n) => n.id === startId) as SlideNode).responses[0]
      ?.id
    if (!responseId) throw new Error('setup inválido')
    project = updateResponse(project, startId, responseId, {
      effects: [{ variableId: varId, operation: 'set', value: 1 }],
    })

    project = deleteVariable(project, varId)

    const slide = project.graph.nodes.find((n) => n.id === startId) as SlideNode
    expect(slide.responses[0]?.effects).toBeUndefined()
  })
})
