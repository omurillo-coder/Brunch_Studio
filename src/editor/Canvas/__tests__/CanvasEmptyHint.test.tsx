import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { CanvasEmptyHint } from '../CanvasEmptyHint'
import { useProjectStore } from '../../../store'
import { resetProjectStore } from '../../../store/testHelpers'

/**
 * Hallazgo de auditoría ("sin onboarding en un proyecto nuevo 'En
 * blanco'"): `CanvasEmptyHint` se muestra solo mientras el proyecto tiene
 * un único nodo (el estado justo tras crear "En blanco") y desaparece en
 * cuanto se añade cualquier otro.
 */

beforeEach(() => {
  resetProjectStore()
})

describe('CanvasEmptyHint', () => {
  it('se muestra con el proyecto "de fábrica" (un único nodo)', () => {
    render(<CanvasEmptyHint />)
    expect(screen.getByRole('note')).toHaveTextContent('Arrastra desde el borde')
  })

  it('se sigue mostrando con dos nodos — el estado real de un proyecto "En blanco" recién creado (Inicio + una diapositiva, ver `buildBlankTemplate`)', () => {
    act(() => {
      useProjectStore.getState().createNode('intro', { x: -200, y: 0 })
    })
    render(<CanvasEmptyHint />)
    expect(screen.getByRole('note')).toBeInTheDocument()
  })

  it('desaparece en cuanto el proyecto tiene un tercer nodo', () => {
    act(() => {
      useProjectStore.getState().createNode('intro', { x: -200, y: 0 })
    })
    render(<CanvasEmptyHint />)
    expect(screen.getByRole('note')).toBeInTheDocument()

    act(() => {
      useProjectStore.getState().createNode('final', { x: 200, y: 0 })
    })

    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})
