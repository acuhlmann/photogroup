import '../test-setup.js';

import request from 'supertest';
import assert from 'assert';
import { app, started } from '../../app.js';

describe('Photo relay (server-copy fallback)', () => {
    const roomId = 'relay-room-' + Date.now();
    const peer = { peerId: 'relay-peer-' + Date.now(), sessionId: 'relay-session-' + Date.now(), originPlatform: 'test', name: 'Relay' };
    const infoHash = 'relayhash123';
    const bytes = Buffer.from('fake-jpeg-bytes');

    before(async () => {
        await started;
        await request(app).post('/api/rooms/').send({ id: roomId, peer }).expect(200);
        await request(app).post(`/api/rooms/${roomId}/photos/`).send({
            sessionId: peer.sessionId,
            photos: [{ infoHash, peerId: peer.peerId, fileName: 'a.jpg', fileType: 'image/jpeg' }]
        }).expect(200);
    });

    it('returns 404 before any server copy exists', async () => {
        await request(app).get(`/api/rooms/${roomId}/photos/blob?infoHash=${infoHash}`).expect(404);
    });

    it('stores and serves back the exact bytes, flagging the photo', async () => {
        const up = await request(app)
            .post(`/api/rooms/${roomId}/photos/blob?infoHash=${infoHash}`)
            .set('Content-Type', 'image/jpeg')
            .send(bytes)
            .expect(200);
        assert.strictEqual(up.body.hasServerCopy, true);
        assert.strictEqual(up.body.size, bytes.length);

        const room = await request(app).get(`/api/rooms/${roomId}`).expect(200);
        assert.strictEqual(room.body.photos.find(p => p.infoHash === infoHash).hasServerCopy, true);

        const down = await request(app)
            .get(`/api/rooms/${roomId}/photos/blob?infoHash=${infoHash}`)
            .buffer(true)
            .parse((res, cb) => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); })
            .expect(200)
            .expect('Content-Type', /image\/jpeg/);
        assert.deepStrictEqual(down.body, bytes);
    });

    it('supports compound infoHashes containing slashes via the query string', async () => {
        const compound = infoHash + '-folder/pic.jpg';
        await request(app).post(`/api/rooms/${roomId}/photos/`).send({
            sessionId: peer.sessionId,
            photos: [{ infoHash: compound, peerId: peer.peerId, fileName: 'pic.jpg', fileType: 'image/jpeg' }]
        }).expect(200);
        await request(app)
            .post(`/api/rooms/${roomId}/photos/blob?infoHash=${encodeURIComponent(compound)}`)
            .set('Content-Type', 'image/jpeg').send(bytes).expect(200);
        await request(app)
            .get(`/api/rooms/${roomId}/photos/blob?infoHash=${encodeURIComponent(compound)}`)
            .expect(200);
    });

    it('rejects empty bodies, unknown photos and unknown rooms', async () => {
        await request(app).post(`/api/rooms/${roomId}/photos/blob?infoHash=${infoHash}`).expect(400);
        await request(app).post(`/api/rooms/${roomId}/photos/blob?infoHash=nope`)
            .set('Content-Type', 'image/jpeg').send(bytes).expect(404);
        await request(app).post(`/api/rooms/nope/photos/blob?infoHash=${infoHash}`)
            .set('Content-Type', 'image/jpeg').send(bytes).expect(404);
    });

    it('drops the copy when the photo is deleted', async () => {
        await request(app).delete(`/api/rooms/${roomId}/photos/`).send({ infoHash }).expect(200);
        await request(app).get(`/api/rooms/${roomId}/photos/blob?infoHash=${infoHash}`).expect(404);
    });
});
