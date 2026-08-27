import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Canvas } from '../../Canvas'
import { useProjectStore } from '../../../../store'
import { resetProjectStore } from '../../../../store/testHelpers'
import styles from '../NodeCard.module.css'

/**
 * Fondo distintivo de la tarjeta `final` (azul clarito, `--bs-color-final-bg`
 * en `tokens.css`): montaje real de `@xyflow/react` (mismo criterio que
 * `Canvas.test.tsx`), comprobando que la clase modificadora `.cardFinal` de
 * `NodeCard.module.css` se aplica exactamente a las tarjetas de tipo
 * `final` y a ninguna de tipo `slide` — no un simple snapshot de color, que
 * no protegería frente a aplicar la clase al tipo equivocado.
 */

beforeEach(() => {
  resetProjectStore()
})

// `styles.card`/`styles.cardFinal` vienen del mapa de clases generado por el
// CSS module; con `noUncheckedIndexedAccess` TypeScript los tipa como
// `string | undefined` aunque sabemos que existen (se definen ambos en
// `NodeCard.module.css`) — de ahí las aserciones no-nulas explícitas.
const cardClass = styles.card as string
const cardFinalClass = styles.cardFinal as string

describe('NodeCard — fondo de la diapositiva `final`', () => {
  it('aplica `.cardFinal` solo a los nodos `final`, nunca a los `slide`', async () => {
    useProjectStore.getState().createNode('final', { x: 100, y: 0 }, { title: 'El final' })

    render(<Canvas />)

    const finalTitle = await screen.findByText('El final')
    const finalCard = finalTitle.closest(`.${CSS.escape(cardClass)}`)
    expect(finalCard).not.toBeNull()
    expect(finalCard?.classList.contains(cardFinalClass)).toBe(true)

    // La diapositiva de inicio, creada por defecto por el store, es de tipo
    // `slide` y sigue mostrando el placeholder de "sin referencia" cuando no
    // tiene título (ver `displayTitle` en `nodeTypes.tsx`).
    const slideTitle = screen.getByText('Sin ref. oculta')
    const slideCard = slideTitle.closest(`.${CSS.escape(cardClass)}`)
    expect(slideCard).not.toBeNull()
    expect(slideCard?.classList.contains(cardFinalClass)).toBe(false)
  })
})
