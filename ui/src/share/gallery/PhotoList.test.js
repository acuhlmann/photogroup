import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../../theme';
import PhotoList, { groupByDay, sameRow, sharerLabel, takenLabel } from './PhotoList';

vi.mock('./RenderContent', () => ({ default: ({ tile }) => <img alt={tile.fileName} src={tile.img} /> }));
vi.mock('./LoadingTile', () => ({ default: () => <div>Arriving</div> }));
vi.mock('./PhotoDetails', () => ({ default: ({ tile }) => <div data-testid="details-of">{tile.fileName}</div> }));
const saveToDevice = vi.hoisted(() => vi.fn(() => Promise.resolve('saved')));
vi.mock('./saveToDevice', async original => ({ ...(await original()), saveToDevice, saveWay: () => 'download' }));

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

    it('leaves the list as it is while a photo is full screen, then picks the one seen last', () => {
        matchMedia(false);
        const render = openKey => act(() => root.render(
            <ThemeProvider theme={createAppTheme('light')}>
                <PhotoList master={master} tiles={[a, b]} facts={facts} roomTiles={[a, b]} sort="added"
                    onSort={() => {}} onOpen={() => {}} onRemove={() => {}} openKey={openKey} />
            </ThemeProvider>));
        show();
        const rows = () => [...div.querySelectorAll('[data-testid="photo-row"] [aria-expanded]')].map(row => row.getAttribute('aria-expanded'));
        // Opening a photo, and swiping to the next, opens no row behind it:
        // a row opening under the fading-in photo was the flicker.
        render('a');
        expect(rows()).toEqual(['false', 'false']);
        render('b');
        expect(rows()).toEqual(['false', 'false']);
        expect(div.querySelector('[data-testid="details-of"]')).toBeNull();
        // Back in the list, the photo seen last is open.
        render(null);
        expect(rows()).toEqual(['false', 'true']);
    });

    it('keeps the same rows when the width jitters over the fold breakpoint, and switches on a real crossing', () => {
        // Unfolded foldable: about 880 CSS px, just under the 900 px breakpoint.
        matchMedia(false);
        Object.defineProperty(window, 'innerWidth', { value: 880, configurable: true });
        show();
        const resizeTo = width => act(() => {
            Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
            window.dispatchEvent(new Event('resize'));
        });
        const row = div.querySelectorAll('[data-testid="photo-row"]')[0];
        expect(div.querySelector('[data-testid="list-details"]')).toBeNull();
        // Chrome, a scrollbar or a half-fold nudging the width over 900 and
        // back must not remount the rows (that remount is the flicker).
        for (const width of [905, 895, 915, 885]) resizeTo(width);
        expect(div.querySelectorAll('[data-testid="photo-row"]')[0]).toBe(row);
        expect(div.querySelector('[data-testid="list-details"]')).toBeNull();
        // Folding shut / a real resize crosses the band and switches once.
        resizeTo(1000);
        expect(div.querySelector('[data-testid="list-details"]')).not.toBeNull();
        const wideRow = div.querySelectorAll('[data-testid="photo-row"]')[0];
        for (const width of [910, 890, 905]) resizeTo(width);
        expect(div.querySelectorAll('[data-testid="photo-row"]')[0]).toBe(wideRow);
        resizeTo(800);
        expect(div.querySelector('[data-testid="list-details"]')).toBeNull();
    });

    it('shows the picked photo in a box of one height, from its preview, so opening a row moves nothing under it', () => {
        matchMedia(false);
        // The sharp copy is still being made.
        vi.stubGlobal('createImageBitmap', () => new Promise(() => {}));
        const withPreview = { ...a, infoHash: 'a-preview', previewUrl: 'blob:preview-a', elem: new Blob(['x'], { type: 'image/jpeg' }) };
        show({ tiles: [withPreview, b], roomTiles: [withPreview, b], facts: new Map([[withPreview, facts.get(a)], [b, facts.get(b)]]) });
        act(() => div.querySelectorAll('[data-testid="photo-row"] [aria-expanded]')[0].click());
        const box = div.querySelector('[data-testid="list-preview"] [aria-label="Full screen a.jpg"]');
        expect(getComputedStyle(box).height).toBe('300px');
        const img = box.querySelector('img');
        // Letterboxed like the full screen view; the full photo is not decoded here.
        expect(getComputedStyle(img).objectFit).toBe('contain');
        expect(img.getAttribute('src')).toBe('blob:preview-a');
        vi.unstubAllGlobals();
    });
});

describe('PhotoList selection', () => {
    const c = { infoHash: 'c', fileName: 'c.jpg', fileSize: '1 MB', isImage: true, img: 'blob:c', peerId: 'me' };
    const here = tile => ({ ...tile, elem: new Blob(['x'], { type: 'image/jpeg' }) });
    const [ha, hb, hc] = [here(a), here(b), here(c)];
    const threeFacts = new Map([[ha, facts.get(a)], [hb, facts.get(b)], [hc, { ...facts.get(b), rating: 5 }]]);
    const showThree = () => show({ tiles: [ha, hb, hc], roomTiles: [ha, hb, hc], facts: threeFacts });
    const box = name => div.querySelector(`input[aria-label="Select ${name}"]`);
    const bar = () => div.querySelector('[data-testid="selection-bar"]');
    const click = (node, init = {}) => act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })));

    it('selects photos with their boxes and saves them all with one Save', async () => {
        matchMedia(true);
        saveToDevice.mockClear();
        showThree();
        expect(bar()).toBeNull();
        click(box('a.jpg'));
        click(box('c.jpg'));
        expect(bar().textContent).toContain('2 selected');
        expect(bar().textContent).toContain('One zip file goes to the Downloads folder of this computer.');
        // A box does not pick the row for the details.
        expect(div.querySelector('[data-testid="list-details"]').textContent).toContain('a.jpg');
        click(box('a.jpg'));
        expect(bar().textContent).toContain('1 selected');
        click(box('a.jpg'));
        const save = [...bar().querySelectorAll('button')].find(button => button.textContent === 'Save 2');
        await act(async () => { save.click(); });
        // In the list's order.
        expect(saveToDevice).toHaveBeenCalledWith([ha, hc], { roomId: 'room' });
        expect(bar().textContent).toContain('Saved');
        act(() => bar().querySelector('button[aria-label="Clear the selection"]').click());
        expect(bar()).toBeNull();
    });

    it('selects a range with Shift, all photos, or the rated ones', () => {
        matchMedia(true);
        showThree();
        click(box('a.jpg'));
        click(box('c.jpg'), { shiftKey: true });
        expect(bar().textContent).toContain('3 selected');
        const all = div.querySelector('label input[type="checkbox"]');
        expect(all.checked).toBe(true);
        click(all);
        expect(bar()).toBeNull();
        // a.jpg has 4 stars and c.jpg 5; b.jpg has none.
        const rated = [...div.querySelectorAll('button')].find(button => button.textContent === 'Select rated photos (2)');
        act(() => rated.click());
        expect(bar().textContent).toContain('2 selected');
        expect(box('a.jpg').checked).toBe(true);
        expect(box('b.jpg').checked).toBe(false);
        expect(box('c.jpg').checked).toBe(true);
    });

    it('leaves photos still arriving out of the save, and says so', () => {
        matchMedia(false);
        const arriving = { ...b, loading: true };
        show({ tiles: [ha, arriving], roomTiles: [ha, arriving], facts: new Map([[ha, facts.get(a)], [arriving, facts.get(b)]]) });
        click(box('a.jpg'));
        click(box('b.jpg'));
        expect(bar().textContent).toContain('2 selected');
        expect(bar().textContent).toContain('Save 1');
        expect(bar().textContent).toContain('1 photo is still arriving. It is not included.');
    });

    it('toggles the focused row with Space on a wide screen', () => {
        matchMedia(true);
        showThree();
        const row = div.querySelectorAll('[data-testid="photo-row"]')[1];
        act(() => row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
        expect(box('b.jpg').checked).toBe(true);
    });
});

describe('sameRow', () => {
    const tile = { infoHash: 'a' };
    it('skips a redraw when only the facts object is new', () => {
        expect(sameRow({ tile, open: false, fact: { camera: 'X', keywords: [] } },
            { tile, open: false, fact: { camera: 'X', keywords: [] } })).toBe(true);
    });
    it('redraws when the photo, its facts or the open state change', () => {
        expect(sameRow({ tile, fact: { camera: 'X' } }, { tile: { ...tile }, fact: { camera: 'X' } })).toBe(false);
        expect(sameRow({ tile, fact: { camera: 'X' } }, { tile, fact: { camera: 'Y' } })).toBe(false);
        expect(sameRow({ tile, open: false }, { tile, open: true })).toBe(false);
    });
});
