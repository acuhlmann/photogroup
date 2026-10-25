import { describe, it, expect, vi } from 'vitest';
import EventEmitter from 'eventemitter3';
import { watchLinks, selectedPair } from './linkStats';

/** A stats report like Chrome's: a transport naming its pair, and the candidates. */
const report = ({ sent, received, requests, responses, rtt = 0.012, local = 'srflx' }) => new Map([
    ['T1', { id: 'T1', type: 'transport', selectedCandidatePairId: 'CP1' }],
    ['CP1', {
        id: 'CP1', type: 'candidate-pair', localCandidateId: 'L1', remoteCandidateId: 'R1',
        bytesSent: sent, bytesReceived: received, requestsSent: requests, responsesReceived: responses,
        currentRoundTripTime: rtt,
    }],
    ['L1', { id: 'L1', type: 'local-candidate', candidateType: local, address: '203.0.113.7', port: 5000, protocol: 'udp', relayProtocol: local === 'relay' ? 'udp' : undefined }],
    ['R1', { id: 'R1', type: 'remote-candidate', candidateType: 'srflx', address: '198.51.100.2', port: 6000 }],
]);

describe('linkStats', () => {
    it('finds the pair in use, also without transport stats', () => {
        const chrome = selectedPair(report({ sent: 0, received: 0, requests: 0, responses: 0 }));
        expect(chrome.pair.id).toBe('CP1');
        expect(chrome.local.candidateType).toBe('srflx');
        const firefox = new Map([
            ['CP2', { id: 'CP2', type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'L', remoteCandidateId: 'R' }],
        ]);
        expect(selectedPair(firefox).pair.id).toBe('CP2');
        expect(selectedPair(new Map())).toBeNull();
    });

    it('emits rates, rtt and STUN checks per peer from the counters', async () => {
        vi.useFakeTimers();
        const clock = { value: 0 };
        const reports = [
            report({ sent: 1000, received: 5000, requests: 4, responses: 4 }),
            report({ sent: 3000, received: 25000, requests: 5, responses: 5 }),
        ];
        const pc = { connectionState: 'connected', getStats: vi.fn(async () => reports.shift()) };
        const client = { torrents: [{ _peers: new Map([['x', { conn: { _pc: pc }, wire: { peerId: 'them' } }]]) }] };
        const emitter = new EventEmitter();
        const seen = [];
        emitter.on('linkStats', stat => seen.push(stat));
        const stop = watchLinks({ client, emitter, every: 1000, now: () => clock.value });

        await vi.advanceTimersByTimeAsync(1000);
        clock.value = 1000;
        await vi.advanceTimersByTimeAsync(1000);
        stop();
        vi.useRealTimers();

        expect(seen).toHaveLength(2);
        const [, second] = seen;
        expect(second).toMatchObject({
            peerId: 'them', rtt: 12, rx: 20000, tx: 2000, checks: 1, answers: 1,
            local: 'srflx', remote: 'srflx', localAddress: '203.0.113.7:5000', remoteAddress: '198.51.100.2:6000',
        });
    });
});
