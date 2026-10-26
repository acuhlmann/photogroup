// A short name for this device, for people who did not give a nickname:
// "Chrome on Samsung SM-S911B", "Firefox on Ubuntu", "Safari on iPhone".
//
// What a browser tells: Chrome reduced its user agent to "Android 10; K",
// so on Android the model comes only from User-Agent Client Hints
// (getHighEntropyValues 'model'). Other Android browsers (Samsung Internet,
// Huawei Browser, older Chrome) still put it in the user agent. Firefox on
// Android and Safari on iPhone never tell the model. On Linux only some
// distro builds of Firefox name the distro ("X11; Ubuntu; Linux"); Chrome
// never does.

// Model codes, in the order to test them. The model is the hint or the user
// agent token, e.g. "SM-S911B", "Pixel 8", "V2111", "VOG-L29".
const BRANDS = [
    [/^(SM|SC|SCV|SCG|SHV|GT)-[A-Z]?\d|^Galaxy/i, 'Samsung'],
    [/^Pixel/i, 'Google'],
    [/^(Redmi|POCO|Mi |MI |Xiaomi)|^M?2\d{3}[0-9A-Z]{3,}$/, 'Xiaomi'],
    [/^vivo|^V\d{4}[A-Z]{0,2}$|^I\d{4}$/i, 'vivo'],
    [/^RMX\d{4}/, 'realme'],
    [/^OnePlus|^(GM|HD|IN|KB|LE|NE|PH|PJ)\d{4}$/i, 'OnePlus'],
    [/^(CPH|OPPO|PH[A-Z]M)\d*/i, 'OPPO'],
    [/^HONOR/i, 'Honor'],
    [/^[A-Z]{3}-(AL|AN|BD|L|LX|N|NX|TL|W)\d/, 'Huawei'],
    [/^moto|^XT\d{4}/i, 'Motorola'],
    [/^Nokia|^TA-\d{4}/i, 'Nokia'],
    [/^LM-|^LG-/, 'LG'],
    [/^XQ-|^SO-\d/, 'Sony'],
    [/^ASUS|^ASUS_|^I0\d{2}D/i, 'ASUS'],
    [/^Infinix/i, 'Infinix'],
    [/^TECNO/i, 'TECNO'],
    [/^Nothing|^A0(63|65|142)$/i, 'Nothing'],
    [/^Lenovo/i, 'Lenovo'],
    [/^ZTE|^Blade/i, 'ZTE'],
];

// Names people know as they are: show the model without the brand.
const KNOWN_NAMES = /^(Pixel|Galaxy|Redmi|POCO|Mi |Xiaomi|vivo|OnePlus|OPPO|HONOR|moto|Nokia|Infinix|TECNO|Nothing|Lenovo|ZTE|ASUS)/i;

// Browsers made by a phone brand run on that brand's phones.
const BROWSER_BRANDS = [
    [/SamsungBrowser/, 'Samsung'],
    [/HuaweiBrowser|HarmonyOS|HMSCore/, 'Huawei'],
    [/VivoBrowser/, 'vivo'],
    [/HeyTapBrowser|OppoBrowser/, 'OPPO'],
    [/MiuiBrowser|XiaoMi/, 'Xiaomi'],
];

const DISTROS = [
    [/Ubuntu/, 'Ubuntu'], [/Fedora/, 'Fedora'], [/Debian/, 'Debian'],
    [/Linux Mint|\bMint\b/, 'Linux Mint'], [/Pop!_OS/, 'Pop!_OS'],
    [/elementary/i, 'elementary OS'], [/Manjaro/, 'Manjaro'],
    [/Arch Linux|\bArch\b/, 'Arch Linux'], [/openSUSE|SUSE/, 'openSUSE'],
    [/CentOS/, 'CentOS'], [/Red Hat/, 'Red Hat'], [/Gentoo/, 'Gentoo'],
    [/Raspbian/, 'Raspberry Pi OS'],
];

/** The model the user agent names, if any: Chrome's reduced UA says "K". */
export function modelFromUserAgent(ua) {
    const match = /Android[^;)]*;([^)]*)/.exec(ua || '');
    if (!match) return '';
    const skip = /^(K|wv|U|HarmonyOS|HMSCore.*|Mobile|[a-z]{2}([-_][a-z]{2})?)$/i;
    const model = match[1].split(';')
        .map(part => part.replace(/\s*Build\/.*$/, '').trim())
        .find(part => part && !skip.test(part));
    return model || '';
}

/** "Samsung SM-S911B", "Pixel 8", "Huawei", or '' when nothing is known. */
export function phoneName(model, ua = '') {
    const clean = String(model || '').trim();
    if (clean) {
        if (KNOWN_NAMES.test(clean)) return clean;
        const brand = BRANDS.find(([pattern]) => pattern.test(clean));
        return brand ? `${brand[1]} ${clean}` : clean;
    }
    const browserBrand = BROWSER_BRANDS.find(([pattern]) => pattern.test(ua));
    return browserBrand ? browserBrand[1] : '';
}

function browserName(ua, brands) {
    if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
    if (/HuaweiBrowser/.test(ua)) return 'Huawei Browser';
    if (/MiuiBrowser/.test(ua)) return 'Mi Browser';
    if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
    if (/OPR\/|Opera/.test(ua)) return 'Opera';
    if (/Firefox\/|FxiOS/.test(ua)) return 'Firefox';
    const brand = (brands || []).map(item => item.brand).find(name => /Brave/.test(name));
    if (brand) return 'Brave';
    if (/Chrome\/|CriOS/.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    return '';
}

function windowsName(ua, platformVersion) {
    const major = parseInt(platformVersion, 10);
    if (major >= 13) return 'Windows 11';
    if (major > 0) return 'Windows 10';
    const nt = /Windows NT (\d+\.\d+)/.exec(ua);
    const versions = { '6.1': 'Windows 7', '6.2': 'Windows 8', '6.3': 'Windows 8.1' };
    return (nt && versions[nt[1]]) || 'Windows';
}

/**
 * The device name from what the browser tells. `hints` holds the
 * high-entropy client hints (model, platformVersion), when there are any.
 */
export function describeDevice({ userAgent = '', userAgentData = null, maxTouchPoints = 0 } = {}, hints = {}) {
    const ua = userAgent;
    const platform = hints.platform || userAgentData?.platform || '';
    let device;
    if (/Android/i.test(ua) || platform === 'Android') {
        device = phoneName(hints.model || modelFromUserAgent(ua), ua) || 'Android';
    } else if (/iPhone|iPod/.test(ua)) {
        device = 'iPhone';
    } else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) {
        device = 'iPad';
    } else if (/CrOS/.test(ua) || platform === 'Chrome OS') {
        device = 'Chromebook';
    } else if (/Windows/.test(ua) || platform === 'Windows') {
        device = windowsName(ua, hints.platformVersion);
    } else if (/Macintosh|Mac OS X/.test(ua) || platform === 'macOS') {
        device = 'Mac';
    } else if (/Linux|X11/.test(ua) || platform === 'Linux') {
        const distro = DISTROS.find(([pattern]) => pattern.test(ua));
        device = distro ? distro[1] : 'Linux';
    } else {
        device = '';
    }
    const browser = browserName(ua, userAgentData?.brands);
    if (browser && device) return `${browser} on ${device}`;
    return device || browser;
}

/** Asks the browser for the model too, where it tells it (Chromium only). */
export async function detectDevice(nav = typeof navigator === 'undefined' ? undefined : navigator) {
    if (!nav) return '';
    let hints = {};
    try {
        if (nav.userAgentData?.getHighEntropyValues) {
            hints = await nav.userAgentData.getHighEntropyValues(['model', 'platformVersion']);
        }
    } catch {
        hints = {};
    }
    return describeDevice(nav, hints || {});
}
