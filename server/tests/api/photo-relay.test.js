import '../test-setup.js';

import request from 'supertest';
import assert from 'assert';
import { app, started } from '../../app.js';
import { MAX_CHUNK_BYTES, MAX_PHOTO_BYTES } from '../../PhotoRelay.js';

describe('Photo relay (server copies, pinned when needed)', () => {
    let roomId;
    let roomNumber = 0;
    let sharer;
    let receiver;
    const infoHash = 'relayhash123';
    const bytes = Buffer.from('fake-jpeg-bytes');

    const newPeer = name => ({
        peerId: name + '-peer-' + Date.now() + '-' + roomNumber,
        sessionId: name + '-session-' + Date.now() + '-' + roomNumber,
        originPlatform: 'test',
        name
    });

    async function join(peer) {
        const res = await request(app).post('/api/rooms/').send({ id: roomId, peer }).expect(200);
        return { ...peer, token: res.body.sessionToken };
    }

    const auth = (req, peer) => peer ? req.set('X-Session-Id', peer.sessionId).set('X-Session-Token', peer.token) : req;
    const blobUrl = (hash = infoHash) => `/api/rooms/${roomId}/photos/blob?infoHash=${encodeURIComponent(hash)}`;

    function putChunk(peer, { offset = 0, size = bytes.length, body = bytes, hash = infoHash, type = 'image/jpeg' } = {}) {
        return auth(request(app).put(`${blobUrl(hash)}&offset=${offset}&size=${size}`), peer)
            .set('Content-Type', type).send(body);
    }

    function download(peer, hash = infoHash) {
        return auth(request(app).get(blobUrl(hash)), peer)
            .buffer(true)
            .parse((res, cb) => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    }

    async function photoState(hash = infoHash) {
        const room = await request(app).get(`/api/rooms/${roomId}`).expect(200);
        return room.body.photos.find(p => p.infoHash === hash);
    }

    beforeEach(async () => {
        await started;
        roomId = 'relay-room-' + Date.now() + '-' + roomNumber++;
        sharer = await join(newPeer('sharer'));
        await request(app).post(`/api/rooms/${roomId}/photos/`).send({
            sessionId: sharer.sessionId,
            photos: [{ infoHash, peerId: sharer.peerId, fileName: 'a.jpg', fileType: 'image/jpeg' }]
        }).expect(200);
        receiver = await join(newPeer('receiver'));
    });

    it('serves nothing before a copy exists, and nothing to strangers', async () => {
        await download(receiver).expect(404);
        await putChunk(sharer).expect(200);
        await download(null).expect(403);
        await download({ ...receiver, token: 'guess' }).expect(403);
    });

    it('stores a copy sent in chunks and serves back the exact bytes', async () => {
        const first = await putChunk(sharer, { size: bytes.length, body: bytes.subarray(0, 5) }).expect(200);
        assert.deepStrictEqual(first.body, { infoHash, received: 5, size: bytes.length, complete: false });
        let photo = await photoState();
        assert.strictEqual(photo.hasServerCopy, undefined);
        assert.strictEqual(photo.serverCopyReceived, 5);
        assert.strictEqual(photo.serverCopyUploader, sharer.peerId);
        await download(receiver).expect(404);

        const done = await putChunk(sharer, { offset: 5, body: bytes.subarray(5) }).expect(200);
        assert.strictEqual(done.body.complete, true);
        photo = await photoState();
        assert.strictEqual(photo.hasServerCopy, true);
        assert.strictEqual(photo.serverCopySize, bytes.length);
        assert.strictEqual(photo.serverCopyUploader, undefined);
        // The room can see who sent it, when it arrived and when it goes.
        assert.strictEqual(photo.serverCopyFrom, sharer.peerId);
        assert.ok(photo.serverCopyStartedAt <= photo.serverCopyStoredAt);
        assert.strictEqual(photo.serverCopyExpiresAt - photo.serverCopyStoredAt, 24 * 60 * 60 * 1000);

        const down = await download(receiver)
            .expect(200)
            .expect('Content-Type', /image\/jpeg/)
            .expect('X-Content-Type-Options', 'nosniff');
        assert.deepStrictEqual(down.body, bytes);
    });

    it('serves byte ranges, so a dropped download can resume', async () => {
        await putChunk(sharer).expect(200);
        const part = await download(receiver).set('Range', 'bytes=5-').expect(206);
        assert.deepStrictEqual(part.body, bytes.subarray(5));
    });

    it('tells an uploader where to resume', async () => {
        await putChunk(sharer, { body: bytes.subarray(0, 5) }).expect(200);
        const again = await putChunk(sharer, { body: bytes.subarray(0, 5) }).expect(409);
        assert.strictEqual(again.body.code, 'OFFSET');
        assert.strictEqual(again.body.received, 5);
    });

    it('takes copies only from someone who has the whole photo', async () => {
        await putChunk(null).expect(403);
        await putChunk({ ...sharer, token: 'guess' }).expect(403);
        await putChunk(receiver).expect(403);

        await auth(request(app).post(`/api/rooms/${roomId}/photos/owners/`), receiver)
            .send([{ infoHash, peerId: receiver.peerId, loading: true }]).expect(200);
        await putChunk(receiver).expect(403);
        await auth(request(app).put(`/api/rooms/${roomId}/photos/owners/`), receiver)
            .send([{ infoHash, peerId: receiver.peerId, loading: false }]).expect(200);
        await putChunk(receiver).expect(200);
    });

    it('lets one holder upload at a time, and keeps a finished copy', async () => {
        await auth(request(app).post(`/api/rooms/${roomId}/photos/owners/`), receiver)
            .send([{ infoHash, peerId: receiver.peerId, loading: false }]).expect(200);
        await putChunk(sharer, { body: bytes.subarray(0, 5) }).expect(200);
        const busy = await putChunk(receiver, { offset: 5, body: bytes.subarray(5) }).expect(409);
        assert.strictEqual(busy.body.uploading, true);

        await putChunk(sharer, { offset: 5, body: bytes.subarray(5) }).expect(200);
        const exists = await putChunk(sharer, { body: Buffer.from('replacement') }).expect(409);
        assert.strictEqual(exists.body.exists, true);
    });

    it('turns down files over the limit before any bytes are kept', async () => {
        const res = await putChunk(sharer, { size: MAX_PHOTO_BYTES + 1, body: Buffer.from('x') }).expect(413);
        assert.strictEqual(res.body.code, 'TOO_LARGE');
        await putChunk(sharer, { size: MAX_CHUNK_BYTES + 2, body: Buffer.alloc(MAX_CHUNK_BYTES + 1) }).expect(413);
    });

    it('lets a stalled receiver ask for a copy, cleared once one exists', async () => {
        await auth(request(app).post(`${blobUrl()}`.replace('/blob?', '/blob/request?')), null).expect(403);
        const asked = await auth(request(app).post(blobUrl().replace('/blob?', '/blob/request?')), receiver).expect(200);
        assert.ok(asked.body.serverCopyRequestedAt > 0);
        assert.ok((await photoState()).serverCopyRequestedAt > 0);

        await putChunk(sharer).expect(200);
        const photo = await photoState();
        assert.strictEqual(photo.hasServerCopy, true);
        assert.strictEqual(photo.serverCopyRequestedAt, undefined);
    });

    it('forgets a request once everyone has the photo', async () => {
        await auth(request(app).post(blobUrl().replace('/blob?', '/blob/request?')), receiver).expect(200);
        await auth(request(app).post(`/api/rooms/${roomId}/photos/owners/`), receiver)
            .send([{ infoHash, peerId: receiver.peerId, loading: false }]).expect(200);
        assert.strictEqual((await photoState()).serverCopyRequestedAt, undefined);
    });

    it('drops the copy once everyone in the room has the photo', async () => {
        await putChunk(sharer).expect(200);
        await download(receiver).expect(200);
        await auth(request(app).post(`/api/rooms/${roomId}/photos/owners/`), receiver)
            .send([{ infoHash, peerId: receiver.peerId, loading: false }]).expect(200);

        assert.strictEqual((await photoState()).hasServerCopy, false);
        await download(receiver).expect(404);
    });

    it('keeps copies for latecomers when the room asks for it', async () => {
        await request(app).put(`/api/rooms/${roomId}/settings`).send({ keepCopies: true }).expect(403);
        await auth(request(app).put(`/api/rooms/${roomId}/settings`), receiver).send({ keepCopies: 'yes' }).expect(400);
        const set = await auth(request(app).put(`/api/rooms/${roomId}/settings`), receiver).send({ keepCopies: true }).expect(200);
        assert.strictEqual(set.body.keepCopies, true);
        assert.strictEqual(set.body.changedBy.peerId, receiver.peerId);
        const room = await request(app).get(`/api/rooms/${roomId}`).expect(200);
        assert.strictEqual(room.body.settings.keepCopies, true);

        await putChunk(sharer).expect(200);
        await auth(request(app).post(`/api/rooms/${roomId}/photos/owners/`), receiver)
            .send([{ infoHash, peerId: receiver.peerId, loading: false }]).expect(200);
        assert.strictEqual((await photoState()).hasServerCopy, true);

        // Switching it off lets go of copies nobody needs any more.
        await auth(request(app).put(`/api/rooms/${roomId}/settings`), sharer).send({ keepCopies: false }).expect(200);
        assert.strictEqual((await photoState()).hasServerCopy, false);
    });

    it("doesn't let a photo update fake a copy, change hands or swap the fingerprint copies are checked against", async () => {
        await request(app).post(`/api/rooms/${roomId}/photos/`).send({
            sessionId: sharer.sessionId,
            photos: [{ infoHash: 'fp-hash', peerId: sharer.peerId, fileName: 'b.jpg', fingerprint: '3:abc' }]
        }).expect(200);
        await request(app).put(`/api/rooms/${roomId}/photos/`)
            .send([{ infoHash, hasServerCopy: true, serverCopySize: 3, peerId: receiver.peerId, owners: [] },
                { infoHash: 'fp-hash', fingerprint: '3:evil' }]).expect(200);
        const photo = await photoState();
        assert.strictEqual(photo.hasServerCopy, undefined);
        assert.strictEqual(photo.peerId, sharer.peerId);
        assert.strictEqual(photo.owners.length, 1);
        assert.strictEqual((await photoState('fp-hash')).fingerprint, '3:abc');
        await putChunk(receiver).expect(403);
    });

    it("doesn't let anyone claim someone else has the photo to upload or drop its copy", async () => {
        await putChunk(sharer).expect(200);
        // The receiver can't record the copy as had by everyone...
        await auth(request(app).post(`/api/rooms/${roomId}/photos/owners/`), sharer)
            .send([{ infoHash, peerId: receiver.peerId, loading: false }]).expect(403);
        assert.strictEqual((await photoState()).hasServerCopy, true);
        // ...nor can a stranger without a session claim it for themselves.
        await request(app).post(`/api/rooms/${roomId}/photos/owners/`)
            .send([{ infoHash, peerId: receiver.peerId, loading: false }]).expect(403);
        await putChunk(receiver).expect(403);
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
            await putChunk(sharer, { type: uploadType }).expect(200);
            await download(receiver).expect(200)
                .expect('Content-Type', expected)
                .expect('X-Content-Type-Options', 'nosniff');
        });
    }

    it('supports compound infoHashes containing slashes via the query string', async () => {
        const compound = infoHash + '-folder/pic.jpg';
        await request(app).post(`/api/rooms/${roomId}/photos/`).send({
            sessionId: sharer.sessionId,
            photos: [{ infoHash: compound, peerId: sharer.peerId, fileName: 'pic.jpg', fileType: 'image/jpeg' }]
        }).expect(200);
        await putChunk(sharer, { hash: compound }).expect(200);
        const down = await download(receiver, compound).expect(200);
        assert.deepStrictEqual(down.body, bytes);
    });

    it('rejects empty bodies, unknown photos and unknown rooms', async () => {
        await auth(request(app).put(`${blobUrl()}&offset=0&size=3`), sharer).expect(400);
        await putChunk(sharer, { hash: 'nope' }).expect(404);
        await auth(request(app).put(`/api/rooms/nope/photos/blob?infoHash=${infoHash}&offset=0&size=3`), sharer)
            .set('Content-Type', 'image/jpeg').send(bytes).expect(404);
    });

    it('drops the copy when the photo is deleted', async () => {
        await putChunk(sharer).expect(200);
        await request(app).delete(`/api/rooms/${roomId}/photos/`).send({ infoHash }).expect(200);
        await download(receiver).expect(404);
    });

    it('deletes the whole room, with its server copies, for someone in it', async () => {
        await putChunk(sharer).expect(200);
        await auth(request(app).delete(`/api/rooms/${roomId}`), null).expect(403);
        await auth(request(app).delete(`/api/rooms/${roomId}`), receiver).expect(200);
        await request(app).get(`/api/rooms/${roomId}`).expect(404);
        await download(receiver).expect(404);
        await auth(request(app).delete(`/api/rooms/${roomId}`), receiver).expect(404);
    });
});
