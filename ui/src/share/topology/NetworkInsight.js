/**
 * NetworkInsight - reads the ICE candidates this device gathered (and the ones
 * other room members published) and explains what they mean for P2P: where
 * you sit behind NAT, whether STUN hole punching should work, and which path
 * a transfer to each peer is likely to take.
 *
 * Inputs are the `networkChain` arrays built by NetworkTopologyFinder:
 * [{ ip, port, transport, type, typeDetail, network? }]
 */

export function isMdns(ip) {
    return typeof ip === 'string' && ip.endsWith('.local');
}

export function isIpv6(ip) {
    return typeof ip === 'string' && ip.includes(':');
}

/** RFC 6598 shared space: the ISP itself runs NAT (CGNAT). */
export function isCgnat(ip) {
    const m = typeof ip === 'string' && ip.match(/^100\.(\d+)\./);
    return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

function uniqueBy(list, key) {
    const seen = new Set();
    return list.filter(item => {
        const k = key(item);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

function placeOf(item) {
    const n = item && item.network;
    if (!n) return null;
    const isp = n.connection && (n.connection.isp || n.connection.org);
    const where = [n.city, n.country_code || n.country].filter(Boolean).join(', ');
    return [where, isp].filter(Boolean).join(' · ') || null;
}

/** What one device's candidates say about its network. */
export function summarizeChain(chain) {
    const list = Array.isArray(chain) ? chain.filter(c => c && c.ip) : [];
    const host = list.filter(c => c.type === 'host');
    const reflexive = list.filter(c => c.type === 'srflx' || c.type === 'prflx');
    const relay = list.filter(c => c.type === 'relay');
    const publicIps = uniqueBy(reflexive, c => c.ip).map(c => c.ip);

    let nat = 'unknown';
    const detail = reflexive.map(c => c.typeDetail || '').join(' ');
    if (detail.includes('Symmetric NAT')) nat = 'symmetric';
    else if (detail.includes('Normal NAT')) nat = reflexive.length >= 2 ? 'cone' : 'cone?';
    else if (reflexive.length) nat = 'present';
    else if (host.length) nat = 'none-seen';

    return {
        gathered: list.length > 0,
        hostCount: host.length,
        mdnsCount: host.filter(c => isMdns(c.ip)).length,
        lanIps: host.filter(c => !isMdns(c.ip)).map(c => c.ip),
        ipv6: list.some(c => isIpv6(c.ip)),
        reflexive: uniqueBy(reflexive, c => c.ip + ':' + c.port).map(c => ({ ip: c.ip, port: c.port, place: placeOf(c) })),
        publicIps,
        cgnat: host.some(c => isCgnat(c.ip)),
        relay: relay.length > 0,
        transports: [...new Set(list.map(c => (c.transport || '').toLowerCase()).filter(Boolean))],
        nat,
    };
}

export const NAT_LABELS = {
    'cone': 'endpoint-independent (cone)',
    'cone?': 'cone, single reflection',
    'symmetric': 'symmetric (port per destination)',
    'present': 'behind NAT',
    'none-seen': 'no reflexive address',
    'unknown': 'not measured yet',
};

/** STUN/TURN server hostnames, never credentials. */
export function describeIceServers(rtcConfig) {
    const servers = Array.isArray(rtcConfig && rtcConfig.iceServers) ? rtcConfig.iceServers : [];
    const stun = new Set();
    const turn = new Set();
    servers.forEach(s => {
        const urls = Array.isArray(s.urls) ? s.urls : [s.urls || s.url];
        urls.forEach(u => {
            if (typeof u !== 'string') return;
            const m = u.match(/^(stuns?|turns?):([^:?]+)/i);
            if (!m) return;
            (m[1].toLowerCase().startsWith('turn') ? turn : stun).add(m[2]);
        });
    });
    return { stun: [...stun], turn: [...turn] };
}

/**
 * Likely path between this device and another, from both sides' candidates.
 * level: good | ok | poor | unknown
 */
export function forecastPath(mine, theirs, { hasTurn = false } = {}) {
    if (!mine.gathered || !theirs.gathered) {
        return { path: 'unknown', level: 'unknown', label: 'waiting for candidates', why: 'One side has not published its ICE candidates yet.' };
    }
    const shared = mine.publicIps.find(ip => theirs.publicIps.includes(ip));
    if (shared) {
        return {
            path: 'lan', level: 'good', label: 'same network, host↔host',
            why: 'Both of you appear behind the same public address ' + shared + ', so ICE should pair LAN candidates directly.',
        };
    }
    if (!mine.publicIps.length || !theirs.publicIps.length) {
        return {
            path: hasTurn ? 'relay' : 'server', level: 'poor', label: hasTurn ? 'TURN relay likely' : 'server copy likely',
            why: 'STUN gave ' + (mine.publicIps.length ? 'them' : 'you') + ' no public address, so only a relay or the server copy can bridge different networks.',
        };
    }
    if (mine.nat === 'symmetric' && theirs.nat === 'symmetric') {
        return {
            path: hasTurn ? 'relay' : 'server', level: 'poor', label: hasTurn ? 'TURN relay needed' : 'server copy likely',
            why: 'Both NATs pick a new port per destination, so the ports STUN saw are not the ones the peer will hit. Hole punching rarely survives that.',
        };
    }
    if (mine.nat === 'symmetric' || theirs.nat === 'symmetric') {
        return {
            path: 'stun', level: 'ok', label: 'hole punch, may fall back',
            why: 'One side is symmetric. Punching can still work when the other side is a cone NAT, but it is less reliable.',
        };
    }
    return {
        path: 'stun', level: 'good', label: 'direct via STUN hole punch',
        why: 'Different networks, cone NAT mappings: both sides send to each other\'s reflexive address and the NATs let the replies in.',
    };
}

/** One-line overall verdict for this device. */
export function verdictFor(summary, { hasTurn = false, stunPending = false } = {}) {
    if (!summary.gathered) return { level: 'unknown', text: 'Gathering ICE candidates…' };
    if (!summary.publicIps.length && stunPending) return { level: 'unknown', text: 'Host candidates in. Waiting for a STUN server to reflect your public address…' };
    if (!summary.publicIps.length) {
        return {
            level: 'poor',
            text: 'STUN could not see your public address. Same-Wi-Fi peers can still connect directly; ' +
                (hasTurn ? 'others go through the TURN relay.' : 'others will get the server copy.'),
        };
    }
    if (summary.nat === 'symmetric') {
        return {
            level: 'ok',
            text: 'Your NAT changes ports per destination. Peers behind cone NATs can still reach you; ' +
                (hasTurn ? 'the TURN relay covers the rest.' : 'the server copy covers the rest.'),
        };
    }
    return { level: 'good', text: 'Your NAT keeps a stable mapping, so direct P2P to other networks should work.' };
}
