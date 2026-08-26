import { z } from 'zod'
import { createId } from './id'
import {
  ProjectDocumentSchema,
  EditorStateSchema,
  ProjectMetadataSchema,
  ProjectSettingsSchema,
  DecisionResponseSchema,
  NodePositionSchema,
  VariableConditionSchema,
  VariableDefSchema,
} from './schemas'
import type { ContentBlock, FinalNode, Node, ProjectDocument, SlideNode } from './schemas'

/**
 * ---------------------------------------------------------------------------
 * Migración de documentos `.brunch` del modelo de nodos ANTIGUO al nuevo
 * ---------------------------------------------------------------------------
 *
 * Este archivo reconoce, en orden del más reciente al más antiguo, TODAS las
 * formas por las que ha pasado `ProjectDocument` a lo largo de la vida de la
 * app, y las encadena hasta la forma actual:
 *
 * 1. Forma ACTUAL (`ProjectDocumentSchema`): `SlideNode.content` — bloques de
 *    texto/imagen/audio ordenables.
 * 2. Forma "pre-bloques-de-contenido" (`PreContentBlocksProjectDocumentSchema`,
 *    privado de este archivo): una diapositiva tenía un único `body`, una
 *    lista `imageAssetIds`, un `audioAssetId` opcional y un `contentOrder`
 *    ('text-first'/'image-first') para decidir el orden relativo entre el
 *    bloque de imágenes y el texto. Se migra con
 *    `migrateContentBlocksDocument`.
 * 3. Forma "imagen única" (`SingularImageProjectDocumentSchema`): antes de
 *    admitir varias imágenes por diapositiva, `imageAssetId?: string` (una
 *    sola) y sin `contentOrder`. Se migra con `migrateSingularImageDocument`
 *    a la forma 2, y ENCADENA automáticamente con `migrateContentBlocksDocument`
 *    hasta llegar a la forma 1 — ver `parseOrMigrateProjectDocument`.
 * 4. Forma ANTIGUA (`LegacyProjectDocumentSchema`): cuatro tipos de nodo
 *    (`start`, `content`, `decision`, `final`) y ningún `graph.startNodeId`
 *    (el punto de partida era el propio nodo `start`, invisible en el
 *    Player, que saltaba de inmediato a su `targetNodeId`). Se migra con
 *    `migrateLegacyDocument` a la forma 2, y encadena igual que la forma 3.
 *
 * Cada forma antigua se reconoce con su PROPIO esquema Zod privado (nunca
 * reutilizando el esquema "actual" de `schemas.ts`, que sigue evolucionando):
 * así un cambio futuro en la forma 1 no puede romper silenciosamente el
 * reconocimiento de una forma ya migrada. Los sub-esquemas que de verdad no
 * han cambiado entre formas (`DecisionResponseSchema`, `NodePositionSchema`,
 * `ProjectMetadataSchema`, `ProjectSettingsSchema`, `EditorStateSchema`,
 * `VariableConditionSchema`, `VariableDefSchema`) sí se reutilizan de
 * `schemas.ts` — no duplicarlos sería redundante y sin ningún beneficio de
 * aislamiento, ya que ellos mismos no forman parte de lo que cambió.
 *
 * `parseOrMigrateProjectDocument` es el único punto donde se reconocen y
 * transforman las formas antiguas. Se invoca desde la capa de persistencia
 * (ver `TauriProjectRepository.openProject` / `MemoryProjectRepository.openProject`)
 * ANTES de validar con `ProjectDocumentSchema`, para que un `.brunch` ya
 * guardado con cualquier versión anterior de la app se pueda seguir abriendo
 * sin perder datos.
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
// Forma 2: "pre-bloques-de-contenido" (justo anterior a este cambio)
// ---------------------------------------------------------------------------
//
// Hasta el milestone "Bloques de contenido", `SlideNode` tenía un único
// `body` (texto), una lista `imageAssetIds` (siempre apiladas juntas), un
// `audioAssetId` opcional y un `contentOrder` ('text-first'/'image-first')
// que decidía el orden relativo entre el bloque de imágenes y el texto. Se
// reconoce aquí con su propio esquema Zod privado (no reutiliza
// `SlideNodeSchema` de `schemas.ts`, que ya no tiene estos campos) y se
// transforma a la forma ACTUAL (`content: ContentBlock[]`) con
// `migrateContentBlocksDocument`, el paso final común al que confluyen TODAS
// las formas antiguas (ver `parseOrMigrateProjectDocument`).

const preContentBlocksBaseNodeFields = {
  id: z.string().uuid(),
  number: z.number().int().positive(),
  position: NodePositionSchema,
  title: z.string(),
  body: z.string(),
  internalNote: z.string().optional(),
}

const PreContentBlocksSlideNodeSchema = z.object({
  ...preContentBlocksBaseNodeFields,
  type: z.literal('slide'),
  targetNodeId: z.string().uuid().optional(),
  continueLabel: z.string().optional(),
  condition: VariableConditionSchema.optional(),
  elseTargetNodeId: z.string().uuid().optional(),
  responses: z.array(DecisionResponseSchema).max(4),
  imageAssetIds: z.array(z.string().uuid()),
  audioAssetId: z.string().uuid().optional(),
  contentOrder: z.enum(['text-first', 'image-first']),
})

const PreContentBlocksFinalNodeSchema = z.object({
  ...preContentBlocksBaseNodeFields,
  type: z.literal('final'),
})

const PreContentBlocksNodeSchema = z.discriminatedUnion('type', [
  PreContentBlocksSlideNodeSchema,
  PreContentBlocksFinalNodeSchema,
])

const PreContentBlocksProjectDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  metadata: ProjectMetadataSchema,
  settings: ProjectSettingsSchema,
  // Esta forma ya conocía las variables de proyecto (fase anterior a esta),
  // así que sí se migran tal cual — a diferencia de las formas 3 y 4, más
  // antiguas que el concepto de variable, que siempre migran a `[]`.
  variables: z.array(VariableDefSchema).default([]),
  graph: z.object({
    nodes: z.array(PreContentBlocksNodeSchema),
    startNodeId: z.string().uuid(),
  }),
  editor: EditorStateSchema,
})

type PreContentBlocksSlideNode = z.infer<typeof PreContentBlocksSlideNodeSchema>
type PreContentBlocksNode = z.infer<typeof PreContentBlocksNodeSchema>
type PreContentBlocksProjectDocument = z.infer<typeof PreContentBlocksProjectDocumentSchema>

/**
 * Construye los bloques de `content` de una diapositiva pre-bloques, en el
 * orden que dicta `contentOrder`:
 * - `'text-first'` (o cualquier valor no `'image-first'`, tratado como el
 *   valor por defecto — tolerante ante un documento retocado a mano sin este
 *   campo): `[bloque de texto, ...bloques de imagen en el orden de
 *   `imageAssetIds`, bloque de audio si había `audioAssetId`]`.
 * - `'image-first'`: `[...bloques de imagen, bloque de texto, bloque de
 *   audio si lo había]`.
 *
 * El bloque de texto SIEMPRE se crea, incluso si `body` era la cadena vacía:
 * perderlo dejaría a la diapositiva migrada sin ningún hueco de edición de
 * texto principal, que es justo lo que todo el mundo espera poder rellenar
 * — mismo criterio que `createNode`/`newSlideNode` en `src/domain/project.ts`,
 * que también siembran siempre un bloque de texto (vacío) al crear una
 * diapositiva nueva.
 *
 * Los bloques nacen con un `id` NUEVO (no existía ningún id de bloque en la
 * forma anterior que se pudiera conservar) generado con `createId()`, mismo
 * generador que usa el resto del dominio.
 */
function preContentBlocksSlideToContentBlocks(node: PreContentBlocksSlideNode): ContentBlock[] {
  const textBlock: ContentBlock = { id: createId(), type: 'text', body: node.body }
  const imageBlocks: ContentBlock[] = node.imageAssetIds.map((assetId) => ({
    id: createId(),
    type: 'image',
    assetId,
  }))
  const audioBlock: ContentBlock | undefined = node.audioAssetId
    ? { id: createId(), type: 'audio', assetId: node.audioAssetId }
    : undefined

  const ordered: ContentBlock[] =
    node.contentOrder === 'image-first' ? [...imageBlocks, textBlock] : [textBlock, ...imageBlocks]

  return audioBlock ? [...ordered, audioBlock] : ordered
}

function preContentBlocksNodeToNode(node: PreContentBlocksNode): Node {
  if (node.type === 'final') {
    const final: FinalNode = {
      id: node.id,
      number: node.number,
      position: node.position,
      title: node.title,
      internalNote: node.internalNote,
      type: 'final',
      body: node.body,
    }
    return final
  }

  const slide: SlideNode = {
    id: node.id,
    number: node.number,
    position: node.position,
    title: node.title,
    internalNote: node.internalNote,
    type: 'slide',
    targetNodeId: node.targetNodeId,
    continueLabel: node.continueLabel,
    condition: node.condition,
    elseTargetNodeId: node.elseTargetNodeId,
    responses: node.responses,
    content: preContentBlocksSlideToContentBlocks(node),
  }
  return slide
}

/**
 * Transforma un documento en la forma "pre-bloques-de-contenido" a la forma
 * ACTUAL. Es el paso FINAL común al que confluyen las tres formas
 * reconocidas por este archivo (ver `parseOrMigrateProjectDocument`): las
 * formas 3 y 4 se migran primero a esta forma intermedia
 * (`migrateSingularImageDocument`/`migrateLegacyDocument`) y luego pasan por
 * aquí igual que un documento que ya estaba directamente en esta forma.
 */
function migrateContentBlocksDocument(doc: PreContentBlocksProjectDocument): ProjectDocument {
  return {
    schemaVersion: 1,
    metadata: doc.metadata,
    settings: doc.settings,
    variables: doc.variables,
    graph: {
      nodes: doc.graph.nodes.map(preContentBlocksNodeToNode),
      startNodeId: doc.graph.startNodeId,
    },
    editor: doc.editor,
  }
}

// ---------------------------------------------------------------------------
// Forma 4: ANTIGUA (`start`/`content`/`decision`/`final`, internos: solo
// sirven para reconocerla)
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
// Transformación antigua → forma "pre-bloques-de-contenido" (forma 2)
// ---------------------------------------------------------------------------
//
// El resultado de esta transformación NO es la forma actual todavía: es la
// forma 2 (`PreContentBlocksNode`/`PreContentBlocksProjectDocument`, ver
// arriba), que luego pasa por `migrateContentBlocksDocument` en
// `parseOrMigrateProjectDocument` para llegar a `content`. Mismo motivo que
// documenta el comentario de cabecera del archivo: cada forma migra a la
// inmediatamente más nueva, nunca salta directamente a la actual, así un
// cambio futuro de la forma actual solo obliga a tocar el último eslabón de
// la cadena.

function legacyNodeToNode(node: Exclude<LegacyNode, { type: 'start' }>): PreContentBlocksNode {
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
      // `imageAssetIds` de la forma pre-bloques, mismo criterio que la
      // migración intermedia de imagen única a varias, ver
      // `migrateSingularImageDocument`.
      const slide: PreContentBlocksNode = {
        ...common,
        type: 'slide',
        targetNodeId: node.targetNodeId,
        continueLabel: undefined,
        responses: [],
        imageAssetIds: node.imageAssetId ? [node.imageAssetId] : [],
        audioAssetId: node.audioAssetId,
        contentOrder: 'text-first',
      }
      return slide
    }
    case 'decision': {
      // Una Decisión se convierte en una diapositiva con respuestas (mismos
      // ids/letras/textos/destinos/puntuación/adjuntos) y sin
      // `targetNodeId`: el modelo antiguo no tenía ninguno que conservar.
      const slide: PreContentBlocksNode = {
        ...common,
        type: 'slide',
        targetNodeId: undefined,
        continueLabel: undefined,
        responses: node.responses,
        imageAssetIds: node.imageAssetId ? [node.imageAssetId] : [],
        audioAssetId: node.audioAssetId,
        contentOrder: 'text-first',
      }
      return slide
    }
    case 'final': {
      const final: PreContentBlocksNode = { ...common, type: 'final' }
      return final
    }
  }
}

/** Convierte un antiguo nodo `start` en una diapositiva pre-bloques. Solo se
 *  usa como último recurso, ver `resolveStartNodeId`. */
function startNodeToSlide(node: z.infer<typeof LegacyStartNodeSchema>): PreContentBlocksSlideNode {
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
    contentOrder: 'text-first',
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
): { nodes: PreContentBlocksNode[]; startNodeId: string } {
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

function migrateLegacyDocument(legacy: LegacyProjectDocument): PreContentBlocksProjectDocument {
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
// Forma 3: "imagen única" (más antigua que la forma "pre-bloques", más
// reciente que la forma ANTIGUA de start/content/decision/final)
// ---------------------------------------------------------------------------
//
// Antes de admitir varias imágenes por diapositiva, `SlideNode` tenía
// `imageAssetId?: string` (una sola imagen) y no existía `contentOrder`. Los
// documentos `.brunch` ya guardados con esa forma se reconocen aquí y se
// transforman a la forma 2 ("pre-bloques-de-contenido", NO a la forma
// actual): `imageAssetId` con valor pasa a `imageAssetIds: [ese id]`, sin
// valor pasa a `imageAssetIds: []`, y `contentOrder` se fija siempre a
// `'text-first'`, que es como se comportaba la app antes de admitir varias
// imágenes — así un proyecto migrado se ve exactamente igual que antes.
// Desde la forma 2 encadena con `migrateContentBlocksDocument` hasta
// `content`, ver `parseOrMigrateProjectDocument`.
//
// Mismo patrón que la migración legado de arriba: un esquema Zod privado que
// solo sirve para RECONOCER la forma, y una función de transformación pura.

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

function singularImageNodeToNode(node: SingularImageNode): PreContentBlocksNode {
  const common = {
    id: node.id,
    number: node.number,
    position: node.position,
    title: node.title,
    body: node.body,
  }

  if (node.type === 'final') {
    const final: PreContentBlocksNode = { ...common, type: 'final' }
    return final
  }

  const slide: PreContentBlocksNode = {
    ...common,
    type: 'slide',
    targetNodeId: node.targetNodeId,
    continueLabel: node.continueLabel,
    responses: node.responses,
    imageAssetIds: node.imageAssetId ? [node.imageAssetId] : [],
    audioAssetId: node.audioAssetId,
    contentOrder: 'text-first',
  }
  return slide
}

function migrateSingularImageDocument(
  doc: SingularImageProjectDocument,
): PreContentBlocksProjectDocument {
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
 * Se intenta, en orden del más al menos reciente, contra las cuatro formas
 * documentadas en la cabecera del archivo:
 * 1. La forma ACTUAL (`ProjectDocumentSchema`, `content: ContentBlock[]`)
 *    -> se devuelve tal cual.
 * 2. La forma "pre-bloques-de-contenido" (`body`/`imageAssetIds`/
 *    `audioAssetId`/`contentOrder`) -> se transforma con
 *    `migrateContentBlocksDocument`, directamente a la forma actual.
 * 3. La forma "imagen única" (`imageAssetId` singular, sin `contentOrder`)
 *    -> se transforma con `migrateSingularImageDocument` a la forma 2, y esa
 *    forma intermedia se pasa INMEDIATAMENTE por `migrateContentBlocksDocument`
 *    en esta misma rama: dos migraciones encadenadas en una sola llamada a
 *    `parseOrMigrateProjectDocument`, sin que quien llama tenga que saberlo.
 * 4. La forma ANTIGUA (`start`/`content`/`decision`/`final`, sin
 *    `graph.startNodeId`) -> se transforma con `migrateLegacyDocument` a la
 *    forma 2, encadenada con `migrateContentBlocksDocument` igual que la 3.
 *
 * Cada transformación se vuelve a validar contra `ProjectDocumentSchema`
 * antes de devolverse, para no confiar en la transformación a ciegas. Si el
 * documento no es reconocible como ninguna de las cuatro formas, lanza
 * `ProjectMigrationError` con un mensaje claro (nunca se reintenta en
 * silencio con datos corruptos).
 */
export function parseOrMigrateProjectDocument(raw: unknown): ProjectDocument {
  const asNew = ProjectDocumentSchema.safeParse(raw)
  if (asNew.success) {
    return asNew.data
  }

  const asPreContentBlocks = PreContentBlocksProjectDocumentSchema.safeParse(raw)
  if (asPreContentBlocks.success) {
    const migrated = migrateContentBlocksDocument(asPreContentBlocks.data)
    const revalidated = ProjectDocumentSchema.safeParse(migrated)
    if (!revalidated.success) {
      throw new ProjectMigrationError(
        'El proyecto se ha reconocido en la forma anterior a los bloques de contenido, pero el resultado de la migración a bloques no es válido.',
        { cause: revalidated.error },
      )
    }
    return revalidated.data
  }

  const asSingularImage = SingularImageProjectDocumentSchema.safeParse(raw)
  if (asSingularImage.success) {
    const intermediate = migrateSingularImageDocument(asSingularImage.data)
    const migrated = migrateContentBlocksDocument(intermediate)
    const revalidated = ProjectDocumentSchema.safeParse(migrated)
    if (!revalidated.success) {
      throw new ProjectMigrationError(
        'El proyecto se ha reconocido en la forma con una sola imagen por diapositiva, pero el resultado de la migración encadenada (varias imágenes -> bloques de contenido) no es válido.',
        { cause: revalidated.error },
      )
    }
    return revalidated.data
  }

  const asLegacy = LegacyProjectDocumentSchema.safeParse(raw)
  if (!asLegacy.success) {
    throw new ProjectMigrationError(
      'El contenido del proyecto no tiene una forma reconocible (ni el modelo actual de nodos ni ninguno de los anteriores). No se ha modificado nada.',
      { cause: asNew.error },
    )
  }

  const intermediate = migrateLegacyDocument(asLegacy.data)
  const migrated = migrateContentBlocksDocument(intermediate)
  const revalidated = ProjectDocumentSchema.safeParse(migrated)
  if (!revalidated.success) {
    throw new ProjectMigrationError(
      'El proyecto se ha reconocido como un documento del modelo anterior, pero el resultado de la migración encadenada no es válido.',
      { cause: revalidated.error },
    )
  }

  return revalidated.data
}
