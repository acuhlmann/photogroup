import '../test-setup.js';
import assert from 'assert';
import { EventEmitter } from 'events';
import Peers from '../../Peers.js';

const GRACE_MS = 30;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('Peers', () => {
    let peers;
    let sent;
    let removedOwners;

    // sse-channel hands the same response object to registration and disconnect.
    function openStream(sessionId) {
        const response = { req: { query: { sessionId } } };
        peers.clientsBySessionId.set(sessionId, response);
        return response;
    }

    function closeStream(response) {
        peers.disconnect(response.req, response);
    }

    beforeEach(() => {
        const emitter = new EventEmitter();
        sent = [];
        removedOwners = [];
        emitter.on('removeOwner', peerId => removedOwners.push(peerId));
        peers = new Peers({ send: msg => sent.push(msg.data) }, null, null, emitter, { leaveGraceMs: GRACE_MS });
        peers.create({ peerId: 'phone', sessionId: 's1', originPlatform: 'Pixel 7' });
        sent = [];
    });

    afterEach(() => {
        peers.reset();
    });

    describe('disconnect', () => {
        it('keeps a resuming phone whose new stream opened before the old one closed', async () => {
            const oldStream = openStream('s1');
            const newStream = openStream('s1');

            closeStream(oldStream);
            await wait(GRACE_MS * 2);

            assert.ok(peers.webPeers.has('phone'));
            assert.strictEqual(peers.clientsBySessionId.get('s1'), newStream);
            assert.deepStrictEqual(sent, []);
            assert.deepStrictEqual(removedOwners, []);
        });

        it('keeps a phone that reconnects within the grace period', async () => {
            closeStream(openStream('s1'));
            await wait(GRACE_MS / 3);
            openStream('s1');
            await wait(GRACE_MS * 2);

            assert.ok(peers.webPeers.has('phone'));
            assert.deepStrictEqual(sent, []);
            assert.deepStrictEqual(removedOwners, []);
        });

        it('removes a peer that stays away past the grace period', async () => {
            closeStream(openStream('s1'));
            assert.ok(peers.webPeers.has('phone'), 'still listed during the grace period');

            await wait(GRACE_MS * 2);

            assert.ok(!peers.webPeers.has('phone'));
            assert.deepStrictEqual(sent, [{ type: 'delete', item: 'phone' }]);
            assert.deepStrictEqual(removedOwners, ['phone']);
        });
    });
});
