/**
 * The libraries that read what is inside a photo or a clip (EXIF, XMP,
 * audio and video tags). They are big and a page needs them only once a
 * photo is here, so they load on first use and not with the app: the
 * front page and the room open faster without them.
 */
let exifrLoad = null;
let musicMetadataLoad = null;

/** exifr, loaded once. A failed load is tried again on the next call. */
export function loadExifr() {
    if (!exifrLoad) {
        exifrLoad = import('exifr/dist/full.esm.mjs')
            .then(module => module.default || module)
            .catch(err => { exifrLoad = null; throw err; });
    }
    return exifrLoad;
}

/** music-metadata, loaded once. A failed load is tried again on the next call. */
export function loadMusicMetadata() {
    if (!musicMetadataLoad) {
        musicMetadataLoad = import('music-metadata')
            .catch(err => { musicMetadataLoad = null; throw err; });
    }
    return musicMetadataLoad;
}

/** Start both loads while the page has nothing else to do. */
export function preloadParsers() {
    loadExifr().catch(() => {});
    loadMusicMetadata().catch(() => {});
}
