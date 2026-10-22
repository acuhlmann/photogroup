import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { transformSync } from 'rolldown/experimental';
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

// Source files use JSX inside .js. Vite 8's production transform parses .js as
// plain JavaScript, so compile those files to JS before that pass.
const jsxInJsPlugin = () => ({
  name: 'jsx-in-js',
  enforce: 'pre',
  load(id) {
    const file = id.split('?')[0];
    if (!file.endsWith('.js') || !file.includes(`${path.sep}src${path.sep}`)) {
      return null;
    }
    const source = fs.readFileSync(file, 'utf8');
    const result = transformSync(file, source, {
      lang: 'jsx',
      jsx: { runtime: 'automatic' },
      sourcemap: true,
    });
    if (result.errors?.length) {
      const message = result.errors.map((error) => error.message || String(error)).join('\n');
      this.error(message);
    }
    return {
      code: result.code,
      map: result.map,
      moduleType: 'js',
    };
  },
});

// WebTorrent's browser field nulls conn-pool, but the client still reads UTP_SUPPORT.
const webtorrentBrowserPlugin = () => ({
  name: 'webtorrent-browser-stubs',
  enforce: 'pre',
  transform(code, id) {
    const file = id.split('?')[0];
    if (!file.endsWith(`${path.sep}webtorrent${path.sep}index.js`)) return null;
    if (!code.includes('ConnPool.UTP_SUPPORT')) return null;
    // Vite replaces the browser-excluded conn-pool module with undefined.
    return code.replaceAll(
      'ConnPool.UTP_SUPPORT',
      '(ConnPool == null ? false : ConnPool.UTP_SUPPORT)'
    );
  },
});

// Plugin to resolve Node.js built-in modules to browser stubs
const nodePolyfillPlugin = () => {
  return {
    name: 'node-polyfill',
    resolveId(id) {
      if (id === 'fs') {
        return path.resolve(__dirname, 'src/compatibility/fs-stub.js');
      }
      if (id === 'os') {
        return path.resolve(__dirname, 'src/compatibility/os-stub.js');
      }
      return null;
    },
  };
};

export default defineConfig({
  plugins: [
    jsxInJsPlugin(),
    webtorrentBrowserPlugin(),
    processPolyfillPlugin(),
    nodePolyfillPlugin(),
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
  // Vite 8 transforms with Oxc. .js sources contain JSX, and the default
  // exclude drops .js files unless it is cleared and lang is set to jsx.
  oxc: {
    include: /src\/.*\.jsx?$/,
    exclude: [],
    lang: 'jsx',
    jsx: {
      runtime: 'classic',
    },
  },
  optimizeDeps: {
    rolldownOptions: {
      plugins: [{
        name: 'webtorrent-utp-guard',
        transform(code, id) {
          if (!id.includes(`${path.sep}webtorrent${path.sep}index.js`)) return null;
          if (!code.includes('ConnPool.UTP_SUPPORT')) return null;
          return code.replaceAll(
            'ConnPool.UTP_SUPPORT',
            '(ConnPool == null ? false : ConnPool.UTP_SUPPORT)'
          );
        },
      }],
      moduleTypes: {
        '.js': 'jsx',
      },
      transform: {
        define: {
          global: 'globalThis',
          'process.env.NODE_ENV': '"development"',
          'process.browser': 'true',
          'process.version': '"v20.0.0"',
        },
      },
    },
    exclude: ['bittorrent-dht', 'load-ip-set'],
    include: ['queue-microtask', 'streamx', 'webtorrent', 'buffer'],
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
      'fs': path.resolve(__dirname, 'src/compatibility/fs-stub.js'),
      'os': path.resolve(__dirname, 'src/compatibility/os-stub.js'),
      'buffer': 'buffer',
      // Vite externalizes Node's events builtin. The npm package supports both
      // `class extends EventEmitter` and legacy `EventEmitter.call(this)`.
      'events': path.resolve(__dirname, 'node_modules/events/events.js'),
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
    // Processed by Vite so tests can swap its WebSocket for a fake
    // (TrackerKick.test.js drives the real tracker client).
    server: { deps: { inline: ['bittorrent-tracker'] } },
  },
});

