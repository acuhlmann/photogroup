// For tests: two ends of a data channel, with no WebRTC between them.

function end() {
    const listeners = new Map();
    return {
        readyState: 'open',
        bufferedAmount: 0,
        binaryType: 'blob',
        other: null,
        sent: [],
        inbox: [],
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) {
            listeners.get(type)?.delete(listener);
        },
        emit(type, event = {}) {
            [...(listeners.get(type) || [])].forEach(listener => listener(event));
        },
        send(data) {
            if (this.readyState !== 'open') throw new Error('closed');
            this.sent.push(data);
            const copy = typeof data === 'string' ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            const other = this.other;
            // As a browser does it: in order, each message in a task of its
            // own, after the code that opened the channel has run.
            other.inbox.push(copy);
            setTimeout(() => {
                const next = other.inbox.shift();
                if (other.readyState === 'open') other.emit('message', { data: next });
            }, 0);
        },
        close() {
            if (this.readyState !== 'open') return;
            this.readyState = 'closed';
            const other = this.other;
            Promise.resolve().then(() => this.emit('close'));
            // The other end gets what was sent before the close.
            setTimeout(() => {
                if (other.readyState === 'open') {
                    other.readyState = 'closed';
                    other.emit('close');
                }
            }, 0);
        },
    };
}

/** @returns {[object, object]} what one end sends, the other end gets */
export function channelPair() {
    const a = end();
    const b = end();
    a.other = b;
    b.other = a;
    return [a, b];
}

/** Wait until `check()` is true. */
export async function until(check, ms = 2000) {
    const start = Date.now();
    while (!check()) {
        if (Date.now() - start > ms) throw new Error('timed out');
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}
