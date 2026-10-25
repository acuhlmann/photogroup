// The push routes on a real Rooms, with a push service that only records what
// it was asked to do. What the service does with an endpoint once it has one is
// its own tests (tests/unit/PushService.test.js).
import '../test-setup.js';

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import EventEmitter from 'eventemitter3';
import request from 'supertest';

import Rooms from '../../Rooms.js';
import RoomStore from '../../RoomStore.js';

const FCM = 'https://fcm.googleapis.com/fcm/send/abcdef123456';
const KEYS = { p256dh: 'browserPublicKey', auth: 'browserAuthToken' };

/** A push service that remembers calls, and says no to an endpoint it would not post to. */
function recordingPush({ accepts = true } = {}) {
    const calls = [];
    return {
        calls,
        publicKey: 'Btest',
        add(roomId, subscription) {
            calls.push({ kind: 'add', roomId, subscription });
            return accepts;
        },
        remove(roomId, endpoint) {
            calls.push({ kind: 'remove', roomId, endpoint });
            return true;
        },
        photosAdded(room, options) {
            calls.push({ kind: 'photosAdded', roomId: room.id, ...options });
            return Promise.resolve([]);
        },
        forgetRoom(roomId) { calls.push({ kind: 'forgetRoom', roomId }); },
        reset() { calls.push({ kind: 'reset' }); },
    };
}

function serve(push) {
    const app = express();
    app.use(express.json());
    const emitter = new EventEmitter();
    const updateChannel = Object.assign(new EventEmitter(), { send: () => {} });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-api-'));
    const rooms = new Rooms(updateChannel, () => {}, app, emitter, undefined, undefined,
        new RoomStore({ file: path.join(dir, 'rooms.json'), setTimer: fn => { fn(); return 0; }, clearTimer: () => {} }), push);
    rooms.start();
    return { app, rooms, dir, push };
}

/** Join a room and come back with the session and the token that proves it. */
async function joined(app, id, name = 'anna') {
    const peer = { peerId: name + '-peer', sessionId: name + '-session', originPlatform: 'Chrome on Windows' };
    const response = await request(app).post('/api/rooms/').send({ id, peer });
    assert.strictEqual(response.status, 200);
    return { peer, token: response.body.sessionToken };
}

/**
 * Let a queued room write land before the directory under it goes, or the
 * teardown reports an ENOENT rename that was really this file's own cleanup.
 */
async function close(world) {
    await world.rooms.store.writing.catch(() => {});
    fs.rmSync(world.dir, { recursive: true, force: true });
}

describe('Push API', () => {
    let world;

    beforeEach(() => { world = serve(recordingPush()); });
    afterEach(() => close(world));

    describe('PUT /api/rooms/:id/push', () => {
        it('takes the endpoint from someone in the room', async () => {
            const { peer, token } = await joined(world.app, 'room-a');
            const response = await request(world.app).put('/api/rooms/room-a/push')
                .send({ sessionId: peer.sessionId, sessionToken: token, endpoint: FCM, keys: KEYS });
            assert.strictEqual(response.status, 200);
            assert.deepStrictEqual(response.body, { subscribed: true });
            const added = world.push.calls.find(item => item.kind === 'add');
            assert.strictEqual(added.roomId, 'room-a');
            assert.strictEqual(added.subscription.endpoint, FCM);
            assert.strictEqual(added.subscription.sessionId, peer.sessionId);
        });

        it('refuses someone who cannot prove they are in the room', async () => {
            await joined(world.app, 'room-a');
            const response = await request(world.app).put('/api/rooms/room-a/push')
                .send({ sessionId: 'other-session', sessionToken: 'guessed', endpoint: FCM, keys: KEYS });
            assert.strictEqual(response.status, 403);
            assert.strictEqual(world.push.calls.filter(item => item.kind === 'add').length, 0);
        });

        it('refuses an endpoint the push service would not be, without storing it', async () => {
            world = serve(recordingPush({ accepts: false }));
            const { peer, token } = await joined(world.app, 'room-a');
            const response = await request(world.app).put('/api/rooms/room-a/push')
                .send({ sessionId: peer.sessionId, sessionToken: token, endpoint: 'https://169.254.169.254/x', keys: KEYS });
            assert.strictEqual(response.status, 400);
            assert.strictEqual(world.push.calls.filter(item => item.kind === 'photosAdded').length, 0);
        });

        it('says no room for a room nobody is in', async () => {
            const response = await request(world.app).put('/api/rooms/nope/push').send({ endpoint: FCM, keys: KEYS });
            assert.strictEqual(response.status, 404);
        });

        it('says so when this server sends no push at all', async () => {
            const bare = serve(null);
            try {
                // The room has to exist for the answer to be about push at all.
                const { peer } = await joined(bare.app, 'room-a');
                const response = await request(bare.app).put('/api/rooms/room-a/push')
                    .send({ sessionId: peer.sessionId, endpoint: FCM, keys: KEYS });
                assert.strictEqual(response.status, 503);
            } finally {
                await close(bare);
            }
        });
    });

    describe('DELETE /api/rooms/:id/push', () => {
        it('takes an endpoint off the room when its own browser quotes it', async () => {
            await joined(world.app, 'room-a');
            const response = await request(world.app).delete('/api/rooms/room-a/push').send({ endpoint: FCM });
            assert.strictEqual(response.status, 200);
            assert.deepStrictEqual(response.body, { removed: true });
            const removed = world.push.calls.find(item => item.kind === 'remove');
            assert.strictEqual(removed.roomId, 'room-a');
            assert.strictEqual(removed.endpoint, FCM);
        });

        it('works without a session, because a page leaving the room is exactly when this is sent', async () => {
            const { peer, token } = await joined(world.app, 'room-a');
            await request(world.app).put('/api/rooms/room-a/push')
                .send({ sessionId: peer.sessionId, sessionToken: token, endpoint: FCM, keys: KEYS });
            const response = await request(world.app).delete('/api/rooms/room-a/push?endpoint=' + encodeURIComponent(FCM));
            assert.strictEqual(response.status, 200);
            assert.strictEqual(response.body.removed, true);
        });
    });

    describe('a photo shared into a room', () => {
        async function share(id, sessionId, infoHash) {
            return request(world.app).post('/api/rooms/' + id + '/photos/')
                .send({ sessionId, photos: [{ infoHash, peerId: 'someone-peer', fileName: 'beach.jpg' }] });
        }

        it('tells the room once for each photo the room did not already have', async () => {
            const { peer } = await joined(world.app, 'room-a', 'sharer');
            const first = await share('room-a', peer.sessionId, 'hash-one');
            assert.strictEqual(first.status, 200);
            const told = world.push.calls.find(item => item.kind === 'photosAdded');
            assert.strictEqual(told.count, 1);
            assert.strictEqual(told.sessionId, peer.sessionId);

            const again = await share('room-a', peer.sessionId, 'hash-one');
            assert.strictEqual(again.status, 200);
            assert.strictEqual(world.push.calls.filter(item => item.kind === 'photosAdded').length, 1,
                'a photo the room already lists is not news');
        });

        it('counts a burst of photos as one message', async () => {
            const { peer } = await joined(world.app, 'room-a');
            await request(world.app).post('/api/rooms/room-a/photos/').send({
                sessionId: peer.sessionId,
                photos: [
                    { infoHash: 'hash-one', peerId: 'someone-peer', fileName: 'a.jpg' },
                    { infoHash: 'hash-two', peerId: 'someone-peer', fileName: 'b.jpg' },
                    { infoHash: 'hash-three', peerId: 'someone-peer', fileName: 'c.jpg' },
                ],
            });
            const told = world.push.calls.find(item => item.kind === 'photosAdded');
            assert.strictEqual(told.count, 3);
        });

        it('stays quiet when the room was already holding every one of them', async () => {
            const { peer } = await joined(world.app, 'room-a');
            await share('room-a', peer.sessionId, 'hash-one');
            world.push.calls.length = 0;
            await share('room-a', peer.sessionId, 'hash-one');
            assert.strictEqual(world.push.calls.filter(item => item.kind === 'photosAdded').length, 0);
        });
    });

    describe('a room going away', () => {
        it('takes its subscriptions with it', async () => {
            const { peer, token } = await joined(world.app, 'room-a');
            await request(world.app).delete('/api/rooms/room-a').set('X-Session-Id', peer.sessionId)
                .set('X-Session-Token', token);
            assert.ok(world.push.calls.some(item => item.kind === 'forgetRoom' && item.roomId === 'room-a'));
        });

        it('clears them all when every room is dropped', async () => {
            await request(world.app).delete('/api/rooms');
            assert.ok(world.push.calls.some(item => item.kind === 'reset'));
        });
    });

    describe('GET /api/__pushConfig__', () => {
        it('is not registered when there is no push service to ask', async () => {
            const bare = serve(null);
            try {
                const response = await request(bare.app).get('/api/__pushConfig__');
                assert.strictEqual(response.status, 404);
            } finally {
                await close(bare);
            }
        });
    });
});
