import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Canvas } from '../Canvas'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'
import { serializeRichBody } from '../../richText/richTextContent'

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

    // Tarea "Numeración corta": el sitio donde antes se mostraba la
    // etiqueta de tipo ahora muestra el código corto "D{número}" — la
    // diapositiva de inicio sembrada por `resetProjectStore` es siempre D1.
    expect(await screen.findByText('D1')).toBeInTheDocument()
    // Tarea "Quitar el número pelado": el número solo, sin la "D" delante,
    // ya no se pinta aparte (era redundante con "D1").
    expect(screen.queryByText('1', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.getByText('Sin ref. oculta')).toBeInTheDocument()

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
    // Tarea "Numeración corta": las tres tarjetas (dos `slide` + un `final`)
    // muestran su código corto "D{número}" en vez de distinguirse por texto
    // de tipo — ya no hay "Diapositiva"/"Final" en la cabecera de la
    // tarjeta.
    expect(screen.getAllByText(/^D\d+$/)).toHaveLength(3)
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

describe('Canvas — pin de nota interna (tarea 6) y fragmento de contenido (tarea 8)', () => {
  it('sin nota interna, no muestra el icono de pin', async () => {
    render(<Canvas />)
    expect(await screen.findByText('D1')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Nota interna/)).not.toBeInTheDocument()
  })

  it('con una nota interna, muestra el icono de pin con el texto de la nota como tooltip', async () => {
    const startId = useProjectStore.getState().project.graph.startNodeId
    useProjectStore.getState().updateNode(startId, { internalNote: 'Pedir gráfico a diseño' })

    render(<Canvas />)

    const pin = await screen.findByLabelText('Nota interna: Pedir gráfico a diseño')
    expect(pin).toBeInTheDocument()
    expect(pin).toHaveAttribute('title', 'Nota interna: Pedir gráfico a diseño')
  })

  it('sin contenido, la tarjeta no muestra ningún fragmento de cuerpo', async () => {
    render(<Canvas />)
    expect(await screen.findByText('D1')).toBeInTheDocument()
    expect(screen.queryByText(/./, { selector: '[class*="bodyPreview"]' })).not.toBeInTheDocument()
  })

  it('con contenido, la tarjeta muestra un fragmento de texto plano del bloque de texto', async () => {
    const startId = useProjectStore.getState().project.graph.startNodeId
    const startNode = useProjectStore.getState().project.graph.nodes.find((n) => n.id === startId)
    const blockId = startNode?.type === 'slide' ? startNode.content[0]?.id : undefined
    if (!blockId) throw new Error('setup inválido')
    const body = serializeRichBody({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bienvenido al escenario' }] }],
    })
    useProjectStore.getState().updateTextBlockBody(startId, blockId, body)

    render(<Canvas />)

    expect(await screen.findByText('Bienvenido al escenario')).toBeInTheDocument()
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

/**
 * Regresión: "hacen falta dos clics para seleccionar una diapositiva".
 *
 * Solo reproducible sobre el montaje REAL de `@xyflow/react` (no sobre el
 * stub de `Canvas.wiring.test.tsx`, que invoca `onSelectionChange`
 * directamente y por tanto no ejercita en absoluto la lógica interna de
 * clic de la librería donde estaba el bug).
 *
 * Causa raíz (ver comentario largo de `handleNodeClick` en `Canvas.tsx`):
 * en la arquitectura "totalmente controlada" de este lienzo, la propia
 * `@xyflow/react` muta su estado interno de selección DESPUÉS del único
 * `store.setState(...)` que dispara para ese gesto, así que el primer clic
 * queda sin notificar y hace falta un segundo evento cualquiera (p.ej. otro
 * clic) para que la mutación, ya vieja, se propague. El arreglo añade
 * `onNodeClick` (que sí se invoca siempre, de forma síncrona, en el propio
 * clic) como disparador fiable de `selection.selectedNodeIds`.
 */
describe('Canvas — seleccionar una diapositiva con un único clic (real @xyflow/react)', () => {
  it('un solo clic sobre una diapositiva la selecciona de verdad (sin hacer falta un segundo clic)', async () => {
    render(<Canvas />)
    const startId = useProjectStore.getState().project.graph.startNodeId
    const nodeEl = await screen.findByTestId(`rf__node-${startId}`)

    fireEvent.click(nodeEl)

    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([startId])
  })

  it('un solo clic selecciona incluso justo después de haber hecho clic en el fondo (onPaneClick)', async () => {
    render(<Canvas />)
    const startId = useProjectStore.getState().project.graph.startNodeId
    const nodeEl = await screen.findByTestId(`rf__node-${startId}`)
    const pane = document.querySelector('.react-flow__pane')
    if (!pane) throw new Error('no se encontró el pane de @xyflow/react')

    // Clic en el fondo primero (limpia la selección, `onPaneClick`), como en
    // el escenario que reportó el usuario.
    fireEvent.click(pane)
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([])

    fireEvent.click(nodeEl)

    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([startId])
  })

  it('un solo clic sobre OTRA diapositiva, con una ya seleccionada, cambia la selección a la nueva', async () => {
    useProjectStore.getState().createNode('slide', { x: 200, y: 0 }, { title: 'Segunda' })
    render(<Canvas />)
    const { project } = useProjectStore.getState()
    const startId = project.graph.startNodeId
    const otherId = project.graph.nodes.find((n) => n.id !== startId)?.id
    if (!otherId) throw new Error('setup inválido')

    const startEl = await screen.findByTestId(`rf__node-${startId}`)
    const otherEl = await screen.findByTestId(`rf__node-${otherId}`)

    fireEvent.click(startEl)
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([startId])

    fireEvent.click(otherEl)
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([otherId])
  })

  it('Mayús+clic añade la diapositiva a la selección en vez de reemplazarla', async () => {
    useProjectStore.getState().createNode('slide', { x: 200, y: 0 }, { title: 'Segunda' })
    render(<Canvas />)
    const { project } = useProjectStore.getState()
    const startId = project.graph.startNodeId
    const otherId = project.graph.nodes.find((n) => n.id !== startId)?.id
    if (!otherId) throw new Error('setup inválido')

    const startEl = await screen.findByTestId(`rf__node-${startId}`)
    const otherEl = await screen.findByTestId(`rf__node-${otherId}`)

    fireEvent.click(startEl)
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([startId])

    fireEvent.click(otherEl, { shiftKey: true })
    expect(useProjectStore.getState().selection.selectedNodeIds).toEqual([startId, otherId])
  })
})
