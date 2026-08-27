import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Canvas } from '../../Canvas'
import { useProjectStore } from '../../../../store'
import { resetProjectStore } from '../../../../store/testHelpers'
import styles from '../NodeCard.module.css'

/**
 * Fondo distintivo de la tarjeta de una diapositiva `slide` con `color`
 * fijado (paleta cerrada, Tarea "Colorear diapositivas"): montaje real de
 * `@xyflow/react` (mismo criterio que `NodeCard.finalColor.test.tsx`/
 * `NodeCard.introColor.test.tsx`), comprobando que la clase modificadora de
 * cada color se aplica exactamente a la tarjeta con ese `color` y a ninguna
 * otra — ni a una diapositiva sin color, ni a `final`/`intro`, que no llevan
 * este campo en su schema y mantienen su propio fondo fijo por tipo.
 */

beforeEach(() => {
  resetProjectStore()
})

const cardClass = styles.card as string
const cardSlideYellowClass = styles.cardSlideYellow as string
const cardSlidePurpleClass = styles.cardSlidePurple as string

/** Las siete clases modificadoras de color (Tarea 3: séptimo color "red"),
 *  para comprobar que ninguna se cuela donde no debe (nodo sin color,
 *  `final`, `intro`) sin depender de ningún supuesto sobre el formato del
 *  nombre ofuscado que genera el plugin de CSS modules — se comparan una a
 *  una contra la lista real. */
const ALL_SLIDE_COLOR_CLASSES = [
  styles.cardSlideYellow,
  styles.cardSlideOrange,
  styles.cardSlidePink,
  styles.cardSlidePurple,
  styles.cardSlideCyan,
  styles.cardSlideGray,
  styles.cardSlideRed,
] as string[]

function hasAnySlideColorClass(element: Element | null): boolean {
  if (!element) return false
  return ALL_SLIDE_COLOR_CLASSES.some((cls) => element.classList.contains(cls))
}

describe('NodeCard — fondo de color de una diapositiva `slide`', () => {
  it('aplica la clase del color fijado solo a esa tarjeta, nunca a una diapositiva sin color', async () => {
    useProjectStore.getState().createNode('slide', { x: 100, y: 0 }, { title: 'Con color' })
    const coloredId = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.type === 'slide' && n.title === 'Con color')?.id
    if (!coloredId) throw new Error('setup inválido')
    useProjectStore.getState().updateNode(coloredId, { color: 'yellow' })

    render(<Canvas />)

    const coloredTitle = await screen.findByText('Con color')
    const coloredCard = coloredTitle.closest(`.${CSS.escape(cardClass)}`)
    expect(coloredCard).not.toBeNull()
    expect(coloredCard?.classList.contains(cardSlideYellowClass)).toBe(true)

    // La diapositiva de inicio, sin color, no lleva ninguna clase de color.
    const uncoloredTitle = screen.getByText('Sin referencia')
    const uncoloredCard = uncoloredTitle.closest(`.${CSS.escape(cardClass)}`)
    expect(uncoloredCard).not.toBeNull()
    expect(uncoloredCard?.classList.contains(cardSlideYellowClass)).toBe(false)
    expect(hasAnySlideColorClass(uncoloredCard)).toBe(false)
  })

  it('cambiar de color cambia la clase aplicada (nunca dos colores a la vez)', async () => {
    useProjectStore.getState().createNode('slide', { x: 100, y: 0 }, { title: 'Cambiante' })
    const id = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.type === 'slide' && n.title === 'Cambiante')?.id
    if (!id) throw new Error('setup inválido')

    useProjectStore.getState().updateNode(id, { color: 'yellow' })
    render(<Canvas />)
    let title = await screen.findByText('Cambiante')
    let card = title.closest(`.${CSS.escape(cardClass)}`)
    expect(card?.classList.contains(cardSlideYellowClass)).toBe(true)
    expect(card?.classList.contains(cardSlidePurpleClass)).toBe(false)

    act(() => {
      useProjectStore.getState().updateNode(id, { color: 'purple' })
    })
    title = screen.getByText('Cambiante')
    card = title.closest(`.${CSS.escape(cardClass)}`)
    expect(card?.classList.contains(cardSlidePurpleClass)).toBe(true)
    expect(card?.classList.contains(cardSlideYellowClass)).toBe(false)
  })

  it('aplica la clase del séptimo color ("red", Tarea 3) igual que el resto de la paleta', async () => {
    useProjectStore.getState().createNode('slide', { x: 100, y: 0 }, { title: 'Roja' })
    const id = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.type === 'slide' && n.title === 'Roja')?.id
    if (!id) throw new Error('setup inválido')
    useProjectStore.getState().updateNode(id, { color: 'red' })

    render(<Canvas />)

    const title = await screen.findByText('Roja')
    const card = title.closest(`.${CSS.escape(cardClass)}`)
    expect(card?.classList.contains(styles.cardSlideRed as string)).toBe(true)
  })

  it('`final`/`intro` nunca llevan ninguna clase de color de diapositiva, aunque exista una `slide` coloreada', async () => {
    // El id de la diapositiva original (todavía `startNodeId` en este
    // punto) se captura ANTES de crear el `intro`: crearlo desplaza
    // `graph.startNodeId` hacia el propio `intro` (ver `createNode` en
    // `src/domain/project.ts`), así que hacerlo después referenciaría el
    // nodo equivocado (y `updateNode` lanzaría: `color` no es válido en un
    // `intro`).
    const slideId = useProjectStore.getState().project.graph.startNodeId
    useProjectStore.getState().createNode('final', { x: 200, y: 0 }, { title: 'El final' })
    useProjectStore.getState().createNode('intro', { x: -260, y: 0 })
    useProjectStore.getState().updateNode(slideId, { color: 'cyan' })

    render(<Canvas />)

    const finalTitle = await screen.findByText('El final')
    const finalCard = finalTitle.closest(`.${CSS.escape(cardClass)}`)
    expect(hasAnySlideColorClass(finalCard)).toBe(false)

    const introTitle = screen.getByText('Inicio')
    const introCard = introTitle.closest(`.${CSS.escape(cardClass)}`)
    expect(hasAnySlideColorClass(introCard)).toBe(false)
  })
})
