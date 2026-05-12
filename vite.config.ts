import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    global: 'globalThis',
  },
  server: {
    port: 5173,
    host: true,
  },
  optimizeDeps: {
    include: [
      '@strudel/core',
      '@strudel/mini',
      '@strudel/transpiler',
      '@strudel/webaudio',
      'hydra-synth',
      'yjs',
      'y-webrtc',
      'y-codemirror.next',
    ],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
});
