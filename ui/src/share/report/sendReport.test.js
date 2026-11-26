import { describe, it, expect, vi } from 'vitest';
import { sendReport, sendErrorText, REPORTS_URL } from './sendReport';

const reply = (status, body) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });

describe('sendReport', () => {
    it('posts the report as text and answers its number', async () => {
        const fetchImpl = vi.fn(() => reply(200, { id: 'K7QX-M2PA' }));
        await expect(sendReport({ app: 'PhotoGroup' }, { fetchImpl })).resolves.toEqual({ id: 'K7QX-M2PA' });
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe(REPORTS_URL);
        expect(init.method).toBe('POST');
        expect(init.headers['Content-Type']).toMatch(/^text\/plain/);
        expect(JSON.parse(init.body)).toEqual({ app: 'PhotoGroup' });
    });

    it('says what to do when the server does not answer or says no', async () => {
        await expect(sendReport({}, { fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) }))
            .rejects.toMatchObject({ status: 0, message: sendErrorText(0) });
        await expect(sendReport({}, { fetchImpl: () => reply(429, {}) }))
            .rejects.toMatchObject({ status: 429, message: expect.stringMatching(/one hour/) });
        await expect(sendReport({}, { fetchImpl: () => reply(502, {}) }))
            .rejects.toMatchObject({ status: 502, message: expect.stringMatching(/Save it as a file/) });
    });
});
