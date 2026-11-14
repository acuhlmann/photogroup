// NFC in a browser: only Chrome on Android, and only tags. A page cannot
// send to another phone, but it can put the room link on a tag or sticker.
// Every phone that taps the tag opens the link, iPhones too.

export function canWriteNfc(win = typeof window === 'undefined' ? undefined : window) {
    return !!win && 'NDEFReader' in win;
}

/** The room link for a tag: `via=nfc` tells the room how the person came. */
export function tagUrl(url) {
    const link = new URL(url);
    link.searchParams.set('via', 'nfc');
    return link.toString();
}

/**
 * Wait for a tag at the back of the phone and write the link on it.
 * @returns {Promise<number>} the bytes written
 */
export async function writeLinkToTag(url, { signal, win = window } = {}) {
    const link = tagUrl(url);
    const writer = new win.NDEFReader();
    await writer.write({ records: [{ recordType: 'url', data: link }] }, { signal });
    return new TextEncoder().encode(link).length;
}
