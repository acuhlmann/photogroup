import { describe, it, expect, beforeEach, vi } from 'vitest';
import { notePairing, pairings, clearPairings, noteArrival } from './pairingLog';
import { tagUrl, canWriteNfc, writeLinkToTag } from './nfcTag';
import { describeEvent } from '../geek/packetLog';

describe('pairingLog', () => {
    beforeEach(() => clearPairings());

    it('keeps each pairing and tells the room', () => {
        const emitter = { emit: vi.fn() };
        const entry = notePairing(emitter, { channel: 'sound', direction: 'out', bytes: 24, ms: 2090, detail: 'audible' });
        expect(pairings()).toEqual([entry]);
        expect(emitter.emit).toHaveBeenCalledWith('pairing', entry);
    });

    it('notes a link from an NFC tag and cleans the address', () => {
        const win = {
            location: { search: '?room=abc123&via=nfc', pathname: '/', hash: '#k=x' },
            history: { replaceState: vi.fn() },
        };
        noteArrival(null, win);
        expect(win.history.replaceState).toHaveBeenCalledWith({}, '', '/?room=abc123#k=x');
        expect(pairings()[0]).toMatchObject({ channel: 'nfc', direction: 'in' });
    });

    it('leaves other links alone', () => {
        const win = { location: { search: '?room=abc123', pathname: '/', hash: '' }, history: { replaceState: vi.fn() } };
        noteArrival(null, win);
        expect(win.history.replaceState).not.toHaveBeenCalled();
        expect(pairings()).toEqual([]);
    });

    it('writes log lines for geek mode', () => {
        expect(describeEvent('pairing', [{ channel: 'sound', direction: 'out', bytes: 24, ms: 2090, detail: 'audible' }]))
            .toEqual({ kind: 'pair', text: 'room code → sound · 24 B in 2.1 s · audible' });
        expect(describeEvent('pairing', [{ channel: 'sound', direction: 'in', bytes: 24, ms: 3400 }]).text)
            .toBe('room code ← sound · 24 B · after 3.4 s');
        expect(describeEvent('pairing', [{ channel: 'qr', direction: 'in', bytes: 60 }]).text).toBe('room link ← QR code · 60 B');
        expect(describeEvent('pairing', [{ channel: 'nfc', direction: 'in' }]).text).toBe('room link ← NFC tag');
    });
});

describe('nfcTag', () => {
    it('marks the tag link and keeps a private room key', () => {
        expect(tagUrl('https://photogroup.network/?room=abc123#k=key')).toBe('https://photogroup.network/?room=abc123&via=nfc#k=key');
    });

    it('is offered only where the browser can write tags', () => {
        expect(canWriteNfc({})).toBe(false);
        expect(canWriteNfc({ NDEFReader: function NDEFReader() {} })).toBe(true);
    });

    it('writes one URL record', async () => {
        const write = vi.fn().mockResolvedValue();
        const win = { NDEFReader: function NDEFReader() { this.write = write; } };
        const bytes = await writeLinkToTag('https://photogroup.network/?room=abc123', { win });
        expect(write.mock.calls[0][0]).toEqual({ records: [{ recordType: 'url', data: 'https://photogroup.network/?room=abc123&via=nfc' }] });
        expect(bytes).toBe(47);
    });
});
