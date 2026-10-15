/** Fields shown first in the photo viewer. Everything else goes under More. */
export const LEAD_KEYS = [
    'x-file name',
    'Title XMP',
    'x-Description',
    'DateTimeOriginal',
    'x-Camera',
    'x-Settings',
    'x-Pixel Size',
    'x-Location',
    'GPSAltitude',
    'Keywords XMP',
    'XPKeywords',
    'Rating XMP',
];

const LEAD_LABELS = {
    'x-file name': 'File name',
    'Title XMP': 'Title',
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
};

export function labelForMetadataKey(key) {
    return LEAD_LABELS[key] || key;
}

/**
 * Split a MetadataParser summary into the fields people look for first
 * and the remaining EXIF entries.
 */
export function groupPhotoMetadata(summary) {
    if (!Array.isArray(summary) || summary.length === 0) {
        return { lead: [], more: [] };
    }

    const rest = summary.filter(item => item && item.value != null && item.value !== '');
    const lead = [];

    LEAD_KEYS.forEach(key => {
        const index = rest.findIndex(item => item.key === key);
        if (index >= 0) {
            lead.push(rest.splice(index, 1)[0]);
        }
    });

    return { lead, more: rest };
}
