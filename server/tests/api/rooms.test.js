// Suppress console output before loading app
import '../test-setup.js';

import request from 'supertest';
import assert from 'assert';
import { app, started } from '../../app.js';

describe('Rooms API', () => {
    let testRoomId;
    let testPeer;

    before(async () => {
        await started;
        testRoomId = 'test-room-' + Date.now();
        testPeer = {
            peerId: 'test-peer-' + Date.now(),
            sessionId: 'test-session-' + Date.now(),
            originPlatform: 'Chrome 100.0 on Windows 10',
            name: 'Test Peer'
        };
    });

    describe('POST /api/rooms/', () => {
        it('should create a new room', (done) => {
            request(app)
                .post('/api/rooms/')
                .send({
                    id: testRoomId,
                    peer: testPeer
                })
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    assert(res.body.hasOwnProperty('photos'), 'Response should have photos');
                    assert(res.body.hasOwnProperty('peers'), 'Response should have peers');
                    assert(res.body.hasOwnProperty('connections'), 'Response should have connections');
                    assert(Array.isArray(res.body.photos), 'Photos should be an array');
                    assert(Array.isArray(res.body.peers), 'Peers should be an array');
                    done();
                });
        });

        it('should return 400 if peer data is missing', (done) => {
            request(app)
                .post('/api/rooms/')
                .send({
                    id: 'test-room-2'
                })
                .expect(400, done);
        });
    });

    describe('GET /api/rooms/:id', () => {
        it('should get room data', (done) => {
            request(app)
                .get(`/api/rooms/${testRoomId}`)
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    assert(res.body.hasOwnProperty('photos'), 'Response should have photos');
                    assert(res.body.hasOwnProperty('peers'), 'Response should have peers');
                    done();
                });
        });

        it('should return 404 for non-existent room', (done) => {
            request(app)
                .get('/api/rooms/non-existent-room')
                .expect(404, done);
        });
    });

    describe('POST /api/rooms/:id', () => {
        it('should join an existing room', (done) => {
            const newPeer = {
                ...testPeer,
                peerId: 'test-peer-2-' + Date.now(),
                sessionId: 'test-session-2-' + Date.now()
            };

            request(app)
                .post(`/api/rooms/${testRoomId}`)
                .send({
                    peer: newPeer
                })
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    assert(res.body.hasOwnProperty('photos'), 'Response should have photos');
                    assert(res.body.hasOwnProperty('peers'), 'Response should have peers');
                    assert(res.body.peers.length > 0, 'Should have at least one peer');
                    done();
                });
        });

        it('should return 404 when joining non-existent room', (done) => {
            request(app)
                .post('/api/rooms/non-existent-room')
                .send({
                    peer: testPeer
                })
                .expect(404, done);
        });
    });

    describe('POST /api/rooms/:id/photos/', () => {
        it('should add photos to a room', (done) => {
            const photos = [{
                infoHash: 'test-info-hash-1',
                peerId: testPeer.peerId,
                name: 'test-photo.jpg',
                length: 1024
            }];

            request(app)
                .post(`/api/rooms/${testRoomId}/photos/`)
                .send({
                    sessionId: testPeer.sessionId,
                    photos: photos
                })
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    assert(Array.isArray(res.body), 'Response should be an array');
                    assert(res.body.length === 1, 'Should have one photo');
                    assert(res.body[0].hasOwnProperty('infoHash'), 'Photo should have infoHash');
                    done();
                });
        });

        it('should return 400 if peerId is missing', (done) => {
            const photos = [{
                infoHash: 'test-info-hash-2',
                name: 'test-photo.jpg'
            }];

            request(app)
                .post(`/api/rooms/${testRoomId}/photos/`)
                .send({
                    sessionId: testPeer.sessionId,
                    photos: photos
                })
                .expect(400, done);
        });

        it('should return 404 for non-existent room', (done) => {
            request(app)
                .post('/api/rooms/non-existent-room/photos/')
                .send({
                    sessionId: testPeer.sessionId,
                    photos: [{
                        infoHash: 'test-hash',
                        peerId: testPeer.peerId
                    }]
                })
                .expect(404, done);
        });
    });

    describe('PUT /api/rooms/:id/photos/', () => {
        it('should update photos in a room', (done) => {
            const updates = [{
                infoHash: 'test-info-hash-1',
                name: 'updated-photo.jpg'
            }];

            request(app)
                .put(`/api/rooms/${testRoomId}/photos/`)
                .send(updates)
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    assert(Array.isArray(res.body), 'Response should be an array');
                    done();
                });
        });
    });

    describe('DELETE /api/rooms/:id/photos/', () => {
        it('should delete a photo from a room', (done) => {
            request(app)
                .delete(`/api/rooms/${testRoomId}/photos/`)
                .send({
                    infoHash: 'test-info-hash-1'
                })
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    assert(Array.isArray(res.body), 'Response should be an array');
                    done();
                });
        });

        it('should return 404 for non-existent room', (done) => {
            request(app)
                .delete('/api/rooms/non-existent-room/photos/')
                .send({
                    infoHash: 'test-hash'
                })
                .expect(404, done);
        });
    });

    describe('DELETE /api/rooms', () => {
        it('should reset all rooms', (done) => {
            request(app)
                .delete('/api/rooms')
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    assert(res.body.message === 'success', 'Should return success message');
                    done();
                });
        });
    });
});

