# src/persistence

Capa de persistencia del `ProjectDocument` (fase 2 del milestone: solo la
capa de repositorio + comandos Tauri en Rust; el store/autoguardado real
desde la UI llegará en una fase posterior).

- `ProjectRepository`: interfaz (`createProject`/`openProject`/`saveProject`).
- `TauriProjectRepository`: implementación real, vía `invoke()` a los
  comandos Tauri `create_branch_project` / `open_branch_project` /
  `save_branch_project` (ver `src-tauri/src/commands/mod.rs`). Valida con
  `ProjectDocumentSchema.parse` todo lo que llega de Rust.
- `MemoryProjectRepository`: implementación en memoria (`Map`), para tests
  de UI sin backend Tauri real.

Ningún componente React usa todavía este repositorio.
