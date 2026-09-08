import { deriveEdges } from './graph'
import type { Node as DomainNode, ProjectDocument } from './schemas'

/**
 * Reglas de validación del grafo, revisadas tras el rediseño del modelo de
 * nodos (`slide` + `final`, inicio como referencia `graph.startNodeId`):
 *
 * - `MISSING_START`: `graph.startNodeId` no apunta a ningún nodo existente
 *   del documento (antes: "no hay ningún nodo de tipo start").
 * - `SLIDE_WITHOUT_TARGET`: una diapositiva SIN respuestas (por tanto "de
 *   continuar") no tiene `targetNodeId` (antes `CONTENT_WITHOUT_TARGET`).
 * - `RESPONSE_WITHOUT_TARGET`: una respuesta de una diapositiva no tiene
 *   destino (antes `DECISION_RESPONSE_WITHOUT_TARGET`).
 * - `UNREACHABLE_NODE` / `NO_REACHABLE_FINAL`: sin cambios de fondo; la
 *   alcanzabilidad se calcula ahora por BFS desde `graph.startNodeId`.
 *
 * Dos reglas del modelo anterior desaparecen por construcción:
 * - `MULTIPLE_START`: ya no puede existir más de un inicio, porque el
 *   inicio es un único campo `startNodeId`, no un nodo que se pueda
 *   duplicar. Se elimina el código en vez de dejarlo imposible de disparar,
 *   para que la lista de códigos siga describiendo exactamente lo que
 *   puede ocurrir de verdad.
 * - `DECISION_WITHOUT_RESPONSES`: una diapositiva sin respuestas ya no es
 *   un error, es el caso normal de una diapositiva "de continuar". Lo que
 *   sí se comprueba en ese caso es que tenga destino
 *   (`SLIDE_WITHOUT_TARGET`).
 */
export type ValidationIssueCode =
  | 'MISSING_START'
  | 'RESPONSE_WITHOUT_TARGET'
  | 'SLIDE_WITHOUT_TARGET'
  | 'UNREACHABLE_NODE'
  | 'NO_REACHABLE_FINAL'

export interface ValidationIssue {
  code: ValidationIssueCode
  message: string
  nodeId?: string
  responseId?: string
}

/**
 * Ejecuta todas las reglas de validación del grafo y devuelve la lista de
 * problemas detectados. Pura: no lanza, no muta — un grafo válido devuelve
 * un array vacío.
 */
export function validateProject(project: ProjectDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const nodes = project.graph.nodes
  const startNodeId = project.graph.startNodeId
  const startNode = nodes.find((node) => node.id === startNodeId) ?? null

  if (!startNode) {
    issues.push({
      code: 'MISSING_START',
      message: `El proyecto no tiene diapositiva de inicio: "startNodeId" apunta a "${startNodeId}", que no existe.`,
    })
  }

  for (const node of nodes) {
    if (node.type !== 'slide') continue

    if (node.responses.length === 0) {
      if (!node.targetNodeId) {
        issues.push({
          code: 'SLIDE_WITHOUT_TARGET',
          message: `La diapositiva "${node.id}" no tiene respuestas ni destino de continuar conectado.`,
          nodeId: node.id,
        })
      }
      continue
    }

    for (const response of node.responses) {
      if (!response.targetNodeId) {
        issues.push({
          code: 'RESPONSE_WITHOUT_TARGET',
          message: `Una respuesta de la diapositiva "${node.id}" no tiene destino conectado.`,
          nodeId: node.id,
          responseId: response.id,
        })
      }
    }
  }

  // Alcanzabilidad: BFS desde la diapositiva de inicio a través de las
  // aristas derivadas del grafo. Si no hay inicio válido, no se puede
  // calcular alcanzabilidad (ya se ha reportado MISSING_START) y se omiten
  // estas dos reglas.
  if (startNode) {
    const edges = deriveEdges(project)
    const adjacency = new Map<string, string[]>()
    for (const edge of edges) {
      const list = adjacency.get(edge.source) ?? []
      list.push(edge.target)
      adjacency.set(edge.source, list)
    }

    const visited = new Set<string>([startNode.id])
    const queue: string[] = [startNode.id]

    while (queue.length > 0) {
      const currentId = queue.shift()
      if (currentId === undefined) break
      const neighbors = adjacency.get(currentId) ?? []
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId)
          queue.push(neighborId)
        }
      }
    }

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        issues.push({
          code: 'UNREACHABLE_NODE',
          message: `El nodo "${node.id}" no es alcanzable desde la diapositiva de inicio.`,
          nodeId: node.id,
        })
      }
    }

    const hasReachableFinal = nodes.some((node) => node.type === 'final' && visited.has(node.id))
    if (!hasReachableFinal) {
      issues.push({
        code: 'NO_REACHABLE_FINAL',
        message: 'No hay ningún nodo "final" alcanzable desde la diapositiva de inicio.',
      })
    }
  }

  return issues
}

/**
 * Identificador ESTABLE de un `ValidationIssue`, mismo criterio que
 * `cycleIssueId`/`unlinkedResponseIssueId`/`spellingIssueId` de
 * `src/domain/diagnostics.ts` (que no se toca aquí: `validateProject`, a
 * diferencia de esas tres, no tenía hasta ahora ningún consumidor de UI que
 * necesitara descartar avisos individualmente — ver `DiagnosticsPanel.tsx`).
 * `code` solo no basta (puede haber varios `UNREACHABLE_NODE` a la vez);
 * `nodeId`/`responseId` completan la identidad cuando existen, cadena vacía
 * si no (p.ej. `NO_REACHABLE_FINAL` no tiene ninguno de los dos — un único
 * aviso de ese tipo posible por proyecto de todos modos).
 */
export function validationIssueId(issue: ValidationIssue): string {
  return `validation:${issue.code}:${issue.nodeId ?? ''}:${issue.responseId ?? ''}`
}

/**
 * Petición de usuario ("conecta `validateProject` al bloqueo de
 * exportación"): traduce cada `ValidationIssue` a un texto legible para
 * quien exporta, con el mismo criterio de referencia por NÚMERO
 * ("D{número}") que ya usa `validatePendingContentForExport`
 * (`src/domain/introValidation.ts`) — nunca el `id` interno (UUID) que sí
 * lleva `issue.message` (pensado para depurar, no para enseñarlo a un
 * diseñador instruccional sin conocimientos técnicos).
 *
 * Antes de esta función, `validateProject` no bloqueaba ninguna
 * exportación (HTML/SCORM/revisión profes): un proyecto con una rama
 * inalcanzable, sin ningún Final alcanzable, o con una diapositiva "de
 * continuar" sin destino, se exportaba igual, sin ningún aviso — el
 * alumnado se topaba con el recorrido roto ya en el paquete publicado. Se
 * añade a las validaciones de bloqueo existentes (`useHtmlExport.ts`/
 * `useScormExport.ts`/`useTeacherReviewExport.ts`), nunca las sustituye.
 */
export function validateGraphForExport(project: ProjectDocument): string[] {
  const nodeById = new Map<string, DomainNode>(project.graph.nodes.map((node) => [node.id, node]))

  function slideRef(nodeId: string | undefined): string {
    const node = nodeId ? nodeById.get(nodeId) : undefined
    return node ? `D${node.number}` : 'una diapositiva'
  }

  return validateProject(project).map((issue) => {
    switch (issue.code) {
      case 'MISSING_START':
        return 'El proyecto no tiene una diapositiva de inicio válida.'
      case 'SLIDE_WITHOUT_TARGET':
        return `La diapositiva ${slideRef(issue.nodeId)} no tiene respuestas ni destino de continuar conectado.`
      case 'RESPONSE_WITHOUT_TARGET':
        return `Una respuesta de la diapositiva ${slideRef(issue.nodeId)} no tiene destino conectado.`
      case 'UNREACHABLE_NODE':
        return `La diapositiva ${slideRef(issue.nodeId)} no es alcanzable desde el inicio.`
      case 'NO_REACHABLE_FINAL':
        return 'Ningún Final es alcanzable desde el inicio: el recorrido no puede terminar.'
    }
  })
}
