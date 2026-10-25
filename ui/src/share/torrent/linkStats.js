// What WebRTC itself reports about each peer connection: the path ICE chose
// (host, srflx or relay at each end), its round-trip time, the bytes on it,
// and the STUN connectivity checks that keep it open. Read from
// RTCPeerConnection.getStats() once a second, summed per peer.
//   linkStats: { peerId, rtt, rx, tx, checks, answers, local, remote, protocol, relayProtocol, localAddress, remoteAddress, connections }
// rtt is in ms; rx and tx are bytes per second; checks and answers count the
// STUN binding requests sent and the responses received since the last read.

export const EVERY_MS = 1000;

/** The selected candidate pair and its two candidates, from one stats report. */
export function selectedPair(report) {
    const byId = new Map();
    let transport = null;
    report.forEach(stat => {
        byId.set(stat.id, stat);
        if (stat.type === 'transport' && !transport) transport = stat;
    });
    let pair = transport?.selectedCandidatePairId ? byId.get(transport.selectedCandidatePairId) : null;
    // Firefox has no transport stats: the nominated pair that works is the one in use.
    if (!pair) {
        pair = [...byId.values()].find(stat => stat.type === 'candidate-pair' && (stat.selected || (stat.nominated && stat.state === 'succeeded'))) || null;
    }
    if (!pair) return null;
    return { pair, local: byId.get(pair.localCandidateId) || {}, remote: byId.get(pair.remoteCandidateId) || {} };
}

const address = candidate => (candidate.address || candidate.ip ? `${candidate.address || candidate.ip}:${candidate.port}` : '');

/** The peer connections behind the room's wires, by remote peer id. */
function connections(client) {
    const found = [];
    (client?.torrents || []).forEach(torrent => {
        const peers = torrent._peers;
        if (!peers || typeof peers.forEach !== 'function') return;
        peers.forEach(peer => {
            const pc = peer?.conn?._pc;
            const peerId = peer?.wire?.peerId;
            if (pc && peerId && typeof pc.getStats === 'function' && pc.connectionState !== 'closed') {
                found.push({ pc, peerId: String(peerId) });
            }
        });
    });
    return found;
}

/**
 * Read the stats of every peer connection now and then, and emit one
 * `linkStats` per peer. Returns a stop function.
 */
export function watchLinks({ client, emitter, every = EVERY_MS, now = () => Date.now() }) {
    // pc → its last counters, to turn totals into rates and deltas.
    const last = new WeakMap();
    let stopped = false;

    const sample = async ({ pc, peerId }) => {
        let report;
        try {
            report = await pc.getStats();
        } catch {
            return null;
        }
        const chosen = selectedPair(report);
        if (!chosen) return null;
        const { pair, local, remote } = chosen;
        const at = now();
        const counters = {
            at,
            sent: pair.bytesSent || 0,
            received: pair.bytesReceived || 0,
            requests: (pair.requestsSent || 0) + (pair.consentRequestsSent || 0),
            responses: pair.responsesReceived || 0,
        };
        const before = last.get(pc);
        last.set(pc, counters);
        const seconds = before ? Math.max(0.001, (at - before.at) / 1000) : 0;
        return {
            peerId,
            rtt: Number.isFinite(pair.currentRoundTripTime) ? pair.currentRoundTripTime * 1000 : null,
            rx: before ? Math.max(0, counters.received - before.received) / seconds : 0,
            tx: before ? Math.max(0, counters.sent - before.sent) / seconds : 0,
            checks: before ? Math.max(0, counters.requests - before.requests) : 0,
            answers: before ? Math.max(0, counters.responses - before.responses) : 0,
            local: local.candidateType || '',
            remote: remote.candidateType || '',
            protocol: local.protocol || '',
            relayProtocol: local.relayProtocol || '',
            localAddress: address(local),
            remoteAddress: address(remote),
        };
    };

    const tick = async () => {
        const samples = (await Promise.all(connections(client).map(sample))).filter(Boolean);
        if (stopped) return;
        // A peer can be wired once per photo: one line for each peer.
        const byPeer = new Map();
        samples.forEach(item => {
            const sum = byPeer.get(item.peerId);
            if (!sum) {
                byPeer.set(item.peerId, { ...item, connections: 1, rtts: item.rtt === null ? [] : [item.rtt] });
                return;
            }
            sum.rx += item.rx;
            sum.tx += item.tx;
            sum.checks += item.checks;
            sum.answers += item.answers;
            sum.connections++;
            if (item.rtt !== null) sum.rtts.push(item.rtt);
            // A relayed connection is the one worth naming.
            if (item.local === 'relay' || item.remote === 'relay') Object.assign(sum, {
                local: item.local, remote: item.remote, protocol: item.protocol, relayProtocol: item.relayProtocol,
                localAddress: item.localAddress, remoteAddress: item.remoteAddress,
            });
        });
        byPeer.forEach(({ rtts, ...stat }) => {
            stat.rtt = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null;
            emitter.emit('linkStats', stat);
        });
    };

    const timer = setInterval(() => { tick(); }, every);
    return () => {
        stopped = true;
        clearInterval(timer);
    };
}
