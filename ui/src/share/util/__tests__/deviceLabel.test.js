import { describe, it, expect } from 'vitest';
import { describeDevice, detectDevice, modelFromUserAgent, phoneName } from '../deviceLabel';

const REDUCED_ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const ANDROID_DATA = { platform: 'Android', mobile: true, brands: [{ brand: 'Google Chrome', version: '140' }] };

describe('deviceLabel', () => {
    it('names the phone from the client hints model', () => {
        expect(describeDevice({ userAgent: REDUCED_ANDROID, userAgentData: ANDROID_DATA }, { model: 'SM-S911B' }))
            .toBe('Chrome on Samsung SM-S911B');
        expect(describeDevice({ userAgent: REDUCED_ANDROID, userAgentData: ANDROID_DATA }, { model: 'VOG-L29' }))
            .toBe('Chrome on Huawei VOG-L29');
        expect(describeDevice({ userAgent: REDUCED_ANDROID, userAgentData: ANDROID_DATA }, { model: 'V2111' }))
            .toBe('Chrome on vivo V2111');
        expect(describeDevice({ userAgent: REDUCED_ANDROID, userAgentData: ANDROID_DATA }, { model: 'Pixel 8' }))
            .toBe('Chrome on Pixel 8');
    });

    it('says Android when the reduced user agent hides the model', () => {
        expect(describeDevice({ userAgent: REDUCED_ANDROID })).toBe('Chrome on Android');
    });

    it('reads the model from a full user agent', () => {
        expect(modelFromUserAgent('Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014) Chrome/120')).toBe('SM-A536B');
        expect(modelFromUserAgent('Mozilla/5.0 (Linux; Android 10; HarmonyOS; ELS-NX9; HMSCore 6.11) HuaweiBrowser/14.0')).toBe('ELS-NX9');
        expect(modelFromUserAgent('Mozilla/5.0 (Linux; U; Android 4.4; en-us; GT-I9505 Build/KOT49H)')).toBe('GT-I9505');
        expect(modelFromUserAgent(REDUCED_ANDROID)).toBe('');
        const samsung = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36';
        expect(describeDevice({ userAgent: samsung })).toBe('Samsung Internet on Samsung SM-S918B');
    });

    it('falls back to the brand of a phone maker browser', () => {
        expect(phoneName('', 'Mozilla/5.0 (Linux; Android 10; K) VivoBrowser/10.0')).toBe('vivo');
        expect(phoneName('2201116SG')).toBe('Xiaomi 2201116SG');
        expect(phoneName('Redmi Note 12')).toBe('Redmi Note 12');
        expect(phoneName('CPH2449')).toBe('OPPO CPH2449');
    });

    it('names the Linux distro only where the user agent tells it', () => {
        expect(describeDevice({ userAgent: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0' }))
            .toBe('Firefox on Ubuntu');
        expect(describeDevice({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' }))
            .toBe('Chrome on Linux');
    });

    it('names Apple devices and Windows versions', () => {
        expect(describeDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }))
            .toBe('Safari on iPhone');
        expect(describeDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', maxTouchPoints: 5 }))
            .toBe('Safari on iPad');
        const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
        expect(describeDevice({ userAgent: windows }, { platformVersion: '15.0.0' })).toBe('Edge on Windows 11');
        expect(describeDevice({ userAgent: windows })).toBe('Edge on Windows');
    });

    it('asks for the model hint and survives a refusal', async () => {
        const nav = {
            userAgent: REDUCED_ANDROID,
            userAgentData: { ...ANDROID_DATA, getHighEntropyValues: async () => ({ model: 'SM-S911B', platformVersion: '14.0.0' }) },
        };
        await expect(detectDevice(nav)).resolves.toBe('Chrome on Samsung SM-S911B');
        nav.userAgentData.getHighEntropyValues = async () => { throw new Error('denied'); };
        await expect(detectDevice(nav)).resolves.toBe('Chrome on Android');
    });
});
