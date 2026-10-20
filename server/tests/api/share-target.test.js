// Suppress console output before loading app
import '../test-setup.js';

import request from 'supertest';
import assert from 'assert';
import { app, started } from '../../app.js';

describe('Share target', () => {
    before(async () => {
        await started;
    });

    it('sends a share that reached the server back to the app, saying it was missed', async () => {
        const response = await request(app)
            .post('/share-target')
            .attach('media', Buffer.from([0xff, 0xd8, 0xff]), 'photo.jpg');
        assert.strictEqual(response.status, 303);
        assert.strictEqual(response.headers.location, '/?shared=missed');
    });
});
