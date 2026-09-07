import { GAME_OVER_HEADING } from '../domain'
import type {
  ContentBlock,
  FinalNode,
  IntroNode,
  Node,
  ProjectDocument,
  SlideNode,
  VariableCondition,
  VariableDef,
  VariableEffect,
} from '../domain'
import { extractPlainText, parseRichBody } from '../editor/richText/richTextContent'
import { resolveIntroCatalogNames } from './htmlBundle'

/**
 * Generador del "documento para revisión con IA" (petición de usuario: "que
 * este archivo lo pudiese ver ChatGPT o alguna otra IA... para que le dé
 * opinión"). Vuelca TODA la estructura narrativa del proyecto — diapositivas,
 * decisiones, finales, variables — como texto plano/Markdown legible de
 * arriba a abajo, para que quien diseña el caso lo suba a CUALQUIER IA de
 * chat (ChatGPT, Claude, Gemini…) y le pida opinión sobre narrativa,
 * claridad o pedagogía.
 *
 * Deliberadamente NO es el HTML/SCORM exportado: ese es un documento
 * interactivo con JavaScript que ninguna IA de chat puede "jugar" ni navegar
 * por sus ramas — como mucho vería el código fuente, ilegible para juzgar la
 * narrativa. Este documento, en cambio, aplana el árbol completo en un único
 * texto de lectura lineal, con las respuestas de cada decisión indicando a
 * qué diapositiva llevan (por número, ver `nodeLabel`) en vez de requerir
 * "jugar" la experiencia para descubrirlo.
 *
 * Nada se envía a ningún sitio desde aquí: es una función pura que devuelve
 * un string. Quien lo use decide dónde pegarlo o subirlo — mismo criterio de
 * privacidad que el resto de exportaciones (HTML/SCORM), que tampoco hacen
 * ninguna llamada de red.
 *
 * Dos campos puramente internos del equipo se excluyen a propósito, mismo
 * criterio que el HTML/SCORM exportado (ver `stripEditorOnlyFields` en
 * `htmlBundle.ts`):
 * - `internalNote` (notas de producción tipo "pedir gráfico a diseño"): son
 *   ruido para una revisión de narrativa, no parte de la experiencia.
 * - El título/"ref. oculta" de un nodo `final` no se pinta como cuerpo — SÍ
 *   se usa como parte de la cabecera de cada sección (`nodeLabel`), porque
 *   aquí (a diferencia del HTML/SCORM) es precisamente lo que ayuda a
 *   navegar el documento; no es lo mismo "no debe verlo el alumnado" que "no
 *   debe verlo quien revisa el diseño".
 */

/** Igual que `NODE_TYPE_LABEL` de `src/editor/Canvas/nodes/nodeTypes.tsx`,
 *  duplicado deliberadamente en vez de importado: `src/export` no depende de
 *  ningún componente de `src/editor/Canvas`/`src/editor/Inspector` (solo de
 *  `src/editor/richText`, lógica compartida sin JSX) — tres líneas de menos
 *  acoplamiento valen más que evitar esta duplicación mínima. */
const NODE_TYPE_LABEL: Record<Node['type'], string> = {
  intro: 'Inicio',
  slide: 'Diapositiva',
  final: 'Final',
}

/** Etiqueta legible de un nodo para las cabeceras de sección y para
 *  referenciarlo como destino de otra ("Diapositiva 3 — ¿Qué opción elige el
 *  usuario?", "Final 5", "Inicio 1") — mismo criterio que `nodeOptionLabel`
 *  del Inspector, sin el "— Sin ref. oculta" de repuesto (jerga interna del
 *  editor sin sentido en un documento pensado para leerse fuera de la app):
 *  un nodo sin título simplemente no lleva el segmento "— título". */
function nodeLabel(node: Node): string {
  const title = node.type === 'intro' || node.type === 'final' ? '' : node.title.trim()
  return title ? `${NODE_TYPE_LABEL[node.type]} ${node.number} — ${title}` : `${NODE_TYPE_LABEL[node.type]} ${node.number}`
}

/** `true`/`false` de una condición o de `VariableDef.initialValue` a texto en
 *  español; un número se deja tal cual. */
function formatValue(value: number | boolean): string {
  return typeof value === 'boolean' ? (value ? 'verdadero' : 'falso') : String(value)
}

/** Nombre de la variable referenciada por `variableId`, o un aviso legible
 *  si ya no existe en `project.variables` (borrada tras crear la condición/
 *  efecto — el propio dominio permite ese estado "huérfano", ver
 *  `deleteVariable` en `src/domain/project.ts`). */
function variableName(variableId: string, variables: VariableDef[]): string {
  return variables.find((candidate) => candidate.id === variableId)?.name ?? 'variable eliminada'
}

function describeCondition(condition: VariableCondition, variables: VariableDef[]): string {
  return `${variableName(condition.variableId, variables)} ${condition.operator} ${formatValue(condition.value)}`
}

function describeEffect(effect: VariableEffect, variables: VariableDef[]): string {
  const name = variableName(effect.variableId, variables)
  if (effect.operation === 'set') return `${name} = ${formatValue(effect.value)}`
  return effect.operation === 'increment' ? `${name} += ${effect.value}` : `${name} -= ${effect.value}`
}

/** `null` si no hay ningún efecto (patch vacío/ausente, mismo criterio que
 *  el resto del dominio) — así el llamador puede omitir la línea entera en
 *  vez de imprimir "Efectos: " seguido de nada. */
function describeEffects(effects: VariableEffect[] | undefined, variables: VariableDef[]): string | null {
  if (!effects || effects.length === 0) return null
  return effects.map((effect) => describeEffect(effect, variables)).join(', ')
}

/** Etiqueta de destino de una salida del grafo (`targetNodeId`): el nombre
 *  del nodo al que apunta, "Sin destino" si no se ha conectado nada
 *  todavía, o un aviso si apuntaba a un nodo que ya no existe (mismo criterio
 *  tolerante que el resto de esta función: nunca lanza). */
function describeDestination(nodeId: string | undefined, labels: Map<string, string>): string {
  if (!nodeId) return 'Sin destino'
  return labels.get(nodeId) ?? 'nodo eliminado'
}

/** Texto legible del contenido de una diapositiva, bloque a bloque y EN
 *  ORDEN (mismo criterio que `SlideContent` del Player): un bloque de texto
 *  se resuelve a texto plano (`extractPlainText`, ni marcas de formato ni el
 *  JSON de Tiptap) y uno de imagen/audio/vídeo se indica entre corchetes,
 *  sin su contenido real — ninguna IA de chat puede "ver" una imagen desde
 *  un archivo de texto. Un bloque de texto vacío se omite, igual que en el
 *  Player. */
function describeContentBlocks(blocks: ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      const text = extractPlainText(parseRichBody(block.body))
      if (text) parts.push(text)
    } else if (block.type === 'image') {
      parts.push('[Imagen]')
    } else if (block.type === 'audio') {
      parts.push('[Audio]')
    } else {
      parts.push('[Vídeo]')
    }
  }
  return parts.join('\n\n')
}

function renderIntroSection(
  node: IntroNode,
  project: ProjectDocument,
  labels: Map<string, string>,
): string {
  const { cicloName, asignaturaName } = resolveIntroCatalogNames(project)
  return [
    `## ${nodeLabel(node)} (portada)`,
    '',
    `- Ciclo: ${cicloName ?? 'sin elegir'}`,
    `- Asignatura: ${asignaturaName ?? 'sin elegir'}`,
    `- Nombre del caso práctico: ${node.caseName.trim() || 'sin definir'}`,
    `- Continúa a: ${describeDestination(node.targetNodeId, labels)}`,
  ].join('\n')
}

function renderSlideSection(
  node: SlideNode,
  project: ProjectDocument,
  labels: Map<string, string>,
): string {
  // Pantalla de marca bespoke "Game Over" (`brandedGameOverScreen`, ver
  // `GameOverCard` en `src/player/PlayerScreen.tsx`): ignora `node.content`
  // por completo, así que describirla a partir de ahí (como cualquier otra
  // diapositiva) siempre daría "(sin contenido)" — corrección de revisión
  // de código: describe en su lugar el contenido FIJO real que ve quien
  // juega (logo, título, ilustración), para que la revisión con IA no la
  // reporte como una diapositiva vacía/sin terminar.
  const contentDescription = node.brandedGameOverScreen
    ? `Pantalla de marca fija "Game Over" (logo iLERNA + ilustración + título "${GAME_OVER_HEADING}"). El contenido de esta diapositiva en el Inspector no se muestra nunca — esta pantalla no es editable.`
    : describeContentBlocks(node.content) || '(sin contenido)'
  const lines = [`## ${nodeLabel(node)}`, '', contentDescription]

  const visitEffectsText = describeEffects(node.visitEffects, project.variables)
  if (visitEffectsText) {
    lines.push('', `Efectos al entrar en esta diapositiva: ${visitEffectsText}.`)
  }

  lines.push('')
  if (node.responses.length === 0) {
    // Diapositiva "de continuar" (ver comentario de `SlideNodeSchema` en
    // schemas.ts): una única salida, con enrutado condicional opcional.
    lines.push(`Continúa a: ${describeDestination(node.targetNodeId, labels)}.`)
    if (node.condition) {
      lines.push(
        `(Si ${describeCondition(node.condition, project.variables)}; si no, ${describeDestination(node.elseTargetNodeId, labels)}.)`,
      )
    }
  } else {
    // Petición de usuario ("Ordenar"/"Random"): ya NO se ordena por letra
    // — se listan en el propio orden del array `node.responses` (el mismo
    // que ve quien juega con `responseOrder: 'ordered'`/ausente, ver
    // `orderResponses` en `src/player/runtime.ts`). Con `'random'` ese
    // orden no es el que verá el alumnado (se baraja en cada visita), así
    // que se avisa en vez de dar a entender un orden fijo que no existe.
    if (node.responseOrder === 'random') {
      lines.push('Respuestas (el orden real se baraja en cada visita, "Random"):')
    } else {
      lines.push('Respuestas:')
    }
    for (const response of node.responses) {
      const text = response.text.trim() || '(sin texto)'
      const destination = response.actsAsExit
        ? 'sale de la experiencia'
        : describeDestination(response.targetNodeId, labels)
      let line = `- ${response.letter}) "${text}" → ${destination}`
      if (response.condition) {
        line += ` [visible solo si ${describeCondition(response.condition, project.variables)}]`
      }
      const effectsText = describeEffects(response.effects, project.variables)
      if (effectsText) line += ` (efectos: ${effectsText})`
      if (typeof response.points === 'number') line += ` (puntos: ${response.points})`
      lines.push(line)
    }
  }

  return lines.join('\n')
}

function renderFinalSection(node: FinalNode, project: ProjectDocument): string {
  const body = extractPlainText(parseRichBody(node.body))
  const lines = [`## ${nodeLabel(node)}`, '', body || '(sin contenido)']

  if (node.alternateCondition) {
    const altBody = node.alternateBody ? extractPlainText(parseRichBody(node.alternateBody)) : ''
    lines.push(
      '',
      `Contenido alternativo (se muestra en vez del anterior si ${describeCondition(node.alternateCondition, project.variables)}):`,
      altBody || '(sin definir; si se diera el caso, se seguiría mostrando el contenido por defecto de arriba)',
    )
  }

  // Petición de usuario ("el confeti lo quiero... en los dos"): `celebrate`
  // aplica a los DOS contenidos de arriba (por defecto y alternativo, si lo
  // hay) — un único aviso al final de la sección, no uno por contenido.
  if (node.celebrate) {
    lines.push('', '🎉 Este Final se celebra con confeti al mostrarse (con o sin condición alternativa).')
  }

  return lines.join('\n')
}

/**
 * Punto de entrada: aplana `project` entero a un único documento de texto.
 * Función pura — no toca disco ni red, ver comentario de cabecera del
 * archivo para el porqué. `useAiReviewExport` (más abajo, en el mismo
 * fichero) es quien la conecta con el diálogo de guardado real.
 *
 * Orden de las secciones: por `number` (el mismo identificador estable que
 * ya usa el resto de la app para referirse a un nodo, p.ej. "Diapositiva
 * 3") — no un recorrido del grafo desde el Inicio, así que un nodo
 * huérfano/sin conectar todavía también aparece, con su propia sección, en
 * vez de desaparecer silenciosamente del documento.
 */
export function buildAiReviewDocument(project: ProjectDocument): string {
  const labels = new Map(project.graph.nodes.map((node) => [node.id, nodeLabel(node)]))
  const sortedNodes = [...project.graph.nodes].sort((a, b) => a.number - b.number)

  const lines = [
    `# ${project.metadata.name.trim() || 'Experiencia sin título'} — Documento para revisión con IA`,
    '',
    '> Exportado desde Brunch Studio. Describe toda la estructura de la',
    '> experiencia (diapositivas, decisiones, finales) en texto plano, para',
    '> pedir opinión sobre narrativa, claridad o enfoque pedagógico a una IA',
    '> de chat (ChatGPT, Claude, Gemini…). Las imágenes/audio/vídeo se',
    '> indican entre corchetes, sin su contenido real.',
    '',
  ]

  if (project.variables.length > 0) {
    lines.push('## Variables')
    for (const variable of project.variables) {
      const typeLabel = variable.type === 'number' ? 'número' : 'sí/no'
      lines.push(`- ${variable.name} (${typeLabel}, valor inicial: ${formatValue(variable.initialValue)})`)
    }
    lines.push('')
  }

  for (const node of sortedNodes) {
    if (node.type === 'intro') {
      lines.push(renderIntroSection(node, project, labels))
    } else if (node.type === 'slide') {
      lines.push(renderSlideSection(node, project, labels))
    } else {
      lines.push(renderFinalSection(node, project))
    }
    lines.push('')
  }

  return `${lines.join('\n').trimEnd()}\n`
}
