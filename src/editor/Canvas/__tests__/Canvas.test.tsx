import { fireEvent, render, screen } from '@testing-library/react'
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

/**
 * Botón de auto-layout ("Ordenar automáticamente"): smoke test sobre el
 * montaje real de `@xyflow/react` (igual que el resto de este fichero, ver
 * comentario superior). Comprueba que el control existe con la etiqueta
 * accesible esperada y que pulsarlo reordena los nodos en una única
 * entrada de historial deshacible — no vuelve a probar `computeAutoLayout`
 * en sí (ya cubierto en `layout/__tests__/autoLayout.test.ts`) ni
 * `applyLayout` (cubierto en `useProjectStore.test.ts`).
 */
describe('Canvas — botón de auto-layout ("Ordenar automáticamente")', () => {
  it('existe con la etiqueta accesible esperada', async () => {
    render(<Canvas />)
    expect(await screen.findByRole('button', { name: 'Ordenar automáticamente' })).toBeInTheDocument()
  })

  it('al pulsarlo reordena los nodos en una única entrada de historial deshacible', async () => {
    useProjectStore.getState().createNode('slide', { x: 999, y: 999 }, { title: 'Otra' })
    useProjectStore.getState().createNode('final', { x: 999, y: 999 }, { title: 'Fin' })
    const historyBefore = useProjectStore.getState().history.past.length
    const positionsBefore = useProjectStore
      .getState()
      .project.graph.nodes.map((n) => ({ id: n.id, position: { ...n.position } }))

    render(<Canvas />)

    const button = await screen.findByRole('button', { name: 'Ordenar automáticamente' })
    fireEvent.click(button)

    expect(useProjectStore.getState().history.past.length).toBe(historyBefore + 1)
    const positionsAfter = useProjectStore.getState().project.graph.nodes
    // Al menos una posición cambió (los tres nodos partían de solapados en
    // (999,999) salvo el de inicio en (0,0); el layout los separa).
    const changed = positionsBefore.some((before) => {
      const after = positionsAfter.find((n) => n.id === before.id)
      return after?.position.x !== before.position.x || after?.position.y !== before.position.y
    })
    expect(changed).toBe(true)

    useProjectStore.getState().undo()
    const restored = useProjectStore.getState().project.graph.nodes
    for (const before of positionsBefore) {
      expect(restored.find((n) => n.id === before.id)?.position).toEqual(before.position)
    }
  })
})
