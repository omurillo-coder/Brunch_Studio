/**
 * Textos fijos de la portada de marca iLERNA ("¿Qué harías tú?", ver
 * `IntroCard` en `src/player/PlayerScreen.tsx`): iguales en todos los
 * proyectos, no dependen del documento. Viven en el dominio (como
 * `DEFAULT_CONTINUE_LABEL` en `schemas.ts`) para que `PlayerScreen.tsx` (el
 * "▶ Probar" de dentro de la app) y `htmlBundle.ts` (que los mete en
 * `EXPORTED_TEXTS`, leídos por `buildIntroCard` en
 * `exportedPlayerScript.ts`) importen la MISMA fuente en vez de arriesgarse
 * a que diverjan dos copias del mismo texto.
 *
 * La palabra "decisiones" del subtítulo va separada (prefijo/acento/sufijo)
 * porque se pinta en un `<span>` propio, en el turquesa de acento — ver
 * `.introSubtitleAccent`.
 *
 * Los tres placeholders son para la portada INCOMPLETA (se puede "Probar"
 * antes de rellenar ciclo/asignatura/nombre del caso, ver
 * `validateIntroForExport`): a diferencia del resto de vistas del Player
 * (donde "vacío" se omite sin más), aquí cada pieza que falte se sustituye
 * por un aviso gris — decisión de producto explícita para esta portada.
 */

export const INTRO_HEADING = '¿Qué harías tú?'
export const INTRO_SUBTITLE_PREFIX = 'Pon a prueba tus conocimientos tomando '
export const INTRO_SUBTITLE_ACCENT = 'decisiones'
export const INTRO_SUBTITLE_SUFFIX = ' en una situación realista.'

export const INTRO_CICLO_PLACEHOLDER = '— Ciclo sin elegir —'
export const INTRO_ASIGNATURA_PLACEHOLDER = '— Asignatura sin elegir —'
export const INTRO_CASE_NAME_PLACEHOLDER = '— Título sin definir —'

/**
 * Título fijo de la pantalla de marca bespoke "Game Over"
 * (`SlideNodeSchema.brandedGameOverScreen`, ver `GameOverCard` en
 * `src/player/PlayerScreen.tsx`) — mismo criterio que `INTRO_HEADING` justo
 * arriba: vive en el dominio para que `PlayerScreen.tsx` y `htmlBundle.ts`
 * (`EXPORTED_TEXTS.gameOverHeading`, leído por `buildGameOverCard` en
 * `exportedPlayerScript.ts`) importen la MISMA fuente.
 */
export const GAME_OVER_HEADING = '¿Seguro que no quieres volver a intentarlo?'

/**
 * Copy fijo de "Final TOP" (contenido POR DEFECTO de un Final, sin fallos —
 * `!view.usedAlternate`, ver `FinalSuccessCard` en `src/player/PlayerScreen.tsx`)
 * y de "Final con fallos" (contenido ALTERNATIVO, `view.usedAlternate` —
 * ver `FinalAlternateCard`). Petición de usuario: igual que `GAME_OVER_HEADING`,
 * texto de marca FIJO e igual en todos los proyectos — ya NO el cuerpo real
 * (`FinalNode.body`/`alternateBody`) que edita el diseñador en el Inspector.
 * Ese campo del dominio se conserva (sigue siendo el gate de qué variante
 * se activa, y lo sigue usando `aiReviewExport.ts` para el documento de
 * revisión), pero deja de pintarse en la tarjeta bespoke del Player — mismo
 * criterio que las respuestas de `brandedGameOverScreen`, cuyo texto
 * tampoco se pinta (ver comentario de `resolveGameOverResponses`).
 *
 * La primera línea de cada pantalla ("¡Impresionante!"/"¡Buen trabajo!") es
 * un titular aparte (`FINAL_TOP_HEADING`/`FINAL_ALTERNATE_HEADING`), grande
 * y en negrita — petición de usuario: "dar prioridad a la primera parte de
 * las frases". Las otras dos líneas son cuerpo normal.
 */
export const FINAL_TOP_HEADING = '¡Impresionante!'
export const FINAL_TOP_BODY_LINE_1 = 'Lo has resuelto en un momento.'
export const FINAL_TOP_BODY_LINE_2 = '¿Quieres explorar otros caminos?'

export const FINAL_ALTERNATE_HEADING = '¡Buen trabajo!'
export const FINAL_ALTERNATE_BODY_LINE_1 =
  'Has conseguido resolver el caso, aunque has tenido algunos contratiempos.'
export const FINAL_ALTERNATE_BODY_LINE_2 = '¿Qué decisiones cambiarías?'
