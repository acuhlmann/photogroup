/**
 * DiscoveryConfig - tracker / ICE configuration that keeps WebRTC working
 * when phones meet in the real world.
 *
 * Why this exists: the app used to announce to exactly one tracker (its own
 * server) and, without Twilio credentials, to two STUN servers (one of them
 * a long-dead bare IP). On mobile carrier networks (CGNAT), venue Wi-Fi with
 * client isolation, or after a Wi-Fi <-> cellular handover, that single
 * tracker socket is often the first thing to die - and with it all peer
 * discovery. Multiple independent WebSocket trackers and several public
 * STUN servers cost nothing and remove those single points of failure.
 * TURN (from Twilio, when configured) is still what rescues symmetric-NAT
 * pairs; these fallbacks only apply when no better server list was given.
 */

export const PUBLIC_WS_TRACKERS = [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.files.fm:7073/announce',
];

export const FALLBACK_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.nextcloud.com:443' },
];

function urlsOf(server) {
    const urls = server?.urls ?? server?.url;
    return Array.isArray(urls) ? urls : [urls];
}

/**
 * Build the WebTorrent announce list: our own tracker first (fastest for
 * people in the same room, and the only one that feeds the server-side
 * topology view), then public trackers so discovery survives our tracker
 * socket dropping - which mobile browsers do aggressively in background.
 */
export function buildAnnounceList(ownTrackerUrl, extraTrackers = PUBLIC_WS_TRACKERS) {
    const seen = new Set();
    const result = [];
    for (const url of [ownTrackerUrl, ...extraTrackers]) {
        if (typeof url !== 'string') continue;
        const trimmed = url.trim();
        if (!/^wss?:\/\//.test(trimmed) || seen.has(trimmed)) continue;
        seen.add(trimmed);
        result.push(trimmed);
    }
    return result;
}

/**
 * Ensure an RTC config always contains usable STUN servers. A config that
 * came back empty (Twilio not configured / fetch failed) previously left
 * WebRTC with no way to learn its public address on mobile data at all.
 * Populated configurations (including any TURN) are preserved unchanged.
 */
export function withFallbackIceServers(rtcConfig) {
    const existing = Array.isArray(rtcConfig?.iceServers) ? rtcConfig.iceServers : [];
    if (existing.length > 0) return rtcConfig;
    return { ...(rtcConfig || {}), iceServers: FALLBACK_ICE_SERVERS.map(server => ({ ...server })) };
}

export function hasTurnServer(rtcConfig) {
    const servers = Array.isArray(rtcConfig?.iceServers) ? rtcConfig.iceServers : [];
    return servers.some(server => urlsOf(server).some(url => typeof url === 'string' && url.startsWith('turn')));
}
