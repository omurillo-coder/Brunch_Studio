import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_RECENT_PROJECTS,
  loadRecentProjects,
  recordRecentProject,
  removeRecentProject,
} from '../recentProjects'

beforeEach(() => {
  window.localStorage.clear()
})

describe('loadRecentProjects', () => {
  it('lista vacía si nunca se guardó nada', () => {
    expect(loadRecentProjects()).toEqual([])
  })

  it('un valor corrupto (JSON inválido) en localStorage no lanza: lista vacía', () => {
    window.localStorage.setItem('brunch-studio:recent-projects', '{no es json')
    expect(loadRecentProjects()).toEqual([])
  })

  it('un valor con forma inesperada (no es un array) no lanza: lista vacía', () => {
    window.localStorage.setItem('brunch-studio:recent-projects', '{"path":"/tmp/a.brunch"}')
    expect(loadRecentProjects()).toEqual([])
  })

  it('descarta entradas individuales con forma inválida sin descartar el resto', () => {
    window.localStorage.setItem(
      'brunch-studio:recent-projects',
      JSON.stringify([
        { path: '/tmp/valido.brunch', name: 'Válido', lastOpenedAt: '2026-01-01T00:00:00.000Z' },
        { path: '/tmp/incompleto.brunch' },
        'no es un objeto',
      ]),
    )
    const entries = loadRecentProjects()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.path).toBe('/tmp/valido.brunch')
  })
})

describe('recordRecentProject', () => {
  it('añade una entrada nueva al principio de la lista', () => {
    recordRecentProject('/tmp/a.brunch', 'A')
    recordRecentProject('/tmp/b.brunch', 'B')

    const entries = loadRecentProjects()
    expect(entries.map((entry) => entry.path)).toEqual(['/tmp/b.brunch', '/tmp/a.brunch'])
  })

  it('reabrir una ruta ya presente la mueve al principio en vez de duplicarla', () => {
    recordRecentProject('/tmp/a.brunch', 'A')
    recordRecentProject('/tmp/b.brunch', 'B')
    recordRecentProject('/tmp/a.brunch', 'A')

    const entries = loadRecentProjects()
    expect(entries.map((entry) => entry.path)).toEqual(['/tmp/a.brunch', '/tmp/b.brunch'])
  })

  it('reabrir una ruta ya presente actualiza su nombre guardado (renombrado fuera de la app)', () => {
    recordRecentProject('/tmp/a.brunch', 'Nombre antiguo')
    recordRecentProject('/tmp/a.brunch', 'Nombre nuevo')

    expect(loadRecentProjects()[0]?.name).toBe('Nombre nuevo')
  })

  it(`recorta la lista a ${MAX_RECENT_PROJECTS} entradas, descartando las más antiguas`, () => {
    for (let i = 0; i < MAX_RECENT_PROJECTS + 3; i += 1) {
      recordRecentProject(`/tmp/proyecto-${i}.brunch`, `Proyecto ${i}`)
    }

    const entries = loadRecentProjects()
    expect(entries).toHaveLength(MAX_RECENT_PROJECTS)
    // Las más recientes (las últimas añadidas) son las que sobreviven, en
    // orden de más nueva a más vieja.
    expect(entries[0]?.path).toBe(`/tmp/proyecto-${MAX_RECENT_PROJECTS + 2}.brunch`)
    expect(entries.at(-1)?.path).toBe('/tmp/proyecto-3.brunch')
  })
})

describe('removeRecentProject', () => {
  it('quita solo la ruta indicada, conserva el resto', () => {
    recordRecentProject('/tmp/a.brunch', 'A')
    recordRecentProject('/tmp/b.brunch', 'B')

    removeRecentProject('/tmp/a.brunch')

    const entries = loadRecentProjects()
    expect(entries.map((entry) => entry.path)).toEqual(['/tmp/b.brunch'])
  })

  it('quitar una ruta que no está en la lista no lanza ni cambia nada', () => {
    recordRecentProject('/tmp/a.brunch', 'A')

    expect(() => removeRecentProject('/tmp/no-existe.brunch')).not.toThrow()
    expect(loadRecentProjects()).toHaveLength(1)
  })
})
