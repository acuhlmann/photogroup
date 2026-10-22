import '../test-setup.js';
import assert from 'assert';
import { EventEmitter } from 'events';
import Peers from '../../Peers.js';

const GRACE_MS = 30;
const AWAY_GRACE_MS = 150;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('Peers', () => {
    let peers;
    let sent;
    let removedOwners;
    let token;

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
        peers = new Peers({ send: msg => sent.push(msg.data) }, null, null, emitter, { leaveGraceMs: GRACE_MS, awayGraceMs: AWAY_GRACE_MS });
        token = peers.claimSession('s1');
        peers.create({ peerId: 'phone', sessionId: 's1', originPlatform: 'Pixel 7' }, true);
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

    describe('reload', () => {
        function rejoin(peerId, sessionToken) {
            const owned = peers.claimSession('s1', sessionToken);
            peers.create({ peerId, sessionId: 's1', originPlatform: 'Pixel 7' }, !!owned);
            return owned;
        }

        it('replaces the old peer when a reloaded tab rejoins with its token', () => {
            assert.strictEqual(rejoin('phone-reloaded', token), token);

            assert.deepStrictEqual(peers.peers.map(p => p.peerId), ['phone-reloaded']);
            assert.deepStrictEqual(removedOwners, ['phone']);
            assert.deepStrictEqual(sent.map(m => m.type), ['delete', 'add']);
        });

        it('does not let someone who only knows the sessionId evict the peer', () => {
            assert.strictEqual(rejoin('intruder', undefined), null);

            assert.deepStrictEqual(peers.peers.map(p => p.peerId).sort(), ['intruder', 'phone']);
            assert.deepStrictEqual(removedOwners, []);
        });

        it('keeps other sessions and a rejoin with the same peerId', () => {
            peers.create({ peerId: 'laptop', sessionId: 's2', originPlatform: 'Firefox' }, !!peers.claimSession('s2'));
            rejoin('phone', token);

            assert.deepStrictEqual(peers.peers.map(p => p.peerId).sort(), ['laptop', 'phone']);
            assert.deepStrictEqual(removedOwners, []);
        });

        it("doesn't let the old stream's pending leave remove the reloaded peer", async () => {
            closeStream(openStream('s1'));
            rejoin('phone-reloaded', token);
            // the new page's stream is slower than the grace period
            await wait(GRACE_MS * 2);

            assert.deepStrictEqual(peers.peers.map(p => p.peerId), ['phone-reloaded']);
        });
    });

    describe('leaveNow', () => {
        it('removes the peer right away', () => {
            assert.strictEqual(peers.leaveNow('s1', 'phone', token), true);

            assert.ok(!peers.webPeers.has('phone'));
            assert.deepStrictEqual(sent, [{ type: 'delete', item: 'phone' }]);
            assert.deepStrictEqual(removedOwners, ['phone']);
        });

        it('ignores a late beacon from a page that was already replaced', () => {
            const owned = peers.claimSession('s1', token);
            peers.create({ peerId: 'phone-reloaded', sessionId: 's1', originPlatform: 'Pixel 7' }, !!owned);
            sent = [];
            removedOwners = [];

            assert.strictEqual(peers.leaveNow('s1', 'phone', token), false);
            assert.ok(peers.webPeers.has('phone-reloaded'));
            assert.deepStrictEqual(sent, []);
        });

        it('requires the session token, not just the public ids', () => {
            assert.strictEqual(peers.leaveNow('s1', 'phone'), false);
            assert.strictEqual(peers.leaveNow('s1', 'phone', 'guess'), false);
            assert.ok(peers.webPeers.has('phone'));
        });
    });

    describe('markAway', () => {
        it('keeps a phone that switched apps, and its photos, past the short grace', async () => {
            const stream = openStream('s1');
            assert.strictEqual(peers.markAway('s1', 'phone', token), true);
            assert.strictEqual(sent.length, 1);
            assert.strictEqual(sent[0].type, 'update');
            assert.ok(sent[0].item.away > 0);

            closeStream(stream);
            await wait(GRACE_MS * 2);
            assert.ok(peers.webPeers.has('phone'), 'still listed while away');
            assert.deepStrictEqual(removedOwners, []);

            await wait(AWAY_GRACE_MS);
            assert.ok(!peers.webPeers.has('phone'), 'gone once away too long');
            assert.deepStrictEqual(removedOwners, ['phone']);
        });

        it('stretches the grace when the stream dropped before the beacon arrived', async () => {
            closeStream(openStream('s1'));
            peers.markAway('s1', 'phone', token);
            await wait(GRACE_MS * 2);
            assert.ok(peers.webPeers.has('phone'));
        });

        it('clears away when the phone joins again in the foreground, not from the background', () => {
            peers.markAway('s1', 'phone', token);
            peers.create({ peerId: 'phone', sessionId: 's1', originPlatform: 'Pixel 7', away: true }, !!peers.claimSession('s1', token));
            assert.ok(peers.webPeers.get('phone').away > 0);
            peers.create({ peerId: 'phone', sessionId: 's1', originPlatform: 'Pixel 7' }, !!peers.claimSession('s1', token));
            assert.strictEqual(peers.webPeers.get('phone').away, undefined);
        });

        it('requires the session token', () => {
            assert.strictEqual(peers.markAway('s1', 'phone'), false);
            assert.strictEqual(peers.markAway('s1', 'phone', 'guess'), false);
            assert.strictEqual(peers.markAway('s2', 'phone', token), false);
            assert.strictEqual(peers.webPeers.get('phone').away, undefined);
        });
    });
});
