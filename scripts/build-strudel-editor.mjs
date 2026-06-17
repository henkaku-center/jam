import * as esbuild from 'esbuild';
import fs from 'fs/promises';

await fs.mkdir('public/vendor', { recursive: true });

await esbuild.build({
  entryPoints: ['scripts/strudel-editor-entry.mjs'],
  outfile: 'public/vendor/strudel-editor.js',
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  legalComments: 'linked'
});
