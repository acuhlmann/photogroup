import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { withSnackbar } from '../compatibility/withSnackbar';

import Logger from 'js-logger';
import _ from "lodash";
import update from "immutability-helper";
import StringUtil from "../util/StringUtil";
import AloneInRoom from "./AloneInRoom";

// Force-directed layout constants - tuned for better viewport utilization
const REPULSION = 5000;
const SPRING_K = 0.003;
const DAMPING = 0.85;
const CENTER_GRAVITY = 0.002;
const MIN_DIST = 130;

function layoutNodes(nodes, edges, width, height) {
    if (nodes.length === 0) return;

    // Initialize positions in a circle if not set - scale radius to viewport
    nodes.forEach((node, i) => {
        if (node.x === undefined) {
            const angle = (2 * Math.PI * i) / nodes.length;
            const r = Math.min(width, height) * 0.35;
            node.x = width / 2 + r * Math.cos(angle);
            node.y = height / 2 + r * Math.sin(angle);
            node.vx = 0;
            node.vy = 0;
        }
    });

    // Run iterations
    for (let iter = 0; iter < 150; iter++) {
        // Repulsion between all pairs
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                let dx = nodes[j].x - nodes[i].x;
                let dy = nodes[j].y - nodes[i].y;
                let dist = Math.sqrt(dx * dx + dy * dy) || 1;
                if (dist < MIN_DIST) dist = MIN_DIST;
                const force = REPULSION / (dist * dist);
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;
                nodes[i].vx -= fx;
                nodes[i].vy -= fy;
                nodes[j].vx += fx;
                nodes[j].vy += fy;
            }
        }

        // Spring attraction along edges - rest length scales with viewport
        // Client boxes are 90px wide; shorter links stack their labels on top of each other.
        const restLength = Math.max(180, Math.min(width, height) * 0.35);
        edges.forEach(edge => {
            const a = nodes.find(n => n.id === edge.from);
            const b = nodes.find(n => n.id === edge.to);
            if (!a || !b) return;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = SPRING_K * (dist - restLength);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            a.vx += fx;
            a.vy += fy;
            b.vx -= fx;
            b.vy -= fy;
        });

        // Center gravity
        nodes.forEach(node => {
            node.vx += (width / 2 - node.x) * CENTER_GRAVITY;
            node.vy += (height / 2 - node.y) * CENTER_GRAVITY;
        });

        // Apply velocity with damping
        nodes.forEach(node => {
            node.vx *= DAMPING;
            node.vy *= DAMPING;
            node.x += node.vx;
            node.y += node.vy;
            // Bounds - use proportional padding for better scaling
            const padX = Math.max(50, width * 0.06);
            const padY = Math.max(30, height * 0.06);
            node.x = Math.max(padX, Math.min(width - padX, node.x));
            node.y = Math.max(padY, Math.min(height - padY, node.y));
        });
    }
}

function getEdgeColor(edge, isDark) {
    if (!edge.network) return isDark ? '#556677' : '#aabbcc';
    const ct = edge.network.connectionType || '';
    if (ct.includes('relay')) return '#ff1744';
    if (ct.includes('nat') || ct === 'p2p nat') return '#ffab00';
    if (ct === 'p2p') return '#00e676';
    return isDark ? '#556677' : '#aabbcc';
}

function getNodeColor(node, isMe, isDark) {
    if (isMe) return isDark ? '#3dd6c3' : '#0f766e';
    if (node.type === 'nat') return '#ffab00';
    if (node.type === 'relay') return '#ff1744';
    return isDark ? '#8899aa' : '#667788';
}

// Idle flow in the accent colour; received packets green, sent ones amber.
function particleRgb(kind, isDark) {
    if (kind === 'rx') return isDark ? '61,222,139' : '4,120,87';
    if (kind === 'tx') return isDark ? '245,185,66' : '180,83,9';
    return isDark ? '61,214,195' : '15,118,110';
}

// Particle system for animated data flow
class ParticleSystem {
    constructor() {
        this.particles = [];
    }
    addParticlesForEdge(edge, fromNode, toNode) {
        // Add 2-3 particles per connection edge
        const count = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < count; i++) {
            this.particles.push({
                edgeId: edge.id || `${edge.from}-${edge.to}`,
                progress: i / count, // evenly spaced
                speed: 0.003 + Math.random() * 0.002,
                fromX: fromNode.x, fromY: fromNode.y,
                toX: toNode.x, toY: toNode.y,
            });
        }
    }
    // A packet of real traffic: crosses the edge once, from sender to receiver.
    addBurst(fromNode, toNode, kind) {
        if (this.particles.length > 400) return;
        this.particles.push({
            once: true,
            kind,
            progress: 0,
            speed: 0.018 + Math.random() * 0.01,
            fromX: fromNode.x, fromY: fromNode.y,
            toX: toNode.x, toY: toNode.y,
        });
    }
    update() {
        this.particles.forEach(p => {
            p.progress += p.speed;
            if (p.progress > 1 && !p.once) p.progress -= 1;
        });
        this.particles = this.particles.filter(p => !p.once || p.progress <= 1);
    }
    draw(ctx, isDark) {
        this.particles.forEach(p => {
            const x = p.fromX + (p.toX - p.fromX) * p.progress;
            const y = p.fromY + (p.toY - p.fromY) * p.progress;
            const alpha = Math.sin(p.progress * Math.PI) * 0.9 + 0.1;
            const rgb = particleRgb(p.kind, isDark);
            const size = p.once ? 4 : 3;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${rgb},${alpha})`;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x, y, size * 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${rgb},${alpha * 0.2})`;
            ctx.fill();
        });
    }
    clear() {
        this.particles = [];
    }
}

function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

function drawHexagon(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const px = x + r * Math.cos(angle);
        const py = y + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
}

function drawDiamond(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
}

// x is where the badge sits: the client box's top-right corner.
function drawPhotoBadge(ctx, x, y, count, isDark) {
    if (count <= 0) return;
    const badgeX = x;
    const badgeY = y - 14;
    const text = count > 99 ? '99+' : String(count);
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    const textWidth = ctx.measureText(text).width;
    const badgeW = Math.max(18, textWidth + 8);
    const badgeH = 16;
    const r = badgeH / 2;

    // Badge background
    ctx.beginPath();
    ctx.moveTo(badgeX - badgeW / 2 + r, badgeY - badgeH / 2);
    ctx.lineTo(badgeX + badgeW / 2 - r, badgeY - badgeH / 2);
    ctx.arcTo(badgeX + badgeW / 2, badgeY - badgeH / 2, badgeX + badgeW / 2, badgeY, r);
    ctx.arcTo(badgeX + badgeW / 2, badgeY + badgeH / 2, badgeX - badgeW / 2, badgeY + badgeH / 2, r);
    ctx.arcTo(badgeX - badgeW / 2, badgeY + badgeH / 2, badgeX - badgeW / 2, badgeY, r);
    ctx.arcTo(badgeX - badgeW / 2, badgeY - badgeH / 2, badgeX + badgeW / 2, badgeY - badgeH / 2, r);
    ctx.closePath();
    ctx.fillStyle = isDark ? '#3dd6c3' : '#0f766e';
    ctx.fill();

    // Badge text
    ctx.fillStyle = isDark ? '#06221d' : '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, badgeX, badgeY);
}

function drawConnectionStatusLabel(ctx, fromNode, toNode, edge, isDark) {
    if (edge.type !== 'connection' || !edge.network) return;
    const ct = edge.network.connectionType || '';
    if (!ct) return;

    const midX = (fromNode.x + toNode.x) / 2;
    const midY = (fromNode.y + toNode.y) / 2;

    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Background pill
    const text = ct.toUpperCase();
    const textW = ctx.measureText(text).width;
    const padX = 6;
    const padY = 3;
    drawRoundedRect(ctx, midX - textW / 2 - padX, midY - 6 - padY, textW + padX * 2, 12 + padY * 2, 4);
    ctx.fillStyle = isDark ? 'rgba(17,24,32,0.85)' : 'rgba(255,255,255,0.9)';
    ctx.fill();

    ctx.fillStyle = getEdgeColor(edge, isDark);
    ctx.fillText(text, midX, midY);
}

function isNatType(natType) {
    return natType.includes('srflx') || natType.includes('prflx');
}

function createShortNetworkLabel(item) {
    // Use human-readable display name (ISP, city, hostname) instead of IP
    return StringUtil.createDisplayName(item);
}

function addHosts(peer, nodes, isMe) {
    if (nodes.find(item => item.id === peer.peerId)) return;
    const hosts = peer.networkChain.filter(item => item.typeDetail === 'host');
    const host = hosts.find(item => item.label) || hosts[0];
    if (host) {
        const platform = StringUtil.slimPlatform(peer.originPlatform);
        const node = {
            id: peer.peerId,
            label: peer.name || _.truncate(platform),
            type: 'client',
            peer: peer,
            network: host,
            networks: hosts,
            isMe: isMe,
        };
        nodes.push(node);
        return host;
    }
}

function addNats(peer, nodes, isMe) {
    const nats = peer.networkChain.filter(item => isNatType(item.typeDetail));
    const nat = nats.find(item => item.label) || nats[0];
    if (nat) {
        if (nodes.find(item => item.id === nat.ip)) return nat;
        const node = {
            id: nat.ip,
            label: createShortNetworkLabel(nat),
            network: nat,
            networks: nats,
            peer: peer,
            type: 'nat',
            isMe: isMe,
        };
        nodes.push(node);
        return node;
    }
}

function addRelays(peer, nodes, isMe) {
    const relays = peer.networkChain.filter(item => item.typeDetail === 'relay');
    return relays.map(relay => {
        const shortName = createShortNetworkLabel(relay);
        const existing = nodes.find(item => item.id === shortName);
        if (!existing) {
            const node = {
                id: shortName,
                label: shortName,
                relays: new Map([[relay.ip, relay]]),
                type: 'relay',
                network: relay,
                networks: [relay],
                peer: peer,
                isMe: isMe,
            };
            nodes.push(node);
            return node;
        } else {
            existing.relays.set(relay.ip, relay);
            existing.networks.push(relay);
            return existing;
        }
    }).filter(item => item);
}

function addPeerChains(peers, myPeerId, nodes, edges) {
    peers.forEach(peer => {
        if (peer.networkChain) {
            const isMe = peer.peerId === myPeerId;
            const host = addHosts(peer, nodes, isMe);
            const nat = addNats(peer, nodes, isMe);
            const relays = addRelays(peer, nodes, isMe);

            if (nat) {
                edges.push({
                    from: peer.peerId,
                    to: nat.id || nat.ip,
                    type: 'chain',
                    network: host,
                });
                relays.forEach(relay => {
                    edges.push({
                        from: nat.id || nat.ip,
                        to: relay.id || relay.ip,
                        type: 'chain',
                    });
                });
            }
        }
    });
}

function addConnections(connections, edges) {
    connections.forEach(conn => {
        const from = conn.connectionType === 'p2p' ? conn.fromPeerId : conn.from;
        const to = conn.connectionType === 'p2p' ? conn.toPeerId : conn.to;
        const edge = {
            id: conn.id,
            from,
            to,
            type: 'connection',
            network: conn,
        };
        if (!edges.find(item => item.from === edge.from && item.to === edge.to)) {
            edges.push(edge);
        }
    });
}

// Show the user's own node from local ICE discovery until the server
// echoes our peer back with its network chain.
function addLocalNetwork(networkChain, myPeerId, me, nodes, edges) {
    if (nodes.find(n => n.id === myPeerId)) return;

    const hosts = networkChain.filter(item => item.typeDetail === 'host');
    const host = hosts.find(item => item.label) || hosts[0];
    if (host) {
        const platform = StringUtil.slimPlatform(me.originPlatform || '');
        nodes.push({
            id: myPeerId,
            label: me.name || _.truncate(platform) || 'Me',
            type: 'client',
            peer: { ...me, peerId: myPeerId, networkChain },
            network: host,
            networks: hosts,
            isMe: true,
        });
    }

    const nats = networkChain.filter(item =>
        item.typeDetail && (item.typeDetail.includes('srflx') || item.typeDetail.includes('prflx'))
    );
    const nat = nats.find(item => item.label) || nats[0];
    if (nat && !nodes.find(n => n.id === nat.ip)) {
        nodes.push({
            id: nat.ip,
            label: createShortNetworkLabel(nat),
            network: nat,
            networks: nats,
            peer: { peerId: myPeerId, networkChain },
            type: 'nat',
            isMe: true,
        });
        edges.push({
            from: myPeerId,
            to: nat.ip,
            type: 'chain',
            network: host,
        });
    }
}

// The map mounts each time it is opened (the phone's People sheet unmounts it
// on close), so build it from what master already knows rather than starting
// empty and waiting for the next server event.
function readGraph(master) {
    const myPeerId = master.client?.peerId;
    const nodes = [];
    const edges = [];
    addConnections(master.peers?.connections || [], edges);
    addPeerChains(master.peers?.items || [], myPeerId, nodes, edges);
    if (myPeerId && master.localNetwork) {
        addLocalNetwork(master.localNetwork, myPeerId, master.me || {}, nodes, edges);
    }
    return { nodes, edges };
}

function TopologyView({ master, fillHeight, active = true }) {
    const muiTheme = useTheme();
    const isDark = muiTheme.palette.mode === 'dark';
    const masterRef = useRef(master);
    masterRef.current = master;

    const canvasRef = useRef(null);
    const animFrameRef = useRef(null);
    const particleSystemRef = useRef(new ParticleSystem());
    const nodesRef = useRef([]);
    const edgesRef = useRef([]);
    const containerRef = useRef(null);

    const [visible, setVisible] = useState(false);
    const [showTopology, setShowTopology] = useState(true);
    const [selectedNodeLabel, setSelectedNodeLabel] = useState('');
    const [graph, setGraph] = useState(() => readGraph(master));
    const [peerPhotoCounts, setPeerPhotoCounts] = useState({});

    // Helper methods (kept from original)
    const isMeColor = useCallback((isMe) => {
        return isMe ? '#F50057' : '#e0e0e0';
    }, []);

    const isMobile = useCallback((platform) => {
        return platform.indexOf('Mobile') > -1
            || platform.indexOf('Android') > -1
            || platform.indexOf('iOS') > -1;
    }, []);

    // Track photo counts per peer
    useEffect(() => {
        const emitter = master.emitter;

        // Fetch current room state to get accurate photo counts
        const refreshPhotoCounts = () => {
            if (masterRef.current.service && masterRef.current.service.hasRoom) {
                masterRef.current.service.getRoom().then(room => {
                    if (room && room.photos) {
                        const counts = {};
                        room.photos.forEach(photo => {
                            if (photo.owners) {
                                photo.owners.forEach(owner => {
                                    counts[owner.peerId] = (counts[owner.peerId] || 0) + 1;
                                });
                            }
                            // Also count by peerId (the original uploader)
                            if (photo.peerId) {
                                counts[photo.peerId] = counts[photo.peerId] || 0;
                            }
                        });
                        setPeerPhotoCounts(counts);
                    }
                }).catch(() => {});
            }
        };

        const handlePhotos = (data) => {
            // Recalculate photo counts from room photos when ownership changes
            if (data.type === 'add' || data.type === 'addOwner' || data.type === 'removeOwner' || data.type === 'updateOwner' || data.type === 'delete') {
                refreshPhotoCounts();
            }
        };

        // Counts die with the map on close; fetch them again when it opens.
        refreshPhotoCounts();
        emitter.on('photos', handlePhotos);
        return () => {
            emitter.removeListener('photos', handlePhotos);
        };
    }, [master.emitter]);

    // Event listeners
    useEffect(() => {
        const emitter = master.emitter;

        const handleShowTopology = (value) => setShowTopology(value);
        const handleReadyToUpload = () => setVisible(true);

        emitter.on('showTopology', handleShowTopology);
        emitter.on('readyToUpload', handleReadyToUpload);

        return () => {
            emitter.removeListener('showTopology', handleShowTopology);
            emitter.removeListener('readyToUpload', handleReadyToUpload);
        };
    }, [master.emitter]);

    // Peer, connection and local network data. master has already applied
    // these events by the time they reach us, so rebuild from it.
    useEffect(() => {
        const emitter = master.emitter;

        const refreshGraph = () => setGraph(readGraph(masterRef.current));

        emitter.on('peers', refreshGraph);
        emitter.on('peerConnections', refreshGraph);
        emitter.on('localNetwork', refreshGraph);

        return () => {
            emitter.removeListener('peers', refreshGraph);
            emitter.removeListener('peerConnections', refreshGraph);
            emitter.removeListener('localNetwork', refreshGraph);
        };
    }, [master.emitter]);

    // Send a packet along our links whenever bytes actually move.
    useEffect(() => {
        const emitter = master.emitter;
        const lastAt = { rx: 0, tx: 0 };
        const pulse = kind => () => {
            const now = Date.now();
            if (now - lastAt[kind] < 250) return;
            lastAt[kind] = now;
            const myPeerId = masterRef.current?.client?.peerId;
            const nodes = nodesRef.current;
            const links = edgesRef.current.filter(edge => edge.type === 'connection');
            const mine = links.filter(edge => edge.from === myPeerId || edge.to === myPeerId);
            (mine.length ? mine : links).forEach(edge => {
                const from = nodes.find(n => n.id === edge.from);
                const to = nodes.find(n => n.id === edge.to);
                if (!from || !to) return;
                // Received bytes travel towards us, sent ones away.
                const towardsMe = edge.to === myPeerId;
                const forward = kind === 'rx' ? towardsMe : !towardsMe;
                particleSystemRef.current.addBurst(forward ? from : to, forward ? to : from, kind);
            });
        };
        const onDownload = pulse('rx');
        const onUpload = pulse('tx');
        emitter.on('downloadProgress', onDownload);
        emitter.on('uploadProgress', onUpload);
        return () => {
            emitter.removeListener('downloadProgress', onDownload);
            emitter.removeListener('uploadProgress', onUpload);
        };
    }, [master.emitter]);

    // Canvas rendering
    useEffect(() => {
        if (!active) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const container = containerRef.current;
        if (!container) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = container.getBoundingClientRect();
        const width = rect.width;
        const height = fillHeight ? rect.height : Math.max(350, rect.height);

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Copy graph data to refs for animation
        const nodes = graph.nodes.map(n => ({
            ...n,
            x: nodesRef.current.find(old => old.id === n.id)?.x,
            y: nodesRef.current.find(old => old.id === n.id)?.y,
            vx: 0,
            vy: 0,
        }));

        layoutNodes(nodes, graph.edges, width, height);
        nodesRef.current = nodes;
        edgesRef.current = graph.edges;

        // Rebuild particles for connection edges
        const ps = particleSystemRef.current;
        ps.clear();
        graph.edges.filter(e => e.type === 'connection').forEach(edge => {
            const fromNode = nodes.find(n => n.id === edge.from);
            const toNode = nodes.find(n => n.id === edge.to);
            if (fromNode && toNode) {
                ps.addParticlesForEdge(edge, fromNode, toNode);
            }
        });

        let running = true;

        function render() {
            if (!running) return;

            ctx.clearRect(0, 0, width, height);

            // Background grid pattern
            ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)';
            ctx.lineWidth = 0.5;
            const gridSize = 30;
            for (let x = 0; x < width; x += gridSize) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
            }
            for (let y = 0; y < height; y += gridSize) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }

            // Draw edges
            edgesRef.current.forEach(edge => {
                const fromNode = nodes.find(n => n.id === edge.from);
                const toNode = nodes.find(n => n.id === edge.to);
                if (!fromNode || !toNode) return;

                ctx.beginPath();
                ctx.moveTo(fromNode.x, fromNode.y);
                ctx.lineTo(toNode.x, toNode.y);

                if (edge.type === 'chain') {
                    ctx.setLineDash([4, 4]);
                    ctx.strokeStyle = isDark ? 'rgba(136,153,170,0.3)' : 'rgba(100,120,140,0.25)';
                    ctx.lineWidth = 1;
                } else {
                    ctx.setLineDash([]);
                    ctx.strokeStyle = getEdgeColor(edge, isDark);
                    ctx.lineWidth = 2;
                }
                ctx.stroke();
                ctx.setLineDash([]);

                // Arrow for connection edges
                if (edge.type === 'connection') {
                    const dx = toNode.x - fromNode.x;
                    const dy = toNode.y - fromNode.y;
                    const angle = Math.atan2(dy, dx);
                    const arrLen = 8;
                    const tipX = toNode.x - dx * 0.15;
                    const tipY = toNode.y - dy * 0.15;

                    ctx.beginPath();
                    ctx.moveTo(tipX, tipY);
                    ctx.lineTo(tipX - arrLen * Math.cos(angle - 0.4), tipY - arrLen * Math.sin(angle - 0.4));
                    ctx.lineTo(tipX - arrLen * Math.cos(angle + 0.4), tipY - arrLen * Math.sin(angle + 0.4));
                    ctx.closePath();
                    ctx.fillStyle = getEdgeColor(edge, isDark);
                    ctx.fill();
                }

                // Connection type label on edges
                drawConnectionStatusLabel(ctx, fromNode, toNode, edge, isDark);
            });

            // Particles
            ps.update();
            ps.draw(ctx, isDark);

            // Draw nodes
            const myPeerId = masterRef.current?.client?.peerId;
            nodes.forEach(node => {
                const isMe = node.id === myPeerId || node.isMe;
                const color = getNodeColor(node, isMe, isDark);
                const x = node.x;
                const y = node.y;

                if (node.type === 'nat') {
                    drawHexagon(ctx, x, y, 18);
                    ctx.fillStyle = isDark ? 'rgba(255,171,0,0.15)' : 'rgba(255,171,0,0.1)';
                    ctx.fill();
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                } else if (node.type === 'relay') {
                    drawDiamond(ctx, x, y, 18);
                    ctx.fillStyle = isDark ? 'rgba(255,23,68,0.15)' : 'rgba(255,23,68,0.1)';
                    ctx.fill();
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                } else {
                    // Client node - rounded rectangle, wide enough for its label
                    ctx.font = '11px "JetBrains Mono", "IBM Plex Sans", monospace';
                    const labelWidth = ctx.measureText(_.truncate((node.label || '').split('\n')[0], { length: 16 })).width;
                    const w = Math.max(90, labelWidth + 16);
                    node.boxWidth = w;
                    const h = 32;
                    drawRoundedRect(ctx, x - w / 2, y - h / 2, w, h, 6);
                    ctx.fillStyle = isDark
                        ? (isMe ? 'rgba(61,214,195,0.12)' : 'rgba(136,153,170,0.08)')
                        : (isMe ? 'rgba(15,118,110,0.1)' : 'rgba(100,120,140,0.06)');
                    ctx.fill();
                    ctx.strokeStyle = color;
                    ctx.lineWidth = isMe ? 2 : 1;
                    ctx.stroke();

                    // Glow for own node
                    if (isMe && isDark) {
                        ctx.shadowColor = '#3dd6c3';
                        ctx.shadowBlur = 10;
                        ctx.strokeStyle = '#3dd6c3';
                        ctx.stroke();
                        ctx.shadowBlur = 0;
                    }

                    // Photo count badge for client nodes
                    const peerId = node.peer?.peerId || node.id;
                    const photoCount = peerPhotoCounts[peerId] || 0;
                    drawPhotoBadge(ctx, x + w / 2 - 7, y, photoCount, isDark);
                }

                // Label
                const label = (node.label || '').split('\n')[0];
                ctx.font = '11px "JetBrains Mono", "IBM Plex Sans", monospace';
                ctx.fillStyle = isDark ? '#e8eef6' : '#141820';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(_.truncate(label, { length: 16 }), x, y);

                // Type indicator below
                if (node.type !== 'client') {
                    ctx.font = '8px "JetBrains Mono", monospace';
                    ctx.fillStyle = isDark ? '#667788' : '#8899aa';
                    ctx.fillText(node.type.toUpperCase(), x, y + (node.type === 'nat' ? 26 : 26));
                }
            });

            animFrameRef.current = requestAnimationFrame(render);
        }

        render();

        return () => {
            running = false;
            if (animFrameRef.current) {
                cancelAnimationFrame(animFrameRef.current);
            }
        };
    }, [graph, isDark, fillHeight, peerPhotoCounts, active]);

    // Handle canvas click for node selection
    const handleCanvasClick = useCallback((e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const nodes = nodesRef.current;
        const clickedNode = nodes.find(node => {
            const dx = node.x - x;
            const dy = node.y - y;
            // Client boxes are as wide as their label: anywhere on the box counts.
            if (node.boxWidth) return Math.abs(dx) <= node.boxWidth / 2 && Math.abs(dy) < 25;
            return Math.sqrt(dx * dx + dy * dy) < 25;
        });

        if (clickedNode) {
            let label = '';
            if (clickedNode.type === 'client') {
                const platform = clickedNode.peer ? StringUtil.slimPlatform(clickedNode.peer.originPlatform || '') : '';
                const peerId = clickedNode.peer?.peerId || clickedNode.id;
                const photoCount = peerPhotoCounts[peerId] || 0;
                label = (clickedNode.peer?.name || '') + '\n' + platform;
                if (photoCount > 0) {
                    label += '\nPhotos available: ' + photoCount;
                }
                if (clickedNode.networks) {
                    label += '\n' + Object.values(_.groupBy(clickedNode.networks, 'ip')).map(ips => {
                        return ips.map(item => item.transport).join(',') + ' ' + ips[0].ip + ':' + ips.map(item => item.port).join(',');
                    }).join('\n');
                }
            } else if (clickedNode.type === 'relay') {
                const values = clickedNode.relays ? [...clickedNode.relays.values()] : [];
                label = 'RELAY\n' + values.map(item => item.ip + ':' + item.port).join('\n');
            } else {
                // Show full details including IP for NAT/other nodes
                label = StringUtil.createNetworkLabel(clickedNode.network, '\n', true);
            }
            setSelectedNodeLabel(label);
        } else {
            setSelectedNodeLabel('');
        }
    }, [peerPhotoCounts]);

    // Resize handler
    useEffect(() => {
        const handleResize = _.debounce(() => {
            // Force re-render by updating graph reference
            setGraph(prev => ({ ...prev }));
        }, 200);

        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            handleResize.cancel();
        };
    }, []);

    const canvasHeight = fillHeight ? '100%' : 350;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', height: fillHeight ? '100%' : 'auto' }}>
            {/* Canvas container */}
            <Box
                ref={containerRef}
                sx={{
                    position: 'relative',
                    width: '100%',
                    flex: fillHeight ? 1 : 'none',
                    height: fillHeight ? undefined : 350,
                    minHeight: fillHeight ? 300 : 350,
                    overflow: 'hidden',
                }}
            >
                <canvas
                    ref={canvasRef}
                    onClick={handleCanvasClick}
                    style={{
                        display: 'block',
                        cursor: 'pointer',
                        width: '100%',
                        height: '100%',
                    }}
                />

                {graph.nodes.length === 0 && (
                    <AloneInRoom onInvite={() => master.emitter.emit('openShare')} />
                )}

                {/* Legend overlay */}
                <Box sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    display: 'flex',
                    gap: 0.5,
                    flexDirection: 'column',
                }}>
                    <Chip
                        size="small"
                        label="P2P"
                        sx={{
                            height: 18,
                            fontSize: '0.6rem',
                            bgcolor: isDark ? 'rgba(61,222,139,0.12)' : 'rgba(4,120,87,0.1)',
                            color: isDark ? '#3dde8b' : '#047857',
                            border: isDark ? '1px solid rgba(61,222,139,0.35)' : '1px solid rgba(4,120,87,0.28)',
                            '& .MuiChip-label': { px: 1 },
                        }}
                    />
                    <Chip
                        size="small"
                        label="NAT"
                        sx={{
                            height: 18,
                            fontSize: '0.6rem',
                            bgcolor: isDark ? 'rgba(245,185,66,0.12)' : 'rgba(180,83,9,0.1)',
                            color: isDark ? '#f5b942' : '#b45309',
                            border: isDark ? '1px solid rgba(245,185,66,0.35)' : '1px solid rgba(180,83,9,0.28)',
                            '& .MuiChip-label': { px: 1 },
                        }}
                    />
                    <Chip
                        size="small"
                        label="Relay"
                        sx={{
                            height: 18,
                            fontSize: '0.6rem',
                            bgcolor: isDark ? 'rgba(255,93,115,0.12)' : 'rgba(190,18,60,0.08)',
                            color: isDark ? '#ff5d73' : '#be123c',
                            border: isDark ? '1px solid rgba(255,93,115,0.35)' : '1px solid rgba(190,18,60,0.25)',
                            '& .MuiChip-label': { px: 1 },
                        }}
                    />
                    <Chip
                        size="small"
                        label="Photos"
                        sx={{
                            height: 18,
                            fontSize: '0.6rem',
                            bgcolor: isDark ? 'rgba(61,214,195,0.12)' : 'rgba(15,118,110,0.1)',
                            color: isDark ? '#3dd6c3' : '#0f766e',
                            border: isDark ? '1px solid rgba(61,214,195,0.35)' : '1px solid rgba(15,118,110,0.28)',
                            '& .MuiChip-label': { px: 1 },
                        }}
                    />
                </Box>
            </Box>

            {/* Selected node detail */}
            {selectedNodeLabel && (
                <Box sx={{
                    px: 2,
                    py: 1,
                    borderTop: '1px solid',
                    borderColor: 'divider',
                    bgcolor: isDark ? 'rgba(16,20,28,0.88)' : 'rgba(255,255,255,0.9)',
                }}>
                    <Typography
                        variant="caption"
                        component="pre"
                        sx={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.7rem',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            color: 'text.secondary',
                            m: 0,
                        }}
                    >
                        {selectedNodeLabel}
                    </Typography>
                </Box>
            )}
        </Box>
    );
}

TopologyView.propTypes = {
    master: PropTypes.object.isRequired,
    fillHeight: PropTypes.bool,
};

export default withSnackbar(TopologyView);
