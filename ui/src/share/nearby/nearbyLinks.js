// The direct links of this page: the exchange of the two QR codes that
// starts one (linkCode.js, directConnect.js), and what goes over it
// afterwards (directLink.js). A link stays open when its dialog is closed.

import Logger from 'js-logger';
import { decodeLinkCode, encodeLinkCode, isLinkCode } from './linkCode';
import { roomTag } from './notes';
import { makeOffer, makeAnswer, takeAnswer, opened, pathOf } from './directConnect';
import { createLinkSession } from './directLink';
import { notePairing } from './pairingLog';
import { loadNearbyCodeSoon } from './preload';

export const LINK_PROBLEMS = {
    otherRoom: 'The other phone is in a different room. Open the same room on both phones.',
    failed: 'The phones did not reach each other. Connect both phones to the same Wi-Fi or hotspot. Then try again.',
    noAddress: 'This phone found no address for a link. Connect it to a Wi-Fi or hotspot. Then try again.',
};
// How long a scanned answer may take to become a link.
const CONNECT_MS = 20000;
// Notes on a link can be larger than as sound.
const LINK_NOTE_BYTES = 1024;
const REFRESH_MS = 400;

export default class NearbyLinks {
    constructor(master, { connect = { makeOffer, makeAnswer, takeAnswer, opened, pathOf } } = {}) {
        this.master = master;
        this.emitter = master.emitter;
        this.connect = connect;
        this.links = [];
        this.handshake = null;
        this.nextLink = 1;
        this.busyReading = false;
        this.refreshTimer = null;

        const refresh = () => {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = setTimeout(() => this.open().forEach(link => link.session.refreshWants()), REFRESH_MS);
        };
        this.emitter?.on?.('photos', (event) => {
            if (this.open().length && ['add', 'all', 'delete'].includes(event?.type)) refresh();
        });
        const arrived = () => {
            if (!this.open().length) return;
            this.open().forEach(link => link.session.photoArrived());
            refresh();
        };
        this.emitter?.on?.('torrentReady', arrived);
        this.emitter?.on?.('heldChanges', () => this.open().forEach(link => link.session.sendNotes()));
        // With no server later, the code for the nearby channels cannot load: get it now.
        this.emitter?.on?.('readyToUpload', () => loadNearbyCodeSoon());
    }

    open() {
        return this.links.filter(link => link.state.status === 'open' || link.state.status === 'starting');
    }

    /** A link moves a photo now: keep the screen on. */
    busy() {
        return this.open().some(link => link.state.sending || link.state.receiving);
    }

    snapshot() {
        const shake = this.handshake;
        return {
            handshake: shake && { step: shake.step, code: shake.code, problem: shake.problem || '' },
            links: this.links.map(link => ({ id: link.id, path: link.path, ...link.state })),
        };
    }

    changed() {
        this.emitter?.emit('directLink', this.snapshot());
    }

    iceServers() {
        return this.master.creator?.iceServers?.iceServers || [];
    }

    /** Start the exchange: make this phone's first code (an offer). */
    async begin() {
        this.cancel();
        const shake = this.handshake = { step: 'preparing', code: null, problem: '', offer: null, answer: null, done: false };
        this.changed();
        await this.offer(shake);
    }

    async offer(shake) {
        try {
            const made = await this.connect.makeOffer(this.iceServers());
            if (this.handshake !== shake || shake.done) {
                made.pc.close();
                return;
            }
            const id = Math.floor(Math.random() * 0xffff) + 1;
            const code = encodeLinkCode({ kind: 'offer', id, room: this.master.service.id, sdp: made.sdp });
            shake.offer = { ...made, id, code, answered: false };
            // An answer for the phone that scanned first stays on screen.
            if (shake.step !== 'answer') {
                shake.step = 'offer';
                shake.code = code;
            }
            notePairing(this.emitter, { channel: 'qr', direction: 'out', what: 'link offer', bytes: code.length });
        } catch (err) {
            Logger.warn('Making a link code failed: ' + (err?.message || err));
            if (this.handshake !== shake) return;
            shake.step = 'problem';
            shake.problem = LINK_PROBLEMS.noAddress;
        }
        this.changed();
    }

    /**
     * Bytes that the camera read. Codes are read many times a second: one
     * that is known already does nothing.
     * @returns {Promise<boolean>} whether the bytes were a link code
     */
    async read(bytes) {
        if (!isLinkCode(bytes)) return false;
        const shake = this.handshake;
        if (!shake || shake.done || this.busyReading) return true;
        const code = decodeLinkCode(bytes);
        if (!code) return true;
        if (code.roomTag !== roomTag(this.master.service.id)) {
            if (shake.problem !== LINK_PROBLEMS.otherRoom) {
                shake.problem = LINK_PROBLEMS.otherRoom;
                this.changed();
            }
            return true;
        }
        if (shake.problem === LINK_PROBLEMS.otherRoom) shake.problem = '';
        this.busyReading = true;
        try {
            if (code.kind === 'offer') await this.readOffer(shake, code, bytes.length);
            else await this.readAnswer(shake, code, bytes.length);
        } finally {
            this.busyReading = false;
        }
        return true;
    }

    // The other phone's offer: show an answer for it.
    async readOffer(shake, code, bytes) {
        // This phone's own code (in a mirror), or the offer that has an answer already.
        if (code.id === shake.offer?.id || code.id === shake.answer?.forId) return;
        notePairing(this.emitter, { channel: 'qr', direction: 'in', what: 'link offer', bytes });
        await this.answer(shake, code);
    }

    async answer(shake, code) {
        const before = shake.answer;
        // Until the new answer is ready, the same offer is not read again.
        shake.answer = { forId: code.id, pc: null };
        before?.pc?.close();
        try {
            const made = await this.connect.makeAnswer(code.sdp, this.iceServers());
            if (this.handshake !== shake || shake.done) {
                made.pc.close();
                return;
            }
            const answerCode = encodeLinkCode({ kind: 'answer', id: code.id, room: this.master.service.id, sdp: made.sdp });
            const answer = shake.answer = { ...made, forId: code.id, code: answerCode };
            shake.step = 'answer';
            shake.code = answerCode;
            shake.problem = '';
            notePairing(this.emitter, { channel: 'qr', direction: 'out', what: 'link answer', bytes: answerCode.length });
            this.changed();
            // The other phone may take a long time to scan. A browser gives
            // up on an answer after some seconds: make a new one then.
            this.connect.opened(made.pc, made.channel, 24 * 60 * 60 * 1000)
                .then(() => this.adopt(shake, answer, 'answer'))
                .catch(() => {
                    if (this.handshake === shake && !shake.done && shake.answer === answer) {
                        this.answer(shake, code).catch(() => {});
                    }
                });
        } catch (err) {
            Logger.warn('Answering a link code failed: ' + (err?.message || err));
            if (this.handshake !== shake) return;
            shake.answer = before && before.forId !== code.id ? before : null;
            shake.problem = LINK_PROBLEMS.failed;
            this.changed();
        }
    }

    // The other phone's answer to this phone's offer: the link can open now.
    async readAnswer(shake, code, bytes) {
        const offer = shake.offer;
        if (!offer || code.id !== offer.id || offer.answered) return;
        offer.answered = true;
        notePairing(this.emitter, { channel: 'qr', direction: 'in', what: 'link answer', bytes });
        shake.step = 'connecting';
        shake.problem = '';
        this.changed();
        try {
            await this.connect.takeAnswer(offer.pc, code.sdp);
            await this.connect.opened(offer.pc, offer.channel, CONNECT_MS);
            this.adopt(shake, offer, 'offer');
        } catch (err) {
            Logger.warn('The link did not open: ' + (err?.message || err));
            if (this.handshake !== shake || shake.done) return;
            // That offer is used up: start again with a new code.
            offer.pc.close();
            shake.offer = null;
            shake.step = 'preparing';
            shake.code = null;
            shake.problem = LINK_PROBLEMS.failed;
            this.changed();
            await this.offer(shake);
        }
    }

    // The channel is open: the exchange is over and the link starts.
    adopt(shake, side, role) {
        if (this.handshake !== shake || shake.done) {
            side.pc.close();
            return;
        }
        shake.done = true;
        [shake.offer, shake.answer].forEach((other) => { if (other && other !== side) other.pc?.close(); });
        this.handshake = { step: 'linked', code: null, problem: '' };
        const master = this.master;
        const link = { id: this.nextLink++, pc: side.pc, role, path: '', state: { status: 'starting' }, session: null, openedAt: Date.now() };
        this.links.push(link);
        link.session = createLinkSession({
            channel: side.channel,
            room: master.service.id,
            me: { peerId: master.client?.peerId || '', name: master.nearbyNotes?.myName() || master.device || '' },
            wants: () => master.missingPhotoIds(),
            findBytes: async id => ((await master.hasPhotoBytes(id)) ? master.findPhotoBytes(id) : null),
            describe: (id) => {
                const photo = master.roomPhotos?.get(id);
                return photo ? { name: photo.fileName || '', type: photo.fileType || '', sealed: !!photo.secure } : null;
            },
            accept: (details, blob) => master.acceptNearbyPhoto(details, blob, { via: 'direct' }),
            notes: () => master.nearbyNotes?.frames({ maxBytes: LINK_NOTE_BYTES }) || [],
            onNotes: frame => master.nearbyNotes?.apply(frame),
            onState: (state) => {
                const was = link.state.status;
                link.state = state;
                if (state.status === 'open' && was !== 'open') this.linked(link);
                if (state.status === 'closed' || state.status === 'otherRoom') {
                    link.pc.close();
                    if (was === 'open') notePairing(this.emitter, { channel: 'direct', direction: 'in', what: 'link closed', detail: state.peer?.name || '' });
                }
                this.changed();
            },
            onEvent: (event) => {
                if (event.what === 'received' && event.how !== 'delivered') return;
                notePairing(this.emitter, {
                    channel: 'direct', direction: event.what === 'sent' ? 'out' : 'in', what: 'photo',
                    bytes: event.bytes, ms: event.ms, detail: event.name || '',
                });
            },
        });
        side.pc.addEventListener('connectionstatechange', () => {
            if (['failed', 'closed'].includes(side.pc.connectionState)) link.session.close();
        });
        this.changed();
    }

    linked(link) {
        // A second link to the same phone takes the place of the first.
        this.links.filter(other => other !== link && other.state.peer?.peerId === link.state.peer?.peerId
            && other.state.status === 'open').forEach(other => other.session.close());
        this.links = this.links.filter(other => other === link || other.state.status === 'open' || other.state.status === 'starting');
        this.connect.pathOf(link.pc).then((path) => {
            link.path = path;
            notePairing(this.emitter, {
                channel: 'direct', direction: link.role === 'offer' ? 'out' : 'in', what: 'link open',
                detail: [link.state.peer?.name, path, 'no server'].filter(Boolean).join(' · '),
            });
            this.changed();
        });
    }

    /** Stop an exchange that did not become a link. Open links stay. */
    cancel() {
        const shake = this.handshake;
        this.handshake = null;
        if (!shake) return;
        shake.done = true;
        shake.offer?.pc?.close();
        shake.answer?.pc?.close();
        this.changed();
    }

    /** Close a link, or all of them. */
    close(id) {
        this.links.filter(link => id === undefined || link.id === id).forEach(link => link.session?.close());
        this.links = this.links.filter(link => id !== undefined && link.id !== id);
        this.changed();
    }
}
