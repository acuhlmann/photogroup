// What two phones say to each other on a direct link (a WebRTC data
// channel that a QR code set up, see linkCode.js). No server is in it.
//
// Each phone says who it is, then which room photos it does not have.
// The other phone sends those that it has, one file after the other. Small
// notes (names, star ratings) go the same way. Text messages are JSON; the
// bytes of a file go as binary messages between "file" and "end".

import { roomTag, notesText, parseNotesText } from './notes';

export const LINK_VERSION = 1;
// One binary message. All browsers take this size.
export const CHUNK_BYTES = 16 * 1024;
// A received file is held in memory until it is whole.
export const MAX_DIRECT_BYTES = 256 * 1024 * 1024;
const READ_BYTES = 1024 * 1024;
const BUFFER_HIGH = 1024 * 1024;
const BUFFER_LOW = 256 * 1024;
const PROGRESS_MS = 200;

/**
 * One end of a direct link.
 * @param {object} options
 * @param {object} options.channel an open RTCDataChannel (or the same shape)
 * @param {string} options.room this phone's room id
 * @param {{peerId: string, name: string}} options.me
 * @param {() => Promise<string[]>} options.wants ids of the room photos that are not here in full
 * @param {(id: string) => Promise<Blob|null>} options.findBytes a photo's bytes, or null when it is not here
 * @param {(id: string) => {name?: string, type?: string, sealed?: boolean}|null} options.describe
 * @param {(details: object, blob: Blob) => Promise<string>} options.accept puts a received photo in the room
 * @param {() => Uint8Array[]} [options.notes] the note frames to send now
 * @param {(frame: Uint8Array) => void} [options.onNotes] a note frame came
 * @param {(state: object) => void} [options.onState]
 * @param {(event: object) => void} [options.onEvent] `{ what: 'sent'|'received', id, name, bytes, ms, how }`
 */
export function createLinkSession({ channel, room, me, wants, findBytes, describe, accept, notes, onNotes, onState, onEvent, now = () => Date.now() }) {
    const state = {
        status: 'starting', // starting, open, otherRoom, closed
        peer: null,
        sent: 0,
        received: 0,
        tooLarge: 0,
        rejected: 0,
        waiting: 0,
        sending: null,
        receiving: null,
    };
    let peerWants = [];
    let wantsRound = 0;
    const sentIds = new Set();
    // Too large for a link.
    const skipped = new Set();
    // Received in full and not in the room yet, or not taken: not asked for again.
    const settled = new Set();
    let pumping = false;
    let incoming = null; // { id, name, type, sealed, size, parts, loaded, startedAt }
    let closed = false;
    let reported = 0;

    const report = (force = true) => {
        const at = now();
        if (!force && at - reported < PROGRESS_MS) return;
        reported = at;
        onState?.({ ...state, peer: state.peer && { ...state.peer }, sending: state.sending && { ...state.sending }, receiving: state.receiving && { ...state.receiving } });
    };

    const say = (message) => {
        if (closed || channel.readyState !== 'open') return false;
        try {
            channel.send(JSON.stringify(message));
            return true;
        } catch {
            return false;
        }
    };

    const drained = () => new Promise((resolve) => {
        if (closed || channel.bufferedAmount <= BUFFER_HIGH) {
            resolve();
            return;
        }
        const done = () => {
            channel.removeEventListener('bufferedamountlow', done);
            channel.removeEventListener('close', done);
            resolve();
        };
        channel.addEventListener('bufferedamountlow', done);
        channel.addEventListener('close', done);
    });

    const sendFile = async (id, blob) => {
        const details = describe(id) || {};
        const startedAt = now();
        state.sending = { id, name: details.name || '', loaded: 0, total: blob.size };
        report();
        if (!say({ t: 'file', id, name: details.name || '', type: details.type || blob.type || '', sealed: !!details.sealed, size: blob.size })) return false;
        for (let at = 0; at < blob.size; at += READ_BYTES) {
            const part = new Uint8Array(await blob.slice(at, Math.min(at + READ_BYTES, blob.size)).arrayBuffer());
            for (let offset = 0; offset < part.length; offset += CHUNK_BYTES) {
                if (closed || channel.readyState !== 'open') return false;
                await drained();
                if (closed || channel.readyState !== 'open') return false;
                // A copy: some browsers keep the buffer that was sent.
                channel.send(part.slice(offset, offset + CHUNK_BYTES));
                state.sending.loaded = at + Math.min(offset + CHUNK_BYTES, part.length);
                report(false);
            }
        }
        if (!say({ t: 'end', id })) return false;
        sentIds.add(id);
        state.sent++;
        state.sending = null;
        onEvent?.({ what: 'sent', id, name: details.name || '', bytes: blob.size, ms: now() - startedAt });
        return true;
    };

    // Send the photos that the other phone wants and this phone has.
    const pump = async () => {
        if (pumping || closed || state.status !== 'open') return;
        pumping = true;
        try {
            let round;
            do {
                round = wantsRound;
                let waiting = 0;
                for (const id of peerWants.filter(each => !sentIds.has(each) && !skipped.has(each))) {
                    if (closed) return;
                    const blob = await findBytes(id).catch(() => null);
                    if (!blob) {
                        waiting++;
                    } else if (blob.size > MAX_DIRECT_BYTES) {
                        skipped.add(id);
                        state.tooLarge++;
                    } else if (!(await sendFile(id, blob))) {
                        return;
                    }
                }
                state.waiting = waiting;
                // A new list may have come while a file went out.
            } while (round !== wantsRound && !closed);
        } finally {
            pumping = false;
            state.sending = null;
            report();
        }
    };

    const finishIncoming = async () => {
        const file = incoming;
        incoming = null;
        state.receiving = null;
        if (!file || file.loaded !== file.size) {
            report();
            return;
        }
        settled.add(file.id);
        let how = 'failed';
        try {
            how = await accept({ id: file.id, name: file.name, type: file.type, sealed: file.sealed },
                new Blob(file.parts, { type: file.type || '' }));
        } catch {
            how = 'failed';
        }
        if (how === 'delivered') state.received++;
        else if (how === 'rejected' || how === 'failed') state.rejected++;
        // In the room now: when it goes away again, it can be asked for again.
        if (how === 'delivered' || how === 'already') settled.delete(file.id);
        say({ t: 'got', id: file.id, how });
        onEvent?.({ what: 'received', id: file.id, name: file.name, bytes: file.size, ms: now() - file.startedAt, how });
        report();
    };

    const onText = (text) => {
        let message;
        try {
            message = JSON.parse(text);
        } catch {
            return;
        }
        if (!message || typeof message.t !== 'string' || onEarly(message)) return;
        if (message.t === 'hello') {
            if (message.v !== LINK_VERSION || message.room !== roomTag(room)) {
                state.status = 'otherRoom';
                report();
                close('room');
                return;
            }
            state.peer = { peerId: String(message.peerId || ''), name: String(message.name || '').slice(0, 60) };
            state.status = 'open';
            report();
            pump();
        } else if (state.status !== 'open') {
            // Nothing counts before the hello.
        } else if (message.t === 'want' && Array.isArray(message.ids)) {
            peerWants = message.ids.filter(id => typeof id === 'string').slice(0, 5000);
            // A photo it asks for again did not arrive in a good state.
            peerWants.forEach(id => sentIds.delete(id));
            wantsRound++;
            pump();
        } else if (message.t === 'file' && typeof message.id === 'string') {
            const size = Number(message.size);
            if (!Number.isInteger(size) || size < 0 || size > MAX_DIRECT_BYTES) {
                incoming = null;
                return;
            }
            incoming = {
                id: message.id, name: String(message.name || ''), type: String(message.type || ''), sealed: !!message.sealed,
                size, parts: [], loaded: 0, startedAt: now(),
            };
            state.receiving = { id: incoming.id, name: incoming.name, loaded: 0, total: size };
            report();
        } else if (message.t === 'end') {
            if (incoming && incoming.id === message.id) finishIncoming();
        } else if (message.t === 'notes' && Array.isArray(message.frames)) {
            message.frames.slice(0, 200).forEach((text) => {
                const frame = parseNotesText(text);
                if (frame) onNotes?.(frame);
            });
        } else if (message.t === 'bye') {
            close();
        }
    };

    // Before the hello counts: the other phone saw that the rooms differ.
    const onEarly = (message) => {
        if (message.t !== 'bye' || message.why !== 'room' || state.status !== 'starting') return false;
        state.status = 'otherRoom';
        close();
        return true;
    };

    const onMessage = (event) => {
        const data = event.data;
        if (typeof data === 'string') {
            onText(data);
            return;
        }
        if (!incoming) return;
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
        // More bytes than it said: not a file to keep.
        if (incoming.loaded + bytes.length > incoming.size) {
            incoming = null;
            state.receiving = null;
            report();
            return;
        }
        incoming.parts.push(bytes);
        incoming.loaded += bytes.length;
        state.receiving.loaded = incoming.loaded;
        report(false);
    };

    const onClose = () => {
        if (closed) return;
        closed = true;
        incoming = null;
        state.sending = null;
        state.receiving = null;
        if (state.status !== 'otherRoom') state.status = 'closed';
        report();
    };

    function close(why) {
        if (closed) return;
        say(why ? { t: 'bye', why } : { t: 'bye' });
        try { channel.close(); } catch { /* closed already */ }
        onClose();
    }

    const sendWants = async () => {
        const ids = await wants().catch(() => []);
        say({ t: 'want', ids: ids.filter(id => !settled.has(id) && incoming?.id !== id) });
    };

    const sendNotes = (frames = notes?.() || []) => {
        if (frames.length) say({ t: 'notes', frames: frames.map(notesText) });
    };

    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = BUFFER_LOW;
    channel.addEventListener('message', onMessage);
    channel.addEventListener('close', onClose);

    say({ t: 'hello', v: LINK_VERSION, room: roomTag(room), peerId: me.peerId, name: me.name || '' });
    sendWants();
    sendNotes();
    report();

    return {
        get state() { return state; },
        /** The room's photos changed: tell the other phone what is missing now. */
        refreshWants: sendWants,
        /** A photo came to this phone another way: the other phone may want it. */
        photoArrived() { pump(); },
        sendNotes,
        close,
    };
}
