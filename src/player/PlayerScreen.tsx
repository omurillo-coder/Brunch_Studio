import { useState } from 'react'
import { useProject, useProjectStore, usePreviewStartNodeId } from '../store'
import {
  CICLOS,
  cicloOutputName,
  DEFAULT_CONTINUE_LABEL,
  INTRO_ASIGNATURA_PLACEHOLDER,
  INTRO_CASE_NAME_PLACEHOLDER,
  INTRO_CICLO_PLACEHOLDER,
  INTRO_HEADING,
  INTRO_SUBTITLE_ACCENT,
  INTRO_SUBTITLE_PREFIX,
  INTRO_SUBTITLE_SUFFIX,
  RESPONSE_LETTERS,
} from '../domain'
import type { ContentBlock, DecisionResponse, IntroNode, SlideNode } from '../domain'
import { advance, choose, getInitialState, getView } from './runtime'
import type { PlayerState } from './runtime'
import { useAppServices } from '../app/AppServicesContext'
import { useAssetDataUri } from '../hooks/useAssetDataUri'
import type { AssetRepository } from '../persistence'
import { RichTextView } from '../editor/richText/RichTextView'
import ilernaLogoUrl from '../assets/playerIntro/ilerna-logo.png'
import styles from './PlayerScreen.module.css'

/** Mismo criterio de orden que `Inspector`: por letra (A→B→C→D) fijo,
 *  independiente del orden interno de creación/borrado del array. La letra
 *  solo ordena: nunca se muestra al usuario. */
function sortByLetter(responses: DecisionResponse[]): DecisionResponse[] {
  return [...responses].sort(
    (a, b) => RESPONSE_LETTERS.indexOf(a.letter) - RESPONSE_LETTERS.indexOf(b.letter),
  )
}

/**
 * Imagen adjunta (de nodo o de respuesta) mostrada como contenido real para
 * quien juega — no una miniatura de edición como en el Inspector, así que
 * usa su propia clase de tamaño (`styles.media`). Se monta con `key={assetId}`
 * desde el llamador para que un cambio de asset (nodo distinto, o mismo nodo
 * con el asset reemplazado) arranque la carga desde cero.
 *
 * Si la carga falla, no muestra nada (ni imagen ni mensaje de error): el
 * resto de la pantalla — texto, opciones, controles de navegación — debe
 * seguir funcionando con normalidad.
 */
function PlayerImage({
  assetId,
  filePath,
  assetRepository,
  alt,
}: {
  assetId: string
  filePath: string
  assetRepository: AssetRepository
  alt: string
}) {
  const { dataUri } = useAssetDataUri(filePath, assetId, assetRepository)
  if (!dataUri) return null
  return <img className={styles.media} src={dataUri} alt={alt} />
}

/** Audio adjunto (de nodo o de respuesta), con los mismos controles nativos
 *  de reproducción que ya usa el Inspector. Mismo criterio de fallo
 *  silencioso que `PlayerImage`. */
function PlayerAudio({
  assetId,
  filePath,
  assetRepository,
}: {
  assetId: string
  filePath: string
  assetRepository: AssetRepository
}) {
  const { dataUri } = useAssetDataUri(filePath, assetId, assetRepository)
  if (!dataUri) return null
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <audio className={styles.audio} controls src={dataUri} />
}

/** Vídeo adjunto de un bloque de `SlideNode.content` (cuarto tipo de bloque):
 *  mismo criterio de tamaño máximo ya usado para las imágenes (`styles.media`
 *  — ancho/alto máximo, sin desbordar ni distorsionar la tarjeta), con
 *  controles nativos de reproducción. Mismo criterio de fallo silencioso que
 *  `PlayerImage`/`PlayerAudio`. */
function PlayerVideo({
  assetId,
  filePath,
  assetRepository,
}: {
  assetId: string
  filePath: string
  assetRepository: AssetRepository
}) {
  const { dataUri } = useAssetDataUri(filePath, assetId, assetRepository)
  if (!dataUri) return null
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <video className={styles.media} controls src={dataUri} />
}

/**
 * Un bloque de `SlideNode.content`, pintado según su `type` (milestone
 * "Bloques de contenido"): texto vía `RichTextView`, imagen/audio/vídeo vía
 * `PlayerImage`/`PlayerAudio`/`PlayerVideo` — la misma resolución de asset
 * que antes se llamaba una vez por nodo, ahora generalizada a llamarse por
 * cada bloque de su tipo. Un bloque de texto vacío (sin escribir nada aún) no
 * pinta nada, mismo criterio de "vacío = nada" que el antiguo `body` único.
 *
 * `key`: el llamador (`SlideContent`) ya pone `key={block.id}` en cada
 * instancia de este componente para la identidad de lista; aquí, en el
 * elemento raíz que devuelve cada rama, se añade además `key={block.assetId}`
 * para imagen/audio/vídeo — mismo motivo que documenta
 * `PlayerImage`/`PlayerAudio`/`PlayerVideo` más abajo: si el asset de un
 * bloque cambiara, fuerza a React a montar una
 * instancia nueva en vez de reutilizar un `dataUri` que ya no corresponde.
 */
function ContentBlockView({
  block,
  filePath,
  assetRepository,
}: {
  block: ContentBlock
  filePath: string
  assetRepository: AssetRepository
}) {
  switch (block.type) {
    case 'text':
      if (!block.body.trim()) return null
      return <RichTextView body={block.body} className={styles.body} />
    case 'image':
      // Imagen "pendiente de subir" (milestone "+1 fallo con Game Over",
      // `assetId` opcional): mismo criterio "vacío = nada" que un bloque de
      // texto sin escribir — el Player la omite sin más. Exportar SÍ la
      // bloquea (ver `validatePendingContentForExport`), así que en la
      // práctica esto solo se ve al "Probar" con contenido a medias.
      if (!block.assetId) return null
      return (
        <PlayerImage
          key={block.assetId}
          assetId={block.assetId}
          filePath={filePath}
          assetRepository={assetRepository}
          alt="Imagen de esta pantalla"
        />
      )
    case 'audio':
      return (
        <PlayerAudio
          key={block.assetId}
          assetId={block.assetId}
          filePath={filePath}
          assetRepository={assetRepository}
        />
      )
    case 'video':
      return (
        <PlayerVideo
          key={block.assetId}
          assetId={block.assetId}
          filePath={filePath}
          assetRepository={assetRepository}
        />
      )
  }
}

/**
 * Pinta `node.content` EN ORDEN, bloque a bloque — sustituye al antiguo par
 * "cuerpo de texto único" + "bloque de medios apilado" (`SlideBody`/
 * `NodeMedia`, milestone "Bloques de contenido"): ahora los bloques son
 * heterogéneos y se intercalan libremente, así que basta con recorrer el
 * array tal cual, sin ninguna noción de "orden" aparte del propio índice
 * (ver comentario de `ContentBlockSchema` en `src/domain/schemas.ts`).
 *
 * `emptyFallback` (mismo contrato que antes): si la diapositiva no tiene
 * NINGÚN bloque, se pinta como párrafo de repuesto salvo que sea `null`
 * (vista `decision`, que no muestra nada en ese caso).
 */
function SlideContent({
  node,
  filePath,
  assetRepository,
  emptyFallback,
}: {
  node: SlideNode
  filePath: string
  assetRepository: AssetRepository
  emptyFallback: string | null
}) {
  if (node.content.length === 0) {
    if (emptyFallback === null) return null
    return <p className={styles.body}>{emptyFallback}</p>
  }
  return (
    <>
      {node.content.map((block) => (
        <ContentBlockView
          key={block.id}
          block={block}
          filePath={filePath}
          assetRepository={assetRepository}
        />
      ))}
    </>
  )
}

/**
 * Una opción de una diapositiva con respuestas: el botón de elegirla (un
 * punto + su texto, nunca una letra) más su imagen/audio adjuntos, si tiene.
 * La imagen/audio se colocan FUERA del `<button>` (contenido interactivo,
 * como los controles de `<audio>`, no puede anidarse dentro de un elemento
 * interactivo) para que reproducir el audio de una opción no cuente como
 * elegirla.
 *
 * `index` es la posición 1-based de la opción, usada solo para el texto
 * alternativo de su imagen (donde antes se usaba la letra).
 */
function ResponseOption({
  response,
  index,
  disabled,
  filePath,
  assetRepository,
  onChoose,
}: {
  response: DecisionResponse
  index: number
  disabled: boolean
  filePath: string
  assetRepository: AssetRepository
  onChoose: () => void
}) {
  return (
    <div className={styles.option}>
      <button
        type="button"
        className={styles.optionButton}
        disabled={disabled}
        onClick={onChoose}
      >
        <span className={styles.optionBullet} aria-hidden="true" />
        <span>{response.text.trim() || 'Opción sin texto configurado'}</span>
      </button>
      {(response.imageAssetId || response.audioAssetId) && (
        <div className={styles.optionMedia}>
          {response.imageAssetId && (
            <PlayerImage
              key={response.imageAssetId}
              assetId={response.imageAssetId}
              filePath={filePath}
              assetRepository={assetRepository}
              alt={`Imagen de la respuesta ${index}`}
            />
          )}
          {response.audioAssetId && (
            <PlayerAudio
              key={response.audioAssetId}
              assetId={response.audioAssetId}
              filePath={filePath}
              assetRepository={assetRepository}
            />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Resuelve `cicloId`/`asignaturaId` de un nodo `intro` a sus nombres
 * legibles, vía el catálogo `CICLOS` (`src/domain/catalog.ts`). Dentro de la
 * app esto es un `import` TS normal — a diferencia del runtime exportado
 * (`src/export/exportedPlayerScript.ts`), que no puede importar `catalog.ts`
 * (JS vanilla embebido, sin módulos) y por eso recibe los nombres ya
 * resueltos dentro del bundle, ver `resolveIntroCatalogNames` en
 * `src/export/htmlBundle.ts` — misma lógica, aplicada en dos momentos
 * distintos (aquí, en cada render; allí, una vez, en tiempo de exportación).
 * `undefined` si el campo no está elegido, o si el id ya no existe en el
 * catálogo: mismo criterio tolerante que `asignaturaBelongsToCiclo`
 * (`src/domain/introValidation.ts`) — la portada puede "probarse" incompleta
 * antes de exportar, ver `validateIntroForExport`.
 */
function resolveIntroNames(node: IntroNode): { cicloName?: string; asignaturaName?: string } {
  const ciclo = node.cicloId ? CICLOS.find((candidate) => candidate.id === node.cicloId) : undefined
  const asignatura =
    ciclo && node.asignaturaId
      ? ciclo.asignaturas.find((candidate) => candidate.id === node.asignaturaId)
      : undefined
  // Este reproductor ("▶ Probar", dentro de la app) simula fielmente lo que
  // verá el alumno en la salida final: el nombre del ciclo pierde su
  // prefijo interno de código (`cicloOutputName`, ver ese comentario en
  // `src/domain/catalog.ts`), igual que `resolveIntroCatalogNames` en
  // `src/export/htmlBundle.ts`. El de la asignatura no lleva código, ese es
  // exclusivo del espacio de trabajo (Inspector/canvas).
  return {
    cicloName: ciclo ? cicloOutputName(ciclo.name) : undefined,
    asignaturaName: asignatura?.name,
  }
}

/**
 * Portada de marca iLERNA (nodo `intro`, milestone "Portada de marca
 * iLERNA"): primera vista del recorrido en casi todo proyecto (ver
 * comentario de `IntroNodeSchema` en `src/domain/schemas.ts`). Diseño de
 * referencia entregado por Content Factory: logo arriba, titular fijo de
 * marca ("¿Qué harías tú?" + subtítulo con "decisiones" en acento),
 * ciclo/asignatura como contexto secundario, `caseName` como título de la
 * actividad junto al botón de continuar (abajo, empujado por
 * `.introFooter { margin-top: auto }`), e ilustración de marca a la derecha
 * (oculta en móvil, ver `.introIllustration`/media query en
 * `PlayerScreen.module.css`). El botón de continuar usa el mismo estilo que
 * la vista `continue` — la portada no define `continueLabel` propio (no
 * existe en `IntroNodeSchema`), así que usa siempre `DEFAULT_CONTINUE_LABEL`.
 *
 * Fondo/tipografía/colores FIJOS de marca, independientes del tema
 * claro/oscuro de la app (`.introCard` en `PlayerScreen.module.css` usa
 * colores propios en vez de los tokens `--bs-color-*`): es una portada de
 * marca, no una superficie más de la interfaz de edición.
 *
 * Ningún campo es obligatorio para pintar esta vista (el proyecto puede
 * "probarse" incompleto antes de exportar, ver `validateIntroForExport`):
 * a diferencia del resto de vistas del Player (donde "vacío" se omite sin
 * más), aquí cada pieza que falte (ciclo/asignatura sin elegir, `caseName`
 * vacío) se sustituye por un placeholder gris — decisión de producto
 * explícita para esta portada, ver `INTRO_CICLO_PLACEHOLDER` y compañía.
 * Traducción literal en `buildIntroCard` de
 * `src/export/exportedPlayerScript.ts`.
 */
function IntroCard({ node, onContinue }: { node: IntroNode; onContinue: () => void }) {
  const { cicloName, asignaturaName } = resolveIntroNames(node)
  const caseName = node.caseName.trim()

  return (
    <div className={styles.introCard}>
      <div className={styles.introContent}>
        <img className={styles.introLogo} src={ilernaLogoUrl} alt="iLERNA" />
        <div className={styles.introHeadingGroup}>
          <h1 className={styles.introHeading}>{INTRO_HEADING}</h1>
          <p className={styles.introSubtitle}>
            {INTRO_SUBTITLE_PREFIX}
            <span className={styles.introSubtitleAccent}>{INTRO_SUBTITLE_ACCENT}</span>
            {INTRO_SUBTITLE_SUFFIX}
          </p>
        </div>
        <div className={styles.introFooter}>
          <p className={caseName ? styles.introCaseTitle : styles.introCaseTitlePlaceholder}>
            {caseName || INTRO_CASE_NAME_PLACEHOLDER}
          </p>
          <button type="button" className={styles.introButton} onClick={onContinue}>
            {DEFAULT_CONTINUE_LABEL}
          </button>
        </div>
        {/* Ciclo/asignatura: contexto secundario, deliberadamente pequeño y
            apagado — va DEBAJO del botón (no encima, como en un primer
            borrador) para no competir en protagonismo con el titular fijo
            de marca ni con el título de la actividad. */}
        <div className={styles.introMeta}>
          <p className={cicloName ? styles.introMetaLine : styles.introMetaLinePlaceholder}>
            {cicloName || INTRO_CICLO_PLACEHOLDER}
          </p>
          <p className={asignaturaName ? styles.introMetaLine : styles.introMetaLinePlaceholder}>
            {asignaturaName || INTRO_ASIGNATURA_PLACEHOLDER}
          </p>
        </div>
      </div>
      <div className={styles.introIllustration} aria-hidden="true" />
    </div>
  )
}

export interface PlayerScreenProps {
  /**
   * Ruta absoluta del `.brunch` abierto. La necesita el Player para pedir
   * los assets (imagen/audio) adjuntos a los nodos/respuestas que va
   * mostrando (`assetRepository.getAsset`) — mismo prop-drilling ya
   * establecido para `filePath` en `Inspector`/`useAutosave`: es un detalle
   * de la sesión de edición, no del documento, así que no vive en
   * `useProjectStore`.
   */
  filePath: string
}

/**
 * Player / modo "Probar": vista de lectura sobre el mismo `ProjectDocument`
 * del store — nunca una copia — que reproduce el documento como lo vería
 * quien lo juega: una diapositiva sin respuestas con su botón de continuar,
 * una diapositiva con respuestas como opciones elegibles, un Final (con
 * botón "Volver a jugar"), o un aviso breve si el recorrido llega a un punto
 * sin continuación configurada. El recorrido empieza directamente en
 * `graph.startNodeId`: ya no hay ningún nodo "Inicio" invisible del que
 * saltar.
 *
 * El recorrido (qué nodo toca mostrar ahora, y la puntuación acumulada) vive
 * en un `useState` local, inicializado con `getInitialState` (runtime puro
 * de `./runtime`, sin ningún import de React). Deliberadamente no pasa por
 * `useProjectStore` ni por su historial de undo/redo: es una simulación
 * efímera de lectura, no parte del documento. Si el usuario sale y vuelve a
 * entrar al Player, empieza otra vez desde el principio — comportamiento
 * esperado, no un bug.
 *
 * "Probar desde aquí" (botón de `Topbar`): `previewStartNodeId`
 * (`ui.previewStartNodeId` del store, ver su comentario de diseño en
 * `store/types.ts`) es el nodo por el que debe arrancar ESTA sesión en vez
 * de `graph.startNodeId`, o `null` si se entró por el botón normal
 * "▶ Probar". Se pasa tal cual a `getInitialState`/`restart` (que resuelven
 * el fallback si el id no correspondiera a ningún nodo) tanto al arrancar
 * como en `handleRestart`: "Reiniciar experiencia"/"Volver a jugar" reinicia
 * al mismo punto en el que empezó esta sesión concreta, no al inicio real
 * del proyecto — sería sorprendente que "probar desde aquí" te devolviera a
 * `graph.startNodeId` al reiniciar.
 */
export function PlayerScreen({ filePath }: PlayerScreenProps) {
  const project = useProject()
  const setPreviewMode = useProjectStore((state) => state.setPreviewMode)
  const previewStartNodeId = usePreviewStartNodeId()
  const { assetRepository } = useAppServices()
  const [playerState, setPlayerState] = useState<PlayerState>(() =>
    getInitialState(project, previewStartNodeId ?? undefined),
  )
  const [exitMessageVisible, setExitMessageVisible] = useState(false)

  function handleExit() {
    setPreviewMode(false)
  }

  function handleRestart() {
    setPlayerState(getInitialState(project, previewStartNodeId ?? undefined))
  }

  /**
   * Botón "Salir" de la vista Final (no confundir con `handleExit`, que es
   * "Volver al editor" de la cabecera). `window.close()` solo cierra
   * pestañas/ventanas abiertas por script — la mayoría de navegadores lo
   * bloquean si no fue así (limitación conocida del navegador, no un bug de
   * aquí). Como no hay forma fiable de detectar el éxito en todos los
   * navegadores, siempre se muestra después el aviso de que ya se puede
   * cerrar la pestaña a mano, para cubrir el caso — muy probable — de que el
   * cierre automático no haya funcionado. Traducción literal en
   * `exportedPlayerScript.ts`, salvo por la llamada a `scormFinish()` previa:
   * aquí, dentro de la app, no hay ninguna integración SCORM de la que
   * depender.
   */
  function handleExitAttempt() {
    window.close()
    setExitMessageVisible(true)
  }

  const view = getView(project, playerState)

  return (
    <div className={styles.screen}>
      <header className={styles.bar}>
        <span className={styles.label}>Modo de prueba</span>
        <div className={styles.controls}>
          <button type="button" className={styles.secondaryButton} onClick={handleRestart}>
            ↺ Reiniciar experiencia
          </button>
          <button type="button" className={styles.secondaryButton} onClick={handleExit}>
            ← Volver al editor
          </button>
        </div>
      </header>

      <main className={styles.stage}>
        {view.kind === 'intro' && (
          <IntroCard
            key={view.node.id}
            node={view.node}
            onContinue={() => setPlayerState((current) => advance(project, current))}
          />
        )}

        {view.kind === 'continue' && (
          <div key={view.node.id} className={styles.card}>
            {/* Referencia interna del diseñador instruccional (nunca
                aparece en el HTML/SCORM exportado, ver
                `src/export/exportedPlayerScript.ts`): en gris claro para
                marcarlo como tal. */}
            {view.node.title.trim() && (
              <h1 className={styles.nodeReferenceTitle}>{view.node.title}</h1>
            )}
            <SlideContent
              node={view.node}
              filePath={filePath}
              assetRepository={assetRepository}
              emptyFallback="Esta diapositiva todavía no tiene contenido."
            />
            {/* Texto personalizable del botón de continuar; "Continuar" si la
                diapositiva no define uno propio (ver `continueLabel`). */}
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setPlayerState((current) => advance(project, current))}
            >
              {view.node.continueLabel?.trim() || DEFAULT_CONTINUE_LABEL}
            </button>
          </div>
        )}

        {view.kind === 'decision' && (
          <div key={view.node.id} className={styles.card}>
            {/* Misma referencia interna que en 'continue': gris claro. */}
            {view.node.title.trim() && (
              <h1 className={styles.nodeReferenceTitle}>{view.node.title}</h1>
            )}
            <SlideContent
              node={view.node}
              filePath={filePath}
              assetRepository={assetRepository}
              emptyFallback={null}
            />
            <div className={styles.options}>
              {sortByLetter(view.visibleResponses).map((response, index) => (
                <ResponseOption
                  key={response.id}
                  response={response}
                  index={index + 1}
                  disabled={!response.targetNodeId && !response.actsAsExit}
                  filePath={filePath}
                  assetRepository={assetRepository}
                  onChoose={() =>
                    // Milestone "+1 fallo con Game Over": una respuesta
                    // `actsAsExit` no navega a ningún nodo — se comporta
                    // igual que el botón "Salir" de la vista Final
                    // (`handleExitAttempt`), quedándose en esta misma
                    // diapositiva.
                    response.actsAsExit
                      ? handleExitAttempt()
                      : setPlayerState((current) => choose(project, current, response.id))
                  }
                />
              ))}
            </div>
            {/* Mismo aviso que la vista Final tras "Salir" (ver
                `handleExitAttempt`): una respuesta `actsAsExit` deja al
                jugador en esta misma diapositiva, así que el aviso se pinta
                aquí en vez de en una vista Final a la que nunca llega. */}
            {exitMessageVisible && (
              <p className={styles.exitMessage} role="status">
                Ya puedes cerrar esta pestaña.
              </p>
            )}
          </div>
        )}

        {view.kind === 'final' && (
          <div key={view.node.id} className={styles.card}>
            <h1 className={styles.title}>Fin de la experiencia</h1>
            {view.resolvedBody.trim() ? (
              <RichTextView body={view.resolvedBody} className={styles.body} />
            ) : (
              <p className={styles.body}>
                {view.node.title.trim() || 'Has llegado al final de esta experiencia.'}
              </p>
            )}
            {playerState.totalPoints !== null && (
              <p className={styles.points}>Puntuación final: {playerState.totalPoints} puntos</p>
            )}
            <div className={styles.finalActions}>
              {/* Volver a jugar: mismo efecto que "↺ Reiniciar experiencia" de
                  la cabecera, pero dentro de la propia tarjeta de Final, que
                  es donde el usuario está mirando al terminar el recorrido.
                  Mismo estilo/color de acento que "Continuar" (`.primaryButton`,
                  ver comentario de esa clase en `PlayerScreen.module.css`) —
                  antes era un botón de peligro (rojo) porque descartaba el
                  recorrido en curso, pero "volver a jugar" es una acción
                  habitual y esperada al terminar, no destructiva. */}
              <button type="button" className={styles.primaryButton} onClick={handleRestart}>
                Volver a jugar
              </button>
              {/* Salir: estilo neutro (no es la acción principal de esta
                  fila). Ver `handleExitAttempt`. */}
              <button type="button" className={styles.neutralButton} onClick={handleExitAttempt}>
                Salir
              </button>
            </div>
            {exitMessageVisible && (
              <p className={styles.exitMessage} role="status">
                Ya puedes cerrar esta pestaña.
              </p>
            )}
          </div>
        )}

        {view.kind === 'dead-end' && (
          <div className={styles.card}>
            <p className={styles.body}>
              Esta diapositiva todavía no tiene una continuación configurada. Vuelve al editor para
              conectarla con el resto de la experiencia.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
