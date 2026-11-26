import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ProblemReport, { reportHoldsText, sentText, PRIVATE_NOTE, ProblemReportLink, REPORT_TITLE } from './ProblemReport';

const button = text => Array.from(document.body.querySelectorAll('button')).find(item => item.textContent.trim() === text);

async function render(element) {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => root.render(element));
    return async () => {
        await act(async () => root.unmount());
        div.remove();
    };
}

async function type(text) {
    const area = document.body.querySelector('textarea');
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(area, text);
        area.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

const master = { device: 'Chrome on Pixel 8', peers: { items: [] }, roomPhotos: { all: () => [] }, client: { torrents: [] } };

describe('ProblemReport', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('sends what the person wrote and shows the report number', async () => {
        const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'K7QX-M2PA' }) }));
        vi.stubGlobal('fetch', fetchMock);
        const unmount = await render(<ProblemReport master={master} open onClose={() => {}} inRoom />);
        expect(document.body.textContent).toContain(reportHoldsText({ inRoom: true }));
        await type('My friend does not get my photos');
        await act(async () => button('Send').click());
        const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(sent.note).toBe('My friend does not get my photos');
        expect(sent.device.name).toBe('Chrome on Pixel 8');
        expect(document.body.textContent).toContain(sentText('K7QX-M2PA'));
        await unmount();
    });

    it('offers the file when the server does not get it', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
        const created = vi.fn(() => 'blob:x');
        vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: created, revokeObjectURL: () => {} }));
        const unmount = await render(<ProblemReport master={master} open onClose={() => {}} />);
        await act(async () => button('Send').click());
        expect(document.body.textContent).toContain('The server did not get the report. Save it as a file');
        await act(async () => button('Save as a file').click());
        expect(created).toHaveBeenCalled();
        expect(document.body.textContent).toMatch(/Saved as photogroup-report-.*\.json/);
        await unmount();
    });

    it('says what a private room report does not include', () => {
        expect(reportHoldsText({ inRoom: true, isPrivate: true })).toContain(PRIVATE_NOTE);
        expect(reportHoldsText({ inRoom: true, isPrivate: true })).not.toMatch(/names and IP/);
        expect(reportHoldsText({ inRoom: false })).not.toMatch(/IP addresses/);
    });

    it('opens from the front page link', async () => {
        const unmount = await render(<ProblemReportLink master={master} />);
        await act(async () => button(REPORT_TITLE).click());
        expect(document.body.querySelector('#problem-report-title').textContent).toContain(REPORT_TITLE);
        await unmount();
    });
});
