/**
 * ThumbnailExtractor - Handles thumbnail extraction from images and audio files
 * 
 * This module extracts preview thumbnails from media files:
 * - Images: Uses EXIF data when available, falls back to canvas-based resizing
 * - Audio: Extracts album art from audio file metadata
 */
import Logger from 'js-logger';
import exifr from 'exifr/dist/full.esm.mjs';
import * as musicMetadata from 'music-metadata-browser';

/**
 * Default maximum size for thumbnails (width or height)
 */
const DEFAULT_MAX_THUMBNAIL_SIZE = 200;

/**
 * Default JPEG quality for canvas-generated thumbnails
 */
const DEFAULT_THUMBNAIL_QUALITY = 0.9;

/**
 * Create a thumbnail from an image file using canvas
 * 
 * @param {File} file - The image file to create thumbnail from
 * @param {number} maxSize - Maximum thumbnail dimension
 * @returns {Promise<string>} Blob URL of the thumbnail
 */
async function createCanvasThumbnail(file, maxSize = DEFAULT_MAX_THUMBNAIL_SIZE) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        img.onload = () => {
            let width = img.width;
            let height = img.height;
            
            // Scale down maintaining aspect ratio
            if (width > height) {
                if (width > maxSize) {
                    height = (height * maxSize) / width;
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width = (width * maxSize) / height;
                    height = maxSize;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            
            canvas.toBlob((blob) => {
                // Clean up the object URL we created
                URL.revokeObjectURL(img.src);
                
                if (blob) {
                    const url = URL.createObjectURL(blob);
                    resolve(url);
                } else {
                    reject(new Error('Failed to create thumbnail blob'));
                }
            }, file.type || 'image/jpeg', DEFAULT_THUMBNAIL_QUALITY);
        };
        
        img.onerror = () => {
            URL.revokeObjectURL(img.src);
            reject(new Error('Failed to load image for thumbnail'));
        };
        
        img.src = URL.createObjectURL(file);
    });
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
 * Uses EXIF embedded thumbnails when available, falls back to canvas-based
 * resizing for images without EXIF data (like PNGs).
 * 
 * @param {File[]} filesArr - Array of image files
 * @returns {Promise<File[]>} Array of thumbnail File objects
 */
export async function getPreviewFromImage(filesArr) {
    if (!filesArr || filesArr.length === 0) {
        return [];
    }

    // First, try to extract EXIF thumbnails
    let thumbnailUrls = [];
    try {
        const urlPromises = filesArr.map(file => exifr.thumbnailUrl(file));
        thumbnailUrls = await Promise.all(urlPromises);
    } catch (e) {
        Logger.warn('Cannot find thumbnail from EXIF: ' + e + ' Files: ' + filesArr.map(f => f.name).join(', '));
    }

    // Filter out nulls/undefined
    thumbnailUrls = thumbnailUrls.map(url => url || null);

    // Create fallback thumbnails for images without EXIF data
    const needsFallback = thumbnailUrls.filter(url => !url).length > 0;
    
    if (needsFallback) {
        Logger.info('Creating fallback thumbnails for images without EXIF data');
        
        const fallbackPromises = filesArr.map(async (file, index) => {
            // Skip if we already have a thumbnail
            if (thumbnailUrls[index]) {
                return null;
            }
            
            try {
                return await createCanvasThumbnail(file);
            } catch (e) {
                Logger.warn('Failed to create fallback thumbnail for ' + file.name + ': ' + e);
                return null;
            }
        });
        
        const fallbackThumbnails = await Promise.all(fallbackPromises);
        
        // Merge fallback thumbnails into the array
        fallbackThumbnails.forEach((thumb, index) => {
            if (thumb && !thumbnailUrls[index]) {
                thumbnailUrls[index] = thumb;
            }
        });
    }

    // Filter to only valid thumbnails
    const validThumbnails = thumbnailUrls.filter(url => url);
    
    if (validThumbnails.length === 0) {
        Logger.warn('No thumbnail found for any image.');
        return [];
    }

    // Convert blob URLs to actual blobs
    const blobPromises = thumbnailUrls
        .filter(item => item)
        .map(item => urlToBlob(item));
    
    const thumbnailBlobs = await Promise.all(blobPromises);

    // Create File objects with proper naming
    const thumbnailFiles = thumbnailBlobs.map((blob, index) => {
        // Find the corresponding original file
        let originalFileIndex = 0;
        let validIndex = 0;
        for (let i = 0; i < thumbnailUrls.length; i++) {
            if (thumbnailUrls[i]) {
                if (validIndex === index) {
                    originalFileIndex = i;
                    break;
                }
                validIndex++;
            }
        }
        
        const originalFile = filesArr[originalFileIndex] || filesArr[index];
        return createThumbnailFile(blob, originalFile);
    });

    return thumbnailFiles;
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
 * Extract thumbnails from media files based on their type
 * 
 * Automatically detects file type and uses appropriate extraction method.
 * 
 * @param {File[]} filesArr - Array of media files
 * @returns {Promise<File[]>} Array of thumbnail File objects
 */
export async function extractThumbnails(filesArr) {
    if (!filesArr || filesArr.length === 0) {
        return [];
    }

    // Filter out invalid items
    const validFiles = filesArr.filter(file => file && (file instanceof File || file instanceof Blob));
    
    if (validFiles.length === 0) {
        return [];
    }

    // Check file types
    const allImages = validFiles.every(file => file.type && file.type.includes('image/'));
    const allAudio = validFiles.every(file => file.type && file.type.includes('audio/'));

    if (allImages) {
        return getPreviewFromImage(validFiles);
    } else if (allAudio) {
        return getPreviewFromAudio(validFiles);
    }

    // Mixed content - handle each type separately
    const imageFiles = validFiles.filter(file => file.type && file.type.includes('image/'));
    const audioFiles = validFiles.filter(file => file.type && file.type.includes('audio/'));

    const [imageThumbs, audioThumbs] = await Promise.all([
        imageFiles.length > 0 ? getPreviewFromImage(imageFiles) : [],
        audioFiles.length > 0 ? getPreviewFromAudio(audioFiles) : []
    ]);

    return [...imageThumbs, ...audioThumbs];
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
    extractThumbnails,
    isThumbnail,
    getOriginalFilename
};

