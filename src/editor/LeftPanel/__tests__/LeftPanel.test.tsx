import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { LeftPanel } from '../LeftPanel'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'
import { serializeRichBody } from '../../richText/richTextContent'
import { CICLOS } from '../../../domain'

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

  it('ofrece tres botones de creación: Inicio, Diapositiva y Final', () => {
    render(<LeftPanel />)

    expect(screen.getByText('+ Inicio')).toBeInTheDocument()
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

  it('"+ Inicio" crea un nodo de tipo intro y lo selecciona cuando el proyecto todavía no tiene ninguno', () => {
    render(<LeftPanel />)
    const before = useProjectStore.getState().project.graph.nodes.length

    const button = screen.getByText('+ Inicio').closest('button')
    expect(button).not.toBeNull()
    expect(button).not.toBeDisabled()

    fireEvent.click(screen.getByText('+ Inicio'))

    expect(useProjectStore.getState().project.graph.nodes.length).toBe(before + 1)
    const created = lastNode()
    expect(created.type).toBe('intro')
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([created.id])
  })

  it('"+ Inicio" se deshabilita en cuanto el proyecto ya tiene una diapositiva de Inicio', () => {
    render(<LeftPanel />)
    act(() => {
      useProjectStore.getState().createNode('intro', { x: 0, y: 0 })
    })

    const button = screen.getByText('+ Inicio').closest('button')
    expect(button).not.toBeNull()
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Ya existe la diapositiva de Inicio')
  })

  it('la lista muestra etiquetas en español y ningún UUID visible', () => {
    render(<LeftPanel />)

    // El proyecto recién creado ya tiene su diapositiva de inicio.
    expect(screen.getByText('Diapositiva')).toBeInTheDocument()
    expect(screen.getByText('Sin referencia')).toBeInTheDocument()

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

  it('ilumina en la lista la diapositiva actualmente seleccionada (sistema de guiaje)', () => {
    render(<LeftPanel />)
    // A través del botón "+ Diapositiva" (no de la acción de dominio
    // directamente): es `LeftPanel.handleCreate` quien selecciona el nodo
    // recién creado, la acción de dominio por sí sola no selecciona nada.
    fireEvent.click(screen.getByText('+ Diapositiva'))
    const created = lastNode()

    const createdItem = screen.getByText(created.number.toString()).closest('button')
    expect(createdItem).not.toBeNull()
    expect(createdItem).toHaveAttribute('aria-current', 'true')

    // El resto de ítems de la lista no están marcados como actuales.
    const start = useProjectStore.getState().project.graph.startNodeId
    const startNode = useProjectStore.getState().project.graph.nodes.find((n) => n.id === start)
    if (!startNode) throw new Error('No se encontró la diapositiva de inicio')
    const startItem = screen.getByText(startNode.number.toString()).closest('button')
    expect(startItem).not.toHaveAttribute('aria-current')

    // Al seleccionar otra diapositiva, la iluminación se mueve con ella.
    fireEvent.click(screen.getByText(startNode.number.toString()))
    expect(screen.getByText(startNode.number.toString()).closest('button')).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByText(created.number.toString()).closest('button')).not.toHaveAttribute(
      'aria-current',
    )
  })
})

describe('LeftPanel — buscador del proyecto (fase 8)', () => {
  function searchInput(): HTMLElement {
    return screen.getByLabelText('Buscar en el proyecto')
  }

  /** Añade una respuesta a una diapositiva y le pone el texto indicado. */
  function addResponseWithText(nodeId: string, text: string): string {
    act(() => {
      useProjectStore.getState().addResponse(nodeId)
    })
    const node = useProjectStore.getState().project.graph.nodes.find((n) => n.id === nodeId)
    const responses = node?.type === 'slide' ? node.responses : []
    const responseId = responses[responses.length - 1]?.id
    if (!responseId) throw new Error('responseId inesperadamente ausente')
    act(() => {
      useProjectStore.getState().updateResponse(nodeId, responseId, { text })
    })
    return responseId
  }

  it('sin texto de búsqueda muestra todos los nodos', () => {
    render(<LeftPanel />)
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Otra diapositiva' })
    })

    expect(screen.getAllByRole('button', { name: /Diapositiva|Final/ }).length).toBeGreaterThanOrEqual(2)
  })

  it('filtra por título (case-insensitive, substring)', () => {
    render(<LeftPanel />)
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Sala de espera' })
      useProjectStore.getState().createNode('final', { x: 0, y: 0 }, { title: 'Cierre del caso' })
    })

    fireEvent.change(searchInput(), { target: { value: 'SALA' } })

    expect(screen.getByText('Sala de espera')).toBeInTheDocument()
    expect(screen.queryByText('Cierre del caso')).not.toBeInTheDocument()
  })

  it('filtra por el texto plano real del cuerpo (Tiptap), no por el JSON serializado', () => {
    render(<LeftPanel />)
    const start = useProjectStore.getState().project.graph.startNodeId
    const richBody = serializeRichBody({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Protocolo' },
            { type: 'text', text: ' de emergencia' },
          ],
        },
      ],
    })
    act(() => {
      useProjectStore.getState().updateNode(start, { title: 'Diapositiva con cuerpo' })
      const startNode = useProjectStore.getState().project.graph.nodes.find((n) => n.id === start)
      const firstBlockId = startNode?.type === 'slide' ? startNode.content[0]?.id : undefined
      if (!firstBlockId) throw new Error('setup inválido')
      useProjectStore.getState().updateTextBlockBody(start, firstBlockId, richBody)
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Sin relación' })
    })

    fireEvent.change(searchInput(), { target: { value: 'protocolo' } })
    expect(screen.getByText('Diapositiva con cuerpo')).toBeInTheDocument()
    expect(screen.queryByText('Sin relación')).not.toBeInTheDocument()

    // Ninguna coincidencia falsa con la sintaxis JSON de Tiptap.
    fireEvent.change(searchInput(), { target: { value: 'paragraph' } })
    expect(screen.queryByText('Diapositiva con cuerpo')).not.toBeInTheDocument()
  })

  it('filtra por el texto de una respuesta de decisión', () => {
    render(<LeftPanel />)
    const start = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      useProjectStore.getState().updateNode(start, { title: 'Diapositiva de decisión' })
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Otra diapositiva' })
    })
    addResponseWithText(start, 'Avisar al responsable')

    fireEvent.change(searchInput(), { target: { value: 'responsable' } })

    expect(screen.getByText('Diapositiva de decisión')).toBeInTheDocument()
    expect(screen.queryByText('Otra diapositiva')).not.toBeInTheDocument()
  })

  it('sin ninguna coincidencia muestra un aviso de "sin resultados"', () => {
    render(<LeftPanel />)

    fireEvent.change(searchInput(), { target: { value: 'ninguna-coincidencia-posible' } })

    expect(screen.getByText(/Sin resultados/)).toBeInTheDocument()
  })

  it('hacer clic en un resultado filtrado selecciona y centra el lienzo en ese nodo, igual que sin filtrar', () => {
    render(<LeftPanel />)
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Objetivo de búsqueda' })
    })
    const created = lastNode()

    fireEvent.change(searchInput(), { target: { value: 'objetivo' } })
    fireEvent.click(screen.getByText('Objetivo de búsqueda'))

    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([created.id])
    expect(useProjectStore.getState().ui.focusRequestNodeId).toBe(created.id)
  })

  it('filtra un nodo `intro` por su nombre de caso práctico (caseName)', () => {
    render(<LeftPanel />)
    act(() => {
      useProjectStore.getState().createNode('intro', { x: 0, y: 0 })
    })
    const intro = lastNode()
    act(() => {
      useProjectStore.getState().updateNode(intro.id, { caseName: 'Simulación de urgencias' })
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Sin relación' })
    })

    fireEvent.change(searchInput(), { target: { value: 'urgencias' } })

    // La lista no pinta el `caseName` directamente (eso es cosa de la
    // tarjeta del lienzo, ver `adapter.ts`), pero el filtro debe conservar
    // la fila del `intro` (identificada por su número visible) y descartar
    // la diapositiva sin relación.
    expect(screen.getByText(intro.number.toString())).toBeInTheDocument()
    expect(screen.queryByText('Sin relación')).not.toBeInTheDocument()
  })

  it('filtra un nodo `intro` por el NOMBRE del ciclo/asignatura elegidos, no por su id', () => {
    render(<LeftPanel />)
    const ciclo = CICLOS[0]
    if (!ciclo) throw new Error('El catálogo de ciclos está vacío')
    const asignatura = ciclo.asignaturas[0]
    if (!asignatura) throw new Error('El ciclo de prueba no tiene asignaturas')

    act(() => {
      useProjectStore.getState().createNode('intro', { x: 0, y: 0 })
    })
    const intro = lastNode()
    act(() => {
      useProjectStore.getState().updateNode(intro.id, {
        cicloId: ciclo.id,
        asignaturaId: asignatura.id,
      })
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Sin relación' })
    })

    // Búsqueda por el NOMBRE del ciclo (nunca su id/slug interno).
    fireEvent.change(searchInput(), { target: { value: ciclo.name.toLowerCase() } })
    expect(screen.getByText(intro.number.toString())).toBeInTheDocument()
    expect(screen.queryByText('Sin relación')).not.toBeInTheDocument()
    // El id/slug interno del ciclo no debería aparecer nunca en pantalla.
    expect(screen.queryByText(ciclo.id)).not.toBeInTheDocument()

    // Búsqueda por el NOMBRE de la asignatura.
    fireEvent.change(searchInput(), { target: { value: asignatura.name.toLowerCase() } })
    expect(screen.getByText(intro.number.toString())).toBeInTheDocument()
    expect(screen.queryByText('Sin relación')).not.toBeInTheDocument()
  })
})
