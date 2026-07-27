import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites from https://<user>.github.io/<repo>/,
// so production builds need that repo-name prefix; the dev server stays at
// '/' so `npm run dev` is unaffected.
const githubPagesRepoName = 'urbanblocksbuilder'

// maplibre-gl's worker entry (maplibre-gl-worker.mjs, loaded via `?url` in
// MapView.tsx) statically imports a sibling maplibre-gl-shared.mjs by a
// literal relative path - Vite copies `?url` assets verbatim without
// rewriting their contents, so that import only resolves if both files keep
// their original, unhashed names next to each other in the output. Every
// other asset keeps Vite's normal hashed naming.
const maplibreWorkerAssetNames = new Set(['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'])

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? `/${githubPagesRepoName}/` : '/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  build: {
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] ?? ''
          return maplibreWorkerAssetNames.has(name) ? 'assets/[name][extname]' : 'assets/[name]-[hash][extname]'
        },
      },
    },
  },
}))
