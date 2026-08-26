import { CICLOS } from './catalog'
import type { ProjectDocument } from './schemas'

/**
 * Validación de la diapositiva de Inicio (nodo `intro`, milestone
 * "Diapositiva de Inicio", ver `IntroNodeSchema` en `src/domain/schemas.ts`).
 *
 * Archivo aparte de `src/domain/catalog.ts` (que solo expone los datos
 * `CICLOS`, ver su propio comentario de cabecera — no se toca) y de
 * `src/domain/project.ts`: estas dos funciones son puras, no mutan ningún
 * `ProjectDocument` ni se enganchan a ninguna acción de dominio, así que no
 * encajaban bien ni como "otro campo más" de `catalog.ts` ni mezcladas con
 * las funciones de creación/edición de nodos de `project.ts`. Ninguna de las
 * dos se conecta aquí a ningún botón ni flujo de UI: eso es responsabilidad
 * de fases futuras (fase 2 — editor, para `asignaturaBelongsToCiclo`; fase 3
 * — export, para `validateIntroForExport`).
 */

/**
 * ¿Pertenece la asignatura `asignaturaId` al ciclo `cicloId`, según el
 * catálogo `CICLOS`? Devuelve `false` tanto si el ciclo no existe en el
 * catálogo como si existe pero esa asignatura no está entre las suyas —
 * deliberadamente NO lanza en ninguno de los dos casos: un `cicloId`/
 * `asignaturaId` que ya no está en el catálogo (p.ej. el catálogo cambió
 * después de guardarse el documento) no es un error de programación, es un
 * estado de datos perfectamente representable que quien llama debe poder
 * tratar como "no coherente" sin manejar una excepción aparte.
 *
 * Pensada, en la fase de editor (fase 2, futura), para que al cambiar el
 * ciclo elegido en el desplegable de la diapositiva de Inicio se sepa que
 * hay que limpiar `asignaturaId` si ya no pertenece al ciclo nuevo — esa
 * limpieza automática es lógica de interacción de UI y no vive aquí, esta
 * función es solo la consulta pura que la hace posible.
 */
export function asignaturaBelongsToCiclo(cicloId: string, asignaturaId: string): boolean {
  const ciclo = CICLOS.find((candidate) => candidate.id === cicloId)
  if (!ciclo) return false
  return ciclo.asignaturas.some((asignatura) => asignatura.id === asignaturaId)
}

/**
 * Comprueba si la diapositiva de Inicio del proyecto está completa para
 * poder exportarlo, y devuelve la lista de textos describiendo qué falta —
 * vacía si todo está completo. Pura: no lanza (salvo que el propio
 * `ProjectDocument` sea inválido de una forma que ni siquiera permita
 * recorrer `graph.nodes`, lo cual no puede ocurrir con un documento que ya
 * ha pasado por `ProjectDocumentSchema`), no muta nada.
 *
 * Comprobaciones, en este orden (mismo orden en que tendría sentido
 * rellenarlas en un formulario ciclo -> asignatura -> nombre del caso):
 * 1. Hay un nodo `intro` en el proyecto. Si no lo hay, se informa con un
 *    único mensaje y no se comprueba nada más — no debería ocurrir nunca en
 *    un proyecto creado desde una plantilla o abierto desde un `.brunch` ya
 *    migrado (ver `src/domain/templates.ts`/`src/domain/migration.ts`, que
 *    garantizan que siempre haya uno), pero SÍ puede ocurrir con un
 *    `ProjectDocument` construido a mano con la función de bajo nivel
 *    `createProject` sin pasar por ninguna de las dos — ver el comentario de
 *    esa función en `src/domain/project.ts`.
 * 2. `cicloId` elegido (no vacío).
 * 3. `asignaturaId` elegido (no vacío).
 * 4. Si AMBOS anteriores están elegidos, que sean coherentes entre sí
 *    (`asignaturaBelongsToCiclo`) — un mensaji aparte, independiente de los
 *    dos anteriores, porque el problema no es que falte un dato sino que la
 *    combinación no tiene sentido.
 * 5. `caseName` no vacío tras recortar espacios (mismo criterio de
 *    "vacío" que el resto del dominio, ver `assertUsableVariableName` en
 *    `src/domain/project.ts`).
 *
 * La fase de export (fase 3, futura) usará esta lista para bloquear la
 * exportación mostrando cada texto como un punto de una lista de errores;
 * esta función no sabe nada de esa UI, solo produce los textos.
 */
export function validateIntroForExport(project: ProjectDocument): string[] {
  const intro = project.graph.nodes.find((node) => node.type === 'intro')
  if (!intro) {
    return ['El proyecto no tiene diapositiva de Inicio.']
  }

  const issues: string[] = []

  if (!intro.cicloId) {
    issues.push('Elige un ciclo')
  }
  if (!intro.asignaturaId) {
    issues.push('Elige una asignatura')
  }
  if (
    intro.cicloId &&
    intro.asignaturaId &&
    !asignaturaBelongsToCiclo(intro.cicloId, intro.asignaturaId)
  ) {
    issues.push('La asignatura elegida no pertenece al ciclo elegido')
  }
  if (intro.caseName.trim() === '') {
    issues.push('Escribe el nombre del caso práctico')
  }

  return issues
}
