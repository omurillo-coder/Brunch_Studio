import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Canvas } from '../Canvas'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'

/**
 * Montaje real de `@xyflow/react` (sin mockear), apoyado en los polyfills
 * de `src/test/setup.ts` (`ResizeObserver`, `DOMMatrixReadOnly`,
 * `getBoundingClientRect`). Es deliberadamente un smoke test: comprueba que
 * el lienzo monta sin lanzar y pinta lo esperado, no gestos de puntero
 * reales (arrastre/zoom con el ratón) — esos se testean invocando
 * directamente los callbacks relevantes en `Canvas.wiring.test.tsx`.
 */

beforeEach(() => {
  resetProjectStore()
})

describe('Canvas (montaje real de @xyflow/react)', () => {
  it('monta sin lanzar y pinta la diapositiva inicial, sin ids internos visibles', async () => {
    render(<Canvas />)

    expect(await screen.findByText('Diapositiva')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Sin título')).toBeInTheDocument()

    const startId = useProjectStore.getState().project.graph.startNodeId
    expect(screen.queryByText(startId)).not.toBeInTheDocument()
  })

  it('marca con una etiqueta discreta cuál es la diapositiva de inicio', async () => {
    useProjectStore.getState().createNode('slide', { x: 50, y: 50 }, { title: 'Otra' })

    render(<Canvas />)

    // Una única marca "Inicio" en todo el lienzo, la de `graph.startNodeId`.
    expect(await screen.findByTitle('Diapositiva de inicio')).toBeInTheDocument()
    expect(screen.getAllByText('Inicio')).toHaveLength(1)
  })

  it('pinta un nodo por cada nodo del proyecto', async () => {
    useProjectStore.getState().createNode('slide', { x: 50, y: 50 }, { title: 'Diapositiva uno' })
    useProjectStore.getState().createNode('final', { x: 100, y: 100 }, { title: 'El final' })

    render(<Canvas />)

    expect(await screen.findByText('Diapositiva uno')).toBeInTheDocument()
    expect(screen.getAllByText('Diapositiva')).toHaveLength(2)
    expect(screen.getByText('Final')).toBeInTheDocument()
    expect(screen.getByText('El final')).toBeInTheDocument()
  })

  it('una diapositiva con respuestas muestra su texto pero nunca su letra', async () => {
    const startId = useProjectStore.getState().project.graph.startNodeId
    useProjectStore.getState().addResponse(startId)
    const node = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startId)
    const responseId = node?.type === 'slide' ? node.responses[0]?.id : undefined
    if (!responseId) throw new Error('setup inválido')
    useProjectStore.getState().updateResponse(startId, responseId, { text: 'Primera opción' })

    render(<Canvas />)

    expect(await screen.findByText('Primera opción')).toBeInTheDocument()
    expect(screen.queryByText('A')).not.toBeInTheDocument()
  })

  it('una respuesta sin texto se resume como "Sin texto"', async () => {
    const startId = useProjectStore.getState().project.graph.startNodeId
    useProjectStore.getState().addResponse(startId)

    render(<Canvas />)

    expect(await screen.findByText('Sin texto')).toBeInTheDocument()
  })
})
