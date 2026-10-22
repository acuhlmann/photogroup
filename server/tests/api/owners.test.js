// Suppress console output before loading app
import '../test-setup.js';

import request from 'supertest';
import assert from 'assert';
import { app, started } from '../../app.js';

describe('Photo Owners API', () => {
    let testRoomId;
    let testPeer;
    let testPhotoHash;
    let session;

    before(async () => {
        await started;
        testRoomId = 'test-room-owners-' + Date.now();
        testPeer = {
            peerId: 'test-peer-owners-' + Date.now(),
            sessionId: 'test-session-owners-' + Date.now(),
            originPlatform: 'Chrome 100.0 on Windows 10',
            name: 'Test Peer'
        };
        testPhotoHash = 'test-photo-hash-' + Date.now();

        // Create a room and add a photo
        const created = await request(app)
            .post('/api/rooms/')
            .send({
                id: testRoomId,
                peer: testPeer
            });
        session = { 'X-Session-Id': testPeer.sessionId, 'X-Session-Token': created.body.sessionToken };

        await request(app)
            .post(`/api/rooms/${testRoomId}/photos/`)
            .send({
                sessionId: testPeer.sessionId,
                photos: [{
                    infoHash: testPhotoHash,
                    peerId: testPeer.peerId,
                    name: 'test-photo.jpg',
                    length: 1024
                }]
            });
    });

    describe('POST /api/rooms/:id/photos/owners/', () => {
        it('should add photo owners', (done) => {
            const owners = [{
                infoHash: testPhotoHash,
                peerId: testPeer.peerId,
                loading: false
            }];

            request(app)
                .post(`/api/rooms/${testRoomId}/photos/owners/`)
                .set(session)
                .send(owners)
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    assert(typeof res.body === 'boolean', 'Should return boolean');
                    done();
                });
        });

        it("refuses changes without the session's proof, or to someone else's ownership", async () => {
            const owner = [{ infoHash: testPhotoHash, peerId: testPeer.peerId, loading: false }];
            const url = `/api/rooms/${testRoomId}/photos/owners/`;
            await request(app).post(url).send(owner).expect(403);
            await request(app).put(url).send(owner).expect(403);
            await request(app).post(url).set({ ...session, 'X-Session-Token': 'guess' }).send(owner).expect(403);
            await request(app).post(url).set(session).send([{ ...owner[0], peerId: 'someone-else' }]).expect(403);
            await request(app).put(url).set(session).send([{ ...owner[0], peerId: 'someone-else' }]).expect(403);
            await request(app).delete(url + 'someone-else').set(session).expect(403);
            await request(app).delete(url + testPeer.peerId).expect(403);
        });

        it('should return 404 for non-existent room', (done) => {
            request(app)
                .post('/api/rooms/non-existent-room/photos/owners/')
                .send([{
                    infoHash: testPhotoHash,
                    peerId: testPeer.peerId
                }])
                .expect(404, done);
        });
    });

    describe('PUT /api/rooms/:id/photos/owners/', () => {
        it('should update photo owners', (done) => {
            const updates = [{
                infoHash: testPhotoHash,
                peerId: testPeer.peerId,
                loading: true
            }];

            request(app)
                .put(`/api/rooms/${testRoomId}/photos/owners/`)
                .set(session)
                .send(updates)
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    assert(res.body === true, 'Should return true');
                    done();
                });
        });
    });

    describe('DELETE /api/rooms/:id/photos/owners/:peerId', () => {
        it('should remove photo owner', (done) => {
            request(app)
                .delete(`/api/rooms/${testRoomId}/photos/owners/${testPeer.peerId}`)
                .set(session)
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    assert(typeof res.body === 'boolean', 'Should return boolean');
                    done();
                });
        });

        it('should return 404 for non-existent room', (done) => {
            request(app)
                .delete('/api/rooms/non-existent-room/photos/owners/test-peer')
                .expect(404, done);
        });
    });
});

