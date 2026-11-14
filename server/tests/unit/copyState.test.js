import '../test-setup.js';

import assert from 'assert';
import Rooms from '../../Rooms.js';

describe('Rooms.copyState', () => {
    it('sends null for a dropped copy, so clients forget its progress', () => {
        // JSON leaves out undefined: without nulls a client merging this kept
        // "uploading 100%" for a copy the server had deleted.
        const state = JSON.parse(JSON.stringify(Rooms.copyState({ infoHash: 'h1', hasServerCopy: false })));
        assert.deepStrictEqual(state, {
            infoHash: 'h1', hasServerCopy: false, serverCopySize: null, serverCopyReceived: null,
            serverCopyRequestedAt: null, serverCopyUploader: null,
            serverCopyStartedAt: null, serverCopyStoredAt: null, serverCopyExpiresAt: null, serverCopyFrom: null,
        });
    });
});
