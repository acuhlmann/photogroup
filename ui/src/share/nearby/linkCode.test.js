import { describe, it, expect } from 'vitest';
import { encodeLinkCode, decodeLinkCode, isLinkCode, readSdp, writeSdp, MAX_CANDIDATES } from './linkCode';
import { roomTag } from './notes';

const FINGERPRINT = '3A:50:63:13:14:62:9B:74:8E:90:1C:75:E4:7A:31:7B:F4:37:A0:59:49:15:3A:02:2D:BC:86:F0:1E:76:CF:0A';

// What Chrome makes for a data channel.
const chrome = candidates => [
    'v=0', 'o=- 2595030516177103967 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    ...candidates,
    'a=ice-ufrag:qxuB', 'a=ice-pwd:3u8slcOrUisvaPK/J0Ccv8NI', 'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${FINGERPRINT}`, 'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', '',
].join('\r\n');

// What Firefox makes: other key lengths, "UDP" in capitals.
const firefox = [
    'v=0', 'o=mozilla...THIS_IS_SDPARTA-99.0 4631577066112462330 0 IN IP4 0.0.0.0', 's=-', 't=0 0',
    'a=sendrecv', `a=fingerprint:sha-256 ${FINGERPRINT}`, 'a=group:BUNDLE 0', 'a=ice-options:trickle', 'a=msid-semantic:WMS *',
    'm=application 50000 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 192.168.1.20',
    'a=candidate:0 1 UDP 2122252543 192.168.1.20 50000 typ host',
    'a=candidate:1 1 TCP 2105524479 192.168.1.20 9 typ host tcptype active',
    'a=sendrecv', 'a=end-of-candidates', 'a=ice-pwd:0123456789abcdef0123456789abcdef', 'a=ice-ufrag:89abcdef',
    'a=mid:0', 'a=setup:active', 'a=sctp-port:5000', 'a=max-message-size:1073741823', '',
].join('\r\n');

const HOST_MDNS = 'a=candidate:3142392893 1 udp 2113937151 a98bdf58-fe69-4b36-862c-54c386b1cca1.local 58091 typ host generation 0 network-cost 999';
const HOST_V4 = 'a=candidate:1 1 udp 2113937151 192.168.43.1 51234 typ host generation 0 network-cost 10';
const HOST_V6 = 'a=candidate:2 1 udp 2113932031 fe80::1c2b:3aff:fe4d:5e6f 51235 typ host generation 0';
const SRFLX = 'a=candidate:3 1 udp 1677729535 203.0.113.9 40000 typ srflx raddr 192.168.43.1 rport 51234 generation 0';
const TCP = 'a=candidate:4 1 tcp 1518280447 192.168.43.1 9 typ host tcptype active generation 0';
const RELAY = 'a=candidate:5 1 udp 41885439 198.51.100.7 61000 typ relay raddr 203.0.113.9 rport 40000';

describe('link code', () => {
    it('carries what a description needs in about 100 bytes', () => {
        const code = encodeLinkCode({ kind: 'offer', id: 4711, room: 'z45keexwrxqzbeqimgsz', sdp: chrome([HOST_MDNS]) });
        expect(code.length).toBeLessThan(100);
        expect(isLinkCode(code)).toBe(true);
        const read = decodeLinkCode(code);
        expect(read).toMatchObject({ kind: 'offer', type: 'offer', id: 4711, roomTag: roomTag('z45keexwrxqzbeqimgsz') });
        expect(readSdp(read.sdp)).toEqual(readSdp(chrome([HOST_MDNS])));
        expect(read.sdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
        expect(read.sdp).toContain(`a=fingerprint:sha-256 ${FINGERPRINT}`);
        expect(read.sdp).toContain('a98bdf58-fe69-4b36-862c-54c386b1cca1.local 58091 typ host');
    });

    it('keeps IPv4, IPv6 and public addresses, and drops TCP and relay ones', () => {
        const sdp = chrome([SRFLX, TCP, HOST_V6, RELAY, HOST_V4]);
        const read = decodeLinkCode(encodeLinkCode({ kind: 'answer', id: 1, room: 'room-abc', sdp }));
        expect(read.kind).toBe('answer');
        expect(readSdp(read.sdp).candidates).toEqual([
            { address: '192.168.43.1', port: 51234, type: 'host' },
            { address: 'fe80:0:0:0:1c2b:3aff:fe4d:5e6f', port: 51235, type: 'host' },
            { address: '203.0.113.9', port: 40000, type: 'srflx' },
        ]);
        expect(read.sdp).toContain('203.0.113.9 40000 typ srflx raddr 0.0.0.0 rport 0');
        expect(read.sdp).not.toMatch(/relay|tcp/);
    });

    it('reads a description from Firefox', () => {
        const read = decodeLinkCode(encodeLinkCode({ kind: 'answer', id: 9, room: 'room-abc', sdp: firefox }));
        expect(readSdp(read.sdp)).toMatchObject({
            ufrag: '89abcdef', pwd: '0123456789abcdef0123456789abcdef', setup: 'active',
            candidates: [{ address: '192.168.1.20', port: 50000, type: 'host' }],
        });
    });

    it('takes no more addresses than a code should hold', () => {
        const many = Array.from({ length: 12 }, (_, i) => `a=candidate:${i} 1 udp 2113937151 10.0.0.${i + 1} ${5000 + i} typ host`);
        const read = decodeLinkCode(encodeLinkCode({ kind: 'offer', id: 2, room: 'room-abc', sdp: chrome(many) }));
        expect(readSdp(read.sdp).candidates).toHaveLength(MAX_CANDIDATES);
    });

    it('does not make a code from a description with no address or no keys', () => {
        expect(() => encodeLinkCode({ kind: 'offer', id: 2, room: 'room-abc', sdp: chrome([TCP]) })).toThrow(/address/);
        expect(() => encodeLinkCode({ kind: 'offer', id: 2, room: 'room-abc', sdp: 'v=0\r\n' })).toThrow();
    });

    it('reads nothing from bytes that are not a link code', () => {
        const code = encodeLinkCode({ kind: 'offer', id: 4711, room: 'room-abc', sdp: chrome([HOST_V4]) });
        expect(decodeLinkCode(null)).toBeNull();
        expect(decodeLinkCode(new Uint8Array([1, 2, 3]))).toBeNull();
        expect(decodeLinkCode(new TextEncoder().encode('https://photogroup.network/?room=abc'))).toBeNull();
        expect(decodeLinkCode(code.subarray(0, code.length - 3))).toBeNull();
        expect(decodeLinkCode(Uint8Array.from([...code, 0]))).toBeNull();
        const future = Uint8Array.from(code);
        future[2] = (9 << 4) | (future[2] & 0x0f);
        expect(isLinkCode(future)).toBe(true);
        expect(decodeLinkCode(future)).toBeNull();
    });

    it('lets no line break from a code into the description', () => {
        const code = encodeLinkCode({ kind: 'offer', id: 4711, room: 'room-abc', sdp: chrome([HOST_V4]) });
        // The key name starts after magic, kind, id, room mark, setup and its length.
        const evil = Uint8Array.from(code);
        evil[9] = 0x0a;
        expect(decodeLinkCode(evil)).toBeNull();
    });

    it('writes a description that reads back the same', () => {
        const values = readSdp(chrome([HOST_V4, SRFLX]));
        expect(readSdp(writeSdp(values))).toEqual(values);
    });
});
