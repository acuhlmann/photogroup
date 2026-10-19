import '../test-setup.js';

import request from 'supertest';
import assert from 'assert';
import { app, started } from '../../app.js';

describe('Shared photo details', () => {
    let roomId;
    let roomNumber = 0;
    let alice;
    let bob;
    const infoHash = 'detailshash123';

    async function join(name) {
        const peer = { peerId: name + '-peer-' + Date.now(), sessionId: name + '-session-' + Date.now(), originPlatform: 'test', name };
        const res = await request(app).post('/api/rooms/').send({ id: roomId, peer }).expect(200);
        return { ...peer, sessionToken: res.body.sessionToken };
    }

    const edit = (who, fields) => request(app).put(`/api/rooms/${roomId}/photos/details`)
        .send({ infoHash, sessionId: who.sessionId, sessionToken: who.sessionToken, ...fields });

    beforeEach(async () => {
        await started;
        roomId = 'details-room-' + Date.now() + '-' + roomNumber++;
        alice = await join('Alice');
        bob = await join('Bob');
        await request(app).post(`/api/rooms/${roomId}/photos/`).send({
            sessionId: alice.sessionId,
            photos: [{ infoHash, peerId: alice.peerId, fileName: 'a.jpg', fileType: 'image/jpeg' }]
        }).expect(200);
    });

    it('lets anyone in the room set title, description and rating, and names them', async () => {
        const res = await edit(bob, { title: '  Harbor light ', description: 'Misty morning.', rating: 4 }).expect(200);
        assert.strictEqual(res.body.details.title, 'Harbor light');
        assert.strictEqual(res.body.details.rating, 4);
        assert.deepStrictEqual(res.body.details.editedBy, { peerId: bob.peerId, name: 'Bob', platform: 'test' });

        const room = await request(app).get(`/api/rooms/${roomId}`).expect(200);
        const details = room.body.photos.find(p => p.infoHash === infoHash).details;
        assert.strictEqual(details.description, 'Misty morning.');
    });

    it('changes only the fields sent, and clears with empty values', async () => {
        await edit(alice, { title: 'First', description: 'Kept', rating: 3 }).expect(200);
        const res = await edit(bob, { title: '', rating: 0 }).expect(200);
        assert.strictEqual(res.body.details.title, '');
        assert.strictEqual(res.body.details.rating, 0);
        assert.strictEqual(res.body.details.description, 'Kept');
        assert.strictEqual(res.body.details.editedBy.name, 'Bob');
    });

    it('sets, renames and hides a location', async () => {
        const res = await edit(bob, { location: { lat: 31.2400004, long: 121.4905, name: ' The Bund ' } }).expect(200);
        assert.deepStrictEqual(res.body.details.location, { lat: 31.24, long: 121.4905, name: 'The Bund' });

        const unnamed = await edit(alice, { location: { lat: -33.8678, long: 151.2073 } }).expect(200);
        assert.deepStrictEqual(unnamed.body.details.location, { lat: -33.8678, long: 151.2073 });

        const hidden = await edit(alice, { location: null }).expect(200);
        assert.strictEqual(hidden.body.details.location, null);
        const room = await request(app).get(`/api/rooms/${roomId}`).expect(200);
        assert.strictEqual(room.body.photos.find(p => p.infoHash === infoHash).details.location, null);
    });

    it('rejects locations that are not on the map', async () => {
        await edit(bob, { location: { lat: 91, long: 0 } }).expect(400);
        await edit(bob, { location: { lat: 10, long: -181 } }).expect(400);
        await edit(bob, { location: { lat: '10', long: 5 } }).expect(400);
        await edit(bob, { location: [10, 5] }).expect(400);
        await edit(bob, { location: { lat: 10, long: 5, name: 'x'.repeat(201) } }).expect(400);
    });

    it('requires a session token of someone in the room', async () => {
        await edit({ sessionId: bob.sessionId, sessionToken: 'wrong' }, { title: 'x' }).expect(403);
        await edit({ sessionId: 'stranger', sessionToken: undefined }, { title: 'x' }).expect(403);
    });

    it('rejects invalid values and unknown photos', async () => {
        await edit(bob, { rating: 7 }).expect(400);
        await edit(bob, { rating: 2.5 }).expect(400);
        await edit(bob, { title: 42 }).expect(400);
        await edit(bob, { title: 'x'.repeat(201) }).expect(400);
        await edit(bob, {}).expect(400);
        await request(app).put(`/api/rooms/${roomId}/photos/details`)
            .send({ infoHash: 'nope', sessionId: bob.sessionId, sessionToken: bob.sessionToken, title: 'x' }).expect(404);
    });

    it('cannot be changed through the generic photo update', async () => {
        await edit(alice, { title: 'Real' }).expect(200);
        await request(app).put(`/api/rooms/${roomId}/photos/`)
            .send([{ infoHash, details: { title: 'Forged', editedBy: { name: 'Alice' } } }]).expect(200);
        const room = await request(app).get(`/api/rooms/${roomId}`).expect(200);
        assert.strictEqual(room.body.photos.find(p => p.infoHash === infoHash).details.title, 'Real');
    });
});
