import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      include: '**/*.{jsx,tsx}',
      babel: {
        plugins: [
          ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }]
        ]
      }
    })
  ],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
  publicDir: 'public',
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.jsx?$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
      define: {
        global: 'window',
      },
    },
    exclude: ['bittorrent-dht', 'load-ip-set'],
    include: ['queue-microtask', 'streamx', 'webtorrent'],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    'global': 'window',
  },
  resolve: {
    alias: {
      'simple-peer': '@thaunknown/simple-peer',
      'bittorrent-dht': path.resolve(__dirname, 'src/compatibility/bittorrent-dht-stub.js'),
      'load-ip-set': path.resolve(__dirname, 'src/compatibility/load-ip-set-stub.js'),
      'path': 'path-browserify',
    },
    conditions: ['browser', 'module', 'import'],
  },
  build: {
    outDir: 'build',
    sourcemap: true,
    rollupOptions: {
      external: (id) => {
        // Exclude Node.js-only modules that shouldn't be bundled for browser
        const nodeOnlyModules = [
          'bittorrent-dht',
          'events',
          'stream',
          'util',
          'buffer',
          'crypto',
          'fs',
          'os',
          'net',
          'tls',
          'dgram',
          'dns',
          'http',
          'https',
          'url',
          'querystring',
          'zlib',
          'child_process',
        ];
        return nodeOnlyModules.some(module => id === module || id.startsWith(module + '/'));
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    exclude: ['**/node_modules/**', '**/e2e/**', '**/dist/**'],
    include: ['**/*.{test,spec}.{js,jsx,ts,tsx}'],
  },
});

