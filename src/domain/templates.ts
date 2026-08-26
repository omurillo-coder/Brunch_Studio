import { createProject, createConnectedNode, createNode, updateNode } from './project'
import { connect } from './graph'
import { addResponse, updateResponse } from './responses'
import { updateTextBlockBody } from './content'
import type { ProjectDocument } from './schemas'

/**
 * Plantillas de proyecto.
 *
 * Cada plantilla es una función pura `build(projectName)` que compone las
 * funciones de dominio ya existentes (`createProject`, `createConnectedNode`,
 * `updateNode`, `addResponse`, `updateResponse`, `connect`, `updateTextBlockBody`...)
 * para producir un `ProjectDocument` de partida distinto de "en blanco". No
 * se duplica ninguna regla de dominio aquí: esta capa solo encadena llamadas
 * reales.
 *
 * Nota sobre el texto de una diapositiva (milestone "Bloques de
 * contenido"): `updateNode` ya no acepta `body` para un nodo `slide` (solo
 * para `final`, que conserva un único `body`) — el texto de una diapositiva
 * nueva vive en el único bloque de texto con el que nace (`createNode`/
 * `createConnectedNode` siembran exactamente uno, ver
 * `src/domain/project.ts`), así que estas plantillas usan
 * `firstTextBlockId` + `updateTextBlockBody` para rellenarlo en vez de pasar
 * `body` a `updateNode`.
 *
 * Añadir una plantilla nueva en el futuro no requiere tocar la UI (el
 * selector de `HomeScreen` recorre `PROJECT_TEMPLATES`): basta con escribir
 * la función `build` y añadir una entrada al array.
 *
 * Milestone "Diapositiva de Inicio": LAS TRES plantillas (incluida "En
 * blanco", que hasta ahora era un simple alias de `createProject`) terminan
 * su `build` con `seedIntroNode` (ver más abajo), que añade la portada
 * obligatoria (nodo `intro`) y la conecta a lo que hasta entonces era el
 * primer nodo/inicio de la plantilla. Es el ÚNICO cambio de las tres — el
 * resto de nodos y conexiones de cada plantilla se construye exactamente
 * igual que antes de este milestone, usando `project.graph.startNodeId`
 * "de siempre" (una `SlideNode`) como ancla, y solo al final se antepone la
 * portada. `createProject` en sí NO se toca (ver su propio comentario en
 * `src/domain/project.ts`): sigue sin `intro`, deliberadamente, para no
 * afectar a quien la usa como bloque de construcción de bajo nivel fuera de
 * estas plantillas.
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
 * Devuelve el id del primer bloque de texto de una diapositiva. Todas las
 * diapositivas creadas por `createNode`/`createConnectedNode` nacen con
 * exactamente un bloque de texto (ver `newSlideNode` en
 * `src/domain/project.ts`), así que en el contexto controlado de estas
 * plantillas (que nunca añaden/quitan bloques antes de llamar a esto) "el
 * primero" es también "el único" — atajo de lectura análogo a
 * `lastResponseId`, para poder llamar a `updateTextBlockBody` sin que
 * `createNode` tenga que devolver el id del bloque que sembró.
 */
function firstTextBlockId(project: ProjectDocument, slideNodeId: string): string {
  const node = project.graph.nodes.find((candidate) => candidate.id === slideNodeId)
  if (!node || node.type !== 'slide') {
    throw new Error(`firstTextBlockId: "${slideNodeId}" no es una diapositiva.`)
  }
  const block = node.content.find((candidate) => candidate.type === 'text')
  if (!block) {
    throw new Error(`firstTextBlockId: la diapositiva "${slideNodeId}" no tiene ningún bloque de texto.`)
  }
  return block.id
}

/** Fija el texto del primer bloque de texto de una diapositiva, además de
 *  su título — atajo que combina `updateNode` (título) con
 *  `updateTextBlockBody` (cuerpo del bloque), usado por todas las plantillas
 *  para no repetir `firstTextBlockId` + las dos llamadas en cada punto. */
function updateSlideTitleAndBody(
  project: ProjectDocument,
  slideNodeId: string,
  title: string,
  body: string,
): ProjectDocument {
  const withTitle = updateNode(project, slideNodeId, { title })
  return updateTextBlockBody(withTitle, slideNodeId, firstTextBlockId(withTitle, slideNodeId), body)
}

/**
 * Añade la diapositiva de Inicio (nodo `intro`, obligatoria y única en todo
 * proyecto, ver `IntroNodeSchema` en `src/domain/schemas.ts`) a un
 * `ProjectDocument` ya construido, apuntándola al nodo que hasta ahora era
 * el punto de partida (`project.graph.startNodeId`) y desplazando el inicio
 * del proyecto para que sea la propia portada recién creada.
 *
 * Aplicado como ÚLTIMO paso de las tres plantillas: el resto de cada una se
 * construye exactamente igual que antes de existir el nodo `intro`, y solo
 * al final se antepone la portada — así el código de cada plantilla no
 * necesita saber nada sobre `intro`, ni antes ni durante su construcción.
 *
 * `createNode(..., 'intro', ...)` ya deja `graph.startNodeId` apuntando al
 * nodo nuevo (ver comentario de esa función en `src/domain/project.ts`),
 * así que aquí solo hace falta cablear su `targetNodeId` hacia el antiguo
 * inicio con un `connect` normal (el mismo `connect` genérico "sin
 * responseId", generalizado para aceptar un `intro` como origen).
 *
 * Posición del nodo `intro`: a la izquierda del que era el inicio, con un
 * offset fijo de 260px en X (mismo criterio, y mismo valor, que usa
 * `src/domain/migration.ts` al sintetizar un `intro` para un documento
 * antiguo) — no pretende ser una disposición final perfecta, el diseñador
 * puede moverlo desde el lienzo.
 */
function seedIntroNode(project: ProjectDocument): ProjectDocument {
  const previousStartId = project.graph.startNodeId
  const previousStart = project.graph.nodes.find((node) => node.id === previousStartId)
  const position = previousStart
    ? { x: previousStart.position.x - 260, y: previousStart.position.y }
    : { x: -260, y: 0 }

  const withIntro = createNode(project, 'intro', position)
  return connect(withIntro, withIntro.graph.startNodeId, previousStartId)
}

/**
 * "En blanco": el comportamiento de `createProject`, más la diapositiva de
 * Inicio obligatoria (ver `seedIntroNode`) apuntando a la única diapositiva
 * que crea `createProject`.
 */
function buildBlankTemplate(projectName: string): ProjectDocument {
  return seedIntroNode(createProject(projectName))
}

/**
 * "Decisión simple": Inicio ("de continuar") -> Diapositiva de decisión con
 * 2 respuestas -> cada respuesta lleva a un Final distinto.
 */
function buildSimpleDecisionTemplate(projectName: string): ProjectDocument {
  let project = createProject(projectName)
  const startId = project.graph.startNodeId

  project = updateSlideTitleAndBody(
    project,
    startId,
    'Introducción',
    'Bienvenido a este escenario de ejemplo. Pulsa continuar para llegar a la primera decisión.',
  )

  const decision = createConnectedNode(project, 'slide', { x: 320, y: 0 }, startId)
  project = decision.project
  const decisionId = decision.nodeId
  project = updateSlideTitleAndBody(
    project,
    decisionId,
    '¿Qué opción elige el usuario?',
    'Elige una de las dos opciones disponibles para continuar.',
  )

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

  return seedIntroNode(project)
}

/**
 * "Ramificación con reencuentro": Inicio -> Diapositiva de decisión con 2
 * respuestas -> AMBAS respuestas llevan a una diapositiva común intermedia
 * -> esa diapositiva lleva a un único Final.
 */
function buildBranchWithReunionTemplate(projectName: string): ProjectDocument {
  let project = createProject(projectName)
  const startId = project.graph.startNodeId

  project = updateSlideTitleAndBody(
    project,
    startId,
    'Introducción',
    'Bienvenido a este escenario de ejemplo. Pulsa continuar para llegar a la primera decisión.',
  )

  const decision = createConnectedNode(project, 'slide', { x: 320, y: 0 }, startId)
  project = decision.project
  const decisionId = decision.nodeId
  project = updateSlideTitleAndBody(
    project,
    decisionId,
    '¿Qué camino toma el usuario?',
    'Elige una de las dos opciones disponibles; ambas conducen al mismo punto del recorrido.',
  )

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
  project = updateSlideTitleAndBody(
    project,
    meetingId,
    'Punto de encuentro',
    'Ambos caminos confluyen aquí antes de llegar al final del escenario.',
  )
  project = connect(project, decisionId, meetingId, responseBId)

  const final = createConnectedNode(project, 'final', { x: 960, y: 0 }, meetingId)
  project = final.project
  project = updateNode(project, final.nodeId, {
    title: 'Final del escenario',
    body: 'Has completado el recorrido de ejemplo.',
  })

  return seedIntroNode(project)
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
