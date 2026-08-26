/**
 * Hoja de estilos embebida en el HTML exportado.
 *
 * Es la traducción a CSS plano (sin CSS Modules, sin ningún build step) de
 * `src/styles/tokens.css` + `src/player/PlayerScreen.module.css`: los mismos
 * tokens `--bs-*` con los mismos valores — incluido el acento corporativo
 * iLERNA `#00aec7` y el rojo de peligro `#c22b3a` del botón "Reintentar" — y
 * las mismas reglas de tarjeta, opciones y medios, para que la experiencia
 * exportada se vea igual que en el modo "Probar" del editor.
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
  --bs-color-danger: #c22b3a;
  --bs-color-danger-hover: #a32230;
  --bs-color-danger-contrast: #ffffff;
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
    --bs-color-danger: #f0677a;
    --bs-color-danger-hover: #f78b99;
    --bs-color-danger-contrast: #2a0b10;
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
}

.title {
  margin: 0;
  font-size: var(--bs-font-size-lg);
  font-weight: 600;
  color: var(--bs-color-text);
}

/* Contexto secundario de la portada (nodo \`intro\`): ciclo + asignatura, por
   encima de \`caseName\` (\`.title\`). Traducción literal de \`.introContext\` en
   \`src/player/PlayerScreen.module.css\` — ver \`buildCard\`, rama \`'intro'\`, en
   \`exportedPlayerScript.ts\`. */
.introContext {
  margin: 0;
  font-size: var(--bs-font-size-sm);
  font-weight: 600;
  color: var(--bs-color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
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

/* "Reintentar": descarta el recorrido en curso y su puntuación, así que usa
   el color de peligro del sistema, igual que en la app. */
.dangerButton {
  align-self: flex-start;
  padding: var(--bs-space-2) var(--bs-space-4);
  border: 1px solid var(--bs-color-danger);
  border-radius: var(--bs-radius-sm);
  background: var(--bs-color-danger);
  color: var(--bs-color-danger-contrast);
  font-size: var(--bs-font-size-md);
  font-weight: 600;
}

.dangerButton:hover {
  background: var(--bs-color-danger-hover);
  border-color: var(--bs-color-danger-hover);
}

.options {
  display: flex;
  flex-direction: column;
  gap: var(--bs-space-2);
}

.option {
  display: flex;
  flex-direction: column;
  gap: var(--bs-space-2);
}

/* Opción de una decisión: punto + texto. Nunca una letra A/B/C/D. */
.optionButton {
  display: flex;
  align-items: center;
  gap: var(--bs-space-3);
  width: 100%;
  padding: var(--bs-space-3);
  border: 1px solid var(--bs-color-border);
  border-radius: var(--bs-radius-md);
  background: var(--bs-color-bg);
  color: var(--bs-color-text);
  font-size: var(--bs-font-size-md);
  text-align: left;
}

.optionButton:hover:not(:disabled) {
  border-color: var(--bs-color-accent);
}

.optionButton:disabled {
  color: var(--bs-color-text-faint);
  cursor: default;
}

.optionBullet {
  display: inline-block;
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--bs-color-accent);
}

.optionButton:disabled .optionBullet {
  background: var(--bs-color-border-strong);
}

.optionMedia {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--bs-space-2);
  padding-left: var(--bs-space-3);
}

.optionMedia .media {
  max-height: 180px;
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

.audio {
  width: 100%;
}

.points {
  margin: 0;
  font-size: var(--bs-font-size-lg);
  font-weight: 600;
  color: var(--bs-color-text);
}
`
