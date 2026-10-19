import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import StringUtil from '../util/StringUtil';
import {
    NAT_LABELS, describeIceServers, forecastPath, summarizeChain, verdictFor,
} from './NetworkInsight';

const mono = { fontFamily: 'var(--font-mono)' };
const LEVEL_COLOR = { good: 'success.main', ok: 'warning.main', poor: 'error.main', unknown: 'text.disabled' };
const MAX_EVENTS = 6;
// Browsers give up on unreachable STUN servers after roughly this long.
const STUN_GRACE_MS = 12000;

// Panels mount after ICE already ran, so start from what master has cached.
function readState(master) {
    const myPeerId = master.client && master.client.peerId;
    const items = (master.peers && master.peers.items) || [];
    const mePeer = items.find(p => p.peerId === myPeerId);
    const myChain = mePeer && mePeer.networkChain && mePeer.networkChain.length ? mePeer.networkChain : master.localNetwork;
    const rtc = master.creator && master.creator.iceServers;
    return {
        mine: summarizeChain(myChain),
        servers: describeIceServers(rtc),
        others: items.filter(p => p.peerId !== myPeerId).map(p => ({
            peerId: p.peerId,
            name: p.name || StringUtil.slimPlatform(p.originPlatform || '') || 'peer',
            summary: summarizeChain(p.networkChain),
        })),
    };
}

function Row({ k, children }) {
    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: '4.5rem minmax(0, 1fr)', gap: 1, py: '2px' }}>
            <Typography variant="caption" sx={{ ...mono, fontSize: '0.6rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: '0.06em', pt: '1px' }}>
                {k}
            </Typography>
            <Typography component="div" variant="caption" sx={{ ...mono, fontSize: '0.7rem', wordBreak: 'break-word', lineHeight: 1.45 }}>
                {children}
            </Typography>
        </Box>
    );
}

/**
 * What this device learned about its network while joining, and how a
 * transfer to each person in the room is likely to travel.
 */
function NetworkReadout({ master, sx }) {
    const [state, setState] = useState(() => readState(master));
    const [events, setEvents] = useState([]);
    const [stunDone, setStunDone] = useState(false);
    const startRef = useRef(Date.now());

    useEffect(() => {
        const emitter = master.emitter;
        const refresh = () => setState(readState(master));
        const onPcEvent = (type, value) => {
            if (!value) return;
            if (type === 'icegatheringstatechange' && value === 'complete') setStunDone(true);
            const label = type.replace('statechange', '');
            setEvents(prev => [...prev, { id: Date.now() + Math.random(), t: Date.now() - startRef.current, text: label + ' → ' + value }].slice(-MAX_EVENTS));
        };
        const grace = setTimeout(() => setStunDone(true), STUN_GRACE_MS);
        emitter.on('localNetwork', refresh);
        emitter.on('peers', refresh);
        emitter.on('iceDone', refresh);
        emitter.on('pcEvent', onPcEvent);
        return () => {
            clearTimeout(grace);
            emitter.removeListener('localNetwork', refresh);
            emitter.removeListener('peers', refresh);
            emitter.removeListener('iceDone', refresh);
            emitter.removeListener('pcEvent', onPcEvent);
        };
    }, [master]);

    const { mine, servers, others } = state;
    const hasTurn = servers.turn.length > 0;
    const stunPending = !stunDone && mine.publicIps.length === 0;
    const verdict = verdictFor(mine, { hasTurn, stunPending });

    return (
        <Box data-testid="network-readout" sx={{
            // Bottom margin keeps the floating People button off the last lines.
            mt: 2, mb: 9, p: 1.5, borderRadius: 2, textAlign: 'left',
            border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper',
            ...sx,
        }}>
            <Typography className="tech-text" sx={{ color: 'primary.main', mb: 0.75 }}>
                Your link, as ICE sees it
            </Typography>

            <Row k="lan">
                {mine.hostCount === 0 ? '—' : (
                    <>
                        {mine.hostCount} host candidate{mine.hostCount > 1 ? 's' : ''}
                        {mine.lanIps.length > 0 && ' · ' + mine.lanIps.slice(0, 2).join(', ')}
                        {mine.mdnsCount > 0 && (
                            <Box component="span" sx={{ color: 'text.secondary' }}>
                                {' · '}{mine.mdnsCount} masked as mDNS .local (browser hides your LAN IP)
                            </Box>
                        )}
                        {mine.cgnat && <Box component="span" sx={{ color: 'warning.main' }}> · CGNAT 100.64/10: your ISP adds a second NAT</Box>}
                    </>
                )}
            </Row>
            <Row k="public">
                {mine.reflexive.length === 0
                    ? (stunPending ? 'asking STUN…' : 'none: STUN did not answer')
                    : mine.reflexive.slice(0, 3).map(r => (
                        <Box key={r.ip + r.port}>
                            {r.ip}:{r.port}
                            {r.place && <Box component="span" sx={{ color: 'text.secondary' }}> · {r.place}</Box>}
                        </Box>
                    ))}
            </Row>
            <Row k="nat">{stunPending ? 'measuring…' : NAT_LABELS[mine.nat]}</Row>
            <Row k="stun">{servers.stun.length ? servers.stun.slice(0, 2).join(', ') + (servers.stun.length > 2 ? ' +' + (servers.stun.length - 2) : '') : '—'}</Row>
            <Row k="turn">
                {hasTurn
                    ? servers.turn.slice(0, 2).join(', ')
                    : <Box component="span" sx={{ color: 'text.secondary' }}>none · HTTPS server copy is the fallback</Box>}
            </Row>
            {(mine.transports.length > 0 || mine.ipv6) && (
                <Row k="stack">{mine.transports.join(' + ').toUpperCase()}{mine.ipv6 ? ' · IPv6' : ' · IPv4 only'}</Row>
            )}

            <Typography variant="caption" sx={{ display: 'block', mt: 1, lineHeight: 1.45, color: LEVEL_COLOR[verdict.level] }}>
                {verdict.text}
            </Typography>

            {others.length > 0 && (
                <Box sx={{ mt: 1.25 }}>
                    <Typography variant="caption" sx={{ ...mono, display: 'block', fontSize: '0.6rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.5 }}>
                        Path forecast
                    </Typography>
                    {others.map(o => {
                        const f = forecastPath(mine, o.summary, { hasTurn });
                        return (
                            <Box key={o.peerId} sx={{ py: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
                                <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', minWidth: 0 }}>
                                    <Box component="span" aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: LEVEL_COLOR[f.level], alignSelf: 'center' }} />
                                    <Typography variant="caption" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>{o.name}</Typography>
                                    <Typography variant="caption" sx={{ ...mono, fontSize: '0.65rem', color: LEVEL_COLOR[f.level], ml: 'auto', flexShrink: 0 }}>{f.label}</Typography>
                                </Box>
                                <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontSize: '0.66rem', lineHeight: 1.4, pl: 2 }}>
                                    {f.why}
                                </Typography>
                            </Box>
                        );
                    })}
                </Box>
            )}

            {events.length > 0 && (
                <Box sx={{ mt: 1, pt: 0.75, borderTop: '1px dashed', borderColor: 'divider' }} role="log" aria-label="ICE state changes">
                    {events.map(e => (
                        <Typography key={e.id} component="div" variant="caption" sx={{ ...mono, fontSize: '0.58rem', color: 'text.secondary' }}>
                            <Box component="span" sx={{ color: 'text.disabled', mr: 0.5 }}>+{(e.t / 1000).toFixed(1)}s</Box>{e.text}
                        </Typography>
                    ))}
                </Box>
            )}
        </Box>
    );
}

NetworkReadout.propTypes = {
    master: PropTypes.object.isRequired,
    sx: PropTypes.object,
};

export default NetworkReadout;
