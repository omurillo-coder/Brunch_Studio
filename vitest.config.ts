import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Configuración de Vitest separada de vite.config.ts para mantener este
// último libre de dependencias de testing en el build de producción.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
  },
})
