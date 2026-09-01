import { describe, expect, it } from 'vitest'
import { createProject, createNode } from '../project'
import {
  addAudioBlock,
  addImageBlock,
  addTextBlock,
  addVideoBlock,
  attachImageAsset,
  moveContentBlock,
  removeContentBlock,
  updateTextBlockBody,
} from '../content'
import type { SlideNode } from '../schemas'

const IMAGE_ID = '11111111-1111-1111-1111-111111111111'
const IMAGE_ID_2 = '11111111-1111-1111-1111-111111111112'
const AUDIO_ID = '22222222-2222-2222-2222-222222222222'
const VIDEO_ID = '33333333-3333-3333-3333-333333333333'

/** Diapositiva de un proyecto en blanco: nace con un único bloque de texto
 *  vacío (ver `newSlideNode` en `src/domain/project.ts`). */
function blankSlide() {
  const project = createProject('P')
  return { project, slideId: project.graph.startNodeId }
}

function slideOf(project: ReturnType<typeof createProject>, id: string): SlideNode {
  const node = project.graph.nodes.find((candidate) => candidate.id === id)
  if (!node || node.type !== 'slide') throw new Error(`No hay una diapositiva con id "${id}"`)
  return node
}

describe('addTextBlock / addImageBlock / addAudioBlock / addVideoBlock', () => {
  it('añaden un bloque al final de content por defecto', () => {
    const { project, slideId } = blankSlide()
    let updated = addImageBlock(project, slideId, IMAGE_ID)
    updated = addAudioBlock(updated, slideId, AUDIO_ID)
    updated = addVideoBlock(updated, slideId, VIDEO_ID)

    const slide = slideOf(updated, slideId)
    expect(slide.content.map((block) => block.type)).toEqual(['text', 'image', 'audio', 'video'])
    expect(slide.content[1]).toMatchObject({ type: 'image', assetId: IMAGE_ID })
    expect(slide.content[2]).toMatchObject({ type: 'audio', assetId: AUDIO_ID })
    expect(slide.content[3]).toMatchObject({ type: 'video', assetId: VIDEO_ID })

    // Inmutabilidad: el proyecto original no se toca.
    expect(slideOf(project, slideId).content).toHaveLength(1)
  })

  it('addVideoBlock sigue el mismo patrón que addAudioBlock: inserta al final, o en `index` si se indica', () => {
    const { project, slideId } = blankSlide()
    const appended = addVideoBlock(project, slideId, VIDEO_ID)
    expect(slideOf(appended, slideId).content.map((block) => block.type)).toEqual(['text', 'video'])

    const inserted = addVideoBlock(project, slideId, VIDEO_ID, 0)
    expect(slideOf(inserted, slideId).content.map((block) => block.type)).toEqual(['video', 'text'])
  })

  it('insertan en la posición indicada cuando se pasa `index`', () => {
    const { project, slideId } = blankSlide()
    const updated = addImageBlock(project, slideId, IMAGE_ID, 0)

    const slide = slideOf(updated, slideId)
    expect(slide.content.map((block) => block.type)).toEqual(['image', 'text'])
  })

  it('un índice fuera de rango se recorta en vez de lanzar', () => {
    const { project, slideId } = blankSlide()
    const updated = addImageBlock(project, slideId, IMAGE_ID, 999)

    const slide = slideOf(updated, slideId)
    expect(slide.content.map((block) => block.type)).toEqual(['text', 'image'])
  })

  it('addTextBlock añade un bloque de texto vacío nuevo', () => {
    const { project, slideId } = blankSlide()
    const updated = addTextBlock(project, slideId)

    const slide = slideOf(updated, slideId)
    expect(slide.content).toHaveLength(2)
    expect(slide.content[1]).toMatchObject({ type: 'text', body: '' })
    // Cada bloque tiene un id distinto.
    expect(slide.content[0]?.id).not.toBe(slide.content[1]?.id)
  })

  it('lanza si el nodo no existe o no es una diapositiva', () => {
    const { project } = blankSlide()
    const withFinal = createNode(project, 'final', { x: 0, y: 0 })
    const finalId = withFinal.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')

    expect(() => addTextBlock(project, 'no-existe')).toThrow()
    expect(() => addTextBlock(withFinal, finalId)).toThrow()
  })

  it('milestone "+1 fallo con Game Over": addImageBlock sin assetId crea un bloque de imagen "pendiente de subir"', () => {
    const { project, slideId } = blankSlide()
    const updated = addImageBlock(project, slideId)

    const slide = slideOf(updated, slideId)
    const block = slide.content[1]
    expect(block?.type).toBe('image')
    expect(block?.type === 'image' ? block.assetId : 'missing').toBeUndefined()
  })
})

describe('attachImageAsset (milestone "+1 fallo con Game Over")', () => {
  it('rellena el assetId de un bloque de imagen pendiente, sin tocar nada más', () => {
    const { project, slideId } = blankSlide()
    const pending = addImageBlock(project, slideId)
    const blockId = slideOf(pending, slideId).content[1]?.id
    if (!blockId) throw new Error('setup inválido')

    const updated = attachImageAsset(pending, slideId, blockId, IMAGE_ID)

    const slide = slideOf(updated, slideId)
    expect(slide.content[1]).toMatchObject({ id: blockId, type: 'image', assetId: IMAGE_ID })
    // Inmutabilidad: el bloque pendiente original no se toca.
    expect(slideOf(pending, slideId).content[1]).toMatchObject({ assetId: undefined })
  })

  it('lanza si el bloque no existe, o si no es de tipo image', () => {
    const { project, slideId } = blankSlide()
    const textBlockId = slideOf(project, slideId).content[0]?.id
    if (!textBlockId) throw new Error('setup inválido')

    expect(() => attachImageAsset(project, slideId, 'no-existe', IMAGE_ID)).toThrow()
    expect(() => attachImageAsset(project, slideId, textBlockId, IMAGE_ID)).toThrow()
  })
})

describe('updateTextBlockBody', () => {
  it('actualiza el body de un bloque de texto concreto por su id', () => {
    const { project, slideId } = blankSlide()
    const blockId = slideOf(project, slideId).content[0]?.id
    if (!blockId) throw new Error('setup inválido')

    const updated = updateTextBlockBody(project, slideId, blockId, 'Hola mundo')
    expect(slideOf(updated, slideId).content[0]).toMatchObject({ type: 'text', body: 'Hola mundo' })
    // Inmutabilidad.
    expect(slideOf(project, slideId).content[0]).toMatchObject({ type: 'text', body: '' })
  })

  it('lanza si el bloque no existe', () => {
    const { project, slideId } = blankSlide()
    expect(() => updateTextBlockBody(project, slideId, 'no-existe', 'x')).toThrow()
  })

  it('lanza si el bloque existe pero no es de tipo text', () => {
    const { project, slideId } = blankSlide()
    const withImage = addImageBlock(project, slideId, IMAGE_ID)
    const imageBlockId = slideOf(withImage, slideId).content[1]?.id
    if (!imageBlockId) throw new Error('setup inválido')

    expect(() => updateTextBlockBody(withImage, slideId, imageBlockId, 'x')).toThrow()
  })
})

describe('removeContentBlock', () => {
  it('elimina un bloque por su id, conservando el orden del resto', () => {
    let { project, slideId } = blankSlide()
    project = addImageBlock(project, slideId, IMAGE_ID)
    project = addAudioBlock(project, slideId, AUDIO_ID)
    const [textBlock, imageBlock, audioBlock] = slideOf(project, slideId).content
    if (!textBlock || !imageBlock || !audioBlock) throw new Error('setup inválido')

    const updated = removeContentBlock(project, slideId, imageBlock.id)
    expect(slideOf(updated, slideId).content.map((b) => b.id)).toEqual([textBlock.id, audioBlock.id])
  })

  it('permite dejar content vacío (eliminar el último/único bloque no lanza)', () => {
    const { project, slideId } = blankSlide()
    const onlyBlockId = slideOf(project, slideId).content[0]?.id
    if (!onlyBlockId) throw new Error('setup inválido')

    const updated = removeContentBlock(project, slideId, onlyBlockId)
    expect(slideOf(updated, slideId).content).toEqual([])
  })

  it('lanza si el bloque no existe', () => {
    const { project, slideId } = blankSlide()
    expect(() => removeContentBlock(project, slideId, 'no-existe')).toThrow()
  })
})

describe('moveContentBlock', () => {
  function threeBlockSlide() {
    let { project, slideId } = blankSlide()
    project = addImageBlock(project, slideId, IMAGE_ID)
    project = addImageBlock(project, slideId, IMAGE_ID_2)
    return { project, slideId }
  }

  it('mueve un bloque a una posición distinta, desplazando los demás', () => {
    const { project, slideId } = threeBlockSlide()
    const [textBlock, imageBlock1, imageBlock2] = slideOf(project, slideId).content
    if (!textBlock || !imageBlock1 || !imageBlock2) throw new Error('setup inválido')

    // Mueve el bloque de texto (índice 0) al final (índice 2).
    const updated = moveContentBlock(project, slideId, textBlock.id, 2)
    expect(slideOf(updated, slideId).content.map((b) => b.id)).toEqual([
      imageBlock1.id,
      imageBlock2.id,
      textBlock.id,
    ])
  })

  it('mover a su propio índice actual es un no-op', () => {
    const { project, slideId } = threeBlockSlide()
    const ids = slideOf(project, slideId).content.map((b) => b.id)

    const updated = moveContentBlock(project, slideId, ids[1] ?? '', 1)
    expect(slideOf(updated, slideId).content.map((b) => b.id)).toEqual(ids)
  })

  it('un toIndex fuera de rango se recorta al extremo más cercano', () => {
    const { project, slideId } = threeBlockSlide()
    const ids = slideOf(project, slideId).content.map((b) => b.id)
    const lastId = ids[ids.length - 1]
    if (!lastId) throw new Error('setup inválido')

    const updated = moveContentBlock(project, slideId, lastId, 999)
    // Ya estaba al final: recortado a `length - 1`, sigue siendo un no-op.
    expect(slideOf(updated, slideId).content.map((b) => b.id)).toEqual(ids)

    const updatedToStart = moveContentBlock(project, slideId, lastId, -5)
    expect(slideOf(updatedToStart, slideId).content[0]?.id).toBe(lastId)
  })

  it('lanza si el bloque no existe', () => {
    const { project, slideId } = blankSlide()
    expect(() => moveContentBlock(project, slideId, 'no-existe', 0)).toThrow()
  })
})
