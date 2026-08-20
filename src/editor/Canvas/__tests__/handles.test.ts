import { describe, expect, it } from 'vitest'
import { OUT_HANDLE_ID, parseResponseHandleId, resolveEmptyPaneDrop, responseHandleId } from '../handles'

describe('parseResponseHandleId', () => {
  it('recupera el responseId de un handle con prefijo response:', () => {
    expect(parseResponseHandleId(responseHandleId('resp-1'))).toBe('resp-1')
  })

  it('devuelve undefined para el handle de salida único y para valores nulos', () => {
    expect(parseResponseHandleId(OUT_HANDLE_ID)).toBeUndefined()
    expect(parseResponseHandleId(null)).toBeUndefined()
    expect(parseResponseHandleId(undefined)).toBeUndefined()
  })
})

describe('resolveEmptyPaneDrop', () => {
  it('resuelve el origen desde un start/content (fromHandle sin prefijo response:)', () => {
    const result = resolveEmptyPaneDrop({
      isValid: false,
      fromHandle: { nodeId: 'start-1', id: OUT_HANDLE_ID },
      droppedOnPane: true,
    })

    expect(result).toEqual({ sourceNodeId: 'start-1', sourceResponseId: undefined })
  })

  it('resuelve el origen y el responseId desde una respuesta de un nodo decision', () => {
    const result = resolveEmptyPaneDrop({
      isValid: false,
      fromHandle: { nodeId: 'decision-1', id: responseHandleId('resp-a') },
      droppedOnPane: true,
    })

    expect(result).toEqual({ sourceNodeId: 'decision-1', sourceResponseId: 'resp-a' })
  })

  it('trata isValid === null igual que false (conexión no completada)', () => {
    const result = resolveEmptyPaneDrop({
      isValid: null,
      fromHandle: { nodeId: 'start-1', id: OUT_HANDLE_ID },
      droppedOnPane: true,
    })

    expect(result).toEqual({ sourceNodeId: 'start-1', sourceResponseId: undefined })
  })

  it('devuelve null si la conexión es válida (ya la cubre el onConnect normal)', () => {
    const result = resolveEmptyPaneDrop({
      isValid: true,
      fromHandle: { nodeId: 'start-1', id: OUT_HANDLE_ID },
      droppedOnPane: true,
    })

    expect(result).toBeNull()
  })

  it('devuelve null si el drop no cayó sobre el pane vacío (p.ej. dentro de un nodo existente)', () => {
    const result = resolveEmptyPaneDrop({
      isValid: false,
      fromHandle: { nodeId: 'start-1', id: OUT_HANDLE_ID },
      droppedOnPane: false,
    })

    expect(result).toBeNull()
  })

  it('devuelve null si no había un handle de origen real', () => {
    const result = resolveEmptyPaneDrop({
      isValid: false,
      fromHandle: null,
      droppedOnPane: true,
    })

    expect(result).toBeNull()
  })
})
