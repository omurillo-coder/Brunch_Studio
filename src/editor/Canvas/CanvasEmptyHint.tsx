import { useProject } from '../../store'
import styles from './CanvasEmptyHint.module.css'

/**
 * Hallazgo de auditoría ("sin onboarding en un proyecto nuevo 'En blanco'"):
 * "En blanco" es la plantilla resaltada por defecto en "Nuevo proyecto", y
 * quien la elige llega a un lienzo casi vacío (un único nodo de Inicio, sin
 * ninguna pista de cómo añadir o conectar diapositivas — crear un nodo
 * depende de arrastrar una conexión desde el borde de una tarjeta hasta el
 * lienzo vacío, nada obvio la primera vez).
 *
 * Pista mínima y no bloqueante (ni modal, ni tutorial paso a paso — fuera
 * de alcance de este hallazgo, "baja prioridad, sin urgencia"): un proyecto
 * "En blanco" recién creado nace siempre con exactamente DOS nodos —
 * `createProject` siembra una diapositiva, y `seedIntroNode` añade encima
 * el nodo Inicio (ver `buildBlankTemplate` en `src/domain/templates.ts`) —
 * así que `project.graph.nodes.length <= 2` es la señal de "recién creado,
 * todavía no se ha tocado nada". En cuanto exista un tercer nodo (el
 * usuario ya ha completado el gesto de crear uno), desaparece sola, sin
 * que haga falta descartarla a mano.
 */
export function CanvasEmptyHint() {
  const project = useProject()
  if (project.graph.nodes.length > 2) return null

  return (
    <div className={styles.hint} role="note">
      <p>
        Arrastra desde el borde derecho de una tarjeta hasta un hueco vacío del lienzo para añadir
        una diapositiva, una decisión o un final.
      </p>
    </div>
  )
}
