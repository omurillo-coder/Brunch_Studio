# src/editor

Componentes de pantalla del editor.

- `HomeScreen/`: pantalla inicial (crear/abrir proyecto).
- `EditorScreen/`: shell del editor (barra superior + panel izquierdo +
  lienzo + inspector).
- `Topbar/`, `LeftPanel/`, `Inspector/`, `CanvasPlaceholder/`: piezas de
  `EditorScreen`, cada una en su propio fichero.

Pendiente de fases posteriores: lienzo real con React Flow (interactividad
de grafo, `CanvasPlaceholder` es solo el área reservada), edición completa
de respuestas de Decisión en el inspector, creación de nodos arrastrando
desde una conexión, runtime del Player, y autoguardado real.
