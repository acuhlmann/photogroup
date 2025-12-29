const request = require('supertest');
const {app, started} = require('./app');

describe('GET /updates', () => {

    before(() => {
        return started;
    });

    /*it('responds with json', function(done) {
        request(app)
            .get('/api/updates?sessionId=omc0ojjc')
            .set('Accept', 'text/event-stream')
            .expect('Content-Type', /text/)
            .expect('transfer-encoding', 'chunked')
            //.expect(done);
    });*/

    it('responds with json', done => {
        request(app)
            .post('/api/peers')
            .send({
                "sessionId":"omc0ojjc",
                "peerId":"2d5757303030372d33473276664e4b6f426e7471",
                "originPlatform":"Chrome 79.0.3945.88 on Windows 10 64-bit Win32 ",
                "name":"Alex Desktop"
            })
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .expect('Content-Type', /json/)
            .expect(200, done);
    });
});