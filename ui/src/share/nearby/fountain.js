// A fountain code (Luby transform) for one-way channels: screen to camera.
// The sender shows frames without end, and the receiver needs about as many
// good frames as the file has blocks, whichever ones it catches. Frame
// numbers below the block count carry one block each, in order; all later
// frames carry the XOR of some blocks, chosen by the frame number alone.

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const distributions = new Map();

/** Robust soliton distribution over 1..k, as a running sum. */
function degreeSums(k) {
    if (distributions.has(k)) return distributions.get(k);
    // Tuned by trial: a small file needs more low mixes to start well.
    const c = k < 1000 ? 0.1 : 0.05;
    const delta = 0.5;
    const spike = Math.max(1, Math.min(k, Math.floor(k / (c * Math.log(k / delta) * Math.sqrt(k)) || 1)));
    const weights = new Float64Array(k + 1);
    for (let d = 1; d <= k; d++) {
        const ideal = d === 1 ? 1 / k : 1 / (d * (d - 1));
        let extra = 0;
        if (d < spike) extra = 1 / (d * spike);
        else if (d === spike) extra = Math.log(spike / delta) / spike;
        weights[d] = ideal + extra;
    }
    let total = 0;
    for (let d = 1; d <= k; d++) total += weights[d];
    const sums = new Float64Array(k + 1);
    let run = 0;
    for (let d = 1; d <= k; d++) {
        run += weights[d] / total;
        sums[d] = run;
    }
    distributions.set(k, sums);
    return sums;
}

/** The blocks that frame `seed` carries, for a file of `k` blocks. */
export function blocksOfFrame(seed, k) {
    if (seed < k) return [seed];
    const random = mulberry32(seed);
    const sums = degreeSums(k);
    const pick = random();
    let lo = 1;
    let hi = k;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sums[mid] >= pick) hi = mid;
        else lo = mid + 1;
    }
    const chosen = new Set();
    while (chosen.size < lo) chosen.add(Math.floor(random() * k));
    return [...chosen];
}

/**
 * About how many mixed frames a receiver needs for `k` blocks. Measured
 * with this decoder: small files pay more.
 */
export function framesNeeded(k) {
    if (k < 64) return k;
    return Math.ceil(k * (k < 1000 ? 1.3 : 1.14));
}

function xorInto(target, source) {
    for (let i = 0; i < source.length; i++) target[i] ^= source[i];
}

/** `frame(seed)` gives the bytes of any frame of `data`. */
export function createEncoder(data, blockSize) {
    const k = Math.max(1, Math.ceil(data.length / blockSize));
    const block = (index) => {
        const out = new Uint8Array(blockSize);
        out.set(data.subarray(index * blockSize, (index + 1) * blockSize));
        return out;
    };
    return {
        k,
        frame(seed) {
            const indices = blocksOfFrame(seed, k);
            const out = block(indices[0]);
            for (let i = 1; i < indices.length; i++) xorInto(out, block(indices[i]));
            return out;
        },
    };
}

/** Collects frames in any order until all `k` blocks are known. */
export function createDecoder(k, blockSize, totalLength) {
    const known = new Array(k).fill(null);
    // Frames that still mix two or more unknown blocks, by block.
    const waiting = new Map();
    const seen = new Set();
    let have = 0;

    const settle = (index, data) => {
        const queue = [[index, data]];
        while (queue.length) {
            const [at, bytes] = queue.pop();
            if (known[at]) continue;
            known[at] = bytes;
            have++;
            const held = waiting.get(at);
            if (!held) continue;
            waiting.delete(at);
            held.forEach((frame) => {
                if (!frame.left.has(at)) return;
                xorInto(frame.data, bytes);
                frame.left.delete(at);
                if (frame.left.size === 1) {
                    const [last] = frame.left;
                    waiting.get(last)?.delete(frame);
                    queue.push([last, frame.data]);
                }
            });
        }
    };

    return {
        k,
        get have() { return have; },
        get done() { return have === k; },
        /** Frames taken so far (repeats not counted). */
        get frames() { return seen.size; },
        /** @returns {boolean} false for a frame this decoder had already */
        add(seed, payload) {
            if (seen.has(seed) || have === k) return false;
            seen.add(seed);
            const data = Uint8Array.from(payload);
            const left = new Set();
            blocksOfFrame(seed, k).forEach((index) => {
                if (known[index]) xorInto(data, known[index]);
                else left.add(index);
            });
            if (left.size === 1) {
                settle([...left][0], data);
            } else if (left.size > 1) {
                const frame = { left, data };
                left.forEach((index) => {
                    if (!waiting.has(index)) waiting.set(index, new Set());
                    waiting.get(index).add(frame);
                });
            }
            return true;
        },
        /** The file, once `done`. */
        result() {
            if (have !== k) return null;
            const out = new Uint8Array(k * blockSize);
            known.forEach((bytes, index) => out.set(bytes, index * blockSize));
            return out.subarray(0, totalLength);
        },
    };
}
