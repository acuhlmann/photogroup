import FileUtil from '../util/FileUtil';
import { RX, TX } from './traffic';
import { formatDuration, peerName } from './transfers';

// A real share, replayed step by step on the map: each stage this device
// recorded for one photo (TransferLedger) becomes a step of the tour player,
// on the routes it really used, with the real time it happened.

const MIN_STEP_MS = 2200;
const MAX_STEP_MS = 5000;

const SERVER_WORDS = {
    requested: 'A server copy was requested',
    queued: 'A server copy is in the queue',
    uploading: 'A server copy is uploading',
    stored: 'The server copy is stored',
    exists: 'The server already had a copy',
    downloading: 'Downloading the server copy',
    verifying: 'Checking the server copy',
    done: 'The server copy arrived',
    rejected: 'The server copy was not used',
    failed: 'The server copy failed',
    'too-large': 'Too large for a server copy',
};

const short = value => String(value || '').slice(0, 8);

/**
 * Tour steps for one photo's recorded transfer.
 * @param {object} scene buildScene() output
 * @param {object} item a TransferLedger entry
 * @param {object} options { myPeerId, peers: [{peerId, name}] }
 */
export function replaySteps(scene, item, { myPeerId, peers = [] } = {}) {
    if (!scene || !item?.stages?.length) return [];
    const names = new Map(peers.map(peer => [peer.peerId, peerName(peer)]));
    const nameOf = id => (id === myPeerId ? 'you' : names.get(id) || 'peer ' + short(id));
    const hasRoute = id => scene.routes.some(route => route.id === id);
    const hasNode = id => scene.byId.has(id);
    const p2pRoute = peerId => scene.routes.find(route => route.peers?.includes(myPeerId) && route.peers.includes(peerId));
    // Does a flight from `from` along this route run against its path?
    const against = (route, from) => !!route && route.path[0] !== from;
    const start = item.stages[0].at;
    const firstPeer = item.stages.find(stage => stage.peerId)?.peerId;

    const steps = item.stages.map((stage, index) => {
        const next = item.stages[index + 1];
        const gap = next ? next.at - stage.at : 0;
        const when = `At +${formatDuration(stage.at - start) || '0 ms'}`
            + (next ? `, next stage ${formatDuration(gap)} later.` : '.');
        const peerId = stage.peerId || firstPeer;
        const p2p = peerId ? p2pRoute(peerId) : null;
        const step = {
            id: `${index}:${stage.lane}:${stage.stage}`,
            nodes: [myPeerId],
            routes: [],
            packets: [],
            sees: [],
            duration: Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, gap)),
            real: true,
        };
        const tracker = 'tracker:' + myPeerId;
        const copies = 'copies:' + myPeerId;
        if (stage.lane === 'server') {
            const up = stage.direction === 'up';
            step.title = SERVER_WORDS[stage.stage] || `Server copy: ${stage.stage}`;
            step.body = [when, stage.why ? `Reason: ${stage.why}.` : null,
                stage.total ? `${FileUtil.formatBytes(stage.loaded || stage.total)} of ${FileUtil.formatBytes(stage.total)}.` : null]
                .filter(Boolean).join(' ');
            step.nodes.push('edge', 'copies');
            if (hasRoute(copies)) {
                step.routes.push(copies);
                step.packets = [0, 700, 1400].map(at => ({ route: copies, at, reverse: !up, rgb: up ? TX : RX, label: at ? '' : (up ? 'PUT' : 'GET') }));
            }
            step.sees.push({ who: 'photogroup.network', what: 'the photo, while the server copy exists' });
        } else if (stage.stage === 'signal') {
            step.title = 'Your browser asked the tracker for peers';
            step.body = `${when} It sent the infohash of this photo to the tracker.`;
            step.nodes.push('tracker');
            if (hasRoute(tracker)) {
                step.routes.push(tracker);
                step.packets = [{ route: tracker, at: 0, label: 'announce' }, { route: tracker, at: 1000, reverse: true, label: 'peers' }];
            }
            step.sees.push({ who: 'tracker sees', what: 'which photo you want, never the photo' });
        } else if (stage.stage === 'handshake') {
            step.title = `Connected to ${nameOf(stage.peerId)}`;
            step.body = `${when} The tracker sent the offer and the answer. Then ICE found a path, and the browsers sent the BitTorrent handshake.`;
            step.nodes.push(stage.peerId, 'tracker');
            [tracker, 'tracker:' + stage.peerId].filter(hasRoute).forEach((id, n) => {
                step.routes.push(id);
                step.packets.push({ route: id, at: n * 600, reverse: n === 1, label: n ? 'answer' : 'offer' });
            });
            if (p2p) {
                step.routes.push(p2p.id);
                step.packets.push({ route: p2p.id, at: 1500, reverse: against(p2p, myPeerId), label: 'handshake' });
            }
        } else if (stage.stage === 'metadata') {
            step.title = 'Got the file list and piece hashes';
            step.body = `${when} A peer sent the file list and the hash of each piece (${String(stage.text || '').replace(/^metadata · /, '')}).`;
            if (p2p) {
                step.nodes.push(peerId);
                step.routes.push(p2p.id);
                step.packets.push({ route: p2p.id, at: 0, reverse: !against(p2p, myPeerId), label: 'metadata', rgb: RX });
            }
        } else if (stage.stage === 'pieces') {
            const sending = stage.kind === 'tx';
            const tally = item.peers?.get?.(stage.peerId);
            const bytes = tally ? (sending ? tally.tx : tally.rx) : 0;
            step.title = sending ? `First piece sent to ${nameOf(stage.peerId)}` : `First piece from ${nameOf(stage.peerId)}`;
            step.body = `${when} ${bytes ? `In total, ${FileUtil.formatBytes(bytes)} went ${sending ? 'to' : 'from'} ${nameOf(stage.peerId)}.` : ''}`.trim();
            if (p2p) {
                step.nodes.push(stage.peerId);
                step.routes.push(p2p.id);
                const reverse = sending ? against(p2p, myPeerId) : !against(p2p, myPeerId);
                step.packets = Array.from({ length: 6 }, (_, n) => ({
                    route: p2p.id, at: n * 300, reverse, rgb: sending ? TX : RX, label: n ? '' : 'piece', speed: 0.02,
                }));
            }
            step.sees.push({ who: 'never sees', what: 'photogroup.network is not on this path', tone: 'good' });
        } else if (stage.stage === 'verify') {
            step.title = 'All pieces checked';
            step.body = `${when} Each piece matched its SHA-1 hash, so the photo is complete.`;
        } else {
            step.title = stage.text || stage.stage;
            step.body = when;
        }
        step.nodes = step.nodes.filter(id => id && hasNode(id));
        return step;
    });

    const peerBytes = [...(item.peers?.values?.() || [])].reduce((sum, tally) => sum + tally.rx + tally.tx, 0);
    const serverBytes = (item.server?.rx || 0) + (item.server?.tx || 0);
    const total = peerBytes + serverBytes;
    const took = item.stages[item.stages.length - 1].at - start;
    steps.push({
        id: 'summary',
        title: 'Summary',
        body: [`This share took ${formatDuration(took) || '0 ms'} on this device.`,
            total ? `${Math.round(peerBytes / total * 100)}% went peer to peer and ${Math.round(serverBytes / total * 100)}% through the server.` : null]
            .filter(Boolean).join(' '),
        nodes: [myPeerId].filter(hasNode),
        routes: [],
        packets: [],
        sees: [],
        duration: MIN_STEP_MS,
        real: true,
    });
    return steps;
}
