import { useState } from 'react'
import { useProject, useProjectStore } from '../store'
import { DEFAULT_CONTINUE_LABEL, RESPONSE_LETTERS } from '../domain'
import type { DecisionResponse, SlideNode } from '../domain'
import { advance, choose, getInitialState, getView } from './runtime'
import type { PlayerState } from './runtime'
import { useAppServices } from '../app/AppServicesContext'
import { useAssetDataUri } from '../hooks/useAssetDataUri'
import type { AssetRepository } from '../persistence'
import { RichTextView } from '../editor/richText/RichTextView'
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
 * Bloque de imágenes de un nodo: TODAS las de `imageAssetIds`, apiladas en
 * columna (una debajo de otra, a ancho completo) en el orden del array —
 * ese orden es justo lo que el Inspector permite reordenar con ↑/↓. Nunca un
 * carrusel ni una galería con interacción: es la decisión de diseño de esta
 * fase. Cada imagen se monta con `key={assetId}` para que un cambio de asset
 * concreto (añadida, reemplazada indirectamente al quitar/reañadir) arranque
 * su propia carga desde cero sin afectar a las demás.
 */
function NodeImages({
  imageAssetIds,
  filePath,
  assetRepository,
}: {
  imageAssetIds: string[]
  filePath: string
  assetRepository: AssetRepository
}) {
  if (imageAssetIds.length === 0) return null
  return (
    <>
      {imageAssetIds.map((assetId) => (
        <PlayerImage
          key={assetId}
          assetId={assetId}
          filePath={filePath}
          assetRepository={assetRepository}
          alt="Imagen de esta pantalla"
        />
      ))}
    </>
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

/** Imágenes (apiladas, en orden) + audio a nivel de nodo (Diapositiva).
 *  `null` si el nodo no tiene ningún adjunto. La posición de este bloque
 *  respecto al cuerpo de texto la decide quien llama, según
 *  `node.contentOrder` (ver `SlideBody`/las vistas `continue`/`decision` más
 *  abajo). */
function NodeMedia({
  node,
  filePath,
  assetRepository,
}: {
  node: SlideNode
  filePath: string
  assetRepository: AssetRepository
}) {
  if (node.imageAssetIds.length === 0 && !node.audioAssetId) {
    return null
  }
  return (
    <div className={styles.mediaSection}>
      <NodeImages
        imageAssetIds={node.imageAssetIds}
        filePath={filePath}
        assetRepository={assetRepository}
      />
      {node.audioAssetId && (
        <PlayerAudio
          key={node.audioAssetId}
          assetId={node.audioAssetId}
          filePath={filePath}
          assetRepository={assetRepository}
        />
      )}
    </div>
  )
}

/** Cuerpo de texto de una diapositiva (`continue`/`decision`), con el
 *  respaldo de siempre si está vacío. `emptyFallback` es `null` para "no
 *  pintar nada si no hay cuerpo" (vista `decision`, mismo criterio que ya
 *  aplicaba antes de esta sección). */
function SlideBody({ node, emptyFallback }: { node: SlideNode; emptyFallback: string | null }) {
  if (node.body.trim()) {
    return <RichTextView body={node.body} className={styles.body} />
  }
  if (emptyFallback === null) return null
  return <p className={styles.body}>{emptyFallback}</p>
}

/**
 * Cuerpo de texto + bloque de medios de una diapositiva `continue`/
 * `decision`, en el orden que indique `node.contentOrder` ('text-first', el
 * de siempre, o 'image-first'). Reutilizado por ambas vistas para no
 * duplicar la lógica de orden.
 */
function SlideBodyAndMedia({
  node,
  filePath,
  assetRepository,
  emptyBodyFallback,
}: {
  node: SlideNode
  filePath: string
  assetRepository: AssetRepository
  emptyBodyFallback: string | null
}) {
  const body = <SlideBody node={node} emptyFallback={emptyBodyFallback} />
  const media = <NodeMedia node={node} filePath={filePath} assetRepository={assetRepository} />

  if (node.contentOrder === 'image-first') {
    return (
      <>
        {media}
        {body}
      </>
    )
  }
  return (
    <>
      {body}
      {media}
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
 * botón "Reintentar"), o un aviso breve si el recorrido llega a un punto sin
 * continuación configurada. El recorrido empieza directamente en
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
 */
export function PlayerScreen({ filePath }: PlayerScreenProps) {
  const project = useProject()
  const setPreviewMode = useProjectStore((state) => state.setPreviewMode)
  const { assetRepository } = useAppServices()
  const [playerState, setPlayerState] = useState<PlayerState>(() => getInitialState(project))

  function handleExit() {
    setPreviewMode(false)
  }

  function handleRestart() {
    setPlayerState(getInitialState(project))
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
        {view.kind === 'continue' && (
          <div key={view.node.id} className={styles.card}>
            {/* Referencia interna del diseñador instruccional (nunca
                aparece en el HTML/SCORM exportado, ver
                `src/export/exportedPlayerScript.ts`): en gris claro para
                marcarlo como tal. */}
            {view.node.title.trim() && (
              <h1 className={styles.nodeReferenceTitle}>{view.node.title}</h1>
            )}
            <SlideBodyAndMedia
              node={view.node}
              filePath={filePath}
              assetRepository={assetRepository}
              emptyBodyFallback="Esta diapositiva todavía no tiene contenido."
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
            <SlideBodyAndMedia
              node={view.node}
              filePath={filePath}
              assetRepository={assetRepository}
              emptyBodyFallback={null}
            />
            <div className={styles.options}>
              {sortByLetter(view.visibleResponses).map((response, index) => (
                <ResponseOption
                  key={response.id}
                  response={response}
                  index={index + 1}
                  disabled={!response.targetNodeId}
                  filePath={filePath}
                  assetRepository={assetRepository}
                  onChoose={() =>
                    setPlayerState((current) => choose(project, current, response.id))
                  }
                />
              ))}
            </div>
          </div>
        )}

        {view.kind === 'final' && (
          <div key={view.node.id} className={styles.card}>
            <h1 className={styles.title}>Fin de la experiencia</h1>
            {view.node.body.trim() ? (
              <RichTextView body={view.node.body} className={styles.body} />
            ) : (
              <p className={styles.body}>
                {view.node.title.trim() || 'Has llegado al final de esta experiencia.'}
              </p>
            )}
            {playerState.totalPoints !== null && (
              <p className={styles.points}>Puntuación final: {playerState.totalPoints} puntos</p>
            )}
            {/* Reintentar: mismo efecto que "↺ Reiniciar experiencia" de la
                cabecera, pero dentro de la propia tarjeta de Final, que es
                donde el usuario está mirando al terminar el recorrido. En
                color de peligro porque descarta el recorrido en curso (y su
                puntuación) para empezar de cero. */}
            <button type="button" className={styles.dangerButton} onClick={handleRestart}>
              Reintentar
            </button>
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
