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

import { captureDroppedHandles } from '../gallery/replaceOriginal';
import { buildScene, routePoints, pointAlong, transferRoutesFor, TIER } from './scene';

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
const RX = '61,222,139';
const TX = '245,185,66';

const NODE_RGB = {
    device: '61,214,195', nat: '245,185,66', stun: '148,163,184', turn: '255,93,115',
    edge: '96,165,250', api: '96,165,250', tracker: '167,139,250', copies: '232,121,249',
};

function readScene(master, tiles, width, height) {
    const creator = master.creator || {};
    return buildScene({
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
    });
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

// With reduced motion the map stays still; the packet log still lists the traffic.
const prefersReducedMotion = () => typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

/**
 * The geek view: the whole room as a live network diagram. Packets travel
 * the routes they really take; photos sit under the devices that hold them.
 * Tap a photo to enlarge it, tap it again (or Open) to see it in full.
 */
function NetworkStage({ master, tiles, onOpenPhoto }) {
    const theme = useTheme();
    const isDark = theme.palette.mode === 'dark';
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const packetsRef = useRef([]);
    const imagesRef = useRef(new Map());
    const sceneRef = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [version, setVersion] = useState(0);
    const [selected, setSelected] = useState(null);

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

    const scene = useMemo(
        () => readScene(master, tiles, size.width || 800, size.height || 600),
    // eslint-disable-next-line react-hooks/exhaustive-deps
        [master, tiles, size.width, size.height, version]);
    sceneRef.current = scene;

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

    /** Send a packet along a route; `reverse` runs it from the far end towards the device. */
    const send = useCallback((route, { reverse = false, rgb, label = '', speed = 0.012 } = {}) => {
        const current = sceneRef.current;
        if (!current || !route || prefersReducedMotion()) return;
        const points = routePoints(current, route);
        if (points.length < 2) return;
        if (packetsRef.current.length > 300) return;
        packetsRef.current.push({
            points: reverse ? points.slice().reverse() : points,
            t: 0, speed: speed * (0.85 + Math.random() * 0.3),
            rgb: rgb || ROUTE_STYLE[route.kind]?.rgb || '255,255,255', label,
        });
    }, []);

    // Turn the app's events into packets on the routes they use.
    useEffect(() => {
        const emitter = master.emitter;
        const last = new Map();
        const throttled = (key, ms) => {
            const now = Date.now();
            if (now - (last.get(key) || 0) < ms) return true;
            last.set(key, now);
            return false;
        };
        const myId = () => master.client?.peerId;
        const routes = kind => (sceneRef.current?.routes || []).filter(route => route.kind === kind);
        const mine = kind => routes(kind).find(route => route.peerId === myId());

        // The server pushes every room change to everyone at once.
        const broadcast = (name) => (event) => {
            const type = event && event.type ? ':' + event.type : '';
            if (throttled('sse' + name + type, 400)) return;
            if (name === 'photos' && event?.type === 'add' && [].concat(event.item || []).some(photo => photo?.peerId === myId())) {
                send(mine('sse'), { label: 'POST magnet' });
            }
            routes('sse').forEach(route => send(route, { reverse: true, label: route.peerId === myId() ? `SSE ${name}${type}` : '' }));
        };
        const onPhotos = broadcast('photos');
        const onPeers = broadcast('peers');
        const onConnections = broadcast('peerConnections');

        const along = (kind, rgb) => (event) => {
            if (throttled(kind, 280)) return;
            const list = transferRoutesFor(sceneRef.current?.routes || [], myId(), event?.torrent);
            const label = !throttled(kind + 'label', 1500) && event?.speed ? `${kind === 'rx' ? '↓' : '↑'} ${event.speed}` : '';
            list.forEach(route => {
                const towardsMe = route.path[route.path.length - 1] === myId();
                send(route, { reverse: kind === 'rx' ? !towardsMe : towardsMe, rgb, label, speed: 0.02 });
            });
        };
        const onDownload = along('rx', RX);
        const onUpload = along('tx', TX);

        const onWire = () => {
            if (throttled('wire', 500)) return;
            send(mine('tracker'), { label: 'announce' });
            send(mine('tracker'), { reverse: true, label: 'offer/answer', speed: 0.01 });
        };
        const onBackup = ({ pending } = {}) => {
            if (pending > 0) send(mine('copies'), { label: 'PUT chunk ≤8 MB' });
        };
        const onCopy = () => send(mine('copies'), { reverse: true, label: 'GET copy' });
        const onIce = (type, value) => {
            if (type !== 'icegatheringstatechange' || value !== 'gathering') return;
            // Only our own NAT asks STUN; the others gather on their own devices.
            const nat = (mine('sse')?.path || [])[1];
            routes('stun').filter(route => route.path[0] === nat).forEach(route => {
                send(route, { label: 'binding request' });
                send(route, { reverse: true, label: 'binding response', speed: 0.009 });
            });
        };

        emitter.on('photos', onPhotos);
        emitter.on('peers', onPeers);
        emitter.on('peerConnections', onConnections);
        emitter.on('downloadProgress', onDownload);
        emitter.on('uploadProgress', onUpload);
        emitter.on('wire', onWire);
        emitter.on('serverCopyBackup', onBackup);
        emitter.on('serverCopyReady', onCopy);
        emitter.on('pcEvent', onIce);
        return () => {
            emitter.removeListener('photos', onPhotos);
            emitter.removeListener('peers', onPeers);
            emitter.removeListener('peerConnections', onConnections);
            emitter.removeListener('downloadProgress', onDownload);
            emitter.removeListener('uploadProgress', onUpload);
            emitter.removeListener('wire', onWire);
            emitter.removeListener('serverCopyBackup', onBackup);
            emitter.removeListener('serverCopyReady', onCopy);
            emitter.removeListener('pcEvent', onIce);
        };
    }, [master, send]);

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

        let frame;
        let running = true;
        const draw = () => {
            if (!running) return;
            ctx.clearRect(0, 0, width, height);

            // Tiers, so position reads as role.
            const bands = [
                ['photogroup.network', TIER.infra],
                ['internet · NAT · STUN · TURN', TIER.net],
                ['devices · photos they hold', TIER.device],
            ];
            bands.forEach(([label, at]) => {
                const y = height * at;
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

            // Routes: signalling faint, transfers bold.
            scene.routes.forEach(route => {
                const style = ROUTE_STYLE[route.kind];
                if (!style || style.hidden) return;
                const points = routePoints(scene, route);
                if (points.length < 2) return;
                const transfer = !!route.peers;
                ctx.beginPath();
                points.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
                ctx.setLineDash(style.dash);
                ctx.lineWidth = style.width;
                ctx.strokeStyle = `rgba(${style.rgb},${transfer ? 0.75 : 0.28})`;
                ctx.stroke();
                ctx.setLineDash([]);
                if (transfer && route.label) {
                    const mid = pointAlong(points, 0.5);
                    ctx.font = `9px ${mono}`;
                    const w = ctx.measureText(route.label).width + 10;
                    roundRect(ctx, mid.x - w / 2, mid.y - 8, w, 16, 4);
                    ctx.fillStyle = isDark ? 'rgba(16,20,28,0.9)' : 'rgba(255,255,255,0.92)';
                    ctx.fill();
                    ctx.fillStyle = `rgb(${style.rgb})`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(route.label, mid.x, mid.y);
                }
            });

            // Packets, with what they carry.
            packetsRef.current = packetsRef.current.filter(packet => packet.t <= 1);
            packetsRef.current.forEach(packet => {
                packet.t += packet.speed;
                const at = pointAlong(packet.points, packet.t);
                const tail = pointAlong(packet.points, Math.max(0, packet.t - 0.06));
                const alpha = Math.min(1, Math.sin(Math.min(1, packet.t) * Math.PI) * 1.4 + 0.2);
                ctx.strokeStyle = `rgba(${packet.rgb},${alpha * 0.5})`;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(tail.x, tail.y);
                ctx.lineTo(at.x, at.y);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(at.x, at.y, 3.5, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${packet.rgb},${alpha})`;
                ctx.fill();
                if (packet.label) {
                    ctx.font = `9px ${mono}`;
                    ctx.fillStyle = `rgba(${packet.rgb},${alpha})`;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(packet.label, at.x + 6, at.y - 4);
                }
            });

            // Nodes.
            scene.nodes.forEach(node => {
                const rgb = NODE_RGB[node.kind] || '200,200,200';
                const isSelected = selected?.type === 'node' && selected.id === node.id;
                if (node.kind === 'nat' || node.kind === 'stun' || node.kind === 'turn') {
                    polygon(ctx, node.x, node.y, 17, node.kind === 'nat' ? 6 : 4, node.kind === 'nat' ? 0 : Math.PI / 4);
                    ctx.fillStyle = `rgba(${rgb},0.14)`;
                    ctx.fill();
                    ctx.strokeStyle = `rgba(${rgb},${isSelected ? 1 : 0.8})`;
                    ctx.lineWidth = isSelected ? 2.5 : 1.5;
                    ctx.stroke();
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
                    return;
                }
                const { w, h } = node;
                roundRect(ctx, node.x - w / 2, node.y - h / 2, w, h, 7);
                ctx.fillStyle = `rgba(${rgb},${node.isMe ? 0.2 : 0.1})`;
                ctx.fill();
                ctx.strokeStyle = `rgba(${rgb},${isSelected || node.isMe ? 1 : 0.7})`;
                ctx.lineWidth = isSelected ? 2.5 : node.isMe ? 2 : 1;
                ctx.stroke();
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
            });

            // Photos under the devices holding them.
            scene.thumbs.forEach(thumb => {
                const { x, y, size: s, tile } = thumb;
                const isSelected = selected?.type === 'thumb' && selected.key === thumb.key;
                const img = image(tile.img);
                ctx.save();
                roundRect(ctx, x - s / 2, y - s / 2, s, s, 6);
                ctx.clip();
                if (img) {
                    const scale = Math.max(s / img.naturalWidth, s / img.naturalHeight);
                    const iw = img.naturalWidth * scale;
                    const ih = img.naturalHeight * scale;
                    ctx.drawImage(img, x - iw / 2, y - ih / 2, iw, ih);
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

            frame = requestAnimationFrame(draw);
        };
        draw();
        return () => {
            running = false;
            cancelAnimationFrame(frame);
        };
    }, [scene, size, isDark, selected, image]);

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

            {/* Legend, in the empty space under the devices. */}
            <Stack spacing={0.4} sx={{ position: 'absolute', bottom: 8, right: 8, pointerEvents: 'none' }}>
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

            {others === 0 && (
                <Typography sx={{
                    position: 'absolute', left: 0, right: 0, top: `calc(${TIER.device * 100}% - 64px)`, textAlign: 'center',
                    fontFamily: mono, fontSize: '0.7rem', color: 'text.secondary', pointerEvents: 'none',
                }}>
                    alone in this room · Invite someone to see the path between you
                </Typography>
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
                    <Box
                        component={thumb.tile.img ? 'img' : 'div'}
                        src={thumb.tile.img || undefined}
                        alt={thumb.tile.fileName || 'Photo'}
                        onClick={() => thumb.tile.img && onOpenPhoto(thumb.tileKey)}
                        sx={{
                            width: '100%', height: 150, objectFit: 'cover', borderRadius: 1, display: 'block',
                            bgcolor: 'action.hover', cursor: thumb.tile.img ? 'zoom-in' : 'default',
                        }}
                    />
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
                        <Button size="small" variant="contained" startIcon={<OpenInFullRounded />} disabled={!thumb.tile.img}
                            onClick={() => onOpenPhoto(thumb.tileKey)} sx={{ textTransform: 'none', flex: 1 }}>
                            Open full size
                        </Button>
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
                        position: 'absolute', left: 8, top: 8, maxWidth: 300, p: 1.25, borderRadius: 2,
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
                        <Typography key={index} sx={{ fontFamily: mono, fontSize: '0.64rem', color: 'text.secondary', lineHeight: 1.55, wordBreak: 'break-all' }}>
                            {line}
                        </Typography>
                    ))}
                    {node.kind === 'device' && (
                        <Typography sx={{ fontFamily: mono, fontSize: '0.64rem', color: 'text.secondary', lineHeight: 1.55 }}>
                            {`photos held ${node.photoCount || 0}`}
                        </Typography>
                    )}
                </Box>
            )}
        </Box>
    );
}

NetworkStage.propTypes = {
    master: PropTypes.object.isRequired,
    tiles: PropTypes.array.isRequired,
    onOpenPhoto: PropTypes.func.isRequired,
};

export default NetworkStage;
