import { getBaseInfoHash } from '../torrent/WebTorrentUtils';
import { summarizeChain, forecastPath } from '../topology/NetworkInsight';
import { isAway } from '../topology/presence';

// Why P2P did not work with a device, in a few words for the map and a
// sentence for its card. Only from what this device saw: its own ICE
// settings and candidates, the WebRTC connections that failed, the photos
// that came as a server copy, and the devices it has no wire to.

/** How long a wanted exchange may go without a wire before we call it. */
export const NO_LINK_MS = 15000;

const holders = photo => {
    const ids = new Set((photo?.owners || []).filter(owner => !owner.loading).map(owner => owner.peerId));
    if (photo?.peerId) ids.add(photo.peerId);
    return ids;
};

/**
 * The devices a photo still has to cross a link with: one that is getting a
 * photo this device holds, or one holding a photo this device is getting.
 */
export function wantedPeers({ photos = [], myPeerId }) {
    const ids = new Set();
    photos.forEach(photo => {
        const have = holders(photo);
        const loading = (photo.owners || []).filter(owner => owner.loading).map(owner => owner.peerId);
        if (have.has(myPeerId)) loading.forEach(id => id !== myPeerId && ids.add(id));
        if (loading.includes(myPeerId)) have.forEach(id => id !== myPeerId && ids.add(id));
    });
    return ids;
}

/** Peers this device has a live wire with, on any torrent. */
export function wiredPeers(torrents = []) {
    const ids = new Set();
    torrents.forEach(torrent => (torrent?.wires || []).forEach(wire => wire?.peerId && ids.add(String(wire.peerId))));
    return ids;
}

/**
 * @returns {Map<string, {short: string, why: string[]}>} by peer id
 */
export function p2pIssues({ myPeerId, peers = [], photos = [], items = [], wired = new Set(), rtcConfig = null,
    localNetwork = null, hasTurn = false, now = Date.now() }) {
    const issues = new Map();
    const photoOf = new Map(photos.map(photo => [getBaseInfoHash(photo.infoHash), photo]));
    const add = (peerId, short, why) => {
        const known = issues.get(peerId);
        if (known) {
            if (!known.why.includes(why)) known.why.push(why);
            return;
        }
        issues.set(peerId, { short, why: [why] });
    };

    // This device.
    const myChain = (peers.find(peer => peer.peerId === myPeerId)?.networkChain?.length
        ? peers.find(peer => peer.peerId === myPeerId).networkChain : localNetwork) || [];
    if (rtcConfig?.iceTransportPolicy === 'relay') {
        const relayed = myChain.some(candidate => String(candidate.type || '').startsWith('relay'));
        add(myPeerId, relayed ? 'relay only' : 'relay only · no TURN address',
            'This browser may connect only through TURN.'
            + (relayed ? '' : ' TURN gave no address, so no WebRTC connection can start.'));
    }
    const failures = items.flatMap(item => item.failures || []);
    if (failures.length) {
        const last = failures[failures.length - 1];
        add(myPeerId, `${last.reason}${failures.length > 1 ? ' ×' + failures.length : ''}`,
            `${failures.length} WebRTC connection${failures.length > 1 ? 's' : ''} failed (${last.reason}).`);
    }

    // Downloads that came as a server copy: P2P with their holders did not work.
    const mine = summarizeChain(myChain);
    const forecast = peer => forecastPath(mine, summarizeChain(peer.networkChain || []), { hasTurn });
    const fellBack = new Set();
    items.forEach(item => {
        const photo = photoOf.get(item.infoHash);
        if (!photo || photo.peerId === myPeerId) return;
        if (item.serverStage?.direction !== 'down') return;
        holders(photo).forEach(id => id !== myPeerId && fellBack.add(id));
        if (item.serverStage.stage === 'done' && !wired.size) {
            add(myPeerId, 'no P2P · server copy', 'No WebRTC link came up, so a photo came as a server copy.');
        }
    });

    peers.forEach(peer => {
        const id = peer.peerId;
        if (id === myPeerId) return;
        if (isAway(peer)) {
            add(id, 'in another app', 'This device is in another app. Phones stop P2P in the background.');
            return;
        }
        if (wired.has(String(id))) return;
        if (fellBack.has(id)) {
            add(id, 'no P2P · server copy', `No WebRTC link to this device came up, so its photo came as a server copy. ${forecast(peer).why}`.trim());
            return;
        }
        // A photo this device holds and they lack went to the server: they
        // could only get it that way.
        const viaServer = photos.some(photo => holders(photo).has(myPeerId) && !holders(photo).has(id) && !peer.dataSaver
            && (photo.hasServerCopy || photo.serverCopyRequestedAt || photo.serverCopyReceived > 0));
        if (viaServer) {
            add(id, 'no P2P · server copy', `No WebRTC link to this device came up, so the room asked for a server copy. ${forecast(peer).why}`.trim());
            return;
        }
        // Still waiting: a photo it has that we want, or one it wants from us.
        const waiting = items.find(item => {
            const photo = photoOf.get(item.infoHash);
            if (!photo || now - item.startedAt < NO_LINK_MS) return false;
            const theyHave = holders(photo).has(id) && photo.peerId !== myPeerId && !item.stages.some(stage => stage.stage === 'verify');
            const lacks = (photo.owners || []).some(owner => owner.peerId === id && owner.loading) || (!holders(photo).has(id) && !peer.dataSaver);
            const theyWant = lacks && holders(photo).has(myPeerId);
            return theyHave || theyWant;
        });
        if (waiting) {
            const seconds = Math.round((now - waiting.startedAt) / 1000);
            add(id, `no link after ${seconds} s`, `No WebRTC link to this device after ${seconds} s. ${forecast(peer).why}`.trim());
        }
    });
    return issues;
}
