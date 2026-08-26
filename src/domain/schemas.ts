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

// ---------------------------------------------------------------------------
// Variables y condiciones
// ---------------------------------------------------------------------------
//
// Fase 1 del milestone "Variables/condiciones": solo el modelo de dominio.
// Estos tipos son el CONTRATO que consumirán la fase de editor/UI (formulario
// de variables, selector de condición/efectos en el Inspector) y la fase de
// reproductor/export (motor de recorrido que mantiene el estado de variables
// y evalúa condiciones) — cualquier cambio de forma aquí las afecta a ambas.

/**
 * Los dos tipos de variable soportados en esta fase. Deliberadamente solo
 * dos (no texto, no listas): cubren los dos usos previstos —contadores/
 * puntuaciones acumuladas ("numérico") y flags de progreso ("booleano")— sin
 * la complejidad añadida de validar/editar tipos más ricos. Ampliar el
 * conjunto de tipos en el futuro es aditivo (un valor más en el enum) y no
 * debería requerir migración de los documentos existentes.
 */
export const VARIABLE_TYPES = ['number', 'boolean'] as const
export const VariableTypeSchema = z.enum(VARIABLE_TYPES)

/**
 * Definición de una variable de proyecto. Vive en `ProjectDocument.variables`
 * (ver más abajo por qué a nivel raíz del documento y no dentro de `graph`).
 *
 * `initialValue` debe ser coherente con `type` ("number" -> `number`,
 * "boolean" -> `boolean`), pero Zod no puede exigirlo de forma declarativa
 * aquí: `z.union([z.number(), z.boolean()])` acepta ambas formas para
 * cualquier `type`. Validar la coherencia tipo/valor es responsabilidad de
 * quien construye/edita la variable (ver `addVariable`/`updateVariable` en
 * `src/domain/project.ts`, que sí la comprueban), nunca del propio schema.
 */
export const VariableDefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: VariableTypeSchema,
  initialValue: z.union([z.number(), z.boolean()]),
})

/**
 * Operadores de comparación disponibles en una `VariableCondition`. Los seis
 * tienen sentido sobre una variable numérica; sobre una variable booleana
 * solo `==`/`!=` son significativos (compara contra `true`/`false`). No se
 * restringe a nivel de schema qué operadores admite cada `type` porque el
 * schema no conoce el `type` de la variable referenciada por `variableId`
 * (vive en otro punto del documento, `ProjectDocument.variables`) — sería
 * validación fuera de contexto, ver el comentario de `VariableConditionSchema`.
 * `evaluateCondition` (`src/domain/variables.ts`) documenta qué ocurre en
 * tiempo de evaluación si de todos modos se guarda una combinación sin
 * sentido (p.ej. `>` sobre un booleano): nunca lanza, evalúa a `false`.
 */
export const COMPARISON_OPERATORS = ['==', '!=', '>', '>=', '<', '<='] as const
export const ComparisonOperatorSchema = z.enum(COMPARISON_OPERATORS)

/**
 * Condición sobre el valor actual de una variable en tiempo de recorrido.
 * Dos usos en esta fase (ver `DecisionResponseSchema.condition` y
 * `SlideNodeSchema.condition`): visibilidad de una respuesta de decisión, y
 * enrutado condicional de una diapositiva "de continuar".
 *
 * Mismo criterio que `VariableDefSchema.initialValue`: `value` acepta
 * `number | boolean` sin comprobar aquí que coincide con el `type` de la
 * variable referenciada — no es responsabilidad del schema (necesita
 * contexto de otra parte del documento), sino del dominio/UI en fases
 * futuras.
 */
export const VariableConditionSchema = z.object({
  variableId: z.string().uuid(),
  operator: ComparisonOperatorSchema,
  value: z.union([z.number(), z.boolean()]),
})

/**
 * Efecto sobre una variable al elegir una respuesta de decisión (ver
 * `DecisionResponseSchema.effects`). Unión discriminada por `operation`:
 * - `set`: fija la variable a `value` (`number | boolean`, coherente con el
 *   `type` de la variable en teoría, sin comprobación aquí — mismo criterio
 *   que el resto de este bloque).
 * - `increment`/`decrement`: suma/resta `value` (siempre `number`, ya que
 *   solo tienen sentido sobre una variable numérica). Se admiten en el
 *   schema también para una variable booleana porque el schema no sabe el
 *   `type` de `variableId`; `applyVariableEffects`
 *   (`src/domain/variables.ts`) documenta que en ese caso el efecto es un
 *   no-op silencioso, nunca un error.
 */
export const VariableEffectSchema = z.discriminatedUnion('operation', [
  z.object({
    variableId: z.string().uuid(),
    operation: z.literal('set'),
    value: z.union([z.number(), z.boolean()]),
  }),
  z.object({
    variableId: z.string().uuid(),
    operation: z.literal('increment'),
    value: z.number(),
  }),
  z.object({
    variableId: z.string().uuid(),
    operation: z.literal('decrement'),
    value: z.number(),
  }),
])

export const DecisionResponseSchema = z.object({
  id: z.string().uuid(),
  letter: ResponseLetterSchema,
  text: z.string(),
  imageAssetId: z.string().uuid().optional(),
  audioAssetId: z.string().uuid().optional(),
  points: z.number().optional(),
  targetNodeId: z.string().uuid().optional(),
  /**
   * Efectos sobre variables aplicados SOLO al elegir esta respuesta (nunca
   * al avance simple "continuar" de una diapositiva sin decisiones — alcance
   * deliberadamente acotado en esta fase). `undefined`/array vacío se tratan
   * igual ("sin efectos"); ver `UpdateResponsePatch` en
   * `src/domain/responses.ts` para la semántica de "patch" al editarlos.
   */
  effects: z.array(VariableEffectSchema).optional(),
  /**
   * Condición de visibilidad de esta respuesta: si está presente, el Player
   * solo debe ofrecerla cuando `evaluateCondition` da `true` contra el
   * estado de variables del recorrido. Ausente = siempre visible (compat.
   * total con el comportamiento actual).
   */
  condition: VariableConditionSchema.optional(),
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
 * Nota deliberada sobre `body`: NO vive en `baseNodeFields`. Antes del
 * milestone "Bloques de contenido" era común a `slide`/`final` (un único
 * cuerpo de texto Tiptap serializado por nodo). Con la llegada de
 * `SlideNodeSchema.content` (más abajo, varios bloques de texto/imagen/audio
 * ordenables) una diapositiva ya no tiene un `body` único que editar — su
 * texto vive repartido en los bloques `type: 'text'` de `content` — así que
 * `body` se queda ÚNICAMENTE en `FinalNodeSchema`, que sigue siendo un nodo
 * de un solo cuerpo de texto (una pantalla final no admite bloques todavía;
 * ampliarla es una decisión de producto explícitamente fuera de esta fase).
 * Documentos `.brunch` guardados con la forma anterior (`body` de diapositiva
 * + `imageAssetIds` + `audioAssetId` + `contentOrder`) se migran a `content`
 * al abrirlos, ver `src/domain/migration.ts`.
 */

// ---------------------------------------------------------------------------
// Bloques de contenido de una diapositiva
// ---------------------------------------------------------------------------
//
// Milestone "Bloques de contenido", fase 1 (dominio): sustituye el modelo
// anterior de una diapositiva —un único `body` de texto, una lista
// `imageAssetIds` (siempre apiladas juntas) y un `audioAssetId` opcional,
// colocados entre sí según `contentOrder` ('text-first'/'image-first')— por
// una lista ORDENABLE de bloques heterogéneos: `SlideNode.content`. El
// ÍNDICE del array ES el orden de aparición, sin ningún campo de orden
// aparte que pueda desincronizarse del contenido real (a diferencia de
// `contentOrder`, que solo codificaba dos posiciones relativas posibles para
// un único bloque de imágenes agrupado, nunca "intercalar" texto e imágenes
// libremente). Documentos `.brunch` guardados con la forma anterior se
// migran a `content` al abrirlos, ver `src/domain/migration.ts`.
//
// Este es el CONTRATO que consumirán la fase de editor/UI (bloques
// añadibles/reordenables en el Inspector/Canvas) y la fase de reproductor/
// export (que debe pintar `content` en orden, bloque a bloque) — cualquier
// cambio de forma aquí las afecta a ambas.

/**
 * Un bloque de contenido de diapositiva. Unión discriminada por `type`:
 * - `text`: un cuerpo de texto Tiptap serializado, MISMO formato que tenía
 *   el antiguo `SlideNode.body` (ver `parseRichBody`/`serializeRichBody` en
 *   `src/editor/richText/richTextContent.ts`, sin cambios) — solo cambia
 *   DÓNDE vive ese string, no su contenido ni cómo se interpreta.
 * - `image`: referencia (`assetId`) a una imagen ya importada a la
 *   biblioteca de assets del proyecto. Análogo a un elemento suelto de lo
 *   que antes era `SlideNode.imageAssetIds`.
 * - `audio`: referencia (`assetId`) a un audio ya importado. Análogo al
 *   antiguo `SlideNode.audioAssetId`, salvo que ahora pueden coexistir
 *   VARIOS bloques de audio en una misma diapositiva (el modelo anterior
 *   admitía como mucho uno).
 *
 * `id` identifica el bloque de forma estable dentro de `content` (generado
 * una vez al crearlo, nunca reasignado) — necesario para poder editar/
 * mover/eliminar un bloque concreto sin depender de su posición actual en el
 * array, igual que `DecisionResponse.id` para las respuestas de una
 * diapositiva. Es único dentro de la diapositiva que lo contiene; no hay
 * ninguna garantía (ni falta que hace) de unicidad entre diapositivas
 * distintas del mismo proyecto.
 */
export const ContentBlockSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().uuid(),
    type: z.literal('text'),
    body: z.string(),
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal('image'),
    assetId: z.string().uuid(),
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal('audio'),
    assetId: z.string().uuid(),
  }),
])

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
export const SlideNodeSchema = z.object({
  ...baseNodeFields,
  type: z.literal('slide'),
  /**
   * Destino de "Continuar". Solo se usa si `responses` está vacío.
   *
   * Con la llegada de `condition` (más abajo), su significado se amplía sin
   * romper compatibilidad: "destino cuando NO hay `condition`, o cuando
   * `condition` se evalúa a VERDADERA". Si `condition` está ausente (el caso
   * de todo documento existente hasta esta fase), el comportamiento es
   * EXACTAMENTE el de siempre — este campo nunca cambia de significado para
   * quien no usa condiciones.
   */
  targetNodeId: z.string().uuid().optional(),
  /** Texto personalizado del botón de continuar; por defecto "Continuar". */
  continueLabel: z.string().optional(),
  /**
   * Enrutado condicional automático de una diapositiva "de continuar". Solo
   * tiene efecto cuando `responses` está vacío (una diapositiva de decisión
   * enruta por respuesta elegida, no por esta vía) — igual que
   * `targetNodeId`/`continueLabel` quedan "dormidos" en modo decisión, ver
   * comentario de la clase de diapositiva más arriba.
   *
   * Si está presente, `resolveSlideTarget` (`src/domain/variables.ts`)
   * evalúa esta condición contra el estado de variables del recorrido:
   * VERDADERA -> `targetNodeId`, FALSA -> `elseTargetNodeId`. Si está
   * ausente, el destino es siempre `targetNodeId` sin evaluar nada — el
   * comportamiento actual, intacto.
   */
  condition: VariableConditionSchema.optional(),
  /**
   * Destino cuando `condition` está presente y se evalúa a FALSA. Sin
   * `condition`, este campo no tiene ningún efecto (puede quedar "dormido"
   * si se llegó a definir y luego se quitó la condición, mismo criterio de
   * no-borrado-agresivo que el resto del dominio). Puede quedar `undefined`
   * aun con `condition` presente: significa "sin destino cuando la condición
   * es falsa", tratado como cualquier otro destino ausente (dead-end en el
   * Player).
   */
  elseTargetNodeId: z.string().uuid().optional(),
  responses: z.array(DecisionResponseSchema).max(4),
  /**
   * Contenido de la diapositiva: bloques de texto/imagen/audio en el orden
   * exacto en que se pintan en el Player/export (ver comentario de
   * `ContentBlockSchema` arriba). Puede estar vacío (una diapositiva sin
   * ningún bloque no tiene nada que mostrar salvo su título) aunque
   * `createNode`/`addTextBlock` normalmente evitan ese estado sembrando un
   * bloque de texto — ver `src/domain/project.ts`/`src/domain/content.ts`.
   * Ningún límite de longitud ni de bloques por tipo: a diferencia de
   * `responses` (máx. 4, restringido por las letras fijas A-D), aquí no hay
   * ninguna razón de dominio para poner un tope.
   */
  content: z.array(ContentBlockSchema),
})

/**
 * Nodo terminal del recorrido: no tiene ninguna salida. A diferencia de
 * `SlideNode`, sigue teniendo un único `body` (cuerpo de texto Tiptap
 * serializado, ver `src/editor/richText/richTextContent.ts`) en vez de
 * `content`: un Final no admite bloques de imagen/audio ni varios bloques de
 * texto en esta fase — ver el comentario de "por qué `body` no vive en
 * `baseNodeFields`" más arriba.
 */
export const FinalNodeSchema = z.object({
  ...baseNodeFields,
  type: z.literal('final'),
  body: z.string(),
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
  /**
   * Variables del proyecto (contadores/flags que el recorrido puede leer y
   * modificar, ver `VariableDefSchema`).
   *
   * Vive a nivel RAÍZ del documento, hermano de `graph`, no dentro de
   * `graph`: una variable es un dato de PROYECTO (como `settings`), no de
   * TOPOLOGÍA del grafo (como `nodes`/`startNodeId`) — se define una vez y la
   * referencian por id nodos/respuestas repartidos por todo el grafo, igual
   * que los assets (`imageAssetId`/`audioAssetId`) tampoco viven dentro de
   * `graph` aunque los nodos los referencien.
   *
   * `.default([])`: un documento SIN este campo (cualquier `.brunch`
   * guardado antes de esta fase) parsea igualmente con `variables: []`, sin
   * necesitar código de migración explícito en `src/domain/migration.ts` —
   * es un cambio puramente aditivo. Ver el test de compatibilidad en
   * `src/domain/__tests__/migration.test.ts`.
   */
  variables: z.array(VariableDefSchema).default([]),
  graph: ProjectGraphSchema,
  editor: EditorStateSchema,
})

// ---------------------------------------------------------------------------
// Tipos derivados
// ---------------------------------------------------------------------------

export type NodePosition = z.infer<typeof NodePositionSchema>
export type ResponseLetter = z.infer<typeof ResponseLetterSchema>
export type VariableType = z.infer<typeof VariableTypeSchema>
export type VariableDef = z.infer<typeof VariableDefSchema>
export type ComparisonOperator = z.infer<typeof ComparisonOperatorSchema>
export type VariableCondition = z.infer<typeof VariableConditionSchema>
export type VariableEffect = z.infer<typeof VariableEffectSchema>
export type DecisionResponse = z.infer<typeof DecisionResponseSchema>
export type ContentBlock = z.infer<typeof ContentBlockSchema>

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
