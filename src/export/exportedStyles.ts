/**
 * Hoja de estilos embebida en el HTML exportado.
 *
 * Es la traducción a CSS plano (sin CSS Modules, sin ningún build step) de
 * `src/styles/tokens.css` + `src/player/PlayerScreen.module.css`: los mismos
 * tokens `--bs-*` con los mismos valores — incluido el acento corporativo
 * iLERNA `#00aec7` — y las mismas reglas de tarjeta, opciones y medios, para
 * que la experiencia exportada se vea igual que en el modo "Probar" del
 * editor.
 *
 * Se mantiene el prefijo `--bs-` y el bloque `prefers-color-scheme: dark`
 * aunque el HTML exportado sea un archivo aislado: así comparar este archivo
 * con `tokens.css` es directo y no hay que traducir nombres al sincronizar
 * cambios de marca.
 *
 * Solo se incluyen los tokens y clases que el HTML exportado usa de verdad
 * (nada de bordes de lienzo, sombras de inspector ni tipografías de panel):
 * el archivo exportado ya carga con todos los assets en base64, así que no
 * conviene engordarlo con CSS muerto.
 */
export const EXPORTED_STYLES = `
:root {
  --bs-color-bg: #f5f5f6;
  --bs-color-surface: #ffffff;
  --bs-color-border: #e2e2e6;
  --bs-color-border-strong: #c9c9cf;
  --bs-color-text: #1b1b1f;
  --bs-color-text-muted: #6b6b74;
  --bs-color-text-faint: #97979f;
  /* Acento corporativo iLERNA (#00aec7) con el mismo texto oscuro encima
     que en la app: blanco puro sobre este turquesa no llega a AA. */
  --bs-color-accent: #00aec7;
  --bs-color-accent-hover: #33c6da;
  --bs-color-accent-contrast: #002b32;
  --bs-color-focus-ring: rgba(0, 174, 199, 0.45);
  /* Destacado del texto enriquecido (marca highlight de Tiptap, fase 8),
     mismo valor que --bs-color-highlight en tokens.css. */
  --bs-color-highlight: #ffe066;

  --bs-space-1: 4px;
  --bs-space-2: 8px;
  --bs-space-3: 12px;
  --bs-space-4: 16px;
  --bs-space-5: 24px;
  --bs-space-6: 32px;

  --bs-radius-sm: 4px;
  --bs-radius-md: 6px;
  --bs-radius-lg: 10px;

  --bs-font-sans: -apple-system, 'Segoe UI', Roboto, system-ui, sans-serif;
  --bs-font-size-sm: 12.5px;
  --bs-font-size-md: 15px;
  --bs-font-size-lg: 19px;

  --bs-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.06);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bs-color-bg: #1c1c1f;
    --bs-color-surface: #232327;
    --bs-color-border: #34343a;
    --bs-color-border-strong: #45454c;
    --bs-color-text: #ededef;
    --bs-color-text-muted: #a1a1aa;
    --bs-color-text-faint: #71717a;
    --bs-color-accent: #2cc7de;
    --bs-color-accent-hover: #5ad6e8;
    --bs-color-accent-contrast: #06222a;
    --bs-color-focus-ring: rgba(44, 199, 222, 0.5);
    --bs-color-highlight: #6b5717;
    --bs-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  }
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
}

body {
  min-height: 100vh;
  background: var(--bs-color-bg);
  color: var(--bs-color-text);
  font-family: var(--bs-font-sans);
  font-size: var(--bs-font-size-md);
  line-height: 1.5;
}

.stage {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--bs-space-6) var(--bs-space-4);
}

.noscript {
  max-width: 520px;
  margin: 0 auto;
  padding: var(--bs-space-4);
  color: var(--bs-color-text-muted);
  text-align: center;
}

/* Fundido de entrada al cambiar de vista — traducción literal de la misma
   regla en \`PlayerScreen.module.css\` (ver su comentario: SOLO \`opacity\`,
   nunca \`transform\`, para no romper el confeti \`position: fixed\`).
   \`render()\`/\`getView\` en \`exportedPlayerScript.ts\` reconstruyen \`root\` por
   completo en cada cambio de vista (\`root.textContent = ''\`), así que este
   \`animation\` en la propia clase basta, sin tocar ese fichero. */
.card {
  width: 100%;
  max-width: 620px;
  display: flex;
  flex-direction: column;
  gap: var(--bs-space-4);
  padding: var(--bs-space-6);
  border: 1px solid var(--bs-color-border);
  border-radius: var(--bs-radius-lg);
  background: var(--bs-color-surface);
  box-shadow: var(--bs-shadow-sm);
  animation: cardFadeIn 0.2s ease;
}

@keyframes cardFadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.title {
  margin: 0;
  font-size: var(--bs-font-size-lg);
  font-weight: 600;
  color: var(--bs-color-text);
}

/* ---------------------------------------------------------------------
   Portada de marca iLERNA (nodo \`intro\`) — traducción literal de la misma
   sección de \`src/player/PlayerScreen.module.css\` (mismos nombres de clase,
   mismos valores). Construida por \`buildIntroCard\` en
   \`exportedPlayerScript.ts\`.

   Lo que NO está aquí (a propósito): los dos \`@font-face\` de FS Millbank y
   el \`background-image\` de \`.introIllustration\`. Esta hoja es un string
   ESTÁTICO sin interpolación, y esos tres valores son \`data:\` URI que solo
   se conocen en tiempo de exportación (ver \`introBrand\` en el bundle JSON,
   \`resolvePlayerIntroBrandAssets\` en \`introBrandAssets.ts\`) — el propio
   runtime los inyecta en un \`<style>\` aparte al arrancar, ver
   \`injectIntroBrandStyles\` en \`exportedPlayerScript.ts\`. Sin \`introBrand\`
   (bundle antiguo o de test sin este dato), \`.introIllustration\` queda sin
   imagen de fondo y el texto cae a \`var(--bs-font-sans)\` — degradación
   correcta, no un error.
   --------------------------------------------------------------------- */

.introCard {
  position: relative;
  width: 100%;
  max-width: 920px;
  min-height: 440px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--bs-radius-lg);
  background: #ffffff;
  border: 1px solid var(--bs-color-border);
  box-shadow: var(--bs-shadow-sm);
  font-family: 'FS Millbank', var(--bs-font-sans);
  color: #0a0a0a;
  animation: cardFadeIn 0.2s ease;
}

.introContent {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 54%;
  padding: 36px 40px;
}

.introLogo {
  height: 26px;
  width: auto;
  align-self: flex-start;
}

.introHeadingGroup {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.introHeading {
  margin: 0;
  font-family: inherit;
  font-weight: 700;
  font-size: clamp(28px, 4vw, 42px);
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: #0a0a0a;
}

.introSubtitle {
  margin: 0;
  max-width: 34ch;
  font-size: 15px;
  line-height: 1.5;
  color: #1a1a1a;
}

.introSubtitleAccent {
  font-weight: 700;
  color: var(--bs-color-accent);
}

.introFooter {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}

.introCaseTitle {
  margin: 0;
  font-weight: 700;
  font-size: 18px;
  line-height: 1.3;
  color: #0a0a0a;
}

.introCaseTitlePlaceholder {
  margin: 0;
  font-weight: 400;
  font-size: 18px;
  line-height: 1.3;
  font-style: italic;
  color: #a3a3a3;
}

.introButton {
  flex: 0 0 auto;
  padding: 13px 30px;
  border: none;
  border-radius: var(--bs-radius-sm);
  background: var(--bs-color-accent);
  color: #0a0a0a;
  font-family: inherit;
  font-weight: 700;
  font-size: 15px;
}

.introButton:hover {
  background: var(--bs-color-accent-hover);
}

/* Ciclo/asignatura: contexto secundario deliberadamente discreto, debajo
   del botón (no encima: ver comentario de \`.introMeta\` en
   \`PlayerScreen.module.css\` sobre por qué). */
.introMeta {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.introMetaLine {
  margin: 0;
  font-size: 11px;
  font-weight: 400;
  color: #8a8a8a;
}

.introMetaLinePlaceholder {
  margin: 0;
  font-size: 11px;
  font-weight: 400;
  font-style: italic;
  color: #a3a3a3;
}

.introIllustration {
  position: absolute;
  inset: 0;
  z-index: 0;
  background-repeat: no-repeat;
  background-position: top right;
  background-size: 85% auto;
}

@media (max-width: 640px) {
  .introIllustration {
    display: none;
  }

  .introContent {
    max-width: none;
    padding: 28px 24px;
  }
}

/* ---------------------------------------------------------------------
   Final "con fallos" (petición de usuario) — traducción literal de la misma
   sección de \`src/player/PlayerScreen.module.css\`. Construida por
   \`buildFinalAlternateCard\` en \`exportedPlayerScript.ts\`. El
   \`background-image\` de \`.finalAlternateIllustration\` NO está aquí, por el
   mismo motivo que \`.introIllustration\`: es un \`data:\` URI que solo se
   conoce en tiempo de exportación, y además OPCIONAL (solo si el proyecto
   tiene algún Final con contenido alternativo) — lo inyecta
   \`injectIntroBrandStyles\` en \`exportedPlayerScript.ts\`.
   --------------------------------------------------------------------- */
.finalAlternateCard {
  position: relative;
  width: 100%;
  max-width: 920px;
  min-height: 440px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--bs-radius-lg);
  background: #ffffff;
  border: 1px solid var(--bs-color-border);
  box-shadow: var(--bs-shadow-sm);
  font-family: 'FS Millbank', var(--bs-font-sans);
  color: #0a0a0a;
  animation: cardFadeIn 0.2s ease;
}

.finalAlternateContent {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 18px;
  max-width: 54%;
  padding: 36px 40px;
}

.finalAlternateBody {
  margin: 0;
  font-family: inherit;
  font-size: 17px;
  line-height: 1.5;
  color: #0a0a0a;
}

.finalAlternateBody h1,
.finalAlternateBody h2,
.finalAlternateBody h3 {
  margin: 0 0 4px;
  font-family: inherit;
  font-weight: 700;
  font-size: clamp(24px, 3.2vw, 34px);
  line-height: 1.1;
  letter-spacing: -0.01em;
  color: #0a0a0a;
}

.finalAlternateBody p {
  margin: 0;
}

.finalAlternatePoints {
  margin: 0;
  font-size: 13px;
  color: #4a4a4a;
}

.finalAlternateActions {
  margin-top: auto;
  padding-top: 8px;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.finalAlternateButtonSecondary {
  flex: 0 0 auto;
  padding: 12px 29px;
  border: 2px solid var(--bs-color-accent);
  border-radius: var(--bs-radius-sm);
  background: transparent;
  color: #0a0a0a;
  font-family: inherit;
  font-weight: 700;
  font-size: 15px;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.finalAlternateButtonSecondary:hover {
  background: rgba(10, 10, 10, 0.05);
  border-color: var(--bs-color-accent-hover);
}

.finalAlternateIllustration {
  position: absolute;
  inset: 0;
  z-index: 0;
  background-repeat: no-repeat;
  background-position: right center;
  background-size: auto 82%;
}

@media (max-width: 640px) {
  .finalAlternateIllustration {
    display: none;
  }

  .finalAlternateContent {
    max-width: none;
    padding: 28px 24px;
  }
}

/* ---------------------------------------------------------------------
   Pantalla de marca bespoke "Game Over" (\`SlideNode.brandedGameOverScreen\`)
   — traducción literal de la misma sección de
   \`src/player/PlayerScreen.module.css\` (mismos nombres de clase, mismos
   valores). Construida por \`buildGameOverCard\` en \`exportedPlayerScript.ts\`.

   Petición de usuario, en varias vueltas: UNA sola columna centrada — logo,
   título, e ilustración a todo el ancho de la tarjeta con los botones
   SUPERPUESTOS sobre su tramo de camino/suelo inferior (un \`<img>\` de
   verdad, no un \`background-image\`, así que no hace falta inyectar nada en
   tiempo de exportación como sí ocurre con \`.introIllustration\`:
   \`buildGameOverCard\` fija \`img.src\` directamente, igual que ya hace con
   el logo).
   --------------------------------------------------------------------- */

.gameOverCard {
  width: 100%;
  max-width: 860px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 48px 40px;
  border-radius: var(--bs-radius-lg);
  background: #ffffff;
  border: 1px solid var(--bs-color-border);
  box-shadow: var(--bs-shadow-sm);
  font-family: 'FS Millbank', var(--bs-font-sans);
  color: #0a0a0a;
  text-align: center;
  animation: cardFadeIn 0.2s ease;
}

.gameOverLogo {
  height: 26px;
  width: auto;
}

.gameOverHeading {
  margin: 0;
  max-width: 32ch;
  font-family: inherit;
  font-weight: 700;
  font-size: clamp(28px, 4vw, 42px);
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: #0a0a0a;
}

.gameOverIllustrationWrap {
  position: relative;
  width: 100%;
}

.gameOverIllustration {
  display: block;
  width: 100%;
  height: auto;
}

.gameOverButtons {
  position: absolute;
  left: 50%;
  bottom: 6%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 10px;
  border-radius: var(--bs-radius-lg);
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(6px);
}

.gameOverButtonPrimary {
  flex: 0 0 auto;
  padding: 16px 40px;
  border: none;
  border-radius: var(--bs-radius-sm);
  background: var(--bs-color-accent);
  color: #0a0a0a;
  font-family: inherit;
  font-weight: 700;
  font-size: 17px;
  transition: background-color 0.15s ease;
}

.gameOverButtonPrimary:hover {
  background: var(--bs-color-accent-hover);
}

.gameOverButtonPrimary:disabled {
  background: #e0e0e0;
  color: #8a8a8a;
  cursor: default;
}

.gameOverButtonSecondary {
  flex: 0 0 auto;
  padding: 15px 39px;
  border: 2px solid var(--bs-color-accent);
  border-radius: var(--bs-radius-sm);
  background: transparent;
  color: #0a0a0a;
  font-family: inherit;
  font-weight: 700;
  font-size: 17px;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.gameOverButtonSecondary:hover {
  background: rgba(10, 10, 10, 0.05);
  border-color: var(--bs-color-accent-hover);
}

/* Faltaba en el export (código review): \`buildGameOverButton\` ya aplica
   \`button.disabled = true\` a AMBOS botones cuando corresponde, pero solo
   \`.gameOverButtonPrimary:disabled\` tenía estilo — el secundario quedaba
   con el atributo \`disabled\` sin ningún cambio visual. Va DESPUÉS de
   \`:hover\` para ganar sobre él. Mismo criterio que
   \`.gameOverButtonPrimary:disabled\`. */
.gameOverButtonSecondary:disabled {
  border-color: #e0e0e0;
  color: #8a8a8a;
  cursor: default;
}

@media (max-width: 640px) {
  .gameOverCard {
    padding: 32px 24px;
  }

  .gameOverButtons {
    gap: 10px;
    padding: 6px;
  }

  .gameOverButtonPrimary,
  .gameOverButtonSecondary {
    padding: 12px 20px;
    font-size: 14px;
  }
}

.body {
  margin: 0;
  font-size: var(--bs-font-size-md);
  color: var(--bs-color-text);
}

/* Contenido enriquecido ya renderizado desde el documento Tiptap
   (párrafos, listas, encabezados, cita, código, regla). */
.body > :first-child {
  margin-top: 0;
}

.body > :last-child {
  margin-bottom: 0;
}

.body p,
.body ul,
.body ol,
.body blockquote,
.body pre {
  margin: 0 0 var(--bs-space-3);
}

.body h1,
.body h2,
.body h3,
.body h4,
.body h5,
.body h6 {
  margin: var(--bs-space-4) 0 var(--bs-space-2);
  line-height: 1.3;
}

.body ul,
.body ol {
  padding-left: var(--bs-space-5);
}

.body li {
  margin: 0 0 var(--bs-space-1);
}

.body a {
  color: var(--bs-color-accent);
}

.body blockquote {
  padding-left: var(--bs-space-3);
  border-left: 3px solid var(--bs-color-border-strong);
  color: var(--bs-color-text-muted);
}

.body code {
  padding: 0 var(--bs-space-1);
  border-radius: var(--bs-radius-sm);
  background: var(--bs-color-bg);
  font-size: 0.92em;
}

.body pre {
  padding: var(--bs-space-3);
  border-radius: var(--bs-radius-md);
  background: var(--bs-color-bg);
  overflow-x: auto;
}

.body pre code {
  padding: 0;
  background: none;
}

.body mark {
  background: var(--bs-color-highlight);
  color: inherit;
  border-radius: var(--bs-radius-sm);
  padding: 0 1px;
}

/* Tabla (fase 9): mismas reglas que .tiptap table/th/td en
   RichTextEditor.module.css/RichTextView.module.css (salvo
   .selectedCell, exclusiva del editor en vivo — no existe en un HTML ya
   exportado), para que la experiencia publicada se vea igual que en el
   editor y en el modo "Probar". */
.body table {
  width: 100%;
  margin: 0 0 var(--bs-space-3);
  border-collapse: collapse;
  table-layout: fixed;
}

.body th,
.body td {
  min-width: 1em;
  padding: var(--bs-space-2);
  border: 1px solid var(--bs-color-border);
  text-align: left;
  vertical-align: top;
}

.body th {
  background: var(--bs-color-surface);
  font-weight: 600;
}

.body hr {
  border: none;
  border-top: 1px solid var(--bs-color-border);
}

.body img {
  max-width: 100%;
  height: auto;
}

button {
  font-family: inherit;
  cursor: pointer;
}

button:focus-visible {
  outline: 2px solid var(--bs-color-focus-ring);
  outline-offset: 2px;
}

.primaryButton {
  align-self: flex-start;
  padding: var(--bs-space-2) var(--bs-space-4);
  border: 1px solid var(--bs-color-accent);
  border-radius: var(--bs-radius-sm);
  background: var(--bs-color-accent);
  color: var(--bs-color-accent-contrast);
  font-size: var(--bs-font-size-md);
  font-weight: 600;
}

.primaryButton:hover {
  background: var(--bs-color-accent-hover);
  border-color: var(--bs-color-accent-hover);
}

/* Traducción literal de \`.options\` en \`src/player/PlayerScreen.module.css\`:
   \`margin-top\` extra (se SUMA al \`gap\` de \`.card\`, no lo sustituye —
   en flexbox el margen de un hijo no colapsa con el \`gap\` del contenedor) que
   separa visualmente el bloque de CONTENIDO de la diapositiva del bloque de
   OPCIONES a elegir. Ver el comentario completo en ese archivo. */
.options {
  display: flex;
  flex-direction: column;
  gap: var(--bs-space-2);
  margin-top: var(--bs-space-2);
}

/* Traducción literal de \`.option\` en \`src/player/PlayerScreen.module.css\`:
   el borde/fondo/redondeo de "tarjeta" vive aquí (no en \`.optionButton\`) para
   que el audio de \`.optionMedia\` — única pieza que, por accesibilidad, no
   puede ir anidada dentro del \`<button>\` — quede visualmente DENTRO del
   límite de esa tarjeta en vez de aparecer como un elemento suelto después
   de ella. Ver el comentario completo en ese archivo. */
.option {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--bs-color-border);
  border-radius: var(--bs-radius-md);
  background: var(--bs-color-bg);
}

/* Hover: el borde vive en \`.option\` (ver arriba), así que el cambio de color
   se aplica al contenedor entero vía \`:has()\` para que toda la tarjeta
   (texto + imagen + audio) reaccione junta. */
.option:has(.optionButton:hover:not(:disabled)) {
  border-color: var(--bs-color-accent);
}

/* Traducción literal de \`.optionButton\`/\`.optionContent\`/\`.optionArrow\` en
   \`src/player/PlayerScreen.module.css\` — ver su comentario para el porqué
   completo: texto + imagen DENTRO del \`<button>\` (ocupa toda la tarjeta,
   "pulsa en cualquier parte" del pedido de usuario), flecha "→" fija al
   canto derecho y centrada verticalmente respecto a TODA la tarjeta (nunca
   se desplaza con el contenido), en vez del antiguo punto a la izquierda. */
.optionButton {
  display: flex;
  align-items: center;
  gap: var(--bs-space-3);
  position: relative;
  width: 100%;
  padding: var(--bs-space-3);
  padding-right: calc(var(--bs-space-3) + 20px);
  border: none;
  background: none;
  color: var(--bs-color-text);
  font-size: var(--bs-font-size-md);
  text-align: left;
}

.optionButton:disabled {
  color: var(--bs-color-text-faint);
  cursor: default;
}

.optionContent {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--bs-space-2);
  flex: 1 1 auto;
  min-width: 0;
}

.optionContent .media {
  max-height: 180px;
}

.optionArrow {
  position: absolute;
  right: var(--bs-space-3);
  top: 50%;
  transform: translateY(-50%);
  flex: 0 0 auto;
  font-size: 18px;
  line-height: 1;
  color: var(--bs-color-text-faint);
}

.optionButton:disabled .optionArrow {
  color: var(--bs-color-border-strong);
}

/* Audio de la opción (única pieza fuera de \`.optionButton\`, ver su
   comentario): mismo padding horizontal que \`.optionButton\` para quedar
   alineado con el texto/imagen de arriba. */
.optionMedia {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--bs-space-2);
  padding: 0 var(--bs-space-3) var(--bs-space-3);
}

.mediaSection {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--bs-space-3);
}

.media {
  max-width: 100%;
  max-height: 320px;
  border: 1px solid var(--bs-color-border);
  border-radius: var(--bs-radius-md);
}

/* Tamaños de imagen (petición de usuario: "un desplegable...
   Pequeño/Normal/Grande") — mismas reglas que PlayerScreen.module.css.
   \`.mediaNormal\` reproduce exactamente el \`.media\` de siempre, así que
   ninguna imagen ya existente (sin \`size\` guardado) cambia de aspecto. */
.mediaSmall {
  max-width: 180px;
  max-height: 180px;
}

.mediaNormal {
  max-width: 100%;
  max-height: 320px;
}

.mediaLarge {
  max-width: 100%;
  max-height: 480px;
}

/* Envoltorio <button> de una imagen ampliable — mismas reglas que
   PlayerScreen.module.css. */
.expandableImage {
  display: inline-block;
  padding: 0;
  border: none;
  background: none;
  cursor: zoom-in;
  line-height: 0;
}

/* Lightbox de imagen ampliada — mismas reglas que PlayerScreen.module.css.
   \`animation\` (no \`transition\`): \`ensureLightbox\`/\`openLightbox\` en
   \`exportedPlayerScript.ts\` reutilizan el mismo nodo alternando
   \`display: none\`/\`flex\` en vez de recrearlo — pasar de \`display: none\` a un
   valor visible reinicia igualmente cualquier \`animation\` de la regla, así
   que el fundido se reproduce sin tocar el JS de ese fichero. */
.lightboxBackdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--bs-space-4);
  background: rgba(0, 0, 0, 0.85);
  cursor: zoom-out;
  animation: lightboxFadeIn 0.15s ease;
}

@keyframes lightboxFadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.lightboxImage {
  display: block;
  max-width: 92vw;
  max-height: 92vh;
  border-radius: var(--bs-radius-md);
  cursor: default;
}

.lightboxClose {
  position: fixed;
  top: var(--bs-space-4);
  right: var(--bs-space-4);
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.lightboxClose:hover {
  background: rgba(255, 255, 255, 0.3);
}

.audio {
  width: 100%;
}

.points {
  margin: 0;
  font-size: var(--bs-font-size-lg);
  font-weight: 600;
  color: var(--bs-color-text);
}

/* Confeti (milestone "+1 fallo con Game Over", petición de usuario: "Final
   Perfecto... con confeti", ampliada después a petición de usuario: "muy
   ESPECTACULAR") — traducción literal de \`.confetti\`/\`.confettiPiece\`/
   \`@keyframes confettiFall\` en \`src/player/PlayerScreen.module.css\`
   (mismos nombres de clase, mismos valores), pintadas por \`buildConfetti\`
   en \`exportedPlayerScript.ts\` (tamaño/forma van inline por pieza, igual
   que en el Player). */
.confetti {
  position: fixed;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 50;
}

.confettiPiece {
  position: absolute;
  top: -24px;
  opacity: 0.95;
  animation-name: confettiFall;
  /* Petición de usuario ("no que se frene en el final"): \`linear\`, no una
     curva que decelere — ver el mismo comentario en
     \`src/player/PlayerScreen.module.css\` para el porqué. */
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

/* Ver el comentario completo de \`confettiFall\` en
   \`src/player/PlayerScreen.module.css\`: recorrido hasta 135vh (de sobra
   para atravesar toda la pantalla y salir por abajo), repartido en
   proporción exacta entre los 4 tramos (25/50/75/100%) para que la
   velocidad de caída sea constante, con vaivén lateral (\`--confetti-drift-*\`)
   y giro (\`--confetti-spin\`) aleatorios por pieza. */
@keyframes confettiFall {
  0% {
    transform: translate(0, 0) rotate(var(--confetti-rotate-start));
  }
  25% {
    transform: translate(var(--confetti-drift-1), 33.75vh)
      rotate(calc(var(--confetti-rotate-start) + var(--confetti-spin) * 0.25));
  }
  50% {
    transform: translate(var(--confetti-drift-2), 67.5vh)
      rotate(calc(var(--confetti-rotate-start) + var(--confetti-spin) * 0.5));
  }
  75% {
    transform: translate(var(--confetti-drift-3), 101.25vh)
      rotate(calc(var(--confetti-rotate-start) + var(--confetti-spin) * 0.75));
  }
  100% {
    transform: translate(var(--confetti-drift-4), 135vh)
      rotate(calc(var(--confetti-rotate-start) + var(--confetti-spin)));
  }
}

/* ---------------------------------------------------------------------
   Modo revisión profes ("Exportar revisión profes"): clases pintadas
   ÚNICAMENTE por \`exportedPlayerScript.ts\` cuando \`bundle.reviewMode\` está
   activo (ver su sección "Modo revisión profes"). Compartir esta misma hoja
   con el export HTML/SCORM normal es intencional (una sola fuente de
   verdad de estilos para los tres); estas reglas simplemente no se aplican
   nunca a nada en un export normal porque ese script no crea elementos con
   estas clases.
   --------------------------------------------------------------------- */

/* "Diapositiva {número}", grande y bien visible, antes del propio
   contenido de la tarjeta — la referencia que el profesor usa en su hoja
   de validación externa. \`position: relative\` + \`z-index: 1\` (sin mover
   nada) es necesario ÚNICAMENTE para la portada (\`.introCard\`): al
   insertarse como su primer hijo (\`card.insertBefore\`, ver \`render()\` en
   \`exportedPlayerScript.ts\`) queda HERMANO de \`.introIllustration\`
   (\`position: absolute; z-index: 0\`), que sin este empate de "estar
   posicionado" pintaría por encima de esta etiqueta (estática) aunque vaya
   antes en el DOM — las reglas de contexto de apilamiento pintan los
   elementos posicionados por encima de los estáticos, sea cual sea su
   orden. En el resto de tarjetas (\`.card\`, sin ninguna capa posicionada
   dentro) esta regla no cambia nada visualmente. */
.reviewSlideLabel {
  position: relative;
  z-index: 1;
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--bs-color-accent);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

/* Indicador de progreso persistente (esquina superior derecha) + lista de
   cobertura desplegable. */
.reviewIndicator {
  position: fixed;
  top: var(--bs-space-4);
  right: var(--bs-space-4);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--bs-space-2);
}

.reviewIndicatorButton {
  padding: var(--bs-space-2) var(--bs-space-4);
  border: 1px solid var(--bs-color-border);
  border-radius: 999px;
  background: var(--bs-color-surface);
  color: var(--bs-color-text);
  font-size: var(--bs-font-size-sm);
  font-weight: 600;
  box-shadow: var(--bs-shadow-sm);
}

.reviewPanel {
  display: none;
  flex-direction: column;
  gap: var(--bs-space-1);
  width: 240px;
  max-height: 320px;
  overflow-y: auto;
  padding: var(--bs-space-2);
  border: 1px solid var(--bs-color-border);
  border-radius: var(--bs-radius-md);
  background: var(--bs-color-surface);
  box-shadow: var(--bs-shadow-sm);
}

.reviewPanelItem {
  display: block;
  width: 100%;
  padding: var(--bs-space-2);
  border: none;
  border-radius: var(--bs-radius-sm);
  background: transparent;
  color: var(--bs-color-text);
  font-size: var(--bs-font-size-sm);
  text-align: left;
}

.reviewPanelItem:hover {
  background: var(--bs-color-bg);
}

.reviewPanelItemVisited {
  color: var(--bs-color-text-muted);
  font-weight: 600;
}

/* Pantalla de felicitación al llegar al 100%. */
.reviewOverlayBackdrop {
  display: none;
  position: fixed;
  inset: 0;
  align-items: center;
  justify-content: center;
  padding: var(--bs-space-4);
  background: rgba(0, 0, 0, 0.55);
  z-index: 2000;
}

.reviewPenguin {
  display: block;
  width: 100%;
  max-width: 220px;
  height: auto;
  margin: 0 auto;
}

/* Preferencia de accesibilidad "reducir movimiento" (corrección de revisión
   de código): antes solo desactivaba \`animation\` en 4 selectores concretos
   y se olvidaba de \`transition\` (las de \`.gameOverButtonPrimary\`/
   \`.gameOverButtonSecondary\`, más abajo, seguían animadas) — mismo motivo
   por el que \`src/styles/global.css\` sustituyó su equivalente por un reset
   universal: un selector con nombre de clase concreto es fácil de olvidar
   actualizar cada vez que se añade una transición/animación nueva. Este
   selector universal (mismo patrón que Bootstrap y la mayoría de sistemas
   de diseño) cubre TODO lo que ya existe y lo que se añada después sin
   tocar este bloque de nuevo — INCLUIDO el confeti (antes exento a
   propósito): una ráfaga de 150 piezas animadas a pantalla completa es
   precisamente el tipo de movimiento a gran escala que esta preferencia de
   accesibilidad existe para evitar. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`
