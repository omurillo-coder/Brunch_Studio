import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { LeftPanel } from '../LeftPanel'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'

beforeEach(() => {
  resetProjectStore()
})

function lastNode() {
  const nodes = useProjectStore.getState().project.graph.nodes
  return nodes.reduce((max, node) => (node.number > max.number ? node : max))
}

describe('LeftPanel', () => {
  it('"+ Diapositiva" crea un nodo de tipo slide (sin respuestas) y lo selecciona', () => {
    render(<LeftPanel />)
    const before = useProjectStore.getState().project.graph.nodes.length

    fireEvent.click(screen.getByText('+ Diapositiva'))

    expect(useProjectStore.getState().project.graph.nodes.length).toBe(before + 1)
    const created = lastNode()
    expect(created.type).toBe('slide')
    expect(created.type === 'slide' ? created.responses : undefined).toEqual([])
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([created.id])
  })

  it('solo ofrece dos botones de creación: Diapositiva y Final', () => {
    render(<LeftPanel />)

    expect(screen.getByText('+ Diapositiva')).toBeInTheDocument()
    expect(screen.getByText('+ Final')).toBeInTheDocument()
    // El botón de "Decisión" desaparece: las respuestas se añaden desde el
    // Inspector de una Diapositiva.
    expect(screen.queryByText('+ Decisión')).not.toBeInTheDocument()
    expect(screen.queryByText('+ Pantalla')).not.toBeInTheDocument()
  })

  it('"+ Final" crea un nodo de tipo final y lo selecciona', () => {
    render(<LeftPanel />)
    const before = useProjectStore.getState().project.graph.nodes.length

    fireEvent.click(screen.getByText('+ Final'))

    expect(useProjectStore.getState().project.graph.nodes.length).toBe(before + 1)
    const created = lastNode()
    expect(created.type).toBe('final')
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([created.id])
  })

  it('no ofrece ningún control para crear un nodo de Inicio (ya no es un tipo de nodo)', () => {
    render(<LeftPanel />)

    expect(screen.queryByText('+ Inicio')).not.toBeInTheDocument()
    expect(screen.queryByText(/^\+\s*Inicio$/)).not.toBeInTheDocument()
  })

  it('la lista muestra etiquetas en español y ningún UUID visible', () => {
    render(<LeftPanel />)

    // El proyecto recién creado ya tiene su diapositiva de inicio.
    expect(screen.getByText('Diapositiva')).toBeInTheDocument()
    expect(screen.getByText('Sin título')).toBeInTheDocument()

    const startNode = useProjectStore.getState().project.graph.nodes[0]
    if (!startNode) throw new Error('El proyecto no tiene nodos')
    expect(screen.queryByText(startNode.id)).not.toBeInTheDocument()
  })

  it('marca en la lista, de forma discreta, cuál es la diapositiva de inicio', () => {
    render(<LeftPanel />)
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
    })

    // Dos diapositivas en la lista, pero solo una marcada como inicio.
    expect(screen.getAllByText('Diapositiva')).toHaveLength(2)
    expect(screen.getAllByTitle('Diapositiva de inicio')).toHaveLength(1)
    expect(screen.getByText('Inicio')).toBeInTheDocument()
  })

  it('click en un ítem de la lista selecciona ese nodo', () => {
    render(<LeftPanel />)

    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
    })
    const created = lastNode()

    fireEvent.click(screen.getByText(created.number.toString()))

    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([created.id])
  })

  it('click en un ítem de la lista también pide centrar el lienzo en ese nodo (focusRequestNodeId)', () => {
    render(<LeftPanel />)

    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
    })
    const created = lastNode()

    fireEvent.click(screen.getByText(created.number.toString()))

    expect(useProjectStore.getState().ui.focusRequestNodeId).toBe(created.id)
  })
})
