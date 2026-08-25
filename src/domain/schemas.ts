import { z } from 'zod'

/**
 * Modelo de dominio de `Brunch Studio`.
 *
 * `ProjectDocument` es la única fuente de verdad de un escenario
 * interactivo ramificado. Se define aquí con esquemas Zod y los tipos de
 * TypeScript se derivan de ellos vía `z.infer` para que validación en
 * tiempo de ejecución y tipado estático nunca se desincronicen.
 *
 * Nota de nomenclatura: los nombres de tipo de nodo (`slide`, `final`) son
 * el vocabulario del dominio. Sus etiquetas en la UI
 * (Diapositiva/Final) son responsabilidad de la capa de UI y no se
 * modelan aquí.
 *
 * Rediseño del modelo de nodos: los antiguos tipos `content` (Pantalla) y
 * `decision` (Decisión) se fusionan en un único tipo `slide`
 * (Diapositiva), y el antiguo tipo `start` (Inicio) desaparece como nodo
 * — el punto de partida del recorrido pasa a ser una referencia
 * (`ProjectGraph.startNodeId`) a una `SlideNode` existente. Los documentos
 * `.brunch` guardados con el modelo anterior se convierten al abrirlos,
 * ver `src/domain/migration.ts`.
 */

// ---------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------

export const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

/**
 * Letras fijas de respuesta, siempre en este orden y nunca más de 4.
 *
 * Decisión de diseño: la letra sigue existiendo en el modelo porque es lo
 * que ordena las respuestas de forma estable (el array interno conserva el
 * orden de creación, que puede no coincidir con el orden de letra tras
 * eliminar y reañadir una intermedia) y lo que acota su número a 4. Es un
 * detalle interno: la UI NUNCA muestra la letra como texto visible — las
 * respuestas se pintan con un punto/viñeta, sin letra.
 */
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
  /** Contenido enriquecido serializado (ver `src/editor/richText`). */
  body: z.string(),
  /**
   * Nota interna del diseñador instruccional (p.ej. "pedir gráfico a
   * diseño"). Puramente de uso interno del equipo: NUNCA viaja al HTML/SCORM
   * exportado (ver `stripEditorOnlyFields` en `src/export/htmlBundle.ts`,
   * mismo criterio que ya se aplica al título de nodo). Disponible en
   * cualquier tipo de nodo, incluidos los `final`.
   */
  internalNote: z.string().optional(),
}

/**
 * Diapositiva: el único tipo de nodo "con salida" del modelo. Una misma
 * diapositiva puede comportarse de dos formas según tenga o no respuestas:
 *
 * - `responses` vacío → diapositiva "de continuar": su salida es
 *   `targetNodeId` y el Player muestra un único botón de continuar, con el
 *   texto de `continueLabel` (o "Continuar" si no está definido).
 * - `responses` con 1..4 elementos → diapositiva "de decisión": sus salidas
 *   son los `targetNodeId` de cada respuesta y el Player muestra las
 *   opciones. `targetNodeId`/`continueLabel` quedan "dormidos" (no se usan
 *   ni se borran) y vuelven a tener efecto si se eliminan todas las
 *   respuestas.
 */
/**
 * Orden relativo entre el bloque de imágenes y el cuerpo de texto de una
 * diapositiva. `'text-first'` es el valor por defecto (y el único
 * comportamiento que existía antes de admitir varias imágenes): así los
 * proyectos migrados desde la forma anterior (una sola `imageAssetId`) se ven
 * exactamente igual que antes, ver `src/domain/migration.ts`.
 */
export const CONTENT_ORDERS = ['text-first', 'image-first'] as const
export const ContentOrderSchema = z.enum(CONTENT_ORDERS)

export const SlideNodeSchema = z.object({
  ...baseNodeFields,
  type: z.literal('slide'),
  /** Destino de "Continuar". Solo se usa si `responses` está vacío. */
  targetNodeId: z.string().uuid().optional(),
  /** Texto personalizado del botón de continuar; por defecto "Continuar". */
  continueLabel: z.string().optional(),
  responses: z.array(DecisionResponseSchema).max(4),
  /**
   * Imágenes adjuntas a la diapositiva, en el orden en que se apilan (una
   * debajo de otra, a ancho completo) en el Player/export. Puede estar
   * vacío. Sustituye al antiguo `imageAssetId` singular (ver migración).
   */
  imageAssetIds: z.array(z.string().uuid()),
  audioAssetId: z.string().uuid().optional(),
  /** Orden entre el bloque de imágenes y el cuerpo de texto. */
  contentOrder: ContentOrderSchema,
})

/** Nodo terminal del recorrido: no tiene ninguna salida. */
export const FinalNodeSchema = z.object({
  ...baseNodeFields,
  type: z.literal('final'),
})

export const NodeSchema = z.discriminatedUnion('type', [SlideNodeSchema, FinalNodeSchema])

export const NODE_TYPES = ['slide', 'final'] as const

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

/**
 * Grafo del escenario. `startNodeId` es el punto de partida del recorrido:
 * el id de la `SlideNode` por la que empieza el Player. No es un nodo
 * aparte (el antiguo tipo `start` ya no existe) sino una referencia a una
 * diapositiva real, que además nunca se puede borrar (ver `deleteNode`).
 */
export const ProjectGraphSchema = z.object({
  nodes: z.array(NodeSchema),
  startNodeId: z.string().uuid(),
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
export type ContentOrder = z.infer<typeof ContentOrderSchema>

/** Valor por defecto de `SlideNode.contentOrder` (ver comentario del schema). */
export const DEFAULT_CONTENT_ORDER: ContentOrder = 'text-first'

export type SlideNode = z.infer<typeof SlideNodeSchema>
export type FinalNode = z.infer<typeof FinalNodeSchema>
export type Node = z.infer<typeof NodeSchema>
export type NodeType = (typeof NODE_TYPES)[number]

export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>
export type Viewport = z.infer<typeof ViewportSchema>
export type EditorState = z.infer<typeof EditorStateSchema>
export type ProjectGraph = z.infer<typeof ProjectGraphSchema>
export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>

/** Máximo de respuestas que admite una diapositiva (ver `SlideNodeSchema`). */
export const MAX_RESPONSES = RESPONSE_LETTERS.length

/** Texto por defecto del botón de continuar cuando `continueLabel` no está
 *  definido. Vive en el dominio para que Player e Inspector (placeholder)
 *  usen exactamente el mismo valor sin duplicar la cadena. */
export const DEFAULT_CONTINUE_LABEL = 'Continuar'
