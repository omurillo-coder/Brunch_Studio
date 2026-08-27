import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { LeftPanel } from '../LeftPanel'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'
import { serializeRichBody } from '../../richText/richTextContent'
import { CICLOS } from '../../../domain'
import { shortNodeLabel } from '../../Canvas/nodes/nodeTypes'

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

  it('la lista muestra el código corto "D{número}" de cada nodo y ningún UUID visible', () => {
    render(<LeftPanel />)

    // El proyecto recién creado ya tiene su diapositiva de inicio (D1) —
    // Tarea "Numeración corta": el sitio donde antes se mostraba la
    // etiqueta de tipo ("Diapositiva") ahora muestra "D{número}".
    expect(screen.getByText('D1')).toBeInTheDocument()
    expect(screen.getByText('Sin ref. oculta')).toBeInTheDocument()

    const startNode = useProjectStore.getState().project.graph.nodes[0]
    if (!startNode) throw new Error('El proyecto no tiene nodos')
    expect(screen.queryByText(startNode.id)).not.toBeInTheDocument()
  })

  it('ya no muestra el número "pelado" (sin la "D"), redundante con el código corto', () => {
    render(<LeftPanel />)
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
    })

    const nodes = useProjectStore.getState().project.graph.nodes
    // El código corto "D{número}" sigue mostrándose (comprobado en el test
    // anterior); lo que debe haber desaparecido es el número solo, sin la
    // "D" delante, en un nodo de texto aparte.
    for (const node of nodes) {
      expect(screen.queryByText(node.number.toString(), { selector: 'span' })).not.toBeInTheDocument()
    }
  })

  it('marca en la lista, de forma discreta, cuál es la diapositiva de inicio', () => {
    render(<LeftPanel />)
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
    })

    // Dos diapositivas en la lista (D1, D2), pero solo una marcada como
    // inicio.
    expect(screen.getAllByText(/^D\d+$/)).toHaveLength(2)
    expect(screen.getAllByTitle('Diapositiva de inicio')).toHaveLength(1)
    expect(screen.getByText('Inicio')).toBeInTheDocument()
  })

  it('click en un ítem de la lista selecciona ese nodo', () => {
    render(<LeftPanel />)

    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
    })
    const created = lastNode()

    fireEvent.click(screen.getByText(shortNodeLabel(created)))

    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([created.id])
  })

  it('click en un ítem de la lista también pide centrar el lienzo en ese nodo (focusRequestNodeId)', () => {
    render(<LeftPanel />)

    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 })
    })
    const created = lastNode()

    fireEvent.click(screen.getByText(shortNodeLabel(created)))

    expect(useProjectStore.getState().ui.focusRequestNodeId).toBe(created.id)
  })

  it('ilumina en la lista la diapositiva actualmente seleccionada (sistema de guiaje)', () => {
    render(<LeftPanel />)
    // A través del botón "+ Diapositiva" (no de la acción de dominio
    // directamente): es `LeftPanel.handleCreate` quien selecciona el nodo
    // recién creado, la acción de dominio por sí sola no selecciona nada.
    fireEvent.click(screen.getByText('+ Diapositiva'))
    const created = lastNode()

    const createdItem = screen.getByText(shortNodeLabel(created)).closest('button')
    expect(createdItem).not.toBeNull()
    expect(createdItem).toHaveAttribute('aria-current', 'true')

    // El resto de ítems de la lista no están marcados como actuales.
    const start = useProjectStore.getState().project.graph.startNodeId
    const startNode = useProjectStore.getState().project.graph.nodes.find((n) => n.id === start)
    if (!startNode) throw new Error('No se encontró la diapositiva de inicio')
    const startItem = screen.getByText(shortNodeLabel(startNode)).closest('button')
    expect(startItem).not.toHaveAttribute('aria-current')

    // Al seleccionar otra diapositiva, la iluminación se mueve con ella.
    fireEvent.click(screen.getByText(shortNodeLabel(startNode)))
    expect(screen.getByText(shortNodeLabel(startNode)).closest('button')).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByText(shortNodeLabel(created)).closest('button')).not.toHaveAttribute(
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

    // Tarea "Numeración corta": la etiqueta de tipo dentro del nombre
    // accesible del botón ahora es el código corto "D{número}".
    expect(screen.getAllByRole('button', { name: /D\d+/ }).length).toBeGreaterThanOrEqual(2)
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
    expect(screen.getByText(shortNodeLabel(intro))).toBeInTheDocument()
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
    expect(screen.getByText(shortNodeLabel(intro))).toBeInTheDocument()
    expect(screen.queryByText('Sin relación')).not.toBeInTheDocument()
    // El id/slug interno del ciclo no debería aparecer nunca en pantalla.
    expect(screen.queryByText(ciclo.id)).not.toBeInTheDocument()

    // Búsqueda por el NOMBRE de la asignatura.
    fireEvent.change(searchInput(), { target: { value: asignatura.name.toLowerCase() } })
    expect(screen.getByText(shortNodeLabel(intro))).toBeInTheDocument()
    expect(screen.queryByText('Sin relación')).not.toBeInTheDocument()
  })
})

describe('LeftPanel — arrastrar-y-soltar la lista de diapositivas (único mecanismo de reordenar)', () => {
  function searchInput(): HTMLElement {
    return screen.getByLabelText('Buscar en el proyecto')
  }

  function nodeIds(): string[] {
    return useProjectStore.getState().project.graph.nodes.map((n) => n.id)
  }

  /** `DataTransfer` mínimo (jsdom no lo implementa): basta con lo que usa
   *  `LeftPanel.tsx` (`setData`/`getData`/`effectAllowed`/`dropEffect`). */
  function makeDataTransfer() {
    const store: Record<string, string> = {}
    return {
      effectAllowed: '',
      dropEffect: '',
      setData: (format: string, value: string) => {
        store[format] = value
      },
      getData: (format: string) => store[format] ?? '',
    }
  }

  /** Fila (`<li>`) de la lista del nodo dado, localizada por su código corto
   *  "D{número}" (`shortNodeLabel`, único por nodo). */
  function rowFor(node: { number: number }): HTMLElement {
    const row = screen.getByText(shortNodeLabel(node)).closest('li')
    if (!row) throw new Error(`No se encontró la fila de ${shortNodeLabel(node)}`)
    return row
  }

  /** Sustituye `getBoundingClientRect` por un rectángulo fijo y conocido:
   *  en jsdom, sin layout real, el rectángulo por defecto (`src/test/setup.ts`)
   *  es el mismo tamaño fijo para TODOS los elementos, lo que no permite
   *  distinguir la mitad superior de la inferior de una fila concreta al
   *  calcular `before`/`after` en `handleDragOver`. */
  function stubRect(row: HTMLElement, top: number, height: number) {
    row.getBoundingClientRect = () =>
      ({
        top,
        height,
        bottom: top + height,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: top,
        toJSON() {
          return {}
        },
      }) as DOMRect
  }

  /**
   * Despacha un evento de arrastre nativo directamente (`dispatchEvent`, en
   * vez de `fireEvent.drag*` de Testing Library): jsdom NO implementa la
   * clase `DragEvent` (solo `Event`/`MouseEvent`), así que
   * `@testing-library/dom` cae a un `Event` genérico para estos tipos —
   * que sí admite `dataTransfer` (tiene un caso especial, ver
   * `node_modules/@testing-library/dom/dist/events.js`), pero DESCARTA
   * silenciosamente `clientY` (no es una propiedad reconocida del
   * constructor `Event`, y Testing Library no la reenvía "a mano" para
   * estos eventos). Sin `clientY` de verdad, `handleDragOver` no podría
   * distinguir nunca "soltar antes" de "soltar después". Aquí se define
   * `clientY`/`dataTransfer` directamente sobre el evento con
   * `Object.defineProperty` (permitido porque `Event`/`MouseEvent` los
   * declaran como propiedades normales del prototipo, sobreescribibles por
   * instancia) y se despacha envuelto en `act` (que Testing Library aplica
   * automáticamente dentro de `fireEvent`, pero no al llamar
   * `dispatchEvent` directamente).
   */
  function dispatchDrag(
    type: 'dragstart' | 'dragover' | 'drop' | 'dragend',
    target: HTMLElement,
    options: { dataTransfer: ReturnType<typeof makeDataTransfer>; clientY?: number },
  ) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: options.dataTransfer, configurable: true })
    if (options.clientY !== undefined) {
      Object.defineProperty(event, 'clientY', { value: options.clientY, configurable: true })
    }
    act(() => {
      target.dispatchEvent(event)
    })
  }

  it('arrastrar el primer nodo y soltarlo DESPUÉS de un nodo no adyacente lo reordena a esa posición (reorderNode con el índice esperado)', () => {
    render(<LeftPanel />)
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Segunda' })
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Tercera' })
    })
    // Orden inicial real: [Inicio(0), Segunda(1), Tercera(2)].
    const [inicioId, segundaId, terceraId] = nodeIds()
    if (!inicioId || !segundaId || !terceraId) throw new Error('setup inválido')
    const inicio = useProjectStore.getState().project.graph.nodes[0]
    const tercera = useProjectStore.getState().project.graph.nodes[2]
    if (!inicio || !tercera) throw new Error('setup inválido')

    const dataTransfer = makeDataTransfer()
    const draggedRow = rowFor(inicio)
    const targetRow = rowFor(tercera)
    stubRect(targetRow, 100, 40)

    dispatchDrag('dragstart', draggedRow, { dataTransfer })
    // clientY=135 cae en la mitad INFERIOR del rectángulo simulado
    // (top:100, height:40 → mitad en 120) → "after" — soltar DESPUÉS de
    // "Tercera", no adyacente al origen ("Inicio" estaba en el índice 0).
    dispatchDrag('dragover', targetRow, { dataTransfer, clientY: 135 })
    dispatchDrag('drop', targetRow, { dataTransfer })

    // "Inicio" pasa a ir justo después de "Tercera": [Segunda, Tercera,
    // Inicio] — no es un simple intercambio con el vecino, confirma que
    // llega a una posición no adyacente.
    expect(nodeIds()).toEqual([segundaId, terceraId, inicioId])
  })

  it('arrastrar el último nodo y soltarlo ANTES del primero lo reordena a esa posición', () => {
    render(<LeftPanel />)
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Segunda' })
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Tercera' })
    })
    const [inicioId, segundaId, terceraId] = nodeIds()
    if (!inicioId || !segundaId || !terceraId) throw new Error('setup inválido')
    const inicio = useProjectStore.getState().project.graph.nodes[0]
    const tercera = useProjectStore.getState().project.graph.nodes[2]
    if (!inicio || !tercera) throw new Error('setup inválido')

    const dataTransfer = makeDataTransfer()
    const draggedRow = rowFor(tercera)
    const targetRow = rowFor(inicio)
    stubRect(targetRow, 100, 40)

    dispatchDrag('dragstart', draggedRow, { dataTransfer })
    // clientY=105 cae en la mitad SUPERIOR del rectángulo simulado
    // (top:100, height:40 → mitad en 120) → "before".
    dispatchDrag('dragover', targetRow, { dataTransfer, clientY: 105 })
    dispatchDrag('drop', targetRow, { dataTransfer })

    // "Tercera" pasa a ir justo antes de "Inicio": [Tercera, Inicio,
    // Segunda].
    expect(nodeIds()).toEqual([terceraId, inicioId, segundaId])
  })

  it('muestra una pista visual durante el arrastre (opacidad reducida en el ítem arrastrado)', () => {
    render(<LeftPanel />)
    act(() => {
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Segunda' })
    })
    const inicio = useProjectStore.getState().project.graph.nodes[0]
    if (!inicio) throw new Error('setup inválido')

    const dataTransfer = makeDataTransfer()
    const row = rowFor(inicio)
    expect(row.className).not.toMatch(/nodeRowDragging/)

    dispatchDrag('dragstart', row, { dataTransfer })
    expect(row.className).toMatch(/nodeRowDragging/)

    dispatchDrag('dragend', row, { dataTransfer })
    expect(row.className).not.toMatch(/nodeRowDragging/)
  })

  it('con texto de búsqueda activo, el arrastre está deshabilitado y no reordena', () => {
    render(<LeftPanel />)
    const startId = useProjectStore.getState().project.graph.startNodeId
    act(() => {
      // Título explícito en las tres (en vez del "Sin ref. oculta" por
      // defecto de la de inicio): así una búsqueda con una letra común a
      // las tres mantiene las tres filas visibles, imprescindible para
      // poder localizarlas y simular el gesto de arrastre completo.
      useProjectStore.getState().updateNode(startId, { title: 'Primera' })
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Segunda' })
      useProjectStore.getState().createNode('slide', { x: 0, y: 0 }, { title: 'Tercera' })
    })
    const before = nodeIds()
    const inicio = useProjectStore.getState().project.graph.nodes[0]
    const tercera = useProjectStore.getState().project.graph.nodes[2]
    if (!inicio || !tercera) throw new Error('setup inválido')

    // "e" aparece en las tres: Prim-e-ra, S-e-gunda, T-e-rc-e-ra.
    fireEvent.change(searchInput(), { target: { value: 'e' } })
    expect(screen.getByText('Primera')).toBeInTheDocument()
    expect(screen.getByText('Segunda')).toBeInTheDocument()
    expect(screen.getByText('Tercera')).toBeInTheDocument()

    const draggedRow = rowFor(inicio)
    const targetRow = rowFor(tercera)
    expect(draggedRow).toHaveAttribute('draggable', 'false')
    expect(targetRow).toHaveAttribute('draggable', 'false')

    const dataTransfer = makeDataTransfer()
    dispatchDrag('dragstart', draggedRow, { dataTransfer })
    dispatchDrag('dragover', targetRow, { dataTransfer })
    dispatchDrag('drop', targetRow, { dataTransfer })

    expect(nodeIds()).toEqual(before)
  })
})
