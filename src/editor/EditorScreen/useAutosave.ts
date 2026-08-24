import { useEffect, useRef } from 'react'
import { useAppServices } from '../../app/AppServicesContext'
import { useProjectStore } from '../../store'
import { collectReferencedAssetIds } from '../../export/exportAssets'

/**
 * Retardo del debounce de autoguardado, en milisegundos.
 *
 * 700ms: lo bastante corto para que "Guardando…" no se perciba como una
 * espera larga y el documento quede escrito a disco enseguida tras dejar de
 * editar, y lo bastante largo para absorber una ráfaga de cambios en
 * caliente (p.ej. los múltiples frames de un arrastre de nodo, que mutan
 * `project.graph.nodes[].position` en cada frame) en una sola escritura en
 * vez de una por frame. Cae dentro del rango 600-800ms que sugiere el spec
 * de producto.
 */
export const AUTOSAVE_DEBOUNCE_MS = 700

/**
 * Autoguardado real de `project` en `filePath`, con debounce y guardado
 * forzado por `Ctrl+S`/`Cmd+S`.
 *
 * ---------------------------------------------------------------------------
 * Por qué vive aquí y cómo se usa
 * ---------------------------------------------------------------------------
 * Pensado para llamarse una única vez desde `EditorScreen`, en la parte de
 * su cuerpo que NO depende de `previewMode` (antes del `if` que sustituye el
 * shell de edición por `PlayerScreen`). Como `EditorScreen` nunca se
 * desmonta al conmutar Editor↔Player (solo cambia qué JSX devuelve), este
 * hook — y por tanto su listener de teclado y su temporizador de debounce —
 * sobrevive intacto a esa conmutación, tal y como exige el spec de esta
 * fase.
 *
 * ---------------------------------------------------------------------------
 * Cómo se ignora el cambio inicial de montaje/carga
 * ---------------------------------------------------------------------------
 * `saveStatus` vale `'idle'` únicamente justo tras el arranque "de fábrica"
 * del store o justo tras un `loadProject` (ver `createInitialState` y la
 * acción `loadProject`; ninguna otra acción del store escribe `'idle'`). En
 * ambos casos el documento en memoria YA coincide con el disco, así que no
 * hay nada que guardar todavía.
 *
 * Por eso, cada vez que este hook observa un cambio de `project` con
 * `saveStatus` todavía en `'idle'` (incluida la comprobación que hace al
 * montarse, para el caso — el habitual en la app real — de que el
 * `loadProject` ya ocurriera en `HomeScreen` antes de que `EditorScreen`
 * llegara a montarse), lo consume pasando `saveStatus` a `'saved'` sin
 * programar ningún guardado. A partir de ahí `saveStatus` ya no vuelve a
 * `'idle'` salvo que se llame a `loadProject` de nuevo, así que el primer
 * cambio *real* posterior siempre se distingue sin ambigüedad de ese evento
 * de carga, sin necesidad de tocar el store para añadir un campo nuevo solo
 * para esta comprobación.
 *
 * ---------------------------------------------------------------------------
 * Por qué el arrastre de un nodo no dispara un guardado por frame
 * ---------------------------------------------------------------------------
 * `updateNodeDragPosition` (fase 6) muta `project` en cada frame del
 * arrastre, así que la referencia de `project` cambia en cada frame. Cada
 * uno de esos cambios reinicia el temporizador de debounce (`scheduleSave`
 * cancela cualquier temporizador pendiente antes de programar uno nuevo), así
 * que mientras el arrastre siga en marcha nunca llega a cumplirse el plazo
 * completo sin cambios — solo se escribe a disco una vez, tras el primer
 * respiro de `AUTOSAVE_DEBOUNCE_MS` sin más cambios (normalmente al soltar
 * el nodo). No hace falta ninguna lógica especial para "detectar un drag":
 * el propio debounce ya basta.
 *
 * ---------------------------------------------------------------------------
 * Guardado forzado (`Ctrl+S`/`Cmd+S`)
 * ---------------------------------------------------------------------------
 * Cancela cualquier temporizador de debounce pendiente y escribe de
 * inmediato con el `project` más reciente del store. Deliberadamente sin la
 * comprobación de "campo de texto enfocado" que sí aplica el atajo de
 * deshacer/rehacer de `Topbar`: guardar no interfiere con la edición de
 * texto del navegador (no inserta ningún carácter), así que debe funcionar
 * siempre, estés donde estés.
 *
 * ---------------------------------------------------------------------------
 * Comportamiento honesto ante un fallo de guardado
 * ---------------------------------------------------------------------------
 * Si `repository.saveProject` rechaza, se captura el error, se marca
 * `saveStatus: 'error'` (ver la ampliación de `SaveStatus` en
 * `store/types.ts`) y no se relanza: un fallo de guardado no debe tirar la
 * aplicación abajo. No se reintenta automáticamente con un temporizador
 * propio — el siguiente cambio real del documento (o una pulsación manual
 * de `Ctrl+S`) vuelve a intentarlo con normalidad, que es un comportamiento
 * simple y predecible sin añadir un mecanismo de reintento con backoff que
 * el spec no pide.
 *
 * ---------------------------------------------------------------------------
 * Frescura del documento guardado
 * ---------------------------------------------------------------------------
 * Tanto el guardado programado como el forzado leen `project` en el
 * instante de escribir (`useProjectStore.getState().project`), nunca el que
 * hubiera en una clausura capturada cuando se programó el temporizador —
 * así un guardado disparado varios cientos de ms después de programarse
 * siempre escribe el estado más reciente, no uno obsoleto.
 *
 * ---------------------------------------------------------------------------
 * Recolección de basura de assets huérfanos
 * ---------------------------------------------------------------------------
 * Justo después de que un guardado (programado o forzado) escriba con éxito,
 * se recorre el documento recién guardado (`collectReferencedAssetIds`, el
 * mismo cálculo que usa la exportación para decidir qué assets embeber) y se
 * llama a `assetRepository.gcOrphanAssets` con esa lista de ids "a
 * conservar": borra de la tabla `assets` cualquier fila que ya no referencie
 * ningún nodo/respuesta (imagen o audio quitado, reemplazado, o el nodo que
 * lo tenía borrado). Se hace en cada guardado exitoso, sin acumular ni
 * debounce propio — la tabla de assets de un editor como este es pequeña,
 * no hace falta optimizar para no repetirlo.
 *
 * Deliberadamente tolerante a fallos: un error de la recolección de basura
 * se registra con `console.error` y no cambia `saveStatus` ni se relanza —
 * el guardado del documento en sí ya se completó con éxito y no debe
 * quedar marcado como fallido por culpa de una limpieza secundaria.
 */
export function useAutosave(filePath: string): void {
  const { repository, assetRepository } = useAppServices()

  // Referencias siempre-frescas para que el listener de teclado y el
  // callback del `setTimeout` (creados una sola vez, ver el `useEffect` con
  // dependencias `[]` más abajo) nunca lean una `repository`/`filePath`
  // obsoletos capturados en un cierre antiguo, sin tener que reinstalar el
  // listener o recrear el temporizador cada vez que cambie de identidad.
  // Se escriben en un `useEffect` propio (no durante el render) para no
  // mutar un ref en fase de render.
  const repositoryRef = useRef(repository)
  const assetRepositoryRef = useRef(assetRepository)
  const filePathRef = useRef(filePath)
  useEffect(() => {
    repositoryRef.current = repository
    assetRepositoryRef.current = assetRepository
    filePathRef.current = filePath
  }, [repository, assetRepository, filePath])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    function clearPendingTimer() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    async function flushSave() {
      clearPendingTimer()
      const project = useProjectStore.getState().project
      useProjectStore.setState({ saveStatus: 'saving' })
      try {
        await repositoryRef.current.saveProject(filePathRef.current, project)
        useProjectStore.setState({ saveStatus: 'saved' })
      } catch {
        useProjectStore.setState({ saveStatus: 'error' })
        return
      }

      // Recolección de basura de assets huérfanos (ver comentario de diseño
      // arriba): solo tras un guardado con éxito, y sin que un fallo aquí
      // afecte a `saveStatus` ni se propague.
      try {
        const keepAssetIds = collectReferencedAssetIds(project)
        await assetRepositoryRef.current.gcOrphanAssets(filePathRef.current, keepAssetIds)
      } catch (error) {
        console.error('No se han podido recolectar los assets huérfanos del proyecto.', error)
      }
    }

    function scheduleSave() {
      clearPendingTimer()
      useProjectStore.setState({ saveStatus: 'saving' })
      timer = setTimeout(() => {
        void flushSave()
      }, AUTOSAVE_DEBOUNCE_MS)
    }

    /** Consume un `saveStatus: 'idle'` (ver comentario de diseño arriba). */
    function consumeIdleIfNeeded(): boolean {
      if (useProjectStore.getState().saveStatus !== 'idle') return false
      useProjectStore.setState({ saveStatus: 'saved' })
      return true
    }

    // Cubre el caso habitual: `loadProject` ya ocurrió (en `HomeScreen`)
    // antes de que este efecto llegara a ejecutarse.
    consumeIdleIfNeeded()

    const unsubscribe = useProjectStore.subscribe((state, previousState) => {
      if (state.project === previousState.project) return
      if (consumeIdleIfNeeded()) return
      scheduleSave()
    })

    function handleKeyDown(event: KeyboardEvent) {
      const modifier = event.metaKey || event.ctrlKey
      if (!modifier) return
      if (event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void flushSave()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      clearPendingTimer()
      unsubscribe()
      window.removeEventListener('keydown', handleKeyDown)
    }
    // Deliberadamente sin `repository` como dependencia (ver `repositoryRef`
    // arriba): reinstalar el listener/temporizador cada vez que la
    // instancia de `AppServices` cambiara de identidad no aporta nada y
    // solo arriesgaría perder un temporizador en marcha a mitad de un ciclo
    // de debounce.
  }, [])
}
