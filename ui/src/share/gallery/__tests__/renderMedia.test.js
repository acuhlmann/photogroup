import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderMedia } from '../RenderContent';

const opts = { autoplay: false, muted: true, loop: true };

describe('renderMedia', () => {
    let node;

    beforeEach(() => {
        node = document.createElement('div');
        document.body.appendChild(node);
        URL.createObjectURL = vi.fn(() => 'blob:mock');
    });

    it('plays the local file when WebTorrent has no appendTo', async () => {
        const local = new Blob(['x'], { type: 'video/mp4' });
        const file = { blob: vi.fn() };
        const elem = await new Promise((resolve, reject) =>
            renderMedia({ isVideo: true, file: local }, file, node, opts, (err, el) => err ? reject(err) : resolve(el)));

        expect(elem.tagName).toBe('VIDEO');
        expect(elem.src).toBe('blob:mock');
        expect(node.firstChild).toBe(elem);
        expect(URL.createObjectURL).toHaveBeenCalledWith(local);
        expect(file.blob).not.toHaveBeenCalled();
    });

    it('waits for the downloaded blob on a receiving peer', async () => {
        const downloaded = new Blob(['y'], { type: 'video/mp4' });
        const file = { blob: vi.fn(() => Promise.resolve(downloaded)) };
        const elem = await new Promise((resolve, reject) =>
            renderMedia({ isVideo: true }, file, node, opts, (err, el) => err ? reject(err) : resolve(el)));

        expect(elem.tagName).toBe('VIDEO');
        expect(URL.createObjectURL).toHaveBeenCalledWith(downloaded);
    });

    it('reports a failure instead of throwing', async () => {
        const file = { appendTo: () => { throw new Error('boom'); } };
        const err = await new Promise(resolve => renderMedia({ isVideo: true }, file, node, opts, resolve));
        expect(err.message).toBe('boom');
    });
});
