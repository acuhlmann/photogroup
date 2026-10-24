// One still frame of a video, grabbed by the browser itself: a hidden <video>
// element seeks a fraction of a second into the clip and the frame is painted
// into a small canvas. No server work and no transcoding, and never the whole
// clip in memory: the element only reads what it needs to show that frame.

const TIMEOUT_MS = 8000;

/**
 * Paint a frame of the video at `src` into a canvas no larger than `maxSide`
 * on either side. Resolves to the canvas, or null when the browser can't
 * decode the clip (or takes longer than `timeoutMs`).
 */
export function captureFrame(src, { maxSide = 160, timeoutMs = TIMEOUT_MS } = {}) {
    if (!src || typeof document === 'undefined') return Promise.resolve(null);
    return new Promise(resolve => {
        const video = document.createElement('video');
        let settled = false;
        const done = value => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            video.removeAttribute('src');
            video.load();
            resolve(value);
        };
        const timer = setTimeout(() => done(null), timeoutMs);
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.addEventListener('error', () => done(null));
        video.addEventListener('loadeddata', () => {
            // A frame is only decodable once the element has seeked into the clip.
            if (video.readyState < 2 || !Number.isFinite(video.duration)) return done(null);
            video.addEventListener('seeked', paint, { once: true });
            try {
                video.currentTime = Math.min(0.1, (video.duration || 1) / 4);
            } catch {
                done(null);
            }
        });
        function paint() {
            if (!video.videoWidth || !video.videoHeight) return done(null);
            const scale = Math.min(maxSide / video.videoWidth, maxSide / video.videoHeight, 1);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            const ctx = canvas.getContext('2d');
            if (!ctx) return done(null);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            done(canvas);
        }
        video.src = src;
    });
}

/** A JPEG poster for a local video file, or null when no frame could be had. */
export async function posterFromFile(file, { maxSide = 320, quality = 0.75, timeoutMs = 4000 } = {}) {
    if (!(file instanceof Blob)) return null;
    const url = URL.createObjectURL(file);
    try {
        const canvas = await captureFrame(url, { maxSide, timeoutMs });
        if (!canvas) return null;
        return await new Promise(resolve => {
            try {
                canvas.toBlob(blob => resolve(blob || null), 'image/jpeg', quality);
            } catch {
                // A tainted canvas simply leaves no poster.
                resolve(null);
            }
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

export default { captureFrame, posterFromFile };
