// Bündelt den Vercel-Einstieg zu EINER Datei: dist/vercel.mjs.
//
// Die Pakete des Arbeitsbereichs exportieren TypeScript-Quellen mit `.ts`-Importen — lokal führt tsx das aus, der
// Node-Builder von Vercel nicht. Gebündelt wird deshalb hier, im Bauschritt; `api/index.mjs` lädt nur das Ergebnis.
import { build } from 'esbuild';
import { statSync } from 'node:fs';

// Bleiben draußen: werden zur Laufzeit aus node_modules geladen (eigene Binärdateien bzw. Worker-Dateien neben dem Modul)
const EXTERN = ['playwright-core', '@sparticuz/chromium', 'pdfjs-dist', '@napi-rs/canvas'];

const ziel = 'dist/vercel.mjs';
const r = await build({
  entryPoints: ['src/vercel.ts'], outfile: ziel, bundle: true, platform: 'node', target: 'node22', format: 'esm',
  external: EXTERN, sourcemap: true, logLevel: 'warning', metafile: true,
  // Pakete im CommonJS-Format erwarten require/__dirname — in einem ESM-Bündel gibt es beides nicht von selbst
  banner: { js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);" },
});
const mb = (statSync(ziel).size / 1024 / 1024).toFixed(1);
console.log(`${ziel}: ${mb} MB aus ${Object.keys(r.metafile.inputs).length} Quelldateien · extern: ${EXTERN.join(', ')}`);
