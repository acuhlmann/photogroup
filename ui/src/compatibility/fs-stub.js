// Browser stub for fs (Node.js-only module)
// WebTorrent uses this but it's not needed in browser mode
const fsStub = {
  statSync: () => {
    throw new Error('fs.statSync is not available in browser');
  },
  readFileSync: () => {
    throw new Error('fs.readFileSync is not available in browser');
  },
  writeFileSync: () => {
    throw new Error('fs.writeFileSync is not available in browser');
  },
  existsSync: () => false,
  mkdirSync: () => {},
  readdirSync: () => [],
  unlinkSync: () => {},
  createReadStream: () => {
    throw new Error('fs.createReadStream is not available in browser');
  },
  createWriteStream: () => {
    throw new Error('fs.createWriteStream is not available in browser');
  },
};

// Support both ESM and CommonJS
export default fsStub;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = fsStub;
}

