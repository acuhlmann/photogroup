// Suppress console output before loading app
require('../test-setup');

const request = require('supertest');
const assert = require('assert');
const {app, started} = require('../../app');

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
});

