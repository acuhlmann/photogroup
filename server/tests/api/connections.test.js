// Suppress console output before loading app
import '../test-setup.js';

import request from 'supertest';
import assert from 'assert';
import { app, started } from '../../app.js';

describe('Connections API', () => {
    let testRoomId;
    let testPeer;

    before(async () => {
        await started;
        testRoomId = 'test-room-connections-' + Date.now();
        testPeer = {
            peerId: 'test-peer-connections-' + Date.now(),
            sessionId: 'test-session-connections-' + Date.now(),
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

    describe('POST /api/rooms/:id/connections', () => {
        it('should create a connection', (done) => {
            const connection = {
                infoHash: 'test-connection-hash',
                fileName: 'test-file.jpg',
                peerId: testPeer.peerId
            };

            request(app)
                .post(`/api/rooms/${testRoomId}/connections`)
                .send(connection)
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    assert(res.body === true, 'Should return true');
                    done();
                });
        });

        it('should return 404 for non-existent room', (done) => {
            request(app)
                .post('/api/rooms/non-existent-room/connections')
                .send({
                    infoHash: 'test-hash',
                    fileName: 'test.jpg'
                })
                .expect(404, done);
        });
    });

    describe('DELETE /api/rooms/:id/connections', () => {
        it('should delete a connection', (done) => {
            request(app)
                .delete(`/api/rooms/${testRoomId}/connections`)
                .send({
                    infoHash: 'test-connection-hash'
                })
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    assert(res.body === true, 'Should return true');
                    done();
                });
        });

        it('should return 404 for non-existent room', (done) => {
            request(app)
                .delete('/api/rooms/non-existent-room/connections')
                .send({
                    infoHash: 'test-hash'
                })
                .expect(404, done);
        });
    });
});

