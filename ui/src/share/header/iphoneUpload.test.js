import { describe, it, expect } from 'vitest';
import { onIPhone } from './iphoneUpload';
import { ACCEPT } from './androidUpload';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

describe('onIPhone', () => {
    it('recognises iPhones and iPads, also iPads that say they are a Mac', () => {
        expect(onIPhone({ userAgent: IPHONE })).toBe(true);
        expect(onIPhone({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe(true);
        expect(onIPhone({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe(false);
        expect(onIPhone({ userAgent: ANDROID })).toBe(false);
        expect(onIPhone(undefined)).toBe(false);
    });
});

describe('ACCEPT on iPhone', () => {
    it('allows every image type, so Safari keeps HEIC originals', () => {
        const types = ACCEPT.split(',');
        expect(types).toContain('image/*');
        // A single image type makes Safari convert; image/heic makes Safari 17 turn JPEG into HEIC.
        expect(types.filter(type => type.startsWith('image/') && type !== 'image/*')).toEqual([]);
    });
});
