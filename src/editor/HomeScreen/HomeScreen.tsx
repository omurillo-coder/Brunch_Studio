import { useState } from 'react'
import type { FormEvent } from 'react'
import { createProject } from '../../domain'
import { useAppServices } from '../../app/AppServicesContext'
import { useProjectStore } from '../../store'
import logo from '../../assets/logo.png'
import styles from './HomeScreen.module.css'

export interface HomeScreenProps {
  /** Se llama con la ruta del archivo `.branch` en cuanto queda listo (recién creado o recién abierto). */
  onProjectOpened: (path: string) => void
}

type Mode = 'idle' | 'naming'

/**
 * Pantalla inicial: crear un proyecto nuevo o abrir uno existente.
 *
 * Decisión modal vs. inline: "Nuevo proyecto" se resuelve con una
 * expansión inline en la propia pantalla (campo de nombre + botón "Crear")
 * en vez de un modal. Es una pantalla dedicada sin más contenido alrededor
 * con el que competir por espacio, así que la sobrecarga visual de un
 * modal (overlay, foco atrapado, botón de cierre) no aporta nada aquí; la
 * expansión inline con "Cancelar" cubre el mismo caso con menos piezas.
 */
export function HomeScreen({ onProjectOpened }: HomeScreenProps) {
  const { repository, pickSaveProjectPath, pickOpenProjectPath } = useAppServices()
  const loadProject = useProjectStore((state) => state.loadProject)

  const [mode, setMode] = useState<Mode>('idle')
  const [projectName, setProjectName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const path = await pickSaveProjectPath()
      if (!path) {
        // Cancelado por el usuario: sin error visible, se mantiene el formulario.
        setBusy(false)
        return
      }
      const name = projectName.trim() || 'Sin título'
      const document = createProject(name)
      await repository.createProject(path, document)
      loadProject(document)
      onProjectOpened(path)
    } catch {
      setError(
        'No se ha podido crear el proyecto en la ubicación elegida. Prueba con otro nombre de archivo o otra carpeta.',
      )
      setBusy(false)
    }
  }

  async function handleOpen() {
    setError(null)
    setBusy(true)
    try {
      const path = await pickOpenProjectPath()
      if (!path) {
        // Cancelado por el usuario: sin error visible.
        setBusy(false)
        return
      }
      const document = await repository.openProject(path)
      loadProject(document)
      onProjectOpened(path)
    } catch {
      setError('No se ha podido abrir ese archivo. Comprueba que es un proyecto de Brunch Studio válido.')
      setBusy(false)
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <img className={styles.logo} src={logo} alt="Brunch Studio" />
        <p className={styles.subtitle}>Crea un proyecto nuevo o abre uno existente para empezar.</p>

        {mode === 'idle' && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setMode('naming')}
              disabled={busy}
            >
              Nuevo proyecto
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleOpen}
              disabled={busy}
            >
              Abrir proyecto
            </button>
          </div>
        )}

        {mode === 'naming' && (
          <form className={styles.namingForm} onSubmit={handleCreate}>
            <label className={styles.label} htmlFor="new-project-name">
              Nombre del proyecto
            </label>
            <input
              id="new-project-name"
              className={styles.input}
              type="text"
              autoFocus
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Mi escenario"
              disabled={busy}
            />
            <div className={styles.namingActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setMode('idle')}
                disabled={busy}
              >
                Cancelar
              </button>
              <button type="submit" className={styles.primaryButton} disabled={busy}>
                Crear
              </button>
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}

        <p className={styles.footer}>Herramienta propia de Content Factory - iLERNA</p>
      </div>
    </div>
  )
}
