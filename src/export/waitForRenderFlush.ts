/**
 * Corrección de revisión de código: los 3 hooks de exportación con
 * validación bloqueante (`useHtmlExport`/`useScormExport`/
 * `useTeacherReviewExport`) hacen `setMessage(null)` y, si el proyecto no
 * está listo, `setMessage(blockingExportIssuesMessage(...))` en el MISMO
 * tick síncrono (sin ningún `await` de por medio) — React 18 agrupa (batch)
 * ambas actualizaciones en un único render, así que `message` NUNCA llega a
 * pintarse como `null` de verdad entre dos intentos de exportación
 * bloqueados seguidos.
 *
 * Esto rompe la premisa documentada en `ExportToast`
 * (`src/editor/Topbar/Topbar.tsx`): "una exportación nueva siempre desmonta
 * el aviso anterior y monta uno fresco" — sin ese desmontaje real, la
 * máquina de fases del aviso (que arranca UNA vez, al montar) no se
 * reinicia, y un segundo intento bloqueado después de que el primer aviso
 * ya haya terminado su fundido de salida no muestra NADA.
 *
 * `await waitForRenderFlush()` entre los dos `setMessage` fuerza a React a
 * confirmar el render con `message: null` antes de continuar, restaurando
 * la premisa de la que depende `ExportToast` — sin tocar su máquina de
 * fases ni forzar un `key` artificial en cada punto de montaje.
 */
export function waitForRenderFlush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
