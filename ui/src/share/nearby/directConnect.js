// The WebRTC part of a direct link: one connection with one data channel,
// set up from two descriptions that cross as QR codes (linkCode.js). No
// signalling server and no tracker are in it. On one Wi-Fi or hotspot the
// phones reach each other at their local addresses; a STUN server, when one
// answers, adds the public address.

// After the first address, wait this long for more. With no network the
// browser itself waits much longer for a STUN server that never answers.
const GATHER_AFTER_FIRST_MS = 1200;
const GATHER_MAX_MS = 5000;
const CHANNEL = { negotiated: true, id: 0 };

export function canLinkDirectly() {
    return typeof window !== 'undefined' && typeof window.RTCPeerConnection === 'function'
        && !!navigator.mediaDevices?.getUserMedia;
}

/** STUN servers only: a relay (TURN) is a server, and its password may be old. */
export function stunOnly(iceServers) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return [];
    return (iceServers || []).map((server) => {
        const urls = [].concat(server?.urls || server?.url || []).filter(url => /^stuns?:/i.test(url));
        return urls.length ? { urls } : null;
    }).filter(Boolean).slice(0, 2);
}

/** Resolves when the connection knows its addresses, or has waited long enough. */
function gathered(pc) {
    return new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') {
            resolve();
            return;
        }
        let soon = null;
        const done = () => {
            clearTimeout(soon);
            clearTimeout(last);
            pc.removeEventListener('icecandidate', onCandidate);
            pc.removeEventListener('icegatheringstatechange', onState);
            resolve();
        };
        const last = setTimeout(done, GATHER_MAX_MS);
        const onCandidate = (event) => {
            if (!event.candidate) done();
            else if (!soon) soon = setTimeout(done, GATHER_AFTER_FIRST_MS);
        };
        const onState = () => { if (pc.iceGatheringState === 'complete') done(); };
        pc.addEventListener('icecandidate', onCandidate);
        pc.addEventListener('icegatheringstatechange', onState);
    });
}

function connection(iceServers) {
    const pc = new RTCPeerConnection({ iceServers: stunOnly(iceServers) });
    const channel = pc.createDataChannel('photogroup-direct', CHANNEL);
    return { pc, channel };
}

/**
 * Start a link: this phone's description is the "offer".
 * @returns {Promise<{pc: RTCPeerConnection, channel: RTCDataChannel, sdp: string}>}
 */
export async function makeOffer(iceServers) {
    const { pc, channel } = connection(iceServers);
    try {
        await pc.setLocalDescription(await pc.createOffer());
        await gathered(pc);
        return { pc, channel, sdp: pc.localDescription.sdp };
    } catch (err) {
        pc.close();
        throw err;
    }
}

/**
 * Answer the offer that the camera read.
 * @returns {Promise<{pc: RTCPeerConnection, channel: RTCDataChannel, sdp: string}>}
 */
export async function makeAnswer(offerSdp, iceServers) {
    const { pc, channel } = connection(iceServers);
    try {
        await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        return { pc, channel, sdp: pc.localDescription.sdp };
    } catch (err) {
        pc.close();
        throw err;
    }
}

/** Give the offer's connection the answer that the camera read. */
export function takeAnswer(pc, answerSdp) {
    return pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
}

/** Resolves when the channel is open; rejects when the connection fails first. */
export function opened(pc, channel, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        if (channel.readyState === 'open') {
            resolve();
            return;
        }
        const end = (err) => {
            clearTimeout(timer);
            channel.removeEventListener('open', onOpen);
            pc.removeEventListener('connectionstatechange', onState);
            if (err) reject(err);
            else resolve();
        };
        const onOpen = () => end();
        const onState = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') end(new Error('The phones did not reach each other.'));
        };
        const timer = setTimeout(() => end(new Error('The phones did not reach each other in time.')), timeoutMs);
        channel.addEventListener('open', onOpen);
        pc.addEventListener('connectionstatechange', onState);
    });
}

/** How the two phones reach each other, for geek mode: "host ⇄ host udp", and the addresses when the browser tells them. */
export async function pathOf(pc) {
    try {
        const stats = await pc.getStats();
        let pair = null;
        stats.forEach((item) => {
            if (item.type === 'transport' && item.selectedCandidatePairId) pair = stats.get(item.selectedCandidatePairId) || pair;
        });
        if (!pair) stats.forEach((item) => { if (item.type === 'candidate-pair' && item.nominated && item.state === 'succeeded') pair = pair || item; });
        if (!pair) return '';
        const local = stats.get(pair.localCandidateId);
        const remote = stats.get(pair.remoteCandidateId);
        if (!local || !remote) return '';
        const address = side => (side.address || side.ip ? ` ${side.address || side.ip}` : '');
        return `${local.candidateType}${address(local)} ⇄ ${remote.candidateType}${address(remote)} ${local.protocol || ''}`.trim();
    } catch {
        return '';
    }
}
