import { deriveEdges } from './graph'
import { FALLOS_VARIABLE_NAME } from './nodePacks'
import { loadSpanishSpellChecker } from './spellingDictionary'
import type { ProjectDocument } from './schemas'

/**
 * "Rinconcito de avisos" del lienzo (ver `src/editor/Diagnostics/
 * DiagnosticsPanel.tsx`): comprobaciones adicionales sobre el grafo,
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
 *   dato para un consumidor distinto. También detecta una segunda forma de
 *   respuesta problemática que `validateProject` no cubre: texto vacío
 *   aunque SÍ tenga destino conectado (ver su comentario, campo `reason`).
 * - `detectUnusedVariables`: hallazgo de auditoría — una variable declarada
 *   y nunca referenciada por ninguna condición/efecto del grafo. Tampoco
 *   encaja en `validateProject` (no es un problema de alcanzabilidad del
 *   grafo, sino de la lista de variables del proyecto).
 * - `checkSpelling`: no tiene relación con la validez del grafo en absoluto
 *   (es sobre el TEXTO de las diapositivas), así que no tenía cabida en
 *   `validation.ts` de ningún modo.
 *
 * Milestone "+1 fallo con Game Over", petición de usuario: dos exclusiones
 * deliberadas, ambas porque el patrón que detectarían es INTENCIONAL en
 * este pack, no un error a revisar —
 * - `detectCycles` descarta un bucle SOLO si TODOS sus nodos están marcados
 *   con `SlideNode.canvasBadge` ("+1 Fallo"/"Game Over") — es decir, el
 *   bucle de reintento de 2 nodos a propósito ("Vale, voy a intentarlo"
 *   vuelve a la diapositiva de decisión), no cualquier bucle que
 *   simplemente PASE por uno de esos nodos. Corrección de revisión de
 *   código: la primera versión descartaba el bucle si CUALQUIERA de sus
 *   nodos llevaba la insignia, así que un bucle real y no relacionado
 *   (p.ej. una diapositiva reutilizada por error en otra rama que también
 *   pasara por "+1 Fallo") quedaba oculto del panel de avisos junto con el
 *   bucle intencional.
 * - `detectUnlinkedResponses` descarta cualquier respuesta con
 *   `actsAsExit: true` ("No, me rindo."): no tiene destino a propósito,
 *   actúa como el botón Salir — no es una respuesta "sin terminar de
 *   conectar".
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
/** Ids de los nodos `slide` marcados con `canvasBadge` (milestone "+1 fallo
 *  con Game Over", ver comentario de cabecera del módulo). */
function gameOverPackNodeIds(project: ProjectDocument): Set<string> {
  const ids = new Set<string>()
  for (const node of project.graph.nodes) {
    if (node.type === 'slide' && node.canvasBadge) ids.add(node.id)
  }
  return ids
}

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

  // Petición de usuario, corregida en revisión de código: solo el bucle
  // FORMADO ÍNTEGRAMENTE por diapositivas del pack "+1 Fallo"/"Game Over"
  // (`gameOverPackNodeIds`) es el bucle de reintento intencional — `every`,
  // no `some`: un bucle real que solo PASE por una de esas diapositivas
  // (junto con otras ajenas al pack) sigue contando como aviso normal.
  const badgeIds = gameOverPackNodeIds(project)
  return cycles.filter((cycle) => !cycle.nodeIds.every((id) => badgeIds.has(id)))
}

// ---------------------------------------------------------------------------
// Respuestas sin vincular
// ---------------------------------------------------------------------------

export interface UnlinkedResponseIssue {
  nodeId: string
  responseId: string
  responseText: string
  reason: 'no-target' | 'empty-text'
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
 * Respuestas de decisión con uno de dos problemas — `reason` distingue cuál
 * (una respuesta puede en teoría tener ambos a la vez; se reporta como
 * `'no-target'`, el más grave de los dos, sin generar dos avisos separados
 * para la misma respuesta):
 * - `'no-target'`: sin `targetNodeId`, una entrada por respuesta. Más fino
 *   que `SLIDE_WITHOUT_TARGET`/`RESPONSE_WITHOUT_TARGET` de `validateProject`
 *   (ver comentario de cabecera del módulo): esta función existe para el
 *   panel de avisos, que quiere mostrar el TEXTO de cada respuesta suelta,
 *   no solo su id. Una diapositiva "de continuar" (sin `responses`) nunca
 *   aparece aquí — no tiene respuestas que recorrer, ni falta que hace: su
 *   propio destino de "Continuar" ya lo cubre `SLIDE_WITHOUT_TARGET`.
 * - `'empty-text'`: petición de usuario (hallazgo de auditoría — "extender
 *   el chequeo de opciones sin vincular para incluir texto vacío aunque haya
 *   destino"): una respuesta SÍ conectada pero con `text` en blanco es un
 *   botón vacío en el Player/export — un problema real que
 *   `RESPONSE_WITHOUT_TARGET`/`'no-target'` no detecta, precisamente porque
 *   esta respuesta SÍ tiene destino.
 */
export function detectUnlinkedResponses(project: ProjectDocument): UnlinkedResponseIssue[] {
  const issues: UnlinkedResponseIssue[] = []

  for (const node of project.graph.nodes) {
    if (node.type !== 'slide') continue

    for (const response of node.responses) {
      // Petición de usuario: `actsAsExit` (milestone "+1 fallo con Game
      // Over") nunca tiene `targetNodeId` A PROPÓSITO — actúa como el
      // botón Salir, no es una respuesta a la que le falte conectar algo.
      const missingTarget = !response.targetNodeId && !response.actsAsExit
      const emptyText = response.text.trim() === ''
      if (!missingTarget && !emptyText) continue

      issues.push({
        nodeId: node.id,
        responseId: response.id,
        responseText: response.text,
        reason: missingTarget ? 'no-target' : 'empty-text',
      })
    }
  }

  return issues
}

// ---------------------------------------------------------------------------
// Variables sin usar
// ---------------------------------------------------------------------------

export interface UnusedVariableIssue {
  variableId: string
  variableName: string
}

/**
 * Identificador ESTABLE de un `UnusedVariableIssue` (ver `cycleIssueId` para
 * el criterio general).
 */
export function unusedVariableIssueId(issue: UnusedVariableIssue): string {
  return `unusedVariable:${issue.variableId}`
}

/**
 * Variables declaradas en `project.variables` que ninguna condición ni
 * ningún efecto del grafo referencia por `variableId` — declaradas y
 * olvidadas, sin ningún uso real en el recorrido.
 *
 * Recorre las cuatro formas en que una `variableId` puede aparecer:
 * `SlideNode.condition`/`visitEffects`, `DecisionResponse.condition`/
 * `effects`. `FinalNode.alternateCondition` se suma aparte: caso especial
 * porque, si el proyecto tiene algún Final, la variable llamada "Fallos" se
 * usa IMPLÍCITAMENTE aunque ningún `alternateCondition` la referencie
 * todavía (ver `defaultAlternateCondition`/`FALLOS_VARIABLE_NAME` en
 * `nodePacks.ts`, petición de usuario "que siempre salgan esos dos
 * finales... que no haga falta que yo le dé al botón") — contarla como "sin
 * usar" en ese caso sería un falso positivo.
 */
export function detectUnusedVariables(project: ProjectDocument): UnusedVariableIssue[] {
  const usedIds = new Set<string>()

  for (const node of project.graph.nodes) {
    if (node.type === 'slide') {
      if (node.condition) usedIds.add(node.condition.variableId)
      for (const effect of node.visitEffects ?? []) usedIds.add(effect.variableId)
      for (const response of node.responses) {
        if (response.condition) usedIds.add(response.condition.variableId)
        for (const effect of response.effects ?? []) usedIds.add(effect.variableId)
      }
    } else if (node.type === 'final' && node.alternateCondition) {
      usedIds.add(node.alternateCondition.variableId)
    }
  }

  const hasFinal = project.graph.nodes.some((node) => node.type === 'final')
  if (hasFinal) {
    const fallos = project.variables.find((variable) => variable.name === FALLOS_VARIABLE_NAME)
    if (fallos) usedIds.add(fallos.id)
  }

  return project.variables
    .filter((variable) => !usedIds.has(variable.id))
    .map((variable) => ({ variableId: variable.id, variableName: variable.name }))
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
 *
 * Import dinámico deliberado de `richText/richTextContent` (no estático
 * arriba del archivo): esa dependencia arrastra Tiptap/ProseMirror entero,
 * y `diagnostics.ts` se re-exporta desde el barrel `src/domain/index.ts`
 * que prácticamente todo el proyecto importa — incluida la pantalla inicial
 * (`HomeScreen`), que nunca corrige ortografía. Un import estático aquí
 * metía Tiptap en CUALQUIER chunk que necesitara algo de `domain`, aunque
 * nunca llegara a llamarse `checkSpelling` (única llamante de esta
 * función, ya asíncrona por el diccionario — ver su comentario). Con el
 * import dinámico, Tiptap solo se descarga la primera vez que de verdad se
 * ejecuta una revisión ortográfica.
 */
async function collectReviewableTexts(project: ProjectDocument): Promise<ReviewableText[]> {
  const { extractPlainText, parseRichBody } = await import('../editor/richText/richTextContent')
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
 * Hallazgo de auditoría ("la revisión ortográfica recorre todo el proyecto
 * de forma síncrona"): cada `SPELLING_YIELD_EVERY_N_WORDS` palabras
 * comprobadas, `checkSpelling` cede el hilo principal brevemente (un
 * `setTimeout(0)`, la forma portable de ceder una macrotarea tanto en
 * navegador como en el entorno de test) antes de seguir — sin esto, un
 * proyecto con mucho texto podía notarse como un bloqueo breve de un tirón,
 * pese a que la función ya era `async` (esa `async` solo cubría la carga del
 * diccionario, ver su comentario; el bucle en sí corría de un tirón, sin
 * ceder nunca). 200 es un punto intermedio: bastante grande para no generar
 * cientos de cesiones en un proyecto normal (coste de por sí, cada
 * `setTimeout` es al menos una vuelta del bucle de eventos), bastante
 * pequeño para que ninguna vuelta sin ceder tome más de un puñado de
 * milisegundos.
 */
const SPELLING_YIELD_EVERY_N_WORDS = 200

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Comprueba la ortografía de todo el texto revisable del proyecto contra el
 * diccionario de español (`loadSpanishSpellChecker`, cacheado en memoria
 * para toda la sesión — ver ese módulo).
 *
 * Async porque cargar el diccionario tiene coste (ver
 * `spellingDictionary.ts`); quien la llama (`DiagnosticsPanel`) es
 * responsable de no dispararla en cada tecla/render, solo bajo demanda (ver
 * comentario de ese componente). El propio bucle de comprobación TAMBIÉN
 * cede el hilo periódicamente — ver `yieldToMainThread`/
 * `SPELLING_YIELD_EVERY_N_WORDS` arriba.
 *
 * Deduplica por (nodo, palabra en minúsculas): la misma errata repetida
 * varias veces dentro del mismo nodo (p.ej. en dos bloques de texto
 * distintos de la misma diapositiva) genera una única entrada, no una por
 * aparición — el panel de avisos lista PROBLEMAS a revisar, no un recuento
 * de ocurrencias.
 */
export async function checkSpelling(project: ProjectDocument): Promise<SpellingIssue[]> {
  const sources = await collectReviewableTexts(project)
  if (sources.length === 0) return []

  const speller = await loadSpanishSpellChecker()
  const seen = new Set<string>()
  const issues: SpellingIssue[] = []
  let wordsSinceYield = 0

  for (const source of sources) {
    for (const word of tokenizeForSpelling(source.text)) {
      wordsSinceYield += 1
      if (wordsSinceYield >= SPELLING_YIELD_EVERY_N_WORDS) {
        wordsSinceYield = 0
        await yieldToMainThread()
      }

      if (speller.correct(word)) continue

      const key = `${source.nodeId}:${word.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)

      issues.push({ nodeId: source.nodeId, word })
    }
  }

  return issues
}
