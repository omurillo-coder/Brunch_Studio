import { z } from 'zod'
import {
  ProjectDocumentSchema,
  EditorStateSchema,
  ProjectMetadataSchema,
  ProjectSettingsSchema,
  DecisionResponseSchema,
  NodePositionSchema,
  DEFAULT_CONTENT_ORDER,
} from './schemas'
import type { FinalNode, Node, ProjectDocument, SlideNode } from './schemas'

/**
 * ---------------------------------------------------------------------------
 * Migración de documentos `.brunch` del modelo de nodos ANTIGUO al nuevo
 * ---------------------------------------------------------------------------
 *
 * El modelo antiguo tenía cuatro tipos de nodo (`start`, `content`,
 * `decision`, `final`) y ningún `graph.startNodeId`: el punto de partida era
 * el propio nodo `start`, invisible en el Player, que saltaba de inmediato a
 * su `targetNodeId`.
 *
 * El modelo nuevo tiene dos tipos (`slide`, `final`) y el punto de partida
 * es una referencia (`graph.startNodeId`) a una diapositiva real.
 *
 * Esta función es el único punto donde se reconoce y transforma la forma
 * antigua. Se invoca desde la capa de persistencia (ver
 * `TauriProjectRepository.openProject` / `MemoryProjectRepository.openProject`)
 * ANTES de validar con `ProjectDocumentSchema`, para que un `.brunch` ya
 * guardado con la versión anterior de la app se pueda seguir abriendo sin
 * perder datos.
 *
 * Nota importante: Rust nunca ha conocido la forma interna del documento (lo
 * trata como texto opaco y solo mira `schemaVersion`, que sigue siendo 1),
 * así que la migración es 100 % responsabilidad de TypeScript y no requiere
 * ningún cambio en `src-tauri`.
 */

/** Error lanzado cuando el JSON no es reconocible ni como forma nueva ni como
 *  forma antigua. Tipo propio para que quien lo capture pueda distinguirlo de
 *  un error de E/S del backend. */
export class ProjectMigrationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ProjectMigrationError'
  }
}

// ---------------------------------------------------------------------------
// Esquemas de la forma ANTIGUA (internos: solo sirven para reconocerla)
// ---------------------------------------------------------------------------

const legacyBaseNodeFields = {
  id: z.string().uuid(),
  number: z.number().int().positive(),
  position: NodePositionSchema,
  title: z.string(),
  body: z.string(),
}

const LegacyStartNodeSchema = z.object({
  ...legacyBaseNodeFields,
  type: z.literal('start'),
  targetNodeId: z.string().uuid().optional(),
})

const LegacyContentNodeSchema = z.object({
  ...legacyBaseNodeFields,
  type: z.literal('content'),
  targetNodeId: z.string().uuid().optional(),
  imageAssetId: z.string().uuid().optional(),
  audioAssetId: z.string().uuid().optional(),
})

const LegacyDecisionNodeSchema = z.object({
  ...legacyBaseNodeFields,
  type: z.literal('decision'),
  responses: z.array(DecisionResponseSchema).max(4),
  imageAssetId: z.string().uuid().optional(),
  audioAssetId: z.string().uuid().optional(),
})

const LegacyFinalNodeSchema = z.object({
  ...legacyBaseNodeFields,
  type: z.literal('final'),
})

const LegacyNodeSchema = z.discriminatedUnion('type', [
  LegacyStartNodeSchema,
  LegacyContentNodeSchema,
  LegacyDecisionNodeSchema,
  LegacyFinalNodeSchema,
])

const LegacyProjectDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  metadata: ProjectMetadataSchema,
  settings: ProjectSettingsSchema,
  graph: z.object({
    nodes: z.array(LegacyNodeSchema),
  }),
  editor: EditorStateSchema,
})

type LegacyNode = z.infer<typeof LegacyNodeSchema>
type LegacyProjectDocument = z.infer<typeof LegacyProjectDocumentSchema>

// ---------------------------------------------------------------------------
// Transformación antigua → nueva
// ---------------------------------------------------------------------------

function legacyNodeToNode(node: Exclude<LegacyNode, { type: 'start' }>): Node {
  const common = {
    id: node.id,
    number: node.number,
    position: node.position,
    title: node.title,
    body: node.body,
  }

  switch (node.type) {
    case 'content': {
      // Una Pantalla se convierte en una diapositiva "de continuar":
      // conserva su `targetNodeId` y nace sin respuestas. Su `imageAssetId`
      // singular (forma antigua) se convierte directamente en la lista
      // `imageAssetIds` de la forma nueva, mismo criterio que la migración
      // intermedia de imagen única a varias, ver `migrateSingularImageDocument`.
      const slide: SlideNode = {
        ...common,
        type: 'slide',
        targetNodeId: node.targetNodeId,
        continueLabel: undefined,
        responses: [],
        imageAssetIds: node.imageAssetId ? [node.imageAssetId] : [],
        audioAssetId: node.audioAssetId,
        contentOrder: DEFAULT_CONTENT_ORDER,
      }
      return slide
    }
    case 'decision': {
      // Una Decisión se convierte en una diapositiva con respuestas (mismos
      // ids/letras/textos/destinos/puntuación/adjuntos) y sin
      // `targetNodeId`: el modelo antiguo no tenía ninguno que conservar.
      const slide: SlideNode = {
        ...common,
        type: 'slide',
        targetNodeId: undefined,
        continueLabel: undefined,
        responses: node.responses,
        imageAssetIds: node.imageAssetId ? [node.imageAssetId] : [],
        audioAssetId: node.audioAssetId,
        contentOrder: DEFAULT_CONTENT_ORDER,
      }
      return slide
    }
    case 'final': {
      const final: FinalNode = { ...common, type: 'final' }
      return final
    }
  }
}

/** Convierte un antiguo nodo `start` en una diapositiva. Solo se usa como
 *  último recurso, ver `resolveStartNodeId`. */
function startNodeToSlide(node: z.infer<typeof LegacyStartNodeSchema>): SlideNode {
  return {
    id: node.id,
    number: node.number,
    position: node.position,
    title: node.title,
    body: node.body,
    type: 'slide',
    targetNodeId: node.targetNodeId,
    continueLabel: undefined,
    responses: [],
    imageAssetIds: [],
    audioAssetId: undefined,
    contentOrder: DEFAULT_CONTENT_ORDER,
  }
}

/**
 * Decide cuál es la diapositiva de inicio del documento migrado.
 *
 * Criterio (en este orden):
 * 1. El `targetNodeId` del primer nodo `start`, si lo tenía y apunta a un
 *    nodo que sigue existiendo tras la migración. Es la conversión fiel: en
 *    el modelo antiguo el Player saltaba exactamente ahí al empezar.
 * 2. Si no, el nodo migrado de menor `number` (el más antiguo del proyecto,
 *    ya que los números son incrementales y nunca se reciclan). Cubre
 *    documentos sin nodo `start`, o con un `start` nunca conectado.
 * 3. Si tras descartar los nodos `start` no queda NINGÚN nodo (caso real:
 *    un proyecto recién creado con la versión antigua, que solo tenía el
 *    nodo `start`), se convierte ese `start` en una diapositiva y se usa
 *    como inicio. Así ningún documento antiguo válido se queda sin
 *    `startNodeId`, que el esquema nuevo exige obligatoriamente.
 */
function resolveStartNodeId(
  legacy: LegacyProjectDocument,
): { nodes: Node[]; startNodeId: string } {
  const startNodes = legacy.graph.nodes.filter(
    (node): node is z.infer<typeof LegacyStartNodeSchema> => node.type === 'start',
  )
  const nodes = legacy.graph.nodes
    .filter((node): node is Exclude<LegacyNode, { type: 'start' }> => node.type !== 'start')
    .map(legacyNodeToNode)

  if (nodes.length === 0) {
    const firstStart = startNodes[0]
    if (!firstStart) {
      throw new ProjectMigrationError(
        'El documento antiguo no tiene ningún nodo; no se puede determinar la diapositiva de inicio.',
      )
    }
    const converted = startNodeToSlide(firstStart)
    // El `targetNodeId` heredado apuntaría a un nodo inexistente (no hay
    // ninguno más), así que se descarta.
    converted.targetNodeId = undefined
    return { nodes: [converted], startNodeId: converted.id }
  }

  const legacyStartTarget = startNodes[0]?.targetNodeId
  if (legacyStartTarget && nodes.some((node) => node.id === legacyStartTarget)) {
    return { nodes, startNodeId: legacyStartTarget }
  }

  const lowestNumbered = nodes.reduce((min, node) => (node.number < min.number ? node : min))
  return { nodes, startNodeId: lowestNumbered.id }
}

function migrateLegacyDocument(legacy: LegacyProjectDocument): ProjectDocument {
  const { nodes, startNodeId } = resolveStartNodeId(legacy)

  return {
    schemaVersion: 1,
    metadata: legacy.metadata,
    settings: legacy.settings,
    // El modelo antiguo (start/content/decision/final) es anterior a la
    // existencia de variables: no hay nada que migrar, nace vacío. Mismo
    // resultado que produce `ProjectDocumentSchema.variables.default([])`
    // al parsear un documento sin el campo, ver comentario de ese schema.
    variables: [],
    graph: { nodes, startNodeId },
    editor: legacy.editor,
  }
}

// ---------------------------------------------------------------------------
// Migración de la forma "actual hasta hoy" (imagen única) a la forma NUEVA
// (varias imágenes ordenables + orden de contenido)
// ---------------------------------------------------------------------------
//
// Antes de admitir varias imágenes por diapositiva, `SlideNode` tenía
// `imageAssetId?: string` (una sola imagen) y no existía `contentOrder`. Los
// documentos `.brunch` ya guardados con esa forma (que en su día era la
// forma "nueva" de la migración de arriba) se reconocen aquí y se
// transforman: `imageAssetId` con valor pasa a `imageAssetIds: [ese id]`, sin
// valor pasa a `imageAssetIds: []`, y `contentOrder` se fija siempre a
// `DEFAULT_CONTENT_ORDER` ('text-first'), que es como se comportaba la app
// antes de esta fase — así un proyecto migrado se ve exactamente igual que
// antes.
//
// Mismo patrón que la migración legado de arriba: un esquema Zod privado que
// solo sirve para RECONOCER la forma, una función de transformación pura, y
// una revalidación final contra `ProjectDocumentSchema` antes de devolver el
// resultado.

const singularImageBaseNodeFields = {
  id: z.string().uuid(),
  number: z.number().int().positive(),
  position: NodePositionSchema,
  title: z.string(),
  body: z.string(),
}

const SingularImageSlideNodeSchema = z.object({
  ...singularImageBaseNodeFields,
  type: z.literal('slide'),
  targetNodeId: z.string().uuid().optional(),
  continueLabel: z.string().optional(),
  responses: z.array(DecisionResponseSchema).max(4),
  imageAssetId: z.string().uuid().optional(),
  audioAssetId: z.string().uuid().optional(),
})

const SingularImageFinalNodeSchema = z.object({
  ...singularImageBaseNodeFields,
  type: z.literal('final'),
})

const SingularImageNodeSchema = z.discriminatedUnion('type', [
  SingularImageSlideNodeSchema,
  SingularImageFinalNodeSchema,
])

const SingularImageProjectDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  metadata: ProjectMetadataSchema,
  settings: ProjectSettingsSchema,
  graph: z.object({
    nodes: z.array(SingularImageNodeSchema),
    startNodeId: z.string().uuid(),
  }),
  editor: EditorStateSchema,
})

type SingularImageNode = z.infer<typeof SingularImageNodeSchema>
type SingularImageProjectDocument = z.infer<typeof SingularImageProjectDocumentSchema>

function singularImageNodeToNode(node: SingularImageNode): Node {
  const common = {
    id: node.id,
    number: node.number,
    position: node.position,
    title: node.title,
    body: node.body,
  }

  if (node.type === 'final') {
    const final: FinalNode = { ...common, type: 'final' }
    return final
  }

  const slide: SlideNode = {
    ...common,
    type: 'slide',
    targetNodeId: node.targetNodeId,
    continueLabel: node.continueLabel,
    responses: node.responses,
    imageAssetIds: node.imageAssetId ? [node.imageAssetId] : [],
    audioAssetId: node.audioAssetId,
    contentOrder: DEFAULT_CONTENT_ORDER,
  }
  return slide
}

function migrateSingularImageDocument(doc: SingularImageProjectDocument): ProjectDocument {
  return {
    schemaVersion: 1,
    metadata: doc.metadata,
    settings: doc.settings,
    // Esta forma intermedia (una sola imagen por diapositiva) tampoco tenía
    // variables todavía: mismo criterio que `migrateLegacyDocument`, nace
    // vacío.
    variables: [],
    graph: {
      nodes: doc.graph.nodes.map(singularImageNodeToNode),
      startNodeId: doc.graph.startNodeId,
    },
    editor: doc.editor,
  }
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------

/**
 * Valida y, si hace falta, migra el JSON ya parseado de un `.brunch`.
 *
 * Se intenta, en orden, contra tres formas:
 * 1. La forma NUEVA (`ProjectDocumentSchema`, varias imágenes por
 *    diapositiva + orden de contenido) -> se devuelve tal cual.
 * 2. La forma "actual hasta hoy" (una sola `imageAssetId` por diapositiva,
 *    sin `contentOrder`) -> se transforma con `migrateSingularImageDocument`.
 * 3. La forma ANTIGUA (`start`/`content`/`decision`/`final`, sin
 *    `graph.startNodeId`) -> se transforma con `migrateLegacyDocument`.
 *
 * Cada transformación se vuelve a validar contra `ProjectDocumentSchema`
 * antes de devolverse, para no confiar en la transformación a ciegas. Si el
 * documento no es reconocible como ninguna de las tres formas, lanza
 * `ProjectMigrationError` con un mensaje claro (nunca se reintenta en
 * silencio con datos corruptos).
 */
export function parseOrMigrateProjectDocument(raw: unknown): ProjectDocument {
  const asNew = ProjectDocumentSchema.safeParse(raw)
  if (asNew.success) {
    return asNew.data
  }

  const asSingularImage = SingularImageProjectDocumentSchema.safeParse(raw)
  if (asSingularImage.success) {
    const migrated = migrateSingularImageDocument(asSingularImage.data)
    const revalidated = ProjectDocumentSchema.safeParse(migrated)
    if (!revalidated.success) {
      throw new ProjectMigrationError(
        'El proyecto se ha reconocido en la forma con una sola imagen por diapositiva, pero el resultado de la migración a varias imágenes no es válido.',
        { cause: revalidated.error },
      )
    }
    return revalidated.data
  }

  const asLegacy = LegacyProjectDocumentSchema.safeParse(raw)
  if (!asLegacy.success) {
    throw new ProjectMigrationError(
      'El contenido del proyecto no tiene una forma reconocible (ni el modelo actual de nodos ni el anterior). No se ha modificado nada.',
      { cause: asNew.error },
    )
  }

  const migrated = migrateLegacyDocument(asLegacy.data)
  const revalidated = ProjectDocumentSchema.safeParse(migrated)
  if (!revalidated.success) {
    throw new ProjectMigrationError(
      'El proyecto se ha reconocido como un documento del modelo anterior, pero el resultado de la migración no es válido.',
      { cause: revalidated.error },
    )
  }

  return revalidated.data
}
