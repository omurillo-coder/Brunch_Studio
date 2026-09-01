import { describe, expect, it } from 'vitest'
import {
  ContentBlockSchema,
  DecisionResponseSchema,
  FINAL_VARIANTS,
  FinalNodeSchema,
  FinalVariantSchema,
  IntroNodeSchema,
  NODE_TYPES,
  NodeSchema,
  ProjectDocumentSchema,
  SLIDE_COLORS,
  SlideColorSchema,
  SlideNodeSchema,
  VariableConditionSchema,
  VariableDefSchema,
  VariableEffectSchema,
} from '../schemas'
import { createProject } from '../project'

const VARIABLE_ID = '11111111-1111-4111-8111-111111111111'
const NODE_ID = '22222222-2222-4222-8222-222222222222'

describe('VariableDefSchema', () => {
  it('acepta una variable numérica y una booleana válidas', () => {
    expect(
      VariableDefSchema.safeParse({
        id: VARIABLE_ID,
        name: 'puntos_empatia',
        type: 'number',
        initialValue: 0,
      }).success,
    ).toBe(true)

    expect(
      VariableDefSchema.safeParse({
        id: VARIABLE_ID,
        name: 'ha_hablado_con_cliente',
        type: 'boolean',
        initialValue: false,
      }).success,
    ).toBe(true)
  })

  it('rechaza un tipo desconocido', () => {
    expect(
      VariableDefSchema.safeParse({
        id: VARIABLE_ID,
        name: 'x',
        type: 'string',
        initialValue: 'hola',
      }).success,
    ).toBe(false)
  })

  it('rechaza un id que no es uuid', () => {
    expect(
      VariableDefSchema.safeParse({
        id: 'no-es-un-uuid',
        name: 'x',
        type: 'number',
        initialValue: 0,
      }).success,
    ).toBe(false)
  })

  it('el schema NO valida que initialValue case con type (ver comentario del schema): un number con type "boolean" parsea igual', () => {
    // Documentado deliberadamente: la coherencia tipo/valor es
    // responsabilidad del dominio (`addVariable`/`updateVariable`), no del
    // schema Zod, porque a nivel de schema ambos campos viven en el mismo
    // objeto y técnicamente SÍ se podría cruzar... pero se opta por no
    // hacerlo aquí para no acoplar el schema Zod a lógica condicional de
    // campos, manteniéndolo simétrico con `VariableCondition`/`VariableEffect`
    // (donde el cruce SÍ requeriría datos externos al objeto). Ver
    // `src/domain/__tests__/project.test.ts` para la validación real en
    // `addVariable`/`updateVariable`.
    const result = VariableDefSchema.safeParse({
      id: VARIABLE_ID,
      name: 'x',
      type: 'boolean',
      initialValue: 42,
    })
    expect(result.success).toBe(true)
  })
})

describe('VariableConditionSchema', () => {
  it('acepta los seis operadores de comparación', () => {
    for (const operator of ['==', '!=', '>', '>=', '<', '<=']) {
      expect(
        VariableConditionSchema.safeParse({ variableId: VARIABLE_ID, operator, value: 5 }).success,
      ).toBe(true)
    }
  })

  it('rechaza un operador desconocido', () => {
    expect(
      VariableConditionSchema.safeParse({
        variableId: VARIABLE_ID,
        operator: '=',
        value: 5,
      }).success,
    ).toBe(false)
  })

  it('acepta value numérico o booleano', () => {
    expect(
      VariableConditionSchema.safeParse({ variableId: VARIABLE_ID, operator: '==', value: true })
        .success,
    ).toBe(true)
  })
})

describe('VariableEffectSchema', () => {
  it('acepta "set" con value number o boolean', () => {
    expect(
      VariableEffectSchema.safeParse({ variableId: VARIABLE_ID, operation: 'set', value: 3 })
        .success,
    ).toBe(true)
    expect(
      VariableEffectSchema.safeParse({ variableId: VARIABLE_ID, operation: 'set', value: true })
        .success,
    ).toBe(true)
  })

  it('acepta "increment"/"decrement" solo con value numérico', () => {
    expect(
      VariableEffectSchema.safeParse({
        variableId: VARIABLE_ID,
        operation: 'increment',
        value: 1,
      }).success,
    ).toBe(true)
    expect(
      VariableEffectSchema.safeParse({
        variableId: VARIABLE_ID,
        operation: 'decrement',
        value: 1,
      }).success,
    ).toBe(true)
  })

  it('rechaza "increment"/"decrement" con value booleano', () => {
    expect(
      VariableEffectSchema.safeParse({
        variableId: VARIABLE_ID,
        operation: 'increment',
        value: true,
      }).success,
    ).toBe(false)
  })

  it('rechaza una operation desconocida', () => {
    expect(
      VariableEffectSchema.safeParse({ variableId: VARIABLE_ID, operation: 'multiply', value: 2 })
        .success,
    ).toBe(false)
  })
})

describe('DecisionResponseSchema — effects/condition opcionales', () => {
  const base = {
    id: '33333333-3333-4333-8333-333333333333',
    letter: 'A' as const,
    text: 'Opción',
  }

  it('acepta una respuesta sin effects/condition (compatibilidad con el modelo actual)', () => {
    expect(DecisionResponseSchema.safeParse(base).success).toBe(true)
  })

  it('acepta una respuesta con effects y condition', () => {
    const result = DecisionResponseSchema.safeParse({
      ...base,
      effects: [{ variableId: VARIABLE_ID, operation: 'set', value: 1 }],
      condition: { variableId: VARIABLE_ID, operator: '==', value: true },
    })
    expect(result.success).toBe(true)
  })

  it('rechaza un effect inválido dentro de la lista', () => {
    const result = DecisionResponseSchema.safeParse({
      ...base,
      effects: [{ variableId: VARIABLE_ID, operation: 'increment', value: true }],
    })
    expect(result.success).toBe(false)
  })
})

describe('ContentBlockSchema', () => {
  const BLOCK_ID = '66666666-6666-4666-8666-666666666666'
  const ASSET_ID = '77777777-7777-4777-8777-777777777777'

  it('acepta un bloque de texto, imagen, audio y vídeo válidos', () => {
    expect(ContentBlockSchema.safeParse({ id: BLOCK_ID, type: 'text', body: '' }).success).toBe(true)
    expect(
      ContentBlockSchema.safeParse({ id: BLOCK_ID, type: 'image', assetId: ASSET_ID }).success,
    ).toBe(true)
    expect(
      ContentBlockSchema.safeParse({ id: BLOCK_ID, type: 'audio', assetId: ASSET_ID }).success,
    ).toBe(true)
    expect(
      ContentBlockSchema.safeParse({ id: BLOCK_ID, type: 'video', assetId: ASSET_ID }).success,
    ).toBe(true)
  })

  it('rechaza un type desconocido', () => {
    expect(
      ContentBlockSchema.safeParse({ id: BLOCK_ID, type: 'gif', assetId: ASSET_ID }).success,
    ).toBe(false)
  })

  it('rechaza un bloque de texto sin body', () => {
    expect(ContentBlockSchema.safeParse({ id: BLOCK_ID, type: 'text' }).success).toBe(false)
  })

  it('rechaza un bloque de audio/vídeo sin assetId, o con un assetId que no es uuid', () => {
    expect(ContentBlockSchema.safeParse({ id: BLOCK_ID, type: 'audio' }).success).toBe(false)
    expect(
      ContentBlockSchema.safeParse({ id: BLOCK_ID, type: 'audio', assetId: 'no-es-uuid' }).success,
    ).toBe(false)
    expect(ContentBlockSchema.safeParse({ id: BLOCK_ID, type: 'video' }).success).toBe(false)
    expect(
      ContentBlockSchema.safeParse({ id: BLOCK_ID, type: 'video', assetId: 'no-es-uuid' }).success,
    ).toBe(false)
  })

  it('rechaza un bloque de imagen con un assetId que no es uuid', () => {
    expect(
      ContentBlockSchema.safeParse({ id: BLOCK_ID, type: 'image', assetId: 'no-es-uuid' }).success,
    ).toBe(false)
  })

  it('milestone "+1 fallo con Game Over": acepta un bloque de imagen SIN assetId ("pendiente de subir")', () => {
    const result = ContentBlockSchema.safeParse({ id: BLOCK_ID, type: 'image' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toMatchObject({ id: BLOCK_ID, type: 'image' })
      expect(result.data.type === 'image' ? result.data.assetId : 'missing').toBeUndefined()
    }
  })

  it('rechaza un bloque de audio con `body` en vez de `assetId` (campos de otro tipo del discriminador)', () => {
    expect(
      ContentBlockSchema.safeParse({ id: BLOCK_ID, type: 'audio', body: 'texto' }).success,
    ).toBe(false)
  })

  it('rechaza un id que no es uuid', () => {
    expect(
      ContentBlockSchema.safeParse({ id: 'no-es-uuid', type: 'text', body: '' }).success,
    ).toBe(false)
  })
})

describe('SlideNodeSchema — condition/elseTargetNodeId opcionales', () => {
  const base = {
    id: NODE_ID,
    number: 1,
    position: { x: 0, y: 0 },
    title: '',
    type: 'slide' as const,
    responses: [],
    content: [],
  }

  it('acepta una diapositiva sin condition/elseTargetNodeId (comportamiento actual intacto)', () => {
    expect(SlideNodeSchema.safeParse(base).success).toBe(true)
  })

  it('acepta condition + elseTargetNodeId junto a targetNodeId', () => {
    const result = SlideNodeSchema.safeParse({
      ...base,
      targetNodeId: '44444444-4444-4444-8444-444444444444',
      elseTargetNodeId: '55555555-5555-4555-8555-555555555555',
      condition: { variableId: VARIABLE_ID, operator: '>=', value: 3 },
    })
    expect(result.success).toBe(true)
  })

  it('rechaza un elseTargetNodeId que no es uuid', () => {
    const result = SlideNodeSchema.safeParse({ ...base, elseTargetNodeId: 'no-es-uuid' })
    expect(result.success).toBe(false)
  })
})

describe('SlideColorSchema / SlideNodeSchema.color (paleta cerrada de color)', () => {
  const base = {
    id: NODE_ID,
    number: 1,
    position: { x: 0, y: 0 },
    title: '',
    type: 'slide' as const,
    responses: [],
    content: [],
  }

  it('SLIDE_COLORS tiene exactamente los siete nombres de la paleta (Tarea 3: séptimo color "red")', () => {
    expect(SLIDE_COLORS).toEqual(['yellow', 'orange', 'pink', 'purple', 'cyan', 'gray', 'red'])
  })

  it('SlideColorSchema acepta cada uno de los siete nombres de SLIDE_COLORS', () => {
    for (const color of SLIDE_COLORS) {
      expect(SlideColorSchema.safeParse(color).success).toBe(true)
    }
  })

  it('SlideColorSchema rechaza un nombre fuera de la paleta', () => {
    expect(SlideColorSchema.safeParse('turquoise').success).toBe(false)
    expect(SlideColorSchema.safeParse('').success).toBe(false)
  })

  it('acepta una diapositiva sin `color` (comportamiento actual intacto, campo puramente aditivo)', () => {
    const result = SlideNodeSchema.safeParse(base)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.color).toBeUndefined()
    }
  })

  it('acepta una diapositiva con cada color válido de la paleta', () => {
    for (const color of SLIDE_COLORS) {
      const result = SlideNodeSchema.safeParse({ ...base, color })
      expect(result.success).toBe(true)
    }
  })

  it('rechaza un color fuera de la paleta cerrada', () => {
    const result = SlideNodeSchema.safeParse({ ...base, color: 'turquoise' })
    expect(result.success).toBe(false)
  })

  it('un documento completo (ProjectDocumentSchema) sin `color` en su diapositiva sigue abriendo bien', () => {
    const project = createProject('Proyecto sin color')
    const result = ProjectDocumentSchema.safeParse(project)
    expect(result.success).toBe(true)
    if (result.success) {
      const slide = result.data.graph.nodes.find((node) => node.type === 'slide')
      expect(slide && slide.type === 'slide' ? slide.color : 'missing').toBeUndefined()
    }
  })
})

describe('FinalVariantSchema / FinalNodeSchema.variant (tres variantes de Final: general/bueno/malo)', () => {
  const base = {
    id: NODE_ID,
    number: 1,
    position: { x: 0, y: 0 },
    title: '',
    type: 'final' as const,
    body: '',
  }

  it('FINAL_VARIANTS tiene exactamente los tres valores: general, good, bad', () => {
    expect(FINAL_VARIANTS).toEqual(['general', 'good', 'bad'])
  })

  it('FinalVariantSchema acepta cada uno de los tres valores', () => {
    for (const variant of FINAL_VARIANTS) {
      expect(FinalVariantSchema.safeParse(variant).success).toBe(true)
    }
  })

  it('FinalVariantSchema rechaza un valor fuera de los tres', () => {
    expect(FinalVariantSchema.safeParse('excellent').success).toBe(false)
    expect(FinalVariantSchema.safeParse('').success).toBe(false)
  })

  it('un Final sin `variant` parsea con el valor por defecto "general" (campo puramente aditivo)', () => {
    const result = FinalNodeSchema.safeParse(base)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.variant).toBe('general')
    }
  })

  it('acepta un Final con cada variante explícita', () => {
    for (const variant of FINAL_VARIANTS) {
      const result = FinalNodeSchema.safeParse({ ...base, variant })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.variant).toBe(variant)
      }
    }
  })

  it('rechaza una variante fuera de las tres soportadas', () => {
    const result = FinalNodeSchema.safeParse({ ...base, variant: 'excellent' })
    expect(result.success).toBe(false)
  })

  it('un documento completo (ProjectDocumentSchema) con un Final SIN `variant` sigue abriendo bien, tratado como "general" (compatibilidad con documentos guardados antes de esta fase)', () => {
    const project = createProject('Proyecto sin variant')
    // Documento con la forma de ANTES de esta fase: su Final no lleva
    // `variant` en absoluto — simula un `.brunch` guardado por una versión
    // anterior de la app. `finalWithoutVariant` se construye a propósito como
    // literal plano (no tipado como `FinalNode`, que ya exige `variant`) para
    // que TypeScript no fuerce el campo aquí: lo que se comprueba es que el
    // schema Zod, no el tipo estático, sigue aceptando esta forma.
    const finalWithoutVariant = {
      id: '33333333-3333-4333-8333-333333333333',
      number: 2,
      position: { x: 0, y: 0 },
      title: 'Fin',
      type: 'final',
      body: '',
    }
    const withLegacyFinal = {
      ...project,
      graph: {
        ...project.graph,
        nodes: [...project.graph.nodes, finalWithoutVariant],
      },
    }

    const result = ProjectDocumentSchema.safeParse(withLegacyFinal)
    expect(result.success).toBe(true)
    if (result.success) {
      const final = result.data.graph.nodes.find((node) => node.type === 'final')
      expect(final && final.type === 'final' ? final.variant : 'missing').toBe('general')
    }
  })
})

describe('IntroNodeSchema (milestone "Diapositiva de Inicio")', () => {
  const base = {
    id: NODE_ID,
    number: 1,
    position: { x: 0, y: 0 },
    title: '',
    type: 'intro' as const,
  }

  it('acepta un intro con solo los campos base (cicloId/asignaturaId/targetNodeId ausentes, caseName por defecto)', () => {
    const result = IntroNodeSchema.safeParse(base)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.caseName).toBe('')
      expect(result.data.cicloId).toBeUndefined()
      expect(result.data.asignaturaId).toBeUndefined()
      expect(result.data.targetNodeId).toBeUndefined()
    }
  })

  it('acepta un intro con todos los campos rellenos', () => {
    const result = IntroNodeSchema.safeParse({
      ...base,
      cicloId: 'troncal_esp',
      asignaturaId: 'TR_ENGL_GM',
      caseName: 'Atención a un cliente disgustado',
      targetNodeId: '44444444-4444-4444-8444-444444444444',
    })
    expect(result.success).toBe(true)
  })

  it('NO valida que cicloId/asignaturaId existan en el catálogo ni que sean coherentes entre sí (responsabilidad de introValidation.ts)', () => {
    const result = IntroNodeSchema.safeParse({
      ...base,
      cicloId: 'no-existe-en-el-catalogo',
      asignaturaId: 'tampoco-existe',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza un targetNodeId que no es uuid', () => {
    expect(IntroNodeSchema.safeParse({ ...base, targetNodeId: 'no-es-uuid' }).success).toBe(false)
  })

  it('rechaza type distinto de "intro"', () => {
    expect(IntroNodeSchema.safeParse({ ...base, type: 'slide' }).success).toBe(false)
  })

  it('NODE_TYPES incluye "intro", "slide" y "final" en ese orden', () => {
    expect(NODE_TYPES).toEqual(['intro', 'slide', 'final'])
  })

  it('NodeSchema (unión discriminada) acepta un nodo intro', () => {
    expect(NodeSchema.safeParse(base).success).toBe(true)
  })
})

describe('ProjectDocumentSchema.variables', () => {
  it('un documento con variables válidas parsea correctamente', () => {
    const project = createProject('P')
    const withVariable = {
      ...project,
      variables: [{ id: VARIABLE_ID, name: 'contador', type: 'number', initialValue: 0 }],
    }
    const result = ProjectDocumentSchema.safeParse(withVariable)
    expect(result.success).toBe(true)
  })

  it('un documento con una variable inválida (type desconocido) no parsea', () => {
    const project = createProject('P')
    const withInvalidVariable = {
      ...project,
      variables: [{ id: VARIABLE_ID, name: 'x', type: 'text', initialValue: 'y' }],
    }
    expect(ProjectDocumentSchema.safeParse(withInvalidVariable).success).toBe(false)
  })

  it('sin el campo `variables`, el documento parsea igualmente con variables: [] por defecto', () => {
    const project = createProject('P')
    const { variables: _variables, ...withoutVariables } = project
    const result = ProjectDocumentSchema.safeParse(withoutVariables)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.variables).toEqual([])
    }
  })
})
