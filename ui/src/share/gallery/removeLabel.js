/**
 * The name of the Remove button, the same in every mode. Remove takes the
 * photo out of the room for everyone, so the button names the photo.
 */
export function removeLabel(tile) {
    return `Remove ${(tile && tile.fileName) || 'photo'}`;
}
