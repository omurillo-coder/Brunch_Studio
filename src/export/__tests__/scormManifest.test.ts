import { describe, expect, it } from 'vitest'
import { buildScormManifest } from '../scormManifest'
import type { ProjectDocument } from '../../domain'

/**
 * Tests del generador del `imsmanifest.xml` de SCORM 2004 4ª edición
 * (Milestone 3, fase 2).
 */

function sampleProject(overrides: Partial<ProjectDocument['metadata']> = {}): ProjectDocument {
  return {
    schemaVersion: 1,
    metadata: {
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Escenario de prueba',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
    settings: {},
    variables: [],
    graph: {
      nodes: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          number: 1,
          type: 'final',
          position: { x: 0, y: 0 },
          title: 'Fin',
          body: '',
        },
      ],
      startNodeId: '11111111-1111-4111-8111-111111111111',
    },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  }
}

/** Parsea el XML con `DOMParser` y falla si contiene un `parsererror`. */
function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    throw new Error(`XML inválido: ${parserError.textContent}`)
  }
  return doc
}

describe('buildScormManifest', () => {
  it('genera un XML válido y parseable', () => {
    const xml = buildScormManifest(sampleProject())
    expect(() => parseXml(xml)).not.toThrow()
  })

  it('referencia index.html como recurso webcontent/sco', () => {
    const xml = buildScormManifest(sampleProject())
    const doc = parseXml(xml)

    const resource = doc.querySelector('resource')
    expect(resource?.getAttribute('href')).toBe('index.html')
    expect(resource?.getAttribute('type')).toBe('webcontent')
    expect(resource?.getAttributeNS('http://www.adlnet.org/xsd/adlcp_v1p3', 'scormType')).toBe(
      'sco',
    )
    expect(resource?.querySelector('file')?.getAttribute('href')).toBe('index.html')
  })

  it('usa los namespaces y el schemaversion de SCORM 2004 4ª edición', () => {
    const xml = buildScormManifest(sampleProject())
    const doc = parseXml(xml)

    expect(doc.documentElement.getAttribute('xmlns')).toBe(
      'http://www.imsglobal.org/xsd/imscp_v1p1',
    )
    expect(doc.documentElement.getAttribute('xmlns:adlcp')).toBe(
      'http://www.adlnet.org/xsd/adlcp_v1p3',
    )
    expect(doc.querySelector('schema')?.textContent).toBe('ADL SCORM')
    expect(doc.querySelector('schemaversion')?.textContent).toBe('2004 4th Edition')
  })

  it('usa el nombre del proyecto como título de organización e item', () => {
    const xml = buildScormManifest(sampleProject({ name: 'Mi escenario' }))
    const doc = parseXml(xml)

    const titles = [...doc.querySelectorAll('title')].map((node) => node.textContent)
    expect(titles).toContain('Mi escenario')
    expect(doc.querySelector('item')?.querySelector('title')?.textContent).toBe('Mi escenario')
  })

  it('escapa caracteres especiales de XML en el título', () => {
    const xml = buildScormManifest(sampleProject({ name: 'Casos <difíciles> & "raros"' }))

    expect(xml).toContain('Casos &lt;difíciles&gt; &amp; &quot;raros&quot;')
    expect(xml).not.toContain('<difíciles>')

    const doc = parseXml(xml)
    expect(doc.querySelector('organization')?.querySelector('title')?.textContent).toBe(
      'Casos <difíciles> & "raros"',
    )
  })

  it('usa "Experiencia interactiva" cuando el nombre está en blanco', () => {
    const xml = buildScormManifest(sampleProject({ name: '   ' }))
    const doc = parseXml(xml)

    expect(doc.querySelector('organization')?.querySelector('title')?.textContent).toBe(
      'Experiencia interactiva',
    )
  })

  it('produce un identifier de manifiesto válido como XML ID a partir del UUID del proyecto', () => {
    const xml = buildScormManifest(sampleProject())
    const doc = parseXml(xml)

    const identifier = doc.documentElement.getAttribute('identifier')
    expect(identifier).toBeTruthy()
    expect(identifier).toMatch(/^[A-Za-z_][A-Za-z0-9_.-]*$/)
    expect(identifier).toContain('99999999-9999-4999-8999-999999999999')
  })

  it('es determinista: el mismo documento produce siempre el mismo XML', () => {
    const project = sampleProject()
    expect(buildScormManifest(project)).toBe(buildScormManifest(project))
  })
})
