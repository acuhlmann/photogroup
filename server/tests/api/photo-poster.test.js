import '../test-setup.js';

import request from 'supertest';
import assert from 'assert';
import { app, started } from '../../app.js';

// A clip whose sharer could not decode it gets its poster from a device that could.
describe('Clip posters from the room', () => {
    let roomId;
    let roomNumber = 0;
    let alice;
    let bob;
    const infoHash = 'posterhash123';
    const jpegOf = text => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(text)]).toString('base64');
    const jpeg = jpegOf('jpeg bytes');

    async function join(name) {
        const peer = { peerId: name + '-peer-' + Date.now(), sessionId: name + '-session-' + Date.now(), originPlatform: 'test', name };
        const res = await request(app).post('/api/rooms/').send({ id: roomId, peer }).expect(200);
        return { ...peer, sessionToken: res.body.sessionToken };
    }

    const send = (who, fields) => request(app).put(`/api/rooms/${roomId}/photos/poster`)
        .send({ infoHash, sessionId: who.sessionId, sessionToken: who.sessionToken, ...fields });

    beforeEach(async () => {
        await started;
        roomId = 'poster-room-' + Date.now() + '-' + roomNumber++;
        alice = await join('Alice');
        bob = await join('Bob');
        await request(app).post(`/api/rooms/${roomId}/photos/`).send({
            sessionId: alice.sessionId,
            photos: [{ infoHash, peerId: alice.peerId, fileName: 'clip.mov', fileType: 'video/quicktime', poster: jpeg }]
        }).expect(200);
    });

    it('keeps the first poster a member sends, and shows it in the room', async () => {
        const room = await request(app).get(`/api/rooms/${roomId}`).expect(200);
        assert.strictEqual(room.body.photos[0].poster, undefined, 'an upload cannot bring its own');

        await send(bob, { poster: jpeg }).expect(200);
        const other = jpegOf('other');
        const second = await send(alice, { poster: other }).expect(200);
        assert.strictEqual(second.body.poster, jpeg);
        const after = await request(app).get(`/api/rooms/${roomId}`).expect(200);
        assert.strictEqual(after.body.photos[0].poster, jpeg);
    });

    it('takes posters only from members, only small JPEG data URLs, and not through the generic update', async () => {
        await send({ sessionId: 'nobody', sessionToken: 'x' }, { poster: jpeg }).expect(403);
        await send(bob, { poster: 'https://example.com/a.jpg' }).expect(400);
        await send(bob, { poster: 'data:image/jpeg;base64,' + Buffer.from('not a jpeg').toString('base64') }).expect(400);
        await send(bob, { poster: 'data:image/jpeg;base64,' + 'A'.repeat(70 * 1024) }).expect(400);
        await send(bob, { poster: jpeg, infoHash: 'missing' }).expect(404);
        await request(app).put(`/api/rooms/${roomId}/photos/`).send([{ infoHash, poster: jpeg }]).expect(200);
        const room = await request(app).get(`/api/rooms/${roomId}`).expect(200);
        assert.strictEqual(room.body.photos[0].poster, undefined);
    });
});
