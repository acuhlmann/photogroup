/**
 * TransferLedger - what each photo's transfer went through on this device,
 * kept from the moment the room loads so geek mode can show it whenever it
 * is opened: the stages in order with their times, and how many bytes came
 * from (or went to) each peer and the server.
 *
 * P2P stages come from the torrent itself (announce, the first wire with a
 * peer, metadata, the first piece, done); server stages from `serverCopy`
 * events (ServerPinning uploading, ServerFallback downloading). Bytes per
 * peer come from `pieceReceived` / `pieceSent`, which survive the wire
 * closing; the server's from the finished copy.
 */
import { getBaseInfoHash } from './WebTorrentUtils';

export const MAX_STAGES = 40;

const short = value => String(value || '').slice(0, 8);

export default class TransferLedger {
    constructor({ emitter, now = () => Date.now() } = {}) {
        this.emitter = emitter;
        this.now = now;
        this.items = new Map(); // base infoHash -> entry
        this.listeners = new Set();
        emitter?.on?.('newTorrent', torrent => this.track(torrent));
        emitter?.on?.('pieceReceived', event => this.piece('rx', event));
        emitter?.on?.('pieceSent', event => this.piece('tx', event));
        emitter?.on?.('serverCopy', event => this.server(event));
    }

    /** The entry for a photo or torrent, created on first sight. */
    entry(infoHash, name) {
        const key = getBaseInfoHash(infoHash);
        if (!key) return null;
        let item = this.items.get(key);
        if (!item) {
            item = { infoHash: key, name, startedAt: this.now(), stages: [], peers: new Map(), server: { rx: 0, tx: 0 }, serverStage: null };
            this.items.set(key, item);
        }
        if (name && !item.name) item.name = name;
        return item;
    }

    get(infoHash) {
        return this.items.get(getBaseInfoHash(infoHash)) || null;
    }

    all() {
        return [...this.items.values()];
    }

    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    changed() {
        this.listeners.forEach(fn => fn());
    }

    /** Add one stage; a stage repeating the last one (progress) replaces it. */
    stage(item, lane, stage, text, extra = {}) {
        const last = item.stages[item.stages.length - 1];
        const record = { at: this.now(), lane, stage, text, ...extra };
        if (last && last.lane === lane && last.stage === stage && (stage === 'uploading' || stage === 'downloading')) {
            item.stages[item.stages.length - 1] = { ...record, at: last.at, until: record.at };
        } else {
            item.stages.push(record);
            if (item.stages.length > MAX_STAGES) item.stages.splice(0, item.stages.length - MAX_STAGES);
        }
        this.changed();
    }

    track(torrent) {
        if (!torrent?.infoHash && !torrent?.on) return;
        const begin = () => {
            const item = this.entry(torrent.infoHash, torrent.name);
            if (!item || item.tracked) return item;
            item.tracked = true;
            this.stage(item, 'p2p', 'signal', 'announce infohash to tracker');
            return item;
        };
        if (torrent.infoHash) begin();
        else torrent.once?.('infoHash', begin);
        const seen = new Set();
        torrent.on?.('wire', wire => {
            const item = begin();
            const peerId = String(wire?.peerId || '');
            if (!item || seen.has(peerId)) return;
            seen.add(peerId);
            this.stage(item, 'p2p', 'handshake', `wire up with peer ${short(peerId)} · ${wire?.type || 'webrtc'}`, { peerId });
        });
        torrent.once?.('metadata', () => {
            const item = begin();
            if (item) this.stage(item, 'p2p', 'metadata', `metadata · ${torrent.pieces?.length || '?'} pieces of ${Math.round((torrent.pieceLength || 0) / 1024)} KiB`);
        });
        torrent.once?.('done', () => {
            const item = begin();
            if (item) this.stage(item, 'p2p', 'verify', 'all pieces here, SHA-1 verified');
        });
    }

    piece(kind, { torrent, peerId, size, index, total } = {}) {
        const item = this.entry(torrent?.infoHash, torrent?.name);
        if (!item) return;
        const id = String(peerId || '');
        // Every piece, in order, for the grid: which one, from or to whom, when.
        // Kept per torrent, since a photo and its thumbnail have their own pieces.
        if (!item.pieceLog) item.pieceLog = [];
        item.pieceLog.push({
            torrent: torrent?.infoHash, name: torrent?.name, total: total || 0, index, peerId: id, kind, at: this.now(),
        });
        const tally = item.peers.get(id) || { rx: 0, tx: 0, pieces: 0 };
        tally[kind] += size || 0;
        tally.pieces++;
        const first = !tally[kind + 'Started'];
        tally[kind + 'Started'] = true;
        item.peers.set(id, tally);
        if (first) {
            const what = kind === 'rx' ? `first piece from peer ${short(id)}` : `first piece sent to peer ${short(id)}`;
            this.stage(item, 'p2p', 'pieces', what + ` (#${(index ?? 0) + 1}/${total || '?'})`, { peerId: id, kind });
        } else {
            this.changed();
        }
    }

    server(event = {}) {
        const item = this.entry(event.infoHash, event.name);
        if (!item) return;
        item.serverStage = { ...event, at: this.now() };
        if (event.direction === 'down' && event.stage === 'done') item.server.rx = event.total || event.loaded || 0;
        if (event.direction === 'up' && (event.stage === 'stored')) item.server.tx = event.total || 0;
        const arrow = event.direction === 'up' ? '↑' : '↓';
        this.stage(item, 'server', event.stage, `server copy ${arrow} ${event.stage}`, {
            direction: event.direction, loaded: event.loaded, total: event.total, why: event.why,
        });
    }
}
