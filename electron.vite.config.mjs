import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // The MCP server ships beside the app and shares the same service code.
        input: { index: resolve('src/main/index.js'), mcp: resolve('src/mcp/server.js') }
      }
    }
  },
  preload: {},
  renderer: {
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } }
  }
})
