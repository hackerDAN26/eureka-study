import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import aiApi from './server/vite-plugin.js';
import { publicCatalog } from './server/specs.js';

// GROQ_API_KEY is loaded here, on the dev server only. Only VITE_-prefixed variables
// can reach the browser bundle, so never prefix the key with VITE_.
//
// `npm run build:preview` makes one self-contained HTML file for previewing the design
// (no server, so the AI features are switched off and the subject list is bundled).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const preview = mode === 'preview-single';
  return {
    plugins: [
      react(),
      aiApi(env),
      ...(preview
        ? [
            viteSingleFile(),
            // Some hosts reject a raw U+FFFD; inside scripts the escape means the same thing.
            { name: 'escape-fffd', closeBundle() { const f = 'dist-preview/index.html'; if (existsSync(f)) writeFileSync(f, readFileSync(f, 'utf8').replaceAll('\uFFFD', '\\uFFFD')); } }
          ]
        : [])
    ],
    define: {
      __EUREKA_PREVIEW__: JSON.stringify(preview),
      __EMBED_CATALOG__: preview ? JSON.stringify(publicCatalog()) : 'null'
    },
    build: { chunkSizeWarningLimit: 4000, ...(preview ? { outDir: 'dist-preview', assetsInlineLimit: 100_000_000 } : {}) }
  };
});
