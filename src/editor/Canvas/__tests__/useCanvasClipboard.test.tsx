import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetProjectStore } from '../../../store/testHelpers'
import { useProjectStore } from '../../../store'
import { Canvas } from '../Canvas'

/**
 * Tests de `useCanvasClipboard` (Ctrl/Cmd+C / Ctrl/Cmd+V para duplicar
 * diapositivas, Tarea 1). Se monta `Canvas` de verdad (como ya hace
 * `Canvas.test.tsx` para sus casos básicos: `@xyflow/react` monta sin
 * problema en jsdom para esto, no hace falta el stub de
 * `Canvas.wiring.test.tsx`) y se disparan los atajos con `fireEvent.keyDown`
 * sobre `window` o sobre un campo de texto concreto — mismo patrón que
 * `Topbar.test.tsx` usa para el atajo de deshacer/rehacer.
 */

beforeEach(() => {
  resetProjectStore()
})

function startNodeId(): string {
  return useProjectStore.getState().project.graph.startNodeId
}

describe('useCanvasClipboard — Ctrl/Cmd+C/V fuera de un campo editable', () => {
  it('Ctrl+C guarda la selección en ui.clipboardNodeIds y Ctrl+V duplica, seleccionando la copia', async () => {
    render(<Canvas />)
    await screen.findByText('Diapositiva')

    const startId = startNodeId()
    act(() => {
      useProjectStore.getState().selectNode(startId)
    })

    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    expect(useProjectStore.getState().ui.clipboardNodeIds).toEqual([startId])

    const nodesBefore = useProjectStore.getState().project.graph.nodes.length
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

    expect(useProjectStore.getState().project.graph.nodes.length).toBe(nodesBefore + 1)
    const selected = useProjectStore.getState().selection.selectedNodeIds
    expect(selected).toHaveLength(1)
    expect(selected[0]).not.toBe(startId)
  })

  it('sin ningún nodo seleccionado, Ctrl+C no guarda nada en el portapapeles', async () => {
    render(<Canvas />)
    await screen.findByText('Diapositiva')
    act(() => {
      useProjectStore.getState().clearSelection()
    })

    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })

    expect(useProjectStore.getState().ui.clipboardNodeIds).toEqual([])
  })

  it('con el portapapeles vacío, Ctrl+V no duplica nada', async () => {
    render(<Canvas />)
    await screen.findByText('Diapositiva')
    const nodesBefore = useProjectStore.getState().project.graph.nodes.length

    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

    expect(useProjectStore.getState().project.graph.nodes.length).toBe(nodesBefore)
  })

  it('Ctrl+V duplica varios nodos guardados a la vez y deja seleccionadas todas las copias', async () => {
    render(<Canvas />)
    await screen.findByText('Diapositiva')

    act(() => {
      useProjectStore.getState().createNode('final', { x: 100, y: 100 })
    })
    const finalId = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.type === 'final')?.id
    const startId = startNodeId()
    if (!finalId) throw new Error('setup inválido')

    act(() => {
      useProjectStore.getState().setClipboardNodeIds([startId, finalId])
    })
    const nodesBefore = useProjectStore.getState().project.graph.nodes.length

    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

    expect(useProjectStore.getState().project.graph.nodes.length).toBe(nodesBefore + 2)
    expect(useProjectStore.getState().selection.selectedNodeIds).toHaveLength(2)
  })

  it('un id del portapapeles que ya no existe (borrado tras copiar) se ignora sin lanzar', async () => {
    render(<Canvas />)
    await screen.findByText('Diapositiva')

    act(() => {
      useProjectStore.getState().createNode('final', { x: 100, y: 100 })
    })
    const finalId = useProjectStore
      .getState()
      .project.graph.nodes.find((n) => n.type === 'final')?.id
    if (!finalId) throw new Error('setup inválido')

    act(() => {
      useProjectStore.getState().setClipboardNodeIds([finalId])
      useProjectStore.getState().deleteNode(finalId)
    })
    const nodesBefore = useProjectStore.getState().project.graph.nodes.length

    expect(() => fireEvent.keyDown(window, { key: 'v', ctrlKey: true })).not.toThrow()
    expect(useProjectStore.getState().project.graph.nodes.length).toBe(nodesBefore)
  })
})

describe('useCanvasClipboard — con el foco DENTRO de un campo editable (caso crítico de no romper)', () => {
  it('Ctrl+C dentro de un <input> no toca el portapapeles interno ni intercepta el evento', async () => {
    render(
      <>
        <Canvas />
        <input aria-label="campo de prueba" defaultValue="hola" />
      </>,
    )
    await screen.findByText('Diapositiva')

    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })

    const input = screen.getByLabelText('campo de prueba')
    input.focus()
    // Se dispara sobre el propio input (no sobre `window`) para que
    // `target` apunte al campo de texto, igual que ocurriría con un evento
    // real del navegador — mismo criterio que `Topbar.test.tsx`.
    const notCancelled = fireEvent.keyDown(input, { key: 'c', ctrlKey: true })

    // El resultado de `dispatchEvent` es `true` cuando NADIE llamó a
    // `preventDefault()`: así se confirma que el copiar nativo del
    // navegador queda libre de interferencia, no solo que el store no
    // cambió.
    expect(notCancelled).toBe(true)
    expect(useProjectStore.getState().ui.clipboardNodeIds).toEqual([])
  })

  it('Ctrl+V dentro de un <input>, con contenido ya en el portapapeles, no duplica ni intercepta el evento', async () => {
    render(
      <>
        <Canvas />
        <input aria-label="campo de prueba" defaultValue="hola" />
      </>,
    )
    await screen.findByText('Diapositiva')

    const startId = startNodeId()
    act(() => {
      // Simula un Ctrl+C previo hecho fuera del campo: el portapapeles ya
      // tiene contenido cuando llega el Ctrl+V dentro del input.
      useProjectStore.getState().setClipboardNodeIds([startId])
    })
    const nodesBefore = useProjectStore.getState().project.graph.nodes.length

    const input = screen.getByLabelText('campo de prueba')
    input.focus()
    const notCancelled = fireEvent.keyDown(input, { key: 'v', ctrlKey: true })

    expect(notCancelled).toBe(true)
    expect(useProjectStore.getState().project.graph.nodes.length).toBe(nodesBefore)
  })

  it('Ctrl+C dentro de un elemento contentEditable (equivalente al editor de cuerpo) tampoco duplica', async () => {
    render(<Canvas />)
    await screen.findByText('Diapositiva')

    act(() => {
      useProjectStore.getState().selectNode(startNodeId())
    })

    // jsdom no implementa `Element.isContentEditable` (queda `undefined` en
    // vez de reflejar el atributo `contentEditable`, limitación conocida —
    // por eso tampoco lo prueba `Topbar.test.tsx` para su propio
    // `isEditableTarget`). Se fuerza la propiedad para poder ejercitar de
    // verdad esta rama del criterio, en vez de dejarla sin cubrir.
    const editable = document.createElement('div')
    Object.defineProperty(editable, 'isContentEditable', { value: true, configurable: true })
    document.body.appendChild(editable)

    const notCancelled = fireEvent.keyDown(editable, { key: 'c', ctrlKey: true })

    expect(notCancelled).toBe(true)
    expect(useProjectStore.getState().ui.clipboardNodeIds).toEqual([])

    document.body.removeChild(editable)
  })
})
