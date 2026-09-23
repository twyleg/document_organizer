import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('electron/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('electron/preload.ts') } }
  },
  renderer: {
    root: '.',
    plugins: [vue()],
    build: { rollupOptions: { input: resolve('index.html') } }
  }
})
