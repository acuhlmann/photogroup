/** Prominent XMP / catalog fields — rendered in the hero block, not duplicated below. */
export const HIGHLIGHT_SOURCE_KEYS = new Set([
    'Title XMP',
    'Description XMP',
    'x-Description',
    'Rating XMP',
    'media.title',
    'media.description',
    'media.comment',
    'media.rating',
]);

/** Fields shown in the details list (after highlights). */
export const LEAD_KEYS = [
    'x-file name',
    'DateTimeOriginal',
    'x-Camera',
    'x-Settings',
    'x-Pixel Size',
    'x-Location',
    'GPSAltitude',
    'Keywords XMP',
    'XPKeywords',
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
];

const LEAD_LABELS = {
    'x-file name': 'File name',
    'Title XMP': 'Title',
    'Description XMP': 'Description',
    'x-Description': 'Description',
    'DateTimeOriginal': 'Taken',
    'x-Camera': 'Camera',
    'x-Settings': 'Settings',
    'x-Pixel Size': 'Pixel size',
    'x-Location': 'Location',
    'GPSAltitude': 'Altitude',
    'Keywords XMP': 'Keywords',
    'XPKeywords': 'Keywords',
    'Rating XMP': 'Rating',
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

function formatPrimitive(value) {
    if (Array.isArray(value)) {
        return value.map(item => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ');
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
}

export function labelForMetadataKey(key) {
    return LEAD_LABELS[key] || key;
}

/**
 * Expand nested music-metadata `common` / `format` objects into flat rows.
 */
export function flattenMetadataSummary(summary, tile) {
    if (!Array.isArray(summary) || summary.length === 0) {
        return [];
    }

    if (tile?.isImage) {
        return summary.filter(item => item && isPresent(item.value) && typeof item.value !== 'object');
    }

    const flat = [];

    summary.forEach(item => {
        if (!item || !isPresent(item.value)) return;

        if (item.key === 'common' && typeof item.value === 'object') {
            const common = item.value;
            MEDIA_COMMON_KEYS.forEach(([src, dest]) => {
                if (isPresent(common[src])) {
                    flat.push({ key: dest, value: formatPrimitive(common[src]) });
                }
            });
            if (isPresent(common.starRating)) {
                flat.push({ key: 'Rating XMP', value: common.starRating });
            } else if (isPresent(common.rating)) {
                flat.push({ key: 'Rating XMP', value: common.rating });
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

function firstMatching(flat, keys) {
    for (const key of keys) {
        const item = flat.find(entry => entry.key === key);
        if (item && isPresent(item.value)) {
            return item;
        }
    }
    return null;
}

/**
 * Build highlight + lead + more sections for the metadata panel.
 */
export function groupMetadataForDisplay(summary, tile) {
    const flat = flattenMetadataSummary(summary, tile);
    if (flat.length === 0) {
        return { highlights: [], lead: [], more: [] };
    }

    const highlights = [];

    const title = firstMatching(flat, ['Title XMP', 'media.title']);
    if (title) {
        highlights.push({ id: 'highlight-title', label: 'Title', value: title.value, kind: 'title' });
    }

    const description = firstMatching(flat, ['x-Description', 'Description XMP', 'media.description', 'media.comment']);
    if (description) {
        highlights.push({
            id: 'highlight-description',
            label: 'Description',
            value: description.value,
            kind: 'description',
        });
    }

    const rating = firstMatching(flat, ['Rating XMP', 'media.rating']);
    if (rating) {
        highlights.push({ id: 'highlight-rating', label: 'Rating', value: rating.value, kind: 'rating' });
    }

    const rest = flat.filter(item => !HIGHLIGHT_SOURCE_KEYS.has(item.key));
    const { lead, more } = groupPhotoMetadata(rest);

    return { highlights, lead, more };
}

/**
 * Split flat metadata into lead fields and the remaining EXIF / technical entries.
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

    return { lead, more: rest };
}
