import { deriveEdges } from './graph'
import { loadSpanishSpellChecker } from './spellingDictionary'
import { extractPlainText, parseRichBody } from '../editor/richText/richTextContent'
import type { ProjectDocument } from './schemas'

/**
 * "Rinconcito de avisos" del lienzo (ver `src/editor/Diagnostics/
 * DiagnosticsPanel.tsx`): tres comprobaciones adicionales sobre el grafo,
 * deliberadamente SEPARADAS de `validateProject` (`src/domain/
 * validation.ts`) en vez de añadidas ahí:
 *
 * - `detectCycles`: un bucle en el grafo NO es un error de `validateProject`
 *   (que solo comprueba inicio/destinos/alcanzabilidad) — es informativo
 *   ("revisa si es intencional"), una categoría de aviso distinta que no
 *   encaja en `ValidationIssueCode`.
 * - `detectUnlinkedResponses`: más granular que `RESPONSE_WITHOUT_TARGET` de
 *   `validateProject` (mismo hecho detectado, misma condición), pero con
 *   forma de salida distinta (incluye `responseText`, pensada para listarse
 *   en el panel de avisos con el texto de la respuesta en vez de solo su
 *   id) — no sustituye a `validateProject`, es una vista adicional del mismo
 *   dato para un consumidor distinto.
 * - `checkSpelling`: no tiene relación con la validez del grafo en absoluto
 *   (es sobre el TEXTO de las diapositivas), así que no tenía cabida en
 *   `validation.ts` de ningún modo.
 */

// ---------------------------------------------------------------------------
// Bucles
// ---------------------------------------------------------------------------

export interface CycleIssue {
  /** Ids de los nodos que forman el bucle, en el orden en que se recorren. */
  nodeIds: string[]
}

/**
 * Identificador ESTABLE de un `CycleIssue`, usado por el "Descartar" de
 * `DiagnosticsPanel` (descarte de sesión, ver `ui.dismissedDiagnosticIds` en
 * `src/store/useProjectStore.ts`): dos ciclos con el MISMO conjunto de nodos
 * implicados deben producir el mismo id aunque `detectCycles` los recorra en
 * un orden distinto (p.ej. tras un recálculo posterior con el grafo
 * ligeramente distinto en otra parte, pero el mismo bucle intacto) — por eso
 * los ids se ORDENAN antes de unirlos, a diferencia de `cycle.nodeIds`, que
 * conserva el orden de recorrido (significativo para pintar la ruta "A → B →
 * C" en el panel, pero irrelevante para la identidad del aviso).
 */
export function cycleIssueId(cycle: CycleIssue): string {
  return `cycle:${[...cycle.nodeIds].sort().join(',')}`
}

/**
 * Detecta bucles (ciclos) en el grafo dirigido derivado por `deriveEdges`.
 *
 * DFS estándar con pila de recursión (`stack`/`onStack`): al visitar un
 * vecino que YA está en la pila de recursión actual, se ha encontrado un
 * ciclo — el propio tramo de la pila desde ese vecino hasta el nodo actual
 * son los nodos que lo forman. Un nodo que se apunta a sí mismo (arista
 * `A->A`) es el caso degenerado de un ciclo de un único nodo, y se detecta
 * igual (el propio nodo está "en la pila" al procesar su arista saliente).
 *
 * `seenSignatures` deduplica ciclos ya reportados por su conjunto de nodos
 * (orden-independiente): el mismo ciclo puede alcanzarse por más de un
 * camino de DFS si tiene varias aristas entrantes desde fuera del ciclo, y
 * no tiene sentido listarlo dos veces en el panel de avisos.
 *
 * Pura: no muta `project` ni depende de nada externo al propio grafo
 * derivado. No es una búsqueda exhaustiva de TODOS los ciclos simples
 * posibles de un grafo con ciclos solapados (ese problema es
 * combinatoriamente más caro y no aporta nada extra a un aviso meramente
 * informativo) — es suficiente para el propósito de "avisar de que existe
 * al menos un bucle por aquí".
 */
export function detectCycles(project: ProjectDocument): CycleIssue[] {
  const edges = deriveEdges(project)
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const list = adjacency.get(edge.source) ?? []
    list.push(edge.target)
    adjacency.set(edge.source, list)
  }

  const globalVisited = new Set<string>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const cycles: CycleIssue[] = []
  const seenSignatures = new Set<string>()

  function visit(nodeId: string): void {
    globalVisited.add(nodeId)
    stack.push(nodeId)
    onStack.add(nodeId)

    for (const neighborId of adjacency.get(nodeId) ?? []) {
      if (onStack.has(neighborId)) {
        const cycleStart = stack.indexOf(neighborId)
        const cycleNodeIds = stack.slice(cycleStart)
        const signature = [...cycleNodeIds].sort().join('|')
        if (!seenSignatures.has(signature)) {
          seenSignatures.add(signature)
          cycles.push({ nodeIds: cycleNodeIds })
        }
      } else if (!globalVisited.has(neighborId)) {
        visit(neighborId)
      }
    }

    stack.pop()
    onStack.delete(nodeId)
  }

  for (const node of project.graph.nodes) {
    if (!globalVisited.has(node.id)) {
      visit(node.id)
    }
  }

  return cycles
}

// ---------------------------------------------------------------------------
// Respuestas sin vincular
// ---------------------------------------------------------------------------

export interface UnlinkedResponseIssue {
  nodeId: string
  responseId: string
  responseText: string
}

/**
 * Identificador ESTABLE de un `UnlinkedResponseIssue` (ver `cycleIssueId`
 * para el criterio general): `responseId` ya es único por sí solo dentro del
 * documento, pero se antepone `nodeId` por claridad/depuración y para no
 * depender en solitario de un campo que vive "un nivel más abajo".
 */
export function unlinkedResponseIssueId(issue: UnlinkedResponseIssue): string {
  return `unlinkedResponse:${issue.nodeId}:${issue.responseId}`
}

/**
 * Respuestas de decisión SIN `targetNodeId`, una entrada por respuesta.
 *
 * Más fino que `SLIDE_WITHOUT_TARGET`/`RESPONSE_WITHOUT_TARGET` de
 * `validateProject` (ver comentario de cabecera del módulo): esta función
 * existe para el panel de avisos, que quiere mostrar el TEXTO de cada
 * respuesta suelta, no solo su id. Una diapositiva "de continuar" (sin
 * `responses`) nunca aparece aquí — no tiene respuestas que recorrer, ni
 * falta que hace: su propio destino de "Continuar" ya lo cubre
 * `SLIDE_WITHOUT_TARGET`.
 */
export function detectUnlinkedResponses(project: ProjectDocument): UnlinkedResponseIssue[] {
  const issues: UnlinkedResponseIssue[] = []

  for (const node of project.graph.nodes) {
    if (node.type !== 'slide') continue

    for (const response of node.responses) {
      if (!response.targetNodeId) {
        issues.push({
          nodeId: node.id,
          responseId: response.id,
          responseText: response.text,
        })
      }
    }
  }

  return issues
}

// ---------------------------------------------------------------------------
// Ortografía
// ---------------------------------------------------------------------------

export interface SpellingIssue {
  nodeId: string
  word: string
}

/**
 * Identificador ESTABLE de un `SpellingIssue` (ver `cycleIssueId` para el
 * criterio general): `word` se normaliza a minúsculas, mismo criterio que la
 * deduplicación de `checkSpelling` (ver su comentario) — así "Ola"/"ola" en
 * el mismo nodo cuentan como el mismo aviso a efectos de descarte, igual que
 * ya cuentan como el mismo aviso a efectos de detección.
 */
export function spellingIssueId(issue: SpellingIssue): string {
  return `spelling:${issue.nodeId}:${issue.word.toLowerCase()}`
}

interface ReviewableText {
  nodeId: string
  text: string
}

/**
 * Recopila TODO el texto revisable del proyecto, cada fragmento etiquetado
 * con el nodo del que procede (para que el panel de avisos pueda centrar el
 * lienzo en él con `focusNode`, ver `DiagnosticsPanel`):
 *
 * - `title` ("Ref. oculta" en la UI, ver `Inspector.tsx`) de CUALQUIER nodo.
 * - `intro`: además, `caseName`.
 * - `slide`: además, cada bloque `type: 'text'` de `content` (vía
 *   `extractPlainText(parseRichBody(block.body))`) y el `text` de cada
 *   respuesta.
 * - `final`: además, `body` (vía `extractPlainText(parseRichBody(...))`).
 *
 * Los bloques `image`/`audio` no tienen texto propio que revisar, así que se
 * ignoran sin más (no son ni siquiera candidatos).
 */
function collectReviewableTexts(project: ProjectDocument): ReviewableText[] {
  const sources: ReviewableText[] = []

  function addIfNonEmpty(nodeId: string, text: string): void {
    if (text.trim() !== '') {
      sources.push({ nodeId, text })
    }
  }

  for (const node of project.graph.nodes) {
    addIfNonEmpty(node.id, node.title)

    if (node.type === 'intro') {
      addIfNonEmpty(node.id, node.caseName)
      continue
    }

    if (node.type === 'slide') {
      for (const block of node.content) {
        if (block.type === 'text') {
          addIfNonEmpty(node.id, extractPlainText(parseRichBody(block.body)))
        }
      }
      for (const response of node.responses) {
        addIfNonEmpty(node.id, response.text)
      }
      continue
    }

    // node.type === 'final'
    addIfNonEmpty(node.id, extractPlainText(parseRichBody(node.body)))
  }

  return sources
}

/**
 * Patrón de tokenización: cualquier tramo máximo de letras Unicode
 * (`\p{L}`, con la bandera `u`) cuenta como una "palabra". Deliberado:
 * - Separa por CUALQUIER carácter que no sea letra (espacios, puntuación,
 *   dígitos) — un dígito NUNCA forma parte de un token, así que un texto
 *   como "COVID19" se tokeniza como "COVID" (el "19" simplemente no genera
 *   ningún token, no hace falta descartarlo aparte).
 * - `\p{L}` incluye letras acentuadas/diacríticas del español (á, é, í, ó,
 *   ú, ü, ñ) sin necesidad de un rango de caracteres manual.
 * - Se descartan los tokens de longitud 1-2 tras extraerlos (siglas cortas,
 *   preposiciones sueltas mal cortadas, iniciales...): reduce el ruido de
 *   falsos positivos sin perder practicamente ninguna palabra real del
 *   español, que rara vez tiene 1-2 letras (alguna excepción como "tú"/"el"
 *   existe, pero son justo las que MENOS interesa señalar como errores).
 */
const WORD_PATTERN = /\p{L}+/gu
const MIN_WORD_LENGTH = 3

export function tokenizeForSpelling(text: string): string[] {
  const matches = text.match(WORD_PATTERN) ?? []
  return matches.filter((word) => word.length >= MIN_WORD_LENGTH)
}

/**
 * Comprueba la ortografía de todo el texto revisable del proyecto contra el
 * diccionario de español (`loadSpanishSpellChecker`, cacheado en memoria
 * para toda la sesión — ver ese módulo).
 *
 * Async porque cargar el diccionario tiene coste (ver
 * `spellingDictionary.ts`); quien la llama (`DiagnosticsPanel`) es
 * responsable de no dispararla en cada tecla/render, solo bajo demanda (ver
 * comentario de ese componente).
 *
 * Deduplica por (nodo, palabra en minúsculas): la misma errata repetida
 * varias veces dentro del mismo nodo (p.ej. en dos bloques de texto
 * distintos de la misma diapositiva) genera una única entrada, no una por
 * aparición — el panel de avisos lista PROBLEMAS a revisar, no un recuento
 * de ocurrencias.
 */
export async function checkSpelling(project: ProjectDocument): Promise<SpellingIssue[]> {
  const sources = collectReviewableTexts(project)
  if (sources.length === 0) return []

  const speller = await loadSpanishSpellChecker()
  const seen = new Set<string>()
  const issues: SpellingIssue[] = []

  for (const source of sources) {
    for (const word of tokenizeForSpelling(source.text)) {
      if (speller.correct(word)) continue

      const key = `${source.nodeId}:${word.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)

      issues.push({ nodeId: source.nodeId, word })
    }
  }

  return issues
}
