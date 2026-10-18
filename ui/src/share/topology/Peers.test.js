import { EventEmitter } from 'events';
import Peers from './Peers';

describe('Peers', () => {
    it('replaces a peer that is announced again when it re-joins, instead of listing it twice', () => {
        const emitter = new EventEmitter();
        const peers = new Peers(emitter, [{ peerId: 'host' }, { peerId: 'phone', networkChain: [] }], {});
        const counts = [];
        emitter.on('numPeersChange', count => counts.push(count));

        emitter.emit('peers', { type: 'add', item: { peerId: 'phone', networkChain: [{ ip: '192.168.1.20' }] } });

        expect(peers.items.map(item => item.peerId)).toEqual(['host', 'phone']);
        expect(peers.items[1].networkChain).toEqual([{ ip: '192.168.1.20' }]);
        expect(counts).toEqual([2]);
    });

    it('adds a peer it has not seen yet', () => {
        const emitter = new EventEmitter();
        const peers = new Peers(emitter, [{ peerId: 'host' }], {});

        emitter.emit('peers', { type: 'add', item: { peerId: 'phone' } });

        expect(peers.items.map(item => item.peerId)).toEqual(['host', 'phone']);
    });
});
