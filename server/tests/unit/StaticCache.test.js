import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { setStaticCacheHeaders } from '../../ServerSetup.js';

const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ui');

function headerFor(rel) {
  const headers = {};
  setStaticCacheHeaders({ setHeader: (name, value) => { headers[name] = value; } }, path.join(uiDir, rel));
  return headers['Cache-Control'];
}

describe('setStaticCacheHeaders', () => {
  it('keeps hashed build files for a year', () => {
    assert.strictEqual(headerFor('assets/index-Crza_ZBn.js'), 'public, max-age=31536000, immutable');
  });

  it('checks the page and other files each time', () => {
    assert.strictEqual(headerFor('index.html'), 'no-cache');
    assert.strictEqual(headerFor('manifest.json'), 'no-cache');
    assert.strictEqual(headerFor('share-target-sw.js'), 'no-cache');
  });
});
