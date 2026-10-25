import { describe, it, expect } from 'vitest';
import { pieceGrids } from './PieceGrid';

const log = [
    { torrent: 'thumb', name: 'Thumbnail a.jpg', total: 1, index: 0, peerId: 'p1', kind: 'rx', at: 100 },
    { torrent: 'full', name: 'a.jpg', total: 4, index: 2, peerId: 'p1', kind: 'rx', at: 200 },
    { torrent: 'full', name: 'a.jpg', total: 4, index: 0, peerId: 'p2', kind: 'rx', at: 300 },
    { torrent: 'full', name: 'a.jpg', total: 4, index: 2, peerId: 'p2', kind: 'rx', at: 400 },
    { torrent: 'full', name: 'a.jpg', total: 4, index: 1, peerId: 'p3', kind: 'tx', at: 500 },
];

describe('pieceGrids', () => {
    it('keeps one grid per torrent, the photo before its thumbnail, cells by first sender', () => {
        const { grids, peers } = pieceGrids(log, 'down');
        expect(grids.map(grid => grid.torrent)).toEqual(['full', 'thumb']);
        expect(peers).toEqual(['p1', 'p2']);
        const full = grids[0];
        expect(full.cells.size).toBe(2);
        // Piece 2 came from p1 first; a second copy does not repaint it.
        expect(full.cells.get(2).peerId).toBe('p1');
    });

    it('shows only what had moved by the moment on screen', () => {
        const { grids } = pieceGrids(log, 'down', 250);
        expect(grids.find(grid => grid.torrent === 'full').cells.size).toBe(1);
    });

    it('reads sent pieces for a share going out', () => {
        const { grids, peers } = pieceGrids(log, 'up');
        expect(peers).toEqual(['p3']);
        expect([...grids[0].cells.keys()]).toEqual([1]);
    });
});
