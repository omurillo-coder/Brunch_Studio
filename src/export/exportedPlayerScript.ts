/**
 * ---------------------------------------------------------------------------
 * Runtime del Player en JS vanilla, para el HTML exportado
 * ---------------------------------------------------------------------------
 *
 * Traducción literal de `src/player/runtime.ts` (`getInitialState`,
 * `restart`, `getView`, `advance`, `choose`) más una capa de pintado
 * equivalente a la de `src/player/PlayerScreen.tsx`, en un único `<script>`
 * clásico sin módulos, sin React, sin Tiptap y sin ninguna dependencia
 * externa.
 *
 * Por qué una copia y no un import: `runtime.ts` es un módulo ES de un
 * proyecto con TypeScript y bundler; un `index.html` suelto abierto con
 * `file://` no puede importarlo (los módulos ES vía `file://` los bloquea
 * la política CORS de los navegadores, y aunque no fuese así el archivo `.ts`
 * no existe junto al HTML exportado). La fuente de verdad del comportamiento
 * sigue siendo `runtime.ts`; esta traducción debe cambiarse en el mismo
 * commit que aquél, y el test de `htmlBundle` ejercita este script (avanzar,
 * elegir con puntuación, reiniciar) para que una divergencia se note.
 *
 * El script es una constante estática, SIN interpolación de ningún tipo:
 * todo lo variable (documento, HTML de los cuerpos, `data:` URI de los
 * assets, textos de interfaz, orden de letras) llega por el JSON embebido en
 * el propio HTML, que este script lee de `#brunch-bundle`. Así no hay ningún
 * riesgo de romper el script al escapar contenido del usuario, ni de que un
 * `${` accidental en un texto se interprete como código.
 *
 * ---------------------------------------------------------------------------
 * SCORM 2004 4ª edición (Milestone 3, fase 2)
 * ---------------------------------------------------------------------------
 *
 * Este MISMO script sirve tanto para la exportación HTML suelta (fase 1)
 * como para el paquete SCORM (fase 2): en vez de mantener dos runtimes que
 * puedan divergir, la comunicación con la API SCORM 2004 (RTE, IEEE
 * 1484.11.2) vive aquí, protegida de arriba a abajo para que sea un no-op
 * silencioso cuando no hay ningún LMS alrededor (el caso normal de un
 * `index.html` abierto suelto), y también cuando el LMS solo soporta SCORM
 * 1.2 (esta versión ya no lo intenta: no busca `window.API`, solo
 * `window.API_1484_11`).
 *
 * `findAPI` es el patrón estándar y muy documentado de SCORM (a veces
 * llamado `ISO_FindAPI`; el nombre de la propiedad global cambia entre
 * versiones, pero el algoritmo de búsqueda es el mismo): la API la expone la
 * ventana del LMS, no la del contenido, así que hay que subir por
 * `window.parent` hasta encontrar una propiedad `API_1484_11` (el nombre
 * fijado por SCORM 2004; `API` a secas es el de 1.2 y ya no se busca), con
 * un límite de saltos para no colgarse si algo forma un bucle; si tras
 * agotar los saltos no ha aparecido, se prueba una vez con `window.opener`
 * (caso del contenido abierto en una ventana/pestaña nueva por el LMS en vez
 * de en un `<iframe>`).
 *
 * Ciclo de vida:
 *  - Al cargar el script: se busca la API; si aparece, `Initialize("")`.
 *  - Al llegar a un Final: `SetValue("cmi.completion_status", "completed")`.
 *    SCORM 2004 separa el estado de FINALIZACIÓN (`cmi.completion_status`)
 *    del de SUPERACIÓN (`cmi.success_status`, valores `passed`/`failed`/
 *    `unknown`): este último NO se fija porque el modelo de dominio de
 *    Brunch Studio no tiene todavía ningún concepto de "aprobado/reprobado"
 *    ni de umbral de superación — decisión de diseño documentada aquí y en
 *    el informe de la fase; el LMS lo interpretará como `unknown` por
 *    defecto (valor inicial del elemento según el estándar). Solo si
 *    `state.totalPoints !== null` se informa también
 *    `SetValue("cmi.score.raw", String(state.totalPoints))` — sin normalizar
 *    a 0-100 ni fijar `cmi.score.scaled` (el modelo de Brunch Studio tampoco
 *    tiene concepto de "puntuación máxima posible": se informa el total tal
 *    cual, misma simplificación conocida que ya existía en SCORM 1.2).
 *    Después `Commit("")`.
 *  - Al cerrar/salir (`beforeunload`): si se llegó a inicializar,
 *    `Terminate("")`.
 *
 * Cada llamada a la API va en su propio `try/catch`: si la API está pero
 * alguna llamada falla o lanza (LMS mal implementado, sesión ya cerrada…),
 * el error se ignora y la reproducción del contenido para quien lo esté
 * usando sigue intacta.
 */

/**
 * Id del `<script type="application/json">` con el bundle del proyecto.
 * `htmlBundle.ts` lo usa al escribir el HTML; el script de abajo lo tiene
 * escrito literal (no interpolado, ver nota de arriba), así que los dos
 * valores deben cambiarse juntos.
 */
export const BUNDLE_ELEMENT_ID = 'brunch-bundle'

/** Id del contenedor donde se pinta la experiencia. Misma nota que
 *  `BUNDLE_ELEMENT_ID`: aparece literal dentro del script. */
export const ROOT_ELEMENT_ID = 'brunch-root'

export const EXPORTED_PLAYER_SCRIPT = `(function () {
  'use strict';

  var bundleElement = document.getElementById('brunch-bundle');
  var root = document.getElementById('brunch-root');
  if (!bundleElement || !root) {
    return;
  }

  var bundle = JSON.parse(bundleElement.textContent || '{}');
  var project = bundle.project;
  var bodyHtml = bundle.bodyHtml || {};
  var assetUris = bundle.assetUris || {};
  var letters = bundle.responseLetters || [];
  var texts = bundle.texts || {};
  // Nombres de ciclo/asignatura de la portada (nodo \`intro\`), ya resueltos
  // contra el catálogo EN TIEMPO DE EXPORTACIÓN (ver
  // \`resolveIntroCatalogNames\` en \`htmlBundle.ts\`): este script no puede
  // importar \`src/domain/catalog.ts\` (JS vanilla embebido, sin módulos), así
  // que recibe ya el resultado (dos strings, o \`null\`) en vez del catálogo
  // entero.
  var introCicloName = bundle.introCicloName || null;
  var introAsignaturaName = bundle.introAsignaturaName || null;

  // Textos del botón "Salir" de la vista 'final' y de su aviso posterior.
  // Traducción literal de los mismos textos fijos de PlayerScreen.tsx
  // (\`handleExitAttempt\`). NO viajan por \`texts\` (bundle embebido, ver
  // \`ExportedTexts\`/\`EXPORTED_TEXTS\` en \`htmlBundle.ts\`) porque ese archivo
  // queda fuera del alcance de este cambio: se documenta aquí en vez de
  // silenciarlo.
  var EXIT_BUTTON_LABEL = 'Salir';
  var EXIT_MESSAGE = 'Ya puedes cerrar esta pestaña.';

  // -------------------------------------------------------------------------
  // SCORM 2004 4ª edición (no-op silencioso fuera de un LMS; ver cabecera
  // del archivo)
  // -------------------------------------------------------------------------

  var MAX_FIND_API_HOPS = 7;

  /** Busca window.API_1484_11 subiendo por window.parent hasta
   *  MAX_FIND_API_HOPS saltos. Patrón estándar de SCORM ("ISO_FindAPI");
   *  API_1484_11 es el nombre de propiedad global fijado por SCORM 2004
   *  (IEEE 1484.11.2), distinto del "API" de SCORM 1.2. */
  function findAPIInWindow(win) {
    var attempts = 0;
    while (
      !win.API_1484_11 &&
      win.parent &&
      win.parent !== win &&
      attempts < MAX_FIND_API_HOPS
    ) {
      attempts += 1;
      win = win.parent;
    }
    return win.API_1484_11 || null;
  }

  /** Igual que findAPIInWindow, pero probando también window.opener
   *  (contenido abierto en una ventana/pestaña nueva por el LMS). Todo el
   *  acceso a window.parent/window.opener va protegido: en un iframe con
   *  origen distinto puede lanzar SecurityError en vez de devolver
   *  undefined. */
  function findAPI() {
    try {
      var api = findAPIInWindow(window);
      if (api) {
        return api;
      }
      if (window.opener && window.opener !== window) {
        return findAPIInWindow(window.opener);
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  var scormAPI = findAPI();
  var scormInitialized = false;

  /** Llama a fn sobre la API SCORM protegida en su propio try/catch: un
   *  LMS que falle o lance nunca debe romper la reproducción. */
  function callScormSafely(fn) {
    if (!scormAPI) {
      return;
    }
    try {
      fn(scormAPI);
    } catch (error) {
      // Silencioso a propósito: ver cabecera del archivo.
    }
  }

  function scormInitialize() {
    if (!scormAPI) {
      return;
    }
    callScormSafely(function (api) {
      api.Initialize('');
      scormInitialized = true;
    });
  }

  /** Se llama al alcanzar un Final: informa cmi.completion_status
   *  "completed" y, si hay puntuación, cmi.score.raw tal cual (sin
   *  normalizar a 0-100). No fija cmi.success_status: ver cabecera del
   *  archivo. */
  function scormReportCompletion(totalPoints) {
    if (!scormAPI) {
      return;
    }
    callScormSafely(function (api) {
      api.SetValue('cmi.completion_status', 'completed');
      if (totalPoints !== null) {
        api.SetValue('cmi.score.raw', String(totalPoints));
      }
      api.Commit('');
    });
  }

  function scormFinish() {
    if (!scormAPI || !scormInitialized) {
      return;
    }
    callScormSafely(function (api) {
      api.Terminate('');
    });
  }

  scormInitialize();
  window.addEventListener('beforeunload', scormFinish);

  // -------------------------------------------------------------------------
  // Runtime (traducción literal de src/player/runtime.ts)
  // -------------------------------------------------------------------------

  function findNode(nodeId) {
    var nodes = project.graph.nodes;
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i].id === nodeId) {
        return nodes[i];
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Variables/condiciones (traducción literal de src/domain/variables.ts)
  // -------------------------------------------------------------------------

  /** Traducción literal de \`applyVariableEffects\`: devuelve un estado NUEVO,
   *  no muta \`variables\`. \`set\` fija el valor; \`increment\`/\`decrement\` son
   *  no-op silencioso si el valor actual no es un \`number\` (booleana o
   *  ausente), mismo criterio que el dominio. */
  function applyVariableEffects(variables, effects) {
    var state = variables;
    for (var i = 0; i < effects.length; i += 1) {
      var effect = effects[i];
      if (effect.operation === 'set') {
        state = Object.assign({}, state);
        state[effect.variableId] = effect.value;
        continue;
      }
      var current = state[effect.variableId];
      if (typeof current !== 'number') {
        continue;
      }
      var delta = effect.operation === 'increment' ? effect.value : -effect.value;
      state = Object.assign({}, state);
      state[effect.variableId] = current + delta;
    }
    return state;
  }

  /** Traducción literal de \`evaluateCondition\`: \`==\`/\`!=\` siempre
   *  significativos (incluida una variable ausente del estado, tratada como
   *  \`undefined\`); los operadores de orden solo si ambos lados son \`number\`,
   *  \`false\` en cualquier otro caso, nunca lanza. */
  function evaluateCondition(variables, condition) {
    var current = variables[condition.variableId];

    if (condition.operator === '==') {
      return current === condition.value;
    }
    if (condition.operator === '!=') {
      return current !== condition.value;
    }

    if (typeof current !== 'number' || typeof condition.value !== 'number') {
      return false;
    }

    var target = condition.value;
    switch (condition.operator) {
      case '>':
        return current > target;
      case '>=':
        return current >= target;
      case '<':
        return current < target;
      case '<=':
        return current <= target;
      default:
        return false;
    }
  }

  /** Traducción literal de \`resolveSlideTarget\`: sin \`condition\`, siempre
   *  \`node.targetNodeId\`; con \`condition\`, decide entre \`targetNodeId\`
   *  (verdadera) y \`elseTargetNodeId\` (falsa). No se llama nunca sobre un
   *  nodo con respuestas (mismo criterio que el dominio, comprobado en cada
   *  llamador de abajo). */
  function resolveSlideTarget(node, variables) {
    if (!node.condition) {
      return node.targetNodeId;
    }
    return evaluateCondition(variables, node.condition) ? node.targetNodeId : node.elseTargetNodeId;
  }

  function getInitialState() {
    var start = findNode(project.graph.startNodeId);
    var variableDefs = project.variables || [];
    var variables = {};
    for (var i = 0; i < variableDefs.length; i += 1) {
      variables[variableDefs[i].id] = variableDefs[i].initialValue;
    }
    return { currentNodeId: start ? start.id : null, totalPoints: null, variables: variables };
  }

  function restart() {
    return getInitialState();
  }

  function hasAnyTarget(responses) {
    for (var i = 0; i < responses.length; i += 1) {
      if (responses[i].targetNodeId) {
        return true;
      }
    }
    return false;
  }

  /** Traducción literal del filtrado de \`visibleResponses\` en \`getView\`
   *  (\`src/player/runtime.ts\`): las respuestas sin \`condition\`, más las que
   *  la tienen y evalúan a verdadera contra \`state.variables\`. */
  function visibleResponsesOf(responses, variables) {
    var visible = [];
    for (var i = 0; i < responses.length; i += 1) {
      var response = responses[i];
      if (!response.condition || evaluateCondition(variables, response.condition)) {
        visible.push(response);
      }
    }
    return visible;
  }

  function getView(state) {
    if (state.currentNodeId === null) {
      return { kind: 'dead-end', node: null };
    }

    var node = findNode(state.currentNodeId);
    if (!node) {
      return { kind: 'dead-end', node: null };
    }

    if (node.type === 'intro') {
      // Traducción literal de runtime.ts: sin targetNodeId, dead-end en vez
      // de una portada con un botón que no lleva a ningún sitio.
      return node.targetNodeId
        ? { kind: 'intro', node: node }
        : { kind: 'dead-end', node: node };
    }

    if (node.type === 'final') {
      return { kind: 'final', node: node };
    }

    var responses = node.responses || [];
    if (responses.length > 0) {
      var visibleResponses = visibleResponsesOf(responses, state.variables);
      return hasAnyTarget(visibleResponses)
        ? { kind: 'decision', node: node, visibleResponses: visibleResponses }
        : { kind: 'dead-end', node: node };
    }

    var target = resolveSlideTarget(node, state.variables);
    return target
      ? { kind: 'continue', node: node }
      : { kind: 'dead-end', node: node };
  }

  function advance(state) {
    if (state.currentNodeId === null) {
      return state;
    }
    var node = findNode(state.currentNodeId);
    if (!node) {
      return state;
    }
    // Traducción literal de runtime.ts: mismo verbo generalizado a los dos
    // orígenes posibles de "un único destino, sin decisión" — un \`intro\`
    // avanza directamente a su \`targetNodeId\`, sin condición (un \`intro\` no
    // tiene \`condition\`).
    if (node.type === 'intro') {
      if (!node.targetNodeId) {
        return state;
      }
      return { currentNodeId: node.targetNodeId, totalPoints: state.totalPoints, variables: state.variables };
    }
    if (node.type !== 'slide') {
      return state;
    }
    var responses = node.responses || [];
    if (responses.length > 0) {
      return state;
    }
    var target = resolveSlideTarget(node, state.variables);
    if (!target) {
      return state;
    }
    return { currentNodeId: target, totalPoints: state.totalPoints, variables: state.variables };
  }

  function choose(state, responseId) {
    if (state.currentNodeId === null) {
      return state;
    }
    var node = findNode(state.currentNodeId);
    if (!node || node.type !== 'slide') {
      return state;
    }
    var responses = node.responses || [];
    var response = null;
    for (var i = 0; i < responses.length; i += 1) {
      if (responses[i].id === responseId) {
        response = responses[i];
        break;
      }
    }
    if (!response || !response.targetNodeId) {
      return state;
    }
    // Mismo criterio que runtime.ts: una respuesta sin \`points\` deja el
    // total intacto (incluido el \`null\` inicial); con \`points\` suma,
    // arrancando en 0 si el total era todavía \`null\`. \`JSON.stringify\`
    // elimina los \`undefined\`, así que "sin puntuación" llega aquí como
    // propiedad ausente, que \`=== undefined\` detecta igual.
    var totalPoints =
      response.points === undefined
        ? state.totalPoints
        : (state.totalPoints === null ? 0 : state.totalPoints) + response.points;
    var variables = applyVariableEffects(state.variables, response.effects || []);
    return { currentNodeId: response.targetNodeId, totalPoints: totalPoints, variables: variables };
  }

  // -------------------------------------------------------------------------
  // Pintado (equivalente a src/player/PlayerScreen.tsx)
  // -------------------------------------------------------------------------

  /** Mismo criterio de orden que el Player: por letra (A→B→C→D) fijo. La
   *  letra solo ordena, nunca se muestra. */
  function sortByLetter(responses) {
    return responses.slice().sort(function (a, b) {
      return letters.indexOf(a.letter) - letters.indexOf(b.letter);
    });
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    return node;
  }

  function trimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  /** Cuerpo enriquecido ya renderizado en tiempo de exportación (Tiptap ->
   *  HTML estático), de un nodo con un único \`body\` (solo \`final\`, ver
   *  \`appendContent\` más abajo para los bloques de \`content\` de una
   *  diapositiva). \`fallback\` se pinta como texto plano cuando el nodo no
   *  tiene cuerpo; \`null\` significa "no pintar nada". */
  function appendBody(card, node, fallback) {
    var html = bodyHtml[node.id];
    if (trimmed(node.body) && html) {
      var rich = el('div', 'body');
      rich.innerHTML = html;
      card.appendChild(rich);
      return;
    }
    if (fallback !== null) {
      var paragraph = el('p', 'body');
      paragraph.textContent = fallback;
      card.appendChild(paragraph);
    }
  }

  /** Pinta un único bloque de \`SlideNode.content\` (milestone "Bloques de
   *  contenido"), según su \`type\` — traducción literal de
   *  \`ContentBlockView\` en \`src/player/PlayerScreen.tsx\`: texto (HTML ya
   *  renderizado en tiempo de exportación, indexado por \`block.id\` en
   *  \`bodyHtml\`, ver \`renderNodeBodies\` en \`htmlBundle.ts\`), imagen, audio
   *  o vídeo (\`data:\` URI ya resuelto, indexado por \`block.assetId\` en
   *  \`assetUris\`). Un bloque de texto vacío, o un bloque de imagen/audio/
   *  vídeo cuyo asset no se pudo leer en tiempo de exportación, no pinta nada
   *  — mismo criterio tolerante que el resto del runtime exportado. El vídeo
   *  reutiliza la clase \`media\` (mismo ancho/alto máximo que la imagen, ver
   *  exportedStyles.ts) para no desbordar ni distorsionar la tarjeta. */
  function appendContentBlock(card, block) {
    if (block.type === 'text') {
      var html = bodyHtml[block.id];
      if (!trimmed(block.body) || !html) {
        return;
      }
      var rich = el('div', 'body');
      rich.innerHTML = html;
      card.appendChild(rich);
      return;
    }
    if (block.type === 'image') {
      var imageUri = assetUris[block.assetId];
      if (!imageUri) {
        return;
      }
      var image = el('img', 'media');
      image.src = imageUri;
      image.alt = texts.nodeImageAlt;
      card.appendChild(image);
      return;
    }
    if (block.type === 'audio') {
      var audioUri = assetUris[block.assetId];
      if (!audioUri) {
        return;
      }
      var audio = el('audio', 'audio');
      audio.controls = true;
      audio.src = audioUri;
      card.appendChild(audio);
      return;
    }
    if (block.type === 'video') {
      var videoUri = assetUris[block.assetId];
      if (!videoUri) {
        return;
      }
      var video = el('video', 'media');
      video.controls = true;
      video.src = videoUri;
      card.appendChild(video);
    }
  }

  /** Pinta \`node.content\` EN ORDEN, bloque a bloque — traducción literal de
   *  \`SlideContent\` en \`src/player/PlayerScreen.tsx\`. Sustituye al antiguo
   *  \`appendBodyAndMedia\` (cuerpo único + bloque de medios apilado, ordenados
   *  según \`node.contentOrder\`): con \`content\` los bloques son
   *  heterogéneos y se intercalan libremente, así que basta con recorrer el
   *  array tal cual, sin ninguna noción de "orden" aparte del propio índice.
   *  \`fallback\` (mismo contrato que \`appendBody\`): se pinta como párrafo de
   *  repuesto solo si la diapositiva no tiene NINGÚN bloque; \`null\` significa
   *  "no pintar nada" (vista 'decision'). */
  function appendContent(card, node, fallback) {
    var content = node.content || [];
    if (content.length === 0) {
      if (fallback !== null) {
        var paragraph = el('p', 'body');
        paragraph.textContent = fallback;
        card.appendChild(paragraph);
      }
      return;
    }
    for (var i = 0; i < content.length; i += 1) {
      appendContentBlock(card, content[i]);
    }
  }

  /** Aviso mostrado tras pulsar "Salir" (vista 'final', más abajo):
   *  \`window.close()\` solo cierra pestañas/ventanas abiertas por script — la
   *  mayoría de navegadores lo bloquean si no fue así, limitación conocida
   *  del navegador — y no hay forma fiable de detectar el éxito en todos
   *  los navegadores, así que este aviso se muestra SIEMPRE tras el intento,
   *  para cubrir el caso, muy probable, de que el cierre automático no haya
   *  funcionado. Idempotente respecto a \`card\`: un segundo clic no duplica
   *  el párrafo. Estilo vía \`style.cssText\` (mismos tokens --bs-* que ya
   *  define exportedStyles.ts en :root) en vez de una clase nueva: ese
   *  archivo queda fuera del alcance de este cambio. */
  function showExitMessage(card) {
    if (card.querySelector('[data-exit-message]')) {
      return;
    }
    var message = el('p', null);
    message.setAttribute('data-exit-message', '');
    message.setAttribute('role', 'status');
    message.style.cssText =
      'margin:0;font-size:var(--bs-font-size-sm);color:var(--bs-color-text-muted);';
    message.textContent = EXIT_MESSAGE;
    card.appendChild(message);
  }

  /** Resuelve una lista de assetId de imagen a sus \`data:\` URI ya
   *  embebidos, descartando (sin romper nada) los que no se pudieron leer
   *  en tiempo de exportación. Solo la usa \`buildOption\` (imagen de una
   *  respuesta, modelo sin cambios en este milestone): los bloques de imagen
   *  de \`node.content\` se resuelven directamente en \`appendContentBlock\`. */
  function resolveImageUris(imageAssetIds) {
    var ids = imageAssetIds || [];
    var uris = [];
    for (var i = 0; i < ids.length; i += 1) {
      var uri = assetUris[ids[i]];
      if (uri) {
        uris.push(uri);
      }
    }
    return uris;
  }

  /** Pinta, si hay algo que pintar, un bloque con TODAS las imágenes
   *  (apiladas en columna, en el orden de \`imageUris\`, a ancho completo —
   *  ver \`.mediaSection\`/\`.media\` en exportedStyles.ts) seguido del audio,
   *  si lo hay. \`imageUris\` ya viene resuelto (ver \`resolveImageUris\`). Solo
   *  la usa \`buildOption\` (la única imagen, 0 o 1 elemento, y el único audio
   *  de una respuesta) — los bloques de \`node.content\` se pintan con
   *  \`appendContentBlock\`, uno a uno, no agrupados. */
  function appendMedia(container, imageUris, audioUri, sectionClass, imageAlt) {
    if (imageUris.length === 0 && !audioUri) {
      return;
    }
    var section = el('div', sectionClass);
    for (var i = 0; i < imageUris.length; i += 1) {
      var image = el('img', 'media');
      image.src = imageUris[i];
      image.alt = imageAlt;
      section.appendChild(image);
    }
    if (audioUri) {
      var audio = el('audio', 'audio');
      audio.controls = true;
      audio.src = audioUri;
      section.appendChild(audio);
    }
    container.appendChild(section);
  }

  /** \`data:\` URI del audio adjunto de \`owner\` (una respuesta: mismo modelo
   *  de siempre, \`audioAssetId\` único — ver cabecera del archivo, los
   *  bloques de \`content\` solo aplican al NODO), o \`null\` si no tiene o no
   *  se pudo leer. */
  function resolveAudioUri(owner) {
    return owner.audioAssetId ? assetUris[owner.audioAssetId] || null : null;
  }

  function buildOption(response, index) {
    var wrapper = el('div', 'option');

    var button = el('button', 'optionButton');
    button.type = 'button';
    if (!response.targetNodeId) {
      button.disabled = true;
    }
    var bullet = el('span', 'optionBullet');
    bullet.setAttribute('aria-hidden', 'true');
    button.appendChild(bullet);
    var label = el('span', null);
    label.textContent = trimmed(response.text) || texts.emptyResponse;
    button.appendChild(label);
    button.addEventListener('click', function () {
      setState(choose(state, response.id));
    });
    wrapper.appendChild(button);

    var responseImageUris = response.imageAssetId
      ? resolveImageUris([response.imageAssetId])
      : [];
    appendMedia(
      wrapper,
      responseImageUris,
      resolveAudioUri(response),
      'optionMedia',
      texts.responseImageAlt + index,
    );

    return wrapper;
  }

  /** Traducción literal de \`IntroCard\` en \`src/player/PlayerScreen.tsx\`:
   *  contexto (ciclo · asignatura, ya resueltos, ver \`introCicloName\`/
   *  \`introAsignaturaName\` arriba) + \`caseName\` como título principal + botón
   *  de continuar con el mismo texto fijo que la vista 'continue' sin
   *  \`continueLabel\` propio (un \`intro\` no tiene ese campo). Cada pieza que
   *  falte (contexto vacío, \`caseName\` vacío) se omite sin más — mismo
   *  criterio de "vacío = nada" que el resto de este runtime. */
  function buildIntroCard(node) {
    var card = el('section', 'card');

    var contextLabel = [introCicloName, introAsignaturaName]
      .filter(function (value) {
        return !!value;
      })
      .join(' · ');
    if (contextLabel) {
      var context = el('p', 'introContext');
      context.textContent = contextLabel;
      card.appendChild(context);
    }

    var caseName = trimmed(node.caseName);
    if (caseName) {
      var heading = el('h1', 'title');
      heading.textContent = caseName;
      card.appendChild(heading);
    }

    var continueButton = el('button', 'primaryButton');
    continueButton.type = 'button';
    continueButton.textContent = texts.defaultContinueLabel;
    continueButton.addEventListener('click', function () {
      setState(advance(state));
    });
    card.appendChild(continueButton);

    return card;
  }

  function buildCard(view) {
    if (view.kind === 'intro') {
      return buildIntroCard(view.node);
    }

    var card = el('section', 'card');

    if (view.kind === 'continue') {
      // El título del nodo es solo referencia interna del diseñador
      // instruccional: nunca se pinta en el HTML/SCORM exportado (sí se ve,
      // en gris claro, dentro del Player de prueba de la app; ver
      // PlayerScreen.tsx). Los bloques de node.content se pintan en su
      // orden exacto (ver appendContent).
      appendContent(card, view.node, texts.emptySlideBody);
      var continueButton = el('button', 'primaryButton');
      continueButton.type = 'button';
      continueButton.textContent =
        trimmed(view.node.continueLabel) || texts.defaultContinueLabel;
      continueButton.addEventListener('click', function () {
        setState(advance(state));
      });
      card.appendChild(continueButton);
      return card;
    }

    if (view.kind === 'decision') {
      // Mismo criterio que en 'continue': el título del nodo no se pinta.
      // Las opciones vienen de \`view.visibleResponses\` (ya filtradas por
      // \`condition\` en \`getView\`), nunca de \`view.node.responses\` a pelo.
      appendContent(card, view.node, null);
      var options = el('div', 'options');
      var sorted = sortByLetter(view.visibleResponses || []);
      for (var i = 0; i < sorted.length; i += 1) {
        options.appendChild(buildOption(sorted[i], i + 1));
      }
      card.appendChild(options);
      return card;
    }

    if (view.kind === 'final') {
      scormReportCompletion(state.totalPoints);
      var heading = el('h1', 'title');
      heading.textContent = texts.finalTitle;
      card.appendChild(heading);
      appendBody(card, view.node, trimmed(view.node.title) || texts.finalFallbackBody);
      if (state.totalPoints !== null) {
        var points = el('p', 'points');
        points.textContent = texts.pointsPrefix + state.totalPoints + texts.pointsSuffix;
        card.appendChild(points);
      }

      // Fila de acciones: "Reintentar" (peligro) + "Salir" (neutro), una
      // junto a la otra. Sin clase propia en exportedStyles.ts (fuera de
      // alcance): flex simple vía \`style.cssText\`.
      var actions = el('div', null);
      actions.style.cssText = 'display:flex;align-items:center;gap:var(--bs-space-3);';

      var retryButton = el('button', 'dangerButton');
      retryButton.type = 'button';
      retryButton.textContent = texts.retry;
      retryButton.addEventListener('click', function () {
        setState(restart());
      });
      actions.appendChild(retryButton);

      // "Salir": estilo neutro (no es una acción destructiva como
      // "Reintentar"), reutilizando los mismos tokens --bs-* que ya define
      // exportedStyles.ts en :root para que se vea coherente con el resto de
      // la tarjeta, sin añadir ninguna clase a ese archivo.
      var exitButton = el('button', null);
      exitButton.type = 'button';
      exitButton.textContent = EXIT_BUTTON_LABEL;
      exitButton.style.cssText =
        'align-self:flex-start;padding:var(--bs-space-2) var(--bs-space-4);' +
        'border:1px solid var(--bs-color-border);border-radius:var(--bs-radius-sm);' +
        'background:var(--bs-color-bg);color:var(--bs-color-text);' +
        'font-size:var(--bs-font-size-md);font-weight:600;cursor:pointer;';
      exitButton.addEventListener('click', function () {
        // Finalización SCORM explícita ANTES de intentar cerrar: no depender
        // solo de que "beforeunload" llegue a dispararse a tiempo (ver
        // cabecera del archivo). Reutiliza scormFinish(), la misma función
        // que ya usa el listener de "beforeunload": no se duplica lógica.
        scormFinish();
        // Traducción literal de PlayerScreen.tsx (handleExitAttempt):
        // window.close() no lanza cuando el navegador lo bloquea (la
        // pestaña no la abrió un script), simplemente no hace nada, así que
        // no hace falta try/catch. El aviso de abajo se muestra siempre,
        // precisamente para cubrir ese caso.
        window.close();
        showExitMessage(card);
      });
      actions.appendChild(exitButton);

      card.appendChild(actions);
      return card;
    }

    var deadEnd = el('p', 'body');
    deadEnd.textContent = texts.deadEnd;
    card.appendChild(deadEnd);
    return card;
  }

  var state = getInitialState();

  function render() {
    root.textContent = '';
    root.appendChild(buildCard(getView(state)));
  }

  function setState(next) {
    state = next;
    render();
  }

  render();
})();
`
