import { beforeEach, describe, expect, it } from 'vitest'
import {
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_MIN_WIDTH,
  clampInspectorWidth,
  inspectorMaxWidth,
  loadInspectorWidth,
  loadLeftPanelVisible,
  saveInspectorWidth,
  saveLeftPanelVisible,
} from '../uiPreferences'

beforeEach(() => {
  window.localStorage.clear()
})

describe('loadLeftPanelVisible / saveLeftPanelVisible', () => {
  it('visible por defecto si nunca se guardó nada', () => {
    expect(loadLeftPanelVisible()).toBe(true)
  })

  it('persiste y recupera el valor guardado', () => {
    saveLeftPanelVisible(false)
    expect(loadLeftPanelVisible()).toBe(false)

    saveLeftPanelVisible(true)
    expect(loadLeftPanelVisible()).toBe(true)
  })
})

describe('clampInspectorWidth / inspectorMaxWidth', () => {
  it('nunca baja del mínimo', () => {
    expect(clampInspectorWidth(10, 2000)).toBe(INSPECTOR_MIN_WIDTH)
  })

  it('nunca supera la mitad del ancho de la ventana', () => {
    expect(clampInspectorWidth(900, 1000)).toBe(inspectorMaxWidth(1000))
    expect(inspectorMaxWidth(1000)).toBe(500)
  })

  it('deja pasar un valor ya dentro de los límites', () => {
    expect(clampInspectorWidth(400, 2000)).toBe(400)
  })

  it('en una ventana muy estrecha, gana el mínimo aunque supere la mitad de la ventana', () => {
    expect(clampInspectorWidth(100, 200)).toBe(INSPECTOR_MIN_WIDTH)
  })
})

describe('loadInspectorWidth / saveInspectorWidth', () => {
  it('devuelve el ancho por defecto si nunca se guardó nada', () => {
    expect(loadInspectorWidth(2000)).toBe(INSPECTOR_DEFAULT_WIDTH)
  })

  it('persiste y recupera el ancho guardado, ya ajustado a los límites vigentes', () => {
    saveInspectorWidth(350)
    expect(loadInspectorWidth(2000)).toBe(350)

    // Si la ventana se ha vuelto más estrecha desde que se guardó, el valor
    // recuperado se ajusta al nuevo máximo.
    expect(loadInspectorWidth(600)).toBe(inspectorMaxWidth(600))
  })

  it('un valor corrupto en localStorage cae al ancho por defecto sin lanzar', () => {
    window.localStorage.setItem('brunch-studio:inspector-width', 'no-es-un-numero')
    expect(loadInspectorWidth(2000)).toBe(INSPECTOR_DEFAULT_WIDTH)
  })
})
