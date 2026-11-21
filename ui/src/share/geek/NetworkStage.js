import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { isSmallOnly } from '../gallery/arrivingText';
import PropTypes from 'prop-types';
import { useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CloseRounded from '@mui/icons-material/CloseRounded';
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';

import FileUtil from '../util/FileUtil';
import { buildScene, buildRouteGeometry, pointAlong, TIER } from './scene';
import { thumbProgress, copyCaption } from './mediaProgress';
import { ROUTE_STYLE } from './routeStyle';
import ServerCopies from './ServerCopies';
import { attachTraffic, flowAt, linkActivity, FLOW_MS, STALL_MS, RX, TX } from './traffic';
import { p2pIssues, wiredPeers, wantedPeers } from './p2pIssues';
import { deviceTimesLine, readSummary } from './sessionSummary';
import SessionSummary from './SessionSummary';
import { readTransfers, readServerCopies } from './transfers';
import { describeIceServers } from '../topology/NetworkInsight';
import { buildAnnounceList } from '../torrent/DiscoveryConfig';
import { watchLinks } from '../torrent/linkStats';
import { demoInputs, withDemoRoutes } from './tour';
import { posterFor, mediaUrlFor } from './videoPoster';
import { GRID_SIDE, smallImageOf, useSmallImage } from '../gallery/smallImage';
import { usePreview } from '../gallery/mediaView';
import PeerNameField from '../header/PeerNameField';

const mono = '"JetBrains Mono", "IBM Plex Mono", monospace';

// Re-exported: the transfer view and the legend share the map's colours.
export { ROUTE_STYLE };

const NODE_RGB = {
    device: '61,214,195',
    nat: '245,185,66',
    stun: '56,189,248',
    turn: '255,93,115',
    edge: '56,189,248',
    api: '96,165,250',
    tracker: '167,139,250',
    pubtracker: '251,146,60',
    copies: '232,121,249',
};

const INFRA_KINDS = new Set(['edge', 'api', 'tracker', 'copies']);

const ROUTE_EXPLAIN = {
    lan: ['Direct browser-to-browser WebRTC DataChannel on your local network.', 'Sees: only the two browsers (DTLS encrypted).'],
    punch: ['Direct browser-to-browser P2P via STUN-assisted NAT hole punching. Media does NOT pass through STUN.', 'Sees: only the two browsers (DTLS encrypted).'],
    relay: ['WebRTC DataChannel relayed through TURN because direct/hole-punch failed.', 'Sees: both IP addresses and encrypted DTLS bytes (TURN cannot read photos).'],
    stun: ['ICE discovery query to learn your public IP and port (srflx). No photo or media data uses STUN.', 'Sees: your public IP address and port only.'],
    turnctl: ['ICE Allocate control request reserving a relay address on TURN in case direct P2P fails.', 'Sees: your public IP address (no media until relay is chosen).'],
    tracker: ['Primary BitTorrent WebSocket tracker on photogroup.network for infohash announce and SDP offer/answer exchange.', 'Sees: infohashes and ICE candidates; never sees photos.'],
    pubtracker: ['Public fallback WebSocket trackers used alongside PhotoGroup tracker so peer discovery survives mobile socket drops.', 'Sees: infohashes and SDP offers/answers; never sees photos.'],
    sse: ['HTTPS REST & Server-Sent Events to photogroup.network for room membership, magnets, and metadata.', 'Sees: room state and metadata; never sees photos.'],
    copies: ['HTTPS temporary server copy fallback (8 MB resumable chunks, max 24 h) when P2P and TURN cannot connect.', 'Sees: the photo temporarily until all peers receive it or 24 h pass.'],
};

function inkRgb(rgb, isDark) {
    if (isDark) return rgb;
    return rgb.split(',').map(n => Math.max(20, Math.round(Number(n) * 0.68))).join(',');
}

function readTrackerStates(client) {
    const states = new Map();
    (client?.torrents || []).forEach(torrent => {
        const list = torrent?.discovery?.tracker?._trackers;
        if (!Array.isArray(list)) return;
        list.forEach(tracker => {
            const url = tracker?.announceUrl;
            if (!url) return;
            const connected = !!(!tracker.destroyed && tracker.socket?.connected);
            const waiting = !!(tracker.destroyed || tracker.reconnecting);
            const prev = states.get(url);
            if (!prev || connected) states.set(url, { connected, waiting });
        });
    });
    return states;
}

function trackerSignature(states) {
    if (!states || !states.size) return '';
    return [...states.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([url, st]) => `${url}:${st.connected ? 1 : 0}:${st.waiting ? 1 : 0}`)
        .join('|');
}

function readScene(master, tiles, width, height, demo = false) {
    const creator = master.creator || {};
    const trackerUrl = creator.trackerWsUrl || (Array.isArray(window.WEBTORRENT_ANNOUNCE) ? window.WEBTORRENT_ANNOUNCE[0] : '');
    const announceUrls = Array.isArray(window.WEBTORRENT_ANNOUNCE) && window.WEBTORRENT_ANNOUNCE.length
        ? window.WEBTORRENT_ANNOUNCE
        : buildAnnounceList(trackerUrl);
    const trackerStates = readTrackerStates(master.client);
    const inputs = {
        myPeerId: master.client?.peerId,
        peers: master.peers?.items || [],
        connections: master.peers?.connections || [],
        localNetwork: master.localNetwork,
        me: master.me || {},
        rtcConfig: creator.iceServers,
        trackerUrl,
        announceUrls,
        trackerStates,
        origin: window.location.origin,
        tiles,
        photos: master.roomPhotos?.all?.() || [],
        width,
        height,
    };
    // The tour needs someone to send to and public addresses to point at.
    const built = !demo ? buildScene(inputs) : withDemoRoutes(buildScene(demoInputs(inputs)), inputs.myPeerId);
    built.trackerSig = trackerSignature(trackerStates);
    return built;
}

// A link that should move and does not; a device P2P does not work with.
const STALLED_RGB = '245,158,11';
const ISSUE_RGB = '239,68,68';

/** What the map shows that changes faster than the scene: see liveNow. */
function readLive(master, scene) {
    const myPeerId = master.client?.peerId;
    const torrents = master.client?.torrents || [];
    const photos = master.roomPhotos?.all?.() || [];
    const known = { myPeerId, torrents, ledger: master.ledger, photoOf: infoHash => master.roomPhotos?.get?.(infoHash) };
    const progress = new Map();
    scene.thumbs.forEach(item => progress.set(item.key, thumbProgress(item, known)));
    const creator = master.creator || {};
    const trackerStates = readTrackerStates(master.client);
    const issues = p2pIssues({
        myPeerId,
        peers: master.peers?.items || [],
        photos,
        items: master.ledger?.all?.() || [],
        wired: wiredPeers(torrents),
        rtcConfig: creator.iceServers,
        localNetwork: master.localNetwork,
        hasTurn: describeIceServers(creator.iceServers).turn.length > 0,
        trackerStates,
        trackerUrl: creator.trackerWsUrl || '',
    });
    return { progress, issues, wanted: wantedPeers({ photos, myPeerId }), trackerSig: trackerSignature(trackerStates) };
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function polygon(ctx, x, y, r, sides, rotation) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
        const a = rotation + (Math.PI * 2 * i) / sides;
        const px = x + r * Math.cos(a);
        const py = y + r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
}

function drawChevron(ctx, x, y, angle, size, rgb, alpha) {
    const spread = 2.45;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
    ctx.lineTo(x + Math.cos(angle + spread) * size, y + Math.sin(angle + spread) * size);
    ctx.moveTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
    ctx.lineTo(x + Math.cos(angle - spread) * size, y + Math.sin(angle - spread) * size);
    ctx.strokeStyle = `rgba(${rgb},${alpha})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
}

function drawArrowhead(ctx, x, y, angle, size, rgb, alpha) {
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
    ctx.lineTo(x + Math.cos(angle + 2.4) * (size * 0.85), y + Math.sin(angle + 2.4) * (size * 0.85));
    ctx.lineTo(x + Math.cos(angle - 2.4) * (size * 0.85), y + Math.sin(angle - 2.4) * (size * 0.85));
    ctx.closePath();
    ctx.fillStyle = `rgba(${rgb},${alpha})`;
    ctx.fill();
}

function drawCardIcon(ctx, kind, cx, cy, rgb) {
    ctx.strokeStyle = `rgb(${rgb})`;
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.lineWidth = 1.4;
    if (kind === 'edge') {
        // Gateway diamond + ingress arrow
        polygon(ctx, cx, cy, 6, 4, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
        ctx.fill();
    } else if (kind === 'api') {
        // Three REST / SSE stream bars
        [-3.5, 0, 3.5].forEach((dy, i) => {
            ctx.beginPath();
            ctx.moveTo(cx - 5, cy + dy);
            ctx.lineTo(cx + (i === 1 ? 5 : 3), cy + dy);
            ctx.stroke();
        });
    } else if (kind === 'tracker' || kind === 'pubtracker') {
        // 3-node tracker hub
        const pts = [[cx, cy - 4.5], [cx - 4.5, cy + 3.5], [cx + 4.5, cy + 3.5]];
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        ctx.lineTo(pts[1][0], pts[1][1]);
        ctx.lineTo(pts[2][0], pts[2][1]);
        ctx.closePath();
        ctx.stroke();
        pts.forEach(([px, py]) => {
            ctx.beginPath();
            ctx.arc(px, py, 1.7, 0, Math.PI * 2);
            ctx.fill();
        });
    } else if (kind === 'copies') {
        // Storage vault / folder box
        roundRect(ctx, cx - 5, cy - 4.5, 10, 9, 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - 5, cy - 1);
        ctx.lineTo(cx + 5, cy - 1);
        ctx.stroke();
    }
}

// With reduced motion nothing moves on its own; a paused or scrubbed view is
// still drawn, because there the viewer asked for that one moment.
// One empty list, so a stage given no tiles doesn't rebuild its scene every render.
const NO_TILES = [];

// The last part of a crossing, when the receiving node shows it arriving.
const ARRIVE = 0.8;

const prefersReducedMotion = () => typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A route's label: its connection type (or kind), plus pieces and speed while
 * they move, or the stage a server copy is at.
 */
export function routeLabel(route, state, now = Date.now(), base = route.label) {
    if (state?.note) return [base, state.note].filter(Boolean).join(' · ');
    if (!state || now - (state.at || 0) > FLOW_MS) return base;
    const parts = [base];
    const stats = state.stats;
    if (stats && Number.isFinite(stats.rtt)) parts.push(`${Math.round(stats.rtt)} ms`);
    if (stats) parts.push(`↓ ${FileUtil.formatBytes(Math.round(stats.rx || 0))}/s ↑ ${FileUtil.formatBytes(Math.round(stats.tx || 0))}/s`);
    if (state.rx) parts.push(`↓ ${state.rx} pieces` + (state.rxSpeed && !stats ? ` ${state.rxSpeed}` : ''));
    if (state.tx) parts.push(`↑ ${state.tx} pieces` + (state.txSpeed && !stats ? ` ${state.txSpeed}` : ''));
    if (state.stalledMs) parts.push(`stalled ${Math.round(state.stalledMs / 1000)} s`);
    return parts.join(' · ');
}

/** `value` cut with an ellipsis to fit `max` pixels in the current font. */
function fit(ctx, value, max) {
    const full = String(value || '');
    if (ctx.measureText(full).width <= max) return full;
    let cut = full;
    while (cut.length > 1 && ctx.measureText(cut + '…').width > max) cut = cut.slice(0, -1);
    return cut + '…';
}

/** Width of a node's box, from its label; kept on the node for hit tests. */
function measureNode(ctx, node) {
    ctx.font = `600 11px ${mono}`;
    const label = ctx.measureText(node.label || '').width;
    ctx.font = `9px ${mono}`;
    const sub = ctx.measureText(node.sub || '').width;
    ctx.font = `700 7.5px ${mono}`;
    const badge = ctx.measureText(node.badge || '').width;
    if (INFRA_KINDS.has(node.kind) || node.kind === 'pubtracker') {
        const iconPad = 32;
        const minW = Math.min(102, node.maxW || 102);
        node.w = Math.min(node.maxW || 195, Math.max(minW, label + iconPad, sub + iconPad, badge + iconPad));
        node.h = node.kind === 'edge' ? 40 : 44;
        return node;
    }
    const pad = node.kind === 'device' ? 22 : 16;
    node.w = Math.min(node.maxW || 190, Math.max(node.kind === 'device' ? 96 : 84, label + pad, sub + pad));
    node.h = node.sub ? 36 : 26;
    return node;
}

function hitNode(node, x, y) {
    if (node.kind === 'nat' || node.kind === 'stun' || node.kind === 'turn') {
        return Math.hypot(node.x - x, node.y - y) < 25 || (Math.abs(node.x - x) < (node.w || 90) / 2 && Math.abs(node.y + 30 - y) < 16);
    }
    return Math.abs(node.x - x) <= (node.w || 90) / 2 && Math.abs(node.y - y) <= (node.h || 30) / 2 + 4;
}

function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (!lenSq) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function hitRoute(routes, geometry, x, y) {
    let best = null;
    let bestDist = 9;
    for (let r = routes.length - 1; r >= 0; r--) {
        const route = routes[r];
        const pts = geometry.get(route.id);
        if (!pts || pts.length < 2) continue;
        for (let i = 1; i < pts.length; i++) {
            const d = distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
            if (d < bestDist) {
                bestDist = d;
                best = route;
            }
        }
    }
    return best;
}

function boxesOverlap(a, b, pad = 4) {
    return !(a.x + a.w / 2 + pad < b.x - b.w / 2
        || a.x - a.w / 2 - pad > b.x + b.w / 2
        || a.y + a.h / 2 + pad < b.y - b.h / 2
        || a.y - a.h / 2 - pad > b.y + b.h / 2);
}

function routeTouchesNode(route, nodeId) {
    return route.path.includes(nodeId);
}

function sameHit(a, b) {
    if (!a && !b) return true;
    if (!a || !b || a.type !== b.type) return false;
    if (a.type === 'thumb') return a.key != null && a.key === b.key;
    return a.id != null && a.id === b.id;
}

/** A tile we can show full size: a still image, or media the torrent can stream. */
export function canOpen(tile) {
    return !!(tile && (tile.img || tile.elem || tile.file || tile.torrentFile));
}

/** Re-render on a timer, for chrome that reads the moving clock. */
function useTicker(ms) {
    const [, bump] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => bump(value => value + 1), ms);
        return () => clearInterval(timer);
    }, [ms]);
}

const perSecond = bytes => `${FileUtil.formatBytes(Math.round(bytes))}/s`;

/**
 * On the map, while it is not live: the moment it shows, and what crossed
 * the wire in the second up to it.
 */
function PausedMark({ timeline, replaying, aboveTour = false }) {
    useTicker(replaying ? 200 : 1000);
    const rate = timeline.meter ? timeline.meter() : null;
    return (
        <Typography data-testid="paused-mark" sx={{
            position: 'absolute', left: 8, bottom: aboveTour ? 44 : 8, pointerEvents: 'none',
            fontFamily: mono, fontSize: '0.62rem', letterSpacing: '0.08em',
            px: 0.75, py: 0.25, borderRadius: 1, border: 1, borderColor: 'warning.main', color: 'warning.main',
            bgcolor: 'background.paper',
        }}>
            {replaying ? `replay ${timeline.speed}×` : 'held'} · {new Date(timeline.clock()).toLocaleTimeString()}
            {rate && (
                <Box component="span" data-testid="wire-meter" sx={{ color: 'text.secondary', ml: 0.75, display: { xs: 'none', sm: 'inline' } }}>
                    <Box component="span" sx={{ color: `rgb(${RX})` }}>{`▼ ${perSecond(rate.rx)}`}</Box>
                    {' '}
                    <Box component="span" sx={{ color: `rgb(${TX})` }}>{`▲ ${perSecond(rate.tx)}`}</Box>
                    {` · ${Math.round(rate.events)} ev/s`}
                </Box>
            )}
        </Typography>
    );
}

PausedMark.propTypes = { timeline: PropTypes.object.isRequired, replaying: PropTypes.bool, aboveTour: PropTypes.bool };

const LEGEND_GROUPS = [
    { keys: ['lan', 'punch', 'relay'] },
    { keys: ['stun', 'turnctl', 'pubtracker'] },
    { keys: ['tracker', 'sse', 'copies'] },
];

/**
 * The geek view: the whole room as a live network diagram. Packets travel
 * the routes they really take; photos sit under the devices that hold them.
 */
function NetworkStage({ master, tiles = NO_TILES, onOpenPhoto, timeline, playback, tour = null, onScene }) {
    const shown = playback || timeline;
    const theme = useTheme();
    const isDark = theme.palette.mode === 'dark';
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const imagesRef = useRef(new Map());
    const sceneRef = useRef(null);
    const geometryRef = useRef(new Map());
    const trackerSigRef = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [version, setVersion] = useState(0);
    const [selected, setSelected] = useState(null);
    const [hovered, setHovered] = useState(null);
    const [paused, setPaused] = useState(!shown.playing);
    const [replaying, setReplaying] = useState(!!shown.replaying);

    useEffect(() => {
        const read = () => {
            setPaused(!shown.playing);
            setReplaying(!!shown.replaying);
        };
        read();
        return shown.subscribeClock(read);
    }, [shown]);

    // Rebuild whenever the room or trackers change shape.
    useEffect(() => {
        const emitter = master.emitter;
        const bump = () => setVersion(value => value + 1);
        const names = ['peers', 'peerConnections', 'localNetwork', 'photos', 'addPeerDone', 'serverCopy', 'wtInitialized', 'trackerStatus'];
        names.forEach(name => emitter.on(name, bump));
        return () => names.forEach(name => emitter.removeListener(name, bump));
    }, [master.emitter]);

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return undefined;
        const measure = () => {
            const rect = element.getBoundingClientRect();
            setSize(prev => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }));
        };
        measure();
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measure);
            return () => window.removeEventListener('resize', measure);
        }
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const touring = !!tour;
    const demo = touring && tour.demo !== false;
    const scene = useMemo(
        () => readScene(master, tiles, size.width || 800, size.height || 600, demo),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [master, tiles, size.width, size.height, version, demo]);
    sceneRef.current = scene;
    trackerSigRef.current = scene.trackerSig;
    useEffect(() => { onScene?.(scene); }, [scene, onScene]);

    const spotlight = useMemo(() => (tour?.step
        ? { nodes: new Set(tour.step.nodes || []), routes: new Set(tour.step.routes || []) }
        : null), [tour?.step]);

    useEffect(() => attachTraffic({
        timeline,
        emitter: master.emitter,
        getScene: () => sceneRef.current,
        getMyId: () => master.client?.peerId,
    }), [master, timeline]);

    useEffect(() => (master.client ? watchLinks({ client: master.client, emitter: master.emitter }) : undefined),
        [master.client, master.emitter]);

    const image = useCallback((url) => {
        if (!url) return null;
        const cache = imagesRef.current;
        if (!cache.has(url)) {
            const img = new Image();
            img.src = url;
            cache.set(url, img);
        }
        const img = cache.get(url);
        return img.complete && img.naturalWidth ? img : null;
    }, []);

    // Draw.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !size.width) return undefined;
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;
        const dpr = window.devicePixelRatio || 1;
        const { width, height } = size;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const text = isDark ? '#e8eef6' : '#141820';
        const muted = isDark ? 'rgba(232,238,246,0.60)' : 'rgba(20,24,32,0.62)';
        const faint = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
        const cardSurface = isDark ? 'rgba(13,18,28,0.92)' : 'rgba(255,255,255,0.96)';
        const pillBg = isDark ? 'rgba(13,18,28,0.92)' : 'rgba(255,255,255,0.95)';

        scene.nodes.forEach(node => measureNode(ctx, node));
        const pointsOf = buildRouteGeometry(scene);
        geometryRef.current = pointsOf;
        const routeById = new Map(scene.routes.map(route => [route.id, route]));

        let liveRead = -Infinity;
        let live = { progress: new Map(), issues: new Map(), wanted: new Set(), trackerSig: scene.trackerSig };
        const liveNow = () => {
            const now = performance.now();
            if (now - liveRead > 300) {
                liveRead = now;
                live = readLive(master, scene);
                if (live.trackerSig !== scene.trackerSig && trackerSigRef.current !== live.trackerSig) {
                    trackerSigRef.current = live.trackerSig;
                    setVersion(value => value + 1);
                }
            }
            return live;
        };
        const progressNow = thumb => liveNow().progress.get(thumb.key) || null;

        // Interactive focus from hover or selection (node or route).
        const focusNodeId = (hovered?.type === 'node' ? hovered.id : null)
            || (selected?.type === 'node' ? selected.id : null);
        const focusRouteId = (hovered?.type === 'route' ? hovered.id : null)
            || (selected?.type === 'route' ? selected.id : null);
        const hasFocus = !!(focusNodeId || focusRouteId);

        let frame;
        let running = true;
        const draw = () => {
            if (!running) return;
            ctx.clearRect(0, 0, width, height);
            shown.tick?.();
            const at = shown.clock();
            const moving = !prefersReducedMotion() || !shown.playing;
            const focus = shown.shown();
            const focused = new Set(focus ? focus.flights.map(flight => flight.routeId) : []);
            liveNow();

            // Tier guides aligned with actual computed tier positions.
            const natNode = scene.nodes.find(n => n.kind === 'nat');
            const devNode = scene.nodes.find(n => n.kind === 'device');
            const netGuideY = natNode ? natNode.y : height * TIER.net;
            const devGuideY = devNode ? devNode.y : height * TIER.device;
            const bands = [
                ['internet · discovery · relays', netGuideY],
                ['devices · photos they hold', devGuideY],
            ];
            bands.forEach(([label, y]) => {
                ctx.strokeStyle = faint;
                ctx.lineWidth = 1;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
                ctx.font = `9px ${mono}`;
                ctx.fillStyle = muted;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'bottom';
                ctx.fillText(label.toUpperCase(), width - 10, y - 4);
            });

            // The photogroup.network infrastructure enclosure.
            const rack = scene.nodes.filter(node => INFRA_KINDS.has(node.kind));
            if (rack.length) {
                const left = Math.min(...rack.map(node => node.x - node.w / 2)) - 14;
                const right = Math.max(...rack.map(node => node.x + node.w / 2)) + 14;
                const top = Math.min(...rack.map(node => node.y - node.h / 2)) - 26;
                const bottom = Math.max(...rack.map(node => node.y + node.h / 2)) + 12;
                roundRect(ctx, left, top, right - left, bottom - top, 12);
                ctx.fillStyle = isDark ? 'rgba(15,23,42,0.52)' : 'rgba(239,246,255,0.72)';
                ctx.fill();
                ctx.strokeStyle = `rgba(${inkRgb(NODE_RGB.edge, isDark)},${isDark ? 0.42 : 0.45})`;
                ctx.lineWidth = 1.25;
                ctx.setLineDash([]);
                ctx.stroke();

                // Enclosure header pill & environment tag.
                const headerLabel = 'PHOTOGROUP.NETWORK';
                ctx.font = `700 9px ${mono}`;
                const pillW = ctx.measureText(headerLabel).width + 14;
                roundRect(ctx, left + 10, top + 6, pillW, 15, 5);
                ctx.fillStyle = `rgba(${inkRgb(NODE_RGB.edge, isDark)},${isDark ? 0.18 : 0.14})`;
                ctx.fill();
                ctx.fillStyle = `rgb(${inkRgb(NODE_RGB.edge, isDark)})`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(headerLabel, left + 17, top + 13.5);

                const isLocal = scene.byId.get('edge')?.label === 'dev server';
                ctx.font = `8px ${mono}`;
                ctx.fillStyle = muted;
                ctx.textAlign = 'right';
                ctx.fillText(isLocal ? 'LOCAL DEV STACK' : 'CLOUD · TLS', right - 12, top + 13.5);
            }

            // Collect node boxes to keep route labels from colliding with them.
            const placedBoxes = scene.nodes.map(node => ({
                x: node.x,
                y: node.y + (node.kind === 'nat' || node.kind === 'stun' || node.kind === 'turn' ? 12 : 0),
                w: node.w || 64,
                h: node.h || 56,
            }));

            // Routes: curved and lane-offset, with directional chevrons and de-collided labels.
            const pendingLabels = [];
            scene.routes.forEach(route => {
                const style = ROUTE_STYLE[route.kind];
                if (!style) return;
                const spot = spotlight ? spotlight.routes.has(route.id) : false;
                const lit = focused.has(route.id) || spot;
                let flow = flowAt(shown.entries, route.id, at);
                const other = route.peers ? route.peers.find(id => id !== master.client?.peerId) : null;
                if (other && liveNow().wanted.has(other)) {
                    const activity = linkActivity(shown.entries, route.id, at);
                    if (activity.measuredAt !== null && at - activity.measuredAt < STALL_MS && activity.since !== null && at - activity.since >= STALL_MS) {
                        flow = { ...(flow || {}), at, stalledMs: at - activity.since };
                    }
                }
                const isInteractive = focusRouteId === route.id || (focusNodeId && routeTouchesNode(route, focusNodeId));
                if ((style.hidden || route.demo) && !lit && !flow?.note && !isInteractive) return;
                const points = pointsOf.get(route.id);
                if (!points || points.length < 2) return;

                const transfer = !!route.peers;
                ctx.beginPath();
                points.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
                ctx.setLineDash(style.dash);
                const busy = flow?.stats ? Math.min(5, Math.log2(1 + ((flow.stats.rx || 0) + (flow.stats.tx || 0)) / 16384)) : 0;
                ctx.lineWidth = (lit || isInteractive ? style.width + 1.5 : style.width) + busy;

                let strength = lit || isInteractive ? 1 : transfer || style.hidden ? 0.8 : 0.42;
                if (spotlight && !spot) strength *= 0.25;
                else if (hasFocus && !isInteractive && !lit) strength *= 0.28;

                const baseRgb = flow?.stalledMs ? STALLED_RGB : style.rgb;
                const lineRgb = inkRgb(baseRgb, isDark);
                if (flow?.stalledMs) ctx.setLineDash([6, 4]);
                ctx.strokeStyle = `rgba(${lineRgb},${strength})`;
                ctx.stroke();
                ctx.setLineDash([]);

                // Subtle directional chevrons along visible routes so flow direction is clear at rest.
                if (strength >= 0.35) {
                    const drawDir = (tPos, reverseDir = false) => {
                        const a = pointAlong(points, Math.max(0, tPos - 0.02));
                        const b = pointAlong(points, Math.min(1, tPos + 0.02));
                        const ang = Math.atan2(b.y - a.y, b.x - a.x) + (reverseDir ? Math.PI : 0);
                        const midPt = pointAlong(points, tPos);
                        drawChevron(ctx, midPt.x, midPt.y, ang, 4.5, lineRgb, Math.min(0.95, strength + 0.1));
                    };
                    if (route.kind === 'stun' || transfer) {
                        drawDir(0.32, false);
                        drawDir(0.68, true);
                    } else if (route.kind === 'sse') {
                        drawDir(0.55, true);
                    } else {
                        drawDir(0.55, false);
                    }
                }

                const showLabel = (transfer || route.demo || isInteractive) && (!spotlight || spot);
                const base = showLabel ? (route.label || style.label) : flow?.note ? style.label : null;
                if (base) {
                    pendingLabels.push({ route, points, flow, base, lineRgb, transfer, isInteractive, lit });
                }
            });

            // Paint route labels with collision avoidance against nodes and prior pills.
            pendingLabels.sort((a, b) => Number(b.isInteractive || b.lit) - Number(a.isInteractive || a.lit)
                || Number(b.transfer) - Number(a.transfer));
            const labelCandidates = [0.5, 0.38, 0.62, 0.28, 0.72];
            const infraCandidates = [0.74, 0.60, 0.46, 0.84];
            pendingLabels.forEach(({ route, points, flow, base, lineRgb, transfer, isInteractive }) => {
                ctx.font = `9px ${mono}`;
                const label = routeLabel(route, flow, at, base);
                const w = ctx.measureText(label).width + 12;
                const h = 16;
                const tries = transfer || route.demo || isInteractive ? labelCandidates : infraCandidates;
                let chosen = pointAlong(points, tries[0]);
                for (let i = 0; i < tries.length; i++) {
                    const pt = pointAlong(points, tries[i]);
                    const box = { x: pt.x, y: pt.y, w, h };
                    if (!placedBoxes.some(existing => boxesOverlap(box, existing, 3))) {
                        chosen = pt;
                        break;
                    }
                }
                placedBoxes.push({ x: chosen.x, y: chosen.y, w, h });
                roundRect(ctx, chosen.x - w / 2, chosen.y - h / 2, w, h, 4);
                ctx.fillStyle = pillBg;
                ctx.fill();
                ctx.strokeStyle = `rgba(${lineRgb},${isInteractive ? 0.85 : 0.45})`;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.fillStyle = `rgb(${lineRgb})`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, chosen.x, chosen.y);
            });

            // Packets, with directional arrowheads and what they carry.
            if (moving) {
                shown.inFlight(at).forEach(packet => {
                    const route = routeById.get(packet.routeId);
                    if (!route) return;
                    const all = pointsOf.get(route.id);
                    if (!all || all.length < 2) return;
                    const points = packet.reverse ? all.slice().reverse() : all;
                    const here = pointAlong(points, packet.progress);
                    const tail = pointAlong(points, Math.max(0, packet.progress - 0.06));
                    const rawRgb = packet.rgb || ROUTE_STYLE[route.kind]?.rgb || '255,255,255';
                    const rgb = inkRgb(rawRgb, isDark);
                    const alpha = Math.min(1, Math.sin(Math.min(1, packet.progress) * Math.PI) * 1.4 + 0.25);
                    ctx.strokeStyle = `rgba(${rgb},${alpha * 0.55})`;
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.moveTo(tail.x, tail.y);
                    ctx.lineTo(here.x, here.y);
                    ctx.stroke();
                    const angle = Math.atan2(here.y - tail.y, here.x - tail.x);
                    drawArrowhead(ctx, here.x, here.y, angle, 5.5, rgb, alpha);
                    if (packet.progress > ARRIVE) {
                        const end = points[points.length - 1];
                        const k = (packet.progress - ARRIVE) / (1 - ARRIVE);
                        ctx.beginPath();
                        ctx.arc(end.x, end.y, 6 + k * 16, 0, Math.PI * 2);
                        ctx.strokeStyle = `rgba(${rgb},${(1 - k) * 0.6})`;
                        ctx.lineWidth = 1.5;
                        ctx.stroke();
                    }
                    if (packet.label) {
                        ctx.font = `600 9px ${mono}`;
                        ctx.fillStyle = `rgba(${rgb},${alpha})`;
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'bottom';
                        ctx.fillText(packet.label, here.x + 8, here.y - 4);
                    }
                });
            }

            // Nodes.
            scene.nodes.forEach(node => {
                const rawRgb = NODE_RGB[node.kind] || '200,200,200';
                const rgb = inkRgb(rawRgb, isDark);
                const isSelected = selected?.type === 'node' && selected.id === node.id;
                const isHovered = hovered?.type === 'node' && hovered.id === node.id;
                const spot = spotlight?.nodes.has(node.id);
                const routeRelated = focusRouteId && routeById.get(focusRouteId)?.path?.includes(node.id);

                let alpha = node.idle ? 0.65 : 1;
                if (spotlight && !spot) alpha *= 0.28;
                else if (hasFocus && !isSelected && !isHovered && !routeRelated && !(focusNodeId && scene.routes.some(r => r.path.includes(focusNodeId) && r.path.includes(node.id)))) {
                    alpha *= 0.55;
                }
                ctx.globalAlpha = alpha;

                if ((spot && spotlight.nodes.size < scene.nodes.length) || isHovered || isSelected) {
                    if (node.w && node.kind !== 'nat' && node.kind !== 'stun' && node.kind !== 'turn') {
                        roundRect(ctx, node.x - node.w / 2 - 6, node.y - node.h / 2 - 6, node.w + 12, node.h + 12, 11);
                    } else {
                        ctx.beginPath();
                        ctx.arc(node.x, node.y, 28, 0, Math.PI * 2);
                    }
                    ctx.fillStyle = `rgba(${rgb},0.14)`;
                    ctx.fill();
                    ctx.strokeStyle = `rgba(${rgb},0.65)`;
                    ctx.lineWidth = 1.25;
                    ctx.stroke();
                }

                const dash = node.example || node.idle ? [4, 3] : [];

                if (node.kind === 'nat') {
                    polygon(ctx, node.x, node.y, 19, 6, 0);
                    ctx.fillStyle = cardSurface;
                    ctx.fill();
                    ctx.fillStyle = `rgba(${rgb},0.16)`;
                    ctx.fill();
                    ctx.strokeStyle = `rgba(${rgb},${isSelected ? 1 : 0.85})`;
                    ctx.lineWidth = isSelected ? 2.5 : 1.6;
                    ctx.setLineDash(dash);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.font = `700 8px ${mono}`;
                    ctx.fillStyle = `rgb(${rgb})`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('NAT', node.x, node.y - (node.natType === 'symmetric' || node.natType === 'cone' ? 3 : 0));
                    if (node.natType === 'symmetric' || node.natType === 'cone') {
                        ctx.font = `700 6.5px ${mono}`;
                        ctx.fillText(node.natType === 'symmetric' ? 'SYM' : 'CONE', node.x, node.y + 6);
                    }

                    ctx.font = `600 10px ${mono}`;
                    ctx.fillStyle = text;
                    ctx.fillText(node.label, node.x, node.y + 28);
                    if (node.sub) {
                        ctx.font = `9px ${mono}`;
                        ctx.fillStyle = muted;
                        ctx.fillText(fit(ctx, node.sub, 150), node.x, node.y + 40);
                    }
                    ctx.globalAlpha = 1;
                    return;
                }

                if (node.kind === 'stun') {
                    // Double-ring radar badge for STUN ICE discovery.
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, 21, 0, Math.PI * 2);
                    ctx.fillStyle = cardSurface;
                    ctx.fill();
                    ctx.strokeStyle = `rgba(${rgb},0.65)`;
                    ctx.lineWidth = 1.25;
                    ctx.setLineDash([3, 3]);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.beginPath();
                    ctx.arc(node.x, node.y, 15, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(${rgb},0.16)`;
                    ctx.fill();
                    ctx.strokeStyle = `rgba(${rgb},${isSelected ? 1 : 0.9})`;
                    ctx.lineWidth = isSelected ? 2.5 : 1.5;
                    ctx.stroke();

                    ctx.font = `700 8px ${mono}`;
                    ctx.fillStyle = `rgb(${rgb})`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('STUN', node.x, node.y);

                    ctx.font = `700 7.5px ${mono}`;
                    ctx.fillText(node.badge || 'ICE DISCOVERY', node.x, node.y - 28);
                    // Match NAT: descriptive primary (provider/host), ICE host secondary.
                    ctx.font = `600 9.5px ${mono}`;
                    ctx.fillStyle = text;
                    ctx.fillText(fit(ctx, node.label || 'STUN', 140), node.x, node.y + 30);
                    if (node.sub) {
                        ctx.font = `8.5px ${mono}`;
                        ctx.fillStyle = muted;
                        ctx.fillText(fit(ctx, node.sub, 140), node.x, node.y + 41);
                    }
                    ctx.globalAlpha = 1;
                    return;
                }

                if (node.kind === 'turn') {
                    // Rotated diamond relay badge for TURN.
                    polygon(ctx, node.x, node.y, 20, 4, Math.PI / 4);
                    ctx.fillStyle = cardSurface;
                    ctx.fill();
                    ctx.fillStyle = `rgba(${rgb},${node.idle ? 0.08 : 0.18})`;
                    ctx.fill();
                    ctx.strokeStyle = `rgba(${rgb},${isSelected ? 1 : 0.85})`;
                    ctx.lineWidth = isSelected ? 2.5 : 1.6;
                    ctx.setLineDash(dash);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    if (!node.idle) {
                        polygon(ctx, node.x, node.y, 14, 4, Math.PI / 4);
                        ctx.strokeStyle = `rgba(${rgb},0.45)`;
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }

                    ctx.font = `700 8px ${mono}`;
                    ctx.fillStyle = `rgb(${rgb})`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('TURN', node.x, node.y);

                    ctx.font = `700 7.5px ${mono}`;
                    ctx.fillText(node.badge || 'MEDIA RELAY', node.x, node.y - 27);
                    // Match NAT: descriptive primary (provider/place), host secondary.
                    ctx.font = `600 9.5px ${mono}`;
                    ctx.fillStyle = text;
                    ctx.fillText(fit(ctx, node.label || 'TURN', 140), node.x, node.y + 29);
                    if (node.sub) {
                        ctx.font = `8.5px ${mono}`;
                        ctx.fillStyle = muted;
                        ctx.fillText(fit(ctx, node.sub, 140), node.x, node.y + 40);
                    }
                    ctx.globalAlpha = 1;
                    return;
                }

                if (INFRA_KINDS.has(node.kind) || node.kind === 'pubtracker') {
                    const { w, h } = node;
                    const left = node.x - w / 2;
                    const top = node.y - h / 2;
                    roundRect(ctx, left, top, w, h, 8);
                    ctx.fillStyle = cardSurface;
                    ctx.fill();
                    ctx.fillStyle = `rgba(${rgb},0.10)`;
                    ctx.fill();
                    ctx.strokeStyle = `rgba(${rgb},${isSelected || isHovered ? 1 : 0.78})`;
                    ctx.lineWidth = isSelected ? 2.5 : 1.4;
                    ctx.setLineDash(dash);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // Left colored accent stripe inside card.
                    ctx.save();
                    roundRect(ctx, left, top, w, h, 8);
                    ctx.clip();
                    roundRect(ctx, left, top, 4, h, 0);
                    ctx.fillStyle = `rgb(${rgb})`;
                    ctx.fill();
                    ctx.restore();

                    // Icon on the left.
                    drawCardIcon(ctx, node.kind, left + 16, node.y + 2, rgb);

                    // Role badge + label + subtitle aligned to icon's right.
                    const textX = left + 27;
                    const maxTextW = Math.max(24, w - 34);
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.font = `700 7.5px ${mono}`;
                    ctx.fillStyle = `rgb(${rgb})`;
                    ctx.fillText(fit(ctx, node.badge || node.kind.toUpperCase(), maxTextW), textX, top + 9);

                    if (node.status) {
                        ctx.beginPath();
                        ctx.arc(left + w - 8, top + 9, 2.7, 0, Math.PI * 2);
                        ctx.fillStyle = node.status === 'connected' ? `rgb(${inkRgb(ROUTE_STYLE.lan.rgb, isDark)})` : `rgb(${inkRgb('245,158,11', isDark)})`;
                        ctx.fill();
                    }

                    ctx.font = `600 10.5px ${mono}`;
                    ctx.fillStyle = text;
                    ctx.fillText(fit(ctx, node.label, maxTextW), textX, node.y + 2);

                    if (node.sub) {
                        ctx.font = `8.5px ${mono}`;
                        ctx.fillStyle = muted;
                        ctx.fillText(fit(ctx, node.sub, maxTextW), textX, top + h - 8);
                    }
                    ctx.globalAlpha = 1;
                    return;
                }

                // Device card.
                const { w, h } = node;
                roundRect(ctx, node.x - w / 2, node.y - h / 2, w, h, 7);
                ctx.fillStyle = cardSurface;
                ctx.fill();
                ctx.fillStyle = `rgba(${rgb},${node.isMe ? 0.18 : 0.08})`;
                ctx.fill();
                ctx.strokeStyle = `rgba(${rgb},${isSelected || node.isMe ? 1 : 0.72})`;
                ctx.lineWidth = isSelected ? 2.5 : node.isMe ? 2 : 1.1;
                ctx.setLineDash(dash);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = `600 11px ${mono}`;
                ctx.fillStyle = text;
                ctx.fillText(fit(ctx, node.label, w - 10), node.x, node.y - (node.sub ? 6 : 0));
                if (node.sub) {
                    ctx.font = `9px ${mono}`;
                    ctx.fillStyle = muted;
                    ctx.fillText(fit(ctx, node.sub, w - 10), node.x, node.y + 8);
                }
                const issue = node.kind === 'device' ? liveNow().issues.get(node.id) : null;
                if (issue) {
                    ctx.font = `600 9px ${mono}`;
                    const textW = Math.min(ctx.measureText('✕ ' + issue.short).width, Math.max(w, (node.maxW || 140) - 10));
                    roundRect(ctx, node.x - textW / 2 - 5, node.y + h / 2 + 3, textW + 10, 14, 4);
                    ctx.fillStyle = isDark ? 'rgba(60,16,22,0.92)' : 'rgba(255,236,238,0.95)';
                    ctx.fill();
                    ctx.fillStyle = `rgb(${ISSUE_RGB})`;
                    ctx.textBaseline = 'middle';
                    ctx.fillText(fit(ctx, '✕ ' + issue.short, textW), node.x, node.y + h / 2 + 10);
                }
                ctx.globalAlpha = 1;
            });

            // Photos under the devices holding them.
            scene.thumbs.forEach(thumb => {
                const { x, y, size: s, tile } = thumb;
                const isSelected = selected?.type === 'thumb' && selected.key === thumb.key;
                ctx.globalAlpha = spotlight && !spotlight.nodes.has(thumb.deviceId) ? 0.28 : 1;
                const source = smallImageOf(tile) || posterFor(tile) || tile.img;
                const img = source ? image(source) : null;
                ctx.save();
                roundRect(ctx, x - s / 2, y - s / 2, s, s, 6);
                ctx.clip();
                if (img) {
                    const scale = Math.max(s / img.naturalWidth, img.naturalHeight ? s / img.naturalHeight : 1);
                    const iw = img.naturalWidth * scale;
                    const ih = (img.naturalHeight || s) * scale;
                    ctx.drawImage(img, x - iw / 2, y - ih / 2, iw, ih);
                } else if (tile.isVideo) {
                    ctx.fillStyle = 'rgba(9,12,18,0.92)';
                    ctx.fillRect(x - s / 2, y - s / 2, s, s);
                    ctx.fillStyle = `rgba(${RX},0.9)`;
                    ctx.beginPath();
                    ctx.moveTo(x - s * 0.14, y - s * 0.2);
                    ctx.lineTo(x - s * 0.14, y + s * 0.2);
                    ctx.lineTo(x + s * 0.2, y);
                    ctx.closePath();
                    ctx.fill();
                } else {
                    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
                    ctx.fillRect(x - s / 2, y - s / 2, s, s);
                }
                if (thumb.more) {
                    ctx.fillStyle = 'rgba(0,0,0,0.55)';
                    ctx.fillRect(x - s / 2, y - s / 2, s, s);
                    ctx.font = `600 11px ${mono}`;
                    ctx.fillStyle = '#fff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('+' + thumb.more, x, y);
                }
                ctx.restore();
                roundRect(ctx, x - s / 2, y - s / 2, s, s, 6);
                ctx.lineWidth = isSelected ? 2.5 : 1;
                ctx.strokeStyle = isSelected ? `rgb(${NODE_RGB.device})` : (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)');
                ctx.stroke();
                const progress = thumb.more ? null : progressNow(thumb);
                if (progress) {
                    roundRect(ctx, x - s / 2, y - s / 2, s, s, 6);
                    ctx.fillStyle = 'rgba(9,12,18,0.55)';
                    ctx.fill();
                    const rgb = progress.via === 'server' ? NODE_RGB.copies : RX;
                    const r = s / 2 - 4;
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
                    ctx.lineWidth = 3;
                    ctx.stroke();
                    if (progress.value !== null) {
                        ctx.beginPath();
                        ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress.value);
                        ctx.strokeStyle = `rgb(${rgb})`;
                        ctx.stroke();
                    }
                    ctx.font = `700 ${s < 32 ? 8 : 10}px ${mono}`;
                    ctx.fillStyle = '#fff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(progress.value === null ? '…' : Math.floor(progress.value * 100) + '%', x, y);
                }
                const caption = thumb.copy ? copyCaption(thumb.copy, master.roomPhotos?.get?.(tile.infoHash) || tile)
                    : progress?.via === 'server' && thumb.deviceId !== 'copies' ? 'server' : null;
                if (caption) {
                    ctx.font = `7px ${mono}`;
                    ctx.fillStyle = `rgb(${inkRgb(NODE_RGB.copies, isDark)})`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillText(caption, x, y + s / 2 + 3);
                }
            });

            ctx.globalAlpha = 1;
            frame = requestAnimationFrame(draw);
        };
        draw();
        return () => {
            running = false;
            cancelAnimationFrame(frame);
        };
    }, [scene, size, isDark, selected, hovered, image, shown, spotlight, master]);

    const hitAt = useCallback((clientX, clientY) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const current = sceneRef.current;
        const thumb = current.thumbs.find(item => Math.abs(item.x - x) <= item.size / 2 + 3 && Math.abs(item.y - y) <= item.size / 2 + 3);
        if (thumb) return { type: 'thumb', key: thumb.key };
        const node = current.nodes.find(item => hitNode(item, x, y));
        if (node) return { type: 'node', id: node.id };
        const route = hitRoute(current.routes, geometryRef.current, x, y);
        if (route) return { type: 'route', id: route.id };
        return null;
    }, []);

    const handlePointer = useCallback((event) => {
        const hit = hitAt(event.clientX, event.clientY);
        if (hit?.type === 'thumb') {
            if (selected?.type === 'thumb' && selected.key === hit.key) {
                setSelected(null);
                const thumbItem = sceneRef.current.thumbs.find(item => item.key === hit.key);
                if (thumbItem) onOpenPhoto(thumbItem.tileKey);
            } else {
                setSelected({ type: 'thumb', key: hit.key });
            }
            return;
        }
        setSelected(hit);
    }, [hitAt, selected, onOpenPhoto]);

    const handleMove = useCallback((event) => {
        const hit = hitAt(event.clientX, event.clientY);
        setHovered(prev => (sameHit(prev, hit) ? prev : hit));
    }, [hitAt]);

    const handleDrop = useCallback((event) => {
        event.preventDefault();
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return;
        master.emitter.emit('filesSelected', files);
    }, [master.emitter]);

    const thumb = selected?.type === 'thumb' ? scene.thumbs.find(item => item.key === selected.key) : null;
    const node = selected?.type === 'node' ? scene.byId.get(selected.id) : null;
    const selectedRoute = selected?.type === 'route' ? scene.routes.find(item => item.id === selected.id) : null;
    const copiesOpen = node?.kind === 'copies';
    const [, tickCopies] = useState(0);
    useEffect(() => {
        if (!copiesOpen) return undefined;
        const timer = setInterval(() => tickCopies(value => value + 1), 30000);
        return () => clearInterval(timer);
    }, [copiesOpen]);
    const others = scene.nodes.filter(item => item.kind === 'device' && !item.isMe).length;

    const mediaKeys = useMemo(() => {
        const seen = new Set();
        const keys = [];
        scene.thumbs.forEach(item => {
            if (seen.has(item.tileKey)) return;
            seen.add(item.tileKey);
            keys.push(item.tileKey);
        });
        return keys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scene]);
    const stepMedia = offset => {
        const at = mediaKeys.indexOf(thumb?.tileKey);
        if (at < 0 || mediaKeys.length < 2) return;
        const next = mediaKeys[(at + offset + mediaKeys.length) % mediaKeys.length];
        const target = scene.thumbs.find(item => item.tileKey === next);
        if (target) setSelected({ type: 'thumb', key: target.key });
    };
    const openFull = key => {
        setSelected(null);
        onOpenPhoto(key);
    };

    const [closedSummary, setClosedSummary] = useState(null);
    const share = master.deviceTimes?.summary?.();
    const summary = share?.done && share.endedAt !== closedSummary ? readSummary({
        rows: readTransfers({
            items: master.ledger?.all?.() || [],
            torrents: master.client?.torrents || [],
            photos: master.roomPhotos?.all?.() || [],
            peers: master.peers?.items || [],
            connections: master.peers?.connections || [],
            myPeerId: master.client?.peerId,
        }),
        share,
        devices: master.deviceTimes.read(),
        peers: master.peers?.items || [],
        myPeerId: master.client?.peerId,
        rtcConfig: master.creator?.iceServers,
        trackerUrl: master.creator?.trackerWsUrl,
        announceUrls: Array.isArray(window.WEBTORRENT_ANNOUNCE) ? window.WEBTORRENT_ANNOUNCE : undefined,
    }) : null;

    const narrow = (size.width || 800) < 760;
    const myNode = scene.byId.get(master.client?.peerId) || scene.nodes.find(item => item.kind === 'device');
    const aloneTop = myNode ? Math.max(18, myNode.y - 54) : `calc(${TIER.device * 100}% - 64px)`;

    const arrival = useMemo(() => {
        const total = tiles.length;
        if (!total) return null;
        const here = tiles.filter(tile => !tile.loading).length;
        if (here === total) return null;
        const sum = tiles.reduce((acc, tile) => acc + (tile.loading ? tile.torrentFile?.progress || 0 : 1), 0);
        return { here, total, percent: Math.round(sum / total * 100) };
    }, [tiles]);

    return (
        <Box
            ref={containerRef}
            onDragOver={event => event.preventDefault()}
            onDrop={handleDrop}
            sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
        >
            <canvas
                ref={canvasRef}
                data-testid="network-stage"
                onPointerDown={handlePointer}
                onPointerMove={handleMove}
                onPointerLeave={() => setHovered(null)}
                style={{ display: 'block', width: '100%', height: '100%', touchAction: 'manipulation', cursor: hovered ? 'pointer' : 'default' }}
            />

            {/* Grouped, theme-aware legend in the bottom-right corner. */}
            <Box
                data-testid="network-legend"
                sx={{
                    position: 'absolute', bottom: 8, right: 8, pointerEvents: 'none',
                    display: tour && size.width < 640 ? 'none' : 'flex',
                    flexDirection: 'column', gap: narrow ? 0.25 : 0.4,
                    maxWidth: narrow && !tour ? 'calc(100% - 172px)' : 'calc(100% - 16px)',
                    px: narrow ? 0.75 : 1, py: narrow ? 0.45 : 0.6, borderRadius: 1.5, border: 1, borderColor: 'divider',
                    bgcolor: isDark ? 'rgba(13,17,24,0.82)' : 'rgba(255,255,255,0.88)',
                }}
            >
                {LEGEND_GROUPS.map((group, gIdx) => (
                    <Stack key={gIdx} direction="row" spacing={narrow ? 0.6 : 1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end', rowGap: 0.2 }}>
                        {group.keys.map(kind => {
                            const style = ROUTE_STYLE[kind];
                            if (!style) return null;
                            const rgb = inkRgb(style.rgb, isDark);
                            return (
                                <Stack key={kind} direction="row" spacing={0.4} sx={{ alignItems: 'center' }}>
                                    <Box sx={{ width: narrow ? 10 : 13, height: 0, borderTop: `${Math.max(2, style.width)}px ${style.dash.length ? 'dashed' : 'solid'} rgb(${rgb})` }} />
                                    <Typography sx={{ fontFamily: mono, fontSize: narrow ? '0.52rem' : '0.57rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                                        {style.label}
                                    </Typography>
                                </Stack>
                            );
                        })}
                    </Stack>
                ))}
                <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                    <Typography sx={{ fontFamily: mono, fontSize: narrow ? '0.5rem' : '0.56rem', color: 'text.secondary' }}>bytes in / out</Typography>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: `rgb(${inkRgb(RX, isDark)})` }} />
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: `rgb(${inkRgb(TX, isDark)})` }} />
                </Stack>
            </Box>

            {others === 0 && !tour && (
                <Typography sx={{
                    position: 'absolute', left: 8, right: 8, top: aloneTop, textAlign: 'center',
                    fontFamily: mono, fontSize: narrow ? '0.64rem' : '0.7rem', color: 'text.secondary', pointerEvents: 'none',
                }}>
                    alone in this room · Invite someone to see the path between you
                </Typography>
            )}

            {arrival && (
                <Stack direction="row" spacing={0.75} data-testid="room-progress" sx={{
                    position: 'absolute', right: 8, top: 8, alignItems: 'center', pointerEvents: 'none',
                    px: 0.75, py: 0.4, borderRadius: 1, border: 1, borderColor: 'divider',
                    bgcolor: 'background.paper', fontFamily: mono,
                }}>
                    <Typography sx={{ fontFamily: mono, fontSize: '0.62rem', color: 'text.secondary' }}>
                        {`${arrival.here} of ${arrival.total} here`}
                    </Typography>
                    <Box sx={{ width: 46, height: 4, borderRadius: 4, bgcolor: 'action.hover', overflow: 'hidden' }}>
                        <Box sx={{ width: `${arrival.percent}%`, height: '100%', bgcolor: `rgb(${RX})` }} />
                    </Box>
                    <Typography sx={{ fontFamily: mono, fontSize: '0.62rem', color: `rgb(${inkRgb(RX, isDark)})`, fontWeight: 700 }}>
                        {`${arrival.percent}%`}
                    </Typography>
                </Stack>
            )}

            {paused && (
                <PausedMark timeline={shown} replaying={replaying} aboveTour={narrow && !tour} />
            )}

            {summary && !tour && !node && !thumb && !selectedRoute && (
                <Box sx={{ position: 'absolute', left: 8, top: 8, zIndex: 1, maxWidth: 'calc(100% - 16px)' }}>
                    <SessionSummary summary={summary} onClose={() => setClosedSummary(summary.key)} />
                </Box>
            )}

            {/* An enlarged photo, next to where it sits. */}
            {thumb && (
                <Box
                    className="glass"
                    data-testid="thumb-preview"
                    sx={{
                        position: 'absolute',
                        left: Math.min(Math.max(8, thumb.x - 110), Math.max(8, (size.width || 800) - 228)),
                        top: Math.max(8, thumb.y - thumb.size / 2 - 300),
                        width: 'min(220px, calc(100% - 16px))',
                        maxHeight: 'calc(100% - 16px)',
                        overflow: 'auto',
                        p: 1,
                        borderRadius: 2,
                        border: 1,
                        borderColor: 'divider',
                        bgcolor: 'background.paper',
                        boxShadow: 6,
                    }}
                >
                    {thumb.tile.isVideo && canOpen(thumb.tile) ? (
                        <Box
                            component="video"
                            src={mediaUrlFor(thumb.tile) || undefined}
                            poster={posterFor(thumb.tile) || undefined}
                            controls
                            muted
                            playsInline
                            sx={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 1, display: 'block', bgcolor: '#0a0c10' }}
                        />
                    ) : (
                        <CardPicture tile={thumb.tile} onOpen={() => thumb.tile.img && openFull(thumb.tileKey)} />
                    )}
                    <Box sx={{ mt: 0.75, fontFamily: mono, fontSize: '0.62rem', lineHeight: 1.5, color: 'text.secondary', wordBreak: 'break-all' }}>
                        <Box sx={{ color: 'text.primary', fontWeight: 600 }}>{thumb.tile.fileName || 'photo'}</Box>
                        {[thumb.tile.fileSize, thumb.tile.fileType].filter(Boolean).join(' · ')}
                        <br />
                        {thumb.tile.infoHash ? `infohash ${String(thumb.tile.infoHash).slice(0, 20)}…` : null}
                        <br />
                        {`held by ${(thumb.tile.owners || []).length || 1} · ${isSmallOnly(thumb.tile) ? 'small size only (by camera)' : thumb.tile.loading ? 'arriving' : 'here in full'}`}
                        {thumb.tile.hasServerCopy ? ' · server copy' : ''}
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ mt: 0.75 }}>
                        <Button size="small" variant="contained" startIcon={<OpenInFullRounded />} disabled={!canOpen(thumb.tile)}
                            onClick={() => openFull(thumb.tileKey)} sx={{ textTransform: 'none', flex: 1 }}>
                            Open full size
                        </Button>
                        <IconButton size="small" aria-label="Previous photo" onClick={() => stepMedia(-1)}
                            disabled={mediaKeys.length < 2}>
                            <ArrowBackRounded fontSize="small" />
                        </IconButton>
                        <Box component="span" sx={{ alignSelf: 'center', fontFamily: mono, fontSize: '0.62rem', color: 'text.disabled' }}>
                            {mediaKeys.length > 1 ? `${mediaKeys.indexOf(thumb.tileKey) + 1}/${mediaKeys.length}` : ''}
                        </Box>
                        <IconButton size="small" aria-label="Next photo" onClick={() => stepMedia(1)}
                            disabled={mediaKeys.length < 2}>
                            <ArrowForwardRounded fontSize="small" />
                        </IconButton>
                        <IconButton size="small" aria-label="Close preview" onClick={() => setSelected(null)}>
                            <CloseRounded fontSize="small" />
                        </IconButton>
                    </Stack>
                </Box>
            )}

            {/* What we know about a node. */}
            {node && (
                <Box
                    className="glass"
                    data-testid="node-details"
                    sx={{
                        position: 'absolute', left: 8, top: 8, maxWidth: 'min(300px, calc(100% - 16px))', maxHeight: 'calc(100% - 16px)', overflow: 'auto', p: 1.25, borderRadius: 2,
                        border: 1, borderColor: 'divider', bgcolor: 'background.paper', boxShadow: 6,
                    }}
                >
                    <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }}>
                        <Typography sx={{ flex: 1, fontFamily: mono, fontSize: '0.72rem', fontWeight: 700 }}>
                            {node.label.toLowerCase().includes(node.kind) ? node.label : `${node.kind.toUpperCase()} · ${node.label}`}
                        </Typography>
                        <IconButton size="small" aria-label="Close details" onClick={() => setSelected(null)}>
                            <CloseRounded fontSize="small" />
                        </IconButton>
                    </Stack>
                    {(node.info || []).map((line, index) => (
                        <Typography key={index} sx={{ fontFamily: mono, fontSize: '0.64rem', color: 'text.secondary', lineHeight: 1.55, overflowWrap: 'anywhere' }}>
                            {line}
                        </Typography>
                    ))}
                    {node.kind === 'device' && (
                        <Typography sx={{ fontFamily: mono, fontSize: '0.64rem', color: 'text.secondary', lineHeight: 1.55 }}>
                            {`photos held ${node.mediaCount || 0}`}
                        </Typography>
                    )}
                    {node.kind === 'device' && (() => {
                        const times = master.deviceTimes?.read?.().find(row => row.peerId === node.id);
                        const line = times && deviceTimesLine(times);
                        return line ? (
                            <Typography data-testid="device-times" sx={{ fontFamily: mono, fontSize: '0.64rem', color: 'text.primary', lineHeight: 1.55 }}>
                                {line}
                            </Typography>
                        ) : null;
                    })()}
                    {node.kind === 'device' && (readLive(master, scene).issues.get(node.id)?.why || []).map((line, index) => (
                        <Typography key={'issue' + index} data-testid="p2p-issue" sx={{ fontFamily: mono, fontSize: '0.64rem', color: 'error.main', lineHeight: 1.55 }}>
                            {`P2P · ${line}`}
                        </Typography>
                    ))}
                    {node.kind === 'device' && node.isMe && (
                        <PeerNameField master={master} compact hint="Shown to everyone in the room." />
                    )}
                    {node.kind === 'copies' && (
                        <Box sx={{ mt: 0.75, mx: -1.25, borderTop: 1, borderColor: 'divider' }}>
                            <ServerCopies copies={readServerCopies({
                                photos: master.roomPhotos?.all?.() || [],
                                peers: master.peers?.items || [],
                                myPeerId: master.client?.peerId,
                                keepCopies: !!master.serverPinning?.keepCopies,
                            })} />
                        </Box>
                    )}
                </Box>
            )}

            {/* What a clicked route carries and who sees it. */}
            {selectedRoute && (
                <Box
                    className="glass"
                    data-testid="route-details"
                    sx={{
                        position: 'absolute', left: 8, top: 8, maxWidth: 'min(300px, calc(100% - 16px))', maxHeight: 'calc(100% - 16px)', overflow: 'auto', p: 1.25, borderRadius: 2,
                        border: 1, borderColor: 'divider', bgcolor: 'background.paper', boxShadow: 6,
                    }}
                >
                    <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }}>
                        <Typography sx={{ flex: 1, fontFamily: mono, fontSize: '0.72rem', fontWeight: 700, color: `rgb(${inkRgb(ROUTE_STYLE[selectedRoute.kind]?.rgb || '200,200,200', isDark)})` }}>
                            {ROUTE_STYLE[selectedRoute.kind]?.label || selectedRoute.kind}
                        </Typography>
                        <IconButton size="small" aria-label="Close route details" onClick={() => setSelected(null)}>
                            <CloseRounded fontSize="small" />
                        </IconButton>
                    </Stack>
                    <Typography sx={{ fontFamily: mono, fontSize: '0.64rem', color: 'text.primary', lineHeight: 1.55, mb: 0.5, overflowWrap: 'anywhere' }}>
                        {selectedRoute.path.map(id => scene.byId.get(id)?.label || id).join(' → ')}
                    </Typography>
                    {(ROUTE_EXPLAIN[selectedRoute.kind] || []).map((line, index) => (
                        <Typography key={index} sx={{ fontFamily: mono, fontSize: '0.64rem', color: 'text.secondary', lineHeight: 1.55, overflowWrap: 'anywhere' }}>
                            {line}
                        </Typography>
                    ))}
                </Box>
            )}
        </Box>
    );
}

NetworkStage.propTypes = {
    playback: PropTypes.object,
    tour: PropTypes.object,
    onScene: PropTypes.func,
    master: PropTypes.object.isRequired,
    tiles: PropTypes.array.isRequired,
    onOpenPhoto: PropTypes.func.isRequired,
    timeline: PropTypes.object.isRequired,
};

function CardPicture({ tile, onOpen }) {
    const poster = usePreview(tile);
    const copy = useSmallImage(tile.isImage && !tile.loading ? tile : null, GRID_SIDE);
    const src = copy || poster || null;
    return (
        <Box
            component={src ? 'img' : 'div'}
            src={src || undefined}
            alt={tile.fileName || 'Photo'}
            onClick={onOpen}
            sx={{
                width: '100%', height: 150, objectFit: 'cover', borderRadius: 1, display: 'block',
                bgcolor: 'action.hover', cursor: tile.img ? 'zoom-in' : 'default',
            }}
        />
    );
}

CardPicture.propTypes = { tile: PropTypes.object.isRequired, onOpen: PropTypes.func.isRequired };

export default NetworkStage;
