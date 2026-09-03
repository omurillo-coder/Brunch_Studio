import { produce } from 'immer'
import { createId } from './id'
import type { ContentBlock, ImageSize, ProjectDocument, SlideNode } from './schemas'

/**
 * ---------------------------------------------------------------------------
 * Bloques de contenido de una diapositiva
 * ---------------------------------------------------------------------------
 *
 * Milestone "Bloques de contenido", fase 1 (dominio). Sustituye el modelo
 * anterior de una diapositiva (`body` único + `imageAssetIds` +
 * `audioAssetId` + `contentOrder`, ver `src/domain/migration.ts` para la
 * migración) por `SlideNode.content: ContentBlock[]`: una lista ORDENABLE de
 * bloques de texto/imagen/audio en cualquier combinación y orden — el índice
 * del array ES el orden de aparición.
 *
 * Archivo separado de `project.ts` (que reúne las operaciones genéricas de
 * nodo: crear/mover/duplicar/parchear campos simples vía `UpdateNodePatch`)
 * siguiendo el mismo criterio que `src/domain/responses.ts` para las
 * respuestas de decisión: manipular `content` es una familia de operaciones
 * ESTRUCTURALES (añadir, quitar, reordenar, editar el texto de un bloque
 * concreto por su id) con su propia lógica de validación — no encaja como
 * "un campo más" de `UpdateNodePatch`, que solo admite reemplazar un array
 * completo de una vez (como si hiciera `imageAssetIds` en el modelo
 * anterior). Igual que `responses`, cada bloque tiene un `id` con identidad
 * propia dentro de la diapositiva: perderla forzaría a quien llama a
 * reconstruir el array entero a mano por cada cambio, con riesgo de pisar
 * una edición concurrente de otro bloque.
 *
 * Todas las funciones de este módulo actualizan `metadata.updatedAt` y
 * lanzan `Error` si el nodo no existe o no es una diapositiva (un `final` no
 * tiene `content`) — mismo criterio que el resto del dominio.
 */

/** Localiza la diapositiva sobre la que operan las funciones de este
 *  módulo. Lanza `Error` si el nodo no existe o no es una diapositiva (un
 *  `final` no tiene `content`) — mismo criterio y misma forma que el
 *  `findSlideNode` privado de `src/domain/responses.ts`; no se comparte
 *  entre archivos a propósito, cada uno gestiona sus propias búsquedas
 *  locales, igual que ya ocurre entre `project.ts`/`graph.ts`/`responses.ts`. */
function findSlideNode(project: ProjectDocument, nodeId: string): SlideNode {
  const node = project.graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    throw new Error(`No existe un nodo con id "${nodeId}".`)
  }
  if (node.type !== 'slide') {
    throw new Error(`El nodo "${nodeId}" no es de tipo "slide".`)
  }
  return node
}

function findBlockIndex(node: SlideNode, blockId: string): number {
  return node.content.findIndex((block) => block.id === blockId)
}

/**
 * Recorta `index` al rango `[0, max]`. Un índice fuera de rango (negativo, o
 * mayor que el máximo permitido) se recorta al extremo más cercano en vez de
 * lanzar — mismo criterio "tolerante con la posición" que `moveNode`/
 * `moveNodes` en `src/domain/project.ts`, que tampoco rechazan nunca una
 * posición del lienzo. Así la UI (fase de editor) puede, por ejemplo, pasar
 * directamente el índice bruto de un evento de arrastre sin tener que
 * clampearlo ella misma antes de llamar.
 */
function clampIndex(index: number, max: number): number {
  return Math.min(Math.max(index, 0), max)
}

/**
 * Inserta un bloque ya construido (con su `id` ya generado por la función
 * pública que llama) en `content`, en `index` si se indica o al final si no.
 * Función interna compartida por `addTextBlock`/`addImageBlock`/
 * `addAudioBlock`: las tres solo difieren en qué bloque construyen.
 */
function insertBlock(
  project: ProjectDocument,
  slideNodeId: string,
  block: ContentBlock,
  index: number | undefined,
): ProjectDocument {
  const node = findSlideNode(project, slideNodeId)
  const insertAt = index === undefined ? node.content.length : clampIndex(index, node.content.length)

  return produce(project, (draft) => {
    const draftNode = draft.graph.nodes.find((candidate) => candidate.id === slideNodeId)
    if (!draftNode || draftNode.type !== 'slide') return
    draftNode.content.splice(insertAt, 0, block)
    draft.metadata.updatedAt = new Date().toISOString()
  })
}

/**
 * Añade un bloque de texto vacío a `content`, en `index` si se indica (se
 * recorta a `[0, content.length]`, ver `clampIndex`) o al final si no. El id
 * del bloque creado no se devuelve aparte: quien llama puede releerlo del
 * documento resultante (por posición, ya que se sabe dónde se insertó) igual
 * que ya se hace hoy con cualquier otro cambio de dominio que no necesita
 * devolver un id "difícil de recuperar" (contraste con
 * `createConnectedNode`/`duplicateNode`, que sí lo devuelven porque su
 * resultado no es trivial de localizar después).
 */
export function addTextBlock(
  project: ProjectDocument,
  slideNodeId: string,
  index?: number,
): ProjectDocument {
  return insertBlock(project, slideNodeId, { id: createId(), type: 'text', body: '' }, index)
}

/**
 * Añade un bloque de imagen. `assetId` es OPCIONAL (milestone "+1 fallo con
 * Game Over", ver comentario de `ContentBlockSchema` en `schemas.ts`): sin
 * él, el bloque nace "pendiente de subir" — un hueco reservado en el editor
 * mientras se consigue el material real, que `attachImageAsset` (más abajo)
 * completa después. Con `assetId`, mismo comportamiento de siempre: no
 * comprueba que el asset exista en la biblioteca del proyecto, esa
 * validación es responsabilidad de la UI, que solo debe ofrecer assets ya
 * importados para elegir.
 */
export function addImageBlock(
  project: ProjectDocument,
  slideNodeId: string,
  assetId?: string,
  index?: number,
): ProjectDocument {
  return insertBlock(project, slideNodeId, { id: createId(), type: 'image', assetId }, index)
}

/**
 * Rellena el `assetId` de un bloque de imagen ya creado pero todavía
 * "pendiente de subir" (`addImageBlock` sin `assetId`, ver su comentario) —
 * el único cambio de estado posible de un bloque pendiente: una vez
 * rellenado, se comporta exactamente igual que cualquier otro bloque de
 * imagen (no hay "des-rellenar"; para eso se quita el bloque y se añade uno
 * nuevo pendiente, mismo criterio que el resto de `content.ts` sobre no
 * ofrecer "Reemplazar"). Lanza `Error` si el nodo no existe/no es
 * diapositiva, si el bloque no existe, o si no es de tipo `image`.
 */
export function attachImageAsset(
  project: ProjectDocument,
  slideNodeId: string,
  blockId: string,
  assetId: string,
): ProjectDocument {
  const node = findSlideNode(project, slideNodeId)
  const index = findBlockIndex(node, blockId)
  if (index === -1) {
    throw new Error(`La diapositiva "${slideNodeId}" no tiene un bloque con id "${blockId}".`)
  }
  const block = node.content[index]
  if (!block || block.type !== 'image') {
    throw new Error(`El bloque "${blockId}" de la diapositiva "${slideNodeId}" no es de tipo "image".`)
  }

  return produce(project, (draft) => {
    const draftNode = draft.graph.nodes.find((candidate) => candidate.id === slideNodeId)
    if (!draftNode || draftNode.type !== 'slide') return
    const draftBlock = draftNode.content[index]
    if (draftBlock && draftBlock.type === 'image') {
      draftBlock.assetId = assetId
    }
    draft.metadata.updatedAt = new Date().toISOString()
  })
}

/**
 * Petición de usuario ("botón para hacer no ampliable la imagen" + "un
 * desplegable... Pequeño/Normal/Grande"): parche de las dos opciones
 * puramente visuales de un bloque de imagen — `expandable`/`size`, ver sus
 * comentarios en `ContentBlockSchema` (`schemas.ts`). Mismo criterio de
 * patch que el resto del dominio: `undefined` no toca ese campo, `null` lo
 * borra (vuelve al valor por defecto: ampliable/tamaño normal) — nunca hace
 * falta pasar los dos a la vez. Lanza `Error` si el nodo no existe/no es
 * diapositiva, si el bloque no existe, o si no es de tipo `image` — mismo
 * criterio que `attachImageAsset`.
 */
export function updateImageBlockOptions(
  project: ProjectDocument,
  slideNodeId: string,
  blockId: string,
  patch: { expandable?: boolean | null; size?: ImageSize | null },
): ProjectDocument {
  const node = findSlideNode(project, slideNodeId)
  const index = findBlockIndex(node, blockId)
  if (index === -1) {
    throw new Error(`La diapositiva "${slideNodeId}" no tiene un bloque con id "${blockId}".`)
  }
  const block = node.content[index]
  if (!block || block.type !== 'image') {
    throw new Error(`El bloque "${blockId}" de la diapositiva "${slideNodeId}" no es de tipo "image".`)
  }

  return produce(project, (draft) => {
    const draftNode = draft.graph.nodes.find((candidate) => candidate.id === slideNodeId)
    if (!draftNode || draftNode.type !== 'slide') return
    const draftBlock = draftNode.content[index]
    if (!draftBlock || draftBlock.type !== 'image') return
    if (patch.expandable !== undefined) {
      draftBlock.expandable = patch.expandable === null ? undefined : patch.expandable
    }
    if (patch.size !== undefined) {
      draftBlock.size = patch.size === null ? undefined : patch.size
    }
    draft.metadata.updatedAt = new Date().toISOString()
  })
}

/** Añade un bloque de audio que referencia un asset ya importado. Mismo
 *  criterio de no-validación que `addImageBlock`. A diferencia del antiguo
 *  `audioAssetId` (como mucho uno por diapositiva), aquí no hay ningún
 *  límite: pueden coexistir varios bloques de audio. */
export function addAudioBlock(
  project: ProjectDocument,
  slideNodeId: string,
  assetId: string,
  index?: number,
): ProjectDocument {
  return insertBlock(project, slideNodeId, { id: createId(), type: 'audio', assetId }, index)
}

/** Añade un bloque de vídeo que referencia un asset ya importado. Mismo
 *  patrón exacto que `addAudioBlock` (misma firma, mismo criterio de
 *  no-validación, sin ningún límite de cuántos bloques de vídeo puede tener
 *  una diapositiva). */
export function addVideoBlock(
  project: ProjectDocument,
  slideNodeId: string,
  assetId: string,
  index?: number,
): ProjectDocument {
  return insertBlock(project, slideNodeId, { id: createId(), type: 'video', assetId }, index)
}

/**
 * Actualiza el cuerpo (texto Tiptap serializado) de un bloque de texto
 * concreto, localizado por su `id` de bloque. Lanza `Error` si el nodo no es
 * una diapositiva, si no tiene ningún bloque con ese id, o si el bloque
 * encontrado no es de tipo `text` (un bloque de imagen/audio no tiene `body`
 * que editar por esta vía — llamar aquí sobre uno es un error de programación
 * de quien llama, no un caso de usuario silenciable).
 */
export function updateTextBlockBody(
  project: ProjectDocument,
  slideNodeId: string,
  blockId: string,
  body: string,
): ProjectDocument {
  const node = findSlideNode(project, slideNodeId)
  const index = findBlockIndex(node, blockId)
  if (index === -1) {
    throw new Error(`La diapositiva "${slideNodeId}" no tiene un bloque con id "${blockId}".`)
  }
  const block = node.content[index]
  if (!block || block.type !== 'text') {
    throw new Error(`El bloque "${blockId}" de la diapositiva "${slideNodeId}" no es de tipo "text".`)
  }

  return produce(project, (draft) => {
    const draftNode = draft.graph.nodes.find((candidate) => candidate.id === slideNodeId)
    if (!draftNode || draftNode.type !== 'slide') return
    const draftBlock = draftNode.content[index]
    if (draftBlock && draftBlock.type === 'text') {
      draftBlock.body = body
    }
    draft.metadata.updatedAt = new Date().toISOString()
  })
}

/**
 * Elimina un bloque de contenido por su `id`. A diferencia de
 * `removeResponse` (que siempre deja la diapositiva en un estado "válido de
 * negocio": de continuar, sin respuestas), eliminar el ÚLTIMO bloque de
 * texto de una diapositiva es una operación permitida que puede dejarla con
 * `content: []`, o solo con bloques de imagen/audio y ningún hueco de
 * texto — esta función no impone ningún mínimo. `createNode` siembra un
 * bloque de texto inicial (ver `src/domain/project.ts`), pero qué hacer tras
 * borrar el último bloque (¿ofrecer un botón para volver a añadir uno?) es
 * decisión de la UI en la fase de editor, no de este módulo. Lanza `Error`
 * si el nodo no existe/no es diapositiva o si el bloque no existe.
 */
export function removeContentBlock(
  project: ProjectDocument,
  slideNodeId: string,
  blockId: string,
): ProjectDocument {
  const node = findSlideNode(project, slideNodeId)
  if (findBlockIndex(node, blockId) === -1) {
    throw new Error(`La diapositiva "${slideNodeId}" no tiene un bloque con id "${blockId}".`)
  }

  return produce(project, (draft) => {
    const draftNode = draft.graph.nodes.find((candidate) => candidate.id === slideNodeId)
    if (!draftNode || draftNode.type !== 'slide') return
    draftNode.content = draftNode.content.filter((block) => block.id !== blockId)
    draft.metadata.updatedAt = new Date().toISOString()
  })
}

/**
 * Mueve un bloque, localizado por su `id`, a `toIndex` dentro de `content`
 * (reordenación). `toIndex` se recorta a `[0, content.length - 1]` (ver
 * `clampIndex`): un valor fuera de rango mueve el bloque al principio/final
 * en vez de lanzar, mismo criterio tolerante que el resto de este módulo.
 * Mover un bloque a su propio índice actual es un no-op válido (no lanza, no
 * cambia el orden). Lanza `Error` si el nodo no existe/no es diapositiva o
 * si el bloque no existe.
 */
export function moveContentBlock(
  project: ProjectDocument,
  slideNodeId: string,
  blockId: string,
  toIndex: number,
): ProjectDocument {
  const node = findSlideNode(project, slideNodeId)
  const fromIndex = findBlockIndex(node, blockId)
  if (fromIndex === -1) {
    throw new Error(`La diapositiva "${slideNodeId}" no tiene un bloque con id "${blockId}".`)
  }
  const clampedTarget = clampIndex(toIndex, node.content.length - 1)

  return produce(project, (draft) => {
    const draftNode = draft.graph.nodes.find((candidate) => candidate.id === slideNodeId)
    if (!draftNode || draftNode.type !== 'slide') return
    const [moved] = draftNode.content.splice(fromIndex, 1)
    if (moved) {
      draftNode.content.splice(clampedTarget, 0, moved)
    }
    draft.metadata.updatedAt = new Date().toISOString()
  })
}
