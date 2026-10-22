// Suppress console output before loading app
import '../test-setup.js';

import request from 'supertest';
import assert from 'assert';
import { app, started } from '../../app.js';

describe('Peers API', () => {
    let testRoomId;
    let testPeer;

    before(async () => {
        await started;
        testRoomId = 'test-room-peers-' + Date.now();
        testPeer = {
            peerId: 'test-peer-peers-' + Date.now(),
            sessionId: 'test-session-peers-' + Date.now(),
            originPlatform: 'Chrome 100.0 on Windows 10',
            name: 'Test Peer'
        };

        // Create a room first
        await request(app)
            .post('/api/rooms/')
            .send({
                id: testRoomId,
                peer: testPeer
            });
    });

    describe('PUT /api/rooms/:id/peers/:peerId', () => {
        it('should update an existing peer', (done) => {
            const update = {
                name: 'Updated Peer Name'
            };

            request(app)
                .put(`/api/rooms/${testRoomId}/peers/${testPeer.peerId}`)
                .send(update)
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    assert(res.body === true, 'Should return true');
                    done();
                });
        });

        it('should create a peer if it does not exist with required fields', (done) => {
            const newPeerId = 'new-peer-' + Date.now();
            const newPeer = {
                peerId: newPeerId,
                sessionId: 'new-session-' + Date.now(),
                originPlatform: 'Firefox 100.0 on Linux',
                name: 'New Peer'
            };

            request(app)
                .put(`/api/rooms/${testRoomId}/peers/${newPeerId}`)
                .send(newPeer)
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    assert(res.body.hasOwnProperty('photos'), 'Response should have photos');
                    assert(res.body.hasOwnProperty('peers'), 'Response should have peers');
                    done();
                });
        });

        it('should return 404 if peer not found and missing required fields', (done) => {
            request(app)
                .put(`/api/rooms/${testRoomId}/peers/non-existent-peer`)
                .send({
                    name: 'Incomplete Peer'
                })
                .expect(404, done);
        });

        it('should return 404 for non-existent room', (done) => {
            request(app)
                .put('/api/rooms/non-existent-room/peers/test-peer')
                .send({
                    name: 'Updated Name'
                })
                .expect(404, done);
        });
    });
    describe('POST /api/rooms/:id/peers/:peerId/away', () => {
        it('marks the caller away only with its session token', async () => {
            const roomId = 'test-room-away-' + Date.now();
            const peer = { peerId: 'away-peer-' + Date.now(), sessionId: 'away-session-' + Date.now(), originPlatform: 'Pixel 7' };
            const joined = await request(app).post('/api/rooms/').send({ id: roomId, peer }).expect(200);
            const url = `/api/rooms/${roomId}/peers/${peer.peerId}/away?sessionId=${peer.sessionId}`;

            const denied = await request(app).post(url + '&token=guess').expect(200);
            assert.strictEqual(denied.body, false);
            await request(app).post(`/api/rooms/${roomId}/peers/${peer.peerId}/away`).expect(400);

            const ok = await request(app).post(url + '&token=' + joined.body.sessionToken).expect(200);
            assert.strictEqual(ok.body, true);
            const room = await request(app).get(`/api/rooms/${roomId}`).expect(200);
            assert.ok(room.body.peers.find(item => item.peerId === peer.peerId).away > 0);
        });
    });
});

