import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../../theme';
import PhotoList, { groupByDay, sharerLabel, takenLabel } from './PhotoList';

vi.mock('./RenderContent', () => ({ default: ({ tile }) => <img alt={tile.fileName} src={tile.img} /> }));
vi.mock('./LoadingTile', () => ({ default: () => <div>Arriving</div> }));
vi.mock('./PhotoDetails', () => ({ default: ({ tile }) => <div data-testid="details-of">{tile.fileName}</div> }));

const matchMedia = wide => {
    window.matchMedia = query => ({
        matches: wide ? query.includes('min-width') : !query.includes('min-width'),
        media: query, addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
    });
};

const master = {
    emitter: { on: () => {}, removeListener: () => {}, emit: () => {} },
    client: { peerId: 'me' },
    peers: { items: [{ peerId: 'ana', name: 'Ana' }] },
    service: { id: 'room' },
};
const a = { infoHash: 'a', fileName: 'a.jpg', fileSize: '2 MB', isImage: true, img: 'blob:a', peerId: 'me' };
const b = { infoHash: 'b', fileName: 'b.jpg', fileSize: '3 MB', isImage: true, img: 'blob:b', peerId: 'ana' };
const facts = new Map([
    [a, { title: 'Harbour', rating: 4, takenAt: new Date('2026-10-26T18:42:00').getTime(), camera: 'Fujifilm X-T5', lens: 'XF 35mm', exposure: 'ƒ/2 · 1/250 s · ISO 400', place: 'Zurich' }],
    [b, { title: '', rating: 0, takenAt: null, camera: '', lens: '', exposure: '', place: null }],
]);

let root;
let div;
function show(props = {}) {
    div = document.createElement('div');
    document.body.appendChild(div);
    root = createRoot(div);
    const all = { master, tiles: [a, b], facts, roomTiles: [a, b], sort: 'added', onSort: () => {}, onOpen: () => {}, onRemove: () => {}, ...props };
    act(() => root.render(<ThemeProvider theme={createAppTheme('light')}><PhotoList {...all} /></ThemeProvider>));
}
afterEach(() => {
    if (root) act(() => root.unmount());
    if (div) div.remove();
    root = null;
    div = null;
});

describe('PhotoList helpers', () => {
    it('groups by day only when sorted by date taken', () => {
        expect(groupByDay([a, b], facts, 'added')).toEqual([{ label: null, tiles: [a, b] }]);
        expect(groupByDay([a, b], facts, 'taken-desc').map(group => group.label)).toEqual(['Mon 26 Oct 2026', 'No date taken']);
    });

    it('names who shared a photo', () => {
        expect(sharerLabel(a, master)).toBe('You');
        expect(sharerLabel(b, master)).toBe('Ana');
        expect(takenLabel(null)).toBe('');
    });
});

describe('PhotoList', () => {
    it('shows a row per photo with its camera details, and the first photo\'s details beside the list', () => {
        matchMedia(true);
        show();
        const rows = div.querySelectorAll('[data-testid="photo-row"]');
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('Harbour');
        expect(rows[0].textContent).toContain('Fujifilm X-T5');
        expect(rows[0].textContent).toContain('XF 35mm');
        expect(rows[0].textContent).toContain('ƒ/2 · 1/250 s');
        expect(rows[0].textContent).toContain('ISO 400');
        expect(rows[0].textContent).toContain('26 Oct 2026, 18:42');
        expect(rows[1].textContent).toContain('b.jpg');
        expect(div.querySelector('[data-testid="list-details"]').textContent).toContain('a.jpg');
    });

    it('picks a row for the details, and opens full screen from the thumbnail', () => {
        matchMedia(true);
        const onOpen = vi.fn();
        const onRemove = vi.fn();
        show({ onOpen, onRemove });
        act(() => div.querySelectorAll('[data-testid="photo-row"]')[1].click());
        const aside = div.querySelector('[data-testid="list-details"]');
        expect(aside.textContent).toContain('b.jpg');
        act(() => aside.querySelector('button[aria-label="Remove b.jpg"]').click());
        expect(onRemove).toHaveBeenCalledWith(b);
        act(() => div.querySelector('button[aria-label="View a.jpg"]').click());
        expect(onOpen).toHaveBeenCalledWith(a);
    });

    it('sorts from the column headers', () => {
        matchMedia(true);
        const onSort = vi.fn();
        show({ onSort, sort: 'taken-desc' });
        const header = name => [...div.querySelectorAll('th')].find(th => th.textContent.startsWith(name)).querySelector('[role="button"], button, span');
        act(() => header('Taken').click());
        expect(onSort).toHaveBeenLastCalledWith('taken-asc');
        act(() => header('Camera').click());
        expect(onSort).toHaveBeenLastCalledWith('camera');
        // Sorted by date, the rows sit under day headings.
        expect(div.textContent).toContain('Mon 26 Oct 2026 · 1 photo');
    });

    it('on a phone, opens the details under the row that is tapped', () => {
        matchMedia(false);
        show();
        expect(div.querySelector('[data-testid="details-of"]')).toBeNull();
        const toggle = div.querySelectorAll('[data-testid="photo-row"] [aria-expanded]')[0];
        act(() => toggle.click());
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(div.querySelector('[data-testid="details-of"]').textContent).toBe('a.jpg');
    });
});
