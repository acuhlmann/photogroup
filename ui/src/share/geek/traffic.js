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
    const record = (name, args, { flights = [], routeId, count, speed } = {}) => {
        const line = describeEvent(name, args) || {};
        timeline.push({
            kind: line.kind || name,
            text: line.text || '',
            key: line.key || '',
            flights: flights.filter(Boolean),
            route: routeId,
            count,
            speed,
        });
    };

    // The server pushes every room change to everyone at once.
    const broadcast = name => (event) => {
        const type = event && event.type ? ':' + event.type : '';
        if (throttled('sse' + name + type, 400)) return;
        const myId = getMyId();
        const added = name === 'photos' && event?.type === 'add'
            ? [].concat(event.item || []).some(photo => photo?.peerId === myId) : false;
        const flights = byKind('sse').map(route => flight(route, {
            reverse: true,
            label: route.peerId === myId ? `SSE ${name}${type}` : '',
        }));
        if (added) flights.push(flight(mine('sse'), { label: 'POST magnet' }));
        record(name, [event], { flights: flights.filter(f => f && (f.label || !f.reverse)) });
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

    const onWire = (event, address, torrent) => {
        if (throttled('wire', 500)) return;
        record('wire', [event, address, torrent], {
            flights: [
                flight(mine('tracker'), { label: 'announce' }),
                flight(mine('tracker'), { reverse: true, label: 'offer/answer', speed: SPEEDS.answer }),
            ],
        });
    };

    const onBackup = ({ pending } = {}) => {
        if (pending > 0) record('serverCopyBackup', [{ pending }], { flights: [flight(mine('copies'), { label: 'PUT chunk ≤8 MB' })] });
    };
    const onCopy = () => record('serverCopyReady', [], { flights: [flight(mine('copies'), { reverse: true, label: 'GET copy' })] });

    const onPeers = event => record('peers', [event]);
    const onConnections = event => record('peerConnections', [event]);
    const onLocalNetwork = chain => record('localNetwork', [chain]);
    const onReconnected = () => record('sseReconnected', []);

    // Only our own NAT asks STUN; the others gather on their own devices.
    const onIce = (type, value) => {
        if (type !== 'icegatheringstatechange' || value !== 'gathering') return;
        const nat = (mine('sse')?.path || [])[1];
        const flights = byKind('stun')
            .filter(route => route.path[0] === nat)
            .flatMap(route => [
                flight(route, { label: 'binding request' }),
                flight(route, { reverse: true, label: 'binding response', speed: SPEEDS.binding }),
            ]);
        record('pcEvent', [type, value], { flights });
    };

    const handlers = [
        ['photos', broadcast('photos')],
        ['peers', onPeers],
        ['peerConnections', onConnections],
        ['downloadProgress', onSpeed('rx')],
        ['uploadProgress', onSpeed('tx')],
        ['pieceReceived', onPiece('rx')],
        ['pieceSent', onPiece('tx')],
        ['wire', onWire],
        ['serverCopyBackup', onBackup],
        ['serverCopyReady', onCopy],
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
    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        if (clock - entry.at > window) break;
        // Traffic the room sent after the moment on screen is not news yet.
        if (entry.at > clock || entry.route !== routeId) continue;
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
    return state.rx || state.tx || state.rxSpeed || state.txSpeed ? state : null;
}
