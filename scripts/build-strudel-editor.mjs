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
  legalComments: 'linked',
  external: ['yjs']
});

await esbuild.build({
  entryPoints: ['node_modules/yjs/dist/yjs.mjs'],
  outfile: 'public/vendor/yjs.js',
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  legalComments: 'linked'
});

await esbuild.build({
  entryPoints: ['node_modules/y-websocket/src/y-websocket.js'],
  outfile: 'public/vendor/y-websocket.js',
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  legalComments: 'linked',
  external: ['yjs']
});

await esbuild.build({
  entryPoints: ['scripts/strudel-soundfonts-entry.mjs'],
  outfile: 'public/vendor/strudel-soundfonts.js',
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  legalComments: 'linked',
  external: ['@strudel/core', '@strudel/core/*', '@strudel/webaudio', '@strudel/webaudio/*', 'superdough', 'superdough/*']
});
