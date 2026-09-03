import { readFileSync } from 'node:fs'
import path from 'node:path'
import NSpell from 'nspell'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNode, createProject, updateNode } from '../project'
import { connect } from '../graph'
import { addResponse, updateResponse } from '../responses'
import { addTextBlock, updateTextBlockBody } from '../content'
import {
  checkSpelling,
  cycleIssueId,
  detectCycles,
  detectUnlinkedResponses,
  spellingIssueId,
  tokenizeForSpelling,
  unlinkedResponseIssueId,
} from '../diagnostics'
import type { ProjectDocument } from '../schemas'

/** Ruta absoluta al fichero de datos `.aff`/`.dic` de `dictionary-es`
 *  instalado en `node_modules`, para el test de integración de más abajo.
 *  Basada en `process.cwd()` en vez de `import.meta.url`: bajo Vitest,
 *  `import.meta.url` de un fichero de test no siempre es un `file://` real
 *  (el transform de Vite lo reescribe), y `new URL(ruta_relativa, esa
 *  url)` falla entonces con "The URL must be of scheme file". `vitest run`
 *  siempre se invoca desde la raíz del repo (ver `package.json`, script
 *  `test`), así que `process.cwd()` es un ancla estable aquí. */
const dictionaryDir = path.join(process.cwd(), 'node_modules', 'dictionary-es')

// -----------------------------------------------------------------------
// Helpers de fixture, mismo estilo que src/domain/__tests__/validation.test.ts
// -----------------------------------------------------------------------

function otherNodeIdOf(project: ProjectDocument, type: 'slide' | 'final'): string {
  const node = project.graph.nodes.find(
    (candidate) => candidate.type === type && candidate.id !== project.graph.startNodeId,
  )
  if (!node) throw new Error(`No hay un nodo "${type}" distinto del inicio en el setup`)
  return node.id
}

function responseIdsOf(project: ProjectDocument, nodeId: string): string[] {
  const node = project.graph.nodes.find((candidate) => candidate.id === nodeId)
  return node?.type === 'slide' ? node.responses.map((response) => response.id) : []
}

// -----------------------------------------------------------------------
// detectCycles
// -----------------------------------------------------------------------

describe('detectCycles', () => {
  it('un grafo sin ciclos no detecta nada', () => {
    let project = createProject('P')
    project = createNode(project, 'final', { x: 100, y: 0 })
    const finalId = otherNodeIdOf(project, 'final')
    project = connect(project, project.graph.startNodeId, finalId)

    expect(detectCycles(project)).toEqual([])
  })

  it('detecta un ciclo simple A -> B -> A', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const slideId = otherNodeIdOf(project, 'slide')

    project = connect(project, startId, slideId)
    project = connect(project, slideId, startId)

    const cycles = detectCycles(project)
    expect(cycles).toHaveLength(1)
    expect(new Set(cycles[0]?.nodeIds)).toEqual(new Set([startId, slideId]))
  })

  it('un nodo que se apunta a sí mismo cuenta como ciclo de un único nodo', () => {
    const project = createProject('P')
    const startId = project.graph.startNodeId
    const selfLoop = connect(project, startId, startId)

    const cycles = detectCycles(selfLoop)
    expect(cycles).toHaveLength(1)
    expect(cycles[0]?.nodeIds).toEqual([startId])
  })

  it('petición de usuario (milestone "+1 fallo con Game Over"): un ciclo FORMADO ÍNTEGRAMENTE por nodos con `canvasBadge` NO cuenta — es el bucle de reintento intencional del pack', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const badgeSlideId = otherNodeIdOf(project, 'slide')

    project = connect(project, startId, badgeSlideId)
    project = connect(project, badgeSlideId, startId)
    // Sin marcar todavía: el mismo bucle SÍ cuenta como aviso normal.
    expect(detectCycles(project)).toHaveLength(1)

    project = updateNode(project, startId, { canvasBadge: 'plus-one-fallo' })
    project = updateNode(project, badgeSlideId, { canvasBadge: 'game-over' })
    expect(detectCycles(project)).toEqual([])
  })

  it('corrección de revisión de código: un bucle que solo PASA por un nodo con `canvasBadge` (junto con otros nodos ajenos al pack) SÍ cuenta — no es el bucle de reintento del pack, es un bucle real', () => {
    let project = createProject('P')
    project = createNode(project, 'slide', { x: 100, y: 0 })
    project = createNode(project, 'slide', { x: 200, y: 0 })
    const startId = project.graph.startNodeId
    const badgeSlideId = otherNodeIdOf(project, 'slide')
    const otherSlides = project.graph.nodes.filter(
      (node) => node.type === 'slide' && node.id !== startId,
    )
    const thirdSlideId = otherSlides.find((node) => node.id !== badgeSlideId)?.id
    if (!thirdSlideId) throw new Error('setup inválido')

    // Bucle de 3 nodos: startId -> badgeSlideId -> thirdSlideId -> startId.
    // Solo badgeSlideId lleva canvasBadge — el resto del ciclo es narrativa
    // ajena al pack.
    project = connect(project, startId, badgeSlideId)
    project = connect(project, badgeSlideId, thirdSlideId)
    project = connect(project, thirdSlideId, startId)
    project = updateNode(project, badgeSlideId, { canvasBadge: 'game-over' })

    const cycles = detectCycles(project)
    expect(cycles).toHaveLength(1)
    expect(new Set(cycles[0]?.nodeIds)).toEqual(new Set([startId, badgeSlideId, thirdSlideId]))
  })
})

// -----------------------------------------------------------------------
// detectUnlinkedResponses
// -----------------------------------------------------------------------

describe('detectUnlinkedResponses', () => {
  it('detecta una respuesta sin destino, con su texto', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    const [responseId] = responseIdsOf(project, startId)
    if (!responseId) throw new Error('setup inválido')
    project = updateResponse(project, startId, responseId, {
      text: 'Sí, quiero continuar',
    })

    const issues = detectUnlinkedResponses(project)
    expect(issues).toEqual([
      { nodeId: startId, responseId, responseText: 'Sí, quiero continuar' },
    ])
  })

  it('una respuesta con destino conectado no aparece', () => {
    let project = createProject('P')
    project = createNode(project, 'final', { x: 100, y: 0 })
    const startId = project.graph.startNodeId
    const finalId = otherNodeIdOf(project, 'final')
    project = addResponse(project, startId)
    const [responseId] = responseIdsOf(project, startId)
    if (!responseId) throw new Error('setup inválido')
    project = connect(project, startId, finalId, responseId)

    expect(detectUnlinkedResponses(project)).toEqual([])
  })

  it('una diapositiva "de continuar" (sin respuestas) no genera ningún aviso de este tipo', () => {
    // Sin destino de continuar tampoco: SLIDE_WITHOUT_TARGET de
    // validateProject cubriría este caso, pero detectUnlinkedResponses no
    // debe confundirlo con una respuesta suelta.
    const project = createProject('P')

    expect(detectUnlinkedResponses(project)).toEqual([])
  })

  it('petición de usuario (milestone "+1 fallo con Game Over"): una respuesta `actsAsExit` sin destino NO cuenta — actúa como el botón Salir a propósito', () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = addResponse(project, startId)
    const [responseId] = responseIdsOf(project, startId)
    if (!responseId) throw new Error('setup inválido')
    project = updateResponse(project, startId, responseId, {
      text: 'No, me rindo.',
      actsAsExit: true,
    })

    expect(detectUnlinkedResponses(project)).toEqual([])
  })
})

// -----------------------------------------------------------------------
// tokenizeForSpelling
// -----------------------------------------------------------------------

describe('tokenizeForSpelling', () => {
  it('separa por puntuación/espacios y descarta palabras de 1-2 letras', () => {
    expect(tokenizeForSpelling('Hola, ¿cómo estás tú? El día va bien.')).toEqual([
      'Hola',
      'cómo',
      'estás',
      'día',
      'bien',
    ])
  })

  it('los dígitos nunca forman parte de un token (p.ej. "COVID19" -> "COVID")', () => {
    expect(tokenizeForSpelling('El caso COVID19 afectó a 42 personas')).toEqual([
      'caso',
      'COVID',
      'afectó',
      'personas',
    ])
  })
})

// -----------------------------------------------------------------------
// checkSpelling
// -----------------------------------------------------------------------
//
// Decisión de test (documentada también en el informe final): se MOCKEA la
// carga del diccionario (`../spellingDictionary`) para los tests unitarios
// de abajo -- no queremos que cada test de `checkSpelling` dependa de
// resolver el `?url` de Vite hacia los ficheros de `dictionary-es` (mecanismo
// pensado para el navegador/Tauri, no para un test unitario en Node) ni de
// cargar el diccionario español real completo en cada aserción. Aparte, más
// abajo, un ÚNICO test de integración aislado carga el diccionario real
// (leyendo sus ficheros directamente del paquete instalado, sin pasar por el
// mecanismo `?url`/`fetch` de la app) para confirmar que `nspell` +
// `dictionary-es` funcionan de verdad juntos.

const CORRECT_WORDS = new Set(['hola', 'mundo', 'bienvenido', 'continuar', 'diapositiva'])

vi.mock('../spellingDictionary', () => ({
  loadSpanishSpellChecker: vi.fn(async () => ({
    correct: (word: string) => CORRECT_WORDS.has(word.toLowerCase()),
  })),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('checkSpelling (diccionario mockeado)', () => {
  it('detecta una palabra mal escrita evidente en el título de un nodo', async () => {
    let project = createProject('P')
    project = updateNode(project, project.graph.startNodeId, { title: 'Diapositibaaa inicial' })

    const issues = await checkSpelling(project)
    expect(issues).toContainEqual({
      nodeId: project.graph.startNodeId,
      word: 'Diapositibaaa',
    })
  })

  it('no marca palabras correctas comunes en español', async () => {
    let project = createProject('P')
    project = updateNode(project, project.graph.startNodeId, { title: 'Hola mundo bienvenido' })

    expect(await checkSpelling(project)).toEqual([])
  })

  it('recorre bloques de texto y respuestas de una diapositiva de decisión', async () => {
    let project = createProject('P')
    const startId = project.graph.startNodeId
    project = addTextBlock(project, startId)
    const block = project.graph.nodes[0]
    const blockId = block && block.type === 'slide' ? block.content[0]?.id : undefined
    if (!blockId) throw new Error('setup inválido')
    project = updateTextBlockBody(project, startId, blockId, 'Este texto tiene un erorrrgrafico')

    const issues = await checkSpelling(project)
    expect(issues.some((issue) => issue.word === 'erorrrgrafico')).toBe(true)
  })

  it('un proyecto sin ningún texto revisable no dispara la carga del diccionario', async () => {
    const project = createProject('P')
    const { loadSpanishSpellChecker } = await import('../spellingDictionary')

    await checkSpelling(project)

    // El único texto del proyecto recién creado es un título vacío ('') --
    // sin texto revisable, checkSpelling no debería ni intentar cargar el
    // diccionario.
    expect(loadSpanishSpellChecker).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------
// Integración aislada: nspell + el diccionario real de dictionary-es,
// leído directamente de disco (sin pasar por el mecanismo `?url` de Vite,
// que es específico del navegador/Tauri).
// -----------------------------------------------------------------------

describe('checkSpelling (diccionario real, integración)', () => {
  it('nspell + dictionary-es detectan una errata evidente y aceptan palabras correctas', () => {
    const aff = readFileSync(path.join(dictionaryDir, 'index.aff'), 'utf-8')
    const dic = readFileSync(path.join(dictionaryDir, 'index.dic'), 'utf-8')
    const speller = new NSpell({ aff, dic })

    expect(speller.correct('bienvenido')).toBe(true)
    expect(speller.correct('diapositiva')).toBe(true)
    expect(speller.correct('blaaaxyzqq')).toBe(false)
  })
})

// -----------------------------------------------------------------------
// Identificadores estables de cada tipo de aviso (Tarea "Descartar avisos"):
// usados por el "Descartar" de DiagnosticsPanel/ui.dismissedDiagnosticIds
// (ver src/store/useProjectStore.ts) para que un aviso descartado no
// reaparezca al recalcular la lista con el mismo problema exacto.
// -----------------------------------------------------------------------

describe('cycleIssueId', () => {
  it('es estable frente al orden de recorrido: mismo conjunto de nodos, orden distinto -> mismo id', () => {
    const idA = cycleIssueId({ nodeIds: ['a', 'b', 'c'] })
    const idB = cycleIssueId({ nodeIds: ['c', 'a', 'b'] })
    expect(idA).toBe(idB)
  })

  it('distingue ciclos con conjuntos de nodos distintos', () => {
    const idA = cycleIssueId({ nodeIds: ['a', 'b'] })
    const idB = cycleIssueId({ nodeIds: ['a', 'c'] })
    expect(idA).not.toBe(idB)
  })
})

describe('unlinkedResponseIssueId', () => {
  it('es estable para el mismo nodo/respuesta', () => {
    const issue = { nodeId: 'node-1', responseId: 'response-1', responseText: 'Sí' }
    expect(unlinkedResponseIssueId(issue)).toBe(unlinkedResponseIssueId({ ...issue }))
  })

  it('distingue respuestas distintas, incluso del mismo nodo', () => {
    const idA = unlinkedResponseIssueId({ nodeId: 'node-1', responseId: 'r1', responseText: '' })
    const idB = unlinkedResponseIssueId({ nodeId: 'node-1', responseId: 'r2', responseText: '' })
    expect(idA).not.toBe(idB)
  })
})

describe('spellingIssueId', () => {
  it('es estable para el mismo nodo/palabra', () => {
    const issue = { nodeId: 'node-1', word: 'erorr' }
    expect(spellingIssueId(issue)).toBe(spellingIssueId({ ...issue }))
  })

  it('normaliza a minúsculas: "Ola"/"ola" en el mismo nodo producen el mismo id', () => {
    const idA = spellingIssueId({ nodeId: 'node-1', word: 'Ola' })
    const idB = spellingIssueId({ nodeId: 'node-1', word: 'ola' })
    expect(idA).toBe(idB)
  })

  it('distingue la misma palabra en nodos distintos', () => {
    const idA = spellingIssueId({ nodeId: 'node-1', word: 'erorr' })
    const idB = spellingIssueId({ nodeId: 'node-2', word: 'erorr' })
    expect(idA).not.toBe(idB)
  })
})
