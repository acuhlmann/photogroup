/** Catalog fields shown in the hero block, so they are not repeated below. */
export const HIGHLIGHT_SOURCE_KEYS = new Set([
    'Title XMP',
    'Description XMP',
    'x-Description',
    'Rating XMP',
    'Label XMP',
    'Keywords XMP',
    'XPKeywords',
    'media.title',
    'media.description',
    'media.comment',
    'media.rating',
]);

/** Details list, most relevant first (after the hero block). */
export const LEAD_KEYS = [
    'x-file name',
    'DateTimeOriginal',
    'Creator XMP',
    'x-Location',
    'x-Camera',
    'LensModel',
    'x-Settings',
    'x-Pixel Size',
    'GPSAltitude',
    'media.artist',
    'media.album',
    'media.genre',
    'media.year',
    'media.track',
    'format.duration',
    'format.codec',
    'format.container',
    'format.bitrate',
    'format.sampleRate',
    'x-CreatorTool',
    'Software',
    'x-Last Save with',
    'x-Last Save at',
];

const LEAD_LABELS = {
    'x-file name': 'File name',
    'Title XMP': 'Title',
    'Description XMP': 'Description',
    'x-Description': 'Description',
    'DateTimeOriginal': 'Taken',
    'Creator XMP': 'Creator',
    'x-Camera': 'Camera',
    'LensModel': 'Lens',
    'x-Settings': 'Exposure',
    'x-Pixel Size': 'Pixel size',
    'x-Location': 'Location',
    'GPSAltitude': 'Altitude',
    'Keywords XMP': 'Keywords',
    'XPKeywords': 'Keywords',
    'Rating XMP': 'Rating',
    'Label XMP': 'Label',
    'x-CreatorTool': 'Edited in',
    'x-Last Save with': 'Edited with',
    'x-Last Save at': 'Edited at',
    'media.title': 'Title',
    'media.artist': 'Artist',
    'media.album': 'Album',
    'media.genre': 'Genre',
    'media.year': 'Year',
    'media.track': 'Track',
    'media.comment': 'Description',
    'media.description': 'Description',
    'format.duration': 'Duration',
    'format.codec': 'Codec',
    'format.container': 'Container',
    'format.bitrate': 'Bitrate',
    'format.sampleRate': 'Sample rate',
};

const MEDIA_COMMON_KEYS = [
    ['title', 'media.title'],
    ['artist', 'media.artist'],
    ['album', 'media.album'],
    ['genre', 'media.genre'],
    ['year', 'media.year'],
    ['track', 'media.track'],
    ['comment', 'media.comment'],
    ['description', 'media.description'],
    ['longDescription', 'media.description'],
];

const MEDIA_FORMAT_KEYS = [
    ['duration', 'format.duration'],
    ['codec', 'format.codec'],
    ['container', 'format.container'],
    ['bitrate', 'format.bitrate'],
    ['sampleRate', 'format.sampleRate'],
];

/**
 * Container/encoder bookkeeping that says nothing about the photo, and
 * reference fields already folded into a friendlier row (location, camera).
 */
export const HIDDEN_KEYS = new Set([
    'JFIFVersion', 'ResolutionUnit', 'XResolution', 'YResolution',
    'ThumbnailWidth', 'ThumbnailHeight', 'ThumbnailOffset', 'ThumbnailLength',
    'ThumbnailXResolution', 'ThumbnailYResolution', 'ThumbnailResolutionUnit', 'ThumbnailCompression',
    'ExifVersion', 'FlashpixVersion', 'InteropIndex', 'InteropVersion', 'YCbCrPositioning',
    'ComponentsConfiguration', 'GPSVersionID', 'GPSLatitudeRef', 'GPSLongitudeRef', 'GPSAltitudeRef',
    'Compression', 'BitsPerSample', 'SamplesPerPixel', 'PhotometricInterpretation',
    'ExifImageWidth', 'ExifImageHeight', 'latitude', 'longitude',
]);

/** Raw fields a derived row already shows, hidden once that row exists. */
const SHOWN_BY = {
    'x-Settings': ['FNumber', 'ExposureTime', 'ISO', 'ISOSpeedRatings', 'FocalLength', 'FocalLengthIn35mmFormat'],
    'x-Camera': ['Make', 'Model'],
    'x-Location': ['GPSLatitude', 'GPSLongitude'],
};

/** Fields worth a gentle "not set" note when absent, per media type. */
const IMPORTANT_MISSING = {
    image: [
        ['title', 'Title'], ['description', 'Description'], ['rating', 'Rating'],
        ['DateTimeOriginal', 'Date taken'], ['x-Location', 'Location'],
    ],
    audio: [['title', 'Title'], ['media.artist', 'Artist'], ['media.album', 'Album'], ['rating', 'Rating']],
    video: [['title', 'Title'], ['description', 'Description'], ['rating', 'Rating']],
};

const EMPTY_TEXT = new Set(['undefined', 'null', 'nan', '[]', '{}', 'unknown', '0000:00:00 00:00:00']);

function isPresent(value) {
    if (value == null) return false;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') {
        const text = value.trim();
        return text !== '' && !EMPTY_TEXT.has(text.toLowerCase());
    }
    if (Array.isArray(value)) return value.some(isPresent);
    return true;
}

function isLocation(value) {
    return value && typeof value === 'object'
        && Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.long));
}

function formatPrimitive(value) {
    if (Array.isArray(value)) {
        // music-metadata comments are {descriptor, text} objects
        return value
            .map(item => (item && typeof item === 'object' ? (item.text ?? JSON.stringify(item)) : String(item)))
            .filter(Boolean)
            .join(', ');
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
}

export function labelForMetadataKey(key) {
    // Raw EXIF tags are CamelCase ("ExposureBiasValue"); space them for reading.
    return LEAD_LABELS[key] || String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/**
 * Expand nested music-metadata `common` / `format` objects into flat rows.
 */
export function flattenMetadataSummary(summary, tile) {
    if (!Array.isArray(summary) || summary.length === 0) {
        return [];
    }

    if (tile?.isImage) {
        return summary.filter(item => item && isPresent(item.value) && !HIDDEN_KEYS.has(item.key)
            && (typeof item.value !== 'object' || isLocation(item.value)));
    }

    const flat = [];

    summary.forEach(item => {
        if (!item || !isPresent(item.value)) return;

        if (item.key === 'common' && typeof item.value === 'object') {
            const common = item.value;
            MEDIA_COMMON_KEYS.forEach(([src, dest]) => {
                if (isPresent(common[src]) && !flat.some(entry => entry.key === dest)) {
                    const value = formatPrimitive(common[src]);
                    if (value) flat.push({ key: dest, value });
                }
            });
            if (isPresent(common.starRating)) {
                flat.push({ key: 'Rating XMP', value: common.starRating });
            }
            return;
        }

        if (item.key === 'format' && typeof item.value === 'object') {
            const format = item.value;
            MEDIA_FORMAT_KEYS.forEach(([src, dest]) => {
                if (isPresent(format[src])) {
                    let value = format[src];
                    if (dest === 'format.bitrate' && typeof value === 'number') {
                        value = `${Math.round(value)} bps`;
                    }
                    flat.push({ key: dest, value: formatPrimitive(value) });
                }
            });
            return;
        }

        if (item.key === 'native') return;

        if (typeof item.value === 'object') {
            flat.push({ key: item.key, value: formatPrimitive(item.value) });
        } else {
            flat.push({ key: item.key, value: item.value });
        }
    });

    return flat;
}

function firstValue(flat, keys) {
    for (const key of keys) {
        const item = flat.find(entry => entry.key === key);
        if (item && isPresent(item.value)) {
            return item.value;
        }
    }
    return null;
}

function splitKeywords(value) {
    if (!isPresent(value)) return [];
    return [...new Set(String(value).split(/[,;]/).map(word => word.trim()).filter(Boolean))];
}

function mediaKind(tile) {
    if (tile?.isAudio) return 'audio';
    if (tile?.isVideo) return 'video';
    return 'image';
}

/**
 * Build the hero (title, rating, description, label, keywords) from the
 * fields that are actually set, the details list in relevance order, the
 * remaining metadata, and the important fields that are missing so the
 * panel can mention them quietly at the end.
 */
export function groupMetadataForDisplay(summary, tile) {
    const flat = flattenMetadataSummary(summary, tile);
    if (flat.length === 0) {
        return { highlights: [], lead: [], more: [], missing: [] };
    }

    const highlights = [];
    const title = firstValue(flat, ['Title XMP', 'media.title']);
    if (title) {
        highlights.push({ id: 'highlight-title', kind: 'title', label: 'Title', value: String(title).trim() });
    }
    const rating = Number(firstValue(flat, ['Rating XMP', 'media.rating']));
    const colorLabel = firstValue(flat, ['Label XMP']);
    if ((Number.isFinite(rating) && rating !== 0) || colorLabel) {
        highlights.push({ id: 'highlight-rating', kind: 'rating', label: 'Rating',
            value: Number.isFinite(rating) && rating !== 0 ? rating : null, colorLabel });
    }
    const description = firstValue(flat, ['x-Description', 'Description XMP', 'media.description', 'media.comment']);
    if (description) {
        highlights.push({ id: 'highlight-description', kind: 'description', label: 'Description',
            value: String(description).trim() });
    }
    const keywords = splitKeywords(firstValue(flat, ['Keywords XMP', 'XPKeywords']));
    if (keywords.length) {
        highlights.push({ id: 'highlight-keywords', kind: 'keywords', label: 'Keywords', value: keywords });
    }

    const shown = new Set(flat.map(item => item.key));
    const hidden = new Set(Object.entries(SHOWN_BY)
        .filter(([derived]) => shown.has(derived))
        .flatMap(([, raw]) => raw));
    const rest = flat.filter(item => !HIGHLIGHT_SOURCE_KEYS.has(item.key) && !hidden.has(item.key));
    const { lead, more } = groupPhotoMetadata(rest);

    const kinds = new Set(highlights.filter(item => item.kind !== 'rating' || item.value != null).map(item => item.kind));
    const missing = IMPORTANT_MISSING[mediaKind(tile)]
        .filter(([key]) => !kinds.has(key) && !shown.has(key))
        .map(([, label]) => label);

    return { highlights, lead, more, missing };
}

/**
 * Split flat metadata into lead fields (relevance order) and the remaining
 * EXIF / technical entries (alphabetical, for scanning).
 */
export function groupPhotoMetadata(summary) {
    if (!Array.isArray(summary) || summary.length === 0) {
        return { lead: [], more: [] };
    }

    const rest = summary.filter(item => item && isPresent(item.value));
    const lead = [];

    LEAD_KEYS.forEach(key => {
        const index = rest.findIndex(item => item.key === key);
        if (index >= 0) {
            lead.push(rest.splice(index, 1)[0]);
        }
    });

    rest.sort((a, b) => labelForMetadataKey(a.key).localeCompare(labelForMetadataKey(b.key)));
    return { lead, more: rest };
}

function trimNumber(value, digits = 1) {
    const factor = 10 ** digits;
    return String(Math.round(value * factor) / factor);
}

function formatBitrate(bps) {
    if (bps >= 1e6) return trimNumber(bps / 1e6) + ' Mbps';
    if (bps >= 1e3) return Math.round(bps / 1e3) + ' kbps';
    return Math.round(bps) + ' bps';
}

/**
 * A metadata value as a person would say it: "1/125 s", "ƒ/1.8", "±0 EV",
 * "1200 × 900 · 1.1 MP", "44.1 kHz". Unknown keys pass through unchanged.
 */
export function humanizeMetadataValue(key, value) {
    if (value == null) return '';
    const number = typeof value === 'number' ? value : Number(String(value).trim());
    const isNumber = String(value).trim() !== '' && Number.isFinite(number);

    switch (key) {
    case 'x-Pixel Size': {
        const match = String(value).match(/(\d+)\s*[x×]\s*(\d+)/);
        if (!match) return String(value);
        const megapixels = (Number(match[1]) * Number(match[2])) / 1e6;
        return `${match[1]} × ${match[2]}` + (megapixels >= 0.1 ? ` · ${trimNumber(megapixels)} MP` : '');
    }
    case 'GPSAltitude':
        return isNumber ? `${Math.round(number)} m` : String(value);
    case 'ExposureTime':
        if (!isNumber || number <= 0) return String(value);
        return number >= 0.3 ? `${trimNumber(number)} s` : `1/${Math.round(1 / number)} s`;
    case 'FNumber':
        return isNumber ? `ƒ/${trimNumber(number)}` : String(value);
    case 'FocalLength':
    case 'FocalLengthIn35mmFormat':
        return isNumber ? `${trimNumber(number)} mm` : String(value);
    case 'ExposureCompensation':
    case 'ExposureBiasValue':
        if (!isNumber) return String(value);
        return number === 0 ? '±0 EV' : `${number > 0 ? '+' : '−'}${trimNumber(Math.abs(number))} EV`;
    case 'ISO':
    case 'ISOSpeedRatings':
        return `ISO ${value}`;
    case 'Flash': {
        const text = String(value);
        if (/did not fire|no flash/i.test(text)) return 'No flash';
        if (/fired/i.test(text)) return 'Flash fired';
        return text;
    }
    case 'format.sampleRate':
        return isNumber ? `${trimNumber(number / 1000)} kHz` : String(value);
    case 'format.bitrate': {
        const bps = parseFloat(value);
        return Number.isFinite(bps) ? formatBitrate(bps) : String(value);
    }
    default:
        return String(value);
    }
}
