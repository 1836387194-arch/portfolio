import { defineConfig } from 'vite';

export default defineConfig({
  base: '/portfolio/',
  root: '.',
  publicDir: 'public',
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2020',
    chunkSizeWarningLimit: 1000,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/build/') ||
              id.includes('node_modules/three/src/')) {
            return 'three-core';
          }
          if (id.includes('node_modules/three/examples/jsm/loaders/')) {
            return 'three-loaders';
          }
          if (id.includes('node_modules/three/examples/')) {
            return 'three-examples';
          }
          if (id.includes('node_modules/gsap/')) {
            return 'gsap';
          }
          if (id.includes('node_modules/')) {
            return 'vendor';
          }
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});