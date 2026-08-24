import { useState } from 'react'
import type { FormEvent } from 'react'
import { createProject } from '../../domain'
import type { ProjectDocument } from '../../domain'
import { convertTweeToProject } from '../../import/twee'
import { useAppServices } from '../../app/AppServicesContext'
import { useProjectStore } from '../../store'
import logo from '../../assets/logo.png'
import styles from './HomeScreen.module.css'

export interface HomeScreenProps {
  /** Se llama con la ruta del archivo `.brunch` en cuanto queda listo (recién creado o recién abierto). */
  onProjectOpened: (path: string) => void
}

type Mode = 'idle' | 'naming' | 'twee-warnings'

/** Resultado pendiente de una importación `.twee` con avisos: a la espera de
 *  que el usuario confirme "Crear proyecto de todos modos" o cancele. */
interface PendingTweeImport {
  document: ProjectDocument
  warnings: string[]
}

/** Nombre de archivo sin ruta ni extensión `.twee`/`.tw`, para proponerlo
 *  como nombre de proyecto de partida cuando el archivo no tiene `StoryTitle`. */
function fileStemFromPath(path: string): string {
  const fileName = path.split(/[/\\]/).pop() ?? path
  return fileName.replace(/\.(twee|tw)$/i, '')
}

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
  const { repository, pickSaveProjectPath, pickOpenProjectPath, pickImportTweePath, textFileReader } =
    useAppServices()
  const loadProject = useProjectStore((state) => state.loadProject)

  const [mode, setMode] = useState<Mode>('idle')
  const [projectName, setProjectName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingTwee, setPendingTwee] = useState<PendingTweeImport | null>(null)

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const name = projectName.trim() || 'Sin título'
      const path = await pickSaveProjectPath(name)
      if (!path) {
        // Cancelado por el usuario: sin error visible, se mantiene el formulario.
        setBusy(false)
        return
      }
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

  /** Guarda en disco el `ProjectDocument` ya construido (por el flujo normal
   *  de "Nuevo proyecto" o por la importación de un `.twee`) y navega al
   *  editor. Cancelar el diálogo de guardado no muestra error: se mantiene
   *  la pantalla tal cual, mismo criterio que el resto de cancelaciones. */
  async function saveAndOpenProject(document: ProjectDocument) {
    try {
      const path = await pickSaveProjectPath(document.metadata.name)
      if (!path) {
        setBusy(false)
        return
      }
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

  async function handleImportTwee() {
    setError(null)
    setBusy(true)
    try {
      const path = await pickImportTweePath()
      if (!path) {
        // Cancelado por el usuario: sin error visible.
        setBusy(false)
        return
      }
      const source = await textFileReader.readTextFile(path)
      const { document, warnings } = convertTweeToProject(source, fileStemFromPath(path))
      if (warnings.length > 0) {
        setPendingTwee({ document, warnings })
        setMode('twee-warnings')
        setBusy(false)
        return
      }
      await saveAndOpenProject(document)
    } catch {
      setError(
        'No se ha podido importar ese archivo. Comprueba que es un archivo .twee válido, con al menos un pasaje reconocible.',
      )
      setBusy(false)
    }
  }

  async function handleConfirmTweeImport() {
    if (!pendingTwee) return
    setError(null)
    setBusy(true)
    await saveAndOpenProject(pendingTwee.document)
  }

  function handleCancelTweeImport() {
    setPendingTwee(null)
    setError(null)
    setMode('idle')
  }

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <img className={styles.logo} src={logo} alt="Brunch Studio" />
        <p className={styles.tagline}>
          Crea experiencias ramificadas de forma visual.
          <br />
          Diseña pantallas, decisiones y recorridos, y publica la experiencia lista para usar.
        </p>
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
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleImportTwee}
              disabled={busy}
            >
              Importar .twee
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

        {mode === 'twee-warnings' && pendingTwee && (
          <div className={styles.tweeWarnings}>
            <p className={styles.subtitle}>
              Se han detectado {pendingTwee.warnings.length}{' '}
              {pendingTwee.warnings.length === 1 ? 'aviso' : 'avisos'} al importar el archivo. Revísalos
              antes de continuar; podrás corregirlos luego en el editor.
            </p>
            <ul className={styles.warningsList}>
              {pendingTwee.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
            <div className={styles.namingActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleCancelTweeImport}
                disabled={busy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleConfirmTweeImport}
                disabled={busy}
              >
                Crear proyecto de todos modos
              </button>
            </div>
          </div>
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
