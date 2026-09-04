import { produce } from 'immer'
import { createId, nextNodeNumber, shiftNodeNumbersForNewIntro } from './id'
import { connect } from './graph'
import type {
  CanvasBadge,
  FinalNode,
  FinalVariant,
  IntroNode,
  Node,
  NodePosition,
  NodeType,
  ProjectDocument,
  ResponseOrder,
  SlideColor,
  SlideNode,
  VariableCondition,
  VariableDef,
  VariableEffect,
  VariableType,
} from './schemas'

/**
 * Campos editables al crear un nodo (aparte de tipo y posición).
 *
 * `body` tiene un significado distinto según `type` (decidido por
 * `createNode`, no por quien llama): en un `final` es directamente su
 * `body`; en un `slide` siembra el cuerpo del ÚNICO bloque de texto con el
 * que nace la diapositiva (ver `newSlideNode`) — nunca un `body` propio del
 * nodo, que ya no existe para `slide` desde el milestone "Bloques de
 * contenido".
 */
export interface CreateNodeExtra {
  title?: string
  body?: string
}

/**
 * Campos editables mediante `updateNode` (título y afines básicos). La
 * edición de los BLOQUES de contenido de una diapositiva (`SlideNode.content`
 * — añadir/quitar/reordenar un bloque, o editar el texto de uno concreto) NO
 * pasa por aquí: tiene sus propias funciones dedicadas en
 * `src/domain/content.ts`, mismo criterio que las respuestas de decisión
 * (`src/domain/responses.ts`) — un array estructural con identidad propia
 * por elemento no encaja bien como "un campo más" de un patch que se
 * reemplaza entero.
 *
 * Semántica de "patch" para `continueLabel`/`internalNote`: `undefined` no
 * toca el campo, `null` lo borra (lo deja `undefined` en el nodo — para
 * `continueLabel` eso significa "vuelve al texto por defecto", ver
 * `DEFAULT_CONTINUE_LABEL`) y un string lo fija a ese valor.
 *
 * `body` es ahora EXCLUSIVO de un nodo `final` (su único cuerpo de texto,
 * ver `FinalNodeSchema`): si el patch lo incluye y el nodo es `slide`,
 * `updateNode` lanza — usa `updateTextBlockBody` de `src/domain/content.ts`
 * para editar el texto de un bloque concreto de una diapositiva.
 *
 * `continueLabel`/`condition`/`elseTargetNodeId` solo aplican a nodos
 * `slide`: un `final` con alguno de estos campos presente en el patch
 * (aunque sea `null`) hace que `updateNode` lance, ver más abajo.
 * `internalNote` es válido en cualquier tipo de nodo (incluidos los
 * `final`), así que no participa de esa guarda.
 *
 * `condition`/`elseTargetNodeId` (enrutado condicional de una diapositiva
 * "de continuar", ver `SlideNodeSchema` en `src/domain/schemas.ts`): mismo
 * patrón de patch que el resto — `undefined` no toca, `null` borra,
 * `VariableCondition`/id fija. Deliberadamente NO se valida aquí que
 * `condition.value` case con el `type` de la variable referenciada (esa
 * variable vive en `project.variables`, fuera del nodo que se está
 * editando); es responsabilidad de la UI en la fase de editor, igual que se
 * documenta en el comentario de `VariableConditionSchema`.
 *
 * `color` (paleta cerrada de color de una diapositiva, ver `SlideColorSchema`
 * en `src/domain/schemas.ts`): mismo patrón de patch que `continueLabel` —
 * `undefined` no toca, `null` borra (vuelve a "sin colorear"), un nombre de
 * la paleta lo fija. Solo aplica a un nodo `slide`: si el patch lo incluye
 * (aunque sea `null`) y el nodo es `intro`/`final`, `updateNode` lanza, mismo
 * criterio que `continueLabel`/`condition`/`elseTargetNodeId`.
 *
 * `cicloId`/`asignaturaId`/`caseName` (milestone "Diapositiva de Inicio",
 * ver `IntroNodeSchema`): solo aplican a un nodo `intro`; si el patch los
 * incluye (aunque sea `null`, para los dos primeros) y el nodo es `slide` o
 * `final`, `updateNode` lanza — mismo criterio que el resto de campos
 * "exclusivos de un tipo" de este patch. `cicloId`/`asignaturaId` siguen la
 * semántica habitual de patch opcional-borrable (`undefined` no toca, `null`
 * borra, string fija); `caseName` no admite `null` porque el campo nunca es
 * `undefined` en el nodo (nace en `''`, ver `IntroNodeSchema.caseName`) —
 * mismo criterio que `body` de un `final`, que tampoco admite `null`.
 * `targetNodeId` de un `intro` NO se edita aquí (es un campo estructural de
 * conexión, igual que el de una `SlideNode`): usa `connect`/`disconnect` de
 * `src/domain/graph.ts`, generalizados para aceptar un nodo `intro` como
 * origen.
 *
 * `variant` (tres variantes de un Final — general/bueno/malo, ver
 * `FinalVariantSchema` en `src/domain/schemas.ts`): solo aplica a un nodo
 * `final`; si el patch lo incluye y el nodo es `slide`/`intro`, `updateNode`
 * lanza, mismo criterio que `body`. No admite `null` (a diferencia de
 * `color`): un `final` siempre tiene una variante (`.default('general')` en
 * el schema), nunca "sin variante" que borrar — mismo criterio que `caseName`
 * de un `intro`. Cambiar la variante es puramente una categoría/etiqueta
 * adicional: NUNCA toca ni vacía `body` (el texto del Final), que se sigue
 * editando por su cuenta, de forma completamente independiente.
 */
export interface UpdateNodePatch {
  title?: string
  body?: string
  continueLabel?: string | null
  internalNote?: string | null
  condition?: VariableCondition | null
  elseTargetNodeId?: string | null
  color?: SlideColor | null
  cicloId?: string | null
  asignaturaId?: string | null
  caseName?: string
  variant?: FinalVariant
  /** Solo en `slide` (milestone "+1 fallo con Game Over", ver
   *  `SlideNodeSchema.visitEffects`). Mismo criterio de patch que `effects`
   *  en `UpdateResponsePatch`: `undefined` no toca, `null` borra, un array
   *  REEMPLAZA la lista completa. */
  visitEffects?: VariableEffect[] | null
  /** Solo en `final` (milestone "+1 fallo con Game Over", ver
   *  `FinalNodeSchema.alternateCondition`/`alternateBody`). Mismo criterio
   *  de patch "`undefined` no toca, `null` borra" que el resto de campos
   *  opcionales de este parche. */
  alternateCondition?: VariableCondition | null
  alternateBody?: string | null
  /** Solo en `final` (milestone "+1 fallo con Game Over", ver
   *  `FinalNodeSchema.celebrate`). No admite `null` (a diferencia de
   *  `alternateCondition`/`alternateBody`): siempre es un booleano
   *  definido, mismo criterio que `caseName` de un `intro`. */
  celebrate?: boolean
  /** Solo en `slide` (milestone "+1 fallo con Game Over", ver
   *  `SlideNodeSchema.canvasBadge`). En la práctica, solo `addGameOverPack`
   *  (`src/domain/nodePacks.ts`) fija este campo — no hay ningún control de
   *  Inspector que lo edite. Mismo criterio de patch que `color`:
   *  `undefined` no toca, `null` borra (vuelve a "sin insignia"). */
  canvasBadge?: CanvasBadge | null
  /** Solo en `slide` (petición de usuario, ver `SlideNodeSchema.responseOrder`).
   *  Mismo criterio de patch que `color`: `undefined` no toca, `null` borra
   *  (vuelve a `'ordered'` implícito). */
  responseOrder?: ResponseOrder | null
  /** Solo en `slide` (ver `SlideNodeSchema.brandedGameOverScreen`). Mismo
   *  criterio que `celebrate`: siempre un booleano definido, no admite
   *  `null` — no hace falta "borrar" un `true`, basta con fijar `false`. */
  brandedGameOverScreen?: boolean
}

/**
 * Construye una diapositiva nueva con un único bloque de texto (cuyo cuerpo
 * es `body`, normalmente vacío) y sin ningún otro bloque — ni imagen ni
 * audio. Es la única función que crea el bloque inicial de una diapositiva
 * nueva, usada tanto por `createProject` como por `createNode`, para que
 * ambos caminos nazcan con exactamente el mismo `content` de partida.
 */
function newSlideNode(
  common: { id: string; number: number; position: NodePosition; title: string; body: string },
): SlideNode {
  const { body, ...rest } = common
  return {
    ...rest,
    type: 'slide',
    targetNodeId: undefined,
    continueLabel: undefined,
    responses: [],
    content: [{ id: createId(), type: 'text', body }],
  }
}

/**
 * Crea un `ProjectDocument` nuevo con metadata coherente y una única
 * diapositiva automática (número visible 1, posición de origen), que además
 * es el punto de partida del recorrido (`graph.startNodeId`).
 *
 * Ya no existe un nodo "Inicio" separado e invisible: la primera
 * diapositiva del proyecto ES el inicio.
 *
 * Nota "Diapositiva de Inicio" (nodo `intro`): esta función de bajo nivel
 * DELIBERADAMENTE no siembra ningún nodo `intro` — sigue produciendo
 * exactamente el documento mínimo de siempre (una única `SlideNode` como
 * inicio), para no romper a quien ya la usa como bloque de construcción
 * puro (la mayoría de tests de dominio, y el resto de funciones de este
 * archivo). La portada obligatoria la añaden las plantillas de
 * `src/domain/templates.ts` (las tres, incluida "En blanco") a partir del
 * resultado de esta función — es el único camino de creación de proyecto
 * expuesto a la UI (`HomeScreen`), así que todo proyecto que un usuario
 * real llega a crear SÍ nace con su `intro`. Un `.brunch` guardado sin
 * `intro` (cualquiera creado antes de este milestone) lo sintetiza
 * `src/domain/migration.ts` al abrirlo.
 */
export function createProject(name: string): ProjectDocument {
  const now = new Date().toISOString()
  const startSlide = newSlideNode({
    id: createId(),
    number: 1,
    position: { x: 0, y: 0 },
    title: '',
    body: '',
  })

  return {
    schemaVersion: 1,
    metadata: {
      id: createId(),
      name,
      createdAt: now,
      updatedAt: now,
    },
    settings: {},
    variables: [],
    graph: {
      nodes: [startSlide],
      startNodeId: startSlide.id,
    },
    editor: {
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  }
}

function touchUpdatedAt(project: ProjectDocument): void {
  project.metadata.updatedAt = new Date().toISOString()
}

function findNodeIndex(project: ProjectDocument, nodeId: string): number {
  return project.graph.nodes.findIndex((node) => node.id === nodeId)
}

/**
 * Crea y añade un nodo nuevo al proyecto.
 *
 * Una diapositiva nueva nace SIN respuestas: se comporta como "de
 * continuar" (un único destino, `targetNodeId`) hasta que se le añade la
 * primera respuesta desde el Inspector (ver `addResponse`), momento en el
 * que pasa a comportarse como decisión. Ya no hay ninguna guarda de
 * "segundo nodo start" porque el tipo `start` no existe; lo que sí sigue
 * siendo imposible es crear un tipo inexistente (lo impide el tipado de
 * `NodeType`, y el `switch` es exhaustivo).
 *
 * Guarda de dominio para `type: 'intro'` (milestone "Diapositiva de
 * Inicio"): lanza `Error` si el proyecto YA tiene un nodo `intro` — solo
 * puede haber uno, ver `IntroNodeSchema`. La UI de fases futuras
 * deshabilitará el botón de crear otra portada cuando ya exista una, pero
 * esta guarda es defensa en profundidad del propio dominio, que no debe
 * confiar en que la UI sea la única vía de entrada (mismo criterio que el
 * resto de invariantes de este archivo). Si no lo tenía, el nodo `intro`
 * nuevo se crea Y ADEMÁS se convierte en `graph.startNodeId`,
 * DESPLAZANDO lo que hubiera antes (una `SlideNode`, siempre, ya que solo
 * puede haber un `intro`) — una portada recién añadida a un proyecto ya
 * empezado pasa a ser su punto de partida real de inmediato, sin paso
 * intermedio en el que el proyecto se quede sin inicio válido.
 *
 * Milestone "Inicio siempre es D1": un nodo `intro` SIEMPRE nace con
 * `number: 1`, sea cual sea el estado del proyecto en ese momento — nunca
 * usa `nextNodeNumber` como el resto de tipos. Si el proyecto ya tenía otros
 * nodos numerados, TODOS desplazan su `number` una unidad hacia arriba (ver
 * `shiftNodeNumbersForNewIntro` en `src/domain/id.ts`, misma función que usa
 * `ensureIntroNode` en `src/domain/migration.ts` para el caso equivalente en
 * un documento antiguo) antes de insertar el `intro` — así nunca hay dos
 * nodos con el mismo `number`. Efecto secundario deliberado y aceptado
 * (petición explícita de usuario): este camino puede renumerar nodos ya
 * existentes del proyecto, ver el comentario de esa función para el porqué.
 */
export function createNode(
  project: ProjectDocument,
  type: NodeType,
  position: NodePosition,
  extra: CreateNodeExtra = {},
): ProjectDocument {
  if (type === 'intro' && project.graph.nodes.some((node) => node.type === 'intro')) {
    throw new Error(
      'El proyecto ya tiene una diapositiva de Inicio: solo puede haber una por proyecto.',
    )
  }

  const number =
    type === 'intro' ? 1 : nextNodeNumber(project.graph.nodes.map((node) => node.number))
  const title = extra.title ?? ''
  const body = extra.body ?? ''
  const common = { id: createId(), number, position, title }

  let newNode: Node
  switch (type) {
    case 'intro': {
      const node: IntroNode = {
        ...common,
        type: 'intro',
        cicloId: undefined,
        asignaturaId: undefined,
        caseName: '',
        targetNodeId: undefined,
      }
      newNode = node
      break
    }
    case 'slide': {
      newNode = newSlideNode({ ...common, body })
      break
    }
    case 'final': {
      const node: FinalNode = { ...common, type: 'final', body, variant: 'general' }
      newNode = node
      break
    }
  }

  return produce(project, (draft) => {
    if (newNode.type === 'intro') {
      // Desplaza el `number` de todos los nodos ya existentes ANTES de
      // insertar el `intro` (que se queda con el 1) — ver comentario de
      // `createNode` y de `shiftNodeNumbersForNewIntro` en
      // `src/domain/id.ts`.
      draft.graph.nodes = shiftNodeNumbersForNewIntro(draft.graph.nodes)
      // El Inicio siempre va PRIMERO en `graph.nodes` (no al final, como el
      // resto de tipos): ese orden es el que usa el panel izquierdo para
      // pintar la lista (`src/domain/nodeOrder.ts`), y el Inicio es fijo ahí
      // — nunca se puede arrastrar ni soltar por delante de él (ver
      // `LeftPanel.tsx`). `ensureIntroNode` (`migration.ts`) aplica el mismo
      // criterio para documentos que ya tenían un Inicio en otra posición.
      draft.graph.nodes.unshift(newNode)
    } else {
      draft.graph.nodes.push(newNode)
    }
    if (newNode.type === 'intro') {
      draft.graph.startNodeId = newNode.id
    }
    touchUpdatedAt(draft)
  })
}

/**
 * Elimina un nodo y limpia cualquier referencia entrante hacia él: el
 * `targetNodeId` de cualquier diapositiva, y el `targetNodeId` de cualquier
 * respuesta, que apuntaran al nodo borrado quedan en `undefined`. Lanza
 * `Error` si el nodo no existe.
 *
 * Guarda de dominio: nunca se puede eliminar la diapositiva de inicio
 * (`graph.startNodeId`). No hay forma de reasignar el punto de partida a
 * otra diapositiva, así que permitirlo dejaría el proyecto sin inicio y en
 * un estado del que no se puede salir por la vía interactiva normal. Lanza
 * `Error` en vez de ignorar la petición en silencio, mismo criterio que el
 * resto de guardas de esta función.
 *
 * Milestone "Diapositiva de Inicio": un nodo `intro` NUNCA se puede
 * eliminar, comprobado con DOS guardas independientes — por `type ===
 * 'intro'` (robusta, no depende de nada más) Y por `nodeId ===
 * graph.startNodeId` (la guarda ya existente, que sigue disparando también
 * porque `intro` es siempre `startNodeId` cuando existe). Duplicar la
 * comprobación es deliberado: la primera no depende de que ambas
 * condiciones coincidan en ese instante (defensa en profundidad si algún
 * futuro cambio de dominio llegara a desincronizarlas), y quitar la segunda
 * dejaría de proteger el caso — hoy inalcanzable por otras guardas, pero no
 * garantizado a seguir siéndolo — de un proyecto sin `intro` cuyo
 * `startNodeId` señale una `SlideNode`.
 */
export function deleteNode(project: ProjectDocument, nodeId: string): ProjectDocument {
  const index = findNodeIndex(project, nodeId)
  if (index === -1) {
    throw new Error(`No existe un nodo con id "${nodeId}".`)
  }
  if (project.graph.nodes[index]?.type === 'intro') {
    throw new Error('La diapositiva de Inicio no se puede eliminar.')
  }
  if (nodeId === project.graph.startNodeId) {
    throw new Error('No se puede eliminar la diapositiva de inicio del proyecto.')
  }

  return produce(project, (draft) => {
    draft.graph.nodes = draft.graph.nodes.filter((node) => node.id !== nodeId)

    for (const node of draft.graph.nodes) {
      if (node.type === 'intro') {
        if (node.targetNodeId === nodeId) {
          node.targetNodeId = undefined
        }
        continue
      }
      if (node.type !== 'slide') continue
      if (node.targetNodeId === nodeId) {
        node.targetNodeId = undefined
      }
      for (const response of node.responses) {
        if (response.targetNodeId === nodeId) {
          response.targetNodeId = undefined
        }
      }
    }

    touchUpdatedAt(draft)
  })
}

/** Mueve un nodo a una nueva posición del lienzo. */
export function moveNode(
  project: ProjectDocument,
  nodeId: string,
  position: NodePosition,
): ProjectDocument {
  const index = findNodeIndex(project, nodeId)
  if (index === -1) {
    throw new Error(`No existe un nodo con id "${nodeId}".`)
  }

  return produce(project, (draft) => {
    const node = draft.graph.nodes[index]
    if (node) {
      node.position = position
    }
    touchUpdatedAt(draft)
  })
}

/** Un movimiento individual dentro de un `moveNodes`. */
export interface NodeMove {
  nodeId: string
  position: NodePosition
}

/**
 * Mueve varios nodos a la vez en una única operación de dominio (un único
 * `produce` de immer). Pensada para el arrastre de una selección múltiple en
 * el lienzo: llamar a `moveNode` una vez por nodo generaría una entrada de
 * historial por nodo en el store, deshaciendo el gesto "arrastrar N nodos
 * seleccionados" en N pasos de `undo` en vez de uno.
 *
 * Valida que todos los ids existan ANTES de mutar nada (así, si alguno no
 * existe, no se aplica ningún movimiento parcial) y lanza `Error` si falta
 * alguno — mismo criterio que `moveNode`.
 */
export function moveNodes(project: ProjectDocument, moves: NodeMove[]): ProjectDocument {
  for (const move of moves) {
    if (findNodeIndex(project, move.nodeId) === -1) {
      throw new Error(`No existe un nodo con id "${move.nodeId}".`)
    }
  }

  return produce(project, (draft) => {
    for (const move of moves) {
      const node = draft.graph.nodes.find((candidate) => candidate.id === move.nodeId)
      if (node) {
        node.position = move.position
      }
    }
    touchUpdatedAt(draft)
  })
}

/**
 * Actualiza campos editables básicos de un nodo (título/texto de botón de
 * continuar/nota interna/enrutado condicional, y el `body` — solo para un
 * `final`). No permite cambiar `type`, `id`, `number` ni campos
 * estructurales (responses, targetNodeId, bloques de contenido) — para eso
 * existen funciones dedicadas (`src/domain/responses.ts`,
 * `src/domain/content.ts`, `connect`/`disconnect` en `src/domain/graph.ts`).
 *
 * `body` solo es válido en un `final`: si el patch lo incluye y el nodo es
 * `slide`, lanza `Error` — una diapositiva ya no tiene un `body` único, ver
 * `updateTextBlockBody` en `src/domain/content.ts`.
 *
 * `continueLabel`/`condition`/`elseTargetNodeId` solo son válidos en nodos
 * `slide`: si el patch los incluye (aunque sea con valor `null` para los que
 * admiten borrado) y el nodo es `final`, lanza `Error` — un Final no admite
 * botón de continuar ni enrutado condicional. `internalNote` es válido en
 * cualquier tipo de nodo y no participa de esta guarda.
 */
export function updateNode(
  project: ProjectDocument,
  nodeId: string,
  patch: UpdateNodePatch,
): ProjectDocument {
  const index = findNodeIndex(project, nodeId)
  if (index === -1) {
    throw new Error(`No existe un nodo con id "${nodeId}".`)
  }

  const node = project.graph.nodes[index]
  const setsSlideOnlyField =
    patch.continueLabel !== undefined ||
    patch.condition !== undefined ||
    patch.elseTargetNodeId !== undefined ||
    patch.color !== undefined ||
    patch.visitEffects !== undefined ||
    patch.canvasBadge !== undefined ||
    patch.responseOrder !== undefined ||
    patch.brandedGameOverScreen !== undefined
  if (setsSlideOnlyField && node && node.type !== 'slide') {
    throw new Error(
      `El nodo "${nodeId}" es de tipo "${node.type}" y no admite texto de continuar, enrutado condicional, color, efecto al visitar, insignia de lienzo, orden de respuestas ni pantalla de marca "Game Over".`,
    )
  }
  if (patch.body !== undefined && node && node.type !== 'final') {
    throw new Error(
      `El nodo "${nodeId}" es de tipo "${node.type}" y no tiene un único "body": usa las funciones de src/domain/content.ts para editar sus bloques de contenido.`,
    )
  }
  if (patch.variant !== undefined && node && node.type !== 'final') {
    throw new Error(
      `El nodo "${nodeId}" es de tipo "${node.type}" y no admite variante de Final (general/bueno/malo).`,
    )
  }
  const setsFinalAlternateField =
    patch.alternateCondition !== undefined ||
    patch.alternateBody !== undefined ||
    patch.celebrate !== undefined
  if (setsFinalAlternateField && node && node.type !== 'final') {
    throw new Error(
      `El nodo "${nodeId}" es de tipo "${node.type}" y no admite variante alternativa ni confeti de Final.`,
    )
  }
  const setsIntroOnlyField =
    patch.cicloId !== undefined || patch.asignaturaId !== undefined || patch.caseName !== undefined
  if (setsIntroOnlyField && node && node.type !== 'intro') {
    throw new Error(
      `El nodo "${nodeId}" es de tipo "${node.type}" y no admite campos de diapositiva de Inicio (ciclo/asignatura/nombre de caso).`,
    )
  }

  return produce(project, (draft) => {
    const draftNode = draft.graph.nodes[index]
    if (!draftNode) return
    if (patch.title !== undefined) draftNode.title = patch.title
    if (patch.internalNote !== undefined) {
      draftNode.internalNote = patch.internalNote === null ? undefined : patch.internalNote
    }
    if (draftNode.type === 'final') {
      if (patch.body !== undefined) draftNode.body = patch.body
      if (patch.variant !== undefined) draftNode.variant = patch.variant
      if (patch.alternateCondition !== undefined) {
        draftNode.alternateCondition =
          patch.alternateCondition === null ? undefined : patch.alternateCondition
      }
      if (patch.alternateBody !== undefined) {
        draftNode.alternateBody = patch.alternateBody === null ? undefined : patch.alternateBody
      }
      if (patch.celebrate !== undefined) draftNode.celebrate = patch.celebrate
    }
    if (draftNode.type === 'slide') {
      if (patch.continueLabel !== undefined) {
        draftNode.continueLabel = patch.continueLabel === null ? undefined : patch.continueLabel
      }
      if (patch.condition !== undefined) {
        draftNode.condition = patch.condition === null ? undefined : patch.condition
      }
      if (patch.elseTargetNodeId !== undefined) {
        draftNode.elseTargetNodeId =
          patch.elseTargetNodeId === null ? undefined : patch.elseTargetNodeId
      }
      if (patch.color !== undefined) {
        draftNode.color = patch.color === null ? undefined : patch.color
      }
      if (patch.visitEffects !== undefined) {
        draftNode.visitEffects = patch.visitEffects === null ? undefined : patch.visitEffects
      }
      if (patch.canvasBadge !== undefined) {
        draftNode.canvasBadge = patch.canvasBadge === null ? undefined : patch.canvasBadge
      }
      if (patch.responseOrder !== undefined) {
        draftNode.responseOrder = patch.responseOrder === null ? undefined : patch.responseOrder
      }
      if (patch.brandedGameOverScreen !== undefined) {
        draftNode.brandedGameOverScreen = patch.brandedGameOverScreen
      }
    }
    if (draftNode.type === 'intro') {
      if (patch.cicloId !== undefined) {
        draftNode.cicloId = patch.cicloId === null ? undefined : patch.cicloId
      }
      if (patch.asignaturaId !== undefined) {
        draftNode.asignaturaId = patch.asignaturaId === null ? undefined : patch.asignaturaId
      }
      if (patch.caseName !== undefined) draftNode.caseName = patch.caseName
    }
    touchUpdatedAt(draft)
  })
}

/** Resultado de `createConnectedNode`: el documento resultante más el id del
 *  nodo recién creado (para poder seleccionarlo de inmediato sin recurrir a
 *  heurísticas como "el de mayor `number`"). */
export interface CreateConnectedNodeResult {
  project: ProjectDocument
  nodeId: string
}

/**
 * Crea un nodo nuevo y lo conecta a un nodo/respuesta de origen en una sola
 * operación de dominio.
 *
 * Pensada para el flujo "arrastrar una conexión hasta el vacío del lienzo y
 * elegir qué crear": sin esta función, el store tendría que encadenar
 * `createNode` + `connect` como dos llamadas independientes, lo que en el
 * diseño actual del store (cada acción de dominio empuja una entrada a
 * `history.past`) generaría dos entradas de historial deshacibles por
 * separado en vez de una única acción percibida por el usuario.
 *
 * Internamente llama a `createNode` y después a `connect` sobre su
 * resultado. El `nodeId` devuelto se obtiene comparando los ids de nodo
 * antes/después de `createNode` (el único nodo nuevo es el que no estaba en
 * el conjunto anterior) — deliberadamente no "el nodo de mayor `number`":
 * esa heurística deja de ser correcta en cuanto haya habido borrados o, en
 * el futuro, reordenaciones, mientras que comparar por id es correcto sea
 * cual sea el estado previo del proyecto.
 *
 * Si `sourceNodeId`/`sourceResponseId` no describen una combinación válida
 * (nodo inexistente, `sourceResponseId` que no pertenece al nodo de origen,
 * origen de tipo `final`...), `connect` lanza y esta función propaga el
 * error sin capturarlo — igual que el resto de funciones de dominio.
 */
export function createConnectedNode(
  project: ProjectDocument,
  type: NodeType,
  position: NodePosition,
  sourceNodeId: string,
  sourceResponseId?: string,
): CreateConnectedNodeResult {
  const existingIds = new Set(project.graph.nodes.map((node) => node.id))
  const withNewNode = createNode(project, type, position)
  const newNode = withNewNode.graph.nodes.find((node) => !existingIds.has(node.id))
  if (!newNode) {
    // No debería ocurrir nunca: `createNode` siempre añade exactamente un
    // nodo con un id nuevo salvo que lance. Se cubre de todos modos para no
    // dejar pasar un `undefined` silencioso hacia `connect`.
    throw new Error('createConnectedNode: no se pudo identificar el nodo recién creado.')
  }

  const connected = connect(withNewNode, sourceNodeId, newNode.id, sourceResponseId)
  return { project: connected, nodeId: newNode.id }
}

/** Resultado de `duplicateNode`: el documento resultante más el id de la
 *  copia recién creada — mismo criterio que `CreateConnectedNodeResult`, así
 *  quien llama (el store) no tiene que adivinarlo comparando ids antes/
 *  después ni asumiendo que es "el de mayor `number`". */
export interface DuplicateNodeResult {
  project: ProjectDocument
  nodeId: string
}

/**
 * Duplica un nodo existente: crea una copia con id y `number` propios, en
 * `position`, con el mismo contenido que el original (título, nota interna,
 * y — según el tipo — el `body` de un `final`, o para una diapositiva sus
 * bloques de contenido, texto de "Continuar" y respuestas, cada una con su
 * propio texto/puntos/efectos/condición de visibilidad). Lanza `Error` si el
 * nodo no existe, mismo criterio que el resto de esta familia de funciones.
 *
 * Los bloques de `content` de una diapositiva se clonan con un `id` NUEVO
 * cada uno (nunca reutilizan el id del bloque original): son entidades con
 * identidad propia dentro del documento, mismo criterio que las respuestas
 * clonadas más abajo — dos bloques con el mismo id en diapositivas distintas
 * del proyecto no tendría ningún significado y podría confundir a quien
 * edite uno esperando que el otro no cambie.
 *
 * DECISIÓN DE DISEÑO DELIBERADA — la copia NO conserva ninguna conexión
 * SALIENTE del original:
 * - El `targetNodeId` de "Continuar" de una diapositiva, y su
 *   `condition`/`elseTargetNodeId` de enrutado condicional si los tuviera,
 *   quedan `undefined` en la copia.
 * - El `targetNodeId` de cada respuesta clonada también queda `undefined`
 *   (la respuesta SÍ conserva su id nuevo — no reutiliza el de la original,
 *   son entidades distintas — junto con su texto/puntos/efectos/condición de
 *   visibilidad, que sí son contenido y se copian tal cual).
 *
 * Motivo: duplicar contenido para reutilizarlo como diapositiva nueva sirve
 * para partir de un texto/estructura ya hecho y llevarlo a otro punto del
 * recorrido — no debería crear silenciosamente una segunda ruta que apunta
 * exactamente a los mismos destinos que la original sin que el diseñador lo
 * pida de forma explícita (conectando la copia a mano, vía `connect`).
 *
 * Si el nodo duplicado es la diapositiva de inicio (`graph.startNodeId`), la
 * copia NO hereda esa condición: el `startNodeId` del proyecto sigue
 * apuntando al original, nunca a la copia.
 *
 * Implementación genérica por tipo de nodo, igual que `createNode`: los
 * campos comunes (`title`/`body`/`internalNote`) se copian para cualquier
 * tipo, y un único `switch (source.type)` exhaustivo añade los campos
 * propios de cada tipo concreto (hoy `slide` tiene campos adicionales que
 * copiar/limpiar, y `intro` ni siquiera eso — ver más abajo). El tipado de
 * `NodeType` obliga a que ese `switch` cubra cualquier tipo nuevo que se
 * añada en el futuro — el compilador avisa si falta un `case`, así que esta
 * función no puede "olvidarse" de un tipo nuevo en silencio, no hace falta
 * ningún `if (type === 'slide' || type === 'final')` explícito.
 *
 * Milestone "Diapositiva de Inicio": duplicar un nodo `intro` LANZA — no se
 * puede ni debe duplicar, ya que solo puede haber uno por proyecto (ver
 * `IntroNodeSchema`); una copia dejaría el proyecto con dos, violando esa
 * invariante de inmediato. A diferencia de otras guardas de este archivo
 * que comparan contra `graph.startNodeId`, aquí basta con el `case 'intro'`
 * del `switch`: cualquier nodo de ese tipo, sea o no el `startNodeId`
 * actual (siempre lo es cuando existe), no se puede duplicar.
 */
export function duplicateNode(
  project: ProjectDocument,
  nodeId: string,
  position: NodePosition,
): DuplicateNodeResult {
  const source = project.graph.nodes.find((node) => node.id === nodeId)
  if (!source) {
    throw new Error(`No existe un nodo con id "${nodeId}".`)
  }

  const number = nextNodeNumber(project.graph.nodes.map((node) => node.number))
  const common = {
    id: createId(),
    number,
    position,
    title: source.title,
    internalNote: source.internalNote,
  }

  let duplicate: Node
  switch (source.type) {
    case 'intro': {
      throw new Error(
        'La diapositiva de Inicio no se puede duplicar: solo puede haber una por proyecto.',
      )
    }
    case 'slide': {
      const node: SlideNode = {
        ...common,
        type: 'slide',
        // Conexiones salientes deliberadamente limpias, ver comentario de
        // la función.
        targetNodeId: undefined,
        condition: undefined,
        elseTargetNodeId: undefined,
        continueLabel: source.continueLabel,
        responses: source.responses.map((response) => ({
          ...response,
          id: createId(),
          targetNodeId: undefined,
        })),
        content: source.content.map((block) => ({ ...block, id: createId() })),
        // A diferencia de las conexiones salientes, el color es una marca
        // puramente visual (de qué rama/hilo narrativo forma parte una
        // diapositiva para quien monta el escenario) sin ningún efecto en el
        // recorrido — no hay motivo para limpiarla al duplicar, al
        // contrario: lo más útil es que la copia nazca marcada igual que el
        // original, ya que normalmente se duplica precisamente para crear
        // otra variante dentro de la MISMA rama.
        color: source.color,
        // Corrección (revisión de código, milestone "+1 fallo con Game
        // Over"): `visitEffects`/`canvasBadge` son CONTENIDO/comportamiento
        // de la diapositiva, mismo criterio que `color` justo arriba — sin
        // esto, duplicar la diapositiva "+1 Fallo" perdía en silencio tanto
        // su insignia como el propio efecto de sumar Fallos al visitarla.
        visitEffects: source.visitEffects,
        canvasBadge: source.canvasBadge,
        // Petición de usuario ("Ordenar"/"Random"): mismo criterio que
        // `color` de arriba — comportamiento de la diapositiva, no una
        // conexión saliente que deba limpiarse.
        responseOrder: source.responseOrder,
        // Mismo criterio que `canvasBadge`/`responseOrder`: comportamiento
        // de la diapositiva (determina cómo se renderiza en el Player), no
        // una conexión saliente — se copia tal cual.
        brandedGameOverScreen: source.brandedGameOverScreen,
      }
      duplicate = node
      break
    }
    case 'final': {
      // `variant` es contenido (categoría del Final), se copia tal cual —
      // mismo criterio que `color` en una `slide`, ver comentario más arriba.
      // Corrección (revisión de código, milestone "+1 fallo con Game Over"):
      // `alternateCondition`/`alternateBody`/`celebrate` son también
      // contenido del Final (la variante "con fallos" y el confeti) —
      // faltaban aquí, así que duplicar un Final con variante alternativa
      // perdía esa variante y el confeti en silencio.
      const node: FinalNode = {
        ...common,
        type: 'final',
        body: source.body,
        variant: source.variant,
        alternateCondition: source.alternateCondition,
        alternateBody: source.alternateBody,
        celebrate: source.celebrate,
      }
      duplicate = node
      break
    }
  }

  const next = produce(project, (draft) => {
    draft.graph.nodes.push(duplicate)
    touchUpdatedAt(draft)
  })

  return { project: next, nodeId: duplicate.id }
}

// ---------------------------------------------------------------------------
// Variables del proyecto
// ---------------------------------------------------------------------------
//
// Sección independiente del resto de `project.ts` (que gira en torno al
// grafo de nodos): estas funciones manipulan `project.variables`, la lista
// PLANA de definiciones de variable del proyecto (ver `VariableDefSchema` y
// el comentario de "por qué a nivel raíz del documento" en
// `src/domain/schemas.ts`). Nunca tocan `project.graph` salvo `deleteVariable`,
// que limpia referencias colgantes (ver más abajo).

function findVariableIndex(project: ProjectDocument, variableId: string): number {
  return project.variables.findIndex((variable) => variable.id === variableId)
}

/**
 * Valida que un nombre de variable sea utilizable: no vacío tras recortar
 * espacios (mismo criterio que el resto de textos del dominio) y que no
 * coincida ya con el de otra variable del proyecto.
 *
 * Nota sobre unicidad: la comparación es exacta tras `trim()` (sensible a
 * mayúsculas/minúsculas), NO normalizada — "Puntos" y "puntos" se consideran
 * nombres distintos. Es una decisión deliberadamente simple para esta fase
 * (ver comentario del enunciado: "no hace falta forzar unicidad estricta a
 * nivel de schema si es complicado"): evita la complejidad de decidir una
 * normalización (¿case-insensitive? ¿colapsar espacios internos?) que ni el
 * editor ni el reproductor necesitan todavía. `excludeVariableId` permite
 * que `updateVariable` valide el nuevo nombre contra las DEMÁS variables sin
 * chocar consigo misma cuando el nombre no cambia.
 */
function assertUsableVariableName(
  project: ProjectDocument,
  name: string,
  excludeVariableId?: string,
): string {
  const trimmed = name.trim()
  if (trimmed === '') {
    throw new Error('El nombre de una variable no puede estar vacío.')
  }
  const clash = project.variables.find(
    (variable) => variable.id !== excludeVariableId && variable.name === trimmed,
  )
  if (clash) {
    throw new Error(`Ya existe una variable con el nombre "${trimmed}".`)
  }
  return trimmed
}

/**
 * Valida que `initialValue` sea del tipo primitivo de JavaScript que
 * corresponde a `type` ("number" -> `number`, "boolean" -> `boolean`). Es la
 * única comprobación de coherencia tipo/valor que SÍ puede hacer el dominio
 * (a diferencia del schema Zod, ver comentario de `VariableDefSchema`):
 * aquí `type` y `value` llegan juntos en la misma llamada, así que no hace
 * falta ir a buscar la variable referenciada a otra parte del documento.
 */
function assertValueMatchesType(type: VariableType, value: number | boolean): void {
  const actual = typeof value
  if ((type === 'number' && actual !== 'number') || (type === 'boolean' && actual !== 'boolean')) {
    throw new Error(
      `El valor (${JSON.stringify(value)}) no es del tipo "${type}" declarado para la variable.`,
    )
  }
}

/** Campos necesarios para crear una variable nueva; el `id` lo genera
 *  `addVariable` (mismo patrón que `addResponse`, que tampoco recibe el id
 *  de la respuesta que crea). */
export interface AddVariableInput {
  name: string
  type: VariableType
  initialValue: number | boolean
}

/**
 * Añade una variable nueva al proyecto. Lanza `Error` si el nombre (tras
 * recortar espacios) está vacío, si ya existe una variable con ese nombre, o
 * si `initialValue` no es del tipo primitivo que corresponde a `type` — ver
 * `assertUsableVariableName`/`assertValueMatchesType`.
 */
export function addVariable(project: ProjectDocument, input: AddVariableInput): ProjectDocument {
  const name = assertUsableVariableName(project, input.name)
  assertValueMatchesType(input.type, input.initialValue)

  const newVariable: VariableDef = {
    id: createId(),
    name,
    type: input.type,
    initialValue: input.initialValue,
  }

  return produce(project, (draft) => {
    draft.variables.push(newVariable)
    touchUpdatedAt(draft)
  })
}

/**
 * Campos editables de una variable ya creada mediante `updateVariable`.
 *
 * A diferencia de `UpdateNodePatch`/`UpdateResponsePatch`, ningún campo de
 * `VariableDef` es opcional/borrable (nombre, tipo e `initialValue` son
 * siempre obligatorios), así que la semántica de patch aquí es más simple:
 * `undefined` no toca el campo, un valor lo fija — no existe un tercer caso
 * "borrar con `null`" porque no hay nada que dejar vacío.
 */
export interface UpdateVariablePatch {
  name?: string
  type?: VariableType
  initialValue?: number | boolean
}

/**
 * Actualiza una variable ya existente. Lanza `Error` si la variable no
 * existe, si el nuevo nombre (cuando se indica) está vacío o ya está en uso
 * por OTRA variable, o si la combinación resultante de `type`/`initialValue`
 * (mezclando lo que trae el patch con lo que ya tenía la variable) queda
 * incoherente — p.ej. cambiar solo `type` a "boolean" dejando un
 * `initialValue` numérico sin actualizarlo en la misma llamada.
 *
 * No permite cambiar `id` (no forma parte del patch, igual que en el resto
 * del dominio).
 */
export function updateVariable(
  project: ProjectDocument,
  variableId: string,
  patch: UpdateVariablePatch,
): ProjectDocument {
  const index = findVariableIndex(project, variableId)
  if (index === -1) {
    throw new Error(`No existe una variable con id "${variableId}".`)
  }
  const current = project.variables[index]
  if (!current) {
    throw new Error(`No existe una variable con id "${variableId}".`)
  }

  const name = patch.name !== undefined ? assertUsableVariableName(project, patch.name, variableId) : undefined

  const resultingType = patch.type ?? current.type
  const resultingInitialValue = patch.initialValue ?? current.initialValue
  if (patch.type !== undefined || patch.initialValue !== undefined) {
    assertValueMatchesType(resultingType, resultingInitialValue)
  }

  return produce(project, (draft) => {
    const draftVariable = draft.variables[index]
    if (!draftVariable) return
    if (name !== undefined) draftVariable.name = name
    if (patch.type !== undefined) draftVariable.type = patch.type
    if (patch.initialValue !== undefined) draftVariable.initialValue = patch.initialValue
    touchUpdatedAt(draft)
  })
}

/**
 * Elimina una variable del proyecto y limpia cualquier referencia colgante
 * hacia ella repartida por el grafo:
 * - `condition` de una diapositiva "de continuar", si referenciaba esta
 *   variable, se borra (vuelve a `undefined`).
 * - `condition` de una respuesta de decisión, igual.
 * - `effects` de una respuesta de decisión: se quitan SOLO los efectos que
 *   referenciaban esta variable (los demás se conservan); si la lista queda
 *   vacía, el campo se deja en `undefined` en vez de `[]`, igual criterio
 *   que "ausente = sin efectos" del schema.
 * - `visitEffects` de una diapositiva (milestone "+1 fallo con Game Over"):
 *   mismo criterio de limpieza selectiva que `effects` de una respuesta,
 *   justo arriba — corrección de revisión de código: faltaba, dejaba un
 *   `visitEffects` apuntando a un `variableId` inexistente que
 *   `applyVariableEffects` simplemente no-opea en silencio (nunca lanza),
 *   así que el efecto de sumar Fallos dejaba de funcionar sin ningún aviso.
 * - `alternateCondition`/`alternateBody` de un Final (milestone "+1 fallo
 *   con Game Over"): si `alternateCondition` referenciaba esta variable, se
 *   borran los DOS a la vez — mismo criterio "todo o nada" que
 *   `FinalAlternateSection.handleRemove` en el Inspector (nunca tiene
 *   sentido un `alternateBody` sin su condición). Corrección de revisión de
 *   código: faltaba, dejaba la variante "con fallos" del Final apuntando a
 *   una variable borrada — `evaluateCondition` la trata como falsa para
 *   siempre, así que el Final se quedaba fijo en su contenido por defecto
 *   sin ningún aviso.
 *
 * Decisión de diseño: limpiar en vez de dejar la referencia colgante. Un
 * `variableId` que ya no existe en `project.variables` no tiene ningún
 * significado razonable para el motor del reproductor (fase futura) ni para
 * el editor — a diferencia de `targetNodeId`/`continueLabel`, que quedan
 * "dormidos" porque SIGUEN siendo datos válidos por si se reactivan (ver
 * `addResponse`/`removeResponse`), una condición/efecto sobre un id de
 * variable borrado no puede "reactivarse": el id ya no significa nada. Lanza
 * `Error` si la variable no existe, mismo criterio que `deleteNode`.
 */
export function deleteVariable(project: ProjectDocument, variableId: string): ProjectDocument {
  const index = findVariableIndex(project, variableId)
  if (index === -1) {
    throw new Error(`No existe una variable con id "${variableId}".`)
  }

  return produce(project, (draft) => {
    draft.variables = draft.variables.filter((variable) => variable.id !== variableId)

    for (const node of draft.graph.nodes) {
      if (node.type === 'final') {
        if (node.alternateCondition?.variableId === variableId) {
          node.alternateCondition = undefined
          node.alternateBody = undefined
        }
        continue
      }

      if (node.type !== 'slide') continue

      if (node.condition?.variableId === variableId) {
        node.condition = undefined
      }
      if (node.visitEffects) {
        const remainingVisitEffects = node.visitEffects.filter(
          (effect) => effect.variableId !== variableId,
        )
        node.visitEffects = remainingVisitEffects.length > 0 ? remainingVisitEffects : undefined
      }

      for (const response of node.responses) {
        if (response.condition?.variableId === variableId) {
          response.condition = undefined
        }
        if (response.effects) {
          const remaining = response.effects.filter((effect) => effect.variableId !== variableId)
          response.effects = remaining.length > 0 ? remaining : undefined
        }
      }
    }

    touchUpdatedAt(draft)
  })
}
