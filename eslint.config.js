import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Build output / generated dirs that must never be linted: 'dist' (web bundle),
  // 'src-tauri/target' (Cargo output) and 'src-tauri/gen' (generated mobile projects)
  // contain binary/codegen assets; '.claude' holds agent worktrees (full repo copies
  // with their own tsconfig) — linting into them breaks typed-lint root detection.
  globalIgnores(['dist', '.claude', 'src-tauri/target', 'src-tauri/gen']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // The iOS 14.0–15.3 WKWebView (our IPHONEOS_DEPLOYMENT_TARGET = 14.0) lacks
      // these Safari 15.4+ APIs. Using one throws at runtime on those devices — and
      // at module-eval it blanks the whole app before React mounts. Prefer the
      // freshProfile() (JSON clone) / randomId() (guarded UUID) helpers instead.
      // See memory: project_ios_blank_screen_fix.
      'no-restricted-globals': [
        'error',
        {
          name: 'structuredClone',
          message: 'Unsupported on the iOS <15.4 WKWebView — use a JSON clone (see freshProfile()).',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'crypto',
          property: 'randomUUID',
          message: 'Unsupported on the iOS <15.4 WKWebView — use the randomId() helper with a fallback.',
        },
        {
          object: 'Object',
          property: 'hasOwn',
          message: 'Unsupported on the iOS <15.4 WKWebView — use Object.prototype.hasOwnProperty.call().',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression > MemberExpression[property.name=/^(at|findLast|findLastIndex|toSorted|toReversed|toSpliced)$/]",
          message: 'This Array/String method is unsupported on the iOS <15.4 WKWebView — avoid it or polyfill.',
        },
        {
          selector: "CallExpression > MemberExpression[property.name='replaceAll']",
          message: 'String.replaceAll is unsupported on the iOS <15.4 WKWebView — use .replace(/.../g, ...).',
        },
      ],
    },
  },
])
