import Logger from 'js-logger';

// Room codes as sound, from one phone's speaker to the microphones near it.
// ggwave does the signal work: FSK tones with Reed-Solomon error correction,
// in the hearing range or just above it. It carries 8 to 16 bytes per second.

export const SAMPLES_PER_FRAME = 1024;
// ggwave's own sample rate. The page asks the browser for this rate.
const RATE = 48000;
const RESAMPLE_FRAME = 4096;
// Silence between two rounds of the same code.
const GAP_SECONDS = 1.2;
const VOLUME = 50;

let loading = null;

/** The ggwave module; its code loads on first use. */
export function loadModem() {
    if (!loading) {
        loading = import('ggwave')
            .then(module => (module.default || module)({ print() {}, printErr() {} }))
            .catch((err) => {
                loading = null;
                throw err;
            });
    }
    return loading;
}

/** The tones for a text, as samples between -1 and 1. */
export function encodeTones(ggwave, text, { sampleRate = RATE, quiet = false } = {}) {
    const parameters = ggwave.getDefaultParameters();
    parameters.sampleRateOut = sampleRate;
    const instance = ggwave.init(parameters);
    try {
        const protocol = quiet
            ? ggwave.ProtocolId.GGWAVE_PROTOCOL_ULTRASOUND_FAST
            : ggwave.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST;
        // The result is a view of memory that the next call overwrites.
        const view = ggwave.encode(instance, text, protocol, VOLUME);
        return new Float32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    } finally {
        ggwave.free(instance);
    }
}

/** Feed it microphone samples; it gives back each text it hears. */
export function createDecoder(ggwave, sampleRate = RATE) {
    const parameters = ggwave.getDefaultParameters();
    parameters.sampleRateInp = sampleRate;
    const instance = ggwave.init(parameters);
    const decoder = new TextDecoder();
    const decode = (samples) => {
        const bytes = new Int8Array(samples.buffer, samples.byteOffset, samples.byteLength);
        const heard = ggwave.decode(instance, bytes);
        return heard && heard.length ? decoder.decode(heard) : null;
    };
    // At another rate ggwave resamples, and that loses the signal when the
    // frames are small. Collect larger frames first.
    const block = sampleRate === RATE ? 0 : RESAMPLE_FRAME;
    const held = new Float32Array(block);
    let filled = 0;
    return {
        /** @param {Float32Array} samples @returns {string|null} */
        feed(samples) {
            if (!block) return decode(samples);
            let text = null;
            let at = 0;
            while (at < samples.length) {
                const take = Math.min(block - filled, samples.length - at);
                held.set(samples.subarray(at, at + take), filled);
                filled += take;
                at += take;
                if (filled === block) {
                    text = decode(held) || text;
                    filled = 0;
                }
            }
            return text;
        },
        free() {
            ggwave.free(instance);
        },
    };
}

/** An audio context at ggwave's own rate where the browser allows it. */
function audioContext() {
    const Context = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!Context) return null;
    try {
        return new Context({ sampleRate: RATE });
    } catch {
        return new Context();
    }
}

/** Can this browser play a code? */
export function canPlaySound() {
    return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
}

/** Can this browser listen for a code? */
export function canListen() {
    return canPlaySound() && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Play a text again and again until `stop()`. Call it from a tap: phones
 * let a page make sound only then. With a list of texts, they play one
 * after the other, then the list starts again. The text can be a promise:
 * the sound is unlocked at once, in the tap, and plays when the text is here.
 * @param {string|string[]|Promise<string|string[]>} text
 * @returns {Promise<{seconds: number, stop: () => void}>} `seconds` is one round.
 */
export async function playText(text, { quiet = false } = {}) {
    const context = audioContext();
    if (!context) throw new Error('This browser cannot play sound from a page.');
    // Before the first await, while the tap still counts.
    const resumed = context.resume?.();
    try {
        const ggwave = await loadModem();
        await resumed;
        const rounds = [].concat(await text).map(each => encodeTones(ggwave, each, { sampleRate: context.sampleRate, quiet }));
        const gap = Math.round(GAP_SECONDS * context.sampleRate);
        const length = rounds.reduce((sum, tones) => sum + tones.length + gap, 0);
        const buffer = context.createBuffer(1, length, context.sampleRate);
        let at = 0;
        rounds.forEach((tones) => {
            buffer.getChannelData(0).set(tones, at);
            at += tones.length + gap;
        });
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(context.destination);
        source.start();
        return {
            seconds: (length - gap) / context.sampleRate,
            stop() {
                try { source.stop(); } catch { /* already stopped */ }
                context.close().catch(() => {});
            },
        };
    } catch (err) {
        context.close().catch(() => {});
        throw err;
    }
}

/**
 * Listen on the microphone until `stop()`.
 * @param {object} handlers
 * @param {(text: string) => void} handlers.onText each text heard
 * @param {(level: number) => void} [handlers.onLevel] loudness 0..1, a few times a second
 * @param {AbortSignal} [handlers.signal] aborts a start that is still under way, and frees the microphone
 * @returns {Promise<{stop: () => void}>}
 */
export async function listenForText({ onText, onLevel, signal }) {
    const context = audioContext();
    if (!context || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser cannot use the microphone from a page.');
    }
    const resumed = context.resume?.();
    let stream = null;
    let decoder = null;
    try {
        // The phone's voice filters remove the tones; ask for raw sound.
        stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            video: false,
        });
        // Closed while the permission question was open: free the microphone
        // now, not when the modem has loaded.
        const release = () => stream.getTracks().forEach(track => track.stop());
        if (signal?.aborted) throw new Error('listening was cancelled');
        signal?.addEventListener('abort', release, { once: true });
        const ggwave = await loadModem();
        await resumed;
        signal?.removeEventListener('abort', release);
        if (signal?.aborted) throw new Error('listening was cancelled');
        decoder = createDecoder(ggwave, context.sampleRate);
    } catch (err) {
        stream?.getTracks().forEach(track => track.stop());
        context.close().catch(() => {});
        throw err;
    }

    const source = context.createMediaStreamSource(stream);
    // Old, but the one audio tap that every phone browser has.
    const tap = context.createScriptProcessor(SAMPLES_PER_FRAME, 1, 1);
    const mute = context.createGain();
    mute.gain.value = 0;
    let frames = 0;
    tap.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0);
        if (onLevel && ++frames % 6 === 0) {
            let sum = 0;
            for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
            onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 6));
        }
        try {
            const text = decoder.feed(samples);
            if (text) onText(text);
        } catch (err) {
            Logger.warn('Sound decode failed: ' + (err?.message || err));
        }
    };
    source.connect(tap);
    // A tap runs only when it leads to the output; the gain keeps it silent.
    tap.connect(mute);
    mute.connect(context.destination);

    let stopped = false;
    return {
        stop() {
            if (stopped) return;
            stopped = true;
            tap.onaudioprocess = null;
            source.disconnect();
            tap.disconnect();
            mute.disconnect();
            stream.getTracks().forEach(track => track.stop());
            decoder.free();
            context.close().catch(() => {});
        },
    };
}
