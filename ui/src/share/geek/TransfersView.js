import React, { useEffect, useReducer, useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import FileUtil from '../util/FileUtil';
import { readTransfers, totals, describeSplit, formatDuration } from './transfers';
import { describeIceServers, summarizeChain, verdictFor } from '../topology/NetworkInsight';
import { ROUTE_STYLE } from './NetworkStage';

const mono = 'var(--font-mono)';
// Torrent progress and wires have no event of their own worth listening to.
const REFRESH_MS = 700;

const SOURCE_RGB = {
    lan: ROUTE_STYLE.lan.rgb,
    punch: ROUTE_STYLE.punch.rgb,
    relay: ROUTE_STYLE.relay.rgb,
    server: ROUTE_STYLE.copies.rgb,
    unknown: '148,163,184',
};
const LEVEL_COLOR = { p2p: 'success.main', relay: 'warning.main', mixed: 'warning.main', server: 'error.main', none: 'text.disabled' };
const STATE_SX = {
    done: rgb => ({ bgcolor: `rgba(${rgb},0.22)`, color: `rgb(${rgb})`, borderColor: `rgba(${rgb},0.5)` }),
    active: rgb => ({
        color: `rgb(${rgb})`, borderColor: `rgb(${rgb})`,
        animation: 'stepPulse 1.4s ease-in-out infinite',
        '@keyframes stepPulse': { '50%': { bgcolor: `rgba(${rgb},0.18)` } },
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
    }),
    failed: () => ({ color: 'error.main', borderColor: 'error.main' }),
    todo: () => ({ color: 'text.disabled', borderColor: 'divider' }),
};

function readInput(master) {
    const creator = master.creator || {};
    return {
        items: master.ledger?.all?.() || [],
        torrents: master.client?.torrents || [],
        photos: master.roomPhotos?.all?.() || [],
        peers: master.peers?.items || [],
        connections: master.peers?.connections || [],
        myPeerId: master.client?.peerId,
        localNetwork: master.localNetwork,
        hasTurn: describeIceServers(creator.iceServers).turn.length > 0,
    };
}

function relative(ms) {
    return '+' + (Math.max(0, ms) / 1000).toFixed(1) + 's';
}

/** A row of stage chips, one lane of a transfer. */
function Lane({ name, steps, rgb, note }) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', minWidth: 0 }}>
            <Box component="span" sx={{ width: '3.4rem', flex: 'none', fontSize: '0.58rem', color: 'text.disabled', letterSpacing: '0.06em' }}>
                {name}
            </Box>
            {steps.map((step, index) => (
                <React.Fragment key={step.id}>
                    {index > 0 && <Box component="span" aria-hidden="true" sx={{ width: 6, borderTop: 1, borderColor: 'divider' }} />}
                    <Box
                        component="span"
                        data-state={step.state}
                        title={step.state}
                        sx={{ px: 0.6, borderRadius: 1, border: 1, fontSize: '0.6rem', lineHeight: 1.6, whiteSpace: 'nowrap', ...STATE_SX[step.state](rgb) }}
                    >
                        {step.label}
                    </Box>
                </React.Fragment>
            ))}
            {note && <Box component="span" sx={{ fontSize: '0.6rem', color: 'text.secondary', ml: 0.5 }}>{note}</Box>}
        </Box>
    );
}

/** Bytes by where they came from, as one bar. */
function SourceBar({ sources, total, height = 8 }) {
    if (!total) {
        return <Box sx={{ height, borderRadius: 1, bgcolor: 'action.hover' }} />;
    }
    return (
        <Box sx={{ display: 'flex', height, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
            {sources.map(source => (
                <Box
                    key={source.peerId || source.kind}
                    title={`${source.label} · ${source.how} · ${FileUtil.formatBytes(source.bytes)}`}
                    sx={{ width: `${source.bytes / total * 100}%`, bgcolor: `rgb(${SOURCE_RGB[source.kind]})`, minWidth: 2 }}
                />
            ))}
        </Box>
    );
}

function serverNote(stage) {
    if (!stage) return null;
    const bytes = stage.total
        ? `${FileUtil.formatBytes(stage.loaded || 0)}/${FileUtil.formatBytes(stage.total)}`
        : stage.loaded ? FileUtil.formatBytes(stage.loaded) : '';
    // A finished copy's chips already say so.
    if (['stored', 'exists', 'done'].includes(stage.stage)) return null;
    const live = stage.stage === 'uploading' || stage.stage === 'downloading';
    return [stage.stage, live && bytes ? bytes : null, live && stage.total ? Math.round((stage.loaded || 0) / stage.total * 100) + '%' : null]
        .filter(Boolean).join(' · ');
}

function TransferRow({ row }) {
    const [open, setOpen] = useState(false);
    const arrow = row.direction === 'down' ? '↓' : '↑';
    const percent = Math.round(row.progress * 100);
    const p2pNote = row.direction === 'down' && !row.done ? `${percent}%` : null;
    const first = row.stages[0]?.at || row.startedAt;
    // How long it took, and how fast that works out at; while it is still
    // going the same clock reads as elapsed so far.
    const timing = row.elapsedMs != null
        ? [formatDuration(row.elapsedMs) + ' took',
            row.size && row.elapsedMs > 500 ? FileUtil.formatBytes(row.size / (row.elapsedMs / 1000)) + '/s' : null]
        : row.runningMs != null ? [formatDuration(row.runningMs) + ' so far'] : [];
    return (
        <Box component="li" data-testid="transfer-row" sx={{ px: 1, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', columnGap: 1, flexWrap: 'wrap', minWidth: 0 }}>
                <Box component="span" sx={{ color: row.direction === 'down' ? 'success.main' : 'warning.main', fontWeight: 700 }}>{arrow}</Box>
                <Box component="span" sx={{ fontWeight: 600, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, maxWidth: '100%' }}>
                    {row.name}
                </Box>
                <Box component="span" data-testid="transfer-timing" sx={{ color: 'text.disabled', flex: 'none' }}>
                    {[row.size ? FileUtil.formatBytes(row.size) : null, row.direction === 'down' ? (row.done ? 'got it' : 'receiving') : 'sharing',
                        ...timing].filter(Boolean).join(' · ')}
                </Box>
                <Box component="span" data-testid="decentral" sx={{ ml: 'auto', flex: 'none', color: LEVEL_COLOR[row.decentral.level] }}>
                    {row.decentral.text}
                </Box>
            </Box>
            <Lane name="P2P" steps={row.p2p} rgb={ROUTE_STYLE.punch.rgb} note={p2pNote} />
            {row.serverSteps && (
                <Lane name={row.server.direction === 'up' ? 'SERVER ↑' : 'SERVER ↓'} steps={row.serverSteps} rgb={ROUTE_STYLE.copies.rgb} note={serverNote(row.server)} />
            )}
            <SourceBar sources={row.sources} total={row.split.total} />
            {row.sources.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, fontSize: '0.6rem', color: 'text.secondary' }}>
                    <Box component="span" sx={{ color: 'text.disabled' }}>{row.direction === 'down' ? 'from' : 'to'}</Box>
                    {row.sources.map(source => (
                        <Box component="span" key={source.peerId || source.kind} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                            <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: `rgb(${SOURCE_RGB[source.kind]})` }} />
                            {`${source.label} · ${source.how} · ${FileUtil.formatBytes(source.bytes)}`}
                        </Box>
                    ))}
                </Box>
            )}
            {row.why.map((line, index) => (
                <Typography key={index} data-testid="transfer-why" sx={{ fontFamily: mono, fontSize: '0.62rem', color: 'text.secondary', lineHeight: 1.45 }}>
                    <Box component="span" sx={{ color: 'text.disabled' }}>why </Box>{line}
                </Typography>
            ))}
            {row.stages.length > 0 && (
                <Box>
                    <Box
                        component="button"
                        type="button"
                        onClick={() => setOpen(value => !value)}
                        aria-expanded={open}
                        sx={{ all: 'unset', cursor: 'pointer', fontSize: '0.6rem', color: 'primary.main' }}
                    >
                        {open ? '▾' : '▸'} {row.stages.length} stages
                    </Box>
                    {open && (
                        <Box component="ol" sx={{ m: 0, mt: 0.25, pl: 0, listStyle: 'none' }}>
                            {row.stages.map((stage, index) => (
                                <Box component="li" key={index} sx={{ display: 'grid', gridTemplateColumns: '3.6rem 3.4rem minmax(0,1fr)', gap: 1, fontSize: '0.6rem', lineHeight: 1.6 }}>
                                    <Box component="span" sx={{ color: 'text.disabled' }}>{relative(stage.at - first)}</Box>
                                    <Box component="span" sx={{ color: stage.lane === 'server' ? `rgb(${ROUTE_STYLE.copies.rgb})` : `rgb(${ROUTE_STYLE.punch.rgb})`, textTransform: 'uppercase' }}>
                                        {stage.lane}
                                    </Box>
                                    <Box component="span" sx={{ color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {stage.text}
                                        {stage.total ? ` · ${FileUtil.formatBytes(stage.loaded || 0)}/${FileUtil.formatBytes(stage.total)}` : ''}
                                        {stage.tookMs ? ` · ${formatDuration(stage.tookMs)}` : ''}
                                        {stage.why && index === row.stages.findIndex(item => item.why === stage.why) ? ` · ${stage.why}` : ''}
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
}

TransferRow.propTypes = { row: PropTypes.object.isRequired };

/**
 * Every photo this device sent or received, as stages, sources and the share
 * that went browser to browser — and, when it didn't, why.
 */
function TransfersView({ master }) {
    const [, bump] = useReducer(value => value + 1, 0);
    useEffect(() => {
        const timer = setInterval(bump, REFRESH_MS);
        const unsubscribe = master.ledger?.subscribe?.(bump);
        return () => {
            clearInterval(timer);
            unsubscribe?.();
        };
    }, [master]);

    const input = readInput(master);
    const rows = readTransfers(input);
    const sum = totals(rows);
    const split = describeSplit(sum);
    const mePeer = input.peers.find(peer => peer.peerId === input.myPeerId);
    const verdict = verdictFor(summarizeChain(mePeer?.networkChain?.length ? mePeer.networkChain : input.localNetwork), { hasTurn: input.hasTurn });
    const headline = [
        { kind: 'lan', label: 'P2P direct', bytes: sum.p2p },
        { kind: 'relay', label: 'TURN relay', bytes: sum.relay },
        { kind: 'server', label: 'server copy', bytes: sum.server },
    ];

    return (
        <Box data-testid="transfers" sx={{ fontFamily: mono, fontSize: '0.68rem' }}>
            <Box sx={{ px: 1, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                    <Box component="span" sx={{ color: 'text.disabled', letterSpacing: '0.06em' }}>THIS SESSION</Box>
                    <Box component="span" sx={{ color: 'text.primary' }}>{FileUtil.formatBytes(sum.total)} moved</Box>
                    <Box component="span" sx={{ color: LEVEL_COLOR[split.level] }}>{split.text}</Box>
                </Box>
                <SourceBar
                    sources={headline.filter(item => item.bytes > 0).map(item => ({ ...item, peerId: item.kind, how: item.label }))}
                    total={sum.total}
                    height={6}
                />
                <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, fontSize: '0.6rem', color: 'text.secondary' }}>
                    {headline.map(item => (
                        <Box component="span" key={item.kind} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                            <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: `rgb(${SOURCE_RGB[item.kind]})` }} />
                            {`${item.label} ${FileUtil.formatBytes(item.bytes)}`}
                        </Box>
                    ))}
                </Box>
                <Typography sx={{ fontFamily: mono, fontSize: '0.6rem', color: 'text.secondary', lineHeight: 1.45 }}>
                    <Box component="span" sx={{ color: 'text.disabled' }}>your link </Box>{verdict.text}
                </Typography>
            </Box>
            {rows.length ? (
                <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none' }}>
                    {rows.map(row => <TransferRow key={row.infoHash} row={row} />)}
                </Box>
            ) : (
                <Typography sx={{ display: 'block', p: 1.5, fontFamily: mono, fontSize: '0.68rem', color: 'text.disabled' }}>
                    no transfers yet · share a photo, or open the room on a second device
                </Typography>
            )}
        </Box>
    );
}

TransfersView.propTypes = {
    master: PropTypes.object.isRequired,
};

export default TransfersView;
