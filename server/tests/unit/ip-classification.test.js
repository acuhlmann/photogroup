import assert from 'assert';
import ip from 'ip';

describe('ip.isPublic classification', () => {
  const nonPublic = [
    '127.1',
    '01200034567',
    '012.1.2.3',
    '000:0:0000::01',
    '::fFFf:127.0.0.1',
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.1',
    '::1',
    '::ffff:127.0.0.1'
  ];

  for (const addr of nonPublic) {
    it(`treats ${addr} as not globally routable`, () => {
      assert.strictEqual(ip.isPublic(addr), false);
      assert.strictEqual(ip.isPrivate(addr), true);
    });
  }

  it('still treats public addresses as public', () => {
    assert.strictEqual(ip.isPublic('8.8.8.8'), true);
    assert.strictEqual(ip.isPublic('1.1.1.1'), true);
  });

  it('converts an announce integer to dotted ipv4', () => {
    assert.strictEqual(ip.toString(Buffer.from([8, 8, 8, 8])), '8.8.8.8');
  });

  it('copies vendor/net-ip into all Dockerfile stages that install dependencies', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const dockerfile = fs.readFileSync(path.resolve(__dirname, '../../../Dockerfile'), 'utf8');
    // Stage 1 (WORKDIR /app/ui) needs /app/vendor/net-ip for file:../vendor/net-ip
    assert.match(dockerfile, /COPY\s+vendor\/?\s+\/app\/vendor\/?/);
    // Server stages (WORKDIR /app) need /vendor/net-ip for file:../vendor/net-ip
    assert.match(dockerfile, /COPY\s+vendor\/?\s+\/vendor\/?/);
  });
});
