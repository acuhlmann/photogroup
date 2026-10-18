import React, { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import { getBaseInfoHash } from './WebTorrentUtils';
import {
    PHASES, PHASE_NOTES, attachTelemetryLog, computePhase, formatBytes, formatElapsed,
    phaseIndex, probeIcePaths, shortHash, snapshotTorrent,
} from './TransferTelemetry';

const MAX_LOG = 40;
const SPARK_SAMPLES = 30;
const mono = { fontFamily: 'var(--font-mono)' };

/** client.get() is async in WebTorrent 3, so scan the live list instead. */
function findTorrent(client, tile, infoHash) {
    if (tile.torrent && tile.torrent.infoHash === infoHash) return tile.torrent;
    const list = client && Array.isArray(client.torrents) ? client.torrents : [];
    return list.find(t => t && t.infoHash === infoHash) || null;
}

const KIND_COLOR = {
    net: 'info.main',
    ok: 'success.main',
    data: 'primary.main',
    info: 'text.secondary',
    warn: 'warning.main',
};

function Sparkline({ samples }) {
    const max = Math.max(1, ...samples);
    const w = 100, h = 18;
    const step = w / Math.max(1, SPARK_SAMPLES - 1);
    const offset = SPARK_SAMPLES - samples.length;
    const pts = samples.map((v, i) => ((i + offset) * step).toFixed(1) + ',' + (h - (v / max) * (h - 2) - 1).toFixed(1));
    return (
        <Box component="svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
             aria-hidden="true" sx={{ width: '100%', height: 18, display: 'block', color: 'primary.main' }}>
            {pts.length > 1 && (
                <>
                    <polygon points={`${pts[0].split(',')[0]},${h} ${pts.join(' ')} ${w},${h}`} fill="currentColor" opacity="0.15" />
                    <polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
                </>
            )}
        </Box>
    );
}

function PhaseRail({ current }) {
    const idx = phaseIndex(current);
    return (
        <Box sx={{ display: 'flex', gap: '3px', mt: 0.5 }} role="list" aria-label="Transfer stages">
            {PHASES.map((p, i) => {
                const state = i < idx ? 'done' : i === idx ? 'active' : 'todo';
                return (
                    <Box key={p.id} role="listitem" aria-current={state === 'active' ? 'step' : undefined}
                         title={p.long} sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{
                            height: 3, borderRadius: 2,
                            bgcolor: state === 'todo' ? 'action.disabledBackground' : state === 'done' ? 'success.main' : 'primary.main',
                            animation: state === 'active' ? 'pgPulse 1.2s ease-in-out infinite' : 'none',
                            '@keyframes pgPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
                            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                        }} />
                        <Typography variant="caption" noWrap sx={{
                            ...mono, display: 'block', fontSize: '0.52rem', mt: '2px',
                            color: state === 'active' ? 'primary.main' : state === 'done' ? 'text.secondary' : 'text.disabled',
                            fontWeight: state === 'active' ? 700 : 400,
                        }}>
                            {p.label}
                        </Typography>
                    </Box>
                );
            })}
        </Box>
    );
}

/**
 * Live P2P telemetry for one loading photo: pipeline stage, swarm stats,
 * negotiated ICE path, throughput sparkline and a protocol event log.
 */
function TransferConsole({ master, tile }) {
    const [snap, setSnap] = useState(null);
    const [log, setLog] = useState([]);
    const [paths, setPaths] = useState([]);
    const [speeds, setSpeeds] = useState([]);
    const [noteTick, setNoteTick] = useState(0);
    const [expanded, setExpanded] = useState(false);
    const [, setClock] = useState(0);
    const startRef = useRef(Date.now());
    const seenRef = useRef({});
    const knownPathsRef = useRef(new Set());
    const tileRef = useRef(tile);
    tileRef.current = tile;

    const baseHash = getBaseInfoHash(tile.infoHash);

    useEffect(() => {
        const start = startRef.current;
        const seen = seenRef.current;
        let detach = () => {};
        let attachedTo = null;
        let probing = false;

        const push = entry => setLog(prev => {
            const next = [...prev, { ...entry, t: Date.now() - start, id: prev.length ? prev[prev.length - 1].id + 1 : 0 }];
            return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
        });

        setLog([]);
        push({ kind: 'info', text: 'magnet resolved · info_hash ' + shortHash(baseHash, 10, 6) });

        const tick = () => {
            setClock(c => c + 1);
            const torrent = findTorrent(master.client, tileRef.current, baseHash);
            if (torrent && torrent !== attachedTo) {
                detach();
                attachedTo = torrent;
                detach = attachTelemetryLog(torrent, push, seen);
                const trackers = Array.isArray(torrent.announce) ? torrent.announce : [];
                push({ kind: 'net', text: 'announce → ' + (trackers[0] || 'tracker') + (trackers.length > 1 ? ' +' + (trackers.length - 1) : '') });
            }
            // The first announce often goes out before we attach.
            if (torrent && torrent.discovery && torrent.discovery.tracker) seen.announced = true;
            const s = snapshotTorrent(torrent);
            setSnap(s);
            if (s) setSpeeds(prev => [...prev, s.downloadSpeed].slice(-SPARK_SAMPLES));
            if (torrent && !probing) {
                probing = true;
                probeIcePaths(torrent).then(found => {
                    found.forEach(p => {
                        const key = p.id + p.path;
                        if (knownPathsRef.current.has(key)) return;
                        knownPathsRef.current.add(key);
                        push({
                            kind: p.relayed ? 'warn' : 'ok',
                            text: 'ICE selected ' + p.localType + '↔' + p.remoteType + ' (' + p.label + ')' +
                                (p.protocol ? ' ' + p.protocol.toUpperCase() : '') +
                                (p.rttMs != null ? ' rtt ' + p.rttMs + 'ms' : ''),
                        });
                    });
                    setPaths(found);
                }).finally(() => { probing = false; });
            }
        };

        tick();
        const id = setInterval(tick, 1000);
        return () => { clearInterval(id); detach(); };
    }, [master.client, baseHash]);

    useEffect(() => {
        if (!tile.hasServerCopy) return;
        setLog(prev => [...prev, {
            kind: 'info', text: 'fallback armed: HTTPS copy held by server',
            t: Date.now() - startRef.current, id: prev.length ? prev[prev.length - 1].id + 1 : 0,
        }]);
    }, [tile.hasServerCopy]);

    useEffect(() => {
        const id = setInterval(() => setNoteTick(n => n + 1), 6000);
        return () => clearInterval(id);
    }, []);

    const phase = computePhase(snap, seenRef.current);
    const notes = PHASE_NOTES[phase] || [];
    const note = notes.length ? notes[noteTick % notes.length] : '';
    const elapsed = Date.now() - startRef.current;
    const path = paths[0];
    const visibleLog = expanded ? log : log.slice(-4);

    return (
        <Box sx={{ mt: 1 }} data-testid="transfer-console">
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
                <Typography variant="caption" noWrap sx={{ ...mono, fontSize: '0.6rem', color: 'text.secondary' }}>
                    {PHASES[phaseIndex(phase)].long}
                </Typography>
                <Typography variant="caption" sx={{ ...mono, fontSize: '0.6rem', color: 'text.disabled', flexShrink: 0 }}>
                    T{formatElapsed(elapsed)}
                </Typography>
            </Box>
            <PhaseRail current={phase} />

            {/* Swarm stats */}
            <Box sx={{
                display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 0.5, mt: 1,
                '& > div': { minWidth: 0 },
            }}>
                <Stat label="peers" value={snap ? snap.wires.length + '/' + Math.max(snap.numPeers, snap.wires.length) : '0'} />
                <Stat label="pieces"
                      value={snap && snap.pieces ? snap.verified + '/' + snap.pieces : '—'}
                      sub={snap && snap.pieceLength ? '× ' + formatBytes(snap.pieceLength) : null} />
                <Stat label="path"
                      value={path ? path.label : snap && snap.wires.length ? snap.wires[0].type : 'probing'}
                      sub={path && path.rttMs != null ? 'rtt ' + path.rttMs + 'ms' : null} />
            </Box>

            {snap && (snap.downloaded > 0 || snap.wires.length > 0) && (
                <Box sx={{ mt: 0.75 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography variant="caption" sx={{ ...mono, fontSize: '0.55rem', color: 'text.disabled' }}>
                            ↓ {formatBytes(snap.downloadSpeed)}/s · {formatBytes(snap.downloaded)}{snap.length ? ' of ' + formatBytes(snap.length) : ''}
                        </Typography>
                        {snap.uploaded > 0 && (
                            <Typography variant="caption" sx={{ ...mono, fontSize: '0.55rem', color: 'info.main' }}>
                                ↑ {formatBytes(snap.uploaded)}
                            </Typography>
                        )}
                    </Box>
                    <Sparkline samples={speeds} />
                </Box>
            )}

            {/* Event log */}
            <ButtonBase
                onClick={() => setExpanded(v => !v)}
                aria-expanded={expanded}
                aria-label={expanded ? 'Collapse transfer log' : 'Expand transfer log'}
                sx={{
                    display: 'block', width: '100%', textAlign: 'left', mt: 0.75, p: 0.75, borderRadius: 1,
                    bgcolor: t => t.palette.mode === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.04)',
                    maxHeight: expanded ? 220 : 'none', overflowY: expanded ? 'auto' : 'hidden',
                }}
            >
                <Box role="log" aria-live="polite" aria-relevant="additions">
                    {visibleLog.map(entry => (
                        <Typography key={entry.id} component="div" variant="caption" sx={{
                            ...mono, fontSize: '0.56rem', lineHeight: 1.45, wordBreak: 'break-word',
                            color: KIND_COLOR[entry.kind] || 'text.secondary',
                        }}>
                            <Box component="span" sx={{ color: 'text.disabled', mr: 0.5 }}>{formatElapsed(entry.t)}</Box>
                            {entry.text}
                        </Typography>
                    ))}
                </Box>
                {log.length > 4 && (
                    <Typography variant="caption" sx={{ ...mono, fontSize: '0.52rem', color: 'text.disabled', display: 'block', mt: 0.25 }}>
                        {expanded ? '▴ collapse' : '▾ ' + (log.length - 4) + ' earlier events'}
                    </Typography>
                )}
            </ButtonBase>

            {expanded && snap && snap.wires.length > 0 && (
                <Box sx={{ mt: 0.75 }}>
                    {snap.wires.map((w, i) => (
                        <Typography key={(w.peerId || '') + i} component="div" variant="caption" sx={{ ...mono, fontSize: '0.54rem', color: 'text.secondary', wordBreak: 'break-word' }}>
                            ◆ {w.type} {w.remoteAddress || ''} {w.peerId ? shortHash(w.peerId, 6, 2) : ''}
                            {w.client ? ' · ' + w.client : ''} · ↓{formatBytes(w.downloaded)}{w.choked ? ' · choked' : ''}
                        </Typography>
                    ))}
                </Box>
            )}

            {note && (
                <Typography key={phase + noteTick} variant="caption" sx={{
                    display: 'block', mt: 0.75, fontSize: '0.62rem', lineHeight: 1.4, color: 'text.secondary', fontStyle: 'italic',
                    animation: 'pgFade 0.5s ease',
                    '@keyframes pgFade': { from: { opacity: 0 }, to: { opacity: 1 } },
                    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                }}>
                    {note}
                </Typography>
            )}
        </Box>
    );
}

function Stat({ label, value, sub }) {
    return (
        <Box>
            <Typography variant="caption" sx={{ ...mono, display: 'block', fontSize: '0.5rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {label}
            </Typography>
            <Typography variant="caption" noWrap sx={{ ...mono, display: 'block', fontSize: '0.66rem', fontWeight: 600 }}>
                {value}
            </Typography>
            {sub && (
                <Typography variant="caption" noWrap sx={{ ...mono, display: 'block', fontSize: '0.5rem', color: 'text.disabled' }}>
                    {sub}
                </Typography>
            )}
        </Box>
    );
}

export default TransferConsole;
