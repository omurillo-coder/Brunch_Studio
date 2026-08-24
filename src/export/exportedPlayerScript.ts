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

  function getInitialState() {
    var start = findNode(project.graph.startNodeId);
    return { currentNodeId: start ? start.id : null, totalPoints: null };
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

  function getView(state) {
    if (state.currentNodeId === null) {
      return { kind: 'dead-end', node: null };
    }

    var node = findNode(state.currentNodeId);
    if (!node) {
      return { kind: 'dead-end', node: null };
    }

    if (node.type === 'final') {
      return { kind: 'final', node: node };
    }

    var responses = node.responses || [];
    if (responses.length > 0) {
      return hasAnyTarget(responses)
        ? { kind: 'decision', node: node }
        : { kind: 'dead-end', node: node };
    }

    return node.targetNodeId
      ? { kind: 'continue', node: node }
      : { kind: 'dead-end', node: node };
  }

  function advance(state) {
    if (state.currentNodeId === null) {
      return state;
    }
    var node = findNode(state.currentNodeId);
    if (!node || node.type !== 'slide') {
      return state;
    }
    var responses = node.responses || [];
    if (responses.length > 0 || !node.targetNodeId) {
      return state;
    }
    return { currentNodeId: node.targetNodeId, totalPoints: state.totalPoints };
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
    return { currentNodeId: response.targetNodeId, totalPoints: totalPoints };
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

  function appendTitle(card, node) {
    if (!trimmed(node.title)) {
      return;
    }
    var heading = el('h1', 'title');
    heading.textContent = node.title;
    card.appendChild(heading);
  }

  /** Cuerpo enriquecido ya renderizado en tiempo de exportación (Tiptap ->
   *  HTML estático). \`fallback\` se pinta como texto plano cuando el nodo no
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

  function appendMedia(container, owner, sectionClass, imageAlt) {
    var imageUri = owner.imageAssetId ? assetUris[owner.imageAssetId] : null;
    var audioUri = owner.audioAssetId ? assetUris[owner.audioAssetId] : null;
    if (!imageUri && !audioUri) {
      return;
    }
    var section = el('div', sectionClass);
    if (imageUri) {
      var image = el('img', 'media');
      image.src = imageUri;
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

    appendMedia(wrapper, response, 'optionMedia', texts.responseImageAlt + index);

    return wrapper;
  }

  function buildCard(view) {
    var card = el('section', 'card');

    if (view.kind === 'continue') {
      appendTitle(card, view.node);
      appendBody(card, view.node, texts.emptySlideBody);
      appendMedia(card, view.node, 'mediaSection', texts.nodeImageAlt);
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
      appendTitle(card, view.node);
      appendBody(card, view.node, null);
      appendMedia(card, view.node, 'mediaSection', texts.nodeImageAlt);
      var options = el('div', 'options');
      var sorted = sortByLetter(view.node.responses || []);
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
      var retryButton = el('button', 'dangerButton');
      retryButton.type = 'button';
      retryButton.textContent = texts.retry;
      retryButton.addEventListener('click', function () {
        setState(restart());
      });
      card.appendChild(retryButton);
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
