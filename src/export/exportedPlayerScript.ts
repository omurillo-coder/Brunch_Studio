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
  var texts = bundle.texts || {};
  // Nombres de ciclo/asignatura de la portada (nodo \`intro\`), ya resueltos
  // contra el catálogo EN TIEMPO DE EXPORTACIÓN (ver
  // \`resolveIntroCatalogNames\` en \`htmlBundle.ts\`): este script no puede
  // importar \`src/domain/catalog.ts\` (JS vanilla embebido, sin módulos), así
  // que recibe ya el resultado (dos strings, o \`null\`) en vez del catálogo
  // entero.
  var introCicloName = bundle.introCicloName || null;
  var introAsignaturaName = bundle.introAsignaturaName || null;
  // Assets de marca de la portada (logo/ilustración/tipografía), ya
  // resueltos a \`data:\` URI EN TIEMPO DE EXPORTACIÓN — ver
  // \`resolvePlayerIntroBrandAssets\` en \`introBrandAssets.ts\`. \`null\` si
  // quien generó el bundle no los resolvió (no pasa en producción, ver
  // comentario de \`ExportBundle.introBrand\` en \`htmlBundle.ts\`); en ese
  // caso \`buildIntroCard\`/\`injectIntroBrandStyles\` degradan sin logo, sin
  // ilustración y con la tipografía de sistema de repuesto.
  var introBrand = bundle.introBrand || null;

  // Textos del botón "Salir" de la vista 'final' y de su aviso posterior.
  // Traducción literal de los mismos textos fijos de PlayerScreen.tsx
  // (\`handleExitAttempt\`). NO viajan por \`texts\` (bundle embebido, ver
  // \`ExportedTexts\`/\`EXPORTED_TEXTS\` en \`htmlBundle.ts\`) porque ese archivo
  // queda fuera del alcance de este cambio: se documenta aquí en vez de
  // silenciarlo.
  var EXIT_BUTTON_LABEL = 'Salir';
  var EXIT_MESSAGE = 'Ya puedes cerrar esta pestaña.';

  // Modo revisión profes ("Exportar revisión profes"): activo únicamente
  // cuando el bundle embebido trae \`reviewMode\`/\`teacherReview\` (ver
  // \`buildTeacherReviewBundle\` en \`src/export/teacherReviewExport.ts\`).
  // Cuando está activo, la capa de pintado de más abajo (\`render\`/
  // \`buildCard\`) añade una pantalla de bienvenida antes del recorrido,
  // "Diapositiva {número}" en cada tarjeta, un indicador de progreso + lista
  // de cobertura con salto directo, y una pantalla de felicitación al
  // alcanzar el 100% — ver la sección "Modo revisión profes" más abajo, justo
  // antes de \`render\`. El motor de recorrido de arriba
  // (\`getInitialState\`/\`getView\`/\`advance\`/\`choose\`/\`restart\`) no cambia EN
  // ABSOLUTO: solo se envuelve su resultado, nunca se reimplementa. Ausente
  // (\`undefined\`, \`!!undefined === false\`) en el export HTML/SCORM normal —
  // este mismo script sirve a los tres — y este modo nunca se activa desde
  // "Probar" dentro de la app, que usa \`PlayerScreen.tsx\`, un componente
  // de la interfaz de edición totalmente distinto que nunca importa este
  // archivo.
  var reviewMode = !!bundle.reviewMode;
  var teacherReview = bundle.teacherReview || null;

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

  /** Traducción literal de \`applyVisitEffects\` (\`src/player/runtime.ts\`,
   *  milestone "+1 fallo con Game Over"): aplica \`node.visitEffects\` (si los
   *  hay) al ENTRAR en \`nodeId\`, sea cual sea el camino por el que se llegó
   *  — se llama desde \`getInitialState\`/\`advance\`/\`choose\`, los tres únicos
   *  sitios donde cambia \`currentNodeId\`. Solo tiene efecto sobre un
   *  \`slide\` con \`visitEffects\`; en cualquier otro caso devuelve
   *  \`variables\` intacto. */
  function applyVisitEffects(variables, nodeId) {
    if (!nodeId) {
      return variables;
    }
    var node = findNode(nodeId);
    if (!node || node.type !== 'slide' || !node.visitEffects || node.visitEffects.length === 0) {
      return variables;
    }
    return applyVariableEffects(variables, node.visitEffects);
  }

  /** Traducción literal de \`shuffleIds\` (\`src/player/runtime.ts\`,
   *  petición de usuario: interruptor "Ordenar"/"Random"): Fisher-Yates
   *  sobre una copia de \`ids\`, nunca muta el array que recibe. */
  function shuffleIds(ids) {
    var shuffled = ids.slice();
    for (var i = shuffled.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var swap = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = swap;
    }
    return shuffled;
  }

  /** Traducción literal de \`computeShuffledResponseIds\` (\`src/player/runtime.ts\`):
   *  calcula el orden barajado que debe sembrar el estado al ENTRAR en
   *  \`nodeId\` — mismos tres puntos de llamada que \`applyVisitEffects\`
   *  (\`getInitialState\`/\`advance\`/\`choose\`, más abajo), por el mismo
   *  motivo: da igual el camino por el que se llega, el barajado debe
   *  repetirse en cada visita nueva. \`null\` si \`nodeId\` no es una
   *  diapositiva, no tiene \`responseOrder: 'random'\`, o tiene 0-1
   *  respuestas (nada que barajar). */
  function computeShuffledResponseIds(nodeId) {
    if (!nodeId) {
      return null;
    }
    var node = findNode(nodeId);
    if (
      !node ||
      node.type !== 'slide' ||
      node.responseOrder !== 'random' ||
      !node.responses ||
      node.responses.length <= 1
    ) {
      return null;
    }
    var ids = [];
    for (var i = 0; i < node.responses.length; i += 1) {
      ids.push(node.responses[i].id);
    }
    return shuffleIds(ids);
  }

  /** Traducción literal de \`orderResponses\` (\`src/player/runtime.ts\`):
   *  ordena \`responses\` (ya filtradas por \`condition\`) para presentación —
   *  por su posición en \`shuffledResponseIds\` si está sembrado
   *  (\`responseOrder: 'random'\`), o tal cual vienen (el propio orden del
   *  array \`node.responses\`, el que \`moveResponse\`/\`ResponseRow\` de
   *  \`Inspector.tsx\` deja reordenar a mano) si no — ya NO se ordena por
   *  \`letter\`, ver el comentario de \`SlideNodeSchema.responseOrder\` en
   *  \`src/domain/schemas.ts\`. */
  function orderResponses(responses, shuffledResponseIds) {
    if (!shuffledResponseIds) {
      return responses;
    }
    var position = {};
    for (var i = 0; i < shuffledResponseIds.length; i += 1) {
      position[shuffledResponseIds[i]] = i;
    }
    var ordered = responses.slice();
    ordered.sort(function (a, b) {
      var posA = position.hasOwnProperty(a.id) ? position[a.id] : 0;
      var posB = position.hasOwnProperty(b.id) ? position[b.id] : 0;
      return posA - posB;
    });
    return ordered;
  }

  /** Equivalente de \`resolveFinalBody\` (\`src/player/runtime.ts\`, milestone
   *  "+1 fallo con Game Over") adaptado a este runtime: a diferencia de la
   *  app (Tiptap disponible en tiempo de recorrido), aquí el HTML de CADA
   *  cuerpo posible se pre-renderiza EN TIEMPO DE EXPORTACIÓN
   *  (\`renderNodeBodies\` en \`htmlBundle.ts\`) e indexa en \`bodyHtml\` por
   *  clave — \`node.id\` para el \`body\` por defecto, \`node.id + ':alternate'\`
   *  para \`alternateBody\` (el mismo sufijo literal que
   *  \`ALTERNATE_BODY_KEY_SUFFIX\` en \`htmlBundle.ts\`: cambiar uno exige
   *  cambiar el otro). Esta función decide solo QUÉ CLAVE/texto plano usar,
   *  nunca genera HTML — eso ya está hecho. \`rawBody\` viaja además del id
   *  porque \`appendBody\` lo necesita para decidir "vacío = nada" (mismo
   *  criterio que con \`node.body\` de siempre). Ya NO distingue si resolvió
   *  al contenido por defecto o al alternativo en su valor de retorno
   *  (\`usedAlternate\`, quitado): con la petición de usuario de celebrar en
   *  los dos casos ("si llegas al final sin fallos y con fallos, en los
   *  dos"), el confeti es directamente \`node.celebrate\`, sin necesitar
   *  saber cuál de los dos se está mostrando — ver el punto de llamada más
   *  abajo, en \`render()\`. */
  function resolveFinalContent(node, variables) {
    if (
      node.alternateCondition &&
      node.alternateBody &&
      trimmed(node.alternateBody) &&
      evaluateCondition(variables, node.alternateCondition)
    ) {
      return { bodyId: node.id + ':alternate', rawBody: node.alternateBody };
    }
    return { bodyId: node.id, rawBody: node.body };
  }

  /** Traducción literal de \`Confetti\` (\`src/player/PlayerScreen.tsx\`,
   *  milestone "+1 fallo con Game Over", ampliada después a petición de
   *  usuario: "muy ESPECTACULAR") a DOM vanilla: mismo número de piezas,
   *  misma paleta, misma mezcla de formas/tamaños, mismo criterio de
   *  posición/color/temporización/vaivén/giro aleatorios — fijados aquí vía
   *  \`style.cssText\` (incluidas las variables CSS \`--confetti-*\` que lee
   *  \`confettiFall\` en \`exportedStyles.ts\`) en vez de una prop de estilo
   *  declarativa. Se llama una única vez por vista Final que celebra (ver su
   *  único punto de llamada en \`render()\`, más abajo) — nunca se actualiza
   *  in-place. */
  var CONFETTI_COLORS = [
    '#f0677a', '#22a5a0', '#f5b342', '#7c6bf0', '#4fb0e8', '#f2836b', '#ffd23f', '#ff5da2'
  ];
  var CONFETTI_PIECE_COUNT = 150;

  function buildConfetti() {
    var wrapper = el('div', 'confetti');
    wrapper.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < CONFETTI_PIECE_COUNT; i += 1) {
      var piece = el('span', 'confettiPiece');
      var left = Math.random() * 100;
      var color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      var isCircle = Math.random() < 0.5;
      var size = 6 + Math.random() * 8;
      var width = size;
      var height = isCircle ? size : size * 1.8;
      var borderRadius = isCircle ? '50%' : '2px';
      // Petición de usuario ("no que se frene en el final"): duraciones más
      // largas que la versión original (2.2s-3.8s) porque el recorrido
      // vertical también es mayor ahora (ver \`confettiFall\` en
      // exportedStyles.ts) — mantiene una velocidad de caída similar, no
      // más lenta.
      var duration = 2.8 + Math.random() * 2;
      var delay = Math.random() * 0.6;
      var rotateStart = Math.random() * 360;
      var spin = 360 + Math.random() * 720;
      var drift1 = (Math.random() - 0.5) * 90;
      var drift2 = (Math.random() - 0.5) * 90;
      var drift3 = (Math.random() - 0.5) * 90;
      var drift4 = (Math.random() - 0.5) * 90;
      piece.style.cssText =
        'left:' + left + '%;' +
        'width:' + width + 'px;' +
        'height:' + height + 'px;' +
        'border-radius:' + borderRadius + ';' +
        'background-color:' + color + ';' +
        'animation-duration:' + duration + 's;' +
        'animation-delay:' + delay + 's;' +
        '--confetti-rotate-start:' + rotateStart + 'deg;' +
        '--confetti-spin:' + spin + 'deg;' +
        '--confetti-drift-1:' + drift1 + 'px;' +
        '--confetti-drift-2:' + drift2 + 'px;' +
        '--confetti-drift-3:' + drift3 + 'px;' +
        '--confetti-drift-4:' + drift4 + 'px;';
      wrapper.appendChild(piece);
    }
    return wrapper;
  }

  function getInitialState() {
    var start = findNode(project.graph.startNodeId);
    var startId = start ? start.id : null;
    var variableDefs = project.variables || [];
    var variables = {};
    for (var i = 0; i < variableDefs.length; i += 1) {
      variables[variableDefs[i].id] = variableDefs[i].initialValue;
    }
    return {
      currentNodeId: startId,
      totalPoints: null,
      variables: applyVisitEffects(variables, startId),
      shuffledResponseIds: computeShuffledResponseIds(startId),
    };
  }

  function restart() {
    return getInitialState();
  }

  /** Traducción literal de \`getView\` (rama \`'decision'\`, \`src/player/runtime.ts\`,
   *  milestone "+1 fallo con Game Over"): una respuesta \`actsAsExit\` cuenta
   *  igual que una con \`targetNodeId\` a la hora de decidir si esto es una
   *  decisión ofrecible — no navega a ningún nodo, pero SÍ es una opción
   *  pulsable de verdad (ver \`buildResponseButton\`/\`handleExitAttempt\` más
   *  abajo). */
  function hasAnyTarget(responses) {
    for (var i = 0; i < responses.length; i += 1) {
      if (responses[i].targetNodeId || responses[i].actsAsExit) {
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
      var filteredResponses = visibleResponsesOf(responses, state.variables);
      var visibleResponses = orderResponses(filteredResponses, state.shuffledResponseIds);
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
      return {
        currentNodeId: node.targetNodeId,
        totalPoints: state.totalPoints,
        variables: applyVisitEffects(state.variables, node.targetNodeId),
        shuffledResponseIds: computeShuffledResponseIds(node.targetNodeId),
      };
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
    return {
      currentNodeId: target,
      totalPoints: state.totalPoints,
      variables: applyVisitEffects(state.variables, target),
      shuffledResponseIds: computeShuffledResponseIds(target),
    };
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
    var afterResponseEffects = applyVariableEffects(state.variables, response.effects || []);
    var variables = applyVisitEffects(afterResponseEffects, response.targetNodeId);
    return {
      currentNodeId: response.targetNodeId,
      totalPoints: totalPoints,
      variables: variables,
      shuffledResponseIds: computeShuffledResponseIds(response.targetNodeId),
    };
  }

  // -------------------------------------------------------------------------
  // Pintado (equivalente a src/player/PlayerScreen.tsx)
  // -------------------------------------------------------------------------

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
  /** \`bodyId\`/\`rawBody\` en vez de \`node\` directamente (milestone "+1 fallo
   *  con Game Over"): el único llamador (la vista 'final') necesita poder
   *  pedir el \`body\` por defecto O el alternativo, cada uno con su propia
   *  clave en \`bodyHtml\` — ver \`resolveFinalContent\`. */
  function appendBody(card, bodyId, rawBody, fallback) {
    var html = bodyHtml[bodyId];
    if (trimmed(rawBody) && html) {
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

  /** Clase de tamaño de \`.media\` para una imagen (petición de usuario: "un
   *  desplegable... Pequeño/Normal/Grande") — traducción literal de
   *  \`imageSizeClassName\` en \`src/player/PlayerScreen.tsx\`. \`undefined\`/
   *  \`'normal'\` usa el tamaño de siempre (\`mediaNormal\`, sin cambio visual
   *  para cualquier imagen ya existente sin \`size\` guardado). */
  function imageSizeClassName(size) {
    if (size === 'small') return 'mediaSmall';
    if (size === 'large') return 'mediaLarge';
    return 'mediaNormal';
  }

  var lightboxOverlay = null;

  /** Imagen ampliada a pantalla completa (petición de usuario: "las imágenes
   *  ampliables en la salida") — traducción literal de \`Lightbox\` en
   *  \`src/player/PlayerScreen.tsx\`. Vive fuera de \`root\` (igual que
   *  \`ensureCompletionOverlay\`/\`ensureReviewIndicator\` más abajo): se
   *  construye una única vez y solo se muestra/oculta, para no perder el
   *  listener de clic ni reconstruirla en cada \`render\`. */
  function ensureLightbox() {
    if (lightboxOverlay) {
      return lightboxOverlay;
    }
    var backdrop = el('div', 'lightboxBackdrop');
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.style.display = 'none';
    // Cierra al pulsar el fondo; \`stopPropagation\` en la imagen (más abajo)
    // evita que pulsarla A ELLA cierre el lightbox.
    backdrop.addEventListener('click', closeLightbox);

    var image = el('img', 'lightboxImage');
    image.addEventListener('click', function (event) {
      event.stopPropagation();
    });
    backdrop.appendChild(image);

    var closeButton = el('button', 'lightboxClose');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Cerrar imagen ampliada');
    closeButton.textContent = '×';
    closeButton.addEventListener('click', closeLightbox);
    backdrop.appendChild(closeButton);

    document.body.appendChild(backdrop);
    lightboxOverlay = { backdrop: backdrop, image: image };
    return lightboxOverlay;
  }

  function openLightbox(dataUri, alt) {
    var lightbox = ensureLightbox();
    lightbox.image.src = dataUri;
    lightbox.image.alt = alt;
    lightbox.backdrop.setAttribute('aria-label', alt);
    lightbox.backdrop.style.display = 'flex';
  }

  function closeLightbox() {
    if (lightboxOverlay) {
      lightboxOverlay.backdrop.style.display = 'none';
    }
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      closeLightbox();
    }
  });

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
      var image = el('img', 'media ' + imageSizeClassName(block.size));
      image.src = imageUri;
      image.alt = texts.nodeImageAlt;
      // Petición de usuario ("un botón... para hacer no ampliable la
      // imagen"): \`block.expandable === false\` (marcado explícito desde el
      // Inspector) es la ÚNICA forma de desactivarla; \`undefined\` (nunca
      // tocado) es ampliable por defecto — mismo criterio que
      // \`ContentBlockView\` en \`src/player/PlayerScreen.tsx\`.
      if (block.expandable === false) {
        card.appendChild(image);
        return;
      }
      var expandButton = el('button', 'expandableImage');
      expandButton.type = 'button';
      expandButton.setAttribute('aria-label', 'Ampliar imagen: ' + texts.nodeImageAlt);
      expandButton.addEventListener('click', function () {
        openLightbox(imageUri, texts.nodeImageAlt);
      });
      expandButton.appendChild(image);
      card.appendChild(expandButton);
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

  /** Intento de "salir": finalización SCORM + \`window.close()\` + aviso —
   *  factorizado del botón "Salir" de la vista 'final' (más abajo) para que
   *  una respuesta \`actsAsExit\` (milestone "+1 fallo con Game Over") lo
   *  reutilice tal cual, en vez de duplicar la secuencia. */
  function attemptExit(card) {
    // Finalización SCORM explícita ANTES de intentar cerrar: no depender
    // solo de que "beforeunload" llegue a dispararse a tiempo (ver cabecera
    // del archivo). Reutiliza scormFinish(), la misma función que ya usa el
    // listener de "beforeunload".
    scormFinish();
    // window.close() no lanza cuando el navegador lo bloquea (la pestaña no
    // la abrió un script), simplemente no hace nada, así que no hace falta
    // try/catch. El aviso de abajo se muestra siempre, precisamente para
    // cubrir ese caso.
    window.close();
    showExitMessage(card);
  }

  /** Resuelve una lista de assetId de imagen a sus \`data:\` URI ya
   *  embebidos, descartando (sin romper nada) los que no se pudieron leer
   *  en tiempo de exportación. Solo la usa \`buildOption\` (imagen de una
   *  respuesta, modelo sin cambios en este milestone): los bloques de imagen
   *  de \`node.content\` se resuelven directamente en \`appendContentBlock\`. */
  /** \`data:\` URI del audio adjunto de \`owner\` (una respuesta: mismo modelo
   *  de siempre, \`audioAssetId\` único — ver cabecera del archivo, los
   *  bloques de \`content\` solo aplican al NODO), o \`null\` si no tiene o no
   *  se pudo leer. */
  function resolveAudioUri(owner) {
    return owner.audioAssetId ? assetUris[owner.audioAssetId] || null : null;
  }

  /** Traducción literal de \`ResponseOption\` (\`src/player/PlayerScreen.tsx\`)
   *  — ver su comentario para la semántica completa de las tres peticiones
   *  de usuario que cubre: sin punto a la izquierda (flecha "→" fija al
   *  canto derecho, centrada respecto a TODA la tarjeta vía \`.optionArrow\`
   *  en exportedStyles.ts), imagen DENTRO del \`<button>\` (audio fuera, única
   *  excepción — no es contenido interactivo válido anidado en otro), y el
   *  texto de repuesto \`texts.emptyResponse\` SOLO cuando no hay texto NI
   *  imagen NI audio. */
  function buildOption(response, index, card) {
    var wrapper = el('div', 'option');

    var button = el('button', 'optionButton');
    button.type = 'button';
    // Milestone "+1 fallo con Game Over": una respuesta \`actsAsExit\` SÍ es
    // pulsable aunque no tenga \`targetNodeId\` (nunca lo tiene, ver
    // comentario de \`hasAnyTarget\`) — el propio botón, no \`disabled\`, la
    // distingue de una respuesta "de verdad" sin destino todavía.
    if (!response.targetNodeId && !response.actsAsExit) {
      button.disabled = true;
    }

    var content = el('span', 'optionContent');
    var trimmedText = trimmed(response.text);
    var hasMedia = Boolean(response.imageAssetId || response.audioAssetId);
    if (trimmedText || !hasMedia) {
      var label = el('span', null);
      label.textContent = trimmedText || texts.emptyResponse;
      content.appendChild(label);
    }
    var imageUri = response.imageAssetId ? assetUris[response.imageAssetId] : null;
    if (imageUri) {
      var image = el('img', 'media');
      image.src = imageUri;
      image.alt = texts.responseImageAlt + index;
      content.appendChild(image);
    }
    button.appendChild(content);

    var arrow = el('span', 'optionArrow');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    button.appendChild(arrow);

    button.addEventListener('click', function () {
      if (response.actsAsExit) {
        // Igual que el botón "Salir" de la vista 'final' (ver más abajo):
        // no navega a ningún nodo, se queda en esta misma diapositiva.
        attemptExit(card);
        return;
      }
      setState(choose(state, response.id));
    });
    wrapper.appendChild(button);

    var audioUri = resolveAudioUri(response);
    if (audioUri) {
      var mediaSection = el('div', 'optionMedia');
      var audio = el('audio', 'audio');
      audio.controls = true;
      audio.src = audioUri;
      mediaSection.appendChild(audio);
      wrapper.appendChild(mediaSection);
    }

    return wrapper;
  }

  /** Inyecta EN \`<head>\`, UNA sola vez al arrancar (llamada junto a
   *  \`render()\` al final de este script), los dos valores de \`introBrand\`
   *  que \`exportedStyles.ts\` NO puede incluir por ser un string estático
   *  sin interpolación (ver comentario de esa sección): los dos
   *  \`@font-face\` de FS Millbank, como \`data:\` URI. Sin \`introBrand\` (ver
   *  comentario de esa variable más arriba) no hace nada: el texto cae a
   *  \`var(--bs-font-sans)\`, degradación correcta, no un error.
   *
   *  El \`background-image\` de \`.introIllustration\` (la portada) SÍ se
   *  inyecta aquí, por el mismo motivo que las tipografías. La ilustración
   *  de "Game Over" NO — a diferencia de la portada, es un \`<img>\` de
   *  verdad (petición de usuario: "todo centrado"), así que
   *  \`buildGameOverCard\` le fija \`src\` directamente, igual que ya hace con
   *  el logo. */
  function injectIntroBrandStyles() {
    if (!introBrand) {
      return;
    }
    var style = el('style', null);
    style.textContent =
      "@font-face { font-family: 'FS Millbank'; src: url('" +
      introBrand.fontRegularDataUri +
      "') format('opentype'); font-weight: 400; font-style: normal; font-display: swap; }" +
      "@font-face { font-family: 'FS Millbank'; src: url('" +
      introBrand.fontBoldDataUri +
      "') format('opentype'); font-weight: 700; font-style: normal; font-display: swap; }" +
      '.introIllustration { background-image: url("' +
      introBrand.backgroundDataUri +
      '"); }';
    document.head.appendChild(style);
  }

  /** Traducción literal de \`IntroCard\` en \`src/player/PlayerScreen.tsx\`:
   *  logo + titular fijo de marca (\`texts.introHeading\`/subtítulo con
   *  "decisiones" en acento) + ciclo/asignatura pequeños bajo el botón +
   *  \`caseName\` junto al botón de continuar (mismo texto fijo que la vista
   *  'continue' sin \`continueLabel\` propio, un \`intro\` no tiene ese campo)
   *  + ilustración de fondo a pantalla completa. A diferencia del resto de
   *  vistas de este runtime ("vacío" se omite sin más), aquí cada pieza que
   *  falte (ciclo/asignatura sin elegir, \`caseName\` vacío) se sustituye por
   *  un placeholder gris (\`texts.introCicloPlaceholder\` y compañía) — ver
   *  comentario de \`IntroCard\`. */
  function buildIntroCard(node) {
    var card = el('section', 'introCard');

    var illustration = el('div', 'introIllustration');
    illustration.setAttribute('aria-hidden', 'true');
    card.appendChild(illustration);

    var content = el('div', 'introContent');
    card.appendChild(content);

    if (introBrand && introBrand.logoDataUri) {
      var logo = el('img', 'introLogo');
      logo.src = introBrand.logoDataUri;
      logo.alt = 'iLERNA';
      content.appendChild(logo);
    }

    var headingGroup = el('div', 'introHeadingGroup');
    var heading = el('h1', 'introHeading');
    heading.textContent = texts.introHeading;
    headingGroup.appendChild(heading);
    var subtitle = el('p', 'introSubtitle');
    subtitle.appendChild(document.createTextNode(texts.introSubtitlePrefix));
    var accent = el('span', 'introSubtitleAccent');
    accent.textContent = texts.introSubtitleAccent;
    subtitle.appendChild(accent);
    subtitle.appendChild(document.createTextNode(texts.introSubtitleSuffix));
    headingGroup.appendChild(subtitle);
    content.appendChild(headingGroup);

    var footer = el('div', 'introFooter');
    var caseName = trimmed(node.caseName);
    var caseTitle = el('p', caseName ? 'introCaseTitle' : 'introCaseTitlePlaceholder');
    caseTitle.textContent = caseName || texts.introCaseNamePlaceholder;
    footer.appendChild(caseTitle);

    var continueButton = el('button', 'introButton');
    continueButton.type = 'button';
    continueButton.textContent = texts.defaultContinueLabel;
    continueButton.addEventListener('click', function () {
      setState(advance(state));
    });
    footer.appendChild(continueButton);
    content.appendChild(footer);

    var meta = el('div', 'introMeta');
    var cicloLine = el('p', introCicloName ? 'introMetaLine' : 'introMetaLinePlaceholder');
    cicloLine.textContent = introCicloName || texts.introCicloPlaceholder;
    meta.appendChild(cicloLine);
    var asignaturaLine = el(
      'p',
      introAsignaturaName ? 'introMetaLine' : 'introMetaLinePlaceholder',
    );
    asignaturaLine.textContent = introAsignaturaName || texts.introAsignaturaPlaceholder;
    meta.appendChild(asignaturaLine);
    content.appendChild(meta);

    return card;
  }

  /**
   * Traducción literal de \`resolveGameOverResponses\` en
   * \`src/player/PlayerScreen.tsx\`: resuelve los dos ROLES fijos de la
   * pantalla ("Reintentar"/"Salir") por \`actsAsExit\`, NUNCA por posición en
   * \`responses\` (corrección de revisión de código: la versión anterior
   * pasaba \`view.visibleResponses[0]\`/\`[1]\` directamente a
   * \`buildGameOverCard\`, así que el interruptor "Ordenar"/"Random" del
   * Inspector — disponible en cualquier diapositiva, sin excepción para
   * \`brandedGameOverScreen\` — podía dejar el botón "Reintentar" disparando
   * la respuesta \`actsAsExit\` y viceversa). \`null\` si no hay EXACTAMENTE
   * una \`actsAsExit\` y una que no lo sea.
   */
  function resolveGameOverResponses(responses) {
    if (!responses || responses.length !== 2) {
      return null;
    }
    var exitResponse = null;
    var retryResponse = null;
    for (var i = 0; i < responses.length; i += 1) {
      if (responses[i].actsAsExit) {
        exitResponse = responses[i];
      } else {
        retryResponse = responses[i];
      }
    }
    if (!exitResponse || !retryResponse) {
      return null;
    }
    return { retryResponse: retryResponse, exitResponse: exitResponse };
  }

  /**
   * Traducción literal de \`GameOverCard\` en \`src/player/PlayerScreen.tsx\`:
   * logo + título fijo (\`texts.gameOverHeading\`) + ilustración (un
   * \`<img>\` de verdad, no un fondo) + dos botones SUPERPUESTOS sobre su
   * tramo inferior (ver \`.gameOverIllustrationWrap\`/\`.gameOverButtons\` en
   * \`exportedStyles.ts\`) cuyo TEXTO es fijo ("Reintentar"/"Salir") pero
   * cuyo COMPORTAMIENTO es el real de \`retryResponse\`/\`exitResponse\` — ya
   * resueltas por ROL, no por posición, por \`resolveGameOverResponses\` —
   * misma lógica de clic que ya usa \`buildOption\` para cualquier respuesta
   * genérica (\`actsAsExit\` -> \`attemptExit\`, si no ->
   * \`setState(choose(state, response.id))\`), nunca un comportamiento
   * hardcodeado nuevo. Ningún otro contenido del nodo (bloques de \`content\`)
   * se pinta aquí — mismo criterio que \`buildIntroCard\`.
   */
  function buildGameOverCard(retryResponse, exitResponse) {
    var card = el('section', 'gameOverCard');

    if (introBrand && introBrand.logoDataUri) {
      var logo = el('img', 'gameOverLogo');
      logo.src = introBrand.logoDataUri;
      logo.alt = 'iLERNA';
      card.appendChild(logo);
    }

    var heading = el('h1', 'gameOverHeading');
    heading.textContent = texts.gameOverHeading;
    card.appendChild(heading);

    // Envoltorio \`position: relative\` (petición de usuario: "los botones
    // podrían salir en la parte de abajo de la imagen, encima de ella"):
    // ancla \`.gameOverButtons\` (\`position: absolute\`) sobre el tramo
    // inferior de la ilustración en vez de dejarlos en flujo normal debajo.
    var illustrationWrap = el('div', 'gameOverIllustrationWrap');
    card.appendChild(illustrationWrap);

    if (introBrand && introBrand.gameOverBackgroundDataUri) {
      var illustration = el('img', 'gameOverIllustration');
      illustration.src = introBrand.gameOverBackgroundDataUri;
      illustration.alt = '';
      illustration.setAttribute('aria-hidden', 'true');
      illustrationWrap.appendChild(illustration);
    }

    function buildGameOverButton(response, className, label) {
      var button = el('button', className);
      button.type = 'button';
      button.textContent = label;
      // Mismo criterio que \`disabled\` de \`buildOption\` en el layout genérico:
      // sin destino conectado (y sin \`actsAsExit\`, que "Salir" siempre trae),
      // el botón se ve inactivo en vez de aceptar un clic que no lleva a
      // ninguna parte — relevante mientras el diseñador no ha conectado
      // "Reintentar" (nace sin destino, ver \`addGameOverPack\`).
      if (!response.targetNodeId && !response.actsAsExit) {
        button.disabled = true;
      }
      button.addEventListener('click', function () {
        if (response.actsAsExit) {
          // Igual que \`buildOption\`: no navega a ningún nodo, se queda en
          // esta misma diapositiva.
          attemptExit(card);
          return;
        }
        setState(choose(state, response.id));
      });
      return button;
    }

    var buttons = el('div', 'gameOverButtons');
    buttons.appendChild(buildGameOverButton(retryResponse, 'gameOverButtonPrimary', 'Reintentar'));
    buttons.appendChild(buildGameOverButton(exitResponse, 'gameOverButtonSecondary', 'Salir'));
    illustrationWrap.appendChild(buttons);

    return card;
  }

  function buildCard(view) {
    if (view.kind === 'intro') {
      return buildIntroCard(view.node);
    }

    // Pantalla bespoke "Game Over" (\`brandedGameOverScreen\`, ver comentario
    // de \`buildGameOverCard\`/\`resolveGameOverResponses\`): sustituye el
    // layout genérico de decisión de más abajo SOLO cuando el nodo lo pide Y
    // tiene exactamente una respuesta \`actsAsExit\` y otra que no lo es —
    // mismo fallback que \`PlayerScreen.tsx\` (cualquier otro caso cae al
    // layout genérico, en vez de arriesgarse a un índice fuera de rango o a
    // una asignación de rol ambigua).
    if (view.kind === 'decision' && view.node.brandedGameOverScreen) {
      var gameOverResponses = resolveGameOverResponses(view.visibleResponses);
      if (gameOverResponses) {
        return buildGameOverCard(gameOverResponses.retryResponse, gameOverResponses.exitResponse);
      }
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
      // Las opciones vienen de \`view.visibleResponses\` — ya filtradas por
      // \`condition\` Y ordenadas para presentación (\`orderResponses\`) en
      // \`getView\`, nunca de \`view.node.responses\` a pelo ni reordenadas
      // aquí (petición de usuario "Ordenar"/"Random": ya no se ordena por
      // letra, ver el comentario de \`orderResponses\` más arriba).
      appendContent(card, view.node, null);
      var options = el('div', 'options');
      var visibleResponses = view.visibleResponses || [];
      for (var i = 0; i < visibleResponses.length; i += 1) {
        options.appendChild(buildOption(visibleResponses[i], i + 1, card));
      }
      card.appendChild(options);
      return card;
    }

    if (view.kind === 'final') {
      scormReportCompletion(state.totalPoints);
      var finalContent = resolveFinalContent(view.node, state.variables);
      // Confeti (milestone "+1 fallo con Game Over", petición de usuario
      // ampliada después: "si llegas al final sin fallos y con fallos, en
      // los dos"): traducción literal de \`view.celebrate\` en
      // \`src/player/runtime.ts\`/\`PlayerScreen.tsx\` — sobre CUALQUIER
      // contenido de este Final, el por defecto y el alternativo.
      if (view.node.celebrate === true) {
        card.appendChild(buildConfetti());
      }
      var heading = el('h1', 'title');
      heading.textContent = texts.finalTitle;
      card.appendChild(heading);
      appendBody(
        card,
        finalContent.bodyId,
        finalContent.rawBody,
        trimmed(view.node.title) || texts.finalFallbackBody,
      );
      if (state.totalPoints !== null) {
        var points = el('p', 'points');
        points.textContent = texts.pointsPrefix + state.totalPoints + texts.pointsSuffix;
        card.appendChild(points);
      }

      // Fila de acciones: "Reintentar" (acento, mismo estilo que
      // "Continuar") + "Salir" (neutro), una junto a la otra. Sin clase
      // propia en exportedStyles.ts (fuera de alcance): flex simple vía
      // \`style.cssText\`.
      var actions = el('div', null);
      actions.style.cssText = 'display:flex;align-items:center;gap:var(--bs-space-3);';

      var retryButton = el('button', 'primaryButton');
      retryButton.type = 'button';
      retryButton.textContent = texts.retry;
      retryButton.addEventListener('click', function () {
        setState(restart());
      });
      actions.appendChild(retryButton);

      // "Salir": estilo neutro (no es la acción principal de esta fila),
      // reutilizando los mismos tokens --bs-* que ya define
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
        attemptExit(card);
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

  // -------------------------------------------------------------------------
  // Modo revisión profes: capa de presentación, ver \`reviewMode\`/
  // \`teacherReview\` arriba. Nada de lo de aquí abajo toca \`getInitialState\`/
  // \`getView\`/\`advance\`/\`choose\`/\`restart\` (motor de recorrido, sección de
  // arriba): solo lee su resultado (\`state\`, \`getView(state)\`) para decidir
  // qué pintar ALREDEDOR de la tarjeta que ya construye \`buildCard\`, y usa
  // \`setState\` (la misma función que ya usan \`advance\`/\`choose\`/\`restart\`)
  // para saltar de una diapositiva a otra desde la lista de cobertura.
  // -------------------------------------------------------------------------

  var REVIEW_STORAGE_PREFIX = 'brunch-teacher-review:';

  /** Namespacing por \`project.metadata.id\` (UUID único del documento): dos
   *  proyectos distintos revisados desde el mismo navegador nunca mezclan su
   *  progreso, aunque un HTML exportado con \`file://\` pueda compartir origen
   *  de almacenamiento con otro según el navegador. Limitación residual
   *  conocida y documentada (no resuelta aquí, caso raro): si DOS personas
   *  revisan la MISMA copia exacta del archivo exportado en el MISMO
   *  navegador del MISMO ordenador, comparten esta misma clave y por tanto
   *  el mismo progreso guardado. */
  function reviewStorageKey() {
    var projectId = project.metadata && project.metadata.id ? project.metadata.id : 'unknown';
    return REVIEW_STORAGE_PREFIX + projectId;
  }

  /** Nunca lanza: sin \`localStorage\` disponible (modo privado agresivo,
   *  cuota agotada, \`file://\` en un navegador que lo bloquee del todo) el
   *  modo revisión sigue funcionando en memoria durante esta sesión, solo
   *  sin persistir entre recargas. */
  function loadReviewProgress() {
    try {
      var raw = window.localStorage.getItem(reviewStorageKey());
      if (!raw) {
        return { visited: [], completed: false };
      }
      var parsed = JSON.parse(raw);
      return {
        visited: Array.isArray(parsed.visited) ? parsed.visited : [],
        completed: !!parsed.completed,
      };
    } catch (error) {
      return { visited: [], completed: false };
    }
  }

  function saveReviewProgress(progress) {
    try {
      window.localStorage.setItem(reviewStorageKey(), JSON.stringify(progress));
    } catch (error) {
      // Silencioso a propósito, ver \`loadReviewProgress\`.
    }
  }

  var reviewProgress = reviewMode ? loadReviewProgress() : { visited: [], completed: false };
  // Todos los nodos del proyecto, por \`number\` ascendente — Inicio + todas
  // las diapositivas + TODOS los finales, cada uno cuenta igual (mismo
  // criterio que el denominador del progreso, ver \`reviewPercent\`).
  var allNodesByNumber = reviewMode
    ? project.graph.nodes.slice().sort(function (a, b) {
        return a.number - b.number;
      })
    : [];
  var totalReviewNodeCount = allNodesByNumber.length;

  function isNodeVisited(nodeId) {
    return reviewProgress.visited.indexOf(nodeId) !== -1;
  }

  /** Marca \`nodeId\` como visitado (idempotente) y persiste. Saltar desde la
   *  lista de cobertura cuenta igual que llegar por el camino normal: ambos
   *  pasan por aquí, ninguno se distingue del otro. */
  function markNodeVisited(nodeId) {
    if (!nodeId || isNodeVisited(nodeId)) {
      return;
    }
    reviewProgress.visited.push(nodeId);
    saveReviewProgress(reviewProgress);
  }

  function reviewPercent() {
    if (totalReviewNodeCount === 0) {
      return 0;
    }
    return Math.round((reviewProgress.visited.length / totalReviewNodeCount) * 100);
  }

  /** "Diapositiva {número}" (palabra completa, nunca la abreviatura "D{número}"
   *  del editor) — prominente, en la parte de arriba de la tarjeta, antes del
   *  propio contenido. La referencia que el profesor usa en su hoja de
   *  validación externa. */
  function buildReviewSlideLabel(number) {
    var label = el('p', 'reviewSlideLabel');
    label.textContent = 'Diapositiva ' + number;
    return label;
  }

  /** Pantalla de bienvenida (texto fijo del bundle, ver \`teacherReview.welcomeText\`
   *  en \`src/export/teacherReviewExport.ts\`), mostrada ANTES de la diapositiva
   *  de Inicio real cada vez que se abre el archivo — no se persiste que ya
   *  se vio, a diferencia del progreso de cobertura. Un salto de línea del
   *  texto original es un párrafo aparte, para respetarlos tal cual. */
  function buildWelcomeCard() {
    var card = el('section', 'card');
    var lines = (teacherReview.welcomeText || '').split('\\n');
    for (var i = 0; i < lines.length; i += 1) {
      var paragraph = el('p', 'body');
      paragraph.textContent = lines[i];
      card.appendChild(paragraph);
    }
    var button = el('button', 'primaryButton');
    button.type = 'button';
    button.textContent = texts.defaultContinueLabel;
    button.addEventListener('click', function () {
      welcomeDismissed = true;
      render();
    });
    card.appendChild(button);
    return card;
  }

  var welcomeDismissed = false;
  var completionOverlay = null;

  /** Construye (una única vez) el overlay de felicitación al 100%: texto fijo
   *  + imagen del pingüino (ya embebida como \`data:\` URI en tiempo de
   *  exportación, ver \`teacherReview.penguinDataUri\`) + "Continuar", que solo
   *  cierra el overlay — deja seguir navegando con normalidad por si el
   *  profesor quiere revisar algo de nuevo. */
  function ensureCompletionOverlay() {
    if (completionOverlay) {
      return completionOverlay;
    }
    var overlay = el('div', 'reviewOverlayBackdrop');
    var card = el('section', 'card');

    var message = el('p', 'body');
    message.textContent = teacherReview.completionText || '';
    card.appendChild(message);

    if (teacherReview.penguinDataUri) {
      var image = el('img', 'reviewPenguin');
      image.src = teacherReview.penguinDataUri;
      image.alt = 'Pingüino felicitando por haber completado la revisión';
      card.appendChild(image);
    }

    var button = el('button', 'primaryButton');
    button.type = 'button';
    button.textContent = texts.defaultContinueLabel;
    button.addEventListener('click', function () {
      overlay.style.display = 'none';
    });
    card.appendChild(button);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    completionOverlay = overlay;
    return overlay;
  }

  function showCompletionOverlay() {
    ensureCompletionOverlay().style.display = 'flex';
  }

  /** Si el progreso ACABA de llegar al 100% (y todavía no se había mostrado
   *  la felicitación ni una sola vez, ver \`reviewProgress.completed\`
   *  persistido), la muestra y lo recuerda para no repetirla en cargas
   *  futuras. */
  function maybeShowCompletion() {
    if (reviewProgress.completed) {
      return;
    }
    if (totalReviewNodeCount === 0 || reviewProgress.visited.length < totalReviewNodeCount) {
      return;
    }
    reviewProgress.completed = true;
    saveReviewProgress(reviewProgress);
    showCompletionOverlay();
  }

  var reviewIndicator = null;
  var reviewPanelOpen = false;

  /** Indicador de progreso persistente (esquina superior derecha, siempre
   *  visible) + lista de cobertura desplegable. Vive fuera de \`root\` (que
   *  \`render\` vacía en cada pintado) para no reconstruirse entera cada vez;
   *  solo su CONTENIDO se actualiza, ver \`updateReviewIndicator\`. */
  function ensureReviewIndicator() {
    if (reviewIndicator) {
      return reviewIndicator;
    }
    var wrapper = el('div', 'reviewIndicator');

    var button = el('button', 'reviewIndicatorButton');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'true');
    button.addEventListener('click', function () {
      reviewPanelOpen = !reviewPanelOpen;
      updateReviewIndicator();
    });
    wrapper.appendChild(button);

    var panel = el('div', 'reviewPanel');
    wrapper.appendChild(panel);

    document.body.appendChild(wrapper);
    reviewIndicator = { wrapper: wrapper, button: button, panel: panel };
    return reviewIndicator;
  }

  /** Salta directamente a \`nodeId\` (lista de cobertura, tarea "salto
   *  directo"): sin rejugar el árbol de decisiones para llegar hasta ahí.
   *  Reutiliza \`setState\`, la MISMA función que \`advance\`/\`choose\`/\`restart\`
   *  — un salto cuenta igual que llegar por el camino normal, sin ninguna
   *  distinción de estado. */
  function jumpToReviewNode(nodeId) {
    reviewPanelOpen = false;
    setState({ currentNodeId: nodeId, totalPoints: state.totalPoints, variables: state.variables });
  }

  function buildReviewPanelItemHandler(nodeId) {
    return function () {
      jumpToReviewNode(nodeId);
    };
  }

  function updateReviewIndicator() {
    var indicator = ensureReviewIndicator();
    var percent = reviewPercent();
    indicator.button.textContent = percent + '% revisado';
    indicator.panel.style.display = reviewPanelOpen ? 'flex' : 'none';

    indicator.panel.textContent = '';
    for (var i = 0; i < allNodesByNumber.length; i += 1) {
      var node = allNodesByNumber[i];
      var visited = isNodeVisited(node.id);
      var item = el('button', visited ? 'reviewPanelItem reviewPanelItemVisited' : 'reviewPanelItem');
      item.type = 'button';
      item.textContent = (visited ? '✓ ' : '') + 'Diapositiva ' + node.number;
      item.addEventListener('click', buildReviewPanelItemHandler(node.id));
      indicator.panel.appendChild(item);
    }
  }

  var state = getInitialState();

  function render() {
    root.textContent = '';

    if (reviewMode && !welcomeDismissed) {
      root.appendChild(buildWelcomeCard());
      updateReviewIndicator();
      return;
    }

    var view = getView(state);
    if (reviewMode) {
      markNodeVisited(view.node ? view.node.id : null);
    }

    var card = buildCard(view);
    if (reviewMode && view.node) {
      card.insertBefore(buildReviewSlideLabel(view.node.number), card.firstChild);
    }
    root.appendChild(card);

    if (reviewMode) {
      updateReviewIndicator();
      maybeShowCompletion();
    }
  }

  function setState(next) {
    state = next;
    render();
  }

  injectIntroBrandStyles();
  render();
})();
`
