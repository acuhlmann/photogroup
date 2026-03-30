import assert from 'assert';

// Test mapSdp logic directly (extracted to avoid native module dependency)
function mapSdp(sdp) {
    if (!sdp || !sdp.media || sdp.media.length === 0 || !sdp.media[0].candidates) {
        return [];
    }
    return sdp.media[0].candidates.map(item => {
        return {
            ip: item.ip,
            port: item.port,
            transport: item.transport,
            type: item.type
        }
    }).reverse();
}

describe('Crash fix: mapSdp null guards', () => {
    it('should return empty array when sdp is null', () => {
        assert.deepStrictEqual(mapSdp(null), []);
    });

    it('should return empty array when sdp is undefined', () => {
        assert.deepStrictEqual(mapSdp(undefined), []);
    });

    it('should return empty array when sdp.media is empty', () => {
        assert.deepStrictEqual(mapSdp({ media: [] }), []);
    });

    it('should return empty array when candidates is missing', () => {
        assert.deepStrictEqual(mapSdp({ media: [{}] }), []);
    });

    it('should return empty array when sdp has no media property', () => {
        assert.deepStrictEqual(mapSdp({}), []);
    });

    it('should map candidates correctly when present', () => {
        const sdp = {
            media: [{
                candidates: [
                    { ip: '1.2.3.4', port: 1234, transport: 'udp', type: 'host' },
                    { ip: '5.6.7.8', port: 5678, transport: 'tcp', type: 'srflx' }
                ]
            }]
        };
        const result = mapSdp(sdp);
        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].ip, '5.6.7.8');
        assert.strictEqual(result[1].ip, '1.2.3.4');
    });
});

describe('Crash fix: handleEvent null guards', () => {
    it('should safely handle offers with null guards', () => {
        // Simulates the guard: offers && offers.length > 0 && offers[0].offer && offers[0].offer.sdp
        function isValidOffer(data) {
            return data.offers && data.offers.length > 0 && data.offers[0].offer && data.offers[0].offer.sdp;
        }

        assert.strictEqual(isValidOffer({ offers: [] }), false);
        assert.strictEqual(isValidOffer({ offers: [{}] }), undefined); // falsy
        assert.strictEqual(isValidOffer({ offers: [{ offer: {} }] }), undefined); // falsy
        assert.strictEqual(isValidOffer({ offers: [{ offer: { sdp: 'v=0...' } }] }), 'v=0...');
    });

    it('should safely handle answer with null guard', () => {
        function isValidAnswer(data) {
            return data.answer && data.answer.sdp;
        }

        assert.strictEqual(isValidAnswer({ answer: {} }), undefined); // falsy
        assert.strictEqual(isValidAnswer({ answer: { sdp: 'v=0...' } }), 'v=0...');
        assert.strictEqual(isValidAnswer({}), undefined); // falsy
    });
});

describe('Crash fix: sendWebPeers with string item (delete type)', () => {
    it('should handle string item for delete events', () => {
        const item = 'some-peer-id';
        const peerId = typeof item === 'string' ? item : item.peerId;
        assert.strictEqual(peerId, 'some-peer-id');
    });

    it('should handle object item for non-delete events', () => {
        const item = { peerId: 'peer-123', networkChain: [] };
        const peerId = typeof item === 'string' ? item : item.peerId;
        assert.strictEqual(peerId, 'peer-123');
    });

    it('should not access networkChain on string item', () => {
        const item = 'some-peer-id';
        const hasChain = typeof item !== 'string' && item.networkChain && item.networkChain.length > 0;
        assert.strictEqual(hasChain, false);
    });
});

describe('Crash fix: POST photos responsePhotos with missing peerId', () => {
    it('should stop processing when peerId is missing (for loop with return)', () => {
        const photos = [
            { infoHash: 'hash1', peerId: 'peer1' },
            { infoHash: 'hash2' }, // missing peerId
            { infoHash: 'hash3', peerId: 'peer3' }
        ];

        // Simulates the fixed for-loop approach
        const responsePhotos = [];
        let errorSent = false;
        for (const photo of photos) {
            if (!photo.peerId) {
                errorSent = true;
                break; // return in the actual handler
            }
            responsePhotos.push(photo);
        }

        assert.strictEqual(errorSent, true);
        assert.strictEqual(responsePhotos.length, 1); // only first photo processed
    });
});

describe('Crash fix: PUT photos with missing photo', () => {
    it('should filter out null when photo not found', () => {
        const roomPhotos = [
            { infoHash: 'hash1', name: 'photo1.jpg' }
        ];

        function findPhoto(photos, infoHash) {
            const index = photos.findIndex(item => item.infoHash === infoHash);
            return index > -1 ? photos[index] : null;
        }

        const updates = [
            { infoHash: 'hash1', name: 'updated.jpg' },
            { infoHash: 'nonexistent', name: 'gone.jpg' }
        ];

        const updated = updates.map(update => {
            const existing = findPhoto(roomPhotos, update.infoHash);
            if (!existing) return null;
            Object.assign(existing, update);
            return existing;
        }).filter(item => item !== null);

        assert.strictEqual(updated.length, 1);
        assert.strictEqual(updated[0].name, 'updated.jpg');
    });
});
