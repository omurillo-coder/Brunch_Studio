import { createInitialState, useProjectStore } from './useProjectStore'

/**
 * Reinicia `useProjectStore` a un estado "de fábrica" limpio (proyecto
 * nuevo, historial vacío, selección/UI por defecto).
 *
 * Pensado únicamente para tests: llamar en un `beforeEach` para que cada
 * test arranque de un store limpio sin tener que recrear el store entero
 * (Zustand no ofrece un "reset" de fábrica, y crear un store nuevo por test
 * obligaría a los tests a importar una instancia distinta de la que usa el
 * resto de la app).
 *
 * Usa `setState` en modo *merge* (por defecto, sin pasar `true` como
 * segundo argumento): un modo *replace* sustituiría el objeto de estado
 * completo, y como las acciones viven en ese mismo objeto, se perderían.
 */
export function resetProjectStore(): void {
  useProjectStore.setState(createInitialState())
}

/**
 * Encadena TODOS los nodos existentes del proyecto (empezando por la
 * diapositiva de inicio actual, en el orden en que aparecen en
 * `graph.nodes` para el resto) hasta un Final recién creado — el mínimo
 * necesario para que `validateGraphForExport` (`src/domain/validation.ts`)
 * no bloquee la exportación de un proyecto de prueba: `createProject`
 * (`resetProjectStore`/`createInitialState`) siembra una única diapositiva
 * de inicio "de continuar" SIN destino y SIN ningún Final en absoluto, así
 * que un `useHtmlExport`/`useScormExport`/`useTeacherReviewExport` (o
 * `Topbar.test.tsx`, que los ejercita a través de la UI) que solo complete
 * la portada (`seedCompleteIntro`, duplicada en esos test files) seguiría
 * bloqueado por el grafo, no por la portada.
 *
 * Encadenar TODOS los nodos (no solo conectar `startNodeId` directamente al
 * Final) importa en cuanto hay más de uno: `seedCompleteIntro` añade un
 * nodo `intro` que PASA A SER el nuevo inicio (ver `IntroNodeSchema`), pero
 * la diapositiva "de fábrica" original sigue existiendo — conectar solo
 * inicio->Final la habría dejado huérfana (`UNREACHABLE_NODE`) en vez de
 * alcanzable. Asume que ningún nodo de la cadena tiene ya respuestas
 * propias (cierto en el estado "de fábrica"/recién sembrado de estos
 * tests): `store.connect(origen, destino)` sin `responseId` fija el
 * destino "de continuar" tanto de una `slide` como de un `intro`.
 *
 * Pensada para llamarse ANTES de montar el componente/hook bajo prueba
 * (mismo momento que `resetProjectStore`/`seedCompleteIntro` en esos
 * mismos ficheros) — por eso, igual que `resetProjectStore`, no envuelve
 * las llamadas al store en `act()`: no hay ningún componente suscrito
 * todavía que pueda quejarse de una actualización fuera de `act`.
 */
export function seedReachableFinal(): void {
  const store = useProjectStore.getState()
  const startNodeId = store.project.graph.startNodeId
  const chain = [
    startNodeId,
    ...store.project.graph.nodes.map((node) => node.id).filter((id) => id !== startNodeId),
  ]

  store.createNode('final', { x: 400, y: 0 })
  const finalId = useProjectStore
    .getState()
    .project.graph.nodes.find((node) => node.type === 'final')?.id
  if (!finalId) throw new Error('seedReachableFinal: no se creó ningún nodo "final"')

  const fullChain = [...chain, finalId]
  for (let i = 0; i < fullChain.length - 1; i += 1) {
    store.connect(fullChain[i]!, fullChain[i + 1]!)
  }
}
