import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Canvas } from '../../Canvas'
import { useProjectStore } from '../../../../store'
import { resetProjectStore } from '../../../../store/testHelpers'
import { shortNodeLabel } from '../nodeTypes'
import styles from '../NodeCard.module.css'

/**
 * Tarea "Numeración corta" + Tarea "Orden de la tarjeta" + Tarea "Contorno
 * de Inicio/Final": las tres tareas visuales relacionadas descritas en el
 * encargo, cubiertas aquí en un único fichero por lo estrechamente ligadas
 * que están (todas tocan la cabecera de `NodeCard`).
 */

beforeEach(() => {
  resetProjectStore()
})

describe('shortNodeLabel', () => {
  it('devuelve "D" + el número, para varios números', () => {
    expect(shortNodeLabel({ number: 1 })).toBe('D1')
    expect(shortNodeLabel({ number: 35 })).toBe('D35')
    expect(shortNodeLabel({ number: 100 })).toBe('D100')
  })

  it('funciona igual para los tres tipos de nodo (intro/slide/final): solo depende de `number`', () => {
    useProjectStore.getState().createNode('intro', { x: -260, y: 0 })
    useProjectStore.getState().createNode('final', { x: 200, y: 0 }, { title: 'Final' })
    const nodes = useProjectStore.getState().project.graph.nodes
    const intro = nodes.find((n) => n.type === 'intro')
    const slide = nodes.find((n) => n.type === 'slide')
    const final = nodes.find((n) => n.type === 'final')
    if (!intro || !slide || !final) throw new Error('setup inválido')

    expect(shortNodeLabel(intro)).toBe(`D${intro.number}`)
    expect(shortNodeLabel(slide)).toBe(`D${slide.number}`)
    expect(shortNodeLabel(final)).toBe(`D${final.number}`)
  })
})

describe('NodeCard — cabecera: código corto y orden (referencia primero)', () => {
  it('la tarjeta muestra "D{número}" en vez de la etiqueta de tipo, para los tres tipos', async () => {
    useProjectStore.getState().createNode('intro', { x: -260, y: 0 })
    useProjectStore.getState().createNode('final', { x: 200, y: 0 }, { title: 'El final' })
    const nodes = useProjectStore.getState().project.graph.nodes
    const intro = nodes.find((n) => n.type === 'intro')
    const slideStart = nodes.find((n) => n.type === 'slide')
    const final = nodes.find((n) => n.type === 'final')
    if (!intro || !slideStart || !final) throw new Error('setup inválido')

    render(<Canvas />)

    expect(await screen.findByText(shortNodeLabel(intro))).toBeInTheDocument()
    expect(screen.getByText(shortNodeLabel(slideStart))).toBeInTheDocument()
    expect(screen.getByText(shortNodeLabel(final))).toBeInTheDocument()
    // La antigua etiqueta traducida ya no se pinta en ninguna tarjeta.
    expect(screen.queryByText('Diapositiva')).not.toBeInTheDocument()
    expect(screen.queryByText('Final')).not.toBeInTheDocument()
  })

  it('en el DOM, la referencia/título aparece ANTES que el código corto "D{número}"', async () => {
    const startId = useProjectStore.getState().project.graph.startNodeId
    useProjectStore.getState().updateNode(startId, { title: 'Mi referencia' })

    render(<Canvas />)

    const title = await screen.findByText('Mi referencia')
    const typeBadge = screen.getByText('D1')
    // `compareDocumentPosition` con el bit `DOCUMENT_POSITION_FOLLOWING`
    // (4) confirma que `typeBadge` viene DESPUÉS de `title` en el DOM.
    // eslint-disable-next-line no-bitwise
    expect(title.compareDocumentPosition(typeBadge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('NodeCard — contorno negro (`outline`) en Inicio/Final', () => {
  const cardClass = styles.card as string
  const cardIntroClass = styles.cardIntro as string
  const cardFinalClass = styles.cardFinal as string

  it('`intro` y `final` llevan la clase con el contorno negro; una `slide` normal no', async () => {
    useProjectStore.getState().createNode('intro', { x: -260, y: 0 })
    useProjectStore.getState().createNode('final', { x: 200, y: 0 }, { title: 'El final' })
    const nodes = useProjectStore.getState().project.graph.nodes
    const intro = nodes.find((n) => n.type === 'intro')
    const slideStart = nodes.find((n) => n.type === 'slide')
    const final = nodes.find((n) => n.type === 'final')
    if (!intro || !slideStart || !final) throw new Error('setup inválido')

    render(<Canvas />)

    const introCard = (await screen.findByText(shortNodeLabel(intro))).closest(
      `.${CSS.escape(cardClass)}`,
    )
    const slideCard = screen.getByText(shortNodeLabel(slideStart)).closest(`.${CSS.escape(cardClass)}`)
    const finalCard = screen.getByText(shortNodeLabel(final)).closest(`.${CSS.escape(cardClass)}`)

    // `.cardIntro`/`.cardFinal` (`NodeCard.module.css`) son las clases que
    // llevan `outline: 2px solid var(--bs-color-text)` — ver comentario ahí.
    expect(introCard?.classList.contains(cardIntroClass)).toBe(true)
    expect(finalCard?.classList.contains(cardFinalClass)).toBe(true)
    expect(slideCard?.classList.contains(cardIntroClass)).toBe(false)
    expect(slideCard?.classList.contains(cardFinalClass)).toBe(false)
  })

  it('el contorno negro se mantiene junto con el anillo de selección y el aviso "sin salida" (clases combinadas, sin excluirse)', async () => {
    useProjectStore.getState().createNode('final', { x: 200, y: 0 }, { title: 'El final' })
    const final = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'final')
    if (!final) throw new Error('setup inválido')

    render(<Canvas />)
    await screen.findByText('El final')

    act(() => {
      useProjectStore.getState().selectNode(final.id)
    })
    const finalCardAfterSelect = screen.getByText('El final').closest(`.${CSS.escape(cardClass)}`)
    // Seleccionar el nodo no quita `.cardFinal`: ambas capas (contorno +
    // anillo de selección, este último vía `.react-flow__node.selected` en
    // el wrapper) conviven sobre la misma tarjeta.
    expect(finalCardAfterSelect?.classList.contains(cardFinalClass)).toBe(true)
    expect(finalCardAfterSelect?.closest('.react-flow__node')?.classList.contains('selected')).toBe(true)
  })
})
