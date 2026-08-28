import { describe, expect, it } from 'vitest'
import { CICLOS, asignaturaWorkspaceName, cicloOutputName } from '../catalog'

describe('cicloOutputName', () => {
  it('quita el prefijo de código y el separador " - " de un nombre de ciclo', () => {
    expect(cicloOutputName('AC - Actividades comerciales')).toBe('Actividades comerciales')
    expect(cicloOutputName('ADAF - Asistencia a la Dirección / Administración y Finanzas')).toBe(
      'Asistencia a la Dirección / Administración y Finanzas',
    )
  })

  it('sin " - " en el nombre (p.ej. los troncales), lo devuelve tal cual', () => {
    expect(cicloOutputName('TRONCAL ESP')).toBe('TRONCAL ESP')
  })

  it('todos los ciclos del catálogo real producen un nombre no vacío', () => {
    for (const ciclo of CICLOS) {
      expect(cicloOutputName(ciclo.name).trim().length).toBeGreaterThan(0)
    }
  })
})

describe('asignaturaWorkspaceName', () => {
  it('añade el código de módulo (el propio id) entre paréntesis tras el nombre', () => {
    expect(asignaturaWorkspaceName({ id: 'IDMN_M01', name: 'Atención al paciente' })).toBe(
      'Atención al paciente (IDMN_M01)',
    )
  })
})
