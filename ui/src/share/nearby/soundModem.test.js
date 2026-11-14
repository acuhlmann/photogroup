import { describe, it, expect, beforeAll } from 'vitest';
import { loadModem, encodeTones, createDecoder, SAMPLES_PER_FRAME } from './soundModem';
import { roomCodeText, parseRoomCode } from './roomCode';

// The real signal path, without a speaker and a microphone between.
function hear(ggwave, samples, sampleRate) {
    const decoder = createDecoder(ggwave, sampleRate);
    let heard = null;
    for (let at = 0; at < samples.length; at += SAMPLES_PER_FRAME) {
        const frame = samples.slice(at, at + SAMPLES_PER_FRAME);
        if (frame.length < SAMPLES_PER_FRAME) break;
        heard = decoder.feed(frame) || heard;
    }
    decoder.free();
    return heard;
}

function withRoomNoise(tones, sampleRate, amount) {
    const lead = Math.round(sampleRate * 0.537);
    const out = new Float32Array(tones.length + 2 * lead);
    out.set(tones, lead);
    let seed = 7;
    for (let i = 0; i < out.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        out[i] += (seed / 0x7fffffff - 0.5) * 2 * amount;
    }
    return out;
}

describe('soundModem', () => {
    let ggwave;
    beforeAll(async () => { ggwave = await loadModem(); });

    const plain = roomCodeText({ room: 'z45keexwrxqzbeqimgsz' });
    const withKey = roomCodeText({ room: 'z45keexwrxqzbeqimgsz', key: 'k'.repeat(43) });

    it.each([
        ['audible', false, 48000],
        ['audible at 44.1 kHz', false, 44100],
        ['ultrasound', true, 48000],
        ['ultrasound at 44.1 kHz', true, 44100],
    ])('sends a room code as %s tones and hears it', (name, quiet, sampleRate) => {
        const tones = encodeTones(ggwave, plain, { sampleRate, quiet });
        // About two seconds: short enough to hold two phones together.
        expect(tones.length / sampleRate).toBeLessThan(3);
        expect(parseRoomCode(hear(ggwave, withRoomNoise(tones, sampleRate, 0), sampleRate)))
            .toEqual({ room: 'z45keexwrxqzbeqimgsz', key: null });
    });

    it('hears a private room code through noise', () => {
        const tones = encodeTones(ggwave, withKey, { sampleRate: 48000 });
        expect(tones.length / 48000).toBeLessThan(6);
        expect(hear(ggwave, withRoomNoise(tones, 48000, 0.05), 48000)).toBe(withKey);
    });

    it('hears nothing in noise alone', () => {
        expect(hear(ggwave, withRoomNoise(new Float32Array(48000), 48000, 0.2), 48000)).toBeNull();
    });
});
