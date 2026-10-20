import { describe, it, expect } from 'vitest';
import { onAndroid } from './androidUpload';

const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

describe('onAndroid', () => {
    it('recognises Android from client hints or the user agent', () => {
        expect(onAndroid({ userAgent: ANDROID })).toBe(true);
        expect(onAndroid({ userAgent: DESKTOP })).toBe(false);
        expect(onAndroid({ userAgent: ANDROID, userAgentData: { platform: 'Android' } })).toBe(true);
        expect(onAndroid({ userAgent: DESKTOP, userAgentData: { platform: 'Linux' } })).toBe(false);
        expect(onAndroid(undefined)).toBe(false);
    });
});
