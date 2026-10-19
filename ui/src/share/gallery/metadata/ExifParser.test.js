import { describe, it, expect } from 'vitest';
import ExifParser from './ExifParser';

describe('ExifParser', () => {
    it('builds exposure and pixel size from what exifr returns', () => {
        // exifr: plain numbers, "ISO", ExifImageWidth/Height
        const data = {
            Make: 'Google', Model: 'Pixel 9 Pro Fold',
            ExposureTime: 0.008, FNumber: 1.8, ISO: 100, FocalLength: 6.4, FocalLengthIn35mmFormat: 26,
            ExifImageWidth: 4000, ExifImageHeight: 3000,
        };
        ExifParser.parse(data);
        expect(data['x-Settings']).toBe('ƒ/1.8 · 1/125 s · ISO 100 · 26 mm');
        expect(data['x-Pixel Size']).toBe('4000 x 3000');
        expect(data['x-Camera']).toBe('Google Pixel 9 Pro Fold');
    });

    it('still reads fraction values and ISOSpeedRatings', () => {
        const data = {
            ExposureTime: { numerator: 1, denominator: 60 }, FNumber: { numerator: 28, denominator: 10 },
            ISOSpeedRatings: 400, FocalLength: 35,
        };
        ExifParser.parse(data);
        expect(data['x-Settings']).toBe('ƒ/2.8 · 1/60 s · ISO 400 · 35 mm');
    });
});
