import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  test: {
    environment: 'node',
  },
  plugins: [react()],

  // Lock the production bundle to a Safari-14 syntax baseline. Our iOS
  // IPHONEOS_DEPLOYMENT_TARGET is 14.0, whose WKWebView runs an old
  // JavaScriptCore. Without this, a dependency shipping newer syntax could
  // reintroduce a parse-time launch crash. (Runtime API gaps — structuredClone,
  // .at, randomUUID, etc. — are handled by the boot polyfill in index.html;
  // build targets only lower syntax, they never add API polyfills.)
  build: {
    target: ['es2020', 'safari14'],
  },

  // Prevent host resolution in Tauri's webview from using node APIs.
  // 'browser' ensures Vite resolves the "browser" field in package.json,
  // which is the correct target for webview environments.
  resolve: {
    // Prefer the ESM "module" field before "main" (CJS/UMD) for packages that
    // publish both. Vite 8 / rolldown does not honor "module" automatically.
    mainFields: ['module', 'browser', 'main'],
    conditions: ['module', 'browser', 'import'],
  },

  server: {
    port: 5174,
    // Hard-fail if the port is already taken — Tauri's devUrl must be exact.
    // Run `lsof -i :5174 | grep LISTEN` to find and kill any occupant first.
    strictPort: true,
    // Tauri opens a native webview that loads from this server; it is not a
    // standard browser origin, so we must allow it as a host.
    host: 'localhost',
  },
})
