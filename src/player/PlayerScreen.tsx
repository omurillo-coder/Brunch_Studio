import { useState } from 'react'
import { useProject, useProjectStore } from '../store'
import { RESPONSE_LETTERS } from '../domain'
import type { ContentNode, DecisionNode, DecisionResponse } from '../domain'
import { advance, choose, getInitialState, getView } from './runtime'
import type { PlayerState } from './runtime'
import { useAppServices } from '../app/AppServicesContext'
import { useAssetDataUri } from '../hooks/useAssetDataUri'
import type { AssetRepository } from '../persistence'
import { RichTextView } from '../editor/richText/RichTextView'
import styles from './PlayerScreen.module.css'

/** Mismo criterio de orden que `Inspector`: A→B→C→D fijo, independiente del
 *  orden interno de creación/borrado del array. */
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

/** Imagen/audio a nivel de nodo (Pantalla o Decisión), justo debajo del
 *  cuerpo de texto. `null` si el nodo no tiene ningún adjunto. */
function NodeMedia({
  node,
  filePath,
  assetRepository,
}: {
  node: ContentNode | DecisionNode
  filePath: string
  assetRepository: AssetRepository
}) {
  if (!node.imageAssetId && !node.audioAssetId) {
    return null
  }
  return (
    <div className={styles.mediaSection}>
      {node.imageAssetId && (
        <PlayerImage
          key={node.imageAssetId}
          assetId={node.imageAssetId}
          filePath={filePath}
          assetRepository={assetRepository}
          alt="Imagen de esta pantalla"
        />
      )}
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

/**
 * Una opción de Decisión: el botón de elegirla (letra + texto) más su
 * imagen/audio adjuntos, si tiene. La imagen/audio se colocan FUERA del
 * `<button>` (contenido interactivo, como los controles de `<audio>`, no
 * puede anidarse dentro de un elemento interactivo) para que reproducir el
 * audio de una opción no cuente como elegirla.
 */
function ResponseOption({
  response,
  disabled,
  filePath,
  assetRepository,
  onChoose,
}: {
  response: DecisionResponse
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
        <span className={styles.optionLetter}>{response.letter}</span>
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
              alt={`Imagen de la respuesta ${response.letter}`}
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
 * Player / modo "Probar" (fase 8, ampliado en la fase 5 del Milestone 2 con
 * texto enriquecido, imagen/audio y puntuación): vista de lectura sobre el
 * mismo `ProjectDocument` del store — nunca una copia — que reproduce el
 * documento como lo vería quien lo juega: Pantalla con botón Continuar,
 * Decisión con sus respuestas como opciones, Final, o un aviso breve si el
 * recorrido llega a un punto sin continuación configurada.
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
        {view.kind === 'content' && (
          <div key={view.node.id} className={styles.card}>
            {view.node.title.trim() && <h1 className={styles.title}>{view.node.title}</h1>}
            {view.node.body.trim() ? (
              <RichTextView body={view.node.body} className={styles.body} />
            ) : (
              <p className={styles.body}>Esta pantalla todavía no tiene contenido.</p>
            )}
            <NodeMedia node={view.node} filePath={filePath} assetRepository={assetRepository} />
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setPlayerState((current) => advance(project, current))}
            >
              Continuar
            </button>
          </div>
        )}

        {view.kind === 'decision' && (
          <div key={view.node.id} className={styles.card}>
            {view.node.title.trim() && <h1 className={styles.title}>{view.node.title}</h1>}
            {view.node.body.trim() && <RichTextView body={view.node.body} className={styles.body} />}
            <NodeMedia node={view.node} filePath={filePath} assetRepository={assetRepository} />
            <div className={styles.options}>
              {sortByLetter(view.node.responses).map((response) => (
                <ResponseOption
                  key={response.id}
                  response={response}
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
          </div>
        )}

        {view.kind === 'dead-end' && (
          <div className={styles.card}>
            <p className={styles.body}>
              Esta pantalla todavía no tiene una continuación configurada. Vuelve al editor para
              conectarla con el resto de la experiencia.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
