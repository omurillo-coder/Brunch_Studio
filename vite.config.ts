import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Puerto fijo 1420 para que coincida con `build.devUrl` en src-tauri/tauri.conf.json.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    // Los assets de `introBrandAssets.ts` (`?url` + `fetch()`, ver su
    // comentario de cabecera) necesitan resolver a un archivo de verdad,
    // nunca a un `data:` URI ya inlinado por Vite — si no, `fetch()`
    // recibiría el propio `data:` URI en vez de una URL real, rompiendo el
    // motivo por el que ese módulo evita meter base64 en el código fuente.
    // El límite por defecto (4KB) solo afectaría a
    // `final-success-star.svg` (711 bytes): el resto de assets de esa
    // carpeta ya superan el límite de sobra. `undefined` (no `false`) para
    // cualquier otro archivo: deja que Vite siga aplicando su límite de
    // tamaño por defecto ahí — devolver `true` aquí en su lugar forzaría a
    // inlinar TODO lo demás sin importar su tamaño (`userShouldInline !=
    // null` en el propio Vite: cualquier booleano explícito gana sobre el
    // límite por defecto, `undefined` es el único valor que lo conserva).
    assetsInlineLimit: (filePath) =>
      filePath.includes('/assets/playerIntro/') ? false : undefined,
  },
})
