import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pkg = require('./package.json');

// https://vitejs.dev/config/
// Custom plugin to inject process polyfill early
const processPolyfillPlugin = () => {
  return {
    name: 'process-polyfill',
    transformIndexHtml(html) {
      // Inject process polyfill at the very beginning of head
      const polyfillScript = `
<script>
// Process polyfill for Node.js modules
window.global = window.globalThis = window;
window.process = window.process || {
  env: { NODE_ENV: 'development' },
  browser: true,
  version: 'v20.0.0',
  nextTick: function(fn) { queueMicrotask(fn); },
  title: 'browser',
  platform: 'browser',
  cwd: function() { return '/'; }
};
</script>`;
      return html.replace('<head>', '<head>' + polyfillScript);
    }
  };
};

export default defineConfig({
  plugins: [
    processPolyfillPlugin(),
    react()
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
        global: 'globalThis',
        'process.env.NODE_ENV': '"development"',
        'process.browser': 'true',
        'process.version': '"v20.0.0"',
      },
    },
    exclude: ['bittorrent-dht', 'load-ip-set'],
    include: ['queue-microtask', 'streamx', 'webtorrent'],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    'global': 'window',
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      'simple-peer': '@thaunknown/simple-peer',
      'bittorrent-dht': path.resolve(__dirname, 'src/compatibility/bittorrent-dht-stub.js'),
      'load-ip-set': path.resolve(__dirname, 'src/compatibility/load-ip-set-stub.js'),
      'path': 'path-browserify',
      '@mui/styles': path.resolve(__dirname, 'src/share/compatibility/muiStyles.js'),
    },
    conditions: ['browser', 'module', 'import'],
  },
  build: {
    outDir: 'build',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    exclude: ['**/node_modules/**', '**/e2e/**', '**/dist/**'],
    include: ['**/*.{test,spec}.{js,jsx,ts,tsx}'],
  },
});

