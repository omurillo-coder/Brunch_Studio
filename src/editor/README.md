# src/editor

Componentes de pantalla del editor.

- `HomeScreen/`: pantalla inicial (crear/abrir proyecto).
- `EditorScreen/`: shell del editor (barra superior + panel izquierdo +
  lienzo + inspector).
- `Topbar/`, `LeftPanel/`, `Inspector/`: piezas de `EditorScreen`, cada una
  en su propio fichero.
- `Canvas/`: lienzo real sobre `@xyflow/react` (fase 5). `Canvas.tsx` es el
  componente; `adapter.ts` traduce `ProjectDocument` (dominio) a
  `nodes`/`edges` de `@xyflow/react` (funciones puras, testeadas sin montar
  el lienzo); `handles.ts` define los ids de handle de conexión
  (`out`/`in`/`response:<id>`); `nodes/nodeTypes.tsx` son los 4 nodos
  personalizados (Inicio/Pantalla/Decisión/Final). `@xyflow/react` nunca es
  una segunda fuente de verdad: `nodes`/`edges` se recalculan en cada render
  a partir del store (ver comentario de diseño en `Canvas.tsx`).

Pendiente de fases posteriores: edición completa de respuestas de Decisión
en el inspector (añadir/eliminar, elegir destino por desplegable), menú
contextual "¿Qué quieres añadir?" al soltar una conexión en el vacío,
runtime del Player, y autoguardado real.
