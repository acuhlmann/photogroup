import { EventEmitter } from 'events';
import { vi } from 'vitest';
import NetworkTopologyFinder from './NetworkTopologyFinder';
import RoomsService from '../RoomsService';

const fakePc = vi.hoisted(() => ({
    addEventListener() {},
    createDataChannel() {},
    createOffer: () => Promise.resolve({}),
    setLocalDescription: () => Promise.resolve(),
    onicecandidate: null,
}));

vi.mock('simple-peer', () => ({
    default: class {
        constructor() {
            this._pc = fakePc;
        }
        on() {}
        destroy() {}
    },
}));

const sdp = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=candidate:1 1 udp 2122260223 192.168.1.20 50000 typ host',
    'a=candidate:2 1 udp 2122194687 10.0.0.5 50001 typ host',
    'a=candidate:3 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active',
    '',
].join('\r\n');

describe('NetworkTopologyFinder', () => {
    it('keeps a room member\'s network so re-joining the room still carries it', () => {
        const service = new RoomsService(new EventEmitter());
        service.master = { client: { peerId: 'phone' }, originPlatform: 'Pixel 7' };
        service.hasRoom = true;
        service.updatePeer = vi.fn().mockResolvedValue(true);

        new NetworkTopologyFinder(service, new EventEmitter()).start({});
        fakePc.onicecandidate({
            candidate: { candidate: 'candidate:3 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active' },
            target: { localDescription: { sdp } },
        });

        expect(service.updatePeer).toHaveBeenCalled();
        expect(service.peerData.networkChain.map(item => item.ip)).toEqual(['192.168.1.20', '10.0.0.5', '192.168.1.20']);
    });
});
