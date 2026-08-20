import { useState } from 'react'
import { useProject, useProjectStore } from '../store'
import { RESPONSE_LETTERS } from '../domain'
import type { DecisionResponse } from '../domain'
import { advance, choose, getInitialState, getView } from './runtime'
import type { PlayerState } from './runtime'
import styles from './PlayerScreen.module.css'

/** Mismo criterio de orden que `Inspector`: A→B→C→D fijo, independiente del
 *  orden interno de creación/borrado del array. */
function sortByLetter(responses: DecisionResponse[]): DecisionResponse[] {
  return [...responses].sort(
    (a, b) => RESPONSE_LETTERS.indexOf(a.letter) - RESPONSE_LETTERS.indexOf(b.letter),
  )
}

/**
 * Player / modo "Probar" (fase 8): vista de lectura sobre el mismo
 * `ProjectDocument` del store — nunca una copia — que reproduce el
 * documento como lo vería quien lo juega: Pantalla con botón Continuar,
 * Decisión con sus respuestas como opciones, Final, o un aviso breve si el
 * recorrido llega a un punto sin continuación configurada.
 *
 * El recorrido (qué nodo toca mostrar ahora) vive en un `useState` local,
 * inicializado con `getInitialState` (runtime puro de `./runtime`, sin
 * ningún import de React). Deliberadamente no pasa por `useProjectStore` ni
 * por su historial de undo/redo: es una simulación efímera de lectura, no
 * parte del documento. Si el usuario sale y vuelve a entrar al Player,
 * empieza otra vez desde el principio — comportamiento esperado, no un bug.
 */
export function PlayerScreen() {
  const project = useProject()
  const setPreviewMode = useProjectStore((state) => state.setPreviewMode)
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
          <div className={styles.card}>
            {view.node.title.trim() && <h1 className={styles.title}>{view.node.title}</h1>}
            <p className={styles.body}>
              {view.node.body.trim() || 'Esta pantalla todavía no tiene contenido.'}
            </p>
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
          <div className={styles.card}>
            {view.node.title.trim() && <h1 className={styles.title}>{view.node.title}</h1>}
            {view.node.body.trim() && <p className={styles.body}>{view.node.body}</p>}
            <div className={styles.options}>
              {sortByLetter(view.node.responses).map((response) => (
                <button
                  key={response.id}
                  type="button"
                  className={styles.optionButton}
                  disabled={!response.targetNodeId}
                  onClick={() => setPlayerState((current) => choose(project, current, response.id))}
                >
                  <span className={styles.optionLetter}>{response.letter}</span>
                  <span>{response.text.trim() || 'Opción sin texto configurado'}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {view.kind === 'final' && (
          <div className={styles.card}>
            <h1 className={styles.title}>Fin de la experiencia</h1>
            <p className={styles.body}>
              {view.node.body.trim() ||
                view.node.title.trim() ||
                'Has llegado al final de esta experiencia.'}
            </p>
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
