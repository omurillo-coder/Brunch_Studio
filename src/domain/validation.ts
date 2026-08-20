import { deriveEdges } from './graph'
import type { ProjectDocument } from './schemas'

export type ValidationIssueCode =
  | 'MISSING_START'
  | 'MULTIPLE_START'
  | 'DECISION_RESPONSE_WITHOUT_TARGET'
  | 'CONTENT_WITHOUT_TARGET'
  | 'DECISION_WITHOUT_RESPONSES'
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

  const startNodes = nodes.filter((node) => node.type === 'start')

  if (startNodes.length === 0) {
    issues.push({
      code: 'MISSING_START',
      message: 'El proyecto no tiene ningún nodo de tipo "start".',
    })
  } else if (startNodes.length > 1) {
    for (const node of startNodes.slice(1)) {
      issues.push({
        code: 'MULTIPLE_START',
        message: `Hay más de un nodo "start" en el proyecto (nodo "${node.id}" es un start adicional).`,
        nodeId: node.id,
      })
    }
  }

  for (const node of nodes) {
    if (node.type === 'content' && !node.targetNodeId) {
      issues.push({
        code: 'CONTENT_WITHOUT_TARGET',
        message: `El nodo content "${node.id}" no tiene destino conectado.`,
        nodeId: node.id,
      })
    }

    if (node.type === 'decision') {
      if (node.responses.length === 0) {
        issues.push({
          code: 'DECISION_WITHOUT_RESPONSES',
          message: `El nodo decision "${node.id}" no tiene ninguna respuesta.`,
          nodeId: node.id,
        })
      }

      for (const response of node.responses) {
        if (!response.targetNodeId) {
          issues.push({
            code: 'DECISION_RESPONSE_WITHOUT_TARGET',
            message: `La respuesta "${response.letter}" del nodo decision "${node.id}" no tiene destino conectado.`,
            nodeId: node.id,
            responseId: response.id,
          })
        }
      }
    }
  }

  // Alcanzabilidad: BFS desde el/los nodo(s) start a través de las aristas
  // derivadas del grafo. Si no hay start, no se puede calcular alcanzabilidad
  // (ya se ha reportado MISSING_START) y se omiten estas dos reglas.
  if (startNodes.length > 0) {
    const edges = deriveEdges(project)
    const adjacency = new Map<string, string[]>()
    for (const edge of edges) {
      const list = adjacency.get(edge.source) ?? []
      list.push(edge.target)
      adjacency.set(edge.source, list)
    }

    const visited = new Set<string>()
    const queue: string[] = startNodes.map((node) => node.id)
    for (const id of queue) visited.add(id)

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
          message: `El nodo "${node.id}" no es alcanzable desde ningún nodo "start".`,
          nodeId: node.id,
        })
      }
    }

    const hasReachableFinal = nodes.some((node) => node.type === 'final' && visited.has(node.id))
    if (!hasReachableFinal) {
      issues.push({
        code: 'NO_REACHABLE_FINAL',
        message: 'No hay ningún nodo "final" alcanzable desde el/los nodo(s) "start".',
      })
    }
  }

  return issues
}
