import type { ProjectDocument } from '../domain'
import type { ProjectRepository } from '../persistence'

/**
 * Extrae el nombre "legible" de una ruta `.brunch`: el nombre de archivo sin
 * ruta ni extensión.
 *
 * Robusto ante cualquier separador de ruta (`/` en macOS/Linux, `\` en
 * Windows) sin importar en qué plataforma corra el proceso que lo llama —
 * por eso no se usa `node:path` (asumiría el separador del SO actual bajo
 * el que corre el test/la app, no el de la ruta en sí) sino una expresión
 * regular que reconoce ambos. Mismo patrón que `fileStemFromPath` en
 * `HomeScreen.tsx` (para `.twee`/`.tw`) y que `MemoryAssetRepository`.
 */
export function projectNameFromFilePath(path: string): string {
  const fileName = path.split(/[/\\]/).pop() ?? path
  return fileName.replace(/\.brunch$/i, '')
}

/**
 * Abre un `.brunch` YA EXISTENTE en `path` a través de `repository` y
 * sincroniza `metadata.name` con el nombre real del archivo en disco,
 * descartando el que hubiera guardado el documento.
 *
 * Por qué: `metadata.name` se fija una única vez al CREAR el proyecto (ver
 * "Nuevo proyecto" en `HomeScreen.tsx`) y no se vuelve a tocar. Si el
 * usuario renombra el archivo `.brunch` fuera de la app (Finder/Explorador),
 * `metadata.name` se queda con el nombre viejo. Sincronizarlo aquí, justo al
 * abrir y antes de que el documento entre en `useProjectStore`, corrige de
 * un plumazo el nombre mostrado en `Topbar`, el `<title>` del HTML/SCORM
 * exportado y el nombre de archivo sugerido al exportar — todos esos sitios
 * leen `project.metadata.name`, así que no hace falta tocarlos.
 *
 * Deliberadamente unidireccional: solo se sincroniza al ABRIR. El próximo
 * autoguardado (ya existente) persiste este nombre corregido sin necesitar
 * ningún código de migración adicional.
 *
 * Punto único compartido por los dos flujos que abren un `.brunch` ya
 * existente: "Abrir proyecto" (`HomeScreen.tsx`) y el arranque con una ruta
 * inicial recibida de Finder/Explorador (`App.tsx`). El flujo de "Nuevo
 * proyecto" no pasa por aquí — ese ya fija `metadata.name` correctamente a
 * partir de lo que escribe el usuario y no debe cambiar.
 */
export async function openExistingProject(
  repository: ProjectRepository,
  path: string,
): Promise<ProjectDocument> {
  const document = await repository.openProject(path)
  return {
    ...document,
    metadata: {
      ...document.metadata,
      name: projectNameFromFilePath(path),
    },
  }
}
