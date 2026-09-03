import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useProject, useProjectStore, usePreviewStartNodeId } from '../store'
import {
  CICLOS,
  cicloOutputName,
  DEFAULT_CONTINUE_LABEL,
  INTRO_ASIGNATURA_PLACEHOLDER,
  INTRO_CASE_NAME_PLACEHOLDER,
  INTRO_CICLO_PLACEHOLDER,
  INTRO_HEADING,
  INTRO_SUBTITLE_ACCENT,
  INTRO_SUBTITLE_PREFIX,
  INTRO_SUBTITLE_SUFFIX,
  RESPONSE_LETTERS,
} from '../domain'
import type {
  ContentBlock,
  DecisionResponse,
  ImageSize,
  IntroNode,
  ProjectDocument,
  SlideNode,
  VariableState,
} from '../domain'
import { advance, choose, getInitialState, getView } from './runtime'
import type { PlayerState } from './runtime'
import { useAppServices } from '../app/AppServicesContext'
import { useAssetDataUri } from '../hooks/useAssetDataUri'
import type { AssetRepository } from '../persistence'
import { RichTextView } from '../editor/richText/RichTextView'
import ilernaLogoUrl from '../assets/playerIntro/ilerna-logo.png'
import styles from './PlayerScreen.module.css'

/** Mismo criterio de orden que `Inspector`: por letra (A→B→C→D) fijo,
 *  independiente del orden interno de creación/borrado del array. La letra
 *  solo ordena: nunca se muestra al usuario. */
function sortByLetter(responses: DecisionResponse[]): DecisionResponse[] {
  return [...responses].sort(
    (a, b) => RESPONSE_LETTERS.indexOf(a.letter) - RESPONSE_LETTERS.indexOf(b.letter),
  )
}

/** Clase de tamaño de `.media` para una imagen (petición de usuario: "un
 *  desplegable... Pequeño/Normal/Grande") — `undefined`/`'normal'` usa el
 *  tamaño de siempre (`.mediaNormal`, sin cambio visual para cualquier
 *  imagen ya existente). */
function imageSizeClassName(size: ImageSize | undefined): string | undefined {
  if (size === 'small') return styles.mediaSmall
  if (size === 'large') return styles.mediaLarge
  return styles.mediaNormal
}

/**
 * Imagen adjunta (de nodo o de respuesta) mostrada como contenido real para
 * quien juega — no una miniatura de edición como en el Inspector, así que
 * usa su propia clase de tamaño (`styles.media` + `imageSizeClassName`). Se
 * monta con `key={assetId}` desde el llamador para que un cambio de asset
 * (nodo distinto, o mismo nodo con el asset reemplazado) arranque la carga
 * desde cero.
 *
 * Si la carga falla, no muestra nada (ni imagen ni mensaje de error): el
 * resto de la pantalla — texto, opciones, controles de navegación — debe
 * seguir funcionando con normalidad.
 *
 * Petición de usuario ("las imágenes... ampliables en la salida o en
 * probar"): si `onExpand` viene definido, la imagen se envuelve en un
 * `<button>` que la abre en `Lightbox` (más abajo) al pulsarla — quien
 * llama decide si pasarlo o no: `ContentBlockView` solo lo pasa cuando
 * `block.expandable !== false` (petición de usuario: "un botón... para
 * hacer no ampliable la imagen"); `ResponseOption` nunca lo pasa (la
 * imagen de una respuesta vive dentro de un `<button>` que ya elige esa
 * respuesta al pulsarla — un segundo botón anidado no es HTML válido, y
 * además "pulsar en cualquier parte del cuadro" ya cubre la imagen).
 */
function PlayerImage({
  assetId,
  filePath,
  assetRepository,
  alt,
  size,
  onExpand,
}: {
  assetId: string
  filePath: string
  assetRepository: AssetRepository
  alt: string
  size?: ImageSize
  onExpand?: (image: { dataUri: string; alt: string }) => void
}) {
  const { dataUri } = useAssetDataUri(filePath, assetId, assetRepository)
  if (!dataUri) return null
  const image = <img className={`${styles.media} ${imageSizeClassName(size)}`} src={dataUri} alt={alt} />
  if (!onExpand) return image
  return (
    <button
      type="button"
      className={styles.expandableImage}
      onClick={() => onExpand({ dataUri, alt })}
      aria-label={`Ampliar imagen: ${alt}`}
    >
      {image}
    </button>
  )
}

/**
 * Imagen ampliada a pantalla completa (petición de usuario) — se cierra al
 * pulsar el fondo, el botón "×", o la tecla Escape. `stopPropagation` en la
 * propia imagen: pulsarla a ella no debe cerrar el lightbox (solo pulsar
 * fuera de ella, sobre el fondo). Traducción literal en `buildLightbox` de
 * `src/export/exportedPlayerScript.ts`.
 */
function Lightbox({
  image,
  onClose,
}: {
  image: { dataUri: string; alt: string }
  onClose: () => void
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className={styles.lightboxBackdrop}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={image.alt}
    >
      <img
        className={styles.lightboxImage}
        src={image.dataUri}
        alt={image.alt}
        onClick={(event) => event.stopPropagation()}
      />
      <button
        type="button"
        className={styles.lightboxClose}
        onClick={onClose}
        aria-label="Cerrar imagen ampliada"
      >
        ×
      </button>
    </div>
  )
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

/** Vídeo adjunto de un bloque de `SlideNode.content` (cuarto tipo de bloque):
 *  mismo criterio de tamaño máximo ya usado para las imágenes (`styles.media`
 *  — ancho/alto máximo, sin desbordar ni distorsionar la tarjeta), con
 *  controles nativos de reproducción. Mismo criterio de fallo silencioso que
 *  `PlayerImage`/`PlayerAudio`. */
function PlayerVideo({
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
  return <video className={styles.media} controls src={dataUri} />
}

/**
 * Un bloque de `SlideNode.content`, pintado según su `type` (milestone
 * "Bloques de contenido"): texto vía `RichTextView`, imagen/audio/vídeo vía
 * `PlayerImage`/`PlayerAudio`/`PlayerVideo` — la misma resolución de asset
 * que antes se llamaba una vez por nodo, ahora generalizada a llamarse por
 * cada bloque de su tipo. Un bloque de texto vacío (sin escribir nada aún) no
 * pinta nada, mismo criterio de "vacío = nada" que el antiguo `body` único.
 *
 * `key`: el llamador (`SlideContent`) ya pone `key={block.id}` en cada
 * instancia de este componente para la identidad de lista; aquí, en el
 * elemento raíz que devuelve cada rama, se añade además `key={block.assetId}`
 * para imagen/audio/vídeo — mismo motivo que documenta
 * `PlayerImage`/`PlayerAudio`/`PlayerVideo` más abajo: si el asset de un
 * bloque cambiara, fuerza a React a montar una
 * instancia nueva en vez de reutilizar un `dataUri` que ya no corresponde.
 */
function ContentBlockView({
  block,
  filePath,
  assetRepository,
  onExpandImage,
}: {
  block: ContentBlock
  filePath: string
  assetRepository: AssetRepository
  onExpandImage: (image: { dataUri: string; alt: string }) => void
}) {
  switch (block.type) {
    case 'text':
      if (!block.body.trim()) return null
      return <RichTextView body={block.body} className={styles.body} />
    case 'image':
      // Imagen "pendiente de subir" (milestone "+1 fallo con Game Over",
      // `assetId` opcional): mismo criterio "vacío = nada" que un bloque de
      // texto sin escribir — el Player la omite sin más. Exportar SÍ la
      // bloquea (ver `validatePendingContentForExport`), así que en la
      // práctica esto solo se ve al "Probar" con contenido a medias.
      if (!block.assetId) return null
      return (
        <PlayerImage
          key={block.assetId}
          assetId={block.assetId}
          filePath={filePath}
          assetRepository={assetRepository}
          alt="Imagen de esta pantalla"
          size={block.size}
          // Petición de usuario: "un botón... para hacer no ampliable la
          // imagen" — `block.expandable === false` (marcado explícito
          // desde el Inspector) es la ÚNICA forma de desactivarla;
          // `undefined` (nunca tocado) es ampliable por defecto.
          onExpand={block.expandable === false ? undefined : onExpandImage}
        />
      )
    case 'audio':
      return (
        <PlayerAudio
          key={block.assetId}
          assetId={block.assetId}
          filePath={filePath}
          assetRepository={assetRepository}
        />
      )
    case 'video':
      return (
        <PlayerVideo
          key={block.assetId}
          assetId={block.assetId}
          filePath={filePath}
          assetRepository={assetRepository}
        />
      )
  }
}

/**
 * Pinta `node.content` EN ORDEN, bloque a bloque — sustituye al antiguo par
 * "cuerpo de texto único" + "bloque de medios apilado" (`SlideBody`/
 * `NodeMedia`, milestone "Bloques de contenido"): ahora los bloques son
 * heterogéneos y se intercalan libremente, así que basta con recorrer el
 * array tal cual, sin ninguna noción de "orden" aparte del propio índice
 * (ver comentario de `ContentBlockSchema` en `src/domain/schemas.ts`).
 *
 * `emptyFallback` (mismo contrato que antes): si la diapositiva no tiene
 * NINGÚN bloque, se pinta como párrafo de repuesto salvo que sea `null`
 * (vista `decision`, que no muestra nada en ese caso).
 */
function SlideContent({
  node,
  filePath,
  assetRepository,
  emptyFallback,
  onExpandImage,
}: {
  node: SlideNode
  filePath: string
  assetRepository: AssetRepository
  emptyFallback: string | null
  onExpandImage: (image: { dataUri: string; alt: string }) => void
}) {
  if (node.content.length === 0) {
    if (emptyFallback === null) return null
    return <p className={styles.body}>{emptyFallback}</p>
  }
  return (
    <>
      {node.content.map((block) => (
        <ContentBlockView
          key={block.id}
          block={block}
          filePath={filePath}
          assetRepository={assetRepository}
          onExpandImage={onExpandImage}
        />
      ))}
    </>
  )
}

/**
 * Una opción de una diapositiva con respuestas: el botón de elegirla (texto
 * + su imagen adjunta, si tiene, con una flecha sutil siempre pegada al
 * canto derecho y centrada verticalmente) más su audio adjunto, si tiene.
 *
 * Petición de usuario: "que funcione para responder la respuesta cuando
 * haces clic en cualquier parte del cuadro de respuesta" — el `<button>`
 * ahora envuelve TEXTO + IMAGEN (la imagen no es interactiva, así que puede
 * anidarse sin problema dentro de un elemento interactivo). El AUDIO sigue
 * FUERA del `<button>`, en `.optionMedia` — única excepción deliberada:
 * `<audio controls>` SÍ es contenido interactivo, no puede anidarse dentro
 * de otro elemento interactivo (accesibilidad), así que reproducirlo nunca
 * podría "contar como elegir la respuesta" de todos modos.
 *
 * Petición de usuario: sin el punto de siempre a la izquierda — en su
 * lugar, una flecha "→" sutil, SIEMPRE presente (con o sin imagen), fija al
 * canto derecho y centrada verticalmente respecto a TODA la tarjeta (no
 * solo la línea de texto), para invitar visualmente a "pulsa aquí para
 * continuar" en cualquier respuesta.
 *
 * Petición de usuario: el texto de repuesto "Opción sin texto configurado"
 * (para una respuesta sin texto) YA NO se muestra si la respuesta tiene
 * imagen o audio — antes aparecía SIEMPRE que el texto estuviera vacío,
 * aunque hubiera una imagen que ya "hablara por sí sola"; ahora solo se
 * muestra cuando la respuesta no tiene NINGÚN contenido (ni texto ni
 * imagen ni audio), para que el botón nunca quede completamente vacío.
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
  const trimmedText = response.text.trim()
  const hasMedia = Boolean(response.imageAssetId || response.audioAssetId)
  const showText = trimmedText !== '' || !hasMedia

  return (
    <div className={styles.option}>
      <button
        type="button"
        className={styles.optionButton}
        disabled={disabled}
        onClick={onChoose}
      >
        <span className={styles.optionContent}>
          {showText && <span>{trimmedText || 'Opción sin texto configurado'}</span>}
          {response.imageAssetId && (
            <PlayerImage
              key={response.imageAssetId}
              assetId={response.imageAssetId}
              filePath={filePath}
              assetRepository={assetRepository}
              alt={`Imagen de la respuesta ${index}`}
            />
          )}
        </span>
        <span className={styles.optionArrow} aria-hidden="true">
          →
        </span>
      </button>
      {response.audioAssetId && (
        <div className={styles.optionMedia}>
          <PlayerAudio
            key={response.audioAssetId}
            assetId={response.audioAssetId}
            filePath={filePath}
            assetRepository={assetRepository}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Resuelve `cicloId`/`asignaturaId` de un nodo `intro` a sus nombres
 * legibles, vía el catálogo `CICLOS` (`src/domain/catalog.ts`). Dentro de la
 * app esto es un `import` TS normal — a diferencia del runtime exportado
 * (`src/export/exportedPlayerScript.ts`), que no puede importar `catalog.ts`
 * (JS vanilla embebido, sin módulos) y por eso recibe los nombres ya
 * resueltos dentro del bundle, ver `resolveIntroCatalogNames` en
 * `src/export/htmlBundle.ts` — misma lógica, aplicada en dos momentos
 * distintos (aquí, en cada render; allí, una vez, en tiempo de exportación).
 * `undefined` si el campo no está elegido, o si el id ya no existe en el
 * catálogo: mismo criterio tolerante que `asignaturaBelongsToCiclo`
 * (`src/domain/introValidation.ts`) — la portada puede "probarse" incompleta
 * antes de exportar, ver `validateIntroForExport`.
 */
function resolveIntroNames(node: IntroNode): { cicloName?: string; asignaturaName?: string } {
  const ciclo = node.cicloId ? CICLOS.find((candidate) => candidate.id === node.cicloId) : undefined
  const asignatura =
    ciclo && node.asignaturaId
      ? ciclo.asignaturas.find((candidate) => candidate.id === node.asignaturaId)
      : undefined
  // Este reproductor ("▶ Probar", dentro de la app) simula fielmente lo que
  // verá el alumno en la salida final: el nombre del ciclo pierde su
  // prefijo interno de código (`cicloOutputName`, ver ese comentario en
  // `src/domain/catalog.ts`), igual que `resolveIntroCatalogNames` en
  // `src/export/htmlBundle.ts`. El de la asignatura no lleva código, ese es
  // exclusivo del espacio de trabajo (Inspector/canvas).
  return {
    cicloName: ciclo ? cicloOutputName(ciclo.name) : undefined,
    asignaturaName: asignatura?.name,
  }
}

/**
 * Portada de marca iLERNA (nodo `intro`, milestone "Portada de marca
 * iLERNA"): primera vista del recorrido en casi todo proyecto (ver
 * comentario de `IntroNodeSchema` en `src/domain/schemas.ts`). Diseño de
 * referencia entregado por Content Factory: logo arriba, titular fijo de
 * marca ("¿Qué harías tú?" + subtítulo con "decisiones" en acento),
 * ciclo/asignatura como contexto secundario, `caseName` como título de la
 * actividad junto al botón de continuar (abajo, empujado por
 * `.introFooter { margin-top: auto }`), e ilustración de marca a la derecha
 * (oculta en móvil, ver `.introIllustration`/media query en
 * `PlayerScreen.module.css`). El botón de continuar usa el mismo estilo que
 * la vista `continue` — la portada no define `continueLabel` propio (no
 * existe en `IntroNodeSchema`), así que usa siempre `DEFAULT_CONTINUE_LABEL`.
 *
 * Fondo/tipografía/colores FIJOS de marca, independientes del tema
 * claro/oscuro de la app (`.introCard` en `PlayerScreen.module.css` usa
 * colores propios en vez de los tokens `--bs-color-*`): es una portada de
 * marca, no una superficie más de la interfaz de edición.
 *
 * Ningún campo es obligatorio para pintar esta vista (el proyecto puede
 * "probarse" incompleto antes de exportar, ver `validateIntroForExport`):
 * a diferencia del resto de vistas del Player (donde "vacío" se omite sin
 * más), aquí cada pieza que falte (ciclo/asignatura sin elegir, `caseName`
 * vacío) se sustituye por un placeholder gris — decisión de producto
 * explícita para esta portada, ver `INTRO_CICLO_PLACEHOLDER` y compañía.
 * Traducción literal en `buildIntroCard` de
 * `src/export/exportedPlayerScript.ts`.
 */
function IntroCard({ node, onContinue }: { node: IntroNode; onContinue: () => void }) {
  const { cicloName, asignaturaName } = resolveIntroNames(node)
  const caseName = node.caseName.trim()

  return (
    <div className={styles.introCard}>
      <div className={styles.introContent}>
        <img className={styles.introLogo} src={ilernaLogoUrl} alt="iLERNA" />
        <div className={styles.introHeadingGroup}>
          <h1 className={styles.introHeading}>{INTRO_HEADING}</h1>
          <p className={styles.introSubtitle}>
            {INTRO_SUBTITLE_PREFIX}
            <span className={styles.introSubtitleAccent}>{INTRO_SUBTITLE_ACCENT}</span>
            {INTRO_SUBTITLE_SUFFIX}
          </p>
        </div>
        <div className={styles.introFooter}>
          <p className={caseName ? styles.introCaseTitle : styles.introCaseTitlePlaceholder}>
            {caseName || INTRO_CASE_NAME_PLACEHOLDER}
          </p>
          <button type="button" className={styles.introButton} onClick={onContinue}>
            {DEFAULT_CONTINUE_LABEL}
          </button>
        </div>
        {/* Ciclo/asignatura: contexto secundario, deliberadamente pequeño y
            apagado — va DEBAJO del botón (no encima, como en un primer
            borrador) para no competir en protagonismo con el titular fijo
            de marca ni con el título de la actividad. */}
        <div className={styles.introMeta}>
          <p className={cicloName ? styles.introMetaLine : styles.introMetaLinePlaceholder}>
            {cicloName || INTRO_CICLO_PLACEHOLDER}
          </p>
          <p className={asignaturaName ? styles.introMetaLine : styles.introMetaLinePlaceholder}>
            {asignaturaName || INTRO_ASIGNATURA_PLACEHOLDER}
          </p>
        </div>
      </div>
      <div className={styles.introIllustration} aria-hidden="true" />
    </div>
  )
}

/** Paleta fija de piezas de confeti (milestone "+1 fallo con Game Over",
 *  petición de usuario: "Final Perfecto... con confeti", ampliada después a
 *  petición de usuario: "muy ESPECTACULAR") — colores vivos DELIBERADAMENTE
 *  fijos, no tokens `--bs-color-*`: es una decoración festiva puntual, no
 *  una superficie de la interfaz que deba respetar el tema claro/oscuro
 *  (igual criterio que la portada de marca iLERNA, `.introCard`, con sus
 *  propios colores fijos). Traducción literal en `buildConfetti` de
 *  `src/export/exportedPlayerScript.ts`. */
const CONFETTI_COLORS = [
  '#f0677a',
  '#22a5a0',
  '#f5b342',
  '#7c6bf0',
  '#4fb0e8',
  '#f2836b',
  '#ffd23f',
  '#ff5da2',
]
/** Petición de usuario ("muy ESPECTACULAR"): más del doble de piezas que
 *  la versión original (60). */
const CONFETTI_PIECE_COUNT = 150

interface ConfettiPiece {
  id: number
  leftPercent: number
  color: string
  shape: 'rect' | 'circle'
  sizePx: number
  durationSeconds: number
  delaySeconds: number
  rotateStartDegrees: number
  /** Vueltas totales durante toda la caída (1-3, ver comentario de
   *  `confettiFall` en `PlayerScreen.module.css`) — antes siempre 720°
   *  (2 vueltas) fijas para todas las piezas; ahora varía pieza a pieza
   *  para que el volteo se vea más caótico/real. */
  spinDegrees: number
  /** Desplazamiento horizontal (en px) en 4 puntos de control de la caída,
   *  para un vaivén lateral tipo "hoja al viento" en vez de una línea recta
   *  — la parte central de la petición "muy ESPECTACULAR". */
  driftPx: [number, number, number, number]
}

/** Genera `CONFETTI_PIECE_COUNT` piezas con posición/color/forma/tamaño/
 *  temporización/vaivén aleatorios — extraído de `Confetti` para poder
 *  memoizarlo (una sola tanda por montaje, ver su comentario). */
function randomConfettiPieces(): ConfettiPiece[] {
  return Array.from({ length: CONFETTI_PIECE_COUNT }, (_, index) => ({
    id: index,
    leftPercent: Math.random() * 100,
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length] as string,
    shape: Math.random() < 0.5 ? 'rect' : 'circle',
    sizePx: 6 + Math.random() * 8,
    // Petición de usuario ("no que se frene en el final"): duraciones más
    // largas que antes (2.2s-3.8s) porque ahora el recorrido vertical
    // también es mayor (ver `confettiFall`) — mantiene una velocidad de
    // caída similar, no más lenta.
    durationSeconds: 2.8 + Math.random() * 2,
    delaySeconds: Math.random() * 0.6,
    rotateStartDegrees: Math.random() * 360,
    spinDegrees: 360 + Math.random() * 720,
    driftPx: [
      (Math.random() - 0.5) * 90,
      (Math.random() - 0.5) * 90,
      (Math.random() - 0.5) * 90,
      (Math.random() - 0.5) * 90,
    ],
  }))
}

/**
 * Lluvia de confeti (milestone "+1 fallo con Game Over"): puramente
 * decorativa (`aria-hidden`, `pointer-events: none` vía `.confetti`/
 * `.confettiPiece` en `PlayerScreen.module.css`), montada SOLO cuando
 * `view.celebrate` es `true` (ver `getView` en `./runtime`) — nunca se monta
 * "apagada", así que no hace falta ningún prop de visibilidad aparte.
 *
 * `useMemo` con deps `[]`: las piezas se sortean UNA vez por montaje, no en
 * cada render — como este componente entero se monta/desmonta con la vista
 * Final (ver `key={view.node.id}` en su llamador), cada vez que el alumno
 * vuelve a llegar a un Final que celebra, `PlayerScreen` lo desmonta primero
 * (al pasar por vistas intermedias) y lo remonta después, así que la
 * animación se repite igual sin necesitar ningún `key` adicional aquí.
 */
function Confetti() {
  const pieces = useMemo(() => randomConfettiPieces(), [])
  return (
    <div className={styles.confetti} aria-hidden="true">
      {pieces.map((piece) => {
        // Variables CSS personalizadas (ver `confettiFall` en
        // `PlayerScreen.module.css`): `CSSProperties` no las declara (no
        // hay forma de tipar una propiedad `--*` arbitraria sin ampliar el
        // propio tipo), así que se anotan aquí, en la variable, en vez de
        // recurrir a un `as` sin comprobar nada.
        const style: CSSProperties & {
          '--confetti-rotate-start': string
          '--confetti-spin': string
          '--confetti-drift-1': string
          '--confetti-drift-2': string
          '--confetti-drift-3': string
          '--confetti-drift-4': string
        } = {
          left: `${piece.leftPercent}%`,
          width: `${piece.sizePx}px`,
          height: `${piece.shape === 'circle' ? piece.sizePx : piece.sizePx * 1.8}px`,
          borderRadius: piece.shape === 'circle' ? '50%' : '2px',
          backgroundColor: piece.color,
          animationDuration: `${piece.durationSeconds}s`,
          animationDelay: `${piece.delaySeconds}s`,
          '--confetti-rotate-start': `${piece.rotateStartDegrees}deg`,
          '--confetti-spin': `${piece.spinDegrees}deg`,
          '--confetti-drift-1': `${piece.driftPx[0]}px`,
          '--confetti-drift-2': `${piece.driftPx[1]}px`,
          '--confetti-drift-3': `${piece.driftPx[2]}px`,
          '--confetti-drift-4': `${piece.driftPx[3]}px`,
        }
        return <span key={piece.id} className={styles.confettiPiece} style={style} />
      })}
    </div>
  )
}

/** Nombre EXACTO de la variable "Fallos" que crea `addGameOverPack`
 *  (`src/domain/nodePacks.ts`) — mismo literal, no importado de ahí para no
 *  acoplar este componente de UI a un detalle interno de ese módulo de
 *  dominio (mismo criterio que el resto de este archivo, que tampoco
 *  importa nada de `nodePacks.ts`). */
const FALLOS_VARIABLE_NAME = 'Fallos'

/**
 * Indicador de fallos (petición de usuario: "un indicador de fallos, que te
 * diga que conteo de fallos llevas durante la experiencia"), SOLO dentro de
 * la app ("▶ Probar") — deliberadamente sin ningún equivalente en
 * `exportedPlayerScript.ts`: el alumno real, en el HTML/SCORM publicado, no
 * debe ver este contador, es una ayuda de depuración para quien diseña el
 * caso mientras lo prueba.
 *
 * Busca la variable "Fallos" por NOMBRE EXACTO en `project.variables` (la
 * misma que crea/reutiliza `addGameOverPack`) — si el proyecto no tiene
 * ninguna con ese nombre (no usa el pack "+1 fallo con Game Over", o la
 * renombró), no pinta nada: el indicador no tiene sentido sin ella. Lee su
 * valor ACTUAL de `PlayerState.variables` (nunca `initialValue`), así que se
 * actualiza en vivo con cada `advance`/`choose` que aplique su efecto.
 */
function FailureIndicator({
  project,
  variables,
}: {
  project: ProjectDocument
  variables: VariableState
}) {
  const fallosVariable = project.variables.find(
    (variable) => variable.name === FALLOS_VARIABLE_NAME && variable.type === 'number',
  )
  if (!fallosVariable) return null
  const value = variables[fallosVariable.id]
  return (
    <span className={styles.failureIndicator}>Fallos: {typeof value === 'number' ? value : 0}</span>
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
 * botón "Volver a jugar"), o un aviso breve si el recorrido llega a un punto
 * sin continuación configurada. El recorrido empieza directamente en
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
 *
 * "Probar desde aquí" (botón de `Topbar`): `previewStartNodeId`
 * (`ui.previewStartNodeId` del store, ver su comentario de diseño en
 * `store/types.ts`) es el nodo por el que debe arrancar ESTA sesión en vez
 * de `graph.startNodeId`, o `null` si se entró por el botón normal
 * "▶ Probar". Se pasa tal cual a `getInitialState`/`restart` (que resuelven
 * el fallback si el id no correspondiera a ningún nodo) tanto al arrancar
 * como en `handleRestart`: "Reiniciar experiencia"/"Volver a jugar" reinicia
 * al mismo punto en el que empezó esta sesión concreta, no al inicio real
 * del proyecto — sería sorprendente que "probar desde aquí" te devolviera a
 * `graph.startNodeId` al reiniciar.
 */
export function PlayerScreen({ filePath }: PlayerScreenProps) {
  const project = useProject()
  const setPreviewMode = useProjectStore((state) => state.setPreviewMode)
  const previewStartNodeId = usePreviewStartNodeId()
  const { assetRepository } = useAppServices()
  const [playerState, setPlayerState] = useState<PlayerState>(() =>
    getInitialState(project, previewStartNodeId ?? undefined),
  )
  // Petición de usuario ("imágenes ampliables"): la imagen actualmente
  // abierta en el `Lightbox` de pantalla completa, o `null` si ninguna —
  // un único estado a nivel de pantalla (no uno por imagen): solo puede
  // haber un lightbox abierto a la vez.
  const [lightboxImage, setLightboxImage] = useState<{ dataUri: string; alt: string } | null>(null)

  /**
   * Sale del modo "Probar" y vuelve al editor — mismo destino que "←
   * Volver al editor" de la cabecera (de ahí que reutilice el nombre
   * `handleExit`), ahora también para el botón "Salir" de la vista Final Y
   * para una respuesta `actsAsExit` (milestone "+1 fallo con Game Over"):
   * ambas representan la misma intención del diseñador instruccional
   * ("aquí se acaba la experiencia para quien juega"), así que dentro del
   * propio "Probar" deben comportarse igual que la cabecera.
   *
   * Corrección de bug reportado: antes llamaban a `window.close()` (que solo
   * cierra pestañas/ventanas abiertas por script) y se quedaban con un
   * aviso de "ya puedes cerrar la pestaña" pegado en pantalla — sin
   * sentido en el propio editor, donde no hay ninguna pestaña de navegador
   * que cerrar, y sin forma de seguir jugando ni de volver atrás. Ese
   * `window.close()` SÍ tiene sentido en el HTML/SCORM exportado, un
   * documento real de navegador — ahí se mantiene tal cual (ver
   * `exportedPlayerScript.ts`); esta función es exclusiva del "Probar"
   * dentro de la app.
   */
  function handleExit() {
    setPreviewMode(false)
  }

  function handleRestart() {
    setPlayerState(getInitialState(project, previewStartNodeId ?? undefined))
  }

  const view = getView(project, playerState)

  return (
    <div className={styles.screen}>
      <header className={styles.bar}>
        <div className={styles.barLeft}>
          <span className={styles.label}>Modo de prueba</span>
          <FailureIndicator project={project} variables={playerState.variables} />
        </div>
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
        {view.kind === 'intro' && (
          <IntroCard
            key={view.node.id}
            node={view.node}
            onContinue={() => setPlayerState((current) => advance(project, current))}
          />
        )}

        {view.kind === 'continue' && (
          <div key={view.node.id} className={styles.card}>
            {/* Referencia interna del diseñador instruccional (nunca
                aparece en el HTML/SCORM exportado, ver
                `src/export/exportedPlayerScript.ts`): en gris claro para
                marcarlo como tal. */}
            {view.node.title.trim() && (
              <h1 className={styles.nodeReferenceTitle}>{view.node.title}</h1>
            )}
            <SlideContent
              node={view.node}
              filePath={filePath}
              assetRepository={assetRepository}
              emptyFallback="Esta diapositiva todavía no tiene contenido."
              onExpandImage={setLightboxImage}
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
            <SlideContent
              node={view.node}
              filePath={filePath}
              assetRepository={assetRepository}
              emptyFallback={null}
              onExpandImage={setLightboxImage}
            />
            <div className={styles.options}>
              {sortByLetter(view.visibleResponses).map((response, index) => (
                <ResponseOption
                  key={response.id}
                  response={response}
                  index={index + 1}
                  disabled={!response.targetNodeId && !response.actsAsExit}
                  filePath={filePath}
                  assetRepository={assetRepository}
                  onChoose={() =>
                    // Milestone "+1 fallo con Game Over": una respuesta
                    // `actsAsExit` no navega a ningún nodo — se comporta
                    // igual que el botón "Salir" de la vista Final
                    // (`handleExit`): sale del modo "Probar".
                    response.actsAsExit
                      ? handleExit()
                      : setPlayerState((current) => choose(project, current, response.id))
                  }
                />
              ))}
            </div>
          </div>
        )}

        {view.kind === 'final' && (
          <div key={view.node.id} className={styles.card}>
            {/* Confeti (milestone "+1 fallo con Game Over"): SOLO sobre el
                contenido por defecto de un Final con `celebrateDefault`
                (ver `view.celebrate` en `./runtime`) — nunca sobre el
                alternativo. Montado dentro de la tarjeta pero pintado a
                pantalla completa (`.confetti` es `position: fixed`, ver
                `PlayerScreen.module.css`), así que su posición en el árbol
                es irrelevante. */}
            {view.celebrate && <Confetti />}
            <h1 className={styles.title}>Fin de la experiencia</h1>
            {view.resolvedBody.trim() ? (
              <RichTextView body={view.resolvedBody} className={styles.body} />
            ) : (
              <p className={styles.body}>
                {view.node.title.trim() || 'Has llegado al final de esta experiencia.'}
              </p>
            )}
            {playerState.totalPoints !== null && (
              <p className={styles.points}>Puntuación final: {playerState.totalPoints} puntos</p>
            )}
            <div className={styles.finalActions}>
              {/* Reintentar: mismo efecto que "↺ Reiniciar experiencia" de
                  la cabecera, pero dentro de la propia tarjeta de Final, que
                  es donde el usuario está mirando al terminar el recorrido.
                  Mismo estilo/color de acento que "Continuar" (`.primaryButton`,
                  ver comentario de esa clase en `PlayerScreen.module.css`) —
                  antes era un botón de peligro (rojo) porque descartaba el
                  recorrido en curso, pero "reintentar" es una acción
                  habitual y esperada al terminar, no destructiva. Petición
                  de usuario: renombrado de "Volver a jugar" a "Reintentar". */}
              <button type="button" className={styles.primaryButton} onClick={handleRestart}>
                Reintentar
              </button>
              {/* Salir: estilo neutro (no es la acción principal de esta
                  fila). Ver `handleExit`. */}
              <button type="button" className={styles.neutralButton} onClick={handleExit}>
                Salir
              </button>
            </div>
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
      {/* Lightbox de imagen ampliada: `position: fixed` a pantalla completa
          (ver `Lightbox` más arriba), así que su posición en el árbol es
          irrelevante — se renderiza aquí, como hermano de `<main>`, en vez de
          anidado dentro de cada vista. */}
      {lightboxImage && <Lightbox image={lightboxImage} onClose={() => setLightboxImage(null)} />}
    </div>
  )
}
