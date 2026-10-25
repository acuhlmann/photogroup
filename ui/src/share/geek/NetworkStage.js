import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
import { captureDroppedHandles } from '../gallery/replaceOriginal';
import { buildScene, routePoints, pointAlong, TIER } from './scene';
import { attachTraffic, flowAt, FLOW_MS, RX, TX } from './traffic';
import { demoInputs, withDemoRoutes } from './tour';
import { posterFor, mediaUrlFor } from './videoPoster';
import PeerNameField from '../header/PeerNameField';

const mono = '"JetBrains Mono", "IBM Plex Mono", monospace';

// One colour per kind of traffic, used for routes, packets and the legend.
export const ROUTE_STYLE = {
    sse: { rgb: '96,165,250', label: 'SSE / API', dash: [3, 5], width: 1 },
    tracker: { rgb: '167,139,250', label: 'tracker', dash: [3, 5], width: 1 },
    copies: { rgb: '232,121,249', label: 'server copy', dash: [2, 6], width: 1, hidden: true },
    stun: { rgb: '148,163,184', label: 'STUN', dash: [1, 4], width: 1 },
    lan: { rgb: '61,222,139', label: 'P2P same LAN', dash: [], width: 3 },
    punch: { rgb: '45,212,191', label: 'P2P via NAT', dash: [], width: 2.5 },
    relay: { rgb: '255,93,115', label: 'TURN relay', dash: [], width: 2.5 },
};

const NODE_RGB = {
    device: '61,214,195', nat: '245,185,66', stun: '148,163,184', turn: '255,93,115',
    edge: '96,165,250', api: '96,165,250', tracker: '167,139,250', copies: '232,121,249',
};

function readScene(master, tiles, width, height, demo = false) {
    const creator = master.creator || {};
    const inputs = {
        myPeerId: master.client?.peerId,
        peers: master.peers?.items || [],
        connections: master.peers?.connections || [],
        localNetwork: master.localNetwork,
        me: master.me || {},
        rtcConfig: creator.iceServers,
        trackerUrl: creator.trackerWsUrl || (Array.isArray(window.WEBTORRENT_ANNOUNCE) ? window.WEBTORRENT_ANNOUNCE[0] : ''),
        origin: window.location.origin,
        tiles,
        photos: master.roomPhotos?.all?.() || [],
        width,
        height,
    };
    // The tour needs someone to send to and public addresses to point at.
    if (!demo) return buildScene(inputs);
    return withDemoRoutes(buildScene(demoInputs(inputs)), inputs.myPeerId);
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
    if (state.rx) parts.push(`↓ ${state.rx} pieces` + (state.rxSpeed ? ` ${state.rxSpeed}` : ''));
    if (state.tx) parts.push(`↑ ${state.tx} pieces` + (state.txSpeed ? ` ${state.txSpeed}` : ''));
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
    const pad = node.kind === 'device' ? 20 : 16;
    node.w = Math.min(node.maxW || 190, Math.max(node.kind === 'device' ? 96 : 84, label + pad, sub + pad));
    node.h = node.sub ? 36 : 26;
    return node;
}

function hitNode(node, x, y) {
    if (node.kind === 'nat' || node.kind === 'stun' || node.kind === 'turn') {
        return Math.hypot(node.x - x, node.y - y) < 24 || (Math.abs(node.x - x) < (node.w || 80) / 2 && Math.abs(node.y + 30 - y) < 14);
    }
    return Math.abs(node.x - x) <= (node.w || 90) / 2 && Math.abs(node.y - y) <= (node.h || 30) / 2 + 4;
}

/** A tile we can show full size: a still image, or media the torrent can stream. */
export function canOpen(tile) {
    return !!(tile && (tile.img || tile.elem || tile.file || tile.torrentFile));
}

/**
 * The geek view: the whole room as a live network diagram. Packets travel
 * the routes they really take; photos sit under the devices that hold them.
 * Tap a photo to enlarge it, tap it again (or Open) to see it in full.
 * The traffic it draws comes from `timeline`, which the footer logs the same
 * recording of — so pausing holds every label in place to be read.
 */
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
 * the wire in the second up to it. The bar above the map meters live traffic;
 * this meters the held or replayed moment.
 */
function PausedMark({ timeline, replaying }) {
    useTicker(replaying ? 200 : 1000);
    const rate = timeline.meter ? timeline.meter() : null;
    return (
        <Typography data-testid="paused-mark" sx={{
            position: 'absolute', left: 8, bottom: 8, pointerEvents: 'none',
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

PausedMark.propTypes = { timeline: PropTypes.object.isRequired, replaying: PropTypes.bool };

/**
 * `timeline` records the room's traffic; `playback` is what is drawn (the
 * tour plays its own), and `tour` — the step on screen — switches to the
 * tour's scene and dims everything that step is not about.
 */
function NetworkStage({ master, tiles = NO_TILES, onOpenPhoto, timeline, playback, tour = null, onScene }) {
    const shown = playback || timeline;
    const theme = useTheme();
    const isDark = theme.palette.mode === 'dark';
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const imagesRef = useRef(new Map());
    const sceneRef = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [version, setVersion] = useState(0);
    const [selected, setSelected] = useState(null);
    // The drawing reads the playhead every frame, so only the chrome that says
    // "held" needs re-rendering when it moves — not the canvas.
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

    // Rebuild whenever the room changes shape.
    useEffect(() => {
        const emitter = master.emitter;
        const bump = () => setVersion(value => value + 1);
        const names = ['peers', 'peerConnections', 'localNetwork', 'photos', 'addPeerDone'];
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
    // The example tour brings example peers and addresses; a replay shows the real room.
    const demo = touring && tour.demo !== false;
    const scene = useMemo(
        () => readScene(master, tiles, size.width || 800, size.height || 600, demo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
        [master, tiles, size.width, size.height, version, demo]);
    sceneRef.current = scene;
    useEffect(() => { onScene?.(scene); }, [scene, onScene]);

    // What the tour's step is about; everything else is drawn faint.
    const spotlight = useMemo(() => (tour?.step
        ? { nodes: new Set(tour.step.nodes || []), routes: new Set(tour.step.routes || []) }
        : null), [tour?.step]);

    // Record the room's traffic into the shared timeline; the footer logs it.
    useEffect(() => attachTraffic({
        timeline,
        emitter: master.emitter,
        getScene: () => sceneRef.current,
        getMyId: () => master.client?.peerId,
    }), [master, timeline]);

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
        const muted = isDark ? 'rgba(232,238,246,0.55)' : 'rgba(20,24,32,0.55)';
        const faint = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
        scene.nodes.forEach(node => measureNode(ctx, node));
        // Route geometry only changes with the scene, so resolve it once here.
        const pointsOf = new Map();
        const routeById = new Map();
        scene.routes.forEach(route => {
            routeById.set(route.id, route);
            pointsOf.set(route.id, routePoints(scene, route));
        });

        let frame;
        let running = true;
        const draw = () => {
            if (!running) return;
            ctx.clearRect(0, 0, width, height);
            // A replay that has caught up with the room is live from here on.
            shown.tick?.();
            // The moment on screen: the live edge, or wherever the playhead sits.
            const at = shown.clock();
            const moving = !prefersReducedMotion() || !shown.playing;
            const focus = shown.shown();
            const focused = new Set(focus ? focus.flights.map(flight => flight.routeId) : []);

            // Tiers, so position reads as role.
            const bands = [
                ['photogroup.network', TIER.infra],
                ['internet · NAT · STUN · TURN', TIER.net],
                ['devices · photos they hold', TIER.device],
            ];
            bands.forEach(([label, bandY]) => {
                const y = height * bandY;
                ctx.strokeStyle = faint;
                ctx.lineWidth = 1;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
                ctx.font = `9px ${mono}`;
                ctx.fillStyle = muted;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                ctx.fillText(label.toUpperCase(), 8, y - 30);
            });

            // The photogroup.network rack.
            const rack = scene.nodes.filter(node => ['edge', 'api', 'tracker', 'copies'].includes(node.kind));
            if (rack.length) {
                const left = Math.min(...rack.map(node => node.x - node.w / 2)) - 10;
                const right = Math.max(...rack.map(node => node.x + node.w / 2)) + 10;
                const top = Math.min(...rack.map(node => node.y - node.h / 2)) - 12;
                const bottom = Math.max(...rack.map(node => node.y + node.h / 2)) + 12;
                roundRect(ctx, left, top, right - left, bottom - top, 10);
                ctx.strokeStyle = `rgba(${NODE_RGB.api},0.35)`;
                ctx.setLineDash([4, 4]);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = `rgba(${NODE_RGB.api},0.04)`;
                ctx.fill();
            }

            // Routes: signalling faint, transfers bold. The one the playhead is
            // parked on is lit up, so a stepped event shows the path it took.
            scene.routes.forEach(route => {
                const style = ROUTE_STYLE[route.kind];
                if (!style) return;
                const spot = spotlight ? spotlight.routes.has(route.id) : false;
                const lit = focused.has(route.id) || spot;
                const flow = flowAt(shown.entries, route.id, at);
                // Server copies are the exception: drawn only while one is
                // moving. The tour's own paths only when a step is about them.
                if ((style.hidden || route.demo) && !lit && !flow?.note) return;
                const points = pointsOf.get(route.id);
                if (points.length < 2) return;
                const transfer = !!route.peers;
                const base = (transfer || route.demo) && (!spotlight || spot) ? route.label
                    : flow?.note ? style.label : null;
                ctx.beginPath();
                points.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
                ctx.setLineDash(style.dash);
                ctx.lineWidth = lit ? style.width + 1.5 : style.width;
                const strength = lit ? 1 : transfer || style.hidden ? 0.75 : 0.28;
                ctx.strokeStyle = `rgba(${style.rgb},${spotlight && !spot ? strength * 0.25 : strength})`;
                ctx.stroke();
                ctx.setLineDash([]);
                if (base) {
                    // Signalling routes share their first legs; label a copy near its end.
                    const mid = pointAlong(points, transfer || route.demo ? 0.5 : 0.78);
                    ctx.font = `9px ${mono}`;
                    const label = routeLabel(route, flow, at, base);
                    const w = ctx.measureText(label).width + 10;
                    roundRect(ctx, mid.x - w / 2, mid.y - 8, w, 16, 4);
                    ctx.fillStyle = isDark ? 'rgba(16,20,28,0.9)' : 'rgba(255,255,255,0.92)';
                    ctx.fill();
                    ctx.fillStyle = `rgb(${style.rgb})`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(label, mid.x, mid.y);
                }
            });

            // Packets, with what they carry. Placed by the clock, so a paused
            // map keeps every dot and its label exactly where it was.
            if (moving) {
                shown.inFlight(at).forEach(packet => {
                    const route = routeById.get(packet.routeId);
                    if (!route) return;
                    const all = pointsOf.get(route.id);
                    if (all.length < 2) return;
                    const points = packet.reverse ? all.slice().reverse() : all;
                    const here = pointAlong(points, packet.progress);
                    const tail = pointAlong(points, Math.max(0, packet.progress - 0.06));
                    const rgb = packet.rgb || ROUTE_STYLE[route.kind]?.rgb || '255,255,255';
                    const alpha = Math.min(1, Math.sin(Math.min(1, packet.progress) * Math.PI) * 1.4 + 0.2);
                    ctx.strokeStyle = `rgba(${rgb},${alpha * 0.5})`;
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.moveTo(tail.x, tail.y);
                    ctx.lineTo(here.x, here.y);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.arc(here.x, here.y, 3.5, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(${rgb},${alpha})`;
                    ctx.fill();
                    // Arriving: a ring opens on the node that receives it.
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
                        ctx.font = `9px ${mono}`;
                        ctx.fillStyle = `rgba(${rgb},${alpha})`;
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'bottom';
                        ctx.fillText(packet.label, here.x + 6, here.y - 4);
                    }
                });
            }

            // Nodes.
            scene.nodes.forEach(node => {
                const rgb = NODE_RGB[node.kind] || '200,200,200';
                const isSelected = selected?.type === 'node' && selected.id === node.id;
                const spot = spotlight?.nodes.has(node.id);
                // Faint: not what the tour's step is about, or a TURN that
                // is not there. Dashed: an example standing in for the tour.
                ctx.globalAlpha = (spotlight && !spot ? 0.28 : 1) * (node.idle ? 0.6 : 1);
                // A glow around what the step is about, hugging its shape.
                if (spot && spotlight.nodes.size < scene.nodes.length) {
                    if (node.w && node.kind !== 'nat' && node.kind !== 'stun' && node.kind !== 'turn') {
                        roundRect(ctx, node.x - node.w / 2 - 7, node.y - node.h / 2 - 7, node.w + 14, node.h + 14, 11);
                    } else {
                        ctx.beginPath();
                        ctx.arc(node.x, node.y, 27, 0, Math.PI * 2);
                    }
                    ctx.fillStyle = `rgba(${rgb},0.16)`;
                    ctx.fill();
                    ctx.strokeStyle = `rgba(${rgb},0.55)`;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
                const dash = node.example || node.idle ? [4, 3] : [];
                if (node.kind === 'nat' || node.kind === 'stun' || node.kind === 'turn') {
                    polygon(ctx, node.x, node.y, 17, node.kind === 'nat' ? 6 : 4, node.kind === 'nat' ? 0 : Math.PI / 4);
                    ctx.fillStyle = `rgba(${rgb},0.14)`;
                    ctx.fill();
                    ctx.strokeStyle = `rgba(${rgb},${isSelected ? 1 : 0.8})`;
                    ctx.lineWidth = isSelected ? 2.5 : 1.5;
                    ctx.setLineDash(dash);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.font = `600 8px ${mono}`;
                    ctx.fillStyle = `rgb(${rgb})`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(node.kind.toUpperCase(), node.x, node.y);
                    ctx.font = `10px ${mono}`;
                    ctx.fillStyle = text;
                    ctx.fillText(node.label, node.x, node.y + 26);
                    if (node.sub) {
                        ctx.font = `9px ${mono}`;
                        ctx.fillStyle = muted;
                        ctx.fillText(fit(ctx, node.sub, 150), node.x, node.y + 38);
                    }
                    ctx.globalAlpha = 1;
                    return;
                }
                const { w, h } = node;
                roundRect(ctx, node.x - w / 2, node.y - h / 2, w, h, 7);
                ctx.fillStyle = `rgba(${rgb},${node.isMe ? 0.2 : 0.1})`;
                ctx.fill();
                ctx.strokeStyle = `rgba(${rgb},${isSelected || node.isMe ? 1 : 0.7})`;
                ctx.lineWidth = isSelected ? 2.5 : node.isMe ? 2 : 1;
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
                ctx.globalAlpha = 1;
            });

            // Photos under the devices holding them.
            scene.thumbs.forEach(thumb => {
                const { x, y, size: s, tile } = thumb;
                const isSelected = selected?.type === 'thumb' && selected.key === thumb.key;
                ctx.globalAlpha = spotlight && !spotlight.nodes.has(thumb.deviceId) ? 0.28 : 1;
                // The preview that came with the share counts even when this
                // device holds no bytes of its own - which is exactly the case
                // for the server's shelf, where most of it is other people's.
                const source = tile.img || tile.previewUrl || posterFor(tile);
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
                    // No poster yet: say plainly that this is a video, rather
                    // than a grey box that reads like a broken image.
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
                // Still arriving: a ring fills up as pieces land.
                const progress = tile.loading && tile.torrentFile ? tile.torrentFile.progress || 0 : null;
                if (progress !== null) {
                    ctx.beginPath();
                    ctx.arc(x, y, s / 2 - 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
                    ctx.strokeStyle = `rgb(${RX})`;
                    ctx.lineWidth = 3;
                    ctx.stroke();
                    ctx.font = `8px ${mono}`;
                    ctx.fillStyle = text;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(Math.round(progress * 100) + '%', x, y);
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
    }, [scene, size, isDark, selected, image, shown, spotlight]);

    const handlePointer = useCallback((event) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const current = sceneRef.current;
        const thumb = current.thumbs.find(item => Math.abs(item.x - x) <= item.size / 2 + 3 && Math.abs(item.y - y) <= item.size / 2 + 3);
        if (thumb) {
            // First tap enlarges, a second tap on the same photo opens it in full.
            if (selected?.type === 'thumb' && selected.key === thumb.key) {
                setSelected(null);
                onOpenPhoto(thumb.tileKey);
            } else {
                setSelected({ type: 'thumb', key: thumb.key });
            }
            return;
        }
        const node = current.nodes.find(item => hitNode(item, x, y));
        setSelected(node ? { type: 'node', id: node.id } : null);
    }, [selected, onOpenPhoto]);

    const handleDrop = useCallback((event) => {
        event.preventDefault();
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return;
        // Like the gallery: keep file handles so an edit can later replace the original.
        captureDroppedHandles(event.dataTransfer).then(() => master.emitter.emit('filesSelected', files));
    }, [master.emitter]);

    const thumb = selected?.type === 'thumb' ? scene.thumbs.find(item => item.key === selected.key) : null;
    const node = selected?.type === 'node' ? scene.byId.get(selected.id) : null;
    const others = scene.nodes.filter(item => item.kind === 'device' && !item.isMe).length;

    // The media on the map, once each, in the order they are drawn: the detail
    // card walks this list, so it flips through the room like simple mode does.
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
    // Opening the full viewer closes this card: left open, its own player sits
    // behind the dialog on a desktop, so the same clip shows two control bars.
    const openFull = key => {
        setSelected(null);
        onOpenPhoto(key);
    };

    // How much of the room this device has, in one number. The per-photo ring
    // says which one is moving; this says how far to go before the room is
    // all here, which is what a waiting person actually reads.
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
                style={{ display: 'block', width: '100%', height: '100%', touchAction: 'manipulation', cursor: 'pointer' }}
            />

            {/* Legend, in the empty space under the devices; on a phone the
                tour's map needs that space more. */}
            <Stack spacing={0.4} sx={{ position: 'absolute', bottom: 8, right: 8, pointerEvents: 'none', display: tour && size.width < 640 ? 'none' : 'flex' }}>
                {Object.entries(ROUTE_STYLE).map(([kind, style]) => (
                    <Stack key={kind} direction="row" spacing={0.75} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                        <Typography sx={{ fontFamily: mono, fontSize: '0.6rem', color: 'text.secondary' }}>{style.label}</Typography>
                        <Box sx={{ width: 16, height: 0, borderTop: `${Math.max(2, style.width)}px ${style.dash.length ? 'dashed' : 'solid'} rgb(${style.rgb})` }} />
                    </Stack>
                ))}
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                    <Typography sx={{ fontFamily: mono, fontSize: '0.6rem', color: 'text.secondary' }}>bytes in / out</Typography>
                    <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: `rgb(${RX})` }} />
                    <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: `rgb(${TX})` }} />
                </Stack>
            </Stack>

            {others === 0 && !tour && (
                <Typography sx={{
                    position: 'absolute', left: 0, right: 0, top: `calc(${TIER.device * 100}% - 64px)`, textAlign: 'center',
                    fontFamily: mono, fontSize: '0.7rem', color: 'text.secondary', pointerEvents: 'none',
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
                    <Typography sx={{ fontFamily: mono, fontSize: '0.62rem', color: `rgb(${RX})`, fontWeight: 700 }}>
                        {`${arrival.percent}%`}
                    </Typography>
                </Stack>
            )}

            {paused && (
                <PausedMark timeline={shown} replaying={replaying} />
            )}


            {/* An enlarged photo, next to where it sits. */}
            {thumb && (
                <Box
                    className="glass"
                    data-testid="thumb-preview"
                    sx={{
                        position: 'absolute',
                        left: Math.min(Math.max(8, thumb.x - 110), Math.max(8, size.width - 228)),
                        top: Math.max(8, thumb.y - thumb.size / 2 - 300),
                        width: 220,
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
                            // The clip this device holds, played here rather than only in
                            // the viewer; a device without it falls back to the poster.
                            src={mediaUrlFor(thumb.tile) || undefined}
                            poster={posterFor(thumb.tile) || undefined}
                            controls
                            muted
                            playsInline
                            sx={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 1, display: 'block', bgcolor: '#0a0c10' }}
                        />
                    ) : (
                        <Box
                            component={thumb.tile.img ? 'img' : 'div'}
                            src={thumb.tile.img || undefined}
                            alt={thumb.tile.fileName || 'Photo'}
                            onClick={() => thumb.tile.img && openFull(thumb.tileKey)}
                            sx={{
                                width: '100%', height: 150, objectFit: 'cover', borderRadius: 1, display: 'block',
                                bgcolor: 'action.hover', cursor: thumb.tile.img ? 'zoom-in' : 'default',
                            }}
                        />
                    )}
                    <Box sx={{ mt: 0.75, fontFamily: mono, fontSize: '0.62rem', lineHeight: 1.5, color: 'text.secondary', wordBreak: 'break-all' }}>
                        <Box sx={{ color: 'text.primary', fontWeight: 600 }}>{thumb.tile.fileName || 'photo'}</Box>
                        {[thumb.tile.fileSize, thumb.tile.fileType].filter(Boolean).join(' · ')}
                        <br />
                        {thumb.tile.infoHash ? `infohash ${String(thumb.tile.infoHash).slice(0, 20)}…` : null}
                        <br />
                        {`held by ${(thumb.tile.owners || []).length || 1} · ${thumb.tile.loading ? 'arriving' : 'here in full'}`}
                        {thumb.tile.hasServerCopy ? ' · server copy' : ''}
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ mt: 0.75 }}>
                        <Button size="small" variant="contained" startIcon={<OpenInFullRounded />} disabled={!canOpen(thumb.tile)}
                            onClick={() => openFull(thumb.tileKey)} sx={{ textTransform: 'none', flex: 1 }}>
                            Open full size
                        </Button>
                        {/* Flip to the next and previous thing in the room, the way
                            simple mode's viewer does, without leaving the map. */}
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
                        position: 'absolute', left: 8, top: 8, maxWidth: 300, maxHeight: 'calc(100% - 16px)', overflow: 'auto', p: 1.25, borderRadius: 2,
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
                    {/* This device's own node is where the name gets changed:
                        it is what the map and the log call you, and there was
                        no way to set it from the map at all. */}
                    {node.kind === 'device' && node.isMe && (
                        <PeerNameField master={master} compact hint="Shown to everyone in the room." />
                    )}
                    {node.kind === 'copies' && (
                        <Typography sx={{ fontFamily: mono, fontSize: '0.64rem', color: 'text.secondary', lineHeight: 1.55 }}>
                            {node.mediaCount ? `holding ${node.mediaCount} of them` : 'holding none of them'}
                        </Typography>
                    )}
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

export default NetworkStage;
