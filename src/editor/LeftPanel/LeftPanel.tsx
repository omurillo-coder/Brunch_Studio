import { useMemo, useState } from 'react'
import { useProject, useProjectStore, useSelectedNodeIds, useViewportCenter } from '../../store'
import { CICLOS } from '../../domain'
import type { Node, NodePosition, NodeType } from '../../domain'
import { NODE_TYPE_LABEL, START_NODE_LABEL } from '../Canvas/nodes/nodeTypes'
import { extractPlainText, parseRichBody } from '../richText/richTextContent'
import styles from './LeftPanel.module.css'

/**
 * Tipos "normales" que se pueden crear desde este panel, sin límite de
 * cantidad. Ya no hay un botón de "Decisión" separado — una Diapositiva nace
 * en modo "de continuar" y se convierte en decisión al añadirle respuestas
 * desde el Inspector.
 *
 * El botón "+ Inicio" (nodo `intro`, milestone "Diapositiva de Inicio") NO
 * vive en esta lista: a diferencia de `slide`/`final`, solo puede existir
 * COMO MUCHO UNO por proyecto (ver `IntroNodeSchema`), así que se pinta
 * aparte con su propia lógica de deshabilitado — ver `handleCreate`/JSX más
 * abajo.
 */
const CREATABLE_TYPES: NodeType[] = ['slide', 'final']

/**
 * Heurística de posición de RESPALDO para nodos creados desde este panel,
 * usada únicamente mientras `Canvas` todavía no ha publicado ningún centro
 * visible (`ui.viewportCenter`, ver store) — no debería ocurrir en la app
 * real (`Canvas` siempre está montado junto a este panel), pero cubre el
 * instante antes de su primer cálculo y cualquier test que renderice
 * `LeftPanel` sin `Canvas`. Cascadeo en una cuadrícula de 5 columnas, origen
 * en (80, 80), separación de 220px en horizontal y 160px en vertical: no
 * pretende ser un layout definitivo, solo evitar que los nodos nuevos se
 * apilen exactamente unos sobre otros.
 */
function nextCascadePosition(existingNodeCount: number): NodePosition {
  const columns = 5
  const column = existingNodeCount % columns
  const row = Math.floor(existingNodeCount / columns)
  return { x: 80 + column * 220, y: 80 + row * 160 }
}

/**
 * Buscador del proyecto (fase 8; generalizado en el milestone "Bloques de
 * contenido", fase 2): `query` ya normalizado (recortado, en minúsculas). Un
 * nodo aparece en la lista filtrada si el término buscado aparece, sin
 * distinguir mayúsculas/minúsculas, en su título, en el texto plano real de
 * CUALQUIERA de sus bloques de texto (`SlideNode.content`, tipo `text`) o del
 * único `body` de un Final, o en el texto de alguna de sus respuestas de
 * decisión.
 *
 * Un cuerpo de texto (`body` de un bloque de texto, o el `body` único de un
 * Final) es JSON de Tiptap serializado, NUNCA se compara como substring
 * directo: eso encontraría falsos positivos en la propia sintaxis JSON
 * (p.ej. buscar "type" "encontraría" cualquier nodo, por la clave
 * `"type":"doc"`). Se parsea con `parseRichBody` (la misma función que usa
 * `RichTextEditor`/la exportación) y se extrae su texto real con
 * `extractPlainText`, compartida con `src/editor/richText/richTextContent.ts`.
 *
 * Antes de esta fase una diapositiva tenía un único `body`; ahora puede tener
 * varios bloques de texto intercalados con imagen/audio (`SlideNode.content`)
 * — se comprueba cada uno de los bloques `type: 'text'`, en cualquier orden,
 * no solo el primero.
 *
 * Milestone "Diapositiva de Inicio": un nodo `intro` no tiene título de la
 * misma forma "narrativa" que el resto (su `title` es solo la "Referencia"
 * interna, igual que cualquier otro nodo, ya cubierta arriba), así que
 * además se comprueba su `caseName` y los NOMBRES de ciclo/asignatura
 * elegidos — nunca sus ids (`cicloId`/`asignaturaId` son slugs/códigos
 * internos, no texto que el usuario reconocería al buscar) — resueltos
 * contra el catálogo `CICLOS`.
 */
function nodeMatchesQuery(node: Node, query: string): boolean {
  if (node.title.toLowerCase().includes(query)) {
    return true
  }
  if (node.type === 'intro') {
    if (node.caseName.toLowerCase().includes(query)) {
      return true
    }
    const ciclo = node.cicloId ? CICLOS.find((candidate) => candidate.id === node.cicloId) : undefined
    if (ciclo && ciclo.name.toLowerCase().includes(query)) {
      return true
    }
    const asignatura =
      ciclo && node.asignaturaId
        ? ciclo.asignaturas.find((candidate) => candidate.id === node.asignaturaId)
        : undefined
    return asignatura ? asignatura.name.toLowerCase().includes(query) : false
  }
  if (node.type === 'final') {
    if (extractPlainText(parseRichBody(node.body)).toLowerCase().includes(query)) {
      return true
    }
    return false
  }
  const matchesTextBlock = node.content.some(
    (block) =>
      block.type === 'text' && extractPlainText(parseRichBody(block.body)).toLowerCase().includes(query),
  )
  if (matchesTextBlock) {
    return true
  }
  return node.responses.some((response) => response.text.toLowerCase().includes(query))
}

/** Panel izquierdo: buscar/filtrar, crear nodos y navegar la lista de nodos
 *  existentes. */
export function LeftPanel() {
  const project = useProject()
  const createNode = useProjectStore((state) => state.createNode)
  const selectNode = useProjectStore((state) => state.selectNode)
  const focusNode = useProjectStore((state) => state.focusNode)
  const reorderNode = useProjectStore((state) => state.reorderNode)
  const viewportCenter = useViewportCenter()
  // Sistema de guiaje: qué diapositiva está seleccionada ahora mismo, para
  // iluminarla en la lista (mismo criterio que el lienzo, que ya resalta la
  // tarjeta seleccionada con `.selected` de `@xyflow/react`).
  const selectedNodeIds = useSelectedNodeIds()

  const [searchQuery, setSearchQuery] = useState('')
  const normalizedQuery = searchQuery.trim().toLowerCase()
  // Reordenar (↑/↓, ver `reorderNode` en `src/domain/nodeOrder.ts`) opera
  // sobre el índice REAL dentro de `project.graph.nodes`, mientras que con un
  // buscador activo `visibleNodes` es un SUBCONJUNTO filtrado: "subir/bajar"
  // dentro de esa vista parcial sería ambiguo respecto a la posición real en
  // el array completo (¿un puesto en la lista filtrada, o hasta el hueco
  // entre los dos nodos ocultos más cercanos?). Se opta por deshabilitar los
  // controles mientras el buscador tiene texto, en vez de intentar resolver
  // esa ambigüedad — se reactivan en cuanto se borra la búsqueda, momento en
  // el que `visibleNodes` vuelve a ser exactamente `project.graph.nodes` y el
  // índice de la lista vuelve a coincidir con el índice real.
  const isSearching = normalizedQuery !== ''

  // Botón "+ Inicio" (Tarea 1, milestone "Diapositiva de Inicio"): existe
  // siempre por consistencia visual con los otros dos botones y como red de
  // seguridad para un documento que, por lo que sea, no tuviera todavía su
  // portada (`createProject` de bajo nivel no la siembra; las plantillas de
  // `HomeScreen` sí, así que en la práctica este botón casi siempre estará
  // deshabilitado) — pero se deshabilita en cuanto el proyecto YA tiene un
  // nodo `intro`, que el propio dominio (`createNode`) rechazaría crear dos
  // veces de todos modos.
  const hasIntro = project.graph.nodes.some((node) => node.type === 'intro')

  // Filtra la lista ya existente; no toca `focusNode`/selección, así que
  // hacer clic en un resultado filtrado centra el lienzo exactamente igual
  // que ya hacía antes de este buscador.
  const visibleNodes = useMemo(() => {
    if (!normalizedQuery) {
      return project.graph.nodes
    }
    return project.graph.nodes.filter((node) => nodeMatchesQuery(node, normalizedQuery))
  }, [project.graph.nodes, normalizedQuery])

  function handleCreate(type: NodeType) {
    // Tarea 4: la diapositiva nueva nace centrada en la parte visible del
    // lienzo (`ui.viewportCenter`, publicado por `Canvas`), en vez de en una
    // posición fija o en cascada — con la cascada como respaldo si ese
    // centro todavía no se ha calculado (ver `nextCascadePosition`).
    const position = viewportCenter ?? nextCascadePosition(project.graph.nodes.length)
    createNode(type, position)

    // `createNode` no devuelve el nodo creado; como los números visibles
    // son estrictamente crecientes y nunca se reciclan (ver
    // `domain/id.ts`), el nodo recién creado es siempre el de mayor
    // `number` justo después de crearlo.
    const nodes = useProjectStore.getState().project.graph.nodes
    const created = nodes.reduce((max, node) => (node.number > max.number ? node : max))
    selectNode(created.id)
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.addSection}>
        <button
          type="button"
          className={styles.addButton}
          onClick={() => handleCreate('intro')}
          disabled={hasIntro}
          title={hasIntro ? 'Ya existe la diapositiva de Inicio' : undefined}
        >
          + {NODE_TYPE_LABEL.intro}
        </button>
        {CREATABLE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={styles.addButton}
            onClick={() => handleCreate(type)}
          >
            + {NODE_TYPE_LABEL[type]}
          </button>
        ))}
      </div>

      <div className={styles.searchSection}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Buscar en el proyecto…"
          aria-label="Buscar en el proyecto"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>

      <ul className={styles.nodeList}>
        {visibleNodes.map((node, index) => (
          <li key={node.id} className={styles.nodeRow}>
            {/* `focusNode` selecciona el nodo (igual que `selectNode`) y
                además pide al lienzo que centre la vista en él, sin que
                este componente conozca `@xyflow/react` — ver
                `ui.focusRequestNodeId` en `src/store`. Reutilizado tal cual
                sobre la lista ya filtrada por el buscador. */}
            <button
              type="button"
              className={
                selectedNodeIds.includes(node.id)
                  ? `${styles.nodeItem} ${styles.nodeItemSelected}`
                  : styles.nodeItem
              }
              aria-current={selectedNodeIds.includes(node.id) ? 'true' : undefined}
              onClick={() => focusNode(node.id)}
            >
              <span className={styles.nodeType}>{NODE_TYPE_LABEL[node.type]}</span>
              {/* Marca discreta del punto de partida del recorrido. Mismo
                  criterio (y misma etiqueta) que en la tarjeta del lienzo:
                  el inicio ya no es siempre un nodo aparte (documentos sin
                  `intro` todavía), así que hay que poder distinguirlo de un
                  vistazo entre las demás diapositivas. Se omite para un nodo
                  `intro` (siempre es `startNodeId` cuando existe, ver
                  `IntroNodeSchema`): su propia etiqueta de tipo ya dice
                  "Inicio", repetirlo sería redundante — mismo criterio que
                  `Header` en `nodeTypes.tsx`. */}
              {node.id === project.graph.startNodeId && node.type !== 'intro' && (
                <span className={styles.nodeStartMark} title="Diapositiva de inicio">
                  {START_NODE_LABEL}
                </span>
              )}
              <span className={styles.nodeNumber}>{node.number}</span>
              {/* "Referencia" es la etiqueta de UI del campo `title` de
                  dominio (ver el `<label>` del Inspector) — el nombre del
                  campo no cambia, solo el texto que ve el usuario. */}
              <span className={styles.nodeTitle}>{node.title.trim() || 'Sin referencia'}</span>
            </button>
            {/* Reordenar (puramente organizativo, ver `reorderNode` en
                `src/domain/nodeOrder.ts`): botones fuera del `<button>` de
                arriba (un `<button>` dentro de otro `<button>` es HTML
                inválido), deshabilitados en los extremos de la lista real y,
                los dos a la vez, mientras el buscador tiene texto — ver
                `isSearching` más arriba. */}
            <div className={styles.reorderControls}>
              <button
                type="button"
                className={styles.reorderButton}
                onClick={(event) => {
                  event.stopPropagation()
                  reorderNode(node.id, index - 1)
                }}
                disabled={isSearching || index === 0}
                aria-label={`Subir "${node.title.trim() || 'Sin referencia'}"`}
                title={isSearching ? 'Borra la búsqueda para reordenar' : undefined}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.reorderButton}
                onClick={(event) => {
                  event.stopPropagation()
                  reorderNode(node.id, index + 1)
                }}
                disabled={isSearching || index === visibleNodes.length - 1}
                aria-label={`Bajar "${node.title.trim() || 'Sin referencia'}"`}
                title={isSearching ? 'Borra la búsqueda para reordenar' : undefined}
              >
                ↓
              </button>
            </div>
          </li>
        ))}
        {normalizedQuery && visibleNodes.length === 0 && (
          <li className={styles.noResults}>Sin resultados para "{searchQuery.trim()}"</li>
        )}
      </ul>
    </aside>
  )
}
