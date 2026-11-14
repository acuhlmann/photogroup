import { describe, it, expect } from 'vitest';
import EventEmitter from 'eventemitter3';
import TransferLedger, { connectionFailure } from './TransferLedger';

describe('TransferLedger connection failures', () => {
    it('reads the reason from a WebTorrent warning, and ignores other warnings', () => {
        expect(connectionFailure('Connection error: Ice connection failed.')).toBe('ICE failed');
        expect(connectionFailure('Connection error: Connection failed.')).toBe('connection failed');
        expect(connectionFailure('ignoring invalid web seed: x')).toBe(null);
        expect(connectionFailure('Invalid tracker response')).toBe(null);
    });

    it('keeps each failed connection with its photo', () => {
        const ledger = new TransferLedger({ emitter: new EventEmitter(), now: () => 5 });
        const torrent = new EventEmitter();
        torrent.infoHash = 'abc';
        ledger.track(torrent);
        torrent.emit('warning', new Error('Connection error: Ice connection failed.'));
        torrent.emit('warning', new Error('ignoring invalid web seed: x'));
        expect(ledger.failures()).toEqual([{ at: 5, reason: 'ICE failed', text: 'Connection error: Ice connection failed.', infoHash: 'abc' }]);
        expect(ledger.get('abc').stages.at(-1)).toMatchObject({ lane: 'p2p', stage: 'failed' });
    });
});
