import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites from https://<user>.github.io/<repo>/,
// so production builds need that repo-name prefix; the dev server stays at
// '/' so `npm run dev` is unaffected.
const githubPagesRepoName = 'urbanblocksbuilder'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/${githubPagesRepoName}/` : '/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
}))
