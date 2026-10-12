import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const backend = process.env.BACKEND_URL ?? 'http://localhost:3000'

// Phiên bản lấy từ package.json gốc; mỗi lần build có một mã riêng để trình duyệt biết đã có bản mới.
const rootPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'))
const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return process.env.GIT_COMMIT ?? ''
  }
})()
const build = {
  version: String(rootPkg.version),
  buildId: Date.now().toString(36),
  builtAt: new Date().toISOString(),
  commit,
}

/** Ghi dist/version.json để máy chủ báo cho trình duyệt khi có bản build mới. */
function versionFile(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(build, null, 2) })
    },
  }
}

export default defineConfig({
  plugins: [react(), versionFile()],
  define: {
    __APP_BUILD__: JSON.stringify(build),
  },
  server: {
    proxy: {
      '/api': backend,
      '/uploads': backend,
      '/socket.io': { target: backend, ws: true },
    },
  },
})
