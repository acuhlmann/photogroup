import { describe, it, expect, beforeEach } from 'vitest';
import EventEmitter from 'eventemitter3';
import NearbyLinks, { LINK_PROBLEMS } from './nearbyLinks';
import NearbyNotes from './nearbyNotes';
import RoomPhotos from '../torrent/RoomPhotos';
import { writeSdp, decodeLinkCode } from './linkCode';
import { clearPairings, pairings } from './pairingLog';
import { channelPair, until } from './testChannels';

const ROOM = 'z45keexwrxqzbeqimgsz';

// WebRTC as two phones on one table: each description names its maker, and
// a connection opens when an offer and its answer have met.
function table() {
    const made = new Map();
    let count = 0;
    const sdpFor = (setup) => {
        const key = 'k' + String(++count).padStart(3, '0');
        const sdp = writeSdp({
            ufrag: key, pwd: 'p'.repeat(22), fingerprint: new Uint8Array(32).fill(count), setup,
            candidates: [{ address: '192.168.43.' + count, port: 5000 + count, type: 'host' }],
        });
        return { key, sdp };
    };
    const keyOf = sdp => /a=ice-ufrag:(\w+)/.exec(sdp)[1];
    const side = () => {
        const listeners = new Set();
        return {
            pc: {
                connectionState: 'new', closed: false,
                addEventListener: (type, listener) => listeners.add(listener),
                removeEventListener: (type, listener) => listeners.delete(listener),
                close() { this.closed = true; },
            },
            // What the app holds before the link is open; it passes all on to the real end.
            channel: {
                ready: null,
                get readyState() { return this.ready ? this.ready.readyState : 'connecting'; },
                get bufferedAmount() { return 0; },
                addEventListener(...args) { this.ready.addEventListener(...args); },
                removeEventListener(...args) { this.ready.removeEventListener(...args); },
                send(data) { this.ready.send(data); },
                close() { this.ready?.close(); },
            },
            waiters: [],
            open(channel) {
                this.channel.ready = channel;
                this.waiters.forEach(resolve => resolve());
            },
        };
    };
    return {
        made,
        failNext: false,
        connect() {
            const self = this;
            return {
                async makeOffer() {
                    const { key, sdp } = sdpFor('actpass');
                    const mine = side();
                    made.set(key, mine);
                    return { pc: mine.pc, channel: mine.channel, sdp };
                },
                async makeAnswer(offerSdp) {
                    const { key, sdp } = sdpFor('active');
                    const mine = side();
                    mine.offerKey = keyOf(offerSdp);
                    made.set(key, mine);
                    return { pc: mine.pc, channel: mine.channel, sdp };
                },
                async takeAnswer(pc, answerSdp) {
                    const answer = made.get(keyOf(answerSdp));
                    const offer = made.get(answer.offerKey);
                    if (offer.pc !== pc) throw new Error('not the answer to this offer');
                    if (self.failNext) {
                        self.failNext = false;
                        offer.failed = true;
                        return;
                    }
                    const [one, two] = channelPair();
                    offer.open(one);
                    answer.open(two);
                },
                opened(pc, channel) {
                    const mine = [...made.values()].find(each => each.pc === pc);
                    if (mine.failed) return Promise.reject(new Error('The phones did not reach each other.'));
                    if (channel.ready) return Promise.resolve();
                    return new Promise((resolve) => { mine.waiters.push(resolve); });
                },
                pathOf: async () => 'host ⇄ host udp',
            };
        },
    };
}

function phone(webrtc, name, { room = ROOM, files = {} } = {}) {
    const emitter = new EventEmitter();
    const peerId = '2d5757303330302d0000000000000000' + name.padEnd(8, '0').slice(0, 8).replace(/[^0-9a-f]/g, 'a');
    const master = {
        emitter,
        client: { peerId },
        device: name,
        peers: { items: [] },
        roomPhotos: new RoomPhotos(emitter),
        service: { id: room, hasRoom: true },
        files: { ...files },
        got: [],
        hasPhotoBytes: async id => !!master.files[id],
        findPhotoBytes: async id => master.files[id] || null,
        missingPhotoIds: async () => master.roomPhotos.all().map(photo => photo.infoHash).filter(id => !master.files[id]),
        acceptNearbyPhoto: async (details, blob, options) => {
            master.files[details.id] = blob;
            master.got.push({ id: details.id, via: options.via });
            return 'delivered';
        },
    };
    emitter.emit('photos', { type: 'all', item: [{ infoHash: 'photo-1', fileName: 'one.jpg', fileType: 'image/jpeg', owners: [] }] });
    master.nearbyNotes = new NearbyNotes(master, { storage: null });
    const connect = webrtc.connect();
    const links = new NearbyLinks(master, { connect });
    return { master, links, emitter };
}

describe('nearby links', () => {
    beforeEach(() => clearPairings());

    it('links two phones with an offer code and an answer code, then moves the photo', async () => {
        const webrtc = table();
        const anna = phone(webrtc, 'a11a', { files: { 'photo-1': new Blob(['the photo']) } });
        const ben = phone(webrtc, 'b22b');
        await anna.links.begin();
        await ben.links.begin();
        const offer = anna.links.snapshot().handshake;
        expect(offer.step).toBe('offer');
        expect(decodeLinkCode(offer.code).kind).toBe('offer');

        // A phone that sees its own code does nothing.
        await anna.links.read(offer.code);
        expect(anna.links.snapshot().handshake.step).toBe('offer');
        // Bytes that are no link code are not for this reader.
        expect(await anna.links.read(new TextEncoder().encode('https://example.org'))).toBe(false);

        // Ben reads Anna's offer and shows an answer. The camera reads it many times.
        expect(await ben.links.read(offer.code)).toBe(true);
        await ben.links.read(offer.code);
        const answer = ben.links.snapshot().handshake;
        expect(answer.step).toBe('answer');
        expect(decodeLinkCode(answer.code)).toMatchObject({ kind: 'answer', id: decodeLinkCode(offer.code).id });

        await anna.links.read(answer.code);
        await until(() => anna.links.snapshot().links[0]?.status === 'open' && ben.links.snapshot().links[0]?.status === 'open');
        await until(() => ben.master.got.length === 1);
        expect(ben.master.got).toEqual([{ id: 'photo-1', via: 'direct' }]);
        expect(anna.links.snapshot().links[0]).toMatchObject({ peer: { name: 'b22b' }, sent: 1, path: 'host ⇄ host udp' });
        expect(anna.links.snapshot().handshake).toMatchObject({ step: 'linked' });
        // The connections that were not used are closed.
        expect([...webrtc.made.values()].filter(each => each.pc.closed)).toHaveLength(1);
        const log = pairings().map(entry => `${entry.channel} ${entry.direction} ${entry.what}`);
        expect(log).toEqual(expect.arrayContaining(['qr out link offer', 'qr in link offer', 'qr out link answer', 'qr in link answer', 'direct out photo', 'direct in photo']));
    });

    it('works when both phones read the other offer first', async () => {
        const webrtc = table();
        const anna = phone(webrtc, 'a11a');
        const ben = phone(webrtc, 'b22b');
        await anna.links.begin();
        await ben.links.begin();
        const annaOffer = anna.links.snapshot().handshake.code;
        const benOffer = ben.links.snapshot().handshake.code;
        await ben.links.read(annaOffer);
        await anna.links.read(benOffer);
        expect(anna.links.snapshot().handshake.step).toBe('answer');
        // Anna still takes the answer to her first code.
        await anna.links.read(ben.links.snapshot().handshake.code);
        await until(() => anna.links.open().length === 1 && ben.links.open().length === 1);
        await until(() => anna.links.snapshot().links[0].status === 'open');
    });

    it('says so when the other phone is in a different room', async () => {
        const webrtc = table();
        const anna = phone(webrtc, 'a11a');
        const ben = phone(webrtc, 'b22b', { room: 'another-room-id' });
        await anna.links.begin();
        await ben.links.begin();
        await ben.links.read(anna.links.snapshot().handshake.code);
        expect(ben.links.snapshot().handshake).toMatchObject({ step: 'offer', problem: LINK_PROBLEMS.otherRoom });
    });

    it('makes a new code when the phones did not reach each other', async () => {
        const webrtc = table();
        const anna = phone(webrtc, 'a11a');
        const ben = phone(webrtc, 'b22b');
        await anna.links.begin();
        await ben.links.begin();
        const first = anna.links.snapshot().handshake.code;
        await ben.links.read(first);
        webrtc.failNext = true;
        await anna.links.read(ben.links.snapshot().handshake.code);
        const after = anna.links.snapshot().handshake;
        expect(after).toMatchObject({ step: 'offer', problem: LINK_PROBLEMS.failed });
        expect(decodeLinkCode(after.code).id).not.toBe(decodeLinkCode(first).id);

        // The second try works.
        await ben.links.read(after.code);
        await anna.links.read(ben.links.snapshot().handshake.code);
        await until(() => anna.links.snapshot().links[0]?.status === 'open');
    });

    it('closes a link and stops an exchange', async () => {
        const webrtc = table();
        const anna = phone(webrtc, 'a11a');
        const ben = phone(webrtc, 'b22b');
        await anna.links.begin();
        await ben.links.begin();
        await ben.links.read(anna.links.snapshot().handshake.code);
        await anna.links.read(ben.links.snapshot().handshake.code);
        await until(() => anna.links.snapshot().links[0]?.status === 'open' && ben.links.snapshot().links[0]?.status === 'open');
        anna.links.close();
        expect(anna.links.snapshot().links).toEqual([]);
        await until(() => ben.links.snapshot().links[0].status === 'closed');

        await ben.links.begin();
        ben.links.cancel();
        expect(ben.links.snapshot().handshake).toBeNull();
    });
});
