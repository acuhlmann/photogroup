// A room has to outlive the process that made it. These tests build a Rooms on
// a scratch store, share a photo, stop it, and start another one over the same
// file — the way an idle-stopped VM does when it comes back.
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

function serve(store) {
    const app = express();
    app.use(express.json());
    const emitter = new EventEmitter();
    // The real channel is an SSE channel: it emits connect/disconnect and
    // carries send().
    const updateChannel = Object.assign(new EventEmitter(), { send: () => {} });
    const rooms = new Rooms(updateChannel, () => {}, app, emitter, undefined, undefined, store);
    rooms.start();
    return { app, rooms };
}

const peer = name => ({
    peerId: name + '-peer',
    sessionId: name + '-session',
    originPlatform: 'Chrome 100.0 on Windows 10',
    name,
});

describe('Room restart', () => {
    let dir;
    let file;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-restart-'));
        file = path.join(dir, 'rooms.json');
    });

    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    // One server that shares a clip and shuts down with it written.
    async function shareOnePhoto(roomId) {
        const { app, rooms } = serve(new RoomStore({ file, debounceMs: 0 }));
        const owner = peer('sharer');
        await request(app).post('/api/rooms/').send({ id: roomId, peer: owner }).expect(200);
        await request(app).post(`/api/rooms/${roomId}/photos/`).send({
            sessionId: owner.sessionId,
            photos: [{
                infoHash: 'clip-hash', fileName: 'dock.mp4', fileType: 'video/mp4',
                peerId: owner.peerId, url: 'magnet:?xt=urn:btih:clip-hash',
                owners: [{ peerId: 'whoever', loading: false }],
                hasServerCopy: true, serverCopySize: 4096, serverCopyRequestedAt: 12345,
            }],
        }).expect(200);
        await rooms.store.flush();
        return { app, rooms, owner, roomId };
    }

    it('gives a restarted server the room and its photos back', async () => {
        await shareOnePhoto('restart-room');

        const next = serve(new RoomStore({ file, debounceMs: 0 }));
        const joined = await request(next.app).post('/api/rooms/restart-room')
            .send({ peer: peer('returner') })
            .expect(200);

        assert.strictEqual(joined.body.photos.length, 1);
        assert.strictEqual(joined.body.photos[0].fileName, 'dock.mp4');
        assert.strictEqual(joined.body.photos[0].url, 'magnet:?xt=urn:btih:clip-hash');
        // Nobody from before the restart is claimed as present; the joiner is.
        assert.deepStrictEqual(joined.body.peers.map(item => item.name), ['returner']);
    });

    it('restores no server copy, whose bytes the relay deleted at startup', async () => {
        await shareOnePhoto('copy-room');

        const next = serve(new RoomStore({ file, debounceMs: 0 }));
        const joined = await request(next.app).post('/api/rooms/copy-room').send({ peer: peer('p') }).expect(200);

        const photo = joined.body.photos[0];
        assert.strictEqual(photo.hasServerCopy, undefined);
        assert.strictEqual(photo.serverCopyRequestedAt, undefined);
        assert.strictEqual(photo.serverCopySize, undefined);
        // Ownership is not restored either: each device re-declares what it holds.
        assert.strictEqual(photo.owners, undefined);
    });

    it('keeps the photo on its first join after the restart', async () => {
        await shareOnePhoto('twice-room');

        const next = serve(new RoomStore({ file, debounceMs: 0 }));
        const first = await request(next.app).post('/api/rooms/twice-room').send({ peer: peer('a') }).expect(200);
        const second = await request(next.app).post('/api/rooms/twice-room').send({ peer: peer('b') }).expect(200);
        assert.strictEqual(first.body.photos.length, 1);
        assert.strictEqual(second.body.photos.length, 1);
    });

    it('finds no room that was never written', async () => {
        const next = serve(new RoomStore({ file, debounceMs: 0 }));
        await request(next.app).post('/api/rooms/never').send({ peer: peer('p') }).expect(404);
    });

    it('drops the saved rooms when the whole state is reset', async () => {
        const { app, roomId } = await shareOnePhoto('reset-room');
        await request(app).delete('/api/rooms').expect(200);
        await new Promise(resolve => setTimeout(resolve, 30));

        const next = serve(new RoomStore({ file, debounceMs: 0 }));
        await request(next.app).post(`/api/rooms/${roomId}`).send({ peer: peer('p') }).expect(404);
    });

    it('writes a room that was only joined, so an empty link survives too', async () => {
        const { app, rooms } = serve(new RoomStore({ file, debounceMs: 0 }));
        await request(app).post('/api/rooms/').send({ id: 'bare-room', peer: peer('alone') }).expect(200);
        await rooms.store.flush();

        const next = serve(new RoomStore({ file, debounceMs: 0 }));
        await request(next.app).post('/api/rooms/bare-room').send({ peer: peer('friend') }).expect(200);
    });
});
