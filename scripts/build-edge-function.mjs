#!/usr/bin/env node
/**
 * build-edge-function.mjs — vendor the pure game engine into the resolve-turn
 * Supabase Edge Function as Deno-valid source.
 *
 * The app's src/game/*.ts files use extensionless relative imports (e.g.
 * `from './config'`) which Vite/tsc resolve but Deno does not. This script
 * copies the engine's (self-contained) import graph into
 * supabase/functions/resolve-turn/_engine/ and rewrites each relative import to
 * an explicit `.ts` path so Deno can load them directly — no bundler required.
 *
 * Run it whenever any of the vendored files change:
 *   npm run build:edge
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The engine's full self-contained import graph (verified: no bare/npm imports,
// no DOM/React/import.meta usage). Order doesn't matter — Deno resolves lazily.
const FILES = [
  'types.ts',
  'config.ts',
  'candidates.ts',
  'statesData.ts',
  'engine.ts',
  'resolveLobbyTurn.ts',
  'advanceLobbyPhase.ts',
];

const srcDir = join(root, 'src', 'game');
const outDir = join(root, 'supabase', 'functions', 'resolve-turn', '_engine');
mkdirSync(outDir, { recursive: true });

// Add `.ts` to relative imports/exports that lack a file extension.
function addTsExtensions(code) {
  return code.replace(
    /(from\s+|import\s+)(['"])(\.\.?\/[^'"]+)\2/g,
    (full, kw, quote, spec) => {
      if (/\.(ts|js|json|mjs)$/.test(spec)) return full; // already has an extension
      return `${kw}${quote}${spec}.ts${quote}`;
    },
  );
}

let count = 0;
for (const file of FILES) {
  const code = readFileSync(join(srcDir, file), 'utf8');
  const out = addTsExtensions(code);
  // Sanity check: no remaining bare specifiers would break Deno.
  const bare = [...out.matchAll(/from\s+['"]([^.'"][^'"]*)['"]/g)].map((m) => m[1]);
  if (bare.length) {
    console.error(`✗ ${file} has non-relative imports Deno can't resolve: ${bare.join(', ')}`);
    process.exit(1);
  }
  writeFileSync(join(outDir, file), out);
  count++;
}

console.log(`✓ Vendored ${count} engine files → supabase/functions/resolve-turn/_engine/`);
