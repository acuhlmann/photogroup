/**
 * ThumbnailExtractor - Handles thumbnail extraction from images and audio files
 * 
 * This module extracts preview thumbnails from media files:
 * - Images: Uses EXIF data when available, falls back to canvas-based resizing
 * - Audio: Extracts album art from audio file metadata
 * - Video: Grabs one frame in the browser (no server work), as a small JPEG
 */
import Logger from 'js-logger';
import { posterFromFile } from '../util/videoFrame';
import exifr from 'exifr/dist/full.esm.mjs';
import * as musicMetadata from 'music-metadata';

/**
 * Default maximum size for thumbnails (width or height)
 */
const DEFAULT_MAX_THUMBNAIL_SIZE = 200;

/**
 * Default JPEG quality for canvas-generated thumbnails
 */
const DEFAULT_THUMBNAIL_QUALITY = 0.9;

/**
 * How many photos are decoded at the same time. A full-size phone photo takes
 * tens of MB once decoded, so a big batch at once runs a phone out of memory.
 */
const DECODE_AT_ONCE = 2;

function fitWithin(width, height, maxSize) {
    const scale = Math.min(1, maxSize / Math.max(width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
}

function canvasToBlobUrl(canvas, type) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(URL.createObjectURL(blob));
            } else {
                reject(new Error('Failed to create thumbnail blob'));
            }
        }, type || 'image/jpeg', DEFAULT_THUMBNAIL_QUALITY);
    });
}

/**
 * Decode with createImageBitmap: the browser decodes on another thread, so
 * the page keeps scrolling and answering taps while a batch is prepared.
 * Returns null when the browser can't do it this way.
 */
async function bitmapThumbnail(file, maxSize) {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
        return null;
    }
    let bitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
        return null;
    }
    try {
        const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSize);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
        return await canvasToBlobUrl(canvas, file.type);
    } finally {
        bitmap.close && bitmap.close();
    }
}

/**
 * Older browsers: decode through an <img>. img.decode() keeps the decode off
 * the main thread where it can.
 */
async function imageElementThumbnail(file, maxSize) {
    const img = new Image();
    const src = URL.createObjectURL(file);
    try {
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('Failed to load image for thumbnail'));
            img.src = src;
        });
        if (img.decode) {
            await img.decode().catch(() => {});
        }
        const { width, height } = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height, maxSize);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        return await canvasToBlobUrl(canvas, file.type);
    } finally {
        URL.revokeObjectURL(src);
    }
}

/**
 * Create a thumbnail from an image file using canvas
 *
 * @param {File} file - The image file to create thumbnail from
 * @param {number} maxSize - Maximum thumbnail dimension
 * @returns {Promise<string>} Blob URL of the thumbnail
 */
export async function createCanvasThumbnail(file, maxSize = DEFAULT_MAX_THUMBNAIL_SIZE) {
    return (await bitmapThumbnail(file, maxSize)) || imageElementThumbnail(file, maxSize);
}

/** Run `task` over `items` with at most `limit` running at once, keeping order. */
async function mapLimited(items, limit, task) {
    const results = new Array(items.length);
    let next = 0;
    const lane = async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await task(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
    return results;
}

/**
 * Convert a blob URL to a Blob object
 * 
 * @param {string|Blob} item - Blob URL string or Blob object
 * @returns {Promise<Blob>} The blob object
 */
async function urlToBlob(item) {
    if (typeof item === 'string' && item.startsWith('blob:')) {
        const response = await fetch(item);
        return response.blob();
    }
    return item;
}

/**
 * Create a File object from a blob for use as a thumbnail
 * 
 * @param {Blob} blob - The thumbnail blob
 * @param {File} originalFile - The original file to derive metadata from
 * @returns {File} A File object with the thumbnail naming convention
 */
function createThumbnailFile(blob, originalFile) {
    const fileName = 'Thumbnail ' + originalFile.name;
    return new File([blob], fileName, {
        type: originalFile.type || blob.type,
        lastModified: originalFile.lastModified
    });
}

/**
 * Extract thumbnail previews from image files
 *
 * Uses the EXIF embedded thumbnail when there is one, else scales the photo
 * down on a canvas (PNGs, screenshots). Each photo is done start to end before
 * the next, a few at a time, so the first preview is ready in a moment
 * instead of after every photo of the batch has been read.
 *
 * @param {File[]} filesArr - Array of image files
 * @param {function(File, File)} [onEach] - Called with (thumbnail, original)
 *   as soon as each thumbnail is ready, so its tile can show it right away.
 * @returns {Promise<File[]>} Thumbnail Files, in the order of their photos
 */
export async function getPreviewFromImage(filesArr, onEach) {
    if (!filesArr || filesArr.length === 0) {
        return [];
    }

    const thumbnails = await mapLimited(filesArr, DECODE_AT_ONCE, async (file) => {
        let url = null;
        try {
            url = await exifr.thumbnailUrl(file);
        } catch (e) {
            Logger.warn('Cannot find thumbnail from EXIF in ' + file.name + ': ' + e);
        }
        if (!url) {
            try {
                url = await createCanvasThumbnail(file);
            } catch (e) {
                Logger.warn('Failed to create fallback thumbnail for ' + file.name + ': ' + e);
                return null;
            }
        }
        try {
            const thumb = createThumbnailFile(await urlToBlob(url), file);
            if (onEach) {
                try {
                    onEach(thumb, file);
                } catch (e) {
                    Logger.warn('Cannot show the thumbnail of ' + file.name + ' early: ' + e);
                }
            }
            return thumb;
        } catch (e) {
            Logger.warn('Cannot read the thumbnail of ' + file.name + ': ' + e);
            return null;
        }
    });

    const valid = thumbnails.filter(Boolean);
    if (valid.length === 0) {
        Logger.warn('No thumbnail found for any image.');
    }
    return valid;
}

/**
 * Extract album art thumbnails from audio files
 * 
 * Parses audio file metadata to extract embedded album artwork.
 * 
 * @param {File[]} filesArr - Array of audio files
 * @returns {Promise<File[]>} Array of thumbnail File objects
 */
export async function getPreviewFromAudio(filesArr) {
    if (!filesArr || filesArr.length === 0) {
        return [];
    }

    let metadatas = [];

    try {
        const parsePromises = filesArr.map(file => musicMetadata.parseBlob(file));
        metadatas = await Promise.all(parsePromises);
    } catch (e) {
        Logger.warn('Cannot find audio metadata: ' + e + ' Files: ' + filesArr.map(f => f.name).join(', '));
    }

    const thumbnailFiles = metadatas
        .map((metadata, index) => {
            if (!metadata) return null;
            
            const picture = metadata.common?.picture;
            if (!picture || picture.length === 0) {
                return null;
            }
            
            if (picture.length > 1) {
                Logger.warn('Multiple album art images found, using first one. Count: ' + picture.length);
            }
            
            const pic = picture[0];
            if (!pic || !pic.data) {
                return null;
            }
            
            const originalFile = filesArr[index];
            const fileName = 'Thumbnail ' + originalFile.name;
            
            return new File([pic.data], fileName, {
                type: pic.format || 'image/jpeg'
            });
        })
        .filter(item => item !== null);

    return thumbnailFiles;
}

/**
 * Grab a poster frame for each video file, so the people waiting for a clip
 * see what it is. Each is a JPEG of a few dozen KB that travels in the same
 * torrent ahead of the clip. Clips the browser can't decode get none.
 *
 * @param {File[]} filesArr - Array of video files
 * @returns {Promise<File[]>} Array of thumbnail File objects
 */
export async function getPreviewFromVideo(filesArr, onEach) {
    if (!filesArr || filesArr.length === 0) {
        return [];
    }
    const thumbnailFiles = [];
    // One at a time: decoding several clips at once stalls a phone.
    for (const file of filesArr) {
        try {
            const blob = await posterFromFile(file);
            if (blob) {
                const thumb = new File([blob], 'Thumbnail ' + file.name, {
                    type: 'image/jpeg',
                    lastModified: file.lastModified
                });
                thumbnailFiles.push(thumb);
                if (onEach) onEach(thumb, file);
            }
        } catch (e) {
            Logger.warn('Failed to grab a video frame for ' + file.name + ': ' + e);
        }
    }
    return thumbnailFiles;
}

/**
 * Extract thumbnails from media files based on their type
 * 
 * Automatically detects file type and uses appropriate extraction method.
 * 
 * @param {File[]} filesArr - Array of media files
 * @param {function(File, File)} [onEach] - Called with (thumbnail, original)
 *   as each photo or clip thumbnail is ready.
 * @returns {Promise<File[]>} Array of thumbnail File objects
 */
export async function extractThumbnails(filesArr, onEach) {
    if (!filesArr || filesArr.length === 0) {
        return [];
    }

    // Filter out invalid items
    const validFiles = filesArr.filter(file => file && (file instanceof File || file instanceof Blob));
    
    if (validFiles.length === 0) {
        return [];
    }

    const ofType = kind => validFiles.filter(file => file.type && file.type.includes(kind + '/'));
    const imageFiles = ofType('image');
    const audioFiles = ofType('audio');
    const videoFiles = ofType('video');

    const [imageThumbs, audioThumbs, videoThumbs] = await Promise.all([
        imageFiles.length > 0 ? getPreviewFromImage(imageFiles, onEach) : [],
        audioFiles.length > 0 ? getPreviewFromAudio(audioFiles) : [],
        videoFiles.length > 0 ? getPreviewFromVideo(videoFiles, onEach) : []
    ]);

    return [...imageThumbs, ...audioThumbs, ...videoThumbs];
}

/**
 * Check if a file is a thumbnail (by naming convention)
 * 
 * @param {File|{name: string}} file - File or object with name property
 * @returns {boolean} True if the file is a thumbnail
 */
export function isThumbnail(file) {
    return file?.name?.startsWith('Thumbnail ') || false;
}

/**
 * Get the original filename from a thumbnail filename
 * 
 * @param {string} thumbnailName - The thumbnail filename
 * @returns {string|null} The original filename or null if not a thumbnail
 */
export function getOriginalFilename(thumbnailName) {
    if (!thumbnailName || typeof thumbnailName !== 'string') return null;
    if (!thumbnailName.startsWith('Thumbnail ')) return null;
    return thumbnailName.substring('Thumbnail '.length);
}

export default {
    getPreviewFromImage,
    getPreviewFromAudio,
    getPreviewFromVideo,
    extractThumbnails,
    isThumbnail,
    getOriginalFilename
};

