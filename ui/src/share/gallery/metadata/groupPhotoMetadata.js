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
    'x-CreatorTool': 'Software',
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

function isPresent(value) {
    return value != null && value !== '';
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
        return summary.filter(item => item && isPresent(item.value)
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

/**
 * Build the hero (title, rating, description, label, keywords), the details
 * list in relevance order and the remaining metadata for the panel.
 * Title, rating and description are always present so a missing value reads
 * as "not set" instead of silently disappearing.
 */
export function groupMetadataForDisplay(summary, tile) {
    const flat = flattenMetadataSummary(summary, tile);
    if (flat.length === 0) {
        return { highlights: [], lead: [], more: [] };
    }

    const rating = Number(firstValue(flat, ['Rating XMP', 'media.rating']));
    const highlights = [
        { id: 'highlight-title', kind: 'title', label: 'Title',
            value: firstValue(flat, ['Title XMP', 'media.title']) },
        { id: 'highlight-rating', kind: 'rating', label: 'Rating',
            value: Number.isFinite(rating) && rating !== 0 ? rating : null,
            colorLabel: firstValue(flat, ['Label XMP']) },
        { id: 'highlight-description', kind: 'description', label: 'Description',
            value: firstValue(flat, ['x-Description', 'Description XMP', 'media.description', 'media.comment']) },
    ];

    const keywords = splitKeywords(firstValue(flat, ['Keywords XMP', 'XPKeywords']));
    if (keywords.length) {
        highlights.push({ id: 'highlight-keywords', kind: 'keywords', label: 'Keywords', value: keywords });
    }

    const rest = flat.filter(item => !HIGHLIGHT_SOURCE_KEYS.has(item.key));
    const { lead, more } = groupPhotoMetadata(rest);

    return { highlights, lead, more };
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
