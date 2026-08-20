import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Canvas } from '../Canvas'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'
import type { DecisionNode } from '../../../domain'

/**
 * Montaje real de `@xyflow/react` (sin mockear), apoyado en los polyfills
 * de `src/test/setup.ts` (`ResizeObserver`, `DOMMatrixReadOnly`,
 * `getBoundingClientRect`). Es deliberadamente un smoke test: comprueba que
 * el lienzo monta sin lanzar y pinta lo esperado, no gestos de puntero
 * reales (arrastre/zoom con el ratón) — esos se testean invocando
 * directamente los callbacks relevantes en `Canvas.wiring.test.tsx`, y el
 * pan/zoom real queda como verificación manual (ver limitación documentada
 * en el informe de la fase).
 */

beforeEach(() => {
  resetProjectStore()
})

describe('Canvas (montaje real de @xyflow/react)', () => {
  it('monta sin lanzar y pinta el nodo de Inicio inicial, sin ids internos visibles', async () => {
    render(<Canvas />)

    expect(await screen.findByText('Inicio')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Sin título')).toBeInTheDocument()

    const startId = useProjectStore.getState().project.graph.nodes[0]?.id
    if (!startId) throw new Error('setup inválido')
    expect(screen.queryByText(startId)).not.toBeInTheDocument()
  })

  it('pinta un nodo por cada nodo del proyecto', async () => {
    useProjectStore.getState().createNode('content', { x: 50, y: 50 }, { title: 'Pantalla uno' })
    useProjectStore.getState().createNode('decision', { x: 100, y: 100 })

    render(<Canvas />)

    expect(await screen.findByText('Pantalla')).toBeInTheDocument()
    expect(screen.getByText('Pantalla uno')).toBeInTheDocument()
    expect(screen.getByText('Decisión')).toBeInTheDocument()
  })

  it('un nodo decision sin respuestas muestra "Sin respuestas"', async () => {
    useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
    const decisionId = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.type === 'decision')?.id
    if (!decisionId) throw new Error('setup inválido')

    // `createNode` deja el decision con A y B; para probar el caso límite de
    // "sin ninguna respuesta" se eliminan explícitamente (el dominio no lo
    // impide, aunque nunca se nazca así).
    const initialResponses = (
      useProjectStore.getState().project.graph.nodes.find((n) => n.id === decisionId) as DecisionNode
    ).responses
    for (const response of initialResponses) {
      useProjectStore.getState().removeResponse(decisionId, response.id)
    }

    render(<Canvas />)

    expect(await screen.findByText('Sin respuestas')).toBeInTheDocument()
  })

  it('un nodo decision con respuestas muestra su letra y texto', async () => {
    useProjectStore.getState().createNode('decision', { x: 0, y: 0 })
    const decisionId = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.type === 'decision')?.id
    if (!decisionId) throw new Error('setup inválido')
    useProjectStore.getState().addResponse(decisionId)

    render(<Canvas />)

    expect(await screen.findByText('A')).toBeInTheDocument()
  })
})
