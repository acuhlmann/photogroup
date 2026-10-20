import { describe, it, expect, vi } from 'vitest';
import { onAndroid, pickWithFilesPicker, usesFilesPicker } from './pickFiles';

const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

describe('pickFiles', () => {
    it('recognises Android from client hints or the user agent', () => {
        expect(onAndroid({ userAgent: ANDROID })).toBe(true);
        expect(onAndroid({ userAgent: DESKTOP })).toBe(false);
        expect(onAndroid({ userAgent: ANDROID, userAgentData: { platform: 'Android' } })).toBe(true);
        expect(onAndroid({ userAgent: DESKTOP, userAgentData: { platform: 'Linux' } })).toBe(false);
        expect(onAndroid(undefined)).toBe(false);
    });

    it('uses the Files picker only on Android browsers that have it', () => {
        const showOpenFilePicker = vi.fn();
        expect(usesFilesPicker({ navigator: { userAgent: ANDROID }, showOpenFilePicker })).toBe(true);
        expect(usesFilesPicker({ navigator: { userAgent: ANDROID } })).toBe(false);
        expect(usesFilesPicker({ navigator: { userAgent: DESKTOP }, showOpenFilePicker })).toBe(false);
        const webView = 'Mozilla/5.0 (Linux; Android 15; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36';
        expect(usesFilesPicker({ navigator: { userAgent: webView }, showOpenFilePicker })).toBe(false);
    });

    it('returns the picked files, or none when the picker is closed', async () => {
        const photo = new File(['x'], 'PXL_1.jpg', { type: 'image/jpeg' });
        const win = { showOpenFilePicker: vi.fn().mockResolvedValue([{ getFile: () => Promise.resolve(photo) }]) };
        expect(await pickWithFilesPicker(win)).toEqual([photo]);
        expect(win.showOpenFilePicker).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }));

        const abort = Object.assign(new Error('closed'), { name: 'AbortError' });
        win.showOpenFilePicker.mockRejectedValueOnce(abort);
        expect(await pickWithFilesPicker(win)).toEqual([]);

        const denied = Object.assign(new Error('no'), { name: 'SecurityError' });
        win.showOpenFilePicker.mockRejectedValueOnce(denied);
        await expect(pickWithFilesPicker(win)).rejects.toBe(denied);
    });
});
