import FileUtil from '../util/FileUtil';
import { describeEvent } from './packetLog';
import { transferRoutesFor } from './scene';
import { flightMs } from './timeline';

// The single place room events become recorded traffic. Each event that the
// footer can describe becomes one timeline entry, and that entry carries the
// packets it flew — so a log line and the dot on the map are the same object,
// and pausing, scrubbing or clicking a line is one mechanism, not three.

// How long a route keeps showing its last transfer.
export const FLOW_MS = 5000;
// A server copy still under way keeps its route on screen between chunks.
export const NOTE_MS = 60000;
// Bytes coming in and going out are drawn in these colours.
export const RX = '61,222,139';
export const TX = '245,185,66';

// How long each kind of packet takes to cross its route.
const SPEEDS = {
    default: 0.012,
    piece: 0.02,
    answer: 0.01,
    binding: 0.009,
};

const dur = speed => flightMs(speed) * (0.85 + Math.random() * 0.3);

/**
 * Record the room's events into `timeline`.
 * @param {object} deps
 * @param {object} deps.timeline createTimeline()
 * @param {object} deps.emitter the room's emitter
 * @param {() => object} deps.getScene the current scene (routes, nodes)
 * @param {() => string} deps.getMyId this device's peer id
 * @param {() => boolean} deps.animate false when reduced motion means no dots
 */
export function attachTraffic({ timeline, emitter, getScene, getMyId, animate = () => true, now = () => Date.now() }) {
    const last = new Map();
    const throttled = (key, ms) => {
        const at = now();
        // A key never seen is not throttled; `|| 0` would suppress the first
        // event whenever the clock starts at zero.
        const previous = last.get(key);
        if (previous !== undefined && at - previous < ms) return true;
        last.set(key, at);
        return false;
    };

    const routes = () => getScene()?.routes || [];
    const byKind = kind => routes().filter(route => route.kind === kind);
    const mine = kind => byKind(kind).find(route => route.peerId === getMyId());

    /** One packet of an entry; dropped when the route has left the scene. */
    const flight = (route, { reverse = false, rgb, label = '', speed = SPEEDS.default } = {}) => {
        if (!route || !animate()) return null;
        return {
            routeId: route.id,
            reverse,
            label,
            rgb: rgb || undefined,
            dur: dur(speed),
        };
    };

    /** Write one event: its log line, plus what crossed and what to count. */
    const record = (name, args, { flights = [], routeId, count, speed, note, sticky, bytes } = {}) => {
        const line = describeEvent(name, args) || {};
        timeline.push({
            kind: line.kind || name,
            text: line.text || '',
            key: line.key || '',
            flights: flights.filter(Boolean),
            route: routeId,
            count,
            speed,
            note,
            sticky,
            bytes,
        });
    };

    // The server pushes every room change to everyone at once, on each
    // device's event stream. One dot per real SSE message, sized as it came.
    const onSse = (event = {}) => {
        const type = event.type ? ':' + event.type : '';
        if (throttled('sse' + event.channel + type, 150)) return;
        const myId = getMyId();
        const size = event.bytes ? ` ${FileUtil.formatBytes(event.bytes)}` : '';
        record('sse', [event], {
            bytes: event.bytes,
            flights: byKind('sse').map(route => flight(route, {
                reverse: true,
                label: route.peerId === myId ? `SSE ${event.channel}${type}${size}` : '',
            })),
        });
    };

    // A photo this device adds goes up to the room as its magnet link.
    const onPhotos = event => {
        const myId = getMyId();
        const added = event?.type === 'add'
            && [].concat(event.item || []).some(photo => photo?.peerId === myId && photo?.isFake);
        // A photo's details changing on this device is not traffic.
        if (!added && !describeEvent('photos', [event])) return;
        record('photos', [event], { flights: added ? [flight(mine('sse'), { label: 'POST magnet' })] : [] });
    };

    // Pieces are real WebTorrent transfers: one entry each, so the route label
    // counts them all, and a dot for the ones worth drawing.
    const onPiece = kind => (event = {}) => {
        const { torrent, index, size, total, peerId } = event;
        const myId = getMyId();
        const route = transferRoutesFor(routes(), myId, { wires: [{ peerId }] })[0];
        if (!route) return;
        const every = Math.max(1, Math.ceil((total || 1) / 40));
        const lastPiece = index === total - 1;
        const drawn = lastPiece || !(index % every || throttled(kind + 'dot' + route.id, 60));
        // Pieces arrive in bursts; name one every so often so labels stay readable.
        const named = lastPiece || !throttled(kind + 'name' + route.id, 700);
        const towardsMe = route.path[route.path.length - 1] === myId;
        record(kind === 'rx' ? 'pieceReceived' : 'pieceSent', [event], {
            routeId: route.id,
            count: 1,
            bytes: size,
            flights: drawn ? [flight(route, {
                reverse: kind === 'rx' ? !towardsMe : towardsMe,
                rgb: kind === 'rx' ? RX : TX,
                label: named ? `#${index + 1}/${total} ${FileUtil.formatBytes(size)}` : '',
                speed: SPEEDS.piece,
            })] : [],
        });
    };

    // Speeds come per torrent; they belong on every route wired for it. The
    // line still matters when nothing is wired, so one is kept either way.
    const onSpeed = kind => (event) => {
        const name = kind === 'rx' ? 'downloadProgress' : 'uploadProgress';
        const wired = transferRoutesFor(routes(), getMyId(), event?.torrent);
        if (!wired.length) {
            record(name, [event], { speed: event?.speed });
            return;
        }
        wired.forEach(route => record(name, [event], { routeId: route.id, speed: event?.speed }));
    };

    // A wire is a peer connection that just opened: the tracker carried the
    // offer and the answer, then the two browsers swap the BitTorrent
    // handshake on the new data channel.
    const onWire = (event, address, torrent) => {
        if (throttled('wire', 500)) return;
        const direct = transferRoutesFor(routes(), getMyId(), { wires: [{ peerId: event?.peerId }] })[0];
        record('wire', [event, address, torrent], {
            flights: [
                flight(mine('tracker'), { label: 'offer' }),
                flight(mine('tracker'), { reverse: true, label: 'answer', speed: SPEEDS.answer }),
                direct && flight(direct, { label: 'handshake' }),
                direct && flight(direct, { reverse: true, label: 'bitfield', speed: SPEEDS.answer }),
            ],
        });
    };

    // The tracker answered an announce: which photos this device has, and
    // back come peers that want them.
    const onTracker = (event = {}) => {
        if (throttled('announce' + (event.torrent?.infoHash || ''), 1000)) return;
        record('trackerAnnounce', [event], {
            flights: [
                flight(mine('tracker'), { label: 'announce' }),
                flight(mine('tracker'), { reverse: true, label: 'peers', speed: SPEEDS.answer }),
            ],
        });
    };

    // A server copy's stages, on this device's route to the copies store:
    // chunks going up, the copy coming down, the request asking for one.
    const onServerCopy = (event = {}) => {
        const route = mine('copies');
        const up = event.direction === 'up';
        const moving = event.stage === 'uploading' || event.stage === 'downloading';
        const bytes = event.total ? `${FileUtil.formatBytes(event.loaded || 0)}/${FileUtil.formatBytes(event.total)}` : '';
        const verb = up ? 'PUT' : 'GET';
        const note = moving && bytes ? `${verb} ${bytes}` : event.stage === 'requested' ? 'POST request' : `${verb} ${event.stage}`;
        const flights = [];
        if (event.stage === 'requested') flights.push(flight(route, { label: 'POST /request' }));
        else if (moving || event.stage === 'stored' || event.stage === 'done') {
            flights.push(flight(route, { reverse: !up, label: moving ? `${verb} ${bytes}`.trim() : `${verb} ${event.stage}`, rgb: up ? TX : RX }));
        }
        record('serverCopy', [event], {
            routeId: route?.id,
            note,
            sticky: moving || event.stage === 'queued' || event.stage === 'requested' || event.stage === 'verifying',
            flights,
        });
    };

    const onPeers = event => record('peers', [event]);
    const onConnections = event => record('peerConnections', [event]);
    const onLocalNetwork = chain => record('localNetwork', [chain]);
    const onReconnected = () => record('sseReconnected', []);

    // STUN, as it really goes: gathering sends a Binding Request out through
    // our NAT, and a server-reflexive candidate is the answer, naming the
    // public address STUN saw. No answer, no packet back. Only our own NAT
    // asks STUN; the others gather on their own devices.
    const onIce = (type, value) => {
        const state = String(value || '');
        // A state change with no state says nothing.
        if (!state) return;
        const asking = type === 'icegatheringstatechange' && state === 'gathering';
        const answered = type === 'icecandidate' && state.startsWith('srflx');
        const nat = (mine('sse')?.path || [])[1];
        const stun = asking || answered ? byKind('stun').filter(route => route.path[0] === nat) : [];
        const flights = stun.map(route => (asking
            ? flight(route, { label: 'Binding Request' })
            : flight(route, { reverse: true, label: `Binding Success ${state.slice('srflx'.length).trim()}`, speed: SPEEDS.binding })));
        record('pcEvent', [type, value], { flights });
    };

    const handlers = [
        ['sse', onSse],
        ['photos', onPhotos],
        ['peers', onPeers],
        ['peerConnections', onConnections],
        ['downloadProgress', onSpeed('rx')],
        ['uploadProgress', onSpeed('tx')],
        ['pieceReceived', onPiece('rx')],
        ['pieceSent', onPiece('tx')],
        ['wire', onWire],
        ['trackerAnnounce', onTracker],
        ['serverCopy', onServerCopy],
        ['pcEvent', onIce],
        ['localNetwork', onLocalNetwork],
        ['sseReconnected', onReconnected],
    ];
    handlers.forEach(([name, handler]) => emitter.on(name, handler));
    return () => handlers.forEach(([name, handler]) => emitter.removeListener(name, handler));
}

/**
 * What a route is showing beside its name, at one moment: the pieces that
 * crossed it in the last FLOW_MS and the speed it was moving at. Read from the
 * recording, so a paused or scrubbed map reports the traffic of that instant.
 */
export function flowAt(entries, routeId, clock = Date.now(), window = FLOW_MS) {
    const state = { rx: 0, tx: 0, at: 0 };
    let noted = false;
    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        const age = clock - entry.at;
        if (age > Math.max(window, NOTE_MS)) break;
        // Traffic the room sent after the moment on screen is not news yet.
        if (entry.at > clock || entry.route !== routeId) continue;
        // The newest stage decides: one still under way stays up a while.
        if (entry.note && !noted) {
            noted = true;
            if (age <= (entry.sticky ? NOTE_MS : window)) {
                state.note = entry.note;
                if (!state.at) state.at = entry.at;
            }
        }
        if (age > window) continue;
        if (entry.count) {
            if (entry.kind === 'rx') state.rx += entry.count;
            if (entry.kind === 'tx') state.tx += entry.count;
            // Walking newest first, so the first hit is the most recent.
            if (!state.at) state.at = entry.at;
        }
        if (entry.speed && !state[entry.kind + 'Speed']) {
            state[entry.kind + 'Speed'] = entry.speed;
            if (!state.at) state.at = entry.at;
        }
    }
    return state.rx || state.tx || state.rxSpeed || state.txSpeed || state.note ? state : null;
}
