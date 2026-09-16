import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { DEFAULT_PROJECT_TEMPLATE_ID, PROJECT_TEMPLATES, getProjectTemplate } from '../../domain'
import type { ProjectDocument } from '../../domain'
import { convertTweeToProject } from '../../import/twee'
import { useAppServices } from '../../app/AppServicesContext'
import { openExistingProject } from '../../app/openExistingProject'
import { showAlreadyOpenElsewhereWarningIfApplicable } from '../../app/alreadyOpenElsewhereWarning'
import {
  loadRecentProjects,
  recordRecentProject,
  removeRecentProject,
} from '../../app/recentProjects'
import type { RecentProjectEntry } from '../../app/recentProjects'
import { useProjectStore } from '../../store'
import logo from '../../assets/logo.png'
import styles from './HomeScreen.module.css'

export interface HomeScreenProps {
  /** Se llama con la ruta del archivo `.brunch` en cuanto queda listo (recién creado o recién abierto). */
  onProjectOpened: (path: string) => void
  /**
   * Error a mostrar nada más montar, con el mismo `role="alert"` que
   * cualquier otro error de esta pantalla — lo usa `AppShell` (`src/App.tsx`)
   * cuando falla la apertura de la ruta `.brunch` inicial (recibida del
   * sistema operativo o de Rust, ver `getInitialOpenPath` en `AppServices`)
   * antes de volver a mostrar esta pantalla. `null`/`undefined` (el caso
   * normal) no muestra nada.
   */
  initialError?: string | null
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
export function HomeScreen({ onProjectOpened, initialError }: HomeScreenProps) {
  const { repository, pickSaveProjectPath, pickOpenProjectPath, pickImportTweePath, textFileReader } =
    useAppServices()
  const loadProject = useProjectStore((state) => state.loadProject)

  const [mode, setMode] = useState<Mode>('idle')
  const [projectName, setProjectName] = useState('')
  const [templateId, setTemplateId] = useState(DEFAULT_PROJECT_TEMPLATE_ID)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingTwee, setPendingTwee] = useState<PendingTweeImport | null>(null)
  // Leído UNA vez al montar (valor inicial de `useState`, no en cada
  // render): "Recientes" no necesita reaccionar a cambios de otra pestaña/
  // ventana mientras esta pantalla está montada, y esta pantalla se
  // desmonta/remonta entera al volver aquí desde el editor (`App.tsx`
  // cambia `openProjectPath` a `null`), así que sí se refresca en cuanto
  // vuelve a verse.
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>(loadRecentProjects)

  // `initialError` llega, si llega, un instante después del primer render
  // (viene de un intento de apertura asíncrono en `AppShell`, ver
  // `App.tsx`): no hay ningún evento de UI de esta pantalla al que "colgar"
  // ese error (ocurre antes de que el usuario toque nada aquí), así que un
  // efecto que lo copie al estado local en cuanto cambie es la herramienta
  // correcta pese al aviso de la regla — no un valor derivable en el
  // render, porque a partir de ahí el error debe poder limpiarse/sustituirse
  // con las acciones normales de esta pantalla (`setError(null)` en
  // `handleOpen`, etc.) sin que `initialError` (que no vuelve a cambiar) lo
  // resucite.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (initialError) setError(initialError)
  }, [initialError])

  /** Corrección de revisión de código: antes duplicaba línea a línea el
   *  cuerpo de `saveAndOpenProject` (elegir ruta, crear, cargar, registrar
   *  en "Recientes", navegar), solo con el nombre calculado a mano en vez de
   *  leído de `document.metadata.name` — el mismo valor, ya que
   *  `getProjectTemplate(...).build(name)` lo fija a partir de ese mismo
   *  `name`. Construye el documento y delega el resto ahí. */
  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    const name = projectName.trim() || 'Sin título'
    const document = getProjectTemplate(templateId).build(name)
    await saveAndOpenProject(document)
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
      const document = await openExistingProject(repository, path)
      loadProject(document)
      onProjectOpened(path)
    } catch (error) {
      // Caso específico: el archivo ya está abierto en otra ventana (ver
      // `alreadyOpenElsewhereWarning.ts`). En ese caso no se navega a
      // `EditorScreen` ni se muestra el mensaje genérico de abajo — el
      // propio diálogo nativo ya deja claro qué ha pasado.
      if (!(await showAlreadyOpenElsewhereWarningIfApplicable(error))) {
        setError('No se ha podido abrir ese archivo. Comprueba que es un proyecto de Brunch Studio válido.')
      }
      setBusy(false)
    }
  }

  /** Abre directamente `entry.path` (ver "Recientes" más abajo), sin pasar
   *  por el diálogo nativo "Abrir proyecto" — mismo flujo que `handleOpen`
   *  a partir de tener ya la ruta. Al éxito, `entry` "sube" al principio del
   *  estado local `recentProjects` (mismo orden en el que
   *  `openExistingProject` ya la reordenó en `localStorage`) — sin este
   *  ajuste, la lista visible se quedaría con el orden antiguo si esta
   *  pantalla siguiera montada tras la apertura. Si falla (el archivo se
   *  movió/borró fuera de la app desde que se abrió por última vez, o
   *  cualquier otro motivo), además de avisar se quita esa entrada de la
   *  lista: no tiene sentido dejar un atajo que nunca va a funcionar. */
  async function handleOpenRecent(entry: RecentProjectEntry) {
    setError(null)
    setBusy(true)
    try {
      const document = await openExistingProject(repository, entry.path)
      loadProject(document)
      setRecentProjects((current) => [
        { ...entry, name: document.metadata.name, lastOpenedAt: new Date().toISOString() },
        ...current.filter((candidate) => candidate.path !== entry.path),
      ])
      onProjectOpened(entry.path)
    } catch (error) {
      if (!(await showAlreadyOpenElsewhereWarningIfApplicable(error))) {
        setError(
          `No se ha podido abrir "${entry.name}". Puede que el archivo se haya movido o eliminado.`,
        )
        removeRecentProject(entry.path)
        setRecentProjects((current) => current.filter((candidate) => candidate.path !== entry.path))
      }
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
      recordRecentProject(path, document.metadata.name)
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

        {/* "Recientes" (petición de usuario): solo se muestra con al menos
            una entrada — una sección "Recientes" vacía en la primera
            apertura de la app no aporta nada, solo ruido. Cada entrada abre
            directamente esa ruta (`handleOpenRecent`), sin pasar por el
            diálogo nativo "Abrir proyecto". */}
        {mode === 'idle' && recentProjects.length > 0 && (
          <div className={styles.recent}>
            <span className={styles.label}>Recientes</span>
            <ul className={styles.recentList}>
              {recentProjects.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className={styles.recentItem}
                    onClick={() => handleOpenRecent(entry)}
                    disabled={busy}
                    title={entry.path}
                  >
                    <span className={styles.recentItemName}>{entry.name}</span>
                    <span className={styles.recentItemPath}>{entry.path}</span>
                  </button>
                </li>
              ))}
            </ul>
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
            <fieldset className={styles.templateFieldset}>
              <legend className={styles.label}>Plantilla</legend>
              {PROJECT_TEMPLATES.map((template) => {
                const inputId = `project-template-${template.id}`
                return (
                  <div key={template.id} className={styles.templateOption}>
                    <label className={styles.templateOptionHeader} htmlFor={inputId}>
                      <input
                        id={inputId}
                        type="radio"
                        name="project-template"
                        value={template.id}
                        checked={templateId === template.id}
                        onChange={() => setTemplateId(template.id)}
                        disabled={busy}
                      />
                      <span className={styles.templateOptionName}>{template.name}</span>
                    </label>
                    <p className={styles.templateOptionDescription}>{template.description}</p>
                  </div>
                )
              })}
            </fieldset>
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
