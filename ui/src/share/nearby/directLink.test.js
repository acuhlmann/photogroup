import { describe, it, expect } from 'vitest';
import { createLinkSession, CHUNK_BYTES, MAX_DIRECT_BYTES } from './directLink';
import { encodeNotes, roomTag } from './notes';
import { channelPair, until } from './testChannels';

const ROOM = 'z45keexwrxqzbeqimgsz';

function bytes(length, seed = 1) {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = (i * 31 + seed) & 0xff;
    return out;
}

// A phone: the photos its room lists, and the bytes it has for some of them.
function phone(channel, { name, room = ROOM, listed = [], files = {}, accept, notes } = {}) {
    const self = { files: { ...files }, listed: [...listed], got: [], states: [], events: [], heard: [] };
    self.session = createLinkSession({
        channel,
        room,
        me: { peerId: 'peer-' + name, name },
        wants: async () => self.listed.filter(id => !self.files[id]),
        findBytes: async id => self.files[id] || null,
        describe: id => ({ name: id + '.jpg', type: 'image/jpeg', sealed: false }),
        accept: accept || (async (details, blob) => {
            if (!self.listed.includes(details.id)) return 'unknown';
            self.files[details.id] = blob;
            self.got.push({ details, data: new Uint8Array(await blob.arrayBuffer()) });
            return 'delivered';
        }),
        notes,
        onNotes: frame => self.heard.push(frame),
        onState: state => self.states.push(state),
        onEvent: event => self.events.push(event),
    });
    self.last = () => self.states[self.states.length - 1];
    return self;
}

describe('direct link', () => {
    it('sends each phone the photos that it lacks', async () => {
        const [one, two] = channelPair();
        const first = bytes(CHUNK_BYTES * 3 + 123, 1);
        const second = bytes(10, 2);
        const anna = phone(one, { name: 'Anna', listed: ['a', 'b', 'c'], files: { a: new Blob([first]), c: new Blob([bytes(5)]) } });
        const ben = phone(two, { name: 'Ben', listed: ['a', 'b', 'c'], files: { b: new Blob([second]), c: new Blob([bytes(5)]) } });
        await until(() => anna.got.length === 1 && ben.got.length === 1 && anna.last().sent === 1 && ben.last().sent === 1);

        expect(ben.got[0].details).toEqual({ id: 'a', name: 'a.jpg', type: 'image/jpeg', sealed: false });
        expect(ben.got[0].data).toEqual(first);
        expect(anna.got[0].data).toEqual(second);
        expect(anna.last()).toMatchObject({ status: 'open', peer: { peerId: 'peer-Ben', name: 'Ben' }, sent: 1, received: 1, sending: null, receiving: null });
        expect(ben.last()).toMatchObject({ status: 'open', peer: { name: 'Anna' }, sent: 1, received: 1 });
        // "c" is on both phones: it did not move.
        expect(anna.events.map(event => `${event.what} ${event.id}`).sort()).toEqual(['received b', 'sent a']);
        // No message is larger than a browser takes.
        expect(Math.max(...one.sent.filter(data => typeof data !== 'string').map(data => data.byteLength))).toBe(CHUNK_BYTES);
    });

    it('closes when the other phone is in a different room', async () => {
        const [one, two] = channelPair();
        const anna = phone(one, { name: 'Anna', listed: ['a'], files: { a: new Blob([bytes(9)]) } });
        const ben = phone(two, { name: 'Ben', room: 'another-room', listed: ['a'] });
        await until(() => anna.last().status === 'otherRoom' && ben.last().status === 'otherRoom');
        expect(ben.got).toHaveLength(0);
    });

    it('sends a photo that came to this phone later', async () => {
        const [one, two] = channelPair();
        const anna = phone(one, { name: 'Anna', listed: ['a'] });
        const ben = phone(two, { name: 'Ben', listed: ['a'] });
        await until(() => anna.last().status === 'open' && anna.last().waiting === 1);
        anna.files.a = new Blob([bytes(100)]);
        anna.session.photoArrived();
        await until(() => ben.got.length === 1);
        expect(ben.got[0].data).toEqual(bytes(100));
    });

    it('asks again when the room lists a new photo', async () => {
        const [one, two] = channelPair();
        const anna = phone(one, { name: 'Anna', listed: ['a', 'n'], files: { a: new Blob([bytes(7)]), n: new Blob([bytes(8)]) } });
        const ben = phone(two, { name: 'Ben', listed: ['a'] });
        await until(() => ben.got.length === 1);
        ben.listed.push('n');
        await ben.session.refreshWants();
        await until(() => ben.got.length === 2);
        expect(ben.got.map(item => item.details.id)).toEqual(['a', 'n']);
    });

    it('does not ask again for a photo that was not taken', async () => {
        const [one, two] = channelPair();
        let offers = 0;
        const anna = phone(one, { name: 'Anna', listed: ['a'], files: { a: new Blob([bytes(7)]) } });
        const ben = phone(two, { name: 'Ben', listed: ['a'], accept: async () => { offers++; return 'rejected'; } });
        await until(() => ben.last().rejected === 1);
        await ben.session.refreshWants();
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(offers).toBe(1);
        expect(anna.last().sent).toBe(1);
        expect(ben.last().received).toBe(0);
    });

    it('does not send a file that is too large to hold in memory', async () => {
        const [one, two] = channelPair();
        const anna = phone(one, { name: 'Anna', listed: ['big', 'a'], files: { big: { size: MAX_DIRECT_BYTES + 1 }, a: new Blob([bytes(7)]) } });
        const ben = phone(two, { name: 'Ben', listed: ['big', 'a'] });
        await until(() => ben.got.length === 1 && anna.last().tooLarge === 1);
        expect(ben.got[0].details.id).toBe('a');
    });

    it('takes no file that is larger than it said', async () => {
        const [one, two] = channelPair();
        const ben = phone(two, { name: 'Ben', listed: ['a'] });
        one.send(JSON.stringify({ t: 'hello', v: 1, room: roomTag(ROOM), peerId: 'x', name: 'X' }));
        one.send(JSON.stringify({ t: 'file', id: 'a', name: 'a.jpg', type: 'image/jpeg', size: 4 }));
        one.send(bytes(3));
        one.send(bytes(3));
        one.send(JSON.stringify({ t: 'end', id: 'a' }));
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(ben.got).toHaveLength(0);
        expect(ben.last().receiving).toBeNull();
    });

    it('passes notes both ways, at the start and later', async () => {
        const [one, two] = channelPair();
        const frames = name => encodeNotes({ room: ROOM, from: 7, notes: [{ type: 'name', name }] }, 1024);
        const anna = phone(one, { name: 'Anna', notes: () => frames('Anna') });
        const ben = phone(two, { name: 'Ben', notes: () => frames('Ben') });
        await until(() => anna.heard.length === 1 && ben.heard.length === 1);
        expect(ben.heard[0]).toEqual(frames('Anna')[0]);
        anna.session.sendNotes(frames('Anna B'));
        await until(() => ben.heard.length === 2);
        expect(ben.heard[1]).toEqual(frames('Anna B')[0]);
    });

    it('is closed on both phones when one closes it', async () => {
        const [one, two] = channelPair();
        const anna = phone(one, { name: 'Anna' });
        const ben = phone(two, { name: 'Ben' });
        await until(() => anna.last().status === 'open' && ben.last().status === 'open');
        anna.session.close();
        await until(() => anna.last().status === 'closed' && ben.last().status === 'closed');
    });
});
