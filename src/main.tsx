import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/global.css'
import App from './App.tsx'

/**
 * En el build empaquetado, el clic derecho abre el menú contextual nativo
 * del WebView (WKWebView en macOS, WebView2 en Windows) — "Recargar",
 * "Atrás"/"Adelante", "Inspeccionar"... nada de eso tiene sentido en una
 * app de escritorio empaquetada (no hay navegación de página que
 * recargar). Se desactiva con un `preventDefault` global sobre el evento
 * `contextmenu`.
 *
 * Solo en producción (`import.meta.env.PROD`): en desarrollo (`vite dev`,
 * también cuando se abre la app en el navegador para depurar) el clic
 * derecho sigue dando acceso a "Inspeccionar" y al resto de herramientas
 * del navegador, que sí hacen falta para depurar.
 */
if (import.meta.env.PROD) {
  document.addEventListener('contextmenu', (event) => event.preventDefault())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
