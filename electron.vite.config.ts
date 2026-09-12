import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import { resolve } from 'path'

function getCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // Keep these as external so the sandbox can load system toolchains.
        external: []
      }
    },
    define: {
      __COMMIT__: JSON.stringify(getCommit())
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    server: {
      port: 5290,
      strictPort: true
    }
  }
})
