import { z } from 'zod'

/**
 * Modelo de dominio de `Brunch Studio`.
 *
 * `ProjectDocument` es la única fuente de verdad de un escenario
 * interactivo ramificado. Se define aquí con esquemas Zod y los tipos de
 * TypeScript se derivan de ellos vía `z.infer` para que validación en
 * tiempo de ejecución y tipado estático nunca se desincronicen.
 *
 * Nota de nomenclatura: los nombres de tipo de nodo (`start`, `content`,
 * `decision`, `final`) son el vocabulario del dominio. Sus etiquetas en la
 * UI (Inicio/Pantalla/Decisión/Final) son responsabilidad de una fase de UI
 * posterior y no se modelan aquí.
 */

// ---------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------

export const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

/** Letras fijas de respuesta, siempre en este orden y nunca más de 4. */
export const RESPONSE_LETTERS = ['A', 'B', 'C', 'D'] as const

export const ResponseLetterSchema = z.enum(RESPONSE_LETTERS)

export const DecisionResponseSchema = z.object({
  id: z.string().uuid(),
  letter: ResponseLetterSchema,
  text: z.string(),
  imageAssetId: z.string().uuid().optional(),
  audioAssetId: z.string().uuid().optional(),
  points: z.number().optional(),
  targetNodeId: z.string().uuid().optional(),
})

// ---------------------------------------------------------------------------
// Nodos
// ---------------------------------------------------------------------------

/**
 * Campos comunes a todos los tipos de nodo. `number` es el número visible
 * estable del nodo (asignado una vez en la creación, nunca reasignado).
 */
const baseNodeFields = {
  id: z.string().uuid(),
  number: z.number().int().positive(),
  position: NodePositionSchema,
  title: z.string(),
  /** Placeholder para contenido estructurado; por ahora texto plano. */
  body: z.string(),
}

export const StartNodeSchema = z.object({
  ...baseNodeFields,
  type: z.literal('start'),
  targetNodeId: z.string().uuid().optional(),
})

export const ContentNodeSchema = z.object({
  ...baseNodeFields,
  type: z.literal('content'),
  targetNodeId: z.string().uuid().optional(),
})

export const DecisionNodeSchema = z.object({
  ...baseNodeFields,
  type: z.literal('decision'),
  responses: z.array(DecisionResponseSchema).max(4),
})

export const FinalNodeSchema = z.object({
  ...baseNodeFields,
  type: z.literal('final'),
})

export const NodeSchema = z.discriminatedUnion('type', [
  StartNodeSchema,
  ContentNodeSchema,
  DecisionNodeSchema,
  FinalNodeSchema,
])

export const NODE_TYPES = ['start', 'content', 'decision', 'final'] as const

// ---------------------------------------------------------------------------
// Documento de proyecto
// ---------------------------------------------------------------------------

export const ProjectMetadataSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/**
 * Reservado para configuración futura del proyecto. Vacío por ahora;
 * `passthrough` para no romper la carga de documentos si una fase futura
 * añade campos antes de que este esquema se actualice.
 */
export const ProjectSettingsSchema = z.object({}).passthrough()

export const ViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
})

export const EditorStateSchema = z.object({
  viewport: ViewportSchema,
})

export const ProjectGraphSchema = z.object({
  nodes: z.array(NodeSchema),
})

export const ProjectDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  metadata: ProjectMetadataSchema,
  settings: ProjectSettingsSchema,
  graph: ProjectGraphSchema,
  editor: EditorStateSchema,
})

// ---------------------------------------------------------------------------
// Tipos derivados
// ---------------------------------------------------------------------------

export type NodePosition = z.infer<typeof NodePositionSchema>
export type ResponseLetter = z.infer<typeof ResponseLetterSchema>
export type DecisionResponse = z.infer<typeof DecisionResponseSchema>

export type StartNode = z.infer<typeof StartNodeSchema>
export type ContentNode = z.infer<typeof ContentNodeSchema>
export type DecisionNode = z.infer<typeof DecisionNodeSchema>
export type FinalNode = z.infer<typeof FinalNodeSchema>
export type Node = z.infer<typeof NodeSchema>
export type NodeType = (typeof NODE_TYPES)[number]

export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>
export type Viewport = z.infer<typeof ViewportSchema>
export type EditorState = z.infer<typeof EditorStateSchema>
export type ProjectGraph = z.infer<typeof ProjectGraphSchema>
export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>

/** Nodos que tienen una única salida (`targetNodeId` a nivel de nodo). */
export type SingleOutputNode = StartNode | ContentNode
