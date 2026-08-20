# src/store

Store global (Zustand + Immer) que envuelve el `ProjectDocument` de
`src/domain` y expone al árbol de React sus acciones de mutación con
undo/redo, más el estado transitorio de edición (selección, menú
contextual, hover, modo preview, estado de guardado).

- `useProjectStore.ts` — store principal, acciones y comentario de diseño
  (historial, drag de nodos, viewport fuera del historial, etc.).
- `types.ts` — tipos de estado (`SelectionState`, `UiState`, `HistoryState`,
  `DragState`...).
- `selectors.ts` — hooks de conveniencia (`useProject`, `useCanUndo`,
  `useCanRedo`, `useSelectedNodeIds`, ...).
- `testHelpers.ts` — `resetProjectStore()`, solo para tests.
- `__tests__/` — tests de Vitest.

Todavía no implementado (fases posteriores): componentes React/React Flow
que consuman el store, autoguardado contra `src/persistence`, pantallas de
crear/abrir proyecto.
