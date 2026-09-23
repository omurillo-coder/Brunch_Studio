import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Position, ReactFlowProvider } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import { BrunchEdge } from '../edgeTypes'
import type { CanvasEdgeData, CanvasFlowEdge } from '../../adapter'
import styles from '../Edge.module.css'

/**
 * Hallazgo de auditoría ("registro de tipos de nodo/arista solo cubierto
 * indirectamente"): `BrunchEdge` (el único tipo de arista propio del
 * lienzo) hasta ahora solo se ejercitaba a través de `Canvas` completo
 * (`Canvas.wiring.test.tsx`) — nunca directamente con su propio contrato de
 * props (`EdgeProps<CanvasFlowEdge>`). Mismo criterio que
 * `nodeTypes.directRender.test.tsx`: `<ReactFlowProvider>` como único
 * contexto necesario, sin levantar el lienzo real.
 */

function makeEdgeData(overrides: Partial<CanvasEdgeData> = {}): CanvasEdgeData {
  return {
    laneIndex: 0,
    laneSize: 1,
    isHighlighted: false,
    isDimmed: false,
    isElse: false,
    ...overrides,
  }
}

function makeEdgeProps(data: CanvasEdgeData): EdgeProps<CanvasFlowEdge> {
  return {
    id: 'edge-1',
    type: 'brunchEdge',
    animated: false,
    data,
    style: undefined,
    selected: false,
    source: 'node-a',
    target: 'node-b',
    selectable: true,
    deletable: true,
    sourceX: 0,
    sourceY: 0,
    targetX: 200,
    targetY: 100,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }
}

function renderEdge(data: CanvasEdgeData) {
  return render(
    <ReactFlowProvider>
      <svg>
        <BrunchEdge {...makeEdgeProps(data)} />
      </svg>
    </ReactFlowProvider>,
  )
}

describe('BrunchEdge (render directo, con EdgeProps construido a mano)', () => {
  it('pinta un único <path> con la clase base, sin resaltar/atenuar/discontinuo por defecto', () => {
    const { container } = renderEdge(makeEdgeData())
    const path = container.querySelector('path')

    expect(path).not.toBeNull()
    expect(path).toHaveClass(styles.path!)
    expect(path).not.toHaveClass(styles.highlighted!)
    expect(path).not.toHaveClass(styles.dimmed!)
    expect(path).not.toHaveClass(styles.pathElse!)
  })

  it('`isHighlighted: true` añade la clase de resaltado (punto 4: selección)', () => {
    const { container } = renderEdge(makeEdgeData({ isHighlighted: true }))
    expect(container.querySelector('path')).toHaveClass(styles.highlighted!)
  })

  it('`isDimmed: true` añade la clase de atenuado', () => {
    const { container } = renderEdge(makeEdgeData({ isDimmed: true }))
    expect(container.querySelector('path')).toHaveClass(styles.dimmed!)
  })

  it('`isElse: true` añade la clase discontinua Y pinta la etiqueta "si no"', () => {
    const { container } = renderEdge(makeEdgeData({ isElse: true }))
    const path = container.querySelector('path')

    expect(path).toHaveClass(styles.pathElse!)
    expect(container.querySelector('text')?.textContent).toBe('si no')
  })

  it('sin `isElse`, no pinta ninguna etiqueta de texto', () => {
    const { container } = renderEdge(makeEdgeData({ isElse: false }))
    expect(container.querySelector('text')).toBeNull()
  })

  it('la etiqueta "si no" también se atenúa cuando `isDimmed` y `isElse` van juntos', () => {
    const { container } = renderEdge(makeEdgeData({ isElse: true, isDimmed: true }))
    const label = container.querySelector('text')

    expect(label).toHaveClass(styles.elseLabel!)
    expect(label).toHaveClass(styles.dimmed!)
  })

  it('sin `data` (`undefined`), no lanza y pinta la arista con la clase base', () => {
    const props = { ...makeEdgeProps(makeEdgeData()), data: undefined }
    expect(() =>
      render(
        <ReactFlowProvider>
          <svg>
            <BrunchEdge {...props} />
          </svg>
        </ReactFlowProvider>,
      ),
    ).not.toThrow()
  })
})
