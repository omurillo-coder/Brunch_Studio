import { createProject, createConnectedNode, updateNode } from './project'
import { connect } from './graph'
import { addResponse, updateResponse } from './responses'
import type { ProjectDocument } from './schemas'

/**
 * Plantillas de proyecto.
 *
 * Cada plantilla es una función pura `build(projectName)` que compone las
 * funciones de dominio ya existentes (`createProject`, `createConnectedNode`,
 * `updateNode`, `addResponse`, `updateResponse`, `connect`...) para producir
 * un `ProjectDocument` de partida distinto de "en blanco". No se duplica
 * ninguna regla de dominio aquí: esta capa solo encadena llamadas reales.
 *
 * Añadir una plantilla nueva en el futuro no requiere tocar la UI (el
 * selector de `HomeScreen` recorre `PROJECT_TEMPLATES`): basta con escribir
 * la función `build` y añadir una entrada al array.
 */
export interface ProjectTemplate {
  /** Identificador estable, usado como `value` del selector en la UI. */
  id: string
  /** Nombre visible en el selector, p.ej. "Decisión simple". */
  name: string
  /** Una frase breve de qué es, visible junto al nombre en el selector. */
  description: string
  /** Construye el `ProjectDocument` de partida con el nombre de proyecto dado. */
  build: (projectName: string) => ProjectDocument
}

/**
 * Devuelve el id de la respuesta añadida más recientemente a una diapositiva
 * (la última del array, ya que `addResponse` siempre hace `push`). Atajo de
 * lectura para encadenar `addResponse` + `updateResponse`/`connect` sin que
 * el propio `addResponse` tenga que devolver el id creado.
 */
function lastResponseId(project: ProjectDocument, slideNodeId: string): string {
  const node = project.graph.nodes.find((candidate) => candidate.id === slideNodeId)
  if (!node || node.type !== 'slide' || node.responses.length === 0) {
    throw new Error(`lastResponseId: la diapositiva "${slideNodeId}" no tiene respuestas.`)
  }
  const response = node.responses[node.responses.length - 1]
  if (!response) {
    throw new Error(`lastResponseId: la diapositiva "${slideNodeId}" no tiene respuestas.`)
  }
  return response.id
}

/**
 * "En blanco": el comportamiento actual exacto de `createProject`, sin
 * ningún paso adicional. Debe ser indistinguible (salvo ids/fechas) de lo
 * que ya existía antes de las plantillas.
 */
function buildBlankTemplate(projectName: string): ProjectDocument {
  return createProject(projectName)
}

/**
 * "Decisión simple": Inicio ("de continuar") -> Diapositiva de decisión con
 * 2 respuestas -> cada respuesta lleva a un Final distinto.
 */
function buildSimpleDecisionTemplate(projectName: string): ProjectDocument {
  let project = createProject(projectName)
  const startId = project.graph.startNodeId

  project = updateNode(project, startId, {
    title: 'Introducción',
    body: 'Bienvenido a este escenario de ejemplo. Pulsa continuar para llegar a la primera decisión.',
  })

  const decision = createConnectedNode(project, 'slide', { x: 320, y: 0 }, startId)
  project = decision.project
  const decisionId = decision.nodeId
  project = updateNode(project, decisionId, {
    title: '¿Qué opción elige el usuario?',
    body: 'Elige una de las dos opciones disponibles para continuar.',
  })

  project = addResponse(project, decisionId)
  const responseAId = lastResponseId(project, decisionId)
  project = updateResponse(project, decisionId, responseAId, { text: 'Opción A' })

  project = addResponse(project, decisionId)
  const responseBId = lastResponseId(project, decisionId)
  project = updateResponse(project, decisionId, responseBId, { text: 'Opción B' })

  const finalA = createConnectedNode(project, 'final', { x: 640, y: -120 }, decisionId, responseAId)
  project = finalA.project
  project = updateNode(project, finalA.nodeId, {
    title: 'Final positivo',
    body: 'Has llegado a un final positivo del escenario.',
  })

  const finalB = createConnectedNode(project, 'final', { x: 640, y: 120 }, decisionId, responseBId)
  project = finalB.project
  project = updateNode(project, finalB.nodeId, {
    title: 'Final alternativo',
    body: 'Has llegado a un final alternativo del escenario.',
  })

  return project
}

/**
 * "Ramificación con reencuentro": Inicio -> Diapositiva de decisión con 2
 * respuestas -> AMBAS respuestas llevan a una diapositiva común intermedia
 * -> esa diapositiva lleva a un único Final.
 */
function buildBranchWithReunionTemplate(projectName: string): ProjectDocument {
  let project = createProject(projectName)
  const startId = project.graph.startNodeId

  project = updateNode(project, startId, {
    title: 'Introducción',
    body: 'Bienvenido a este escenario de ejemplo. Pulsa continuar para llegar a la primera decisión.',
  })

  const decision = createConnectedNode(project, 'slide', { x: 320, y: 0 }, startId)
  project = decision.project
  const decisionId = decision.nodeId
  project = updateNode(project, decisionId, {
    title: '¿Qué camino toma el usuario?',
    body: 'Elige una de las dos opciones disponibles; ambas conducen al mismo punto del recorrido.',
  })

  project = addResponse(project, decisionId)
  const responseAId = lastResponseId(project, decisionId)
  project = updateResponse(project, decisionId, responseAId, { text: 'Opción A' })

  project = addResponse(project, decisionId)
  const responseBId = lastResponseId(project, decisionId)
  project = updateResponse(project, decisionId, responseBId, { text: 'Opción B' })

  // La respuesta A crea y conecta la diapositiva común; la B se conecta al
  // mismo nodo ya existente con un `connect` normal (no crea uno nuevo).
  const meeting = createConnectedNode(project, 'slide', { x: 640, y: 0 }, decisionId, responseAId)
  project = meeting.project
  const meetingId = meeting.nodeId
  project = updateNode(project, meetingId, {
    title: 'Punto de encuentro',
    body: 'Ambos caminos confluyen aquí antes de llegar al final del escenario.',
  })
  project = connect(project, decisionId, meetingId, responseBId)

  const final = createConnectedNode(project, 'final', { x: 960, y: 0 }, meetingId)
  project = final.project
  project = updateNode(project, final.nodeId, {
    title: 'Final del escenario',
    body: 'Has completado el recorrido de ejemplo.',
  })

  return project
}

/**
 * Plantillas disponibles, en el orden en que deben verse en el selector.
 * "En blanco" siempre primero y seleccionada por defecto.
 */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'blank',
    name: 'En blanco',
    description: 'Empieza desde una única diapositiva vacía, sin nada más.',
    build: buildBlankTemplate,
  },
  {
    id: 'simple-decision',
    name: 'Decisión simple',
    description: 'Una decisión con dos respuestas que llevan a finales distintos.',
    build: buildSimpleDecisionTemplate,
  },
  {
    id: 'branch-reunion',
    name: 'Ramificación con reencuentro',
    description: 'Dos caminos que se reencuentran en una diapositiva común antes del final.',
    build: buildBranchWithReunionTemplate,
  },
]

/** Plantilla por defecto del selector: "En blanco". */
export const DEFAULT_PROJECT_TEMPLATE_ID = PROJECT_TEMPLATES[0]!.id

/** Busca una plantilla por id; lanza si no existe (id inválido es un error
 *  de programación en el llamador, no un caso de usuario). */
export function getProjectTemplate(id: string): ProjectTemplate {
  const template = PROJECT_TEMPLATES.find((candidate) => candidate.id === id)
  if (!template) {
    throw new Error(`No existe una plantilla de proyecto con id "${id}".`)
  }
  return template
}
