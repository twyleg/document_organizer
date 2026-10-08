import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

function pdfAssets(): Plugin {
  const assets = ['cmaps', 'standard_fonts', 'wasm', 'iccs'].flatMap((section) => {
    const directory = resolve('node_modules/pdfjs-dist', section)
    return readdirSync(directory).map((name) => ({
      name: `${section}/${name}`,
      data: readFileSync(resolve(directory, name))
    }))
  })
  return {
    name: 'local-pdf-assets',
    generateBundle() {
      for (const asset of assets) {
        this.emitFile({ type: 'asset', fileName: `pdf-assets/${asset.name}`, source: asset.data })
      }
    },
    configureServer(server) {
      server.middlewares.use('/pdf-assets', (request, response, next) => {
        const asset = assets.find((item) => `/${item.name}` === request.url?.split('?')[0])
        if (!asset) {
          return next()
        }
        response.setHeader(
          'Content-Type',
          asset.name.endsWith('.wasm')
            ? 'application/wasm'
            : asset.name.endsWith('.js')
              ? 'text/javascript'
              : 'application/octet-stream'
        )
        response.end(asset.data)
      })
    }
  }
}

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
    plugins: [vue(), pdfAssets()],
    build: { rollupOptions: { input: resolve('index.html') } }
  }
})
