import Logger from 'js-logger';

// Read the photos, videos and audio out of a zip in the browser, so a zip
// made on an Android phone can be shared as the originals inside it. Each
// entry is streamed out on its own, so big videos never sit in memory twice.
// Handles stored and deflated entries and Zip64 (archives over 4 GB).

const END = 0x06054b50;
const END64 = 0x06064b50;
const LOCATOR64 = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_32 = 0xFFFFFFFF;

const MEDIA_TYPES = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
    mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', '3gp': 'video/3gpp', webm: 'video/webm', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg',
};

const u16 = (bytes, at) => bytes[at] | (bytes[at + 1] << 8);
const u32 = (bytes, at) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
const u64 = (bytes, at) => u32(bytes, at) + u32(bytes, at + 4) * 2 ** 32;

async function read(blob, start, end) {
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

export function isZip(file) {
    if (!file) return false;
    return /\.zip$/i.test(file.name || '') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}

/** Where the central directory is and how many entries it lists, from the records at the end. */
async function findDirectory(zip) {
    const tailStart = Math.max(0, zip.size - (22 + 0xFFFF));
    const tail = await read(zip, tailStart, zip.size);
    let at = tail.length - 22;
    while (at >= 0 && u32(tail, at) !== END) at--;
    if (at < 0) throw new Error('it isn’t a zip file');
    let count = u16(tail, at + 10);
    let size = u32(tail, at + 12);
    let offset = u32(tail, at + 16);

    const endAt = tailStart + at;
    if (endAt >= 20) {
        const locator = await read(zip, endAt - 20, endAt);
        if (u32(locator, 0) === LOCATOR64) {
            const recordAt = u64(locator, 8);
            const record = await read(zip, recordAt, recordAt + 56);
            if (u32(record, 0) === END64) {
                count = u64(record, 32);
                size = u64(record, 40);
                offset = u64(record, 48);
            }
        }
    }
    return { count, size, offset };
}

/** A DOS date and time, as stored in zips, in local time. */
function dosDate(date, time) {
    const value = new Date(((date >> 9) & 0x7F) + 1980, ((date >> 5) & 0x0F) - 1, date & 0x1F,
        time >> 11, (time >> 5) & 0x3F, (time & 0x1F) * 2);
    return Number.isFinite(value.getTime()) ? value.getTime() : Date.now();
}

/** Every entry the central directory lists. */
async function listEntries(zip) {
    const { count, size, offset } = await findDirectory(zip);
    const directory = await read(zip, offset, offset + size);
    const decoder = new TextDecoder();
    const entries = [];
    let at = 0;
    for (let index = 0; index < count; index++) {
        if (at + 46 > directory.length || u32(directory, at) !== CENTRAL) throw new Error('it is damaged');
        const nameLength = u16(directory, at + 28);
        const extraLength = u16(directory, at + 30);
        const commentLength = u16(directory, at + 32);
        const entry = {
            name: decoder.decode(directory.subarray(at + 46, at + 46 + nameLength)),
            encrypted: (u16(directory, at + 8) & 1) === 1,
            method: u16(directory, at + 10),
            modified: dosDate(u16(directory, at + 14), u16(directory, at + 12)),
            compressedSize: u32(directory, at + 20),
            size: u32(directory, at + 24),
            localOffset: u32(directory, at + 42),
        };
        // Zip64 keeps the 64-bit values of whichever fields are 0xFFFFFFFF, in this order.
        let extra = at + 46 + nameLength;
        const extraEnd = extra + extraLength;
        while (extra + 4 <= extraEnd) {
            const id = u16(directory, extra);
            let field = extra + 4;
            if (id === 0x0001) {
                ['size', 'compressedSize', 'localOffset'].forEach(key => {
                    if (entry[key] === MAX_32) {
                        entry[key] = u64(directory, field);
                        field += 8;
                    }
                });
            }
            extra += 4 + u16(directory, extra + 2);
        }
        entries.push(entry);
        at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

/** The entry's data as a Blob, inflated when it was compressed; null for methods it can't read. */
async function entryData(zip, entry) {
    const local = await read(zip, entry.localOffset, entry.localOffset + 30);
    if (u32(local, 0) !== LOCAL) throw new Error('it is damaged');
    const start = entry.localOffset + 30 + u16(local, 26) + u16(local, 28);
    const raw = zip.slice(start, start + entry.compressedSize);
    if (entry.method === 0) return raw;
    if (entry.method !== 8) return null;
    if (typeof DecompressionStream !== 'function') throw new Error('this browser can’t unpack zip files');
    return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
}

/** The media type a file name says it is, or null when it isn't a photo, video or audio file. */
function mediaType(name) {
    const base = name.split('/').pop();
    if (!base || base.startsWith('.') || name.startsWith('__MACOSX/') || name.includes('/__MACOSX/')) return null;
    const dot = base.lastIndexOf('.');
    return dot > 0 ? MEDIA_TYPES[base.slice(dot + 1).toLowerCase()] || null : null;
}

/** The photos, videos and audio in a zip, as Files named like the entries (without their folders). */
export async function unzipMedia(zip) {
    const files = [];
    for (const entry of await listEntries(zip)) {
        const type = mediaType(entry.name);
        if (!type || entry.encrypted) continue;
        const data = await entryData(zip, entry);
        if (!data) {
            Logger.warn('Skipped ' + entry.name + ' in ' + zip.name + ': unsupported compression');
            continue;
        }
        if (data.size !== entry.size) throw new Error('it is damaged');
        files.push(new File([data], entry.name.split('/').pop(), { type, lastModified: entry.modified }));
    }
    return files;
}

/** "IMG_1.jpg", then "IMG_1 (2).jpg" for the next one, so two photos never share a name. */
function uniqueName(name, taken) {
    const dot = name.lastIndexOf('.');
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let candidate = name;
    for (let copy = 2; taken.has(candidate.toLowerCase()); copy++) candidate = `${stem} (${copy})${extension}`;
    taken.add(candidate.toLowerCase());
    return candidate;
}

/**
 * Replace each zip among `files` with the photos, videos and audio in it.
 * Resolves to { files, problems }, `problems` being a message for each zip
 * that couldn't be read or had nothing to share.
 */
export async function unpackZips(files) {
    const list = Array.from(files || []);
    const taken = new Set(list.filter(file => !isZip(file)).map(file => String(file.name).toLowerCase()));
    const out = [];
    const problems = [];
    for (const file of list) {
        if (!isZip(file)) {
            out.push(file);
            continue;
        }
        try {
            const inside = await unzipMedia(file);
            if (!inside.length) problems.push(`${file.name} has no photos or videos in it.`);
            inside.forEach(item => {
                const name = uniqueName(item.name, taken);
                out.push(name === item.name ? item : new File([item], name, { type: item.type, lastModified: item.lastModified }));
            });
        } catch (err) {
            problems.push(`Couldn’t open ${file.name}: ${err && err.message ? err.message : err}.`);
        }
    }
    return { files: out, problems };
}
