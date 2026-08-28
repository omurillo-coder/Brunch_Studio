import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Canvas } from '../../Canvas'
import { useProjectStore } from '../../../../store'
import { resetProjectStore } from '../../../../store/testHelpers'
import { CICLOS } from '../../../../domain'
import { shortNodeLabel } from '../nodeTypes'
import styles from '../NodeCard.module.css'

/**
 * Tarjeta del nodo `intro` (milestone "Diapositiva de Inicio", Tarea 3):
 * montaje real de `@xyflow/react` (mismo criterio que
 * `NodeCard.finalColor.test.tsx`), comprobando:
 * - Fondo verde clarito propio (`.cardIntro`, `--bs-color-intro-bg`),
 *   aplicado SOLO a la tarjeta `intro`.
 * - El contenido de la tarjeta resuelve ciclo/asignatura/caso a texto
 *   legible (nunca ids UUID/códigos crípticos).
 * - Handle de conexión SALIENTE presente; handle de ENTRADA ausente — nada
 *   puede conectar hacia el inicio.
 */

beforeEach(() => {
  resetProjectStore()
})

const cardClass = styles.card as string
const cardIntroClass = styles.cardIntro as string

describe('NodeCard — fondo y contenido del nodo `intro` (Diapositiva de Inicio)', () => {
  it('aplica `.cardIntro` solo al nodo `intro`, nunca a `slide`/`final`', async () => {
    useProjectStore.getState().createNode('intro', { x: -260, y: 0 })
    useProjectStore.getState().createNode('final', { x: 200, y: 0 }, { title: 'El final' })

    render(<Canvas />)

    const intro = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'intro')
    if (!intro) throw new Error('setup inválido')
    // Ya no muestra el texto "Inicio" (Tarea "Numeración corta": ese sitio
    // ahora es el código corto "D{número}", ver `shortNodeLabel`).
    const introTitle = await screen.findByText(shortNodeLabel(intro))
    const introCard = introTitle.closest(`.${CSS.escape(cardClass)}`)
    expect(introCard).not.toBeNull()
    expect(introCard?.classList.contains(cardIntroClass)).toBe(true)

    const finalTitle = screen.getByText('El final')
    const finalCard = finalTitle.closest(`.${CSS.escape(cardClass)}`)
    expect(finalCard).not.toBeNull()
    expect(finalCard?.classList.contains(cardIntroClass)).toBe(false)

    // Identificada por su código corto, no por "Sin ref. oculta": tanto la
    // diapositiva como el propio `intro` (título vacío) muestran ese mismo
    // texto de placeholder. Milestone "Inicio siempre es D1": crear el
    // `intro` desplaza el número de esta diapositiva (sembrada por
    // `resetProjectStore` con `number: 1`) a 2 — se calcula dinámicamente en
    // vez de asumir "D1", que ahora es siempre el propio `intro`.
    const slide = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'slide')
    if (!slide) throw new Error('setup inválido')
    const slideTypeBadge = screen.getByText(shortNodeLabel(slide))
    const slideCard = slideTypeBadge.closest(`.${CSS.escape(cardClass)}`)
    expect(slideCard).not.toBeNull()
    expect(slideCard?.classList.contains(cardIntroClass)).toBe(false)
  })

  it('un `intro` incompleto muestra el aviso "(pendiente de completar)", sin ids crípticos', async () => {
    useProjectStore.getState().createNode('intro', { x: -260, y: 0 })

    render(<Canvas />)

    expect(await screen.findByText('(pendiente de completar)')).toBeInTheDocument()
  })

  it('un `intro` completo muestra los NOMBRES resueltos de ciclo/asignatura/caso, nunca sus ids', async () => {
    const ciclo = CICLOS[0]
    const asignatura = ciclo?.asignaturas[0]
    if (!ciclo || !asignatura) throw new Error('El catálogo de prueba está vacío')

    useProjectStore.getState().createNode('intro', { x: -260, y: 0 })
    const intro = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'intro')
    if (!intro) throw new Error('setup inválido')
    useProjectStore.getState().updateNode(intro.id, {
      cicloId: ciclo.id,
      asignaturaId: asignatura.id,
      caseName: 'Simulación de urgencias',
    })

    render(<Canvas />)

    const expectedText = `${ciclo.name} · ${asignatura.name} — Simulación de urgencias`
    expect(await screen.findByText(expectedText)).toBeInTheDocument()
    expect(screen.queryByText(ciclo.id)).not.toBeInTheDocument()
    expect(screen.queryByText(asignatura.id)).not.toBeInTheDocument()
  })

  it('tiene un handle de conexión SALIENTE, sin ningún handle de ENTRADA', async () => {
    useProjectStore.getState().createNode('intro', { x: -260, y: 0 })
    const intro = useProjectStore.getState().project.graph.nodes.find((n) => n.type === 'intro')
    if (!intro) throw new Error('setup inválido')

    render(<Canvas />)
    await screen.findByText(shortNodeLabel(intro))

    const nodeHandles = Array.from(
      document.querySelectorAll(`.react-flow__handle[data-nodeid="${intro.id}"]`),
    )
    expect(nodeHandles.length).toBeGreaterThan(0)
    expect(nodeHandles.every((handle) => handle.classList.contains('source'))).toBe(true)
    expect(nodeHandles.some((handle) => handle.classList.contains('target'))).toBe(false)
  })
})
