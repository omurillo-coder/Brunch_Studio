import type {
  ComparisonOperator,
  ContentBlock,
  FinalNode,
  IntroNode,
  Node,
  NodeType,
  ProjectDocument,
  SlideNode,
  VariableCondition,
} from '../domain'
import { CICLOS, validateIntroForExport } from '../domain'
import { extractPlainText, parseRichBody } from '../editor/richText/richTextContent'

/**
 * ---------------------------------------------------------------------------
 * "Vista de guión imprimible" (export de solo lectura, texto claro)
 * ---------------------------------------------------------------------------
 *
 * Documento HTML estático distinto del export interactivo HTML/SCORM
 * (`src/export/htmlBundle.ts`, que no se toca aquí): ese produce un
 * reproductor navegable; este produce un documento de LECTURA de todo el
 * escenario de un tirón — pensado para que alguien sin el programa (un
 * experto de contenido, un revisor) pueda validar el guión completo en papel
 * o en pantalla, sin interactuar con nada. Sin JavaScript de interacción:
 * solo HTML + una hoja de estilos pensada para pantalla y para impresión
 * (`@media print`).
 *
 * `buildScriptDocument` es una función PURA (nada de React, nada de Tauri,
 * nada de disco), mismo criterio que `buildHtmlBundle`: recibe el documento y
 * devuelve un único string HTML autónomo. A diferencia del export
 * interactivo, este NUNCA necesita los bytes de los assets (imagen/audio) —
 * los bloques de medios se listan como un marcador de texto
 * ("[Imagen adjunta]"/"[Audio adjunto]"), nunca se incrustan — así que no
 * hace falta `resolveExportAssets` en absoluto.
 *
 * Recorrido sobre `block.type`/`node.type` deliberadamente EXHAUSTIVO (switch
 * con una rama `default` que asigna a `never` y lanza si algún día no lo es):
 * hay OTRO proceso trabajando en paralelo que puede añadir un cuarto tipo de
 * bloque de contenido (`video`) a `ContentBlockSchema`
 * (`src/domain/schemas.ts`) mientras se construye este módulo. Si eso ocurre,
 * el compilador debe avisar aquí en vez de que el tipo nuevo se ignore en
 * silencio.
 */

/** Mismo texto que `NODE_TYPE_LABEL` de `src/editor/Canvas/nodes/nodeTypes.tsx`,
 *  duplicado deliberadamente en vez de importado: ese archivo es un
 *  componente de React del lienzo (importa `@xyflow/react` y JSX), y este
 *  módulo es lógica pura de export — acoplarlo a un componente de UI solo
 *  para reutilizar tres literales de texto no compensa. */
const NODE_TYPE_LABEL: Record<NodeType, string> = {
  intro: 'Inicio',
  slide: 'Diapositiva',
  final: 'Final',
}

/** Mismo texto que `OPERATOR_LABEL` de `src/editor/Inspector/Inspector.tsx`,
 *  duplicado por el mismo motivo (`Inspector.tsx` es zona de otro proceso en
 *  paralelo, ver cabecera del módulo — no se importa de ahí). */
const OPERATOR_LABEL: Record<ComparisonOperator, string> = {
  '==': 'es igual a',
  '!=': 'es distinto de',
  '>': 'es mayor que',
  '>=': 'es mayor o igual que',
  '<': 'es menor que',
  '<=': 'es menor o igual que',
}

const NO_TARGET_TEXT = '(sin destino configurado)'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** "<Tipo> <número> — <referencia o 'Sin referencia'>", mismo formato que
 *  `nodeOptionLabel` de `Inspector.tsx` (duplicado aquí por el mismo motivo
 *  que `NODE_TYPE_LABEL`/`OPERATOR_LABEL` arriba). */
function nodeHeading(node: Node): string {
  const title = node.title.trim() || 'Sin referencia'
  return `${NODE_TYPE_LABEL[node.type]} ${node.number} — ${title}`
}

/** Etiqueta legible de un destino: "Diapositiva N"/"Final N" por NÚMERO, o el
 *  texto de "sin destino" si `targetNodeId` está ausente o ya no apunta a
 *  ningún nodo del proyecto. */
function targetLabel(project: ProjectDocument, targetNodeId: string | undefined): string {
  if (!targetNodeId) return NO_TARGET_TEXT
  const target = project.graph.nodes.find((candidate) => candidate.id === targetNodeId)
  if (!target) return NO_TARGET_TEXT
  return `${NODE_TYPE_LABEL[target.type]} ${target.number}`
}

/** Texto del valor de una condición: `true`/`false` en palabras para una
 *  variable booleana, el número tal cual para una numérica. */
function conditionValueText(value: number | boolean): string {
  if (typeof value === 'boolean') return value ? 'verdadero' : 'falso'
  return String(value)
}

/** "<nombre de variable> <operador en palabras> <valor>", sin ids — para la
 *  nota de condición de una diapositiva "de continuar" con enrutado
 *  condicional. Si la variable referenciada ya no existe en el proyecto
 *  (pudo eliminarse tras crear la condición), se indica honestamente en vez
 *  de lanzar. */
function conditionText(project: ProjectDocument, condition: VariableCondition): string {
  const variable = project.variables.find((candidate) => candidate.id === condition.variableId)
  const name = variable?.name.trim() || 'variable eliminada'
  return `${name} ${OPERATOR_LABEL[condition.operator]} ${conditionValueText(condition.value)}`
}

/**
 * Texto legible de un bloque de contenido: párrafo de texto plano para
 * `text`, marcador para `image`/`audio`/`video`. Switch EXHAUSTIVO (ver
 * cabecera del módulo): la rama `default` asigna `block` a `never` y lanza si
 * algún tipo nuevo llega sin gestionar aquí, en vez de ignorarlo en silencio.
 */
function blockText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return extractPlainText(parseRichBody(block.body))
    case 'image':
      return '[Imagen adjunta]'
    case 'audio':
      return '[Audio adjunto]'
    case 'video':
      return '[Vídeo adjunto]'
    default: {
      const exhaustive: never = block
      throw new Error(
        `scriptExport: tipo de bloque de contenido no soportado: "${(exhaustive as ContentBlock).type}".`,
      )
    }
  }
}

/** Párrafos HTML del contenido de una diapositiva/final, uno por bloque de
 *  texto no vacío o marcador de medio; vacío si no hay nada que mostrar. */
function contentParagraphsHtml(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => blockText(block).trim())
    .filter((text) => text !== '')
    .map((text) => `<p>${escapeHtml(text)}</p>`)
    .join('\n')
}

/** Nombre de ciclo/asignatura resueltos desde `CICLOS`, o `null` si alguno de
 *  los dos ids no está definido o ya no existe en el catálogo. */
function resolveCicloAsignaturaNames(
  intro: IntroNode,
): { cicloName: string; asignaturaName: string } | null {
  if (!intro.cicloId || !intro.asignaturaId) return null
  const ciclo = CICLOS.find((candidate) => candidate.id === intro.cicloId)
  const asignatura = ciclo?.asignaturas.find((candidate) => candidate.id === intro.asignaturaId)
  if (!ciclo || !asignatura) return null
  return { cicloName: ciclo.name, asignaturaName: asignatura.name }
}

/** Cabecera del documento: nombre del proyecto y, solo si la diapositiva de
 *  Inicio está completa (`validateIntroForExport`, igual criterio que exige
 *  el export interactivo para bloquear — aquí no bloquea nada, solo decide si
 *  hay algo coherente que mostrar), el resumen ciclo/asignatura/caso. */
function buildCoverHtml(project: ProjectDocument): string {
  const intro = project.graph.nodes.find((node): node is IntroNode => node.type === 'intro')
  const isComplete = intro !== undefined && validateIntroForExport(project).length === 0
  const names = isComplete ? resolveCicloAsignaturaNames(intro) : null

  const metaHtml =
    names && intro
      ? `<p class="cover-meta">${escapeHtml(names.cicloName)} · ${escapeHtml(names.asignaturaName)} · ${escapeHtml(intro.caseName.trim())}</p>`
      : ''

  return `<header class="cover">
<h1>${escapeHtml(project.metadata.name)}</h1>
${metaHtml}
</header>`
}

function buildIntroSectionHtml(project: ProjectDocument, node: IntroNode): string {
  const names = resolveCicloAsignaturaNames(node)
  const caseName = node.caseName.trim()
  const summary = [
    `Ciclo: ${names ? escapeHtml(names.cicloName) : 'sin definir'}`,
    `Asignatura: ${names ? escapeHtml(names.asignaturaName) : 'sin definir'}`,
    `Caso: ${caseName ? escapeHtml(caseName) : 'sin definir'}`,
  ].join(' · ')

  return `<section class="node node-intro">
<h2>${escapeHtml(nodeHeading(node))}</h2>
<p class="node-summary">${summary}</p>
<p class="node-target">→ ${escapeHtml(targetLabel(project, node.targetNodeId))}</p>
</section>`
}

function buildSlideSectionHtml(project: ProjectDocument, node: SlideNode): string {
  const contentHtml = contentParagraphsHtml(node.content)

  let interactionHtml: string
  if (node.responses.length > 0) {
    const items = node.responses
      .map((response) => {
        const text = response.text.trim() || 'Opción sin texto'
        return `<li>${escapeHtml(text)} — → ${escapeHtml(targetLabel(project, response.targetNodeId))}</li>`
      })
      .join('\n')
    interactionHtml = `<ul class="node-decision-list">\n${items}\n</ul>`
  } else {
    const targetHtml = `<p class="node-target">→ ${escapeHtml(targetLabel(project, node.targetNodeId))}</p>`
    const conditionHtml = node.condition
      ? `<p class="node-condition">(condición «${escapeHtml(conditionText(project, node.condition))}»: si se cumple → ${escapeHtml(targetLabel(project, node.targetNodeId))}; si no → ${escapeHtml(targetLabel(project, node.elseTargetNodeId))})</p>`
      : ''
    interactionHtml = `${targetHtml}\n${conditionHtml}`
  }

  return `<section class="node node-slide">
<h2>${escapeHtml(nodeHeading(node))}</h2>
${contentHtml || '<p class="node-empty">(sin contenido)</p>'}
${interactionHtml}
</section>`
}

function buildFinalSectionHtml(node: FinalNode): string {
  const text = extractPlainText(parseRichBody(node.body)).trim()
  return `<section class="node node-final">
<h2>${escapeHtml(nodeHeading(node))}</h2>
<p class="node-final-label">Diapositiva final: no tiene destino, termina el recorrido.</p>
${text ? `<p>${escapeHtml(text)}</p>` : '<p class="node-empty">(sin contenido)</p>'}
</section>`
}

/**
 * Apartado de un nodo. Switch EXHAUSTIVO sobre `node.type` (ver cabecera del
 * módulo): `NodeType` tiene hoy tres valores fijos (`intro`/`slide`/`final`,
 * el cuarto tipo en paralelo es de BLOQUE de contenido, no de nodo — no
 * afecta a este switch), pero se deja con el mismo patrón de defensa por
 * consistencia con `blockText`.
 */
function buildNodeSectionHtml(project: ProjectDocument, node: Node): string {
  switch (node.type) {
    case 'intro':
      return buildIntroSectionHtml(project, node)
    case 'slide':
      return buildSlideSectionHtml(project, node)
    case 'final':
      return buildFinalSectionHtml(node)
    default: {
      const exhaustive: never = node
      throw new Error(`scriptExport: tipo de nodo no soportado: "${(exhaustive as Node).type}".`)
    }
  }
}

/** Hoja de estilos embebida: sobria, sin los colores/decoración del editor,
 *  legible en pantalla y pensada para imprimir/exportar a PDF desde el
 *  navegador (`@media print`, sin forzar un salto de página por diapositiva
 *  — solo evita partir una diapositiva a mitad de página). */
const SCRIPT_DOCUMENT_STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    line-height: 1.55;
    color: #1a1a1a;
    background: #fff;
    max-width: 800px;
    margin: 0 auto;
    padding: 2.5rem 1.5rem 4rem;
  }
  .cover {
    text-align: center;
    border-bottom: 2px solid #333;
    padding-bottom: 1.5rem;
    margin-bottom: 2.5rem;
  }
  .cover h1 { font-size: 1.7rem; margin: 0 0 .5rem; }
  .cover-meta { color: #555; font-size: .95rem; margin: 0; }
  .node {
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid #ddd;
  }
  .node:last-child { border-bottom: none; }
  .node h2 {
    font-size: 1.1rem;
    margin: 0 0 .75rem;
    padding: .3rem .6rem;
    background: #f0f0f0;
    border-left: 4px solid #333;
  }
  .node-intro h2 { border-left-color: #2f6f4f; }
  .node-final h2 { border-left-color: #2f4f8f; }
  .node p { margin: 0 0 .6rem; }
  .node-summary, .node-target, .node-condition, .node-final-label, .node-empty {
    font-size: .92rem;
    color: #444;
    font-style: italic;
  }
  .node-decision-list { margin: .5rem 0 0; padding-left: 1.4rem; }
  .node-decision-list li { margin-bottom: .4rem; }
  @media print {
    body { max-width: none; padding: 0; }
    .node { break-inside: avoid-page; }
  }
`

/**
 * Genera el documento HTML completo de la "vista de guión imprimible": un
 * apartado por cada nodo de `project.graph.nodes`, en orden de `number`
 * (orden de creación, el identificador visible de siempre en el resto de la
 * app), precedido de la cabecera del proyecto.
 */
export function buildScriptDocument(project: ProjectDocument): string {
  const sortedNodes = [...project.graph.nodes].sort((a, b) => a.number - b.number)
  const sectionsHtml = sortedNodes.map((node) => buildNodeSectionHtml(project, node)).join('\n')

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(project.metadata.name)} — Guión imprimible</title>
<style>${SCRIPT_DOCUMENT_STYLES}</style>
</head>
<body>
${buildCoverHtml(project)}
<main>
${sectionsHtml}
</main>
</body>
</html>
`
}
