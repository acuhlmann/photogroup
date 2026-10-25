import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';

const mono = 'var(--font-mono)';
// One colour per peer, in the order they first sent or received a piece.
const PEER_RGB = ['61,222,139', '96,165,250', '245,185,66', '232,121,249', '45,212,191', '255,93,115', '167,139,250', '250,204,21'];
const CELL = 7;
const GAP = 1;
// More pieces than this share a cell, so a long video still fits.
const MAX_CELLS = 1024;
// A piece this new is drawn bright, so you see where the swarm is working.
const FRESH_MS = 800;

/**
 * Each torrent of a photo (the photo, its thumbnail) as a grid of its
 * pieces, read from the pieces this device received or sent up to `at`.
 * Received: a cell takes the colour of the peer that sent it. Sent: the
 * colour of the last peer it went to. Empty cells did not move over a wire
 * by then.
 */
export function pieceGrids(log, direction, at = Infinity) {
    const kind = direction === 'down' ? 'rx' : 'tx';
    const byTorrent = new Map();
    const peers = [];
    log.forEach(item => {
        if (item.kind !== kind || item.at > at || !item.total) return;
        let grid = byTorrent.get(item.torrent);
        if (!grid) {
            grid = { torrent: item.torrent, name: item.name, total: item.total, cells: new Map() };
            byTorrent.set(item.torrent, grid);
        }
        if (!peers.includes(item.peerId)) peers.push(item.peerId);
        // Received once is enough; sent, the newest receiver is the news.
        if (kind === 'rx' && grid.cells.has(item.index)) return;
        const before = grid.cells.get(item.index);
        grid.cells.set(item.index, { peerId: item.peerId, at: item.at, times: (before?.times || 0) + 1 });
    });
    // The photo first, its thumbnail after.
    const grids = [...byTorrent.values()].sort((a, b) => b.total - a.total);
    return { grids, peers };
}

function Grid({ grid, peers, at }) {
    const ref = useRef(null);
    const theme = useTheme();
    const empty = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    useEffect(() => {
        const canvas = ref.current;
        const ctx = canvas?.getContext?.('2d');
        if (!ctx) return;
        const width = canvas.parentElement?.clientWidth || 300;
        const per = Math.ceil(grid.total / MAX_CELLS);
        const count = Math.ceil(grid.total / per);
        const cols = Math.max(1, Math.floor((width + GAP) / (CELL + GAP)));
        const rows = Math.ceil(count / cols);
        const height = rows * (CELL + GAP);
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.height = height + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const now = Number.isFinite(at) ? at : Date.now();
        for (let cell = 0; cell < count; cell++) {
            // A shared cell shows the newest piece in it.
            let piece = null;
            for (let index = cell * per; index < Math.min(grid.total, (cell + 1) * per); index++) {
                const item = grid.cells.get(index);
                if (item && (!piece || item.at > piece.at)) piece = item;
            }
            const x = (cell % cols) * (CELL + GAP);
            const y = Math.floor(cell / cols) * (CELL + GAP);
            if (!piece) {
                ctx.fillStyle = empty;
            } else {
                const rgb = PEER_RGB[peers.indexOf(piece.peerId) % PEER_RGB.length];
                const fresh = now - piece.at < FRESH_MS;
                ctx.fillStyle = `rgba(${rgb},${fresh ? 1 : 0.75})`;
                if (fresh) {
                    ctx.shadowColor = `rgb(${rgb})`;
                    ctx.shadowBlur = 6;
                }
            }
            ctx.fillRect(x, y, CELL, CELL);
            ctx.shadowBlur = 0;
        }
    });
    return <Box component="canvas" ref={ref} aria-hidden="true" sx={{ display: 'block', width: '100%' }} />;
}

Grid.propTypes = { grid: PropTypes.object.isRequired, peers: PropTypes.array.isRequired, at: PropTypes.number };

/** The pieces of one transfer, with who each came from or went to. */
export default function PieceGrid({ log, direction, at, names = {} }) {
    const { grids, peers } = pieceGrids(log, direction, at);
    if (!grids.length) return null;
    const verb = direction === 'down' ? 'from' : 'to';
    return (
        <Box data-testid="piece-grid" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {grids.map(grid => (
                <Box key={grid.torrent}>
                    <Box sx={{ fontFamily: mono, fontSize: '0.6rem', color: 'text.secondary', mb: 0.25 }}>
                        <Box component="span" sx={{ color: 'text.disabled' }}>pieces </Box>
                        {`${grid.name || String(grid.torrent || '').slice(0, 8)} · ${grid.cells.size}/${grid.total} ${direction === 'down' ? 'received' : 'sent'} over a wire`}
                        {grid.total > MAX_CELLS ? ` · ${Math.ceil(grid.total / MAX_CELLS)} per cell` : ''}
                    </Box>
                    <Grid grid={grid} peers={peers} at={at} />
                </Box>
            ))}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, fontFamily: mono, fontSize: '0.6rem', color: 'text.secondary' }}>
                {/* With one peer the colour needs no key: the sources line names it. */}
                {peers.length > 1 && <Box component="span" sx={{ color: 'text.disabled' }}>{verb}</Box>}
                {peers.length > 1 && peers.map((peerId, index) => (
                    <Box component="span" key={peerId} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                        <Box component="span" sx={{ width: 7, height: 7, bgcolor: `rgb(${PEER_RGB[index % PEER_RGB.length]})` }} />
                        {names[peerId] || `peer ${String(peerId).slice(0, 8)}`}
                    </Box>
                ))}
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    <Box component="span" sx={{ width: 7, height: 7, bgcolor: 'action.hover', border: 1, borderColor: 'divider' }} />
                    {direction === 'down' ? 'not received from a peer yet' : 'not sent yet'}
                </Box>
            </Box>
        </Box>
    );
}

PieceGrid.propTypes = {
    log: PropTypes.array.isRequired,
    direction: PropTypes.string,
    at: PropTypes.number,
    names: PropTypes.object,
};
