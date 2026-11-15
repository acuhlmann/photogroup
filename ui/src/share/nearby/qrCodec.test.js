import { describe, it, expect } from 'vitest';
import { QR_READ_OPTIONS, QR_WRITE_OPTIONS } from './qrCodec';

describe('qrCodec options for a handheld camera', () => {
    it('makes codes that survive some blur and glare', () => {
        // Above the lowest level: a partly unreadable code still reads.
        expect(QR_WRITE_OPTIONS.ecLevel).toBe('M');
        expect(QR_WRITE_OPTIONS.format).toBe('QRCode');
    });

    it('asks the reader to work hard on tilted, oversized codes', () => {
        // All of these were off, and blurred codes were silently not read.
        expect(QR_READ_OPTIONS.tryHarder).toBe(true);
        expect(QR_READ_OPTIONS.tryRotate).toBe(true);
        expect(QR_READ_OPTIONS.tryDownscale).toBe(true);
        expect(QR_READ_OPTIONS.maxNumberOfSymbols).toBe(1);
    });
});
