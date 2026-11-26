import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve('electron/main.ts') } } },
  },
  preload: {
    build: { rollupOptions: { input: { index: resolve('electron/preload.ts') } } },
  },
  renderer: {
    root: 'src',
    build: { rollupOptions: { input: { index: resolve('src/index.html') } } },
    plugins: [svelte()],
  },
})
