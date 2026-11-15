// The code that links two phones with no server between them. WebRTC needs
// each phone to know the other's "session description": some keys and the
// addresses it listens on. A server passes them along as a rule. Here each
// phone shows them as one QR code and the other phone's camera reads it.
//
// A description is about 500 characters of text (SDP). For a data channel
// only a few values in it change, so the code holds those values alone,
// about 100 bytes, and the reader makes the text again.

import { roomTag } from './notes';

const MAGIC = [0x50, 0x44]; // "PD"
const VERSION = 1;
const KINDS = ['offer', 'answer'];
const SETUPS = ['actpass', 'active', 'passive'];
const TYPES = ['host', 'srflx'];
// More addresses make a larger code; a phone seldom has more that matter.
export const MAX_CANDIDATES = 6;
const UUID_LOCAL = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const ADDR_V4 = 0;
const ADDR_V6 = 1;
const ADDR_MDNS = 2;
const ADDR_NAME = 3;

function ipv6Bytes(text) {
    const address = text.split('%')[0];
    if (!/^[0-9a-f:]+$/i.test(address) || !address.includes(':')) return null;
    const [head, tail] = address.split('::');
    if (address.split('::').length > 2) return null;
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const missing = tail === undefined ? 0 : 8 - left.length - right.length;
    if (missing < 0 || (tail === undefined && left.length !== 8)) return null;
    const groups = [...left, ...Array(missing).fill('0'), ...right];
    if (groups.length !== 8 || groups.some(group => group.length > 4 || group === '')) return null;
    const bytes = new Uint8Array(16);
    groups.forEach((group, index) => {
        const value = parseInt(group, 16);
        bytes[index * 2] = value >> 8;
        bytes[index * 2 + 1] = value & 0xff;
    });
    return bytes;
}

function ipv6Text(bytes) {
    const groups = [];
    for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
    return groups.join(':');
}

const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

/** The values of a description that the other phone cannot make itself. */
export function readSdp(sdp) {
    const lines = String(sdp || '').split(/\r?\n/);
    const value = prefix => lines.find(line => line.startsWith(prefix))?.slice(prefix.length).trim();
    const ufrag = value('a=ice-ufrag:');
    const pwd = value('a=ice-pwd:');
    const print = value('a=fingerprint:');
    const setup = value('a=setup:');
    if (!ufrag || !pwd || !print || !SETUPS.includes(setup)) throw new Error('This description has no keys.');
    const [algorithm, digits] = print.split(/\s+/);
    if (algorithm.toLowerCase() !== 'sha-256') throw new Error('The fingerprint is not SHA-256.');
    const fingerprint = Uint8Array.from(digits.split(':').map(pair => parseInt(pair, 16)));
    if (fingerprint.length !== 32 || fingerprint.some(Number.isNaN)) throw new Error('The fingerprint is not complete.');

    const candidates = [];
    lines.filter(line => line.startsWith('a=candidate:')).forEach((line) => {
        const parts = line.slice('a=candidate:'.length).split(/\s+/);
        const [, component, transport, , address, port, typ, type] = parts;
        if (component !== '1' || String(transport).toLowerCase() !== 'udp' || typ !== 'typ' || !TYPES.includes(type)) return;
        const number = Number(port);
        if (!Number.isInteger(number) || number < 1 || number > 65535) return;
        if (candidates.some(known => known.address === address && known.port === number)) return;
        candidates.push({ address, port: number, type });
    });
    // The addresses of this network first, and IPv4 before IPv6: those are
    // the ones that two phones on one Wi-Fi use.
    const rank = candidate => (candidate.type === 'host' ? 0 : 2) + (candidate.address.includes(':') ? 1 : 0);
    candidates.sort((a, b) => rank(a) - rank(b));
    return { ufrag, pwd, fingerprint, setup, candidates: candidates.slice(0, MAX_CANDIDATES) };
}

/** The text of a data channel description, made from its values. */
export function writeSdp({ ufrag, pwd, fingerprint, setup, candidates }, sessionId = 1) {
    const print = Array.from(fingerprint, byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(':');
    const lines = [
        'v=0',
        `o=- ${sessionId} 2 IN IP4 127.0.0.1`,
        's=-',
        't=0 0',
        'a=group:BUNDLE 0',
        'a=msid-semantic: WMS',
        'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
        'c=IN IP4 0.0.0.0',
        `a=ice-ufrag:${ufrag}`,
        `a=ice-pwd:${pwd}`,
        'a=ice-options:trickle',
        `a=fingerprint:sha-256 ${print}`,
        `a=setup:${setup}`,
        'a=mid:0',
        'a=sctp-port:5000',
        'a=max-message-size:262144',
    ];
    candidates.forEach((candidate, index) => {
        const host = candidate.type === 'host';
        const priority = (host ? 2122260223 : 1686052607) - index;
        lines.push(`a=candidate:${index + 1} 1 udp ${priority} ${candidate.address} ${candidate.port} typ ${candidate.type}`
            + (host ? '' : ' raddr 0.0.0.0 rport 0'));
    });
    lines.push('a=end-of-candidates');
    return lines.join('\r\n') + '\r\n';
}

function ascii(text, what) {
    const value = String(text);
    if (!value.length || value.length > 255 || /[^\x21-\x7e]/.test(value)) throw new Error(`The ${what} cannot go in a code.`);
    return [value.length, ...Array.from(value, char => char.charCodeAt(0))];
}

function addressBytes(address) {
    const v4 = IPV4.exec(address);
    if (v4 && v4.slice(1).every(part => Number(part) <= 255)) return [ADDR_V4, ...v4.slice(1).map(Number)];
    const mdns = UUID_LOCAL.exec(address);
    if (mdns) return [ADDR_MDNS, ...mdns.slice(1).join('').match(/../g).map(pair => parseInt(pair, 16))];
    const v6 = ipv6Bytes(address);
    if (v6) return [ADDR_V6, ...v6];
    return [ADDR_NAME, ...ascii(address, 'address')];
}

/**
 * The bytes of a link code.
 * @param {object} code
 * @param {'offer'|'answer'} code.kind
 * @param {number} code.id the offer's number; an answer carries the number of the offer that it answers
 * @param {string} code.room the room's id; only a 16-bit mark of it goes in the code
 * @param {string} code.sdp the description
 */
export function encodeLinkCode({ kind, id, room, sdp }) {
    const values = readSdp(sdp);
    if (!values.candidates.length) throw new Error('This phone found no address to listen on.');
    const tag = roomTag(room);
    const bytes = [
        ...MAGIC,
        (VERSION << 4) | KINDS.indexOf(kind),
        (id >> 8) & 0xff, id & 0xff,
        tag >> 8, tag & 0xff,
        SETUPS.indexOf(values.setup),
        ...ascii(values.ufrag, 'key name'),
        ...ascii(values.pwd, 'key'),
        ...values.fingerprint,
        values.candidates.length,
    ];
    values.candidates.forEach((candidate) => {
        const [family, ...address] = addressBytes(candidate.address);
        bytes.push((TYPES.indexOf(candidate.type) << 4) | family, ...address, candidate.port >> 8, candidate.port & 0xff);
    });
    return Uint8Array.from(bytes);
}

/** Whether some bytes from a camera are a link code at all. */
export function isLinkCode(bytes) {
    return !!bytes && bytes.length > 8 && bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1];
}

/**
 * `{ kind, id, roomTag, sdp, type }` from the bytes of a code, or null when
 * the bytes are not a link code that this version reads.
 */
export function decodeLinkCode(bytes) {
    if (!isLinkCode(bytes) || bytes[2] >> 4 !== VERSION) return null;
    try {
        let at = 2;
        const next = () => {
            if (at >= bytes.length) throw new Error('short');
            return bytes[at++];
        };
        const take = (count) => {
            if (at + count > bytes.length) throw new Error('short');
            const part = bytes.subarray(at, at + count);
            at += count;
            return part;
        };
        const text = () => String.fromCharCode(...take(next()));
        const kind = KINDS[next() & 0x0f];
        const id = (next() << 8) | next();
        const tag = (next() << 8) | next();
        const setup = SETUPS[next()];
        const ufrag = text();
        const pwd = text();
        const fingerprint = Uint8Array.from(take(32));
        const count = next();
        if (!kind || !setup || !ufrag || !pwd || !count || count > MAX_CANDIDATES) return null;
        // A code can come from a stranger's screen: only plain characters go into the description.
        if (/[^A-Za-z0-9+/]/.test(ufrag + pwd)) return null;
        const candidates = [];
        for (let i = 0; i < count; i++) {
            const head = next();
            const type = TYPES[head >> 4];
            const family = head & 0x0f;
            let address;
            if (family === ADDR_V4) address = Array.from(take(4)).join('.');
            else if (family === ADDR_V6) address = ipv6Text(take(16));
            else if (family === ADDR_MDNS) {
                const digits = hex(take(16));
                address = `${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 20)}-${digits.slice(20)}.local`;
            } else if (family === ADDR_NAME) {
                address = text();
                if (!/^[A-Za-z0-9.-]+$/.test(address)) return null;
            } else return null;
            const port = (next() << 8) | next();
            if (!type || !port) return null;
            candidates.push({ address, port, type });
        }
        if (at !== bytes.length) return null;
        return {
            kind,
            id,
            roomTag: tag,
            type: kind,
            sdp: writeSdp({ ufrag, pwd, fingerprint, setup, candidates }, id + 1),
        };
    } catch {
        return null;
    }
}
