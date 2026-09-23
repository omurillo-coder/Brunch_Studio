import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReactFlowProvider, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { FinalNodeView, IntroNodeView, SlideNodeView } from '../nodeTypes'
import type { CanvasFlowNode, CanvasNodeData } from '../../adapter'
import styles from '../NodeCard.module.css'

/**
 * Hallazgo de auditoría ("registro de tipos de nodo/arista solo cubierto
 * indirectamente"): `SlideNodeView`/`FinalNodeView`/`IntroNodeView` (los
 * tres componentes de `nodeTypes`, el mapa que `@xyflow/react` usa para
 * pintar cada nodo) hasta ahora solo se ejercitaban a través de `Canvas`
 * completo (`NodeCard.*.test.tsx`) — nunca directamente con su propio
 * contrato de props (`NodeProps<CanvasFlowNode>`). Este archivo los
 * renderiza uno a uno, con datos construidos a mano.
 *
 * `<ReactFlowProvider>` (sin `<ReactFlow>` entero encima): el mínimo
 * contexto que necesita `<Handle>` (usado dentro de los tres componentes)
 * para no lanzar por falta de store interno de la librería — no hace falta
 * levantar el lienzo real para esto.
 */

function makeNodeProps(data: CanvasNodeData): NodeProps<CanvasFlowNode> {
  return {
    id: 'node-1',
    data,
    width: 180,
    height: 108,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    dragHandle: undefined,
    parentId: undefined,
    type: 'slide',
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  }
}

function baseData(overrides: Partial<CanvasNodeData> = {}): CanvasNodeData {
  return {
    nodeType: 'slide',
    number: 1,
    title: '',
    isStart: false,
    hasNoOutgoing: false,
    isHighlighted: false,
    isDimmed: false,
    usesVariables: false,
    ...overrides,
  }
}

function renderWithProvider(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>)
}

describe('SlideNodeView (render directo, con NodeProps construido a mano)', () => {
  it('pinta el título, el código corto "D{n}" y el contenido pasados en `data`', () => {
    const data = baseData({ title: 'Bienvenida', number: 3 })
    renderWithProvider(<SlideNodeView {...makeNodeProps(data)} />)

    expect(screen.getByText('Bienvenida')).toBeInTheDocument()
    expect(screen.getByText('D3')).toBeInTheDocument()
  })

  it('pinta cada respuesta de `data.responses` como una fila de texto', () => {
    const data = baseData({
      responses: [
        { id: 'r1', text: 'Sí' },
        { id: 'r2', text: 'No' },
      ],
    })
    renderWithProvider(<SlideNodeView {...makeNodeProps(data)} />)

    expect(screen.getByText('Sí')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('sin respuestas, no pinta ninguna fila de respuesta', () => {
    renderWithProvider(<SlideNodeView {...makeNodeProps(baseData())} />)

    expect(screen.queryByText(/Sí|No/)).not.toBeInTheDocument()
  })

  it('`hasNoOutgoing: true` pinta el badge de aviso "sin salida"', () => {
    const { container } = renderWithProvider(
      <SlideNodeView {...makeNodeProps(baseData({ hasNoOutgoing: true }))} />,
    )
    expect(container.querySelector(`.${styles.warningBadge}`)).toBeInTheDocument()
  })

  it('`usesVariables: true` añade la clase del doble contorno (hallazgo de auditoría de variables)', () => {
    const { container } = renderWithProvider(
      <SlideNodeView {...makeNodeProps(baseData({ usesVariables: true }))} />,
    )
    expect(container.querySelector(`.${styles.cardUsesVariables}`)).toBeInTheDocument()
  })

  it('`usesVariables: false` no añade esa clase', () => {
    const { container } = renderWithProvider(
      <SlideNodeView {...makeNodeProps(baseData({ usesVariables: false }))} />,
    )
    expect(container.querySelector(`.${styles.cardUsesVariables}`)).not.toBeInTheDocument()
  })
})

describe('FinalNodeView (render directo)', () => {
  it('pinta el código corto fijo "FINAL", sea cual sea `number`', () => {
    renderWithProvider(
      <FinalNodeView {...makeNodeProps(baseData({ nodeType: 'final', number: 42 }))} />,
    )
    expect(screen.getByText('FINAL')).toBeInTheDocument()
  })

  it('pinta el fragmento de `bodyPreview` cuando está presente', () => {
    renderWithProvider(
      <FinalNodeView
        {...makeNodeProps(baseData({ nodeType: 'final', bodyPreview: 'Fin de la historia' }))}
      />,
    )
    expect(screen.getByText('Fin de la historia')).toBeInTheDocument()
  })
})

describe('IntroNodeView (render directo)', () => {
  it('pinta el código corto fijo "INICIO", sea cual sea `number`', () => {
    renderWithProvider(
      <IntroNodeView {...makeNodeProps(baseData({ nodeType: 'intro', number: 1 }))} />,
    )
    expect(screen.getByText('INICIO')).toBeInTheDocument()
  })

  it('`hasNoOutgoing: true` pinta el badge de aviso, igual que en una diapositiva', () => {
    const { container } = renderWithProvider(
      <IntroNodeView {...makeNodeProps(baseData({ nodeType: 'intro', hasNoOutgoing: true }))} />,
    )
    expect(container.querySelector(`.${styles.warningBadge}`)).toBeInTheDocument()
  })
})
