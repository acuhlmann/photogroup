import '../test-setup.js';

import request from 'supertest';
import assert from 'assert';
import { app, started } from '../../app.js';

describe('Photo relay (server-copy fallback)', () => {
    let roomId;
    let roomNumber = 0;
    const peer = { peerId: 'relay-peer-' + Date.now(), sessionId: 'relay-session-' + Date.now(), originPlatform: 'test', name: 'Relay' };
    const infoHash = 'relayhash123';
    const bytes = Buffer.from('fake-jpeg-bytes');

    beforeEach(async () => {
        await started;
        roomId = 'relay-room-' + Date.now() + '-' + roomNumber++;
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
            .post(`/api/rooms/${roomId}/photos/blob?infoHash=${infoHash}&peerId=${peer.peerId}`)
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
            .expect('Content-Type', /image\/jpeg/)
            .expect('X-Content-Type-Options', 'nosniff');
        assert.deepStrictEqual(down.body, bytes);
    });

    it('requires the uploader identity to match the photo owner', async () => {
        for (const [identity, status] of [['', 400], ['&peerId=other-peer', 403]]) {
            await request(app).post(`/api/rooms/${roomId}/photos/blob?infoHash=${infoHash}${identity}`)
                .set('Content-Type', 'image/jpeg').send(bytes).expect(status);
        }
        await request(app).get(`/api/rooms/${roomId}/photos/blob?infoHash=${infoHash}`).expect(404);
    });

    it('rejects replacement uploads and preserves the original bytes', async () => {
        const endpoint = `/api/rooms/${roomId}/photos/blob?infoHash=${infoHash}&peerId=${peer.peerId}`;
        await request(app).post(endpoint).set('Content-Type', 'image/jpeg').send(bytes).expect(200);
        await request(app).post(endpoint).set('Content-Type', 'image/jpeg').send(Buffer.from('replacement')).expect(409);
        const down = await request(app).get(endpoint).expect(200);
        assert.deepStrictEqual(down.body, bytes);
    });

    for (const [fileType, uploadType, expected] of [
        ['text/html', 'image/jpeg', 'application/octet-stream'],
        ['application/xhtml+xml', 'image/jpeg', 'application/octet-stream'],
        ['image/svg+xml', 'image/jpeg', 'application/octet-stream'],
        ['image/unknown', 'image/jpeg', 'application/octet-stream'],
        ['', 'text/html', 'application/octet-stream'],
        ['', 'image/png', 'image/png'],
        ['IMAGE/JPEG; charset=utf-8', 'image/jpeg', 'image/jpeg'],
        ['video/mp4', 'video/mp4', 'video/mp4'],
        ['audio/mpeg', 'audio/mpeg', 'audio/mpeg']
    ]) {
        it(`serves metadata type ${fileType || '(missing)'} and upload type ${uploadType} as ${expected}`, async () => {
            await request(app).put(`/api/rooms/${roomId}/photos/`).send([{ infoHash, fileType }]).expect(200);
            const endpoint = `/api/rooms/${roomId}/photos/blob?infoHash=${infoHash}&peerId=${peer.peerId}`;
            await request(app).post(endpoint).set('Content-Type', uploadType).send(bytes).expect(200);
            await request(app).get(endpoint).expect(200)
                .expect('Content-Type', expected)
                .expect('X-Content-Type-Options', 'nosniff');
        });
    }

    it('supports compound infoHashes containing slashes via the query string', async () => {
        const compound = infoHash + '-folder/pic.jpg';
        await request(app).post(`/api/rooms/${roomId}/photos/`).send({
            sessionId: peer.sessionId,
            photos: [{ infoHash: compound, peerId: peer.peerId, fileName: 'pic.jpg', fileType: 'image/jpeg' }]
        }).expect(200);
        await request(app)
            .post(`/api/rooms/${roomId}/photos/blob?infoHash=${encodeURIComponent(compound)}&peerId=${peer.peerId}`)
            .set('Content-Type', 'image/jpeg').send(bytes).expect(200);
        await request(app)
            .get(`/api/rooms/${roomId}/photos/blob?infoHash=${encodeURIComponent(compound)}`)
            .expect(200);
    });

    it('rejects empty bodies, unknown photos and unknown rooms', async () => {
        await request(app).post(`/api/rooms/${roomId}/photos/blob?infoHash=${infoHash}&peerId=${peer.peerId}`).expect(400);
        await request(app).post(`/api/rooms/${roomId}/photos/blob?infoHash=nope`)
            .set('Content-Type', 'image/jpeg').send(bytes).expect(404);
        await request(app).post(`/api/rooms/nope/photos/blob?infoHash=${infoHash}&peerId=${peer.peerId}`)
            .set('Content-Type', 'image/jpeg').send(bytes).expect(404);
    });

    it('drops the copy when the photo is deleted', async () => {
        await request(app).post(`/api/rooms/${roomId}/photos/blob?infoHash=${infoHash}&peerId=${peer.peerId}`)
            .set('Content-Type', 'image/jpeg').send(bytes).expect(200);
        await request(app).delete(`/api/rooms/${roomId}/photos/`).send({ infoHash }).expect(200);
        await request(app).get(`/api/rooms/${roomId}/photos/blob?infoHash=${infoHash}`).expect(404);
    });
});
