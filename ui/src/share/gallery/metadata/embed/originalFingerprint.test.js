import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { embedDetails } from './embedDetails';
import { readOriginalFingerprint } from './originalFingerprint';

const ORIGINAL = '12345:' + 'c'.repeat(64);

const fixture = name => new Blob([readFileSync(fileURLToPath(new URL('./__fixtures__/' + name, import.meta.url)))]);

describe('readOriginalFingerprint', () => {
    it.each(['photo.jpg', 'photo.png', 'lossy.webp', 'anim.gif', 'photo.heic', 'photo.avif'])(
        'reads the original noted in a saved %s',
        async name => {
            const saved = await embedDetails(fixture(name), { title: 'Dock' }, { originalFingerprint: ORIGINAL });
            expect(saved).not.toBe(fixture(name));
            expect(await readOriginalFingerprint(saved)).toBe(ORIGINAL);
        },
    );

    it('finds it at the end of a large file', async () => {
        const saved = await embedDetails(fixture('lossy.webp'), { title: 'Dock' }, { originalFingerprint: ORIGINAL });
        const big = new Blob([new Uint8Array(2 * 1024 * 1024), saved]);
        expect(await readOriginalFingerprint(big)).toBe(ORIGINAL);
    });

    it('notes nothing when the details were not edited', async () => {
        const photo = fixture('photo.jpg');
        expect(await embedDetails(photo, {}, { originalFingerprint: ORIGINAL })).toBe(photo);
        expect(await readOriginalFingerprint(photo)).toBeNull();
    });

    it('keeps one note when a saved copy is saved again', async () => {
        const once = await embedDetails(fixture('photo.jpg'), { title: 'Dock' }, { originalFingerprint: ORIGINAL });
        const twice = await embedDetails(once, { title: 'Pier' }, { originalFingerprint: ORIGINAL });
        const text = new TextDecoder('latin1').decode(await twice.arrayBuffer());
        expect(text.match(/OriginalFingerprint/g)).toHaveLength(1);
    });
});
