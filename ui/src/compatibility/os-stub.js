// Browser stub for os (Node.js-only module)
// WebTorrent uses this but it's not needed in browser mode
const osStub = {
  tmpdir: () => '/tmp',
  platform: () => 'browser',
  arch: () => 'browser',
  homedir: () => '/',
  hostname: () => 'browser',
  type: () => 'Browser',
  release: () => '0.0.0',
  cpus: () => [],
  totalmem: () => 0,
  freemem: () => 0,
  uptime: () => 0,
  endianness: () => 'LE',
  EOL: '\n',
};

// Support both ESM and CommonJS
export default osStub;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = osStub;
}

