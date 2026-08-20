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
  it('"+ Pantalla" crea un nodo de tipo content y lo selecciona', () => {
    render(<LeftPanel />)
    const before = useProjectStore.getState().project.graph.nodes.length

    fireEvent.click(screen.getByText('+ Pantalla'))

    expect(useProjectStore.getState().project.graph.nodes.length).toBe(before + 1)
    const created = lastNode()
    expect(created.type).toBe('content')
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([created.id])
  })

  it('"+ Decisión" crea un nodo de tipo decision y lo selecciona', () => {
    render(<LeftPanel />)
    const before = useProjectStore.getState().project.graph.nodes.length

    fireEvent.click(screen.getByText('+ Decisión'))

    expect(useProjectStore.getState().project.graph.nodes.length).toBe(before + 1)
    const created = lastNode()
    expect(created.type).toBe('decision')
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([created.id])
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

  it('no ofrece ningún control para crear un segundo nodo de Inicio', () => {
    render(<LeftPanel />)

    expect(screen.queryByText('+ Inicio')).not.toBeInTheDocument()
    expect(screen.queryByText(/^\+\s*Inicio$/)).not.toBeInTheDocument()
  })

  it('la lista muestra etiquetas en español y ningún UUID visible', () => {
    render(<LeftPanel />)

    // El proyecto recién creado ya tiene el nodo de Inicio.
    expect(screen.getByText('Inicio')).toBeInTheDocument()
    expect(screen.getByText('Sin título')).toBeInTheDocument()

    const startNode = useProjectStore.getState().project.graph.nodes[0]
    if (!startNode) throw new Error('El proyecto no tiene nodos')
    expect(screen.queryByText(startNode.id)).not.toBeInTheDocument()
  })

  it('click en un ítem de la lista selecciona ese nodo', () => {
    render(<LeftPanel />)

    act(() => {
      useProjectStore.getState().createNode('content', { x: 0, y: 0 })
    })
    const created = lastNode()

    fireEvent.click(screen.getByText(created.number.toString()))

    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([created.id])
  })

  it('click en un ítem de la lista también pide centrar el lienzo en ese nodo (focusRequestNodeId)', () => {
    render(<LeftPanel />)

    act(() => {
      useProjectStore.getState().createNode('content', { x: 0, y: 0 })
    })
    const created = lastNode()

    fireEvent.click(screen.getByText(created.number.toString()))

    expect(useProjectStore.getState().ui.focusRequestNodeId).toBe(created.id)
  })
})
