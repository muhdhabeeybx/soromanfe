/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '#': path.resolve(__dirname, './src'),
    },
  },
  // The export modules render a real workbook and a real PDF document, which
  // both reach for the DOM — so the suite runs in jsdom rather than node.
  test: {
    environment: 'jsdom',
  },
})

