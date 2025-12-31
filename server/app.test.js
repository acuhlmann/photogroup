// Suppress console output before loading app
require('./tests/test-setup');

const request = require('supertest');
const {app, started} = require('./app');

describe('App Tests', () => {

    before(() => {
        return started;
    });

    it('should create a room with peer data', (done) => {
        request(app)
            .post('/api/rooms/')
            .send({
                id: 'test-room-app-' + Date.now(),
                peer: {
                    "sessionId":"omc0ojjc",
                    "peerId":"2d5757303030372d33473276664e4b6f426e7471",
                    "originPlatform":"Chrome 79.0.3945.88 on Windows 10 64-bit Win32 ",
                    "name":"Alex Desktop"
                }
            })
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .expect('Content-Type', /json/)
            .expect(200, done);
    });
});