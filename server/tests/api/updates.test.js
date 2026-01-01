// Suppress console output before loading app
import '../test-setup.js';

import request from 'supertest';
import { app, started } from '../../app.js';

describe('Updates API (SSE)', () => {
    let testRoomId;
    let testPeer;

    before(async () => {
        await started;
        testRoomId = 'test-room-updates-' + Date.now();
        testPeer = {
            peerId: 'test-peer-updates-' + Date.now(),
            sessionId: 'test-session-updates-' + Date.now(),
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

    describe('GET /api/rooms/:id/updates/', () => {
        it('should return 404 for non-existent room', (done) => {
            request(app)
                .get('/api/rooms/non-existent-room/updates/?sessionId=test-session')
                .expect(404, done);
        });
    });
});

