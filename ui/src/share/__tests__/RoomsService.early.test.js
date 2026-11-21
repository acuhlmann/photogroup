import { describe, expect, it } from 'vitest';
import { takeEarly } from '../RoomsService';

describe('takeEarly', () => {
    it('gives a request that index.html started once, then null', async () => {
        const win = { __pgEarly: { rtc: Promise.resolve({ iceServers: [] }) } };
        await expect(takeEarly('rtc', win)).resolves.toEqual({ iceServers: [] });
        expect(takeEarly('rtc', win)).toBeNull();
    });

    it('gives null when the page started no request', () => {
        expect(takeEarly('rtc', {})).toBeNull();
        expect(takeEarly('rtc', null)).toBeNull();
    });
});
