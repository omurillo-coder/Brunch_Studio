import { describe, expect, it, vi } from 'vitest'
import { collectReferencedAssetIds, resolveExportAssets } from '../exportAssets'
import type { AssetData, AssetRepository } from '../../persistence'
import type { DecisionResponse, FinalNode, ProjectDocument, SlideNode } from '../../domain'

const SLIDE_A = '11111111-1111-4111-8111-11111111111a'
const SLIDE_B = '11111111-1111-4111-8111-11111111111b'
const FINAL = '11111111-1111-4111-8111-11111111111f'

function slide(id: string, overrides: Partial<SlideNode> = {}): SlideNode {
  return {
    id,
    number: 1,
    type: 'slide',
    position: { x: 0, y: 0 },
    title: '',
    body: '',
    targetNodeId: undefined,
    continueLabel: undefined,
    responses: [],
    imageAssetIds: [],
    audioAssetId: undefined,
    contentOrder: 'text-first',
    ...overrides,
  }
}

function response(overrides: Partial<DecisionResponse> = {}): DecisionResponse {
  return {
    id: 'response-id',
    letter: 'A',
    text: '',
    ...overrides,
  } as DecisionResponse
}

function project(nodes: (SlideNode | FinalNode)[]): ProjectDocument {
  return {
    schemaVersion: 1,
    metadata: {
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Proyecto',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    settings: {},
    variables: [],
    graph: { nodes, startNodeId: nodes[0]?.id ?? SLIDE_A },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  }
}

/** Doble de `AssetRepository` que devuelve datos para unos ids y falla para
 *  otros, para comprobar la tolerancia a fallos individuales. */
function fakeRepository(available: Record<string, AssetData>): AssetRepository {
  return {
    importAsset: vi.fn(),
    getAsset: vi.fn(async (_projectPath: string, assetId: string) => {
      const data = available[assetId]
      if (!data) {
        throw new Error(`asset ilegible: ${assetId}`)
      }
      return data
    }),
  } as unknown as AssetRepository
}

describe('collectReferencedAssetIds', () => {
  it('reúne imagen y audio de nodos y de respuestas, sin duplicados', () => {
    const doc = project([
      slide(SLIDE_A, { imageAssetIds: ['img-1'], audioAssetId: 'aud-1' }),
      slide(SLIDE_B, {
        imageAssetIds: ['img-1'], // repetido: no debe duplicarse
        responses: [
          response({ id: 'r1', imageAssetId: 'img-2' }),
          response({ id: 'r2', letter: 'B', audioAssetId: 'aud-2' }),
        ],
      }),
      { id: FINAL, number: 3, type: 'final', position: { x: 0, y: 0 }, title: '', body: '' },
    ])

    expect(collectReferencedAssetIds(doc)).toEqual(['img-1', 'aud-1', 'img-2', 'aud-2'])
  })

  it('reúne TODAS las imágenes de la lista de un nodo, en orden, sin duplicados', () => {
    const doc = project([
      slide(SLIDE_A, { imageAssetIds: ['img-1', 'img-2', 'img-1', 'img-3'] }),
    ])

    expect(collectReferencedAssetIds(doc)).toEqual(['img-1', 'img-2', 'img-3'])
  })

  it('devuelve una lista vacía si el proyecto no tiene ningún asset', () => {
    expect(collectReferencedAssetIds(project([slide(SLIDE_A)]))).toEqual([])
  })
})

describe('resolveExportAssets', () => {
  it('resuelve todos los assets legibles', async () => {
    const doc = project([slide(SLIDE_A, { imageAssetIds: ['img-1'], audioAssetId: 'aud-1' })])
    const repository = fakeRepository({
      'img-1': { mimeType: 'image/png', filename: 'a.png', dataBase64: 'AAA=' },
      'aud-1': { mimeType: 'audio/mpeg', filename: 'a.mp3', dataBase64: 'BBB=' },
    })

    const result = await resolveExportAssets('/tmp/p.brunch', doc, repository)

    expect(result.failedAssetIds).toEqual([])
    expect(result.assets).toEqual({
      'img-1': { mimeType: 'image/png', dataBase64: 'AAA=' },
      'aud-1': { mimeType: 'audio/mpeg', dataBase64: 'BBB=' },
    })
  })

  it('un asset que falla no rompe la resolución de los demás', async () => {
    const doc = project([
      slide(SLIDE_A, { imageAssetIds: ['roto'], audioAssetId: 'aud-1' }),
      slide(SLIDE_B, { responses: [response({ id: 'r1', imageAssetId: 'img-2' })] }),
    ])
    const repository = fakeRepository({
      'aud-1': { mimeType: 'audio/mpeg', filename: 'a.mp3', dataBase64: 'BBB=' },
      'img-2': { mimeType: 'image/jpeg', filename: 'b.jpg', dataBase64: 'CCC=' },
    })

    const result = await resolveExportAssets('/tmp/p.brunch', doc, repository)

    expect(result.failedAssetIds).toEqual(['roto'])
    expect(Object.keys(result.assets).sort()).toEqual(['aud-1', 'img-2'])
  })

  it('no rechaza aunque fallen todos los assets', async () => {
    const doc = project([slide(SLIDE_A, { imageAssetIds: ['roto-1'], audioAssetId: 'roto-2' })])
    const result = await resolveExportAssets('/tmp/p.brunch', doc, fakeRepository({}))

    expect(result.assets).toEqual({})
    expect(result.failedAssetIds).toEqual(['roto-1', 'roto-2'])
  })

  it('no pide nada al repositorio si el proyecto no tiene assets', async () => {
    const repository = fakeRepository({})
    const result = await resolveExportAssets('/tmp/p.brunch', project([slide(SLIDE_A)]), repository)

    expect(result).toEqual({ assets: {}, failedAssetIds: [] })
    expect(repository.getAsset).not.toHaveBeenCalled()
  })
})
